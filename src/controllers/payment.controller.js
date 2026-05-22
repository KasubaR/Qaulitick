// Payment Controller
const { Op } = require('sequelize');
const { sequelize } = require('../config/mysql');
const Payment = require('../models/Payment.model');
const Order = require('../models/Order.model');
const lencoService = require('../services/lenco.service');
const dpoService = require('../services/dpo.service');
const orderService = require('../services/order.service');
const laybyService = require('../services/layby.service');
const {
    applyPaymentStatusSideEffects,
    sendAdminPaymentNotificationOnce
} = require('../services/paymentCompletion.service');
const {
    compactDpoVerifyRaw,
    applyDpoVerificationOutcome
} = require('../services/dpoPaymentOutcome.service');
const LaybyPayment = require('../models/LaybyPayment.model');
const LaybyPlan = require('../models/LaybyPlan.model');
const logger = require('../utils/logger').child({ module: 'PaymentController' });

function roundMoney2(x) {
    return Math.round(Number(x) * 100) / 100;
}

function getPublicBaseUrl() {
    const base = process.env.APP_PUBLIC_URL || '';
    return String(base).replace(/\/$/, '');
}

function splitCustomerName(name) {
    const n = (name && String(name).trim()) || '';
    if (!n) return { first: '', last: '' };
    const space = n.indexOf(' ');
    if (space === -1) return { first: n, last: '' };
    return { first: n.slice(0, space).trim(), last: n.slice(space + 1).trim() };
}

/**
 * Layby payments: only the plan owner (or an admin) may poll verify — transaction IDs are not public secrets.
 * @returns {Promise<{ status: number, body: object }|null>} Error response to send, or null if allowed
 */
async function assertLaybyPaymentVerifyAuthorized(req, payment) {
    if (!payment.laybyPaymentId) {
        return null;
    }
    const admin = req.admin;
    if (admin) {
        return null;
    }
    if (!req.session || req.session.userId == null) {
        return {
            status: 401,
            body: { success: false, message: 'Sign in to verify this layby payment.' }
        };
    }
    const uid = parseInt(String(req.session.userId), 10);
    const installment = await LaybyPayment.findByPk(payment.laybyPaymentId, {
        include: [{ model: LaybyPlan, as: 'laybyPlan', required: true }]
    });
    if (!installment || !installment.laybyPlan) {
        return { status: 404, body: { success: false, message: 'Payment not found' } };
    }
    if (installment.laybyPlan.userId !== uid) {
        return { status: 403, body: { success: false, message: 'Not authorized' } };
    }
    return null;
}

// Payment retry limit (configurable via environment variable)
const MAX_PAYMENT_RETRIES = parseInt(process.env.MAX_PAYMENT_RETRIES || '3', 10);

// Feature flags for payment methods (configurable via environment variables)
const ENABLE_BANK_TRANSFER = process.env.ENABLE_BANK_TRANSFER === 'true' || process.env.ENABLE_BANK_TRANSFER === '1';

/**
 * Process Payment
 * Handles payment initiation for Lenco payment methods (mobile money and bank transfer).
 *
 * Amount is taken from the database for standard checkout and scheduled layby installments.
 * Flexible layby balance payments may optionally send laybyPayAmount (validated and capped server-side).
 * The orderNumber is the sole key; the server derives every financial value from
 * the persisted order record to prevent client-side price manipulation.
 */
