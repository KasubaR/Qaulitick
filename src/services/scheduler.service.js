/**
 * Scheduler Service
 * 
 * Handles scheduled tasks for the application
 * Currently handles cleanup of featured products
 */

const featuredProductService = require('./featuredProduct.service');
const Order = require('../models/Order.model');
const Payment = require('../models/Payment.model');
const Product = require('../models/Product.model');
const { LaybyPlan, LaybyPayment } = require('../models');
const laybyService = require('./layby.service');
const lencoService = require('./lenco.service');
const dpoService = require('./dpo.service');
const {
    compactDpoVerifyRaw,
    applyDpoVerificationOutcome
} = require('./dpoPaymentOutcome.service');
const {
    applyPaymentStatusSideEffects,
    sendAdminPaymentNotificationOnce
} = require('./paymentCompletion.service');
const { GRACE_PERIOD_DAYS } = require('../config/layby');
const { Op } = require('sequelize');
const { sequelize } = require('../config/mysql');

const PENDING_TTL_MS     = 10 * 60 * 1000; // 10 minutes for pending orders
const PROCESSING_TTL_MS  = 30 * 60 * 1000; // 30 minutes for processing orders (gateway timeout)

function parsePositiveInt(value, fallback) {
    const parsed = parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const PAYMENT_POLL_INTERVAL_MS = parsePositiveInt(process.env.PAYMENT_POLL_INTERVAL_MS, 5 * 60 * 1000);
const PAYMENT_POLL_MIN_AGE_MS = parsePositiveInt(process.env.PAYMENT_POLL_MIN_AGE_MS, 2 * 60 * 1000);
const PAYMENT_POLL_EXPIRY_GRACE_MS = parsePositiveInt(process.env.PAYMENT_POLL_EXPIRY_GRACE_MS, 24 * 60 * 60 * 1000);
const PAYMENT_POLL_BATCH_LIMIT = Math.min(
    100,
    parsePositiveInt(process.env.PAYMENT_POLL_BATCH_LIMIT, 50)
);

const DPO_POLL_MIN_AGE_MS = parsePositiveInt(process.env.DPO_POLL_MIN_AGE_MS, 15 * 1000);
const DPO_POLL_MAX_AGE_MS = parsePositiveInt(process.env.DPO_POLL_MAX_AGE_MS, 35 * 60 * 1000);
const DPO_POLL_BATCH_LIMIT = Math.min(
    50,
    parsePositiveInt(process.env.DPO_POLL_BATCH_LIMIT, 25)
);

/**
 * Mark stale unpaid orders expired and restore color-variant JSON stock (decremented at checkout).
 * Targets:
 *   - paymentStatus = 'pending'    older than PENDING_TTL_MS   (10 min)
 *   - paymentStatus = 'processing' older than PROCESSING_TTL_MS (30 min)
 */
async function expireStaleUnpaidOrders() {
    const pendingCutoff    = new Date(Date.now() - PENDING_TTL_MS);
    const processingCutoff = new Date(Date.now() - PROCESSING_TTL_MS);

    const expiredOrders = await Order.findAll({
        where: {
            checkoutMode: 'standard',
            [Op.or]: [
                { paymentStatus: 'pending',    createdAt: { [Op.lt]: pendingCutoff } },
                { paymentStatus: 'processing', createdAt: { [Op.lt]: processingCutoff } }
            ]
        }
    });

    if (expiredOrders.length === 0) return;

    console.log(`[Scheduler] Expiring ${expiredOrders.length} stale unpaid order(s)...`);

    for (const order of expiredOrders) {
        try {
            const items = order.items || [];
            const ttlLabel = order.paymentStatus === 'processing' ? '30 minutes' : '10 minutes';

            for (const item of items) {
                const qty = parseInt(item.quantity) || 1;
                const productId = parseInt(item.productId, 10);

                // Restore top-level stock reserved at order creation.
                await Product.update(
                    { stock: sequelize.literal(`stock + ${qty}`) },
                    { where: { id: productId } }
                );

                // Also restore colors[].stock for color-variant items.
                if (item.selectedColor) {
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

            order.status = 'cancelled';
            order.paymentStatus = 'expired';
            const history = Array.isArray(order.history) ? [...order.history] : [];
            history.push({
                status: 'cancelled',
                paymentStatus: 'expired',
                notes: `Order expired — payment not received within ${ttlLabel}`,
                updatedBy: 'system',
                updatedAt: new Date().toISOString(),
                source: 'expiry_cron'
            });
            order.history = history;
            await order.save();

            console.log(`[Scheduler] Expired order ${order.orderNumber} (was ${order.paymentStatus})`);
        } catch (err) {
            console.error(`[Scheduler] Error expiring order ${order.orderNumber}:`, err);
        }
    }
}

/**
 * Flag pending layby installments whose dueAt has passed as 'overdue'.
 * Also cancels active layby plans that have exceeded their plan period with a remaining balance.
 */
async function flagOverdueLaybyInstallments() {
    const now = new Date();

    // Mark individual installments overdue
    const [overdueCount] = await LaybyPayment.update(
        { status: 'overdue' },
        {
            where: {
                status: 'pending',
                sequence: { [Op.gt]: 1 }, // exclude deposit row — it's due on creation, not a future date
                dueAt: { [Op.lt]: now }
            }
        }
    );

    if (overdueCount > 0) {
        console.log(`[Scheduler] Marked ${overdueCount} layby installment(s) as overdue`);
    }

    // Cancel plans that have exceeded their period and still have a balance
    const activePlans = await LaybyPlan.findAll({
        where: { status: 'active' }
    });

    let cancelledCount = 0;
    for (const plan of activePlans) {
        try {
            const sched = plan.installmentSchedule && typeof plan.installmentSchedule === 'object'
                ? plan.installmentSchedule
                : null;
            const periodDays = sched && sched.planPeriodDays ? sched.planPeriodDays : null;

            let expiresAt;
            let expiryDescription;
            if (periodDays) {
                expiresAt = new Date(plan.createdAt.getTime() + (periodDays + GRACE_PERIOD_DAYS) * 86400000);
                expiryDescription = `plan period of ${periodDays} days${GRACE_PERIOD_DAYS > 0 ? ` + ${GRACE_PERIOD_DAYS}-day grace period` : ''}`;
            } else {
                // Fixed-interval plans (equal_interval_after_deposit) store no planPeriodDays.
                // Derive expiry from the last installment's dueAt + grace period.
                const lastInstallment = await LaybyPayment.findOne({
                    where: { laybyPlanId: plan.id },
                    order: [['sequence', 'DESC']]
                });
                if (!lastInstallment) continue;
                expiresAt = new Date(lastInstallment.dueAt.getTime() + GRACE_PERIOD_DAYS * 86400000);
                expiryDescription = `last installment due date${GRACE_PERIOD_DAYS > 0 ? ` + ${GRACE_PERIOD_DAYS}-day grace period` : ''}`;
            }

            if (now < expiresAt) continue;
            if (Number(plan.balanceRemaining) <= 0) continue;

            const result = await laybyService.cancelLaybyPlan(plan.id, {
                actor: 'system',
                source: 'layby_expiry_cron',
                reason: `Layby plan cancelled — ${expiryDescription} exceeded with balance remaining`
            });
            if (result && !result.error && !result.alreadyCancelled) {
                cancelledCount++;
            }
        } catch (err) {
            console.error(`[Scheduler] Error processing layby plan ${plan.id}:`, err);
        }
    }

    if (cancelledCount > 0) {
        console.log(`[Scheduler] Cancelled ${cancelledCount} expired layby plan(s)`);
    }
}

async function pollPendingLencoPayments() {
    const cutoff = new Date(Date.now() - PAYMENT_POLL_MIN_AGE_MS);
    const expiryGraceCutoff = new Date(Date.now() - PAYMENT_POLL_EXPIRY_GRACE_MS);

    const payments = await Payment.findAll({
        where: {
            paymentMethod: 'mobile_money',
            status: { [Op.in]: ['pending', 'processing'] },
            createdAt: { [Op.lt]: cutoff },
            [Op.and]: [
                {
                    [Op.or]: [
                        { lencoTransactionId: { [Op.ne]: null } },
                        { transactionId: { [Op.ne]: null } }
                    ]
                },
                {
                    [Op.or]: [
                        { expiresAt: { [Op.is]: null } },
                        { expiresAt: { [Op.gte]: expiryGraceCutoff } }
                    ]
                }
            ]
        },
        order: [['createdAt', 'ASC']],
        limit: PAYMENT_POLL_BATCH_LIMIT
    });

    if (payments.length === 0) return { checked: 0, updated: 0, terminal: 0, errors: 0 };

    console.log(`[Scheduler] Polling ${payments.length} pending Lenco payment(s)...`);

    const stats = { checked: payments.length, updated: 0, terminal: 0, errors: 0 };

    for (const payment of payments) {
        try {
            const merchantReference = (payment.transactionId && String(payment.transactionId).trim()) || null;
            const lencoResult = await lencoService.verifyPayment(payment.lencoTransactionId, merchantReference);
            const newStatus = Payment.mapLencoStatusToPaymentStatus(lencoResult.status);

            const updatePayload = {
                lencoStatus: lencoResult.status,
                status: newStatus,
                lencoResponse: lencoResult.rawResponse || lencoResult
            };

            if (lencoResult.transactionId && !payment.lencoTransactionId) {
                updatePayload.lencoTransactionId = lencoResult.transactionId;
            }
            if (lencoResult.lencoReference) {
                updatePayload.lencoReference = lencoResult.lencoReference;
            }
            if (lencoResult.provider) {
                updatePayload.lencoProvider = String(lencoResult.provider).toLowerCase();
            }

            if (newStatus === 'completed') {
                updatePayload.completedAt = lencoResult.completedAt
                    ? new Date(lencoResult.completedAt)
                    : new Date();
            } else if (newStatus === 'failed') {
                updatePayload.failedAt = lencoResult.failedAt
                    ? new Date(lencoResult.failedAt)
                    : new Date();
                updatePayload.failureReason = lencoResult.failureReason || 'Payment failed';
            } else if (newStatus === 'cancelled') {
                updatePayload.cancelledAt = new Date();
                updatePayload.failureReason = lencoResult.failureReason || payment.failureReason || null;
            }

            const [updatedRows] = await Payment.update(updatePayload, {
                where: {
                    id: payment.id,
                    status: { [Op.in]: ['pending', 'processing'] }
                }
            });

            if (updatedRows === 0) {
                continue;
            }

            stats.updated++;

            if (['completed', 'failed', 'cancelled'].includes(newStatus)) {
                stats.terminal++;
                const freshPayment = await Payment.findByPk(payment.id);
                try {
                    await applyPaymentStatusSideEffects(freshPayment, {
                        source: 'payment cron',
                        note: `Payment status updated via scheduled poll: ${newStatus}`
                    });
                } catch (sideEffectError) {
                    console.error(`[Scheduler] Payment side effects failed for payment ${payment.id}:`, sideEffectError.message);
                }

                if (['completed', 'failed'].includes(newStatus)) {
                    await sendAdminPaymentNotificationOnce(payment.id);
                }
            }
        } catch (error) {
            stats.errors++;
            console.warn(`[Scheduler] Payment poll failed for payment ${payment.id}:`, error.message);
        }
    }

    if (stats.updated > 0 || stats.errors > 0) {
        console.log(
            `[Scheduler] Payment poll complete: checked=${stats.checked}, updated=${stats.updated}, terminal=${stats.terminal}, errors=${stats.errors}`
        );
    }

    return stats;
}

async function pollPendingDpoPayments() {
    const now = Date.now();
    const minCreated = new Date(now - DPO_POLL_MAX_AGE_MS);
    const maxCreated = new Date(now - DPO_POLL_MIN_AGE_MS);

    const payments = await Payment.findAll({
        where: {
            paymentMethod: 'bank_transfer',
            status: { [Op.in]: ['pending', 'processing'] },
            transactionId: { [Op.ne]: null },
            createdAt: { [Op.gt]: minCreated, [Op.lt]: maxCreated }
        },
        order: [['createdAt', 'ASC']],
        limit: DPO_POLL_BATCH_LIMIT
    });

    const dpoRows = payments.filter((p) => (p.metadata && p.metadata.gateway) === 'dpo');
    if (dpoRows.length === 0) return { checked: 0, updated: 0, terminal: 0, errors: 0 };

    console.log(`[Scheduler] Polling ${dpoRows.length} pending DPO payment(s)...`);

    const stats = { checked: dpoRows.length, updated: 0, terminal: 0, errors: 0 };

    for (const payment of dpoRows) {
        try {
            const { outcome, raw } = await dpoService.verifyToken(payment.transactionId);

            if (outcome.paid) {
                await applyDpoVerificationOutcome(payment, outcome, raw, 'DPO scheduler poll');
                stats.updated++;
                stats.terminal++;
                continue;
            }

            if (!outcome.terminal) {
                await payment.update({
                    gatewayResponse: compactDpoVerifyRaw(raw)
                });
                stats.updated++;
                continue;
            }

            await applyDpoVerificationOutcome(payment, outcome, raw, 'DPO scheduler poll');
            stats.updated++;
            stats.terminal++;
        } catch (error) {
            stats.errors++;
            console.warn(`[Scheduler] DPO poll failed for payment ${payment.id}:`, error.message);
        }
    }

    if (stats.updated > 0 || stats.errors > 0) {
        console.log(
            `[Scheduler] DPO poll complete: checked=${stats.checked}, updated=${stats.updated}, terminal=${stats.terminal}, errors=${stats.errors}`
        );
    }

    return stats;
}

class SchedulerService {
    constructor() {
        this.intervals = [];
        this.isRunning = false;
        this.paymentPollRunning = false;
    }

    async pollPendingPayments() {
        if (this.paymentPollRunning) {
            console.log('[Scheduler] Payment poll already running; skipping overlap');
            return { skipped: true };
        }

        this.paymentPollRunning = true;
        try {
            const lenco = await pollPendingLencoPayments();
            const dpo = await pollPendingDpoPayments();
            return { lenco, dpo };
        } finally {
            this.paymentPollRunning = false;
        }
    }

    /**
     * Start all scheduled tasks
     */
    start() {
        if (this.isRunning) {
            console.log('[Scheduler] Already running');
            return;
        }

        this.isRunning = true;
        console.log('[Scheduler] Starting scheduled tasks...');

        // Cleanup deleted products every 6 hours
        const cleanupDeletedInterval = setInterval(async () => {
            try {
                console.log('[Scheduler] Running cleanup of deleted products...');
                const removedCount = await featuredProductService.cleanupDeletedProducts();
                if (removedCount > 0) {
                    console.log(`[Scheduler] Cleaned up ${removedCount} featured product(s) that referenced deleted products`);
                } else {
                    console.log('[Scheduler] No deleted products found in featured products');
                }
            } catch (error) {
                console.error('[Scheduler] Error during cleanup of deleted products:', error);
            }
        }, 6 * 60 * 60 * 1000); // 6 hours

        // Cleanup inactive/out-of-stock products every 12 hours (auto-remove enabled)
        const cleanupInactiveInterval = setInterval(async () => {
            try {
                console.log('[Scheduler] Running cleanup for inactive/out-of-stock featured products...');
                const result = await featuredProductService.cleanupInactiveProducts(true);
                if (result.removedCount > 0) {
                    console.log(`[Scheduler] Removed ${result.removedCount} inactive/out-of-stock featured product(s)`);
                } else {
                    console.log('[Scheduler] All featured products are active and in stock');
                }
            } catch (error) {
                console.error('[Scheduler] Error during cleanup check for inactive products:', error);
            }
        }, 12 * 60 * 60 * 1000); // 12 hours

        // Expire stale unpaid orders every 2 minutes (restores color variant counts only)
        const expireStaleOrdersInterval = setInterval(async () => {
            try {
                await expireStaleUnpaidOrders();
            } catch (error) {
                console.error('[Scheduler] Error during stale order expiry:', error);
            }
        }, 2 * 60 * 1000); // 2 minutes

        // Flag overdue layby installments and cancel expired plans every hour
        const laybyOverdueInterval = setInterval(async () => {
            try {
                await flagOverdueLaybyInstallments();
            } catch (error) {
                console.error('[Scheduler] Error during layby overdue check:', error);
            }
        }, 60 * 60 * 1000); // 1 hour

        // Poll pending Lenco payments every 5 minutes as a webhook fallback
        const paymentPollInterval = setInterval(async () => {
            try {
                await this.pollPendingPayments();
            } catch (error) {
                console.error('[Scheduler] Error during payment poll:', error);
            }
        }, PAYMENT_POLL_INTERVAL_MS);

        this.intervals.push(
            cleanupDeletedInterval,
            cleanupInactiveInterval,
            expireStaleOrdersInterval,
            laybyOverdueInterval,
            paymentPollInterval
        );

        // Poll pending payments quickly on startup (10s) to catch anything missed during restarts
        setTimeout(async () => {
            try {
                await this.pollPendingPayments();
            } catch (error) {
                console.error('[Scheduler] Error during initial payment poll:', error);
            }
        }, 10 * 1000); // 10 seconds

        // Run remaining startup tasks after 1 minute to let server fully start
        setTimeout(async () => {
            try {
                console.log('[Scheduler] Running initial cleanup of deleted products...');
                const removedCount = await featuredProductService.cleanupDeletedProducts();
                if (removedCount > 0) {
                    console.log(`[Scheduler] Initial cleanup: Removed ${removedCount} featured product(s) that referenced deleted products`);
                }

                await expireStaleUnpaidOrders();
                await flagOverdueLaybyInstallments();
            } catch (error) {
                console.error('[Scheduler] Error during initial cleanup:', error);
            }
        }, 60 * 1000); // 1 minute

        console.log('[Scheduler] Scheduled tasks started');
    }

    /**
     * Stop all scheduled tasks
     */
    stop() {
        if (!this.isRunning) {
            return;
        }

        this.intervals.forEach(interval => clearInterval(interval));
        this.intervals = [];
        this.isRunning = false;
        console.log('[Scheduler] Scheduled tasks stopped');
    }

    /**
     * Get scheduler status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            activeTasks: this.intervals.length,
            paymentPollRunning: this.paymentPollRunning
        };
    }
}

// Export singleton instance
module.exports = new SchedulerService();

