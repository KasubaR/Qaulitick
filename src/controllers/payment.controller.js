// Payment Controller
const Payment = require('../models/Payment.model');
const Order = require('../models/Order.model');
const lencoService = require('../services/lenco.service');
const redisStore = require('../utils/redis.store');
const orderService = require('../services/order.service');

// Redis cache keys
const BANKS_CACHE_KEY = 'lenco:banks:cache';
const BANKS_LOCK_KEY = 'lenco:banks:lock';
const BANKS_CACHE_TTL_SECONDS = 86400; // 24 hours in seconds
const LOCK_TTL_SECONDS = 30; // Lock expires after 30 seconds (prevents deadlock)
const LOCK_RETRY_DELAY_MS = 100; // Wait 100ms before retrying cache read
const MAX_LOCK_RETRIES = 10; // Maximum retries before giving up

// Payment retry limit (configurable via environment variable)
const MAX_PAYMENT_RETRIES = parseInt(process.env.MAX_PAYMENT_RETRIES || '3', 10);

// Feature flags for payment methods (configurable via environment variables)
const ENABLE_BANK_TRANSFER = process.env.ENABLE_BANK_TRANSFER === 'true' || process.env.ENABLE_BANK_TRANSFER === '1';

/**
 * Process Payment
 * Handles payment initiation for Lenco payment methods (mobile money and bank transfer)
 */