exports.processPayment = async (req, res) => {
    try {
        const {
            orderNumber,
            paymentMethod,
            customerInfo,
            laybyPaymentId: rawLaybyPaymentId,
            laybyPayAmount: rawLaybyPayAmount,
            // Lenco-specific fields
            provider, // For mobile money: 'airtel', 'mtn'
            customerPhone, // For mobile money: phone number
            bankDetails // For bank transfer: { bankName, accountNumber, accountName }
        } = req.body;

        const laybyPaymentId =
            rawLaybyPaymentId !== undefined && rawLaybyPaymentId !== null && rawLaybyPaymentId !== ''
                ? parseInt(String(rawLaybyPaymentId), 10)
                : null;
        const laybyIdValid = laybyPaymentId !== null && !Number.isNaN(laybyPaymentId);

        // Validate required fields
        if (!orderNumber || !paymentMethod || !customerInfo) {
            return res.status(400).json({
                success: false,
                message: 'Missing required payment information'
            });
        }

        // Fetch order from database — this is the sole source of the charge amount.
        const order = await Order.findByOrderNumber(orderNumber);

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found. Cannot process payment for non-existent order.'
            });
        }

        // Authoritative amount — never derived from req.body (except layby installment from DB row).
        let authoritativeAmount = Number(order.totals.total);
        let orderDataForLenco = order.toJSON();

        if (laybyIdValid) {
            if (!req.session || !req.session.userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Sign in to pay this layby installment.'
                });
            }
            const sessionUserId = parseInt(String(req.session.userId), 10);
            const installment = await LaybyPayment.findByPk(laybyPaymentId, {
                include: [{ model: LaybyPlan, as: 'laybyPlan', required: true }]
            });
            if (!installment || !installment.laybyPlan) {
                return res.status(404).json({
                    success: false,
                    message: 'Layby installment not found.'
                });
            }
            const plan = installment.laybyPlan;
            if (plan.userId !== sessionUserId) {
                return res.status(403).json({
                    success: false,
                    message: 'You cannot pay this installment.'
                });
            }
            if (plan.orderId !== order.id) {
                return res.status(400).json({
                    success: false,
                    message: 'Order does not match this layby installment.'
                });
            }
            if (!['pending', 'overdue'].includes(installment.status)) {
                return res.status(400).json({
                    success: false,
                    message: 'This installment is not awaiting payment.'
                });
            }
            const balanceCap = roundMoney2(Number(plan.balanceRemaining));
            const rowAmount = roundMoney2(Number(installment.amount));
            const flex = laybyService.isFlexibleBalanceInstallment(plan, installment);

            if (flex) {
                const maxCharge = roundMoney2(Math.min(balanceCap, rowAmount));
                if (rawLaybyPayAmount !== undefined && rawLaybyPayAmount !== null && rawLaybyPayAmount !== '') {
                    const requested = roundMoney2(parseFloat(String(rawLaybyPayAmount)));
                    if (Number.isNaN(requested) || requested <= 0) {
                        return res.status(400).json({
                            success: false,
                            message: 'Layby payment amount must be a positive number.'
                        });
                    }
                    if (requested > maxCharge) {
                        return res.status(400).json({
                            success: false,
                            message: 'Layby payment amount cannot exceed the remaining balance.'
                        });
                    }
                    authoritativeAmount = requested;
                } else {
                    authoritativeAmount = maxCharge;
                }
            } else {
                if (
                    rawLaybyPayAmount !== undefined &&
                    rawLaybyPayAmount !== null &&
                    rawLaybyPayAmount !== ''
                ) {
                    return res.status(400).json({
                        success: false,
                        message: 'Custom layby amount is only allowed for flexible balance payments.'
                    });
                }
                authoritativeAmount = rowAmount;
            }
            orderDataForLenco = {
                ...order.toJSON(),
                totals: { ...order.totals, total: authoritativeAmount }
            };
        }

        // Validate payment method based on feature flags
        const validPaymentMethods = ['mobile_money'];
        if (ENABLE_BANK_TRANSFER) {
            validPaymentMethods.push('bank_transfer');
        }
        
        if (!validPaymentMethods.includes(paymentMethod)) {
            return res.status(400).json({
                success: false,
                message: `Payment method "${paymentMethod}" is not supported. Supported methods: ${validPaymentMethods.join(', ')}`
            });
        }
        
        // Reject bank_transfer requests if feature flag is disabled
        if (paymentMethod === 'bank_transfer' && !ENABLE_BANK_TRANSFER) {
            return res.status(400).json({
                success: false,
                message: 'Bank transfer payments are currently disabled. Please use mobile money payment.'
            });
        }

        let lencoResponse;
        let paymentRecord;

        // Atomic idempotency gate — closes TOCTOU race between concurrent requests.
        // Lock the Order row so any concurrent processPayment for the same order
        // serialises here. Re-check for an in-flight payment inside the lock, then
        // INSERT a placeholder Payment row (status='pending') before releasing.
        // The Lenco API call happens outside this transaction so no DB lock is held
        // during the network round-trip.
        const pendingWhere = {
            orderNumber,
            status: { [Op.in]: ['pending', 'processing'] }
        };
        if (laybyIdValid) {
            pendingWhere.laybyPaymentId = laybyPaymentId;
        } else {
            pendingWhere.laybyPaymentId = { [Op.is]: null };
        }

        try {
            paymentRecord = await sequelize.transaction(async (t) => {
                // Lock the order row — a second concurrent request blocks here until
                // this transaction commits, then finds the placeholder and returns 409.
                await Order.findByPk(order.id, { lock: t.LOCK.UPDATE, transaction: t });

                const existing = await Payment.findOne({ where: pendingWhere, transaction: t });
                if (existing) {
                    const err = new Error('ALREADY_PENDING');
                    err.statusCode = 409;
                    err.transactionId = existing.lencoTransactionId || existing.transactionId;
                    throw err;
                }

                return Payment.create({
                    orderNumber,
                    paymentMethod,
                    amount: authoritativeAmount,
                    currency: 'ZMW',
                    status: 'pending',
                    customerInfo,
                    laybyPaymentId: laybyIdValid ? laybyPaymentId : null,
                    lencoProvider: paymentMethod === 'mobile_money' ? (provider || '').toLowerCase() : undefined,
                    metadata: { initiating: true }
                }, { transaction: t });
            });
        } catch (err) {
            if (err.statusCode === 409) {
                return res.status(409).json({
                    success: false,
                    message: 'A payment is already pending for this order',
                    transactionId: err.transactionId
                });
            }
            throw err;
        }

        // Handle Mobile Money Payment
        if (paymentMethod === 'mobile_money') {
            // Validate mobile money requirements
            if (!provider || !customerPhone) {
                await paymentRecord.update({ status: 'failed', failureReason: 'Missing provider or phone', failedAt: new Date() }).catch(() => {});
                return res.status(400).json({
                    success: false,
                    message: 'Mobile money payment requires provider (airtel or mtn) and customer phone number'
                });
            }

            if (!['airtel', 'mtn'].includes(provider.toLowerCase())) {
                await paymentRecord.update({ status: 'failed', failureReason: 'Invalid provider', failedAt: new Date() }).catch(() => {});
                return res.status(400).json({
                    success: false,
                    message: 'Invalid mobile money provider. Must be: airtel or mtn'
                });
            }

            try {
                // Initiate mobile money payment with Lenco (outside the DB transaction)
                lencoResponse = await lencoService.initiateMobileMoneyPayment(
                    orderDataForLenco,
                    customerPhone,
                    provider.toLowerCase(),
                    laybyIdValid ? authoritativeAmount : null
                );

                // Update placeholder with Lenco collection data
                const mappedStatus = Payment.mapLencoStatusToPaymentStatus(lencoResponse.status || 'pending');

                await paymentRecord.update({
                    status: mappedStatus,
                    currency: lencoResponse.currency || 'ZMW',
                    // Lenco-specific fields
                    lencoTransactionId: lencoResponse.transactionId,      // Collection ID (col_xxx)
                    lencoReference: lencoResponse.lencoReference,         // Lenco's reference (LNC-xxx)
                    lencoProvider: provider.toLowerCase(),
                    lencoStatus: lencoResponse.status,                    // 'pay-offline', 'pending', etc.
                    lencoResponse: lencoResponse.rawResponse || lencoResponse,
                    // Your reference (QC-ORD-xxx)
                    transactionId: lencoResponse.reference,
                    // Payment instructions for customer
                    paymentInstructions: lencoResponse.paymentInstructions,
                    // Additional Lenco fields
                    qrCode: lencoResponse.qrCode,
                    paymentUrl: lencoResponse.paymentUrl,
                    expiresAt: lencoResponse.expiresAt ? new Date(lencoResponse.expiresAt) : null,
                    metadata: {
                        provider: provider.toLowerCase(),
                        customerPhone: customerPhone,
                        initiatedAt: lencoResponse.initiatedAt,
                        mobileMoneyDetails: lencoResponse.mobileMoneyDetails,
                        laybyPaymentId: laybyIdValid ? laybyPaymentId : undefined
                    }
                });

                logger.debug({ orderNumber, provider }, 'Mobile money payment initiated');

                if (laybyIdValid) {
                    try {
                        await orderService.updateOrderStatusFromPayment(
                            orderNumber,
                            'pending',
                            paymentRecord.lencoTransactionId,
                            'Layby installment payment initiated'
                        );
                    } catch (ordErr) {
                        logger.warn({ err: ordErr }, 'Order status update after layby payment start');
                    }
                }

                return res.json({
                    success: true,
                    transactionId: lencoResponse.transactionId,
                    reference: lencoResponse.reference,
                    orderNumber,
                    paymentMethod,
                    amount: authoritativeAmount,
                    status: 'pending',
                    laybyPaymentId: laybyIdValid ? laybyPaymentId : undefined,
                    paymentInstructions: lencoResponse.paymentInstructions,
                    qrCode: lencoResponse.qrCode,
                    paymentUrl: lencoResponse.paymentUrl,
                    bankAccount: lencoResponse.bankAccount,
                    expiresAt: lencoResponse.expiresAt,
                    message:
                        'Payment initiated successfully. Please complete the payment using the instructions provided.'
                });
            } catch (error) {
                logger.error({ err: error }, 'Error initiating mobile money payment');

                // Update placeholder to failed (avoid a second pending row)
                await paymentRecord.update({
                    status: 'failed',
                    failureReason: error.message,
                    failedAt: new Date(),
                    metadata: {
                        provider: provider.toLowerCase(),
                        customerPhone: customerPhone
                    }
                }).catch(() => {});

                const statusCode = error.name === 'validation_error' ? 400 : 500;
                return res.status(statusCode).json({
                    success: false,
                    message: error.message || 'Failed to initiate mobile money payment',
                    orderNumber,
                    paymentMethod,
                    amount: authoritativeAmount,
                    status: 'failed'
                });
            }
        }

        if (paymentMethod === 'bank_transfer') {
            const publicBase = getPublicBaseUrl();
            if (!publicBase) {
                await paymentRecord
                    .update({
                        status: 'failed',
                        failureReason: 'APP_PUBLIC_URL not configured',
                        failedAt: new Date()
                    })
                    .catch(() => {});
                return res.status(500).json({
                    success: false,
                    message: 'Payment redirect URL is not configured. Please contact support.'
                });
            }

            const companyRef = `QC-PAY-${paymentRecord.id}`;
            const { first: customerFirst, last: customerLast } = splitCustomerName(customerInfo.name);
            const redirectUrl = `${publicBase}/api/payments/dpo/success`;
            const backUrl = `${publicBase}/api/payments/dpo/cancel`;
            const amtStr = roundMoney2(authoritativeAmount).toFixed(2);
            const serviceDesc = `Order ${orderNumber}`;

            try {
                const dpoResult = await dpoService.createToken({
                    amount: amtStr,
                    currency: 'ZMW',
                    companyRef,
                    redirectUrl,
                    backUrl,
                    serviceDesc,
                    customerEmail: customerInfo.email || '',
                    customerFirst,
                    customerLast
                });

                await paymentRecord.update({
                    transactionId: dpoResult.token,
                    paymentUrl: dpoResult.paymentUrl,
                    metadata: {
                        gateway: 'dpo',
                        companyRef,
                        transRef: dpoResult.transRef,
                        ptl: dpoResult.ptl,
                        ptlType: dpoResult.ptlType,
                        laybyPaymentId: laybyIdValid ? laybyPaymentId : undefined
                    }
                });

                logger.debug({ orderNumber, companyRef }, 'DPO payment initiated');

                if (laybyIdValid) {
                    try {
                        await orderService.updateOrderStatusFromPayment(
                            orderNumber,
                            'pending',
                            companyRef,
                            'Layby installment payment initiated (DPO)'
                        );
                    } catch (ordErr) {
                        logger.warn({ err: ordErr }, 'Order status update after DPO payment start');
                    }
                }

                return res.json({
                    success: true,
                    redirectToPaymentUrl: true,
                    transactionId: dpoResult.token,
                    reference: companyRef,
                    orderNumber,
                    paymentMethod: 'bank_transfer',
                    amount: authoritativeAmount,
                    status: 'pending',
                    paymentUrl: dpoResult.paymentUrl,
                    laybyPaymentId: laybyIdValid ? laybyPaymentId : undefined,
                    message: 'Redirect to secure payment page to complete your payment.'
                });
            } catch (error) {
                logger.error({ err: error }, 'Error initiating DPO payment');
                await paymentRecord
                    .update({
                        status: 'failed',
                        failureReason: error.message,
                        failedAt: new Date(),
                        metadata: { gateway: 'dpo', failed: true }
                    })
                    .catch(() => {});

                return res.status(500).json({
                    success: false,
                    message: error.message || 'Failed to initiate payment',
                    orderNumber,
                    paymentMethod,
                    amount: authoritativeAmount,
                    status: 'failed'
                });
            }
        }

        return res.status(500).json({
            success: false,
            message: 'Payment processing reached an unexpected state.'
        });

    } catch (error) {
        console.error('[Payment Controller] Error processing payment:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Payment processing error. Please try again.'
        });
    }
};

