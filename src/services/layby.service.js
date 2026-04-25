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
const { LaybyPlan, LaybyPayment, Order, Payment, Product } = require('../models');
const logger = require('../utils/logger').child({ module: 'LaybyService' });
const emailService = require('./email.service');

function roundMoney2(x) {
    return Math.round(Number(x) * 100) / 100;
}

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
        const balanceDueAt = new Date(now.getTime() + PLAN_PERIOD_DAYS * 86400000);
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
                installmentCount: 1,
                installmentSchedule: {
                    policy: 'flexible_within_period',
                    planPeriodDays: PLAN_PERIOD_DAYS,
                    depositPercentClamped: pct
                },
                status: 'active',
                nextDueAt: balanceDueAt
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
        rows.push({
            laybyPlanId: plan.id,
            sequence: 2,
            dueAt: balanceDueAt,
            amount: balanceAfterDeposit,
            status: 'pending'
        });

        await LaybyPayment.bulkCreate(rows, { transaction });

        logger.info(
            { orderId: order.id, planId: plan.id, total, deposit, mode: 'flexible' },
            'Layby plan created'
        );
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
        if (!order) return null;

        const paidRaw = roundMoney2(payment.amount);
        const balBefore = roundMoney2(Number(plan.balanceRemaining));
        const applied = roundMoney2(Math.min(paidRaw, balBefore));
        let newBal = roundMoney2(balBefore - applied);
        if (newBal < 0) newBal = 0;

        const flexBalance = isFlexibleBalanceInstallment(plan, installment);

        if (flexBalance && newBal > 0) {
            // Partial payment: reduce installment amount but keep it pending so the
            // customer can continue paying. Only mark 'paid' when balance reaches zero.
            installment.amount = newBal;
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

/**
 * Admin-only: mark a pending installment paid (cash / bank offline / in-store) without a Lenco Payment row.
 * Sets adminConfirmedAt, reduces plan balance, updates order status using the same rules as Lenco completion.
 * Idempotent if the installment is already paid.
 *
 * @param {number} laybyPaymentId
 * @param {{ adminId: number, adminEmail: string }} admin
 * @returns {Promise<{ alreadyApplied?: true, plan?: *, order?: *, fullyPaid?: boolean, error?: string }>}
 */
async function confirmInstallmentOffline(laybyPaymentId, admin) {
    const id = parseInt(String(laybyPaymentId), 10);
    if (Number.isNaN(id)) {
        return { error: 'INVALID_ID' };
    }

    try {
        const result = await sequelize.transaction(async (t) => {
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

            const order = await Order.findByPk(plan.orderId, { transaction: t, lock: t.LOCK.UPDATE });
            if (!order) {
                return { error: 'ORDER_NOT_FOUND' };
            }

            const balBefore = roundMoney2(Number(plan.balanceRemaining));
            const installmentCap = roundMoney2(Number(installment.amount));
            const paidAmt = roundMoney2(Math.min(installmentCap, balBefore));
            let newBal = roundMoney2(balBefore - paidAmt);
            if (newBal < 0) {
                newBal = 0;
            }

            const now = new Date();
            const flexBalance = isFlexibleBalanceInstallment(plan, installment);

            if (flexBalance && newBal > 0) {
                // Partial payment: reduce installment amount but keep it pending so the
                // customer can continue paying. Only mark 'paid' when balance reaches zero.
                installment.amount = newBal;
                installment.adminConfirmedAt = now;
                const offlinePayment = await Payment.create({
                    orderNumber: order.orderNumber,
                    paymentMethod: 'cash_on_delivery',
                    amount: paidAmt,
                    currency: 'ZMW',
                    status: 'completed',
                    completedAt: now,
                    laybyPaymentId: installment.id,
                    metadata: {
                        source: 'layby_admin_offline',
                        partial: true,
                        adminId: admin && admin.adminId ? admin.adminId : null,
                        adminEmail: admin && admin.adminEmail ? admin.adminEmail : null
                    }
                }, { transaction: t });
                installment.paymentId = offlinePayment.id;
                await installment.save({ transaction: t });

                plan.balanceRemaining = newBal;
                plan.nextDueAt = installment.dueAt;
                await plan.save({ transaction: t });

                const actor =
                    admin && admin.adminEmail
                        ? String(admin.adminEmail)
                        : admin && admin.adminId
                          ? `admin:${admin.adminId}`
                          : 'admin';

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

                logger.info(
                    { laybyPaymentId: id, planId: plan.id, orderNumber: order.orderNumber, newBal, partial: true, actor },
                    'Layby partial offline installment recorded'
                );

                return { plan, order, fullyPaid: false };
            }

            installment.status = 'paid';
            installment.paidAt = now;
            installment.adminConfirmedAt = now;
            await installment.save({ transaction: t });

            // Create an audit Payment record for the offline confirmation
            const offlinePayment = await Payment.create({
                orderNumber: order.orderNumber,
                paymentMethod: 'cash_on_delivery',
                amount: paidAmt,
                currency: 'ZMW',
                status: 'completed',
                completedAt: now,
                laybyPaymentId: installment.id,
                metadata: {
                    source: 'layby_admin_offline',
                    adminId: admin && admin.adminId ? admin.adminId : null,
                    adminEmail: admin && admin.adminEmail ? admin.adminEmail : null
                }
            }, { transaction: t });

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

            const actor =
                admin && admin.adminEmail ? String(admin.adminEmail) : admin && admin.adminId ? `admin:${admin.adminId}` : 'admin';

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

            logger.info(
                { laybyPaymentId: id, planId: plan.id, orderNumber: order.orderNumber, newBal, fullyPaid, actor },
                'Layby installment confirmed offline by admin'
            );

            return { plan, order, fullyPaid, paidAmt, newBal };
        });

        // Send customer email outside the transaction (fire-and-forget)
        if (result && !result.error && result.order) {
            emailService.sendLaybyInstallmentConfirmedEmail({
                order: result.order.toJSON ? result.order.toJSON() : result.order,
                paidAmt: result.paidAmt,
                balanceRemaining: result.newBal,
                fullyPaid: result.fullyPaid
            }).catch(err =>
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

    return sequelize.transaction(async (t) => {
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

        const order = await Order.findByPk(plan.orderId, { transaction: t, lock: t.LOCK.UPDATE });
        if (order) {
            const items = order.items || [];
            for (const item of items) {
                const qty = parseInt(item.quantity, 10) || 1;
                const productId = parseInt(item.productId, 10);
                if (!productId) continue;

                await Product.update(
                    { stock: sequelize.literal(`stock + ${qty}`) },
                    { where: { id: productId }, transaction: t }
                );
            }

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
        }

        plan.status = 'cancelled';
        await plan.save({ transaction: t });

        logger.info({ planId: id, orderNumber: order?.orderNumber, actor, source }, 'Layby plan cancelled');
        return { plan, order };
    });
}

module.exports = {
    createLaybyPlanAndPayments,
    recordLaybyInstallmentPaid,
    confirmInstallmentOffline,
    cancelLaybyPlan,
    clampDepositPercent,
    isFlexibleBalanceInstallment,
    MIN_PCT,
    MAX_PCT,
    INSTALLMENT_COUNT,
    PLAN_PERIOD_DAYS,
    USE_SCHEDULED_INSTALLMENTS
};
