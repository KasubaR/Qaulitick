/**
 * Layby plans: schedule creation and payment completion side effects.
 *
 * Default: flexible balance — deposit (seq 1) plus one open balance line (seq 2) due by
 * LAYBY_PLAN_PERIOD_DAYS; customers may pay any positive amount up to the remaining balance
 * any number of times until cleared.
 *
 * Legacy: set LAYBY_SCHEDULED_INSTALLMENTS=true for fixed installment rows (count + spacing).
 *
 * @see ../config/layby.js for env variables.
 */

const { sequelize } = require('../config/mysql');
const { Op } = require('sequelize');
const {
    MIN_PCT,
    MAX_PCT,
    PLAN_PERIOD_DAYS,
    USE_SCHEDULED_INSTALLMENTS,
    INSTALLMENT_COUNT,
    USE_FIXED_INSTALLMENT_INTERVAL,
    FIXED_INTERVAL_DAYS
} = require('../config/layby');
const { LaybyPlan, LaybyPayment, Order, Payment, Product, OfflineSale } = require('../models');
const logger = require('../utils/logger').child({ module: 'LaybyService' });
const emailService = require('./email.service');
const { roundMoney2 } = require('../utils/money');

function parseInstallmentSchedule(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }
    return raw;
}

/**
 * @param {import('../models/LaybyPlan.model')|{ installmentSchedule?: * }} plan
 * @param {{ sequence: number }} installment
 */
function isFlexibleBalanceInstallment(plan, installment) {
    const sched = parseInstallmentSchedule(plan.installmentSchedule);
    return !!(sched && sched.policy === 'flexible_within_period' && installment.sequence >= 2);
}

/**
 * Split total cents into `parts` positive integers that sum exactly to totalCents.
 * @param {number} totalCents
 * @param {number} parts
 * @returns {number[]}
 */
function splitCents(totalCents, parts) {
    if (parts <= 0) return [];
    const base = Math.floor(totalCents / parts);
    let rem = totalCents - base * parts;
    const out = [];
    for (let i = 0; i < parts; i++) {
        out.push(base + (rem > 0 ? 1 : 0));
        if (rem > 0) rem -= 1;
    }
    return out;
}

function clampDepositPercent(input) {
    let p = parseFloat(String(input));
    if (Number.isNaN(p)) p = MIN_PCT;
    return Math.min(MAX_PCT, Math.max(MIN_PCT, p));
}

/**
 * Restore top-level product stock from line items (layby cancel).
 * @param {Array<{ productId?: *, quantity?: * }>} items
 * @param {import('sequelize').Transaction} transaction
 */
async function restoreStockFromLineItems(items, transaction) {
    const list = Array.isArray(items) ? items : [];
    for (const item of list) {
        const qty = parseInt(item.quantity, 10) || 1;
        const productId = parseInt(item.productId, 10);
        if (!productId) continue;

        await Product.increment('stock', { by: qty, where: { id: productId }, transaction });
    }
}

/**
 * Flexible layby: deposit (seq 1) + balance line (seq 2) within plan period.
 * @param {{ orderId?: number|null, userId?: number|null, offlineSaleId?: number|null, orderTotal: number, depositPercentInput: *, planPeriodDays?: number, transaction: import('sequelize').Transaction }}
 * @returns {Promise<{ plan: import('sequelize').Model, depositInstallment: import('sequelize').Model }>}
 */