/**
 * DPO redirect after payment — GET /api/payments/dpo/success
 */
exports.handleDpoSuccess = async (req, res) => {
    try {
        const tokenRaw = req.query.TransactionToken || req.query.transactionToken;
        const token = tokenRaw != null ? String(tokenRaw).trim() : '';
        if (!token) {
            return res.status(400).send('Missing transaction token.');
        }

        const base = getPublicBaseUrl();
        if (!base) {
            return res.status(500).send('Server configuration error.');
        }

        const payment = await Payment.findOne({
            where: {
                transactionId: token,
                paymentMethod: 'bank_transfer',
                status: { [Op.in]: ['pending', 'processing'] }
            }
        });

        const meta = payment ? payment.metadata || {} : {};
        if (!payment || meta.gateway !== 'dpo') {
            return res.status(404).send('Payment session not found.');
        }

        if (payment.status === 'completed') {
            return res.redirect(
                `${base}/order-success/${encodeURIComponent(payment.orderNumber)}?dpo=already`
            );
        }

        const dpoResult = await dpoService.verifyToken(token);
        const { outcome, raw } = dpoResult;

        if (outcome.paid) {
            await applyDpoVerificationOutcome(payment, outcome, raw, 'DPO RedirectURL');
            return res.redirect(
                `${base}/order-success/${encodeURIComponent(payment.orderNumber)}?dpo=verified`
            );
        }

        if (!outcome.terminal) {
            await payment.update({ gatewayResponse: compactDpoVerifyRaw(raw) });
            return res.redirect(
                `${base}/order-success/${encodeURIComponent(payment.orderNumber)}?dpo=pending`
            );
        }

        await applyDpoVerificationOutcome(payment, outcome, raw, 'DPO RedirectURL terminal');
        return res.redirect(
            `${base}/order-success/${encodeURIComponent(payment.orderNumber)}?dpo=error`
        );
    } catch (err) {
        logger.error({ err }, 'handleDpoSuccess failed');
        return res.status(500).send('Payment verification failed. Please contact support.');
    }
};

/**
 * DPO BackURL — customer cancelled on hosted page
 */
exports.handleDpoCancel = async (req, res) => {
    const base = getPublicBaseUrl();
    if (!base) {
        return res.status(500).send('Server configuration error.');
    }

    try {
        const tokenRaw = req.query.TransactionToken || req.query.transactionToken;
        const token = tokenRaw != null ? String(tokenRaw).trim() : '';
        if (token) {
            const payment = await Payment.findOne({
                where: {
                    transactionId: token,
                    paymentMethod: 'bank_transfer',
                    status: { [Op.in]: ['pending', 'processing'] }
                }
            });
            if (payment && (payment.metadata || {}).gateway === 'dpo') {
                await payment.update({
                    status: 'cancelled',
                    cancelledAt: new Date(),
                    failureReason: 'Cancelled by customer on DPO payment page'
                });
                logger.debug({ token, orderNumber: payment.orderNumber }, 'DPO payment cancelled by customer');
            }
        }
    } catch (err) {
        // Non-fatal — log and still redirect the customer
        logger.warn({ err }, 'handleDpoCancel: failed to mark payment cancelled');
    }

    res.redirect(`${base}/checkout?dpo=cancelled`);
};

/**
 * Verify Payment Status
 * Queries Lenco API to verify current payment status
 * Handles "Collection details was not found" error gracefully when Lenco hasn't created collection yet
 */
