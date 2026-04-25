const { Op } = require('sequelize');

const Payment = require('../models/Payment.model');
const orderService = require('./order.service');
const laybyService = require('./layby.service');
const emailService = require('./email.service');
const logger = require('../utils/logger').child({ module: 'PaymentCompletionService' });

/**
 * Atomically claim the right to send the admin notification for a terminal payment.
 * This dedupes webhook, manual verify, and scheduled polling races.
 */
async function tryClaimPaymentAdminNotification(paymentId) {
    const [count] = await Payment.update(
        { notifiedAt: new Date() },
        {
            where: {
                id: paymentId,
                notifiedAt: { [Op.is]: null },
                status: { [Op.in]: ['completed', 'failed'] }
            }
        }
    );
    return count > 0;
}

async function sendAdminPaymentNotificationOnce(paymentId) {
    const claimed = await tryClaimPaymentAdminNotification(paymentId);
    if (!claimed) {
        return { sent: false, reason: 'already_claimed' };
    }

    const fresh = await Payment.findByPk(paymentId);
    if (!fresh) {
        return { sent: false, reason: 'payment_missing' };
    }

    try {
        await emailService.sendPaymentNotificationToAdmin(fresh.toJSON());
        return { sent: true };
    } catch (error) {
        logger.error({ err: error, paymentId }, 'Error sending payment notification');
        return { sent: false, reason: 'send_failed', error };
    }
}

/**
 * Apply downstream effects for a Payment row after its status changes.
 * The caller should pass a freshly reloaded Payment instance.
 */
async function applyPaymentStatusSideEffects(payment, options = {}) {
    if (!payment) return null;

    const {
        source = 'payment_status_sync',
        note,
        includeNonTerminal = false
    } = options;

    if (payment.status === 'completed') {
        if (payment.laybyPaymentId) {
            return laybyService.recordLaybyInstallmentPaid(payment);
        }

        return orderService.updateOrderStatusFromPayment(
            payment.orderNumber,
            'completed',
            payment.lencoTransactionId || payment.transactionId,
            note || `Payment completed via ${source}`
        );
    }

    if (['failed', 'cancelled'].includes(payment.status) && !payment.laybyPaymentId) {
        const reason = payment.failureReason ? `: ${payment.failureReason}` : '';
        return orderService.updateOrderStatusFromPayment(
            payment.orderNumber,
            payment.status,
            payment.lencoTransactionId || payment.transactionId,
            note || `Payment ${payment.status}${reason}`
        );
    }

    if (includeNonTerminal && !payment.laybyPaymentId && ['pending', 'processing'].includes(payment.status)) {
        return orderService.updateOrderStatusFromPayment(
            payment.orderNumber,
            payment.status,
            payment.lencoTransactionId || payment.transactionId,
            note || `Payment ${payment.status} via ${source}`
        );
    }

    return null;
}

module.exports = {
    applyPaymentStatusSideEffects,
    sendAdminPaymentNotificationOnce,
    tryClaimPaymentAdminNotification
};