async function createFlexibleLaybyPlanAndPayments({
    orderId = null,
    userId = null,
    offlineSaleId = null,
    orderTotal,
    depositPercentInput,
    planPeriodDays,
    transaction
}) {
    if (!orderId && !offlineSaleId) {
        throw new Error('Layby plan requires orderId or offlineSaleId');
    }

    const total = roundMoney2(orderTotal);
    const pct = clampDepositPercent(depositPercentInput);
    const deposit = roundMoney2(total * (pct / 100));
    const balanceAfterDeposit = roundMoney2(total - deposit);
    const periodDays = Math.max(1, parseInt(String(planPeriodDays ?? PLAN_PERIOD_DAYS), 10) || PLAN_PERIOD_DAYS);

    const now = new Date();
    const balanceDueAt = new Date(now.getTime() + periodDays * 86400000);

    const plan = await LaybyPlan.create(
        {
            orderId: orderId || null,
            userId: userId || null,
            offlineSaleId: offlineSaleId || null,
            currency: 'ZMW',
            orderTotal: total,
            depositPercent: pct,
            depositAmount: deposit,
            balanceRemaining: total,
            installmentCount: 1,
            installmentSchedule: {
                policy: 'flexible_within_period',
                planPeriodDays: periodDays,
                depositPercentClamped: pct
            },
            status: 'active',
            nextDueAt: balanceDueAt
        },
        { transaction }
    );

    await LaybyPayment.bulkCreate(
        [
            {
                laybyPlanId: plan.id,
                sequence: 1,
                dueAt: now,
                amount: deposit,
                status: 'pending'
            },
            {
                laybyPlanId: plan.id,
                sequence: 2,
                dueAt: balanceDueAt,
                amount: balanceAfterDeposit,
                status: 'pending'
            }
        ],
        { transaction }
    );

    const depositInstallment = await LaybyPayment.findOne({
        where: { laybyPlanId: plan.id, sequence: 1 },
        transaction
    });

    logger.info(
        {
            orderId: orderId || null,
            offlineSaleId: offlineSaleId || null,
            planId: plan.id,
            total,
            deposit,
            mode: 'flexible'
        },
        'Layby plan created'
    );

    return { plan, depositInstallment };
}

/**
 * @param {{ order: import('sequelize').Model, userId: number, depositPercentInput: *, transaction: import('sequelize').Transaction }}
 */
async function createLaybyPlanAndPayments({ order, userId, depositPercentInput, transaction }) {
    const total = roundMoney2(order.totals.total);
    const pct = clampDepositPercent(depositPercentInput);
    const deposit = roundMoney2(total * (pct / 100));
    const balanceAfterDeposit = roundMoney2(total - deposit);
    const balanceCents = Math.round(balanceAfterDeposit * 100);

    const now = new Date();
    const rows = [];

    if (!USE_SCHEDULED_INSTALLMENTS) {
        const { plan } = await createFlexibleLaybyPlanAndPayments({
            orderId: order.id,
            userId,
            orderTotal: total,
            depositPercentInput,
            transaction
        });
        return plan;
    }

    const sliceCents = splitCents(balanceCents, INSTALLMENT_COUNT);
    const plan = await LaybyPlan.create(
        {
            orderId: order.id,
            userId,
            currency: 'ZMW',
            orderTotal: total,
            depositPercent: pct,
            depositAmount: deposit,
            // Intentionally set to full order total, not balanceAfterDeposit.
            // recordLaybyInstallmentPaid() decrements this as each payment is confirmed.
            // At any point: amountPaid = orderTotal - balanceRemaining.
            balanceRemaining: total,
            installmentCount: INSTALLMENT_COUNT,
            installmentSchedule: USE_FIXED_INSTALLMENT_INTERVAL
                ? {
                      policy: 'equal_interval_after_deposit',
                      intervalDays: FIXED_INTERVAL_DAYS,
                      depositPercentClamped: pct
                  }
                : {
                      policy: 'equal_slices_within_period',
                      planPeriodDays: PLAN_PERIOD_DAYS,
                      depositPercentClamped: pct
                  },
            status: 'active',
            nextDueAt: null  // set after rows are built so we have rows[1].dueAt
        },
        { transaction }
    );

    rows.push({
        laybyPlanId: plan.id,
        sequence: 1,
        dueAt: now,
        amount: deposit,
        status: 'pending'
    });

    for (let i = 0; i < sliceCents.length; i++) {
        const amt = roundMoney2(sliceCents[i] / 100);
        const offsetDays = USE_FIXED_INSTALLMENT_INTERVAL
            ? (i + 1) * FIXED_INTERVAL_DAYS
            : Math.round(((i + 1) * PLAN_PERIOD_DAYS) / INSTALLMENT_COUNT);
        const due = new Date(now.getTime() + offsetDays * 86400000);
        rows.push({
            laybyPlanId: plan.id,
            sequence: i + 2,
            dueAt: due,
            amount: amt,
            status: 'pending'
        });
    }

    await LaybyPayment.bulkCreate(rows, { transaction });

    logger.info(
        { orderId: order.id, planId: plan.id, total, deposit, installments: INSTALLMENT_COUNT, mode: 'scheduled' },
        'Layby plan created'
    );

    return plan;
}

