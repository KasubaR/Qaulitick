// Order Service
// Business logic for order management operations

const Order = require('../models/Order.model');
const Payment = require('../models/Payment.model');
const Product = require('../models/Product.model');
const { sequelize } = require('../config/mysql');
const { Op } = require('sequelize');

/**
 * Get orders for export with filters
 * @param {Object} filters - Filter criteria
 * @returns {Promise<Array>} Array of orders
 */
const MAX_EXPORT_ROWS = 10000;

async function getOrdersForExport(filters = {}, options = {}) {
    try {
        const limit = Math.min(options.limit ?? MAX_EXPORT_ROWS, MAX_EXPORT_ROWS);
        const where = {};
        if (filters.status) where.status = filters.status;
        if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
        if (filters.paymentMethod) where.paymentMethod = filters.paymentMethod;
        if (filters.startDate || filters.endDate) {
            where.createdAt = {};
            if (filters.startDate) where.createdAt[Op.gte] = new Date(filters.startDate);
            if (filters.endDate) where.createdAt[Op.lte] = new Date(filters.endDate);
        }
        if (filters.email) {
            where[Op.and] = sequelize.where(
                sequelize.fn('JSON_UNQUOTE', sequelize.fn('JSON_EXTRACT', sequelize.col('customer'), sequelize.literal("'$.email'"))),
                filters.email
            );
        }
        const order = filters.sort === 'oldest' ? [['createdAt', 'ASC']] : [['createdAt', 'DESC']];
        let orders = await Order.findAll({ where, order, limit });
        if (filters.search) {
            const s = (filters.search || '').toLowerCase();
            orders = orders.filter(o =>
                (o.orderNumber && o.orderNumber.toLowerCase().includes(s)) ||
                (o.customer && (o.customer.name || '').toLowerCase().includes(s)) ||
                (o.customer && (o.customer.email || '').toLowerCase().includes(s)) ||
                (o.customer && (o.customer.phone || '').toLowerCase().includes(s))
            );
        }
        
        // Enrich orders with payment status
        const ordersWithPayment = await Promise.all(
            orders.map(async (order) => {
                const orderObj = order.toJSON();
                
                // Get payment status from Payment model
                const payment = await Payment.findLatestPaymentByOrderNumber(orderObj.orderNumber);
                if (payment) {
                    orderObj.paymentStatus = payment.status;
                    orderObj.paymentTransactionId = payment.transactionId || payment.lencoTransactionId;
                }
                
                return orderObj;
            })
        );
        
        return ordersWithPayment;
    } catch (error) {
        console.error('[Order Service] Error getting orders for export:', error);
        throw error;
    }
}

/**
 * Format payment method for display
 * @param {string} method - Payment method
 * @returns {string} Formatted payment method
 */
function formatPaymentMethod(method) {
    const methods = {
        'mobile_money': 'Mobile Money',
        'bank_transfer': 'Bank Transfer',
        'card': 'Credit/Debit Card',
        'cash_on_delivery': 'Cash on Delivery'
    };
    return methods[method] || method || 'N/A';
}

/**
 * Format currency amount
 * @param {number} amount - Amount to format
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount) {
    return parseFloat(amount || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

/**
 * Update Order Status Based on Payment Status
 * Called from payment webhook handler to update order when payment status changes
 * 
 * This function is in the service layer to avoid circular dependencies between
 * payment_controller.js and order_controller.js
 * 
 * @param {string} orderNumber - Order number
 * @param {string} paymentStatus - Payment status from Lenco (pending, processing, completed, failed, cancelled)
 * @param {string} transactionId - Payment transaction ID (optional)
 * @param {string} notes - Additional notes (optional)
 * @returns {Promise<object|null>} Updated order or null if not found
 */
