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
async function getOrdersForExport(filters = {}) {
    try {
        const where = {};
        if (filters.status) where.status = filters.status;
        if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
        if (filters.paymentMethod) where.paymentMethod = filters.paymentMethod;
        if (filters.startDate || filters.endDate) {
            where.createdAt = {};
            if (filters.startDate) where.createdAt[Op.gte] = new Date(filters.startDate);
            if (filters.endDate) where.createdAt[Op.lte] = new Date(filters.endDate);
        }
        const order = filters.sort === 'oldest' ? [['createdAt', 'ASC']] : [['createdAt', 'DESC']];
        let orders = await Order.findAll({ where, order, limit: 10000 });
        if (filters.email) orders = orders.filter(o => (o.customer && o.customer.email) === filters.email);
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
            if (order.status === 'pending' || order.status === 'payment_pending') {
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
        
        // Update order
        const previousStatus = order.status;
        const previousPaymentStatus = order.paymentStatus;
        
        order.status = newOrderStatus;
        order.paymentStatus = newPaymentStatus;
        
        // Update transaction ID if provided
        if (transactionId) {
            order.transactionId = transactionId;
        }
        
        // Add history entry
        order.history.push({
            status: newOrderStatus,
            paymentStatus: newPaymentStatus,
            notes: historyNote,
            updatedBy: 'system',
            updatedAt: new Date(),
            source: 'payment_webhook'
        });
        
        // Save order
        await order.save();

        // Adjust stock based on payment outcome.
        // Guards against duplicate webhook calls: only act when the payment status
        // actually transitions into a terminal state for the first time.
        const items = order.items || [];

        if (paymentStatus === 'completed' && previousPaymentStatus !== 'completed') {
            // Convert reservation to a real sale: deduct from stock and release the hold.
            for (const item of items) {
                const qty = parseInt(item.quantity) || 1;
                const [rows] = await Product.update(
                    {
                        stock:         sequelize.literal(`stock - ${qty}`),
                        reservedStock: sequelize.literal(`GREATEST(0, reservedStock - ${qty})`)
                    },
                    {
                        where: {
                            id: parseInt(item.productId, 10),
                            stock:         { [Op.gte]: qty },
                            reservedStock: { [Op.gte]: qty }
                        }
                    }
                );
                if (rows === 0) {
                    console.warn(`[Order Service] Stock decrement skipped for product ${item.productId} on order ${orderNumber} — may have already been applied`);
                }
            }
            console.log(`[Order Service] Stock decremented for order ${orderNumber}`);

        } else if ((paymentStatus === 'failed' || paymentStatus === 'cancelled') &&
                   previousPaymentStatus !== 'failed' && previousPaymentStatus !== 'cancelled') {
            // Release the reservation — stock returns to available.
            for (const item of items) {
                const qty = parseInt(item.quantity) || 1;
                await Product.update(
                    { reservedStock: sequelize.literal(`GREATEST(0, reservedStock - ${qty})`) },
                    { where: { id: parseInt(item.productId, 10), reservedStock: { [Op.gt]: 0 } } }
                );
            }
            console.log(`[Order Service] Stock reservation released for order ${orderNumber}`);
        }

        console.log(`[Order Service] Order ${orderNumber} status updated from "${previousStatus}" to "${newOrderStatus}" (payment: "${previousPaymentStatus}" → "${newPaymentStatus}")`);

        return order;
    } catch (error) {
        console.error(`[Order Service] Error updating order status from payment:`, error);
        throw error;
    }
}

module.exports = {
    getOrdersForExport,
    formatPaymentMethod,
    formatCurrency,
    updateOrderStatusFromPayment
};