/**
 * After a Lenco Payment row is marked completed, apply layby bookkeeping and order state.
 * Idempotent if installment already paid. Returns { error: 'NOT_PAYABLE' } if status is not pending/overdue.
 *
 * Layby order rule: order.paymentStatus stays `processing` and status `payment_pending` until
 * plan.balanceRemaining reaches 0, then order is `paid` / payment `completed`.
 *
 * @param {import('../models/Payment.model')} payment — Sequelize instance with laybyPaymentId set
 */
async function recordLaybyInstallmentPaid(payment) {
    if (!payment.laybyPaymentId || payment.status !== 'completed') {
        return null;
    }

    return sequelize.transaction(async (t) => {
        const installment = await LaybyPayment.findByPk(payment.laybyPaymentId, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!installment) {
            logger.warn({ laybyPaymentId: payment.laybyPaymentId }, 'LaybyPayment row missing');
            return null;
        }

        if (installment.status === 'paid') {
            return { alreadyApplied: true };
        }

        if (!['pending', 'overdue'].includes(installment.status)) {
            logger.warn(
                { installmentId: installment.id, status: installment.status },
                'Installment not payable'
            );
            return { error: 'NOT_PAYABLE' };
        }

        const plan = await LaybyPlan.findByPk(installment.laybyPlanId, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!plan || plan.status !== 'active') {
            logger.warn({ planId: installment.laybyPlanId }, 'Layby plan missing or not active');
            return null;
        }

        const order = await Order.findByPk(plan.orderId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!order) {
            logger.error({ planId: plan.id, orderId: plan.orderId }, 'Order not found for layby plan');
            throw new Error('ORDER_NOT_FOUND');
        }

        const paidCents = Math.round(Number(payment.amount) * 100);
        const balCents = Math.round(Number(plan.balanceRemaining) * 100);
        const appliedCents = Math.min(paidCents, balCents);
        const newBalCents = Math.max(0, balCents - appliedCents);
        const applied = appliedCents / 100;
        const newBal = newBalCents / 100;

        const flexBalance = isFlexibleBalanceInstallment(plan, installment);

        if (flexBalance && newBal > 0) {
            // Partial payment: reduce installment amount but keep it pending so the
            // customer can continue paying. Only mark 'paid' when balance reaches zero.
            installment.amount = newBal;
            installment.paymentId = payment.id;
            await installment.save({ transaction: t });

            plan.balanceRemaining = newBal;
            plan.nextDueAt = installment.dueAt;
            await plan.save({ transaction: t });

            order.paymentStatus = 'processing';
            order.status = 'payment_pending';
            if (payment.lencoTransactionId || payment.transactionId) {
                order.transactionId = payment.lencoTransactionId || payment.transactionId;
            }
            order.history = order.history || [];
            order.history.push({
                status: order.status,
                paymentStatus: order.paymentStatus,
                notes: `Layby payment received (${applied} ZMW); balance remaining ${newBal}`,
                updatedBy: 'system',
                updatedAt: new Date().toISOString(),
                source: 'layby_payment'
            });
            await order.save({ transaction: t });

            logger.info(
                { orderNumber: order.orderNumber, planId: plan.id, newBal, partial: true },
                'Layby partial payment recorded'
            );

            return { order, plan, fullyPaid: false };
        }

        installment.status = 'paid';
        installment.paidAt = new Date();
        installment.paymentId = payment.id;
        await installment.save({ transaction: t });

        const nextPending = await LaybyPayment.findOne({
            where: { laybyPlanId: plan.id, status: { [Op.in]: ['pending', 'overdue'] } },
            order: [['sequence', 'ASC']],
            transaction: t
        });

        plan.balanceRemaining = newBal;
        plan.nextDueAt = nextPending ? nextPending.dueAt : null;

        const fullyPaid = newBal <= 0;
        if (fullyPaid) {
            plan.status = 'completed';
        }
        await plan.save({ transaction: t });

        order.paymentStatus = fullyPaid ? 'completed' : 'processing';
        order.status = fullyPaid ? 'paid' : 'payment_pending';
        if (payment.lencoTransactionId || payment.transactionId) {
            order.transactionId = payment.lencoTransactionId || payment.transactionId;
        }
        order.history = order.history || [];
        order.history.push({
            status: order.status,
            paymentStatus: order.paymentStatus,
            notes: fullyPaid
                ? 'Layby completed — full balance received'
                : `Layby installment received (${applied} ZMW); balance remaining ${newBal}`,
            updatedBy: 'system',
            updatedAt: new Date().toISOString(),
            source: 'layby_payment'
        });
        await order.save({ transaction: t });

        logger.info(
            { orderNumber: order.orderNumber, planId: plan.id, newBal, fullyPaid },
            'Layby installment recorded'
        );

        return { order, plan, fullyPaid };
    });
}