async function updateOrderStatusFromPayment(orderNumber, paymentStatus, transactionId = null, notes = '') {
    try {
        // Find order using Order model
        const order = await Order.findByOrderNumber(orderNumber);
        
        if (!order) {
            console.warn(`[Order Service] Order ${orderNumber} not found for payment status update`);
            return null;
        }
        
        // Map payment status to order status and payment status
        let newOrderStatus = order.status;
        let newPaymentStatus = paymentStatus;
        let historyNote = notes;
        
        // Status mapping based on payment status
        if (paymentStatus === 'pending' || paymentStatus === 'processing') {
            // Payment is pending/processing
            if (order.status === 'pending') {
                newOrderStatus = 'payment_pending';
            }
            newPaymentStatus = paymentStatus;
            historyNote = notes || `Payment ${paymentStatus}`;
        } else if (paymentStatus === 'completed') {
            // Payment completed successfully
            // Include cancelled / payment_failed so admin verify or late webhooks can reconcile
            // when the order was wrongly marked cancelled (e.g. expiry cron, bad webhook) but Lenco shows paid.
            if (
                order.status === 'pending' ||
                order.status === 'payment_pending' ||
                order.status === 'cancelled' ||
                order.status === 'payment_failed'
            ) {
                newOrderStatus = 'paid';
            }
            newPaymentStatus = 'completed';
            historyNote = notes || 'Payment completed successfully';
        } else if (paymentStatus === 'failed') {
            // Payment failed
            if (order.status === 'pending' || order.status === 'payment_pending') {
                newOrderStatus = 'payment_failed';
            }
            newPaymentStatus = 'failed';
            historyNote = notes || 'Payment failed';
        } else if (paymentStatus === 'cancelled') {
            // Payment cancelled
            if (order.status === 'pending' || order.status === 'payment_pending') {
                newOrderStatus = 'cancelled';
            }
            newPaymentStatus = 'cancelled';
            historyNote = notes || 'Payment cancelled';
        }
        
        // Atomically transition the order to the new status.
        // The WHERE clause on paymentStatus ensures that if two identical webhooks
        // arrive concurrently, only the first one will match and update the row.
        // This eliminates the race window that caused double stock decrements.
        const previousStatus = order.status;
        const previousPaymentStatus = order.paymentStatus;

        const updateFields = {
            status: newOrderStatus,
            paymentStatus: newPaymentStatus,
            history: [...(order.history || []), {
                status: newOrderStatus,
                paymentStatus: newPaymentStatus,
                notes: historyNote,
                updatedBy: 'system',
                updatedAt: new Date(),
                source: 'payment_webhook'
            }]
        };
        if (transactionId) {
            updateFields.transactionId = transactionId;
        }

        // Build a WHERE that only matches if paymentStatus has NOT already
        // transitioned to the target terminal state. This is the atomicity gate.
        const terminalStates = ['completed', 'failed', 'cancelled'];
        const isTerminal = terminalStates.includes(paymentStatus);
        const atomicWhere = { orderNumber };
        if (isTerminal) {
            atomicWhere.paymentStatus = { [Op.ne]: paymentStatus };
        }

        const [updatedRows] = await Order.update(updateFields, { where: atomicWhere });

        if (updatedRows === 0 && isTerminal) {
            console.warn(`[Order Service] Order ${orderNumber} already has paymentStatus="${paymentStatus}" — duplicate webhook ignored`);
            return null;
        }

        // Re-fetch the order so the caller gets the updated instance
        const updatedOrder = await Order.findByOrderNumber(orderNumber);

        // Adjust stock based on payment outcome.
        // Because the atomic UPDATE above succeeded (updatedRows > 0), we know
        // we are the only process handling this transition — no duplicates possible.
        const items = updatedOrder.items || [];

        if (paymentStatus === 'completed' && previousPaymentStatus !== 'completed') {
            // Stock is reserved at order creation for all order types — no decrement needed here.
            console.log(`[Order Service] Payment completed for order ${orderNumber} — stock already reserved at creation`);

        } else if ((paymentStatus === 'failed' || paymentStatus === 'cancelled') &&
                   previousPaymentStatus !== 'failed' && previousPaymentStatus !== 'cancelled') {
            for (const item of items) {
                const qty = parseInt(item.quantity) || 1;
                const productId = parseInt(item.productId, 10);

                // All orders reserve top-level stock at creation — restore it on failure.
                await Product.update(
                    { stock: sequelize.literal(`stock + ${qty}`) },
                    { where: { id: productId } }
                );

                // Standard color-variant orders also reserved colors[].stock — restore that too.
                if (updatedOrder.checkoutMode !== 'layby' && item.selectedColor) {
                    const product = await Product.findByPk(productId);
                    if (product) {
                        const updatedColors = (product.colors || []).map(c =>
                            c.name === item.selectedColor
                                ? { ...c, stock: (c.stock || 0) + qty }
                                : c
                        );
                        await product.update({ colors: updatedColors });
                    }
                }
            }
            console.log(`[Order Service] Stock restored for failed/cancelled order ${orderNumber}`);
        }

        console.log(`[Order Service] Order ${orderNumber} status updated from "${previousStatus}" to "${newOrderStatus}" (payment: "${previousPaymentStatus}" → "${newPaymentStatus}")`);

        return updatedOrder;
    } catch (error) {
        console.error(`[Order Service] Error updating order status from payment:`, error);
        throw error;
    }
}

module.exports = {
    MAX_EXPORT_ROWS,
    getOrdersForExport,
    formatPaymentMethod,
    formatCurrency,
    updateOrderStatusFromPayment
};

