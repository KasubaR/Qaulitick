// Order Controller
const emailService = require('../services/email.service');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { sequelize } = require('../config/mysql');
const Order = require('../models/Order.model');
const Payment = require('../models/Payment.model');
const Product = require('../models/Product.model');
const User = require('../models/User.model');
const LaybyPlan = require('../models/LaybyPlan.model');
const LaybyPayment = require('../models/LaybyPayment.model');
const orderService = require('../services/order.service');
const dpoService = require('../services/dpo.service');
const {
    compactDpoVerifyRaw,
    applyDpoVerificationOutcome
} = require('../services/dpoPaymentOutcome.service');
const logger = require('../utils/logger').child({ module: 'OrderController' });
const { getSellableUnitsForLine } = require('../utils/stock.utils');
/** Admin order list filters — must match `Order` model ENUMs */
const ORDER_LIST_STATUSES = [
    'pending', 'payment_pending', 'paid', 'confirmed', 'processing', 'packed',
    'shipped', 'delivered', 'cancelled', 'payment_failed', 'returned'
];
const ORDER_LIST_PAYMENT_STATUSES = ['pending', 'processing', 'completed', 'failed', 'refunded'];
const ORDER_LIST_PAYMENT_METHODS = ['mobile_money', 'bank_transfer', 'card', 'cash_on_delivery'];

function firstQueryString(val) {
    if (val == null || val === '') return null;
    const v = Array.isArray(val) ? val[0] : val;
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t === '' ? null : t;
}

/** Max length for admin order `search` / `email` LIKE terms (limits JSON_EXTRACT + LIKE cost). */
const ORDER_LIST_LIKE_MAX_LEN = 100;

/**
 * Trim, cap length, strip a few problematic characters, escape LIKE metacharacters for bound %…% patterns.
 */