function getAdminActor(admin) {
    if (admin && admin.adminEmail) return String(admin.adminEmail);
    if (admin && admin.email) return String(admin.email);
    if (admin && admin.adminId) return `admin:${admin.adminId}`;
    if (admin && admin.id) return `admin:${admin.id}`;
    return 'admin';
}

function buildOfflinePaymentMetadata(admin, extra = {}) {
    return {
        source: 'layby_admin_offline',
        adminId: admin && (admin.adminId != null ? admin.adminId : admin.id != null ? admin.id : null),
        adminEmail: admin && (admin.adminEmail || admin.email) ? String(admin.adminEmail || admin.email) : null,
        ...extra
    };
}

/**
 * @param {import('sequelize').Transaction} t
 * @param {number} laybyPaymentId
 * @param {object} admin
 */
async function confirmInstallmentOfflineInTransaction(t, laybyPaymentId, admin) {
    const id = parseInt(String(laybyPaymentId), 10);

    const installment = await LaybyPayment.findByPk(id, {
        transaction: t,
        lock: t.LOCK.UPDATE
    });

    if (!installment) {
        return { error: 'NOT_FOUND' };
    }

    if (installment.status === 'paid') {
        return { alreadyApplied: true };
    }

    if (!['pending', 'overdue'].includes(installment.status)) {
        return { error: 'NOT_PENDING' };
    }

    const plan = await LaybyPlan.findByPk(installment.laybyPlanId, {
        transaction: t,
        lock: t.LOCK.UPDATE
    });

    if (!plan || plan.status !== 'active') {
        return { error: 'PLAN_NOT_ACTIVE' };
    }

    const isOfflinePlan = !!plan.offlineSaleId;
    let order = null;
    let offlineSale = null;
    let paymentRefNumber = null;

    if (isOfflinePlan) {
        offlineSale = await OfflineSale.findByPk(plan.offlineSaleId, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!offlineSale) {
            return { error: 'OFFLINE_SALE_NOT_FOUND' };
        }
        paymentRefNumber = offlineSale.saleNumber;
    } else {
        order = await Order.findByPk(plan.orderId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!order) {
            return { error: 'ORDER_NOT_FOUND' };
        }
        paymentRefNumber = order.orderNumber;
    }

    const balCents = Math.round(Number(plan.balanceRemaining) * 100);
    const capCents = Math.round(Number(installment.amount) * 100);
    const paidCents = Math.min(capCents, balCents);
    const newBalCents = Math.max(0, balCents - paidCents);
    const paidAmt = paidCents / 100;
    const newBal = newBalCents / 100;

    const now = new Date();
    const flexBalance = isFlexibleBalanceInstallment(plan, installment);
    const actor = getAdminActor(admin);

    if (flexBalance && newBal > 0) {
        installment.amount = newBal;
        installment.adminConfirmedAt = now;
        const offlinePayment = await Payment.create(
            {
                orderNumber: paymentRefNumber,
                paymentMethod: 'cash_on_delivery',
                amount: paidAmt,
                currency: 'ZMW',
                status: 'completed',
                completedAt: now,
                laybyPaymentId: installment.id,
                metadata: buildOfflinePaymentMetadata(admin, {
                    partial: true,
                    offlineSaleId: isOfflinePlan ? plan.offlineSaleId : null
                })
            },
            { transaction: t }
        );
        installment.paymentId = offlinePayment.id;
        await installment.save({ transaction: t });

        plan.balanceRemaining = newBal;
        plan.nextDueAt = installment.dueAt;
        await plan.save({ transaction: t });

        if (order) {
            order.paymentStatus = 'processing';
            order.status = 'payment_pending';
            order.history = order.history || [];
            order.history.push({
                status: order.status,
                paymentStatus: order.paymentStatus,
                notes: `Layby installment confirmed offline (${paidAmt} ZMW); balance remaining ${newBal}`,
                updatedBy: actor,
                updatedAt: new Date().toISOString(),
                source: 'layby_admin_offline'
            });
            await order.save({ transaction: t });
        }

        logger.info(
            {
                laybyPaymentId: id,
                planId: plan.id,
                ref: paymentRefNumber,
                newBal,
                partial: true,
                actor,
                offline: isOfflinePlan
            },
            'Layby partial offline installment recorded'
        );

        return { plan, order, offlineSale, fullyPaid: false, paidAmt, newBal };
    }

    installment.status = 'paid';
    installment.paidAt = now;
    installment.adminConfirmedAt = now;
    await installment.save({ transaction: t });

    const offlinePayment = await Payment.create(
        {
            orderNumber: paymentRefNumber,
            paymentMethod: 'cash_on_delivery',
            amount: paidAmt,
            currency: 'ZMW',
            status: 'completed',
            completedAt: now,
            laybyPaymentId: installment.id,
            metadata: buildOfflinePaymentMetadata(admin, {
                offlineSaleId: isOfflinePlan ? plan.offlineSaleId : null
            })
        },
        { transaction: t }
    );

    installment.paymentId = offlinePayment.id;
    await installment.save({ transaction: t });

    const nextPending = await LaybyPayment.findOne({
        where: { laybyPlanId: plan.id, status: { [Op.in]: ['pending', 'overdue'] } },
        order: [['sequence', 'ASC']],
        transaction: t
    });

    plan.balanceRemaining = newBal;
    plan.nextDueAt = nextPending ? nextPending.dueAt : null;

    const fullyPaid = newBal <= 0;
    if (fullyPaid) {
        plan.status = 'completed';
    }
    await plan.save({ transaction: t });

    if (order) {
        order.paymentStatus = fullyPaid ? 'completed' : 'processing';
        order.status = fullyPaid ? 'paid' : 'payment_pending';
        order.history = order.history || [];
        order.history.push({
            status: order.status,
            paymentStatus: order.paymentStatus,
            notes: fullyPaid
                ? 'Layby completed — offline/admin confirmed final installment'
                : `Layby installment confirmed offline (${paidAmt} ZMW); balance remaining ${newBal}`,
            updatedBy: actor,
            updatedAt: new Date().toISOString(),
            source: 'layby_admin_offline'
        });
        await order.save({ transaction: t });
    }

    logger.info(
        {
            laybyPaymentId: id,
            planId: plan.id,
            ref: paymentRefNumber,
            newBal,
            fullyPaid,
            actor,
            offline: isOfflinePlan
        },
        'Layby installment confirmed offline by admin'
    );

    return { plan, order, offlineSale, fullyPaid, paidAmt, newBal };
}