exports.verifyPayment = async (req, res) => {
    try {
        const { transactionId } = req.params;
        
        logger.debug({ transactionId }, 'Verifying payment');

        // First, check the database for payment record
        // transactionId could be: collection ID, Lenco reference, or your reference
        let payment = await Payment.findByTransactionId(transactionId);
        
        // If not found, try finding by collection ID (lencoTransactionId)
        if (!payment) {
            payment = await Payment.findByLencoTransactionId(transactionId);
        }
        
        // If still not found, try finding by Lenco reference
        if (!payment) {
            payment = await Payment.findByLencoReference(transactionId);
        }
        
        if (!payment) {
            logger.debug({ transactionId }, 'Payment not found in database');
            return res.status(404).json({
                success: false,
                message: 'Payment not found'
            });
        }

        // Ownership check — layby payments (has laybyPaymentId) use plan.userId;
        // standard payments use order.userId. Admins bypass both.
        const authError = await assertLaybyPaymentVerifyAuthorized(req, payment);
        if (authError) return res.status(authError.status).json(authError.body);

        if (!payment.laybyPaymentId) {
            const admin = req.admin;
            if (!admin) {
                const order = await Order.findByOrderNumber(payment.orderNumber);
                const uid = req.session?.userId != null ? parseInt(String(req.session.userId), 10) : null;
                if (order?.userId != null && order.userId !== uid) {
                    return res.status(403).json({ success: false, message: 'Forbidden' });
                }
            }
        }

        logger.debug(
            {
                transactionId: payment.lencoTransactionId,
                reference: payment.lencoReference,
                currentStatus: payment.status,
                lencoStatus: payment.lencoStatus
            },
            'Found payment in database'
        );

        const meta = payment.metadata || {};

        // Terminal statuses — no gateway refresh
        if (['completed', 'failed', 'cancelled', 'refunded'].includes(payment.status)) {
            logger.debug({ status: payment.status }, 'Payment already finalized');
            return res.json({
                success: true,
                transactionId: payment.lencoTransactionId || payment.transactionId,
                lencoTransactionId: payment.lencoTransactionId,
                lencoReference: payment.lencoReference,
                status: payment.status,
                lencoStatus: payment.lencoStatus,
                verified: true,
                message: `Payment ${payment.status}`,
                orderNumber: payment.orderNumber
            });
        }

        // DPO (bank_transfer hosted checkout)
        if (
            meta.gateway === 'dpo' &&
            payment.paymentMethod === 'bank_transfer' &&
            ['pending', 'processing'].includes(payment.status)
        ) {
            try {
                const dpoResult = await dpoService.verifyToken(payment.transactionId);
                const { outcome, raw } = dpoResult;

                if (outcome.paid) {
                    await applyDpoVerificationOutcome(payment, outcome, raw, 'payment verify API');
                    payment = await Payment.findByPk(payment.id);
                    return res.json({
                        success: true,
                        transactionId: payment.transactionId,
                        status: payment.status,
                        verified: true,
                        message: 'Payment completed',
                        orderNumber: payment.orderNumber
                    });
                }

                if (!outcome.terminal) {
                    await payment.update({
                        gatewayResponse: compactDpoVerifyRaw(raw)
                    });
                    payment = await Payment.findByPk(payment.id);
                    return res.json({
                        success: true,
                        transactionId: payment.transactionId,
                        status: payment.status,
                        verified: false,
                        message: 'Payment is still processing at the gateway.',
                        orderNumber: payment.orderNumber,
                        processing: true
                    });
                }

                await applyDpoVerificationOutcome(payment, outcome, raw, 'payment verify API');
                payment = await Payment.findByPk(payment.id);
                return res.json({
                    success: true,
                    transactionId: payment.transactionId,
                    status: payment.status,
                    verified: outcome.paid,
                    message: outcome.explanation || 'Gateway verification result',
                    orderNumber: payment.orderNumber
                });
            } catch (dpoErr) {
                logger.error({ err: dpoErr }, 'DPO verify failed');
                return res.json({
                    success: true,
                    transactionId: payment.transactionId,
                    status: payment.status,
                    verified: false,
                    message: 'Could not refresh status from gateway.',
                    orderNumber: payment.orderNumber
                });
            }
        }

        // For pending payments, verify with Lenco
        if (payment.isLencoPayment) {
            try {
                // Merchant reference = payments.transactionId (QC-... we sent to Lenco).
                // /collections/status/:ref expects that value — not lencoReference (LNC-xxx).
                const merchantReference =
                    (payment.transactionId && String(payment.transactionId).trim()) || null;
                const lencoResult = await lencoService.verifyPayment(
                    payment.lencoTransactionId,
                    merchantReference
                );
                
                logger.debug(
                    {
                        status: lencoResult.status,
                        transactionId: lencoResult.transactionId
                    },
                    'Lenco verification result'
                );
                
                const newStatus = payment.mapLencoStatusToPaymentStatus(lencoResult.status);
                const updatePayload = {
                    lencoStatus: lencoResult.status,
                    status: newStatus,
                    lencoResponse: lencoResult.rawResponse || lencoResult
                };

                if (newStatus === 'completed') {
                    updatePayload.completedAt = lencoResult.completedAt
                        ? new Date(lencoResult.completedAt)
                        : new Date();
                } else if (newStatus === 'failed') {
                    updatePayload.failedAt = lencoResult.failedAt
                        ? new Date(lencoResult.failedAt)
                        : new Date();
                    updatePayload.failureReason = lencoResult.failureReason || 'Payment failed';
                }

                await Payment.update(updatePayload, { where: { id: payment.id } });
                payment = await Payment.findByPk(payment.id);

                if (['completed', 'failed'].includes(newStatus)) {
                    try {
                        await applyPaymentStatusSideEffects(payment, {
                            source: 'Lenco verification',
                            note: newStatus === 'completed'
                                ? 'Payment completed via Lenco verification'
                                : `Payment failed: ${updatePayload.failureReason || 'Payment failed'}`
                        });
                    } catch (sideEffectError) {
                        logger.error({ err: sideEffectError }, 'Payment side effects failed after verify');
                    }

                    try {
                        await sendAdminPaymentNotificationOnce(payment.id);
                    } catch (emailError) {
                        logger.error({ err: emailError }, 'Payment notification claim failed after verify');
                    }
                }

                return res.json({
                    success: true,
                    transactionId: payment.lencoTransactionId,
                    lencoTransactionId: payment.lencoTransactionId,
                    lencoReference: payment.lencoReference,
                    status: payment.status,
                    lencoStatus: payment.lencoStatus,
                    verified: true,
                    message: `Payment status: ${payment.status}`,
                    orderNumber: payment.orderNumber
                });
                
            } catch (lencoError) {
                // Handle "Collection details was not found" error gracefully
                // This happens when Lenco hasn't created the collection record yet (5-8 seconds after initiation)
                const isNotFoundError = lencoError.message?.includes('Collection details was not found') || 
                                      lencoError.message?.includes('not found') ||
                                      lencoError.code === 404 ||
                                      (lencoError.details?.data?.errorCode === '10');
                
                if (isNotFoundError) {
                    logger.debug(
                        {
                            transactionId: payment.lencoTransactionId,
                            lencoReference: payment.lencoReference,
                            currentStatus: payment.status
                        },
                        'Payment not yet available in Lenco; using database status'
                    );
                    
                    // Return current database status with special message
                    return res.json({
                        success: true,
                        transactionId: payment.lencoTransactionId || payment.transactionId,
                        lencoTransactionId: payment.lencoTransactionId,
                        lencoReference: payment.lencoReference,
                        status: payment.status,
                        lencoStatus: payment.lencoStatus || 'pending',
                        verified: false,
                        message: 'Payment is being processed. Please wait...',
                        orderNumber: payment.orderNumber,
                        processing: true // Flag to indicate still processing
                    });
                }
                
                // For other errors, log and return database status
                console.error(`[Payment Controller] Error verifying with Lenco:`, lencoError.message);
                
                return res.json({
                    success: true,
                    transactionId: payment.lencoTransactionId || payment.transactionId,
                    lencoTransactionId: payment.lencoTransactionId,
                    lencoReference: payment.lencoReference,
                    status: payment.status,
                    lencoStatus: payment.lencoStatus,
                    verified: false,
                    message: 'Using cached payment status',
                    orderNumber: payment.orderNumber
                });
            }
        }
        
        // For non-Lenco payments, return database status
            return res.json({
                success: true,
                transactionId: payment.transactionId,
                status: payment.status,
                verified: true,
            message: 'Payment verified',
            orderNumber: payment.orderNumber
            });
        
    } catch (error) {
        logger.error({ err: error }, 'verifyPayment failed');
        res.status(500).json({
            success: false,
            message: 'Failed to verify payment'
        });
    }
};

/**
 * Handle Lenco Webhook
 * Processes webhook callbacks from Lenco payment gateway
 */