function normalizeOrderListLikeTerm(raw) {
    if (raw == null || typeof raw !== 'string') return null;
    let s = raw.trim().slice(0, ORDER_LIST_LIKE_MAX_LEN);
    if (!s) return null;
    s = s.replace(/[<>'"]/g, '');
    if (!s) return null;
    return s.replace(/[%_\\]/g, '\\$&');
}

// Delivery fee in ZMW. Configurable via env; set to 0 for free shipping.
const DELIVERY_FEE_ZMW = parseFloat(process.env.DELIVERY_FEE_ZMW ?? '0') || 0;

/**
 * Calculate delivery fee server-side.
 * Never trust the client-supplied totals.delivery value.
 */
function calculateDeliveryFee(shipping) {
    if (shipping && (shipping.pickup === true || shipping.pickup === 'true')) return 0;
    return DELIVERY_FEE_ZMW;
}

/**
 * Helper function to enrich order with payment status from Payment model
 * This ensures orders.ejs uses the same payment status source as payments.ejs
 */
async function enrichOrderWithPaymentStatus(order) {
    const orderObj = order.toJSON();
    
    // Find payment for this order (Payment model is source of truth)
    const payment = await Payment.findLatestPaymentByOrderNumber(orderObj.orderNumber);
    
    // Use payment status from Payment model if available
    if (payment) {
        orderObj.paymentStatus = payment.status; // Use Payment model status (source of truth)
        orderObj.paymentTransactionId = payment.transactionId || payment.lencoTransactionId;
        orderObj.paymentLencoStatus = payment.lencoStatus;
        orderObj.paymentCompletedAt = payment.completedAt;
        orderObj.paymentFailedAt = payment.failedAt;
    }
    
    return orderObj;
}

// Create a new order
exports.createOrder = async (req, res) => {
    try {
        const { validateOrder, sanitizeObject } = require('../utils/validators');
        
        // Debug-level request metadata (never log raw req.body to avoid PII leakage)
        const incomingItemCount = Array.isArray(req.body?.items) ? req.body.items.length : 0;
        logger.debug({ incomingItemCount }, 'Incoming order request');
        
        // Sanitize input
        const sanitizedBody = sanitizeObject(req.body);
        const {
            customer,
            shipping,
            paymentMethod,
            items,
            totals,
            coupon,
            checkoutMode: rawCheckoutMode,
            laybyDepositPercent: rawLaybyDepositPercent
        } = sanitizedBody;

        const checkoutMode = rawCheckoutMode === 'layby' ? 'layby' : 'standard';
        
        // Debug-level log (no request body / no customer PII)
        logger.debug({ sanitizedItemCount: Array.isArray(items) ? items.length : 0 }, 'Order items after sanitization');

        // Validate order data using validator
        const validation = validateOrder(sanitizedBody);
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        // Additional validation: Ensure items exists and is an array
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Items are required and must be a non-empty array',
                errors: ['At least one item is required in the order']
            });
        }

        const { getSellingUnitPrice, calculateSubtotal, calculateTotal } = require('../utils/price.utils');

        // Coupon codes are not yet implemented — reject loudly so the client knows.
        if (coupon && coupon.code) {
            return res.status(400).json({
                success: false,
                message: 'Coupon codes are not supported yet.'
            });
        }

        // Wrap ALL DB operations — reads, stock decrements, and order creation — in a
        // single transaction so any failure rolls back every write atomically.
        const order = await sequelize.transaction(async (t) => {
            // Read product rows inside the transaction for a consistent snapshot.
            // Using Product.findByPk directly so we can pass { transaction: t }.
            const validatedItems = await Promise.all(items.map(async (item) => {
                const productId = item.id || item.productId;
                if (!productId) {
                    throw new Error('Product ID is required for item');
                }

                const product = await Product.findByPk(parseInt(productId, 10), { transaction: t });
                if (!product) {
                    throw new Error(`Product ${productId} not found`);
                }

                const productObj = product.toJSON();
                const requestedQuantity = Math.max(1, parseInt(item.quantity) || 1);
                const selectedColor = item.variant?.color || item.color || null;
                const sellable = getSellableUnitsForLine(productObj, selectedColor);

                if (sellable < requestedQuantity) {
                    const err = new Error(
                        `Insufficient stock for "${productObj.model}". Available: ${sellable}, Requested: ${requestedQuantity}`
                    );
                    err.statusCode = 409;
                    err.productInfo = { id: productObj.id, brand: productObj.brand, model: productObj.model, sku: productObj.sku, stock: sellable };
                    throw err;
                }

                // Server-side price — ignore whatever the client sent.
                const serverPrice = getSellingUnitPrice(productObj);
                const originalPrice = Number(productObj.originalPrice) > serverPrice ? Number(productObj.originalPrice) : serverPrice;
                const discount = productObj.discount || 0;

                const clientPrice = parseFloat(item.price) || 0;
                if (Math.abs(clientPrice - serverPrice) > 0.01) {
                    logger.warn(
                        { productId, clientPrice, serverPrice },
                        'Price mismatch for order item'
                    );
                }

                return {
                    id: item.id || String(productObj.id),
                    name: item.name || productObj.model,
                    price: serverPrice,
                    originalPrice: originalPrice,
                    discount: discount,
                    quantity: requestedQuantity,
                    image: item.image || (productObj.images && productObj.images[0]) || null,
                    productId: String(productObj.id),
                    sku: productObj.sku || null,
                    stock: productObj.stock,
                    gender: productObj.gender || '',
                    selectedColor: item.variant?.color || item.color || null,
                    variant: item.variant || null
                };
            }));

            // Recalculate totals server-side — never trust financial values from the client.
            const subtotal = calculateSubtotal(validatedItems);
            const deliveryFee = calculateDeliveryFee(shipping);
            const couponDiscount = 0;
            const total = calculateTotal(subtotal, couponDiscount, deliveryFee);

            const loggedUserId = req.session && req.session.userId ? parseInt(req.session.userId, 10) : null;

            if (checkoutMode === 'layby') {
                if (!loggedUserId) {
                    const err = new Error('Sign in with a verified email to use layby.');
                    err.statusCode = 403;
                    throw err;
                }
                const user = await User.findByPk(loggedUserId, { transaction: t });
                if (!user || !user.emailVerifiedAt) {
                    const err = new Error('Verify your email to use layby at checkout.');
                    err.statusCode = 403;
                    throw err;
                }
            }

            const orderData = {
                orderNumber: `TEMP-${crypto.randomUUID()}`, // replaced immediately below
                userId: loggedUserId,
                checkoutMode,
                customer: {
                    name: customer.name,
                    phone: customer.phone,
                    email: customer.email,
                    createAccount: customer.createAccount || false
                },
                shipping: {
                    address: shipping.address,
                    city: shipping.city,
                    province: shipping.province,
                    instructions: shipping.instructions || '',
                    pickup: shipping.pickup || false
                },
                paymentMethod,
                items: validatedItems,
                totals: {
                    subtotal: subtotal,
                    discount: couponDiscount,
                    delivery: deliveryFee,
                    total: total
                },
                coupon: coupon || null,
                status: 'pending',
                paymentStatus: 'pending',
                history: [{
                    status: 'pending',
                    paymentStatus: 'pending',
                    notes: 'Order created',
                    updatedBy: 'system',
                    updatedAt: new Date().toISOString(),
                    source: 'order_creation'
                }],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            // Colour variants: always enforce per-shade availability against `colors[].stock`.
            // Standard checkout: decrement that JSON now; top-level `stock` is reduced when payment
            // completes (order.service updateOrderStatusFromPayment).
            // Layby: the reservation loop below decrements top-level `stock` only — do not also
            // mutate `colors` here or units are reserved twice (JSON shade + global).
            for (const item of validatedItems) {
                if (!item.selectedColor) continue;

                const freshProduct = await Product.findByPk(parseInt(item.productId, 10), { transaction: t });
                const colorEntry = (freshProduct.colors || []).find(c => c.name === item.selectedColor);
                const colorStock = colorEntry ? (Number(colorEntry.stock) || 0) : 0;

                if (colorStock < item.quantity) {
                    const err = new Error(
                        `Insufficient stock for "${item.name}" in color "${item.selectedColor}". Available: ${colorStock}, Requested: ${item.quantity}`
                    );
                    err.statusCode = 409;
                    throw err;
                }

                if (checkoutMode === 'layby') {
                    continue;
                }

                const updatedColors = (freshProduct.colors || []).map(c =>
                    c.name === item.selectedColor
                        ? { ...c, stock: Math.max(0, (c.stock || 0) - item.quantity) }
                        : c
                );
                await Product.update(
                    { colors: updatedColors },
                    { where: { id: parseInt(item.productId, 10) }, transaction: t }
                );
            }

            const created = await Order.create(orderData, { transaction: t });
            const _d = new Date(created.createdAt || Date.now());
            const _date = String(_d.getDate()).padStart(2, '0') + String(_d.getMonth() + 1).padStart(2, '0') + _d.getFullYear();
            const orderNumber = `ORD-${_date}-${String(created.id).padStart(6, '0')}`;
            await created.update({ orderNumber }, { transaction: t });

            if (checkoutMode === 'layby') {
                const laybyService = require('../services/layby.service');
                await laybyService.createLaybyPlanAndPayments({
                    order: created,
                    userId: loggedUserId,
                    depositPercentInput: rawLaybyDepositPercent,
                    transaction: t
                });
            }

            // Reserve top-level stock at order creation for ALL order types.
            // This closes the race window where two customers could both pass the
            // availability check and create orders for the last unit simultaneously.
            // The UPDATE is atomic: `WHERE stock >= qty` ensures only one concurrent
            // request wins when stock is exactly 1.
            for (const item of validatedItems) {
                const qty = parseInt(item.quantity) || 1;
                const [reservedRows] = await Product.update(
                    { stock: sequelize.literal(`stock - ${qty}`) },
                    {
                        where: {
                            id: parseInt(item.productId, 10),
                            stock: { [Op.gte]: qty }
                        },
                        transaction: t
                    }
                );
                if (reservedRows === 0) {
                    const err = new Error(
                        `"${item.name}" just sold out — please remove it from your cart`
                    );
                    err.statusCode = 409;
                    throw err;
                }
            }

            return created;
        });

        const orderNumber = order.orderNumber;
        logger.info({ orderNumber, checkoutMode }, 'Order created');
        logger.debug({ orderNumber }, 'Stock validation passed for all items');

        let laybyPaymentId = null;
        let laybyFirstAmount = null;
        if (checkoutMode === 'layby') {
            const plan = await LaybyPlan.findOne({ where: { orderId: order.id } });
            if (plan) {
                const first = await LaybyPayment.findOne({
                    where: { laybyPlanId: plan.id, sequence: 1 }
                });
                if (first) {
                    laybyPaymentId = first.id;
                    laybyFirstAmount = Number(first.amount);
                }
            }
        }

        // Send new order notification to admin (if enabled)
        try {
            const orderObj = order.toJSON();
            await emailService.sendOrderNotificationToAdmin(orderObj);
        } catch (emailError) {
            logger.error({ err: emailError }, 'Error sending new order notification');
            // Continue even if email fails - don't block order creation
        }

        res.json({
            success: true,
            orderNumber: order.orderNumber,
            checkoutMode: order.checkoutMode,
            status: order.status,
            paymentStatus: order.paymentStatus,
            laybyPaymentId,
            laybyFirstAmount,
            message: 'Order created successfully'
        });
    } catch (error) {
        logger.error({ err: error }, 'Error creating order');

        if (error.statusCode === 409) {
            if (error.productInfo) {
                emailService.sendLowStockNotificationToAdmin(error.productInfo).catch(() => {});
            }
            return res.status(409).json({
                success: false,
                message: error.message
            });
        }

        if (error.statusCode === 403) {
            return res.status(403).json({
                success: false,
                message: error.message
            });
        }

        const errorMessage = error.message || 'Failed to create order. Please try again.';
        res.status(500).json({
            success: false,
            message: errorMessage,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get order by order number
exports.getOrderByNumber = async (req, res) => {
    try {
        const { orderNumber } = req.params;
        
        // Query database using Order model
        const order = await Order.findByOrderNumber(orderNumber);

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        const isAdmin = !!req.admin;
        const loggedUserId =
            req.session?.userId != null && req.session.userId !== ''
                ? parseInt(String(req.session.userId), 10)
                : null;
        const sessionUserId = Number.isNaN(loggedUserId) ? null : loggedUserId;
        const rawOwnerId = order.userId != null ? parseInt(String(order.userId), 10) : null;
        const ownerUserId = Number.isNaN(rawOwnerId) ? null : rawOwnerId;

        if (!isAdmin && ownerUserId !== sessionUserId) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        // Enrich order with payment status from Payment model (source of truth)
        // This ensures orders.ejs shows the same payment status as payments.ejs
        const enrichedOrder = await enrichOrderWithPaymentStatus(order);

        res.json({
            success: true,
            order: enrichedOrder
        });
    } catch (error) {
        logger.error({ err: error }, 'Error fetching order');
        res.status(500).json({
            success: false,
            message: 'Failed to fetch order'
        });
    }
};

// Get all orders (paginated, filtered)
exports.getAllOrders = async (req, res) => {
    try {
        const {
            email, status, paymentStatus, paymentMethod,
            startDate, endDate, sort, search, updatedSince,
            page = 1, limit: rawLimit = 50
        } = req.query;

        const pageNum  = Math.max(1, parseInt(page, 10)  || 1);
        const pageSize = Math.min(200, Math.max(1, parseInt(rawLimit, 10) || 50));
        const offset   = (pageNum - 1) * pageSize;

        const statusF = firstQueryString(status);
        const paymentStatusF = firstQueryString(paymentStatus);
        const paymentMethodF = firstQueryString(paymentMethod);
        const searchRaw = firstQueryString(search);
        const emailRaw = firstQueryString(email);

        if (statusF && !ORDER_LIST_STATUSES.includes(statusF)) {
            return res.status(400).json({ success: false, message: 'Invalid status filter' });
        }
        if (paymentStatusF && !ORDER_LIST_PAYMENT_STATUSES.includes(paymentStatusF)) {
            return res.status(400).json({ success: false, message: 'Invalid paymentStatus filter' });
        }
        if (paymentMethodF && !ORDER_LIST_PAYMENT_METHODS.includes(paymentMethodF)) {
            return res.status(400).json({ success: false, message: 'Invalid paymentMethod filter' });
        }

        const searchLike = normalizeOrderListLikeTerm(searchRaw);
        const emailLike = normalizeOrderListLikeTerm(emailRaw);

        let orderClause;
        if (sort === 'oldest') {
            orderClause = [['createdAt', 'ASC']];
        } else if (sort === 'highest_value') {
            orderClause = [[sequelize.fn('JSON_EXTRACT', sequelize.col('totals'), '$.total'), 'DESC']];
        } else if (sort === 'lowest_value') {
            orderClause = [[sequelize.fn('JSON_EXTRACT', sequelize.col('totals'), '$.total'), 'ASC']];
        } else {
            orderClause = [['createdAt', 'DESC']]; // default: newest
        }

        // Build WHERE clause from query params
        const where = {};

        if (statusF) where.status = statusF;
        if (paymentStatusF) where.paymentStatus = paymentStatusF;
        if (paymentMethodF) where.paymentMethod = paymentMethodF;

        if (updatedSince) {
            const since = new Date(updatedSince);
            if (!isNaN(since)) where.updatedAt = { [Op.gte]: since };
        }

        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) {
                const d = new Date(startDate);
                if (!isNaN(d)) where.createdAt[Op.gte] = d;
            }
            if (endDate) {
                const d = new Date(endDate);
                if (!isNaN(d)) where.createdAt[Op.lte] = d;
            }
        }

        // Text search: orderNumber or customer email/name/phone (JSON — must JSON_UNQUOTE for LIKE in MySQL)
        const jsonCustomerLike = (path, term) =>
            sequelize.where(
                sequelize.fn(
                    'JSON_UNQUOTE',
                    sequelize.fn(
                        'JSON_EXTRACT',
                        sequelize.col('customer'),
                        sequelize.literal(`'$.${path}'`)
                    )
                ),
                { [Op.like]: `%${term}%` }
            );

        const searchClauses = [];
        if (searchLike) {
            searchClauses.push({ orderNumber: { [Op.like]: `%${searchLike}%` } });
            searchClauses.push(jsonCustomerLike('email', searchLike));
            searchClauses.push(jsonCustomerLike('name', searchLike));
            searchClauses.push(jsonCustomerLike('phone', searchLike));
        }
        if (emailLike) {
            searchClauses.push(jsonCustomerLike('email', emailLike));
        }
        if (searchClauses.length) {
            where[Op.or] = searchClauses;
        }

        // Single paginated query + total count (two queries, both use the same WHERE)
        const { count: total, rows: orders } = await Order.findAndCountAll({
            where,
            order: orderClause,
            limit: pageSize,
            offset
        });

        // Batch-load payments for this page in one query — avoids N+1.
        // Oldest-first so `new Map([[orderNumber, p], ...])` ends with the newest row per order
        // (same as Payment.findLatestPaymentByOrderNumber: createdAt DESC).
        const orderNumbers = orders.map(o => o.orderNumber);
        const payments = orderNumbers.length
            ? await Payment.findAll({
                where: { orderNumber: { [Op.in]: orderNumbers } },
                order: [
                    ['createdAt', 'ASC'],
                    ['id', 'ASC']
                ]
            })
            : [];
        const paymentByOrder = new Map(payments.map(p => [p.orderNumber, p]));

        // Merge payment data onto each order (same enrichment as enrichOrderWithPaymentStatus)
        const enriched = orders.map(order => {
            const orderObj = order.toJSON();
            const payment  = paymentByOrder.get(orderObj.orderNumber);
            if (payment) {
                orderObj.paymentStatus        = payment.status;
                orderObj.paymentTransactionId = payment.transactionId || payment.lencoTransactionId;
                orderObj.paymentLencoStatus   = payment.lencoStatus;
                orderObj.paymentCompletedAt   = payment.completedAt;
                orderObj.paymentFailedAt      = payment.failedAt;
            }
            return orderObj;
        });

        res.json({
            success: true,
            orders: enriched,
            count: enriched.length,
            total,
            page: pageNum,
            pages: Math.ceil(total / pageSize)
        });
    } catch (error) {
        logger.error({ err: error }, 'Error fetching orders');
        res.status(500).json({
            success: false,
            message: 'Failed to fetch orders'
        });
    }
};

// Update order status
exports.updateOrderStatus = async (req, res) => {
    try {
        const { orderNumber } = req.params;
        const { status, notes } = req.body;

        const validStatuses = ['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status'
            });
        }

        // Update order status using Order model
        const order = await Order.updateStatus(orderNumber, status, notes, 'admin');
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        logger.info({ orderNumber, status }, 'Order status updated');

        if (status === 'confirmed') {
            emailService.sendOrderConfirmationEmail(order.toJSON()).catch(err =>
                logger.error({ err, orderNumber }, 'Failed to send order confirmation email')
            );
        }

        res.json({
            success: true,
            order: order.toJSON(),
            message: 'Order status updated'
        });
    } catch (error) {
        logger.error({ err: error }, 'Error updating order status');
        res.status(500).json({
            success: false,
            message: 'Failed to update order status'
        });
    }
};