/**
 * Admin-only: mark a pending installment paid (cash / bank offline / in-store) without a Lenco Payment row.
 * Sets adminConfirmedAt, reduces plan balance, updates order status when linked to an online order.
 * Idempotent if the installment is already paid.
 *
 * @param {number} laybyPaymentId
 * @param {{ adminId?: number, adminEmail?: string, id?: number, email?: string }} admin
 * @param {{ transaction?: import('sequelize').Transaction }} [opts]
 * @returns {Promise<{ alreadyApplied?: true, plan?: *, order?: *, fullyPaid?: boolean, error?: string }>}
 */
async function confirmInstallmentOffline(laybyPaymentId, admin, opts = {}) {
    const id = parseInt(String(laybyPaymentId), 10);
    if (Number.isNaN(id)) {
        return { error: 'INVALID_ID' };
    }

    const run = async (t) => confirmInstallmentOfflineInTransaction(t, id, admin);

    try {
        const result = opts.transaction ? await run(opts.transaction) : await sequelize.transaction(run);

        if (result && !result.error && result.order) {
            emailService
                .sendLaybyInstallmentConfirmedEmail({
                    order: result.order.toJSON ? result.order.toJSON() : result.order,
                    paidAmt: result.paidAmt,
                    balanceRemaining: result.newBal,
                    fullyPaid: result.fullyPaid
                })
                .catch((err) =>
                    logger.error({ err, laybyPaymentId: id }, 'Failed to send layby installment confirmation email')
                );
        }

        return result;
    } catch (err) {
        logger.error({ err, laybyPaymentId: id }, 'confirmInstallmentOffline failed');
        return { error: 'TRANSACTION_FAILED' };
    }
}