exports.handleLencoWebhook = async (req, res) => {
    try {
        // Get webhook signature from headers
        // Common header names: 'x-lenco-signature', 'x-signature', 'signature'
        const signature = req.headers['x-lenco-signature'] || 
                        req.headers['x-signature'] || 
                        req.headers['signature'] ||
                        req.headers['authorization'];

        if (!signature) {
            console.error('[Payment Controller] Webhook signature missing');
            return res.status(401).json({
                success: false,
                message: 'Webhook signature missing'
            });
        }

        // Get webhook payload
        // Lenco webhook format: { status: boolean, message: string, data: object }
        const payload = req.body;
        
        // Log full payload for debugging
        // Do not log full webhook payloads (may contain customer PII).
        logger.debug(
            { webhookStatus: payload?.status, webhookMessage: payload?.message },
            'Lenco webhook received'
        );

        // Verify webhook signature.
        // In production, LENCO_WEBHOOK_SECRET is guaranteed non-empty by the startup check in app.js.
        // In development, missing secret logs a warning and skips validation to allow local testing.
        const webhookSecret = process.env.LENCO_WEBHOOK_SECRET;
        if (webhookSecret) {
            // Use req.rawBody (original bytes) so the HMAC is computed over the exact
            // bytes Lenco signed — not a re-serialised JS object.
            const isValidSignature = lencoService.validateWebhookSignature(req.rawBody || payload, signature);
            if (!isValidSignature) {
                console.error('[Payment Controller] Invalid webhook signature');
                return res.status(401).json({
                    success: false,
                    message: 'Invalid webhook signature'
                });
            }
        } else {
            console.warn('[Payment Controller] LENCO_WEBHOOK_SECRET not set — skipping signature validation (dev only)');
        }

        // Process webhook (service only parses payload, validation already done above)
        const webhookResult = await lencoService.handleWebhook(payload);

        if (!webhookResult.success) {
            // Return 200 so Lenco does not retry — parse failures are logged, not retryable
            console.error('[Payment Controller] Webhook payload parse failure:', webhookResult.error);
            return res.status(200).json({
                success: false,
                message: 'Payload error logged'
            });
        }

        const webhookData = webhookResult.data;

        // Find payment record by Lenco transaction ID (collection ID) or reference
        // Try multiple methods to find the payment
        let payment = null;
        
        // Method 1: Find by collection ID (transactionId)
        if (webhookData.transactionId) {
            payment = await Payment.findByLencoTransactionId(webhookData.transactionId);
        }
        
        // Method 2: Find by Lenco reference
        if (!payment && webhookData.lencoReference) {
            payment = await Payment.findByLencoReference(webhookData.lencoReference);
        }
        
        // Method 3: Find by your reference
        if (!payment && webhookData.reference) {
            payment = await Payment.findOne({ where: { transactionId: webhookData.reference } });
        }

        if (!payment) {
            console.error(`[Payment Controller] Payment not found for transaction ${webhookData.transactionId}`, {
                transactionId: webhookData.transactionId,
                lencoReference: webhookData.lencoReference,
                reference: webhookData.reference,
                orderNumber: webhookData.orderNumber
            });
            // Still return 200 to Lenco to prevent retries
            return res.status(200).json({
                success: false,
                message: 'Payment record not found'
            });
        }
        
        // Log payment record details for debugging
        logger.debug(
            {
                paymentId: payment.id,
                orderNumber: payment.orderNumber,
                currentStatus: payment.status,
                lencoStatus: payment.lencoStatus,
                transactionId: payment.transactionId,
                lencoTransactionId: payment.lencoTransactionId,
                webhookReceived: payment.webhookReceived
            },
            'Found payment record'
        );

        // Terminal statuses used in atomic gate below
        const terminalStatuses = ['completed', 'failed', 'cancelled', 'refunded'];

        // Use atomic findOneAndUpdate as the SINGLE idempotency gate.
        // Removing the soft pre-check above eliminates the race window where two
        // concurrent webhooks both pass the read-then-check and proceed to update.
        const newStatus = payment.mapLencoStatusToPaymentStatus(webhookData.status);
        const updatePayload = {
            webhookReceived: true,
            webhookPayload: payload,
            webhookReceivedAt: new Date(),
            lencoStatus: webhookData.status,
            status: newStatus,
            lencoResponse: webhookData.rawPayload || payload
        };

        // Add conditional fields based on webhook data
        if (webhookData.completedAt) {
            updatePayload.completedAt = new Date(webhookData.completedAt);
        }
        if (webhookData.failedAt) {
            updatePayload.failedAt = new Date(webhookData.failedAt);
            updatePayload.failureReason = webhookData.failureReason;
        }

        // Atomic update via native Sequelize — no MongoDB shim.
        // rowsAffected === 0 means another concurrent webhook already processed this record.
        const [rowsAffected] = await Payment.update(updatePayload, {
            where: {
                id: payment.id,
                webhookReceived: false,
                status: { [Op.notIn]: terminalStatuses }
            }
        });

        if (rowsAffected === 0) {
            logger.debug({ orderNumber: payment.orderNumber }, 'Webhook already processed (idempotent)');
            return res.status(200).json({
                success: true,
                message: 'Webhook already processed by another request',
                payment: {
                    orderNumber: payment.orderNumber,
                    status: payment.status,
                    transactionId: payment.transactionId
                }
            });
        }

        const updatedPayment = await Payment.findByPk(payment.id);

        // Get previous status for comparison
        const previousStatus = payment.status;
        payment = updatedPayment; // Use the updated payment document

        logger.debug(
            {
                orderNumber: payment.orderNumber,
                previousStatus,
                status: payment.status
            },
            'Payment status updated via webhook'
        );

        // Update order status based on payment status
        // Use payment.orderNumber (from payment record) instead of webhookData.orderNumber
        // because webhook might not include orderNumber in payload
        const orderNumberToUpdate = payment.orderNumber || webhookData.orderNumber;

        if (orderNumberToUpdate) {
            try {
                await applyPaymentStatusSideEffects(payment, {
                    source: 'webhook',
                    note: `Payment status updated via webhook: ${payment.status}`,
                    includeNonTerminal: true
                });
            } catch (error) {
                console.error('[Payment Controller] Error updating order status:', error);
            }
        } else {
            console.warn(`[Payment Controller] No order number found in payment record or webhook data. Payment ID: ${payment.id}`);
        }

        // Admin email after order sync; atomic notifiedAt dedupes concurrent verify (poll)
        if (payment.status === 'completed' || payment.status === 'failed') {
            try {
                await sendAdminPaymentNotificationOnce(payment.id);
            } catch (emailError) {
                logger.error({ err: emailError }, 'Payment notification claim failed after webhook');
            }
        }

        // Return 200 OK to Lenco
        res.status(200).json({
            success: true,
            message: 'Webhook processed successfully'
        });

    } catch (error) {
        console.error('[Payment Controller] Error handling webhook:', error);
        // Still return 200 to prevent Lenco from retrying
        res.status(200).json({
            success: false,
            message: error.message || 'Error processing webhook'
        });
    }
};

/**
 * Get Payment Methods
 * Returns available payment methods (Lenco-supported methods only)
 */
exports.getPaymentMethods = async (req, res) => {
    try {
        // Lenco-supported payment methods
        const paymentMethods = [
            // Mobile Money - Airtel
            {
                id: 'lenco-mobile-airtel',
                name: 'Airtel Money',
                description: 'Pay with Airtel Mobile Money',
                icon: 'fas fa-mobile-alt',
                enabled: true,
                type: 'mobile_money',
                provider: 'airtel',
                providerName: 'Airtel'
            },
            // Mobile Money - MTN
            {
                id: 'lenco-mobile-mtn',
                name: 'MTN Mobile Money',
                description: 'Pay with MTN Mobile Money',
                icon: 'fas fa-mobile-alt',
                enabled: true,
                type: 'mobile_money',
                provider: 'mtn',
                providerName: 'MTN'
            },
            // Zamtel disabled
            // Bank Transfer — hosted checkout via DPO (card / bank / mobile on gateway page)
            {
                id: 'lenco-bank-transfer',
                name: 'Bank & card (hosted)',
                description: 'Pay securely on our payment partner page (bank, card, or mobile money)',
                icon: 'fas fa-university',
                enabled: ENABLE_BANK_TRANSFER,
                type: 'bank_transfer'
            }
        ];

        res.json({
            success: true,
            methods: paymentMethods
        });
    } catch (error) {
        console.error('[Payment Controller] Error fetching payment methods:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payment methods'
        });
    }
};