// Dispatch order — mark as shipped, save tracking info, email customer
exports.dispatchOrder = async (req, res) => {
    try {
        const { orderNumber } = req.params;
        const { courier, trackingNumber, note } = req.body;

        let dispatched = false;
        await sequelize.transaction(async (t) => {
            const order = await Order.findOne({
                where: { orderNumber },
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            if (!order) return;

            const history = Array.isArray(order.history) ? [...order.history] : [];
            history.push({
                status: 'shipped',
                notes: 'Order dispatched by admin',
                updatedBy: req.admin?.email || 'admin',
                updatedAt: new Date().toISOString()
            });

            await order.update(
                {
                    courier,
                    trackingNumber,
                    shippingNote: note,
                    status: 'shipped',
                    history
                },
                { transaction: t }
            );
            dispatched = true;
        });

        if (!dispatched) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Send dispatch email to customer (non-blocking)
        const emailService = require('../services/email.service');
        const fresh = await Order.findByOrderNumber(orderNumber);
        const customer = typeof fresh.customer === 'string' ? JSON.parse(fresh.customer) : (fresh.customer || {});
        emailService.sendDispatchEmail({
            order: { ...fresh.toJSON(), customer },
            courier,
            trackingNumber,
            note
        }).catch(err => logger.error({ err }, 'Dispatch email failed'));

        res.json({ success: true, message: 'Order dispatched successfully' });
    } catch (error) {
        logger.error({ err: error }, 'Error dispatching order');
        res.status(500).json({ success: false, message: 'Failed to dispatch order' });
    }
};

// Update tracking information
exports.updateTracking = async (req, res) => {
    try {
        const { orderNumber } = req.params;
        const { trackingNumber, courier, shippingNote } = req.body;

        // Update tracking using Order model
        const order = await Order.findByOrderNumber(orderNumber);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        await order.update({ trackingNumber, courier, shippingNote });
        
        res.json({
            success: true,
            order: order.toJSON(),
            message: 'Tracking information updated'
        });
    } catch (error) {
        logger.error({ err: error }, 'Error updating tracking');
        res.status(500).json({
            success: false,
            message: 'Failed to update tracking information'
        });
    }
};

// Add order note
exports.addOrderNote = async (req, res) => {
    try {
        const { orderNumber } = req.params;
        const { note } = req.body;
        
        // Add note using Order model
        const order = await Order.findByOrderNumber(orderNumber);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        await order.addNote(note, req.admin?.email || 'admin');
        
        res.json({
            success: true,
            order: order.toJSON(),
            message: 'Note added successfully'
        });
    } catch (error) {
        logger.error({ err: error }, 'Error adding order note');
        res.status(500).json({
            success: false,
            message: 'Failed to add note'
        });
    }
};

/**
 * Update Order Status Based on Payment Status
 * Called from payment webhook handler to update order when payment status changes
 * 
 * This is a wrapper that delegates to orderService to avoid circular dependencies.
 * The actual implementation is in order.service.js
 * 
 * @param {string} orderNumber - Order number
 * @param {string} paymentStatus - Payment status from Lenco (pending, processing, completed, failed, cancelled)
 * @param {string} transactionId - Payment transaction ID (optional)
 * @param {string} notes - Additional notes (optional)
 * @returns {Promise<object|null>} Updated order or null if not found
 */
exports.updateOrderStatusFromPayment = async function(orderNumber, paymentStatus, transactionId = null, notes = '') {
    return orderService.updateOrderStatusFromPayment(orderNumber, paymentStatus, transactionId, notes);
};

/**
 * Verify Payment for Order
 * Verifies payment status for an order and updates order status accordingly
 * 
 * @param {string} orderNumber - Order number to verify payment for
 * @returns {Promise<object>} Verification result with payment and order status
 */
exports.verifyOrderPayment = async (req, res) => {
    try {
        const { orderNumber } = req.params;
        
        if (!orderNumber) {
            return res.status(400).json({
                success: false,
                message: 'Order number is required'
            });
        }

        // Find order
        const order = await Order.findByOrderNumber(orderNumber);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Find payment record for this order
        const Payment = require('../models/Payment.model');
        let payment = await Payment.findLatestPaymentByOrderNumber(orderNumber);
        
        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Payment record not found for this order',
                order: {
                    orderNumber: order.orderNumber,
                    status: order.status,
                    paymentStatus: order.paymentStatus
                }
            });
        }

        // Gateway verification (Lenco mobile money or DPO bank_transfer)
        let verified = false;
        let verificationError = null;

        const payMeta = payment.metadata || {};

        if (payMeta.gateway === 'dpo' && payment.paymentMethod === 'bank_transfer') {
            try {
                const dpoResult = await dpoService.verifyToken(payment.transactionId);
                const { outcome, raw } = dpoResult;

                if (outcome.paid) {
                    await applyDpoVerificationOutcome(payment, outcome, raw, 'order verify-payment');
                } else if (!outcome.terminal) {
                    await payment.update({ gatewayResponse: compactDpoVerifyRaw(raw) });
                } else {
                    await applyDpoVerificationOutcome(payment, outcome, raw, 'order verify-payment');
                }

                payment = await Payment.findByPk(payment.id);
                verified = true;

                logger.info({ orderNumber, paymentStatus: payment.status }, 'DPO payment verified');
            } catch (error) {
                logger.error({ err: error }, 'Error verifying payment with DPO');
                verificationError = error.message;
            }
        } else if (payment.lencoTransactionId || payment.lencoReference) {
            try {
                const lencoService = require('../services/lenco.service');

                const merchantReference =
                    (payment.transactionId && String(payment.transactionId).trim()) || null;
                const verificationResult = await lencoService.verifyPayment(
                    payment.lencoTransactionId,
                    merchantReference
                );

                const previousPaymentStatus = payment.status;
                payment.lencoStatus = verificationResult.status;
                payment.status = payment.mapLencoStatusToPaymentStatus(verificationResult.status);
                payment.lencoResponse = verificationResult.rawResponse || verificationResult;

                if (verificationResult.completedAt) {
                    payment.completedAt = new Date(verificationResult.completedAt);
                }
                if (verificationResult.failedAt) {
                    payment.failedAt = new Date(verificationResult.failedAt);
                    payment.failureReason = verificationResult.failureReason;
                }

                await payment.save();
                verified = true;

                logger.info(
                    {
                        orderNumber,
                        previousPaymentStatus,
                        paymentStatus: payment.status
                    },
                    'Payment verified'
                );
            } catch (error) {
                logger.error({ err: error }, 'Error verifying payment with Lenco');
                verificationError = error.message;
            }
        } else {
            verified = true;
        }

        // Update order status based on payment status
        const previousOrderStatus = order.status;
        const previousOrderPaymentStatus = order.paymentStatus;
        
        const updatedOrder = await orderService.updateOrderStatusFromPayment(
            orderNumber,
            payment.status,
            payment.transactionId || payment.lencoTransactionId,
            verified ? 'Payment verified successfully' : 'Payment verification attempted (gateway verification failed, using database status)'
        );

        if (!updatedOrder) {
            logger.warn({ orderNumber }, 'Failed to update order status for payment verification');
        }

        // Return verification result
        res.json({
            success: true,
            verified: verified,
            verificationError: verificationError,
            order: {
                orderNumber: updatedOrder ? updatedOrder.orderNumber : order.orderNumber,
                status: updatedOrder ? updatedOrder.status : order.status,
                previousStatus: previousOrderStatus,
                paymentStatus: updatedOrder ? updatedOrder.paymentStatus : order.paymentStatus,
                previousPaymentStatus: previousOrderPaymentStatus
            },
            payment: {
                transactionId: payment.transactionId || payment.lencoTransactionId,
                status: payment.status,
                lencoStatus: payment.lencoStatus,
                paymentMethod: payment.paymentMethod,
                amount: payment.amount,
                currency: payment.currency
            },
            message: verified 
                ? 'Payment verified successfully' 
                : 'Payment record found, but gateway verification failed. Using database status.'
        });

    } catch (error) {
        logger.error({ err: error }, 'Error verifying order payment');
        res.status(500).json({
            success: false,
            message: 'Failed to verify order payment'
        });
    }
};