/**
 * Cancel an active layby plan and restore stock that was reserved at layby order creation.
 * Idempotent for already-cancelled plans; refuses completed plans.
 *
 * @param {number} planId
 * @param {{ actor?: string, source?: string, reason?: string }} opts
 */
async function cancelLaybyPlan(planId, opts = {}) {
    const id = parseInt(String(planId), 10);
    if (Number.isNaN(id)) {
        return { error: 'INVALID_ID' };
    }

    const actor = opts.actor || 'system';
    const source = opts.source || 'layby_cancel';
    const reason = opts.reason || 'Layby plan cancelled';

    const result = await sequelize.transaction(async (t) => {
        const plan = await LaybyPlan.findByPk(id, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!plan) {
            return { error: 'NOT_FOUND' };
        }
        if (plan.status === 'cancelled') {
            return { alreadyCancelled: true, plan };
        }
        if (plan.status === 'completed') {
            return { error: 'PLAN_COMPLETED' };
        }

        const order = plan.orderId
            ? await Order.findByPk(plan.orderId, { transaction: t, lock: t.LOCK.UPDATE })
            : null;
        if (order) {
            await restoreStockFromLineItems(order.items || [], t);

            order.status = 'cancelled';
            order.history = Array.isArray(order.history) ? [...order.history] : [];
            order.history.push({
                status: order.status,
                paymentStatus: order.paymentStatus,
                notes: reason,
                updatedBy: actor,
                updatedAt: new Date().toISOString(),
                source
            });
            await order.save({ transaction: t });
        } else if (plan.offlineSaleId) {
            const offlineSale = await OfflineSale.findByPk(plan.offlineSaleId, {
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            if (offlineSale) {
                const items = offlineSale.items || [];
                await restoreStockFromLineItems(items, t);
            }
        }

        plan.status = 'cancelled';
        await plan.save({ transaction: t });

        await LaybyPayment.update(
            { status: 'cancelled' },
            {
                where: {
                    laybyPlanId: id,
                    status: { [Op.in]: ['pending', 'overdue'] }
                },
                transaction: t
            }
        );

        const refLabel = order?.orderNumber || (plan.offlineSaleId ? `offline:${plan.offlineSaleId}` : null);
        logger.info({ planId: id, ref: refLabel, actor, source }, 'Layby plan cancelled');
        return { plan, order };
    });

    // Fire cancellation email for online orders only (offline/walk-in plans have no customer email).
    if (result && !result.error && !result.alreadyCancelled && result.order) {
        const orderJson = result.order.toJSON ? result.order.toJSON() : result.order;
        if (orderJson.customer?.email) {
            emailService
                .sendLaybyCancellationEmail({ order: orderJson, reason })
                .catch((err) =>
                    logger.error({ err, planId: id }, 'Failed to send layby cancellation email')
                );
        }
    }

    return result;
}

module.exports = {
    createLaybyPlanAndPayments,
    createFlexibleLaybyPlanAndPayments,
    recordLaybyInstallmentPaid,
    confirmInstallmentOffline,
    confirmInstallmentOfflineInTransaction,
    cancelLaybyPlan,
    clampDepositPercent,
    isFlexibleBalanceInstallment,
    MIN_PCT,
    MAX_PCT,
    INSTALLMENT_COUNT,
    PLAN_PERIOD_DAYS,
    USE_SCHEDULED_INSTALLMENTS
};