/**
 * Get list of supported banks from Lenco
 * GET /api/payments/banks
 */
exports.getBanks = async (req, res) => {
    try {
        const result = await lencoService.getBanks();
        return res.json({
            success: true,
            banks: result.banks,
            count: result.count
        });
    } catch (error) {
        logger.error({ err: error }, 'getBanks failed');
        res.status(500).json({
            success: false,
            message: 'Failed to fetch banks list'
        });
    }
};

/**
 * Cancel a pending payment (e.g. user closed the payment instructions modal).
 * Local DB is updated to cancelled even if Lenco’s cancel API fails.
 */
exports.cancelPayment = async (req, res) => {
    try {
        const { transactionId } = req.params;
        if (!transactionId || !String(transactionId).trim()) {
            return res.status(400).json({ success: false, message: 'Transaction ID required' });
        }

        let payment = await Payment.findByTransactionId(transactionId);
        if (!payment) {
            payment = await Payment.findByLencoTransactionId(transactionId);
        }
        if (!payment) {
            payment = await Payment.findByLencoReference(transactionId);
        }

        if (!payment) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }

        // Ownership check — mirrors verifyPayment: layby uses plan.userId, standard uses order.userId.
        const authError = await assertLaybyPaymentVerifyAuthorized(req, payment);
        if (authError) return res.status(authError.status).json(authError.body);

        if (!payment.laybyPaymentId) {
            const admin = req.admin;
            if (!admin) {
                const order = await Order.findByOrderNumber(payment.orderNumber);
                const uid = req.session?.userId != null ? parseInt(String(req.session.userId), 10) : null;
                if (order?.userId != null && order.userId !== uid) {
                    return res.status(403).json({ success: false, message: 'Forbidden' });
                }
            }
        }

        const terminalStatuses = ['completed', 'failed', 'cancelled', 'refunded'];
        if (terminalStatuses.includes(payment.status)) {
            return res.json({
                success: true,
                message: `Payment already ${payment.status}`,
                status: payment.status,
                orderNumber: payment.orderNumber
            });
        }

        if (payment.lencoTransactionId) {
            try {
                await lencoService.cancelCollection(payment.lencoTransactionId);
            } catch (err) {
                logger.warn({ err }, 'Lenco cancel failed; marking cancelled locally anyway');
            }
        }

        await Payment.update(
            {
                status: 'cancelled',
                lencoStatus: 'cancelled',
                cancelledAt: new Date()
            },
            { where: { id: payment.id } }
        );

        if (!payment.laybyPaymentId) {
            try {
                await orderService.updateOrderStatusFromPayment(
                    payment.orderNumber,
                    'cancelled',
                    payment.lencoTransactionId,
                    'Payment cancelled by customer'
                );
            } catch (orderErr) {
                logger.error({ err: orderErr }, 'Error updating order after payment cancel');
            }
        }

        return res.json({
            success: true,
            message: 'Payment cancelled',
            orderNumber: payment.orderNumber
        });
    } catch (error) {
        logger.error({ err: error }, 'cancelPayment failed');
        res.status(500).json({
            success: false,
            message: 'Failed to cancel payment'
        });
    }
};

/**
 * Retry Failed Payment
 * Allows retrying a failed payment
 */