/**
 * Generate Invoice PDF
 * Generates and returns a PDF invoice for an order
 */
exports.generateInvoice = async (req, res) => {
    try {
        const { orderNumber } = req.params;
        
        if (!orderNumber) {
            return res.status(400).json({
                success: false,
                message: 'Order number is required'
            });
        }

        // Find order
        const order = await Order.findByOrderNumber(orderNumber);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Generate PDF invoice
        const invoiceService = require('../services/invoice.service');
        const pdfBuffer = await invoiceService.generateInvoicePDF(order);

        // Set response headers for PDF download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Invoice-${orderNumber}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);

        // Send PDF
        res.send(pdfBuffer);

        logger.info({ orderNumber }, 'Invoice generated');
    } catch (error) {
        logger.error({ err: error }, 'Error generating invoice');
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to generate invoice'
        });
    }
};

/**
 * Send Invoice Email
 * Generates invoice PDF and sends it to customer via email
 */
/**
 * Delete Order
 * Permanently removes the order from the database
 */
exports.deleteOrder = async (req, res) => {
    try {
        const { orderNumber } = req.params;
        
        if (!orderNumber) {
            return res.status(400).json({
                success: false,
                message: 'Order number is required'
            });
        }
        
        // Use Order model's delete method (soft delete)
        const order = await Order.delete(orderNumber);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        logger.info({ orderNumber }, 'Order deleted (soft delete)');
        
        res.json({
            success: true,
            message: 'Order deleted successfully',
            order: order.toJSON()
        });
    } catch (error) {
        logger.error({ err: error }, 'Error deleting order');
        res.status(500).json({
            success: false,
            message: 'Failed to delete order',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Delete Multiple Orders (Bulk Delete)
 * Deletes multiple orders by their order numbers
 */
exports.deleteOrders = async (req, res) => {
    try {
        const { orderNumbers } = req.body;
        
        if (!orderNumbers || !Array.isArray(orderNumbers) || orderNumbers.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Order numbers array is required'
            });
        }
        
        const results = {
            deleted: [],
            notFound: [],
            errors: []
        };
        
        // Delete each order
        for (const orderNumber of orderNumbers) {
            try {
                const order = await Order.delete(orderNumber);
                if (order) {
                    results.deleted.push(orderNumber);
                } else {
                    results.notFound.push(orderNumber);
                }
            } catch (error) {
                logger.error({ err: error, orderNumber }, 'Error deleting order in bulk delete');
                results.errors.push({ orderNumber, error: error.message });
            }
        }
        
        logger.info(
            {
                deletedCount: results.deleted.length,
                notFoundCount: results.notFound.length,
                errorCount: results.errors.length
            },
            'Bulk delete completed'
        );
        
        res.json({
            success: true,
            message: `Deleted ${results.deleted.length} order(s)`,
            results: results
        });
    } catch (error) {
        logger.error({ err: error }, 'Error in bulk delete');
        res.status(500).json({
            success: false,
            message: 'Failed to delete orders',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.sendInvoiceEmail = async (req, res) => {
    try {
        const { orderNumber } = req.params;
        const { cc, bcc } = req.body; // Optional CC and BCC recipients
        
        if (!orderNumber) {
            return res.status(400).json({
                success: false,
                message: 'Order number is required'
            });
        }

        // Find order
        const order = await Order.findByOrderNumber(orderNumber);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Validate customer email
        if (!order.customer.email) {
            return res.status(400).json({
                success: false,
                message: 'Customer email is required to send invoice'
            });
        }

        // Generate PDF invoice
        const invoiceService = require('../services/invoice.service');
        const pdfBuffer = await invoiceService.generateInvoicePDF(order);

        // Send email with PDF attachment
        const emailResult = await emailService.sendInvoiceEmail(order, pdfBuffer, { cc, bcc });

        if (!emailResult.success) {
            return res.status(500).json({
                success: false,
                message: emailResult.error || 'Failed to send invoice email'
            });
        }

        // Do not log customer email addresses in production logs (PII).
        logger.info({ orderNumber, messageId: emailResult.messageId }, 'Invoice email sent');

        res.json({
            success: true,
            message: 'Invoice email sent successfully',
            recipient: order.customer.email,
            messageId: emailResult.messageId
        });
    } catch (error) {
        logger.error({ err: error }, 'Error sending invoice email');
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to send invoice email'
        });
    }
};

/**
 * Export orders to CSV or JSON
 * GET /api/admin/orders/export
 * 
 * Query params:
 * - format: 'csv' | 'json' (default: 'csv')
 * - Same filters as GET /api/admin/orders
 */
exports.exportOrders = async (req, res) => {
    try {
        const format = (req.query.format || 'csv').toLowerCase();
        const {
            email,
            status,
            paymentStatus,
            paymentMethod,
            startDate,
            endDate,
            search,
            sort
        } = req.query;

        // Validate format
        if (format !== 'csv' && format !== 'json') {
            return res.status(400).json({
                success: false,
                message: 'Invalid format. Must be: csv or json.'
            });
        }

        // Build filters object
        const filters = {
            email: email || undefined,
            status: status || undefined,
            paymentStatus: paymentStatus || undefined,
            paymentMethod: paymentMethod || undefined,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            search: search?.trim() || undefined,
            sort: sort || 'newest'
        };

        // Remove undefined values
        Object.keys(filters).forEach(key => {
            if (filters[key] === undefined) {
                delete filters[key];
            }
        });

        // Get orders for export (hard cap enforced in service)
        const orderService = require('../services/order.service');
        const orders = await orderService.getOrdersForExport(filters, { limit: orderService.MAX_EXPORT_ROWS });

        if (orders.length === orderService.MAX_EXPORT_ROWS) {
            res.setHeader('X-Export-Truncated', 'true');
        }

        if (orders.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No orders to export'
            });
        }

        const exportDate = new Date().toISOString().split('T')[0];
        const exportTime = new Date().toISOString();

        if (format === 'json') {
            // Export as JSON
            const exportData = {
                exportDate: exportDate,
                exportTime: exportTime,
                statistics: {
                    totalOrders: orders.length,
                    totalValue: orders.reduce((sum, order) => sum + (order.totals?.total || 0), 0),
                    byStatus: orders.reduce((acc, order) => {
                        acc[order.status] = (acc[order.status] || 0) + 1;
                        return acc;
                    }, {}),
                    byPaymentStatus: orders.reduce((acc, order) => {
                        acc[order.paymentStatus] = (acc[order.paymentStatus] || 0) + 1;
                        return acc;
                    }, {})
                },
                filters: filters,
                orders: orders.map(order => ({
                    orderNumber: order.orderNumber,
                    orderDate: order.createdAt,
                    customer: {
                        name: order.customer.name,
                        email: order.customer.email,
                        phone: order.customer.phone
                    },
                    shipping: {
                        address: order.shipping?.address || '',
                        city: order.shipping?.city || '',
                        province: order.shipping?.province || '',
                        pickup: order.shipping?.pickup || false
                    },
                    items: order.items.map(item => ({
                        name: item.name,
                        quantity: item.quantity,
                        price: item.price,
                        total: item.price * item.quantity
                    })),
                    totals: {
                        subtotal: order.totals?.subtotal || 0,
                        discount: order.totals?.discount || 0,
                        delivery: order.totals?.delivery || 0,
                        total: order.totals?.total || 0
                    },
                    paymentMethod: order.paymentMethod,
                    paymentStatus: order.paymentStatus,
                    status: order.status,
                    trackingNumber: order.trackingNumber || '',
                    courier: order.courier || '',
                    transactionId: order.paymentTransactionId || order.transactionId || ''
                }))
            };

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="orders_export_${exportDate}.json"`);
            res.json(exportData);
        } else {
            // Export as CSV
            const escapeCsvCell = (cell) => {
                if (cell === null || cell === undefined) return '';
                const str = String(cell);
                // Escape quotes and wrap in quotes if contains comma, newline, or quote
                if (str.includes(',') || str.includes('\n') || str.includes('"')) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
            };

            // CSV Headers
            const headers = [
                'Order Number',
                'Order Date',
                'Customer Name',
                'Customer Email',
                'Customer Phone',
                'Shipping Address',
                'City',
                'Province',
                'Pickup',
                'Items (Name x Qty)',
                'Subtotal',
                'Discount',
                'Delivery Fee',
                'Total',
                'Payment Method',
                'Payment Status',
                'Order Status',
                'Tracking Number',
                'Courier',
                'Transaction ID'
            ];

            // Convert orders to CSV rows
            const orderRows = orders.map(order => {
                const itemsText = order.items.map(item => 
                    `${item.name} x ${item.quantity}`
                ).join('; ');
                
                return [
                    order.orderNumber,
                    new Date(order.createdAt).toLocaleString('en-US'),
                    order.customer.name,
                    order.customer.email,
                    order.customer.phone,
                    order.shipping?.address || '',
                    order.shipping?.city || '',
                    order.shipping?.province || '',
                    order.shipping?.pickup ? 'Yes' : 'No',
                    itemsText,
                    order.totals?.subtotal || 0,
                    order.totals?.discount || 0,
                    order.totals?.delivery || 0,
                    order.totals?.total || 0,
                    orderService.formatPaymentMethod(order.paymentMethod),
                    order.paymentStatus || 'pending',
                    order.status,
                    order.trackingNumber || '',
                    order.courier || '',
                    order.paymentTransactionId || order.transactionId || ''
                ];
            });

            // Statistics rows (for CSV header)
            const totalValue = orders.reduce((sum, order) => sum + (order.totals?.total || 0), 0);
            const statsRows = [
                ['Export Date', exportDate],
                ['Export Time', exportTime],
                ['Total Orders', orders.length],
                ['Total Value', `K${orderService.formatCurrency(totalValue)}`],
                [''], // Empty row
                ['Statistics by Status'],
                ...Object.entries(orders.reduce((acc, order) => {
                    acc[order.status] = (acc[order.status] || 0) + 1;
                    return acc;
                }, {})).map(([status, count]) => [status, count]),
                [''], // Empty row
                ['Statistics by Payment Status'],
                ...Object.entries(orders.reduce((acc, order) => {
                    acc[order.paymentStatus] = (acc[order.paymentStatus] || 0) + 1;
                    return acc;
                }, {})).map(([status, count]) => [status, count]),
                [''] // Empty row before headers
            ];

            // Combine all rows
            const csvContent = [
                ...statsRows.map(row => row.map(escapeCsvCell).join(',')),
                headers.map(escapeCsvCell).join(','),
                ...orderRows.map(row => row.map(escapeCsvCell).join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="orders_export_${exportDate}.csv"`);
            res.send(csvContent);
        }
    } catch (error) {
        logger.error({ err: error }, 'Error exporting orders');
        res.status(500).json({
            success: false,
            message: 'Failed to export orders data'
        });
    }
};

/**
 * GET /api/admin/orders/unread-count?since=<ISO timestamp>
 * Returns the count of orders created after `since`.
 * Returns only a number — no order data, no PII.
 */
exports.getUnreadOrderCount = async (req, res) => {
    try {
        const since = req.query.since ? new Date(req.query.since) : null;
        if (!since || isNaN(since.getTime())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or missing "since" parameter (ISO 8601 timestamp required)'
            });
        }
        const count = await Order.count({ where: { createdAt: { [Op.gt]: since } } });
        res.json({ success: true, count });
    } catch (error) {
        logger.error({ err: error }, 'Error getting unread order count');
        res.status(500).json({ success: false, message: 'Failed to get unread order count' });
    }
};

// Export Order model for testing/development
exports.Order = Order;