exports.processPayment = async (req, res) => {
    try {
        const {
            orderNumber,
            paymentMethod,
            amount,
            customerInfo,
            // Lenco-specific fields
            provider, // For mobile money: 'airtel', 'mtn'
            customerPhone, // For mobile money: phone number
            bankDetails // For bank transfer: { bankName, accountNumber, accountName }
        } = req.body;

        // Validate required fields
        if (!orderNumber || !paymentMethod || !customerInfo) {
            return res.status(400).json({
                success: false,
                message: 'Missing required payment information'
            });
        }

        // SECURITY: Always fetch order from database to get authoritative amount
        // Never trust amount from request body - prevents payment manipulation attacks
        const order = await Order.findByOrderNumber(orderNumber);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found. Cannot process payment for non-existent order.'
            });
        }

        // Use authoritative amount from database order
        const authoritativeAmount = order.totals.total;
        
        // Log warning if client-provided amount differs (for security monitoring)
        if (req.body.amount && Math.abs(req.body.amount - authoritativeAmount) > 0.01) {
            console.warn(`[Payment Controller] Amount mismatch for order ${orderNumber}: client sent ${req.body.amount}, database has ${authoritativeAmount}`);
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

        // Use order data from database (authoritative source)
        // Convert Mongoose document to plain object for Lenco service
        const orderData = order.toObject ? order.toObject() : order;

        let lencoResponse;
        let paymentRecord;

        // Handle Mobile Money Payment
        if (paymentMethod === 'mobile_money') {
            // Validate mobile money requirements
            if (!provider || !customerPhone) {
                return res.status(400).json({
                    success: false,
                    message: 'Mobile money payment requires provider (airtel or mtn) and customer phone number'
                });
            }

            if (!['airtel', 'mtn'].includes(provider.toLowerCase())) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid mobile money provider. Must be: airtel or mtn'
                });
            }

            try {
                // Initiate mobile money payment with Lenco
                lencoResponse = await lencoService.initiateMobileMoneyPayment(
                    orderData,
                    customerPhone,
                    provider.toLowerCase()
                );

                // Create payment record with Lenco collection data
                // Map Lenco status to payment status
                const tempPayment = new Payment();
                const mappedStatus = tempPayment.mapLencoStatusToPaymentStatus(lencoResponse.status || 'pending');
                
                paymentRecord = await Payment.create({
                    orderNumber,
                    paymentMethod: 'mobile_money',
                    amount: authoritativeAmount, // Use authoritative amount from database order
                    currency: lencoResponse.currency || 'ZMW',
                    status: mappedStatus, // Mapped from lencoStatus
                    customerInfo,
                    
                    // Lenco-specific fields
                    lencoTransactionId: lencoResponse.transactionId,      // Collection ID (col_xxx)
                    lencoReference: lencoResponse.lencoReference,        // Lenco's reference (LNC-xxx)
                    lencoProvider: provider.toLowerCase(),
                    lencoStatus: lencoResponse.status,                   // 'pay-offline', 'pending', etc.
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
                        mobileMoneyDetails: lencoResponse.mobileMoneyDetails
                    }
                });

                console.log(`[Payment Controller] Mobile money payment initiated for order ${orderNumber} via ${provider}`);

            } catch (error) {
                console.error('[Payment Controller] Error initiating mobile money payment:', error);
                
                // Create failed payment record
                paymentRecord = await Payment.create({
                    orderNumber,
                    paymentMethod: 'mobile_money',
                    amount: authoritativeAmount, // Use authoritative amount from database order
                    currency: 'ZMW',
                    status: 'failed',
                    customerInfo,
                    lencoProvider: provider.toLowerCase(),
                    failureReason: error.message,
                    failedAt: new Date(),
                    metadata: {
                        provider: provider.toLowerCase(),
                        customerPhone: customerPhone
                    }
                });

                return res.status(500).json({
                    success: false,
                    message: error.message || 'Failed to initiate mobile money payment',
                    orderNumber,
                    paymentMethod,
                    amount: authoritativeAmount, // Use authoritative amount from database order
                    status: 'failed'
                });
            }
        }
        // Bank Transfer Payment - DISABLED FOR NOW (Will be enabled in future update)
        /*
        else if (paymentMethod === 'bank_transfer') {
            // Validate bank transfer requirements
            if (!bankDetails || !bankDetails.bankName) {
                return res.status(400).json({
                    success: false,
                    message: 'Bank transfer payment requires bank details (bankName)'
                });
            }

            try {
                // Initiate bank transfer with Lenco
                lencoResponse = await lencoService.initiateBankTransfer(
                    orderData,
                    bankDetails
                );

                // Create payment record with Lenco collection data
                // Map Lenco status to payment status
                const tempPayment = new Payment();
                const mappedStatus = tempPayment.mapLencoStatusToPaymentStatus(lencoResponse.status || 'pending');
                
                paymentRecord = await Payment.create({
                    orderNumber,
                    paymentMethod: 'bank_transfer',
                    amount: lencoResponse.amount || amount,
                    currency: lencoResponse.currency || 'ZMW',
                    status: mappedStatus, // Mapped from lencoStatus
                    customerInfo,
                    
                    // Lenco-specific fields
                    lencoTransactionId: lencoResponse.transactionId,      // Collection ID (col_xxx)
                    lencoReference: lencoResponse.lencoReference,        // Lenco's reference (LNC-xxx)
                    lencoStatus: lencoResponse.status,                   // 'pay-offline', 'pending', etc.
                    lencoResponse: lencoResponse.rawResponse || lencoResponse,
                    
                    // Your reference (QC-ORD-xxx)
                    transactionId: lencoResponse.reference,
                    
                    // Payment instructions for customer
                    paymentInstructions: lencoResponse.paymentInstructions,
                    
                    // Bank transfer details
                    bankDetails: {
                        bankName: bankDetails.bankName,
                        accountNumber: bankDetails.accountNumber || null,
                        accountName: bankDetails.accountName || customerInfo.name
                    },
                    expiresAt: lencoResponse.expiresAt ? new Date(lencoResponse.expiresAt) : null,
                    metadata: {
                        bankName: bankDetails.bankName,
                        initiatedAt: lencoResponse.initiatedAt,
                        bankAccountDetails: lencoResponse.bankAccountDetails
                    }
                });

                console.log(`[Payment Controller] Bank transfer payment initiated for order ${orderNumber} via ${bankDetails.bankName}`);

            } catch (error) {
                console.error('[Payment Controller] Error initiating bank transfer:', error);
                
                // Create failed payment record
                paymentRecord = await Payment.create({
                    orderNumber,
                    paymentMethod: 'bank_transfer',
                    amount,
                    currency: 'ZMW',
                    status: 'failed',
                    customerInfo,
                    bankDetails: {
                        bankName: bankDetails.bankName,
                        accountNumber: bankDetails.accountNumber || null,
                        accountName: bankDetails.accountName || customerInfo.name
                    },
                    failureReason: error.message,
                    failedAt: new Date(),
                    metadata: {
                        bankName: bankDetails.bankName
                    }
                });

                return res.status(500).json({
                    success: false,
                    message: error.message || 'Failed to initiate bank transfer',
                    orderNumber,
                    paymentMethod,
                    amount,
                    status: 'failed'
                });
            }
        }
        */

        // Return payment instructions to frontend
        res.json({
            success: true,
            transactionId: lencoResponse.transactionId,
            reference: lencoResponse.reference,
            orderNumber,
            paymentMethod,
            amount: authoritativeAmount, // Use authoritative amount from database order
            status: 'pending',
            paymentInstructions: lencoResponse.paymentInstructions,
            qrCode: lencoResponse.qrCode,
            paymentUrl: lencoResponse.paymentUrl,
            bankAccount: lencoResponse.bankAccount,
            expiresAt: lencoResponse.expiresAt,
            message: 'Payment initiated successfully. Please complete the payment using the instructions provided.'
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
 * Verify Payment Status
 * Queries Lenco API to verify current payment status
 * Handles "Collection details was not found" error gracefully when Lenco hasn't created collection yet
 */
exports.verifyPayment = async (req, res) => {
    try {
        const { transactionId } = req.params;
        
        console.log(`[Payment Controller] Verifying payment: ${transactionId}`);

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
            console.log(`[Payment Controller] Payment not found in database: ${transactionId}`);
            return res.status(404).json({
                success: false,
                message: 'Payment not found'
            });
        }

        console.log(`[Payment Controller] Found payment in database:`, {
            transactionId: payment.lencoTransactionId,
            reference: payment.lencoReference,
            currentStatus: payment.status,
            lencoStatus: payment.lencoStatus
        });
        
        // If payment is already completed or failed, return current status
        if (payment.status === 'completed' || payment.status === 'failed') {
            console.log(`[Payment Controller] Payment already finalized: ${payment.status}`);
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
        
        // For pending payments, verify with Lenco
        if (payment.isLencoPayment) {
            try {
                // Use lencoReference (recommended) or lencoTransactionId
                const lencoResult = await lencoService.verifyPayment(
                    payment.lencoTransactionId,
                    payment.lencoReference
                );
                
                console.log(`[Payment Controller] Lenco verification result:`, {
                    status: lencoResult.status,
                    transactionId: lencoResult.transactionId
                });
                
                // Update payment status based on Lenco response
                payment.lencoStatus = lencoResult.status;
                payment.status = payment.mapLencoStatusToPaymentStatus(lencoResult.status);
                payment.lencoResponse = lencoResult.rawResponse || lencoResult;
                
                // Store previous status for notification check
                const previousPaymentStatus = payment.status;
                
                // Update order status if payment completed or failed
                if (lencoResult.status === 'successful' || lencoResult.status === 'completed') {
                    payment.completedAt = lencoResult.completedAt ? new Date(lencoResult.completedAt) : new Date();
                    
                    // Update order status
                    try {
                        await orderService.updateOrderStatusFromPayment(
                            payment.orderNumber,
                            'completed',
                            payment.lencoTransactionId,
                            'Payment completed via Lenco verification'
                        );
                        console.log(`[Payment Controller] Order ${payment.orderNumber} status updated to 'paid'`);
                    } catch (orderError) {
                        console.error(`[Payment Controller] Error updating order status:`, orderError);
                        // Don't fail verification if order update fails
                    }
                    
                    // Send payment notification if status changed
                    if (previousPaymentStatus !== 'completed') {
                        try {
                            const emailService = require('../services/email.service');
                            const paymentObj = payment.toObject ? payment.toObject() : payment;
                            await emailService.sendPaymentNotificationToAdmin(paymentObj);
                        } catch (emailError) {
                            console.error('[Payment Controller] Error sending payment notification:', emailError);
                            // Continue even if email fails
                        }
                    }
                } else if (lencoResult.status === 'failed') {
                    payment.failedAt = lencoResult.failedAt ? new Date(lencoResult.failedAt) : new Date();
                    payment.failureReason = lencoResult.failureReason || 'Payment failed';
                    
                    // Update order status
                    try {
                        await orderService.updateOrderStatusFromPayment(
                            payment.orderNumber,
                            'failed',
                            payment.lencoTransactionId,
                            `Payment failed: ${payment.failureReason}`
                        );
                        console.log(`[Payment Controller] Order ${payment.orderNumber} status updated to 'payment_failed'`);
                    } catch (orderError) {
                        console.error(`[Payment Controller] Error updating order status:`, orderError);
                        // Don't fail verification if order update fails
                    }
                    
                    // Send payment notification if status changed
                    if (previousPaymentStatus !== 'failed') {
                        try {
                            const emailService = require('../services/email.service');
                            const paymentObj = payment.toObject ? payment.toObject() : payment;
                            await emailService.sendPaymentNotificationToAdmin(paymentObj);
                        } catch (emailError) {
                            console.error('[Payment Controller] Error sending payment notification:', emailError);
                            // Continue even if email fails
                        }
                    }
                }
                
                // Save payment after all updates
                await payment.save();

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
                    console.log(`[Payment Controller] Payment not yet available in Lenco (still processing). Using database status.`, {
                        transactionId: payment.lencoTransactionId,
                        lencoReference: payment.lencoReference,
                        currentStatus: payment.status
                    });
                    
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
        console.error('[Payment Controller] Error verifying payment:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to verify payment'
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
        console.log('[Payment Controller] Webhook payload:', JSON.stringify(payload, null, 2));

        // Verify webhook signature (skip if webhook secret not configured for development)
        // This is the single point of signature validation - service only parses payload
        const webhookSecret = process.env.LENCO_WEBHOOK_SECRET;
        
        if (webhookSecret && webhookSecret !== 'xxxxxxxxxxxxxxxxxxxxxxx') {
            const isValidSignature = lencoService.validateWebhookSignature(payload, signature);
            
            if (!isValidSignature) {
                console.error('[Payment Controller] Invalid webhook signature');
                // In development, log but don't block (for testing)
                if (process.env.NODE_ENV === 'production') {
                    return res.status(401).json({
                        success: false,
                        message: 'Invalid webhook signature'
                    });
                } else {
                    console.warn('[Payment Controller] Signature validation failed, but continuing in development mode');
                }
            }
        } else {
            console.warn('[Payment Controller] Webhook secret not configured, skipping signature validation');
        }

        // Process webhook (service only parses payload, validation already done above)
        const webhookResult = await lencoService.handleWebhook(payload);

        if (!webhookResult.success) {
            console.error('[Payment Controller] Webhook processing failed:', webhookResult.error);
            return res.status(400).json({
                success: false,
                message: webhookResult.error || 'Failed to process webhook'
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
            payment = await Payment.findOne({ transactionId: webhookData.reference });
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
        console.log(`[Payment Controller] Found payment record:`, {
            paymentId: payment._id,
            orderNumber: payment.orderNumber,
            currentStatus: payment.status,
            lencoStatus: payment.lencoStatus,
            transactionId: payment.transactionId,
            lencoTransactionId: payment.lencoTransactionId,
            webhookReceived: payment.webhookReceived
        });

        // Idempotency check: If webhook already received and payment is in terminal state, skip processing
        const terminalStatuses = ['completed', 'failed', 'cancelled', 'refunded'];
        const isTerminalStatus = terminalStatuses.includes(payment.status);
        
        if (payment.webhookReceived && isTerminalStatus) {
            console.log(`[Payment Controller] Webhook already processed for payment ${payment.orderNumber} with terminal status ${payment.status}. Returning 200 (idempotent).`);
            return res.status(200).json({
                success: true,
                message: 'Webhook already processed',
                payment: {
                    orderNumber: payment.orderNumber,
                    status: payment.status,
                    transactionId: payment.transactionId
                }
            });
        }

        // Use atomic findOneAndUpdate to prevent race conditions
        // Only update if webhook not received OR status is not terminal
        // This ensures only one webhook processing happens even with concurrent requests
        const newStatus = payment.mapLencoStatusToPaymentStatus(webhookData.status);
        const updateData = {
            $set: {
                webhookReceived: true,
                webhookPayload: payload,
                webhookReceivedAt: new Date(),
                lencoStatus: webhookData.status,
                status: newStatus,
                lencoResponse: webhookData.rawPayload || payload
            },
            $setOnInsert: {
                // These fields are only set if document is being inserted (shouldn't happen, but safety)
            }
        };

        // Add conditional fields based on webhook data
        if (webhookData.completedAt) {
            updateData.$set.completedAt = new Date(webhookData.completedAt);
        }
        if (webhookData.failedAt) {
            updateData.$set.failedAt = new Date(webhookData.failedAt);
            updateData.$set.failureReason = webhookData.failureReason;
        }

        // Atomic update: only succeeds if webhook not received OR status is not terminal
        const updatedPayment = await Payment.findOneAndUpdate(
            {
                _id: payment._id,
                $or: [
                    { webhookReceived: false },
                    { status: { $nin: terminalStatuses } }
                ]
            },
            updateData,
            {
                new: true, // Return updated document
                runValidators: true
            }
        );

        // If update returned null, another process already processed this webhook
        if (!updatedPayment) {
            console.log(`[Payment Controller] Webhook already processed by another request for payment ${payment.orderNumber}. Returning 200 (idempotent).`);
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

        // Get previous status for comparison
        const previousStatus = payment.status;
        payment = updatedPayment; // Use the updated payment document

        console.log(`[Payment Controller] Payment ${payment.orderNumber} status updated from ${previousStatus} to ${payment.status} via webhook`);
        
        // Send payment notification if status changed to completed or failed
        if (previousStatus !== payment.status && (payment.status === 'completed' || payment.status === 'failed')) {
            try {
                const emailService = require('../services/email.service');
                const paymentObj = payment.toObject ? payment.toObject() : payment;
                await emailService.sendPaymentNotificationToAdmin(paymentObj);
            } catch (emailError) {
                console.error('[Payment Controller] Error sending payment notification:', emailError);
                // Continue even if email fails - don't block webhook processing
            }
        }

        // Update order status based on payment status
        // Use payment.orderNumber (from payment record) instead of webhookData.orderNumber
        // because webhook might not include orderNumber in payload
        const orderNumberToUpdate = payment.orderNumber || webhookData.orderNumber;
        
        if (orderNumberToUpdate) {
            try {
                // Map payment status to order payment status
                // payment.status is already mapped (completed, failed, etc.)
                // We need to pass the correct status to updateOrderStatusFromPayment
                let paymentStatusForOrder = payment.status;
                
                // If payment is completed, order should be marked as paid
                if (payment.status === 'completed') {
                    paymentStatusForOrder = 'completed';
                } else if (payment.status === 'failed') {
                    paymentStatusForOrder = 'failed';
                } else if (payment.status === 'pending') {
                    paymentStatusForOrder = 'pending';
                }
                
                // Update order status from payment webhook
                const updatedOrder = await orderService.updateOrderStatusFromPayment(
                    orderNumberToUpdate,
                    paymentStatusForOrder, // Payment status for order update
                    webhookData.transactionId || payment.lencoTransactionId, // Transaction ID
                    `Payment status updated via webhook: ${payment.status}` // Notes
                );
                
                if (updatedOrder) {
                    console.log(`[Payment Controller] Order ${orderNumberToUpdate} status updated successfully from "${updatedOrder.status}" (payment: "${updatedOrder.paymentStatus}")`);
                } else {
                    console.warn(`[Payment Controller] Order ${orderNumberToUpdate} not found for status update`);
                }
            } catch (error) {
                console.error('[Payment Controller] Error updating order status:', error);
                // Don't fail webhook if order update fails - log error but continue
            }
        } else {
            console.warn(`[Payment Controller] No order number found in payment record or webhook data. Payment ID: ${payment._id}`);
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
            // Bank Transfer (feature flag controlled)
            {
                id: 'lenco-bank-transfer',
                name: 'Bank Transfer',
                description: 'Direct bank transfer',
                icon: 'fas fa-university',
                enabled: ENABLE_BANK_TRANSFER, // Controlled by ENABLE_BANK_TRANSFER feature flag
                type: 'bank_transfer',
                supportedBanks: [
                    { id: 'zanaco', name: 'Zanaco' },
                    { id: 'stanbic', name: 'Stanbic Bank' },
                    { id: 'fnb', name: 'First National Bank' },
                    { id: 'barclays', name: 'Barclays Bank' },
                    { id: 'standard-chartered', name: 'Standard Chartered' },
                    { id: 'other', name: 'Other' }
                ]
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
 * Get list of supported banks from Lenco (with caching)
 * GET /api/payments/banks
 */
exports.getBanks = async (req, res) => {
    try {
        // Try to get cached data from Redis
        const cachedData = await redisStore.get(BANKS_CACHE_KEY);
        
        if (cachedData && cachedData.banks) {
            return res.json({
                success: true,
                banks: cachedData.banks,
                count: cachedData.banks.length,
                cached: true
            });
        }
        
        // Cache miss - acquire distributed lock to prevent thundering herd
        const lockAcquired = await redisStore.acquireLock(BANKS_LOCK_KEY, LOCK_TTL_SECONDS);
        
        if (lockAcquired) {
            try {
                // Double-check cache after acquiring lock (another process might have populated it)
                const doubleCheckCache = await redisStore.get(BANKS_CACHE_KEY);
                if (doubleCheckCache && doubleCheckCache.banks) {
                    await redisStore.releaseLock(BANKS_LOCK_KEY);
                    return res.json({
                        success: true,
                        banks: doubleCheckCache.banks,
                        count: doubleCheckCache.banks.length,
                cached: true
            });
        }
        
        // Fetch from Lenco API
        const result = await lencoService.getBanks();
        
                // Store in Redis cache with 24-hour expiration
                await redisStore.set(BANKS_CACHE_KEY, {
                    banks: result.banks,
                    count: result.count,
                    cachedAt: Date.now()
                }, BANKS_CACHE_TTL_SECONDS * 1000); // Convert to milliseconds for redisStore.set
                
                // Release lock
                await redisStore.releaseLock(BANKS_LOCK_KEY);
                
                return res.json({
            success: true,
            banks: result.banks,
            count: result.count,
            cached: false
        });
            } catch (error) {
                // Release lock on error
                await redisStore.releaseLock(BANKS_LOCK_KEY);
                throw error;
            }
        } else {
            // Lock not acquired - another process is fetching, wait and retry cache read
            let retries = 0;
            while (retries < MAX_LOCK_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
                
                const retryCache = await redisStore.get(BANKS_CACHE_KEY);
                if (retryCache && retryCache.banks) {
                    return res.json({
                        success: true,
                        banks: retryCache.banks,
                        count: retryCache.banks.length,
                        cached: true
                    });
                }
                
                retries++;
            }
            
            // If still no cache after retries, fetch directly (lock might have expired)
            console.warn('[Payment Controller] Lock retry failed, fetching banks directly');
            const result = await lencoService.getBanks();
            
            // Try to cache it (might fail if another process is caching, but that's okay)
            try {
                await redisStore.set(BANKS_CACHE_KEY, {
                    banks: result.banks,
                    count: result.count,
                    cachedAt: Date.now()
                }, BANKS_CACHE_TTL_SECONDS * 1000);
            } catch (cacheError) {
                console.warn('[Payment Controller] Failed to cache banks:', cacheError.message);
            }
            
            return res.json({
                success: true,
                banks: result.banks,
                count: result.count,
                cached: false
            });
        }
    } catch (error) {
        console.error('Error fetching banks:', error);
        
        // Try to return cached data even if expired, as fallback
        try {
            const fallbackCache = await redisStore.get(BANKS_CACHE_KEY);
            if (fallbackCache && fallbackCache.banks) {
            return res.json({
                success: true,
                    banks: fallbackCache.banks,
                    count: fallbackCache.banks.length,
                cached: true,
                warning: 'Using cached data due to API error'
            });
            }
        } catch (cacheError) {
            console.error('[Payment Controller] Error reading fallback cache:', cacheError.message);
        }
        
        // If no cache and API fails, return error
        res.status(500).json({
            success: false,
            message: 'Failed to fetch banks list',
            error: error.message
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
        
        // Find existing payment
        const existingPayment = await Payment.findByOrderNumber(orderNumber);
        
        if (!existingPayment) {
            return res.status(404).json({
                success: false,
                message: 'Payment not found for this order'
            });
        }

        if (existingPayment.status !== 'failed') {
            return res.status(400).json({
                success: false,
                message: 'Only failed payments can be retried'
            });
        }

        // Check retry limit to prevent abuse
        const currentRetryCount = existingPayment.retryCount || 0;
        if (currentRetryCount >= MAX_PAYMENT_RETRIES) {
            return res.status(429).json({
                success: false,
                message: `Maximum retry limit (${MAX_PAYMENT_RETRIES}) reached. Please contact support for assistance with your payment.`,
                retryCount: currentRetryCount,
                maxRetries: MAX_PAYMENT_RETRIES
            });
        }

        // Get order data for retry
        const Order = require('../models/Order.model');
        const order = await Order.findByOrderNumber(orderNumber);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found for this payment'
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
                    provider
                );

                // Create new payment record
                const tempPayment = new Payment();
                const mappedStatus = tempPayment.mapLencoStatusToPaymentStatus(lencoResponse.status || 'pending');
                
                newPaymentRecord = await Payment.create({
                    orderNumber,
                    paymentMethod: 'mobile_money',
                    amount: lencoResponse.amount || existingPayment.amount,
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
                    retryOf: existingPayment._id,
                    retryCount: (existingPayment.retryCount || 0) + 1,
                    
                    // Metadata
                    metadata: {
                        isRetry: true,
                        originalPaymentId: existingPayment._id.toString(),
                        originalTransactionId: existingPayment.lencoTransactionId
                    }
                });

            } else if (existingPayment.paymentMethod === 'bank_transfer') {
                // Get bank details from existing payment or order
                const bankDetails = existingPayment.bankDetails || {
                    bankName: 'Standard Chartered Bank', // Default if not specified
                    accountName: customerInfo.name
                };

                // Initiate new bank transfer payment with Lenco
                lencoResponse = await lencoService.initiateBankTransfer(
                    orderData,
                    bankDetails
                );

                // Create new payment record
                const tempPayment = new Payment();
                const mappedStatus = tempPayment.mapLencoStatusToPaymentStatus(lencoResponse.status || 'pending');
                
                newPaymentRecord = await Payment.create({
                    orderNumber,
                    paymentMethod: 'bank_transfer',
                    amount: lencoResponse.amount || existingPayment.amount,
                    currency: lencoResponse.currency || existingPayment.currency || 'ZMW',
                    status: mappedStatus,
                    customerInfo,
                    bankDetails: {
                        bankName: bankDetails.bankName,
                        accountNumber: bankDetails.accountNumber || null,
                        accountName: bankDetails.accountName || customerInfo.name
                    },
                    
                    // Lenco-specific fields
                    lencoTransactionId: lencoResponse.transactionId,
                    lencoReference: lencoResponse.lencoReference,
                    lencoStatus: lencoResponse.status,
                    lencoResponse: lencoResponse.rawResponse || lencoResponse,
                    
                    // Payment instructions
                    paymentInstructions: lencoResponse.paymentInstructions,
                    paymentUrl: lencoResponse.paymentUrl,
                    bankAccount: lencoResponse.bankAccount,
                    expiresAt: lencoResponse.expiresAt ? new Date(lencoResponse.expiresAt) : null,
                    
                    // Link to original payment
                    retryOf: existingPayment._id,
                    retryCount: (existingPayment.retryCount || 0) + 1,
                    
                    // Metadata
                    metadata: {
                        isRetry: true,
                        originalPaymentId: existingPayment._id.toString(),
                        originalTransactionId: existingPayment.lencoTransactionId
                    }
                });
            } else {
                return res.status(400).json({
                    success: false,
                    message: `Payment method "${existingPayment.paymentMethod}" is not supported for retry`
                });
            }

            // Update order payment status to pending
            try {
                await orderService.updateOrderStatusFromPayment(
                    orderNumber,
                    'pending',
                    newPaymentRecord.lencoTransactionId,
                    'Payment retry initiated'
                );
            } catch (orderError) {
                console.error('[Payment Controller] Error updating order status after retry:', orderError);
                // Continue even if order update fails
            }
        
        res.json({
            success: true,
                message: 'Payment retry initiated successfully',
                payment: newPaymentRecord,
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
                    retryOf: existingPayment._id,
                    retryCount: (existingPayment.retryCount || 0) + 1,
                    metadata: {
                        isRetry: true,
                        originalPaymentId: existingPayment._id.toString(),
                        retryError: error.message
                    }
                });
            } catch (createError) {
                console.error('[Payment Controller] Error creating failed retry payment record:', createError);
            }
            
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to retry payment'
            });
        }
    } catch (error) {
        console.error('[Payment Controller] Error retrying payment:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retry payment'
        });
    }
};

/**
 * Build Sequelize where clause from filters
 */
function buildPaymentQuery(filters) {
    const { Op } = require('sequelize');
    const { orderNumber, status, paymentMethod, provider, startDate, endDate, search } = filters;

    const where = {};

    if (search) {
        where[Op.or] = [
            { orderNumber:         { [Op.like]: `%${search}%` } },
            { transactionId:       { [Op.like]: `%${search}%` } },
            { lencoTransactionId:  { [Op.like]: `%${search}%` } },
            { lencoReference:      { [Op.like]: `%${search}%` } }
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
        const limitNum = parseInt(limit, 10) || 50;
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