exports.retryPayment = async (req, res) => {
    try {
        const { orderNumber } = req.params;

        const order = await Order.findByOrderNumber(orderNumber);

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found for this payment'
            });
        }

        if (order.checkoutMode === 'layby') {
            return res.status(400).json({
                success: false,
                message: 'Layby orders: use My account → Layby to pay the next installment.'
            });
        }

        const admin = req.admin;
        const customerUserId =
            req.session && req.session.userId != null ? parseInt(String(req.session.userId), 10) : null;
        if (!admin && order.userId != null) {
            if (customerUserId == null || Number(order.userId) !== customerUserId) {
                return res.status(403).json({
                    success: false,
                    message: 'Not authorized to retry payment for this order.'
                });
            }
        }

        const priorFailedCount = await Payment.count({
            where: {
                orderNumber,
                laybyPaymentId: { [Op.is]: null },
                status: 'failed'
            }
        });

        if (priorFailedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Payment not found for this order'
            });
        }

        if (priorFailedCount > MAX_PAYMENT_RETRIES) {
            return res.status(429).json({
                success: false,
                message: `Maximum retry limit (${MAX_PAYMENT_RETRIES}) reached. Please contact support for assistance with your payment.`,
                retryCount: priorFailedCount,
                maxRetries: MAX_PAYMENT_RETRIES
            });
        }

        const existingPayment = await Payment.findOne({
            where: { orderNumber, status: 'failed', laybyPaymentId: { [Op.is]: null } },
            order: [['createdAt', 'DESC']]
        });

        if (!existingPayment) {
            return res.status(404).json({
                success: false,
                message: 'Payment not found for this order'
            });
        }

        // Prepare order data for Lenco API
        const orderData = {
            orderNumber: order.orderNumber,
            customer: order.customer,
            shipping: order.shipping,
            items: order.items,
            totals: order.totals
        };

        // Prepare customer info from payment or order
        const customerInfo = existingPayment.customerInfo || {
            name: order.customer.name,
            email: order.customer.email,
            phone: order.customer.phone
        };

        // Amount must come from the order (source of truth), not the gateway response.
        const dbAmount = Number((order.totals || {}).total) || Number(existingPayment.amount);

        let lencoResponse;
        let newPaymentRecord;

        try {
            // Retry payment based on original payment method
            if (existingPayment.paymentMethod === 'mobile_money') {
                // Validate mobile money requirements
                const customerPhone = existingPayment.customerInfo?.phone || order.customer.phone;
                const provider = existingPayment.lencoProvider;

                if (!provider || !customerPhone) {
                    return res.status(400).json({
                        success: false,
                        message: 'Cannot retry mobile money payment: provider or phone number missing'
                    });
                }

                // Initiate new mobile money payment with Lenco
                lencoResponse = await lencoService.initiateMobileMoneyPayment(
                    orderData,
                    customerPhone,
                    provider,
                    null
                );

                // Create new payment record
                const tempPayment = new Payment();
                const mappedStatus = tempPayment.mapLencoStatusToPaymentStatus(lencoResponse.status || 'pending');
                
                newPaymentRecord = await Payment.create({
                    orderNumber,
                    paymentMethod: 'mobile_money',
                    amount: dbAmount,
                    currency: lencoResponse.currency || existingPayment.currency || 'ZMW',
                    status: mappedStatus,
                    customerInfo,
                    
                    // Lenco-specific fields
                    lencoTransactionId: lencoResponse.transactionId,
                    lencoReference: lencoResponse.lencoReference,
                    lencoProvider: provider,
                    lencoStatus: lencoResponse.status,
                    lencoResponse: lencoResponse.rawResponse || lencoResponse,
                    
                    // Payment instructions
                    paymentInstructions: lencoResponse.paymentInstructions,
                    qrCode: lencoResponse.qrCode,
                    paymentUrl: lencoResponse.paymentUrl,
                    expiresAt: lencoResponse.expiresAt ? new Date(lencoResponse.expiresAt) : null,
                    
                    // Link to original payment
                    retryOf: existingPayment.id,
                    retryCount: priorFailedCount,

                    // Metadata
                    metadata: {
                        isRetry: true,
                        originalPaymentId: String(existingPayment.id),
                        originalTransactionId: existingPayment.lencoTransactionId
                    }
                });

            } else if (existingPayment.paymentMethod === 'bank_transfer') {
                const publicBase = getPublicBaseUrl();
                if (!publicBase) {
                    return res.status(500).json({
                        success: false,
                        message: 'Payment redirect URL is not configured. Please contact support.'
                    });
                }

                const { first: customerFirst, last: customerLast } = splitCustomerName(customerInfo.name);
                const redirectUrl = `${publicBase}/api/payments/dpo/success`;
                const backUrl = `${publicBase}/api/payments/dpo/cancel`;
                const amtStr = roundMoney2(dbAmount).toFixed(2);
                const serviceDesc = `Order ${orderNumber}`;

                // Create the payment record first so we have its ID for companyRef
                newPaymentRecord = await Payment.create({
                    orderNumber,
                    paymentMethod: 'bank_transfer',
                    amount: dbAmount,
                    currency: existingPayment.currency || 'ZMW',
                    status: 'pending',
                    customerInfo,
                    retryOf: existingPayment.id,
                    retryCount: priorFailedCount,
                    metadata: {
                        gateway: 'dpo',
                        isRetry: true,
                        originalPaymentId: String(existingPayment.id)
                    }
                });

                const companyRef = `QC-PAY-${newPaymentRecord.id}`;

                try {
                    const dpoResult = await dpoService.createToken({
                        amount: amtStr,
                        currency: 'ZMW',
                        companyRef,
                        redirectUrl,
                        backUrl,
                        serviceDesc,
                        customerEmail: customerInfo.email || '',
                        customerFirst,
                        customerLast
                    });

                    await newPaymentRecord.update({
                        transactionId: dpoResult.token,
                        paymentUrl: dpoResult.paymentUrl,
                        metadata: {
                            gateway: 'dpo',
                            companyRef,
                            transRef: dpoResult.transRef,
                            ptl: dpoResult.ptl,
                            ptlType: dpoResult.ptlType,
                            isRetry: true,
                            originalPaymentId: String(existingPayment.id)
                        }
                    });

                    try {
                        await orderService.updateOrderStatusFromPayment(
                            orderNumber,
                            'pending',
                            companyRef,
                            'Payment retry initiated (DPO)'
                        );
                    } catch (orderError) {
                        console.error('[Payment Controller] Error updating order status after DPO retry:', orderError);
                    }

                    return res.json({
                        success: true,
                        redirectToPaymentUrl: true,
                        transactionId: dpoResult.token,
                        reference: companyRef,
                        orderNumber,
                        paymentMethod: 'bank_transfer',
                        amount: dbAmount,
                        status: 'pending',
                        paymentUrl: dpoResult.paymentUrl,
                        message: 'Redirect to secure payment page to complete your payment.'
                    });
                } catch (dpoError) {
                    logger.error({ err: dpoError }, 'Error initiating DPO payment retry');
                    await newPaymentRecord.update({
                        status: 'failed',
                        failureReason: dpoError.message,
                        failedAt: new Date(),
                        metadata: {
                            gateway: 'dpo',
                            isRetry: true,
                            originalPaymentId: String(existingPayment.id),
                            failed: true
                        }
                    }).catch(() => {});

                    return res.status(500).json({
                        success: false,
                        message: dpoError.message || 'Failed to initiate payment retry'
                    });
                }
            } else {
                return res.status(400).json({
                    success: false,
                    message: `Payment method "${existingPayment.paymentMethod}" is not supported for retry`
                });
            }

            // Update order payment status to pending (non-fatal if this fails)
            try {
                await orderService.updateOrderStatusFromPayment(
                    orderNumber,
                    'pending',
                    newPaymentRecord.lencoTransactionId,
                    'Payment retry initiated'
                );
            } catch (orderError) {
                console.error('[Payment Controller] Error updating order status after retry:', orderError);
            }

            return res.json({
                success: true,
                message: 'Payment retry initiated successfully',
                orderNumber,
                transactionId: newPaymentRecord.lencoTransactionId,
                reference: newPaymentRecord.transactionId,
                status: newPaymentRecord.status,
                paymentMethod: newPaymentRecord.paymentMethod,
                currency: newPaymentRecord.currency,
                paymentInstructions: lencoResponse.paymentInstructions,
                qrCode: lencoResponse.qrCode,
                paymentUrl: lencoResponse.paymentUrl,
                bankAccount: lencoResponse.bankAccount,
                expiresAt: lencoResponse.expiresAt
            });
        } catch (error) {
            console.error('[Payment Controller] Error initiating payment retry:', error);

            // Create failed payment record for the retry attempt
            try {
                await Payment.create({
                    orderNumber,
                    paymentMethod: existingPayment.paymentMethod,
                    amount: existingPayment.amount,
                    currency: existingPayment.currency || 'ZMW',
                    status: 'failed',
                    customerInfo,
                    failureReason: error.message || 'Failed to initiate payment retry',
                    failedAt: new Date(),
                    retryOf: existingPayment.id,
                    retryCount: priorFailedCount,
                    metadata: {
                        isRetry: true,
                        originalPaymentId: String(existingPayment.id),
                        retryError: error.message
                    }
                });
            } catch (createError) {
                console.error('[Payment Controller] Error creating failed retry payment record:', createError);
            }

            logger.error({ err: error }, 'retryPayment inner handler failed');
            return res.status(500).json({
                success: false,
                message: 'Failed to retry payment'
            });
        }
    } catch (error) {
        console.error('[Payment Controller] Error retrying payment:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to retry payment'
        });
    }
};

/**
 * Build Sequelize where clause from filters
 */
function buildPaymentQuery(filters) {
    const { orderNumber, status, paymentMethod, provider, startDate, endDate, search } = filters;

    const where = {};

    if (search) {
        const term = `%${String(search).trim().slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`;
        const customerInfoLike = (path) =>
            sequelize.where(
                sequelize.fn(
                    'JSON_UNQUOTE',
                    sequelize.fn(
                        'JSON_EXTRACT',
                        sequelize.col('customerInfo'),
                        sequelize.literal(`'$.${path}'`)
                    )
                ),
                { [Op.like]: term }
            );

        where[Op.or] = [
            { orderNumber: { [Op.like]: term } },
            { transactionId: { [Op.like]: term } },
            { lencoTransactionId: { [Op.like]: term } },
            { lencoReference: { [Op.like]: term } },
            customerInfoLike('name'),
            customerInfoLike('email'),
            customerInfoLike('phone')
        ];
    }

    if (orderNumber)   where.orderNumber    = orderNumber;
    if (status)        where.status         = status;
    if (paymentMethod) where.paymentMethod  = paymentMethod;
    if (provider)      where.lencoProvider  = provider;

    if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt[Op.gte] = new Date(startDate);
        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            where.createdAt[Op.lte] = end;
        }
    }

    return where;
}

/**
 * Build Sequelize order array from sort parameter
 */
function buildSortObject(sort) {
    switch (sort) {
        case 'oldest':  return [['createdAt', 'ASC']];
        case 'highest': return [['amount', 'DESC']];
        case 'lowest':  return [['amount', 'ASC']];
        case 'newest':
        default:        return [['createdAt', 'DESC']];
    }
}

/**
 * Get All Payments
 * Returns all payments with filtering, sorting, and pagination
 */
exports.getAllPayments = async (req, res) => {
    try {
        const { 
            orderNumber, 
            status, 
            paymentMethod, 
            provider,
            startDate, 
            endDate, 
            sort = 'newest',
            search,
            page = 1,
            limit = 50
        } = req.query;
        
        // Build query using shared helper
        const query = buildPaymentQuery({
            orderNumber,
            status,
            paymentMethod,
            provider,
            startDate,
            endDate,
            search
        });
        
        // Build sort object using shared helper
        const sortObj = buildSortObject(sort);
        
        // Calculate pagination
        const pageNum = parseInt(page, 10) || 1;
        const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
        const skip = (pageNum - 1) * limitNum;
        
        // Execute query
        const { count: total, rows: payments } = await Payment.findAndCountAll({
            where: query,
            order: sortObj,
            offset: skip,
            limit: limitNum,
            raw: true
        });
        
        // Calculate pagination info
        const totalPages = Math.ceil(total / limitNum);
        
        res.json({
            success: true,
            payments: payments,
            pagination: {
                currentPage: pageNum,
                totalPages: totalPages,
                totalPayments: total,
                limit: limitNum,
                hasNext: pageNum < totalPages,
                hasPrev: pageNum > 1
            }
        });
    } catch (error) {
        console.error('[Payment Controller] Error fetching payments:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payments',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get Payment By ID
 * Returns a single payment by its ID
 */
exports.getPaymentById = async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!id) {
            return res.status(400).json({
                success: false,
                message: 'Payment ID is required'
            });
        }
        
        // Try to find by primary key first, then by transactionId, lencoTransactionId, or lencoReference
        let payment = await Payment.findByPk(id);
        
        if (!payment) {
            payment = await Payment.findByTransactionId(id);
        }
        
        if (!payment) {
            payment = await Payment.findByLencoTransactionId(id);
        }
        
        if (!payment) {
            payment = await Payment.findByLencoReference(id);
        }
        
        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Payment not found'
            });
        }
        
        res.json({
            success: true,
            payment: payment
        });
    } catch (error) {
        console.error('[Payment Controller] Error fetching payment:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payment',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Delete a payment row (admin). Layby installment links use ON DELETE SET NULL.
 * DELETE /api/payments/:id
 */
exports.deletePayment = async (req, res) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (!Number.isFinite(id) || id < 1) {
            return res.status(400).json({
                success: false,
                message: 'Invalid payment ID'
            });
        }

        const payment = await Payment.findByPk(id);
        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Payment not found'
            });
        }

        await payment.destroy();

        res.json({
            success: true,
            message: 'Payment deleted'
        });
    } catch (error) {
        logger.error({ err: error.message }, '[Payment Controller] deletePayment failed');
        res.status(500).json({
            success: false,
            message: 'Failed to delete payment',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Export payments to CSV or JSON
 * GET /api/payments/export
 * 
 * Query params:
 * - format: 'csv' | 'json' (default: 'csv')
 * - Same filters as GET /api/payments (orderNumber, status, paymentMethod, provider, startDate, endDate, search, sort)
 */
exports.exportPayments = async (req, res) => {
    try {
        const format = (req.query.format || 'csv').toLowerCase();
        const {
            orderNumber,
            status,
            paymentMethod,
            provider,
            startDate,
            endDate,
            search,
            sort = 'newest'
        } = req.query;

        // Validate format
        if (format !== 'csv' && format !== 'json') {
            return res.status(400).json({
                success: false,
                message: 'Invalid format. Must be: csv or json.'
            });
        }

        // Build query using shared helper (same as getAllPayments)
        const query = buildPaymentQuery({
            orderNumber,
            status,
            paymentMethod,
            provider,
            startDate,
            endDate,
            search
        });
        
        // Build sort object using shared helper
        const sortObj = buildSortObject(sort);
        
        // Get all payments for export (no pagination limit, max 10,000)
        const payments = await Payment.findAll({
            where: query,
            order: sortObj,
            limit: 10000,
            raw: true
        });

        if (payments.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No payments to export'
            });
        }

        const exportUtils = require('../utils/export.utils');
        const exportDate = new Date().toISOString().split('T')[0];

        if (format === 'json') {
            // Export as JSON
            const exportData = exportUtils.generateJSON(
                payments.map(payment => ({
                    _id: payment.id,
                    orderNumber: payment.orderNumber,
                    transactionId: payment.transactionId,
                    lencoTransactionId: payment.lencoTransactionId,
                    lencoReference: payment.lencoReference,
                    amount: payment.amount,
                    currency: payment.currency,
                    paymentMethod: payment.paymentMethod,
                    lencoProvider: payment.lencoProvider,
                    status: payment.status,
                    lencoStatus: payment.lencoStatus,
                    customerInfo: payment.customerInfo,
                    paymentInstructions: payment.paymentInstructions,
                    completedAt: payment.completedAt,
                    failedAt: payment.failedAt,
                    cancelledAt: payment.cancelledAt,
                    retryOf: payment.retryOf,
                    retryCount: payment.retryCount,
                    createdAt: payment.createdAt,
                    updatedAt: payment.updatedAt
                })),
                {
                    statistics: {
                        totalPayments: payments.length,
                        totalAmount: payments.reduce((sum, p) => sum + (p.amount || 0), 0),
                        byStatus: payments.reduce((acc, p) => {
                            acc[p.status] = (acc[p.status] || 0) + 1;
                            return acc;
                        }, {}),
                        byPaymentMethod: payments.reduce((acc, p) => {
                            acc[p.paymentMethod] = (acc[p.paymentMethod] || 0) + 1;
                            return acc;
                        }, {})
                    },
                    filters: {
                        orderNumber: orderNumber || null,
                        status: status || null,
                        paymentMethod: paymentMethod || null,
                        provider: provider || null,
                        startDate: startDate || null,
                        endDate: endDate || null,
                        search: search || null,
                        sort: sort
                    }
                }
            );

            exportUtils.setExportHeaders(res, format, `payments_export_${exportDate}.json`);
            res.json(exportData);
        } else {
            // Export as CSV
            const headers = [
                'Order Number',
                'Transaction ID',
                'Lenco Transaction ID',
                'Lenco Reference',
                'Amount',
                'Currency',
                'Payment Method',
                'Provider',
                'Status',
                'Lenco Status',
                'Customer Name',
                'Customer Email',
                'Customer Phone',
                'Payment Date',
                'Completed At',
                'Failed At',
                'Retry Count'
            ];

            // Statistics rows
            const totalAmount = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
            const statsRows = [
                ['Export Date', exportDate],
                ['Total Payments', payments.length],
                ['Total Amount', `K${exportUtils.formatCurrency(totalAmount)}`],
                [''], // Empty row
                ['Statistics by Status'],
                ...Object.entries(payments.reduce((acc, p) => {
                    acc[p.status] = (acc[p.status] || 0) + 1;
                    return acc;
                }, {})).map(([status, count]) => [status, count]),
                [''], // Empty row
                ['Statistics by Payment Method'],
                ...Object.entries(payments.reduce((acc, p) => {
                    acc[p.paymentMethod] = (acc[p.paymentMethod] || 0) + 1;
                    return acc;
                }, {})).map(([method, count]) => [method, count]),
                [''] // Empty row before headers
            ];

            // Convert payments to CSV rows
            const paymentRows = payments.map(payment => [
                payment.orderNumber || '',
                payment.transactionId || '',
                payment.lencoTransactionId || '',
                payment.lencoReference || '',
                payment.amount || 0,
                payment.currency || 'ZMW',
                payment.paymentMethod || '',
                payment.lencoProvider || '',
                payment.status || '',
                payment.lencoStatus || '',
                payment.customerInfo?.name || '',
                payment.customerInfo?.email || '',
                payment.customerInfo?.phone || '',
                exportUtils.formatDate(payment.createdAt, true),
                payment.completedAt ? exportUtils.formatDate(payment.completedAt, true) : '',
                payment.failedAt ? exportUtils.formatDate(payment.failedAt, true) : '',
                payment.retryCount || 0
            ]);

            const csvContent = exportUtils.generateCSV(headers, paymentRows, statsRows);

            exportUtils.setExportHeaders(res, format, `payments_export_${exportDate}.csv`);
            res.send(csvContent);
        }
    } catch (error) {
        console.error('[Payment Controller] Error exporting payments:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export payments data'
        });
    }
};
