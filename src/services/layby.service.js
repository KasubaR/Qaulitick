/**
 * Layby (installment) plans: schedule math and payment completion side effects.
 *
 * Env (documented defaults):
 * - LAYBY_MIN_DEPOSIT_PERCENT (default 20) — server clamps client input to [min, max]
 * - LAYBY_MAX_DEPOSIT_PERCENT (default 50)
 * - LAYBY_INSTALLMENT_COUNT (default 4) — equal weekly slices of (orderTotal - deposit)
 * - LAYBY_INSTALLMENT_INTERVAL_DAYS (default 7) — days between due dates after deposit
 *
 * Order totals are always computed server-side before calling createLaybyPlanAndPayments.
 */

const { sequelize } = require('../config/mysql');
const { LaybyPlan, LaybyPayment, Order } = require('../models');
const logger = require('../utils/logger').child({ module: 'LaybyService' });

const MIN_PCT = parseFloat(process.env.LAYBY_MIN_DEPOSIT_PERCENT || '20', 10);
const MAX_PCT = parseFloat(process.env.LAYBY_MAX_DEPOSIT_PERCENT || '50', 10);
const INSTALLMENT_COUNT = Math.max(1, parseInt(process.env.LAYBY_INSTALLMENT_COUNT || '4', 10));
const INTERVAL_DAYS = Math.max(1, parseInt(process.env.LAYBY_INSTALLMENT_INTERVAL_DAYS || '7', 10));

function roundMoney2(x) {
    return Math.round(Number(x) * 100) / 100;
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
    const sliceCents = splitCents(balanceCents, INSTALLMENT_COUNT);

    const plan = await LaybyPlan.create(
        {
            orderId: order.id,
            userId,
            currency: 'ZMW',
            orderTotal: total,
            depositPercent: pct,
            depositAmount: deposit,
            balanceRemaining: total,
            installmentCount: INSTALLMENT_COUNT,
            installmentSchedule: {
                policy: 'equal_weekly_after_deposit',
                intervalDays: INTERVAL_DAYS,
                depositPercentClamped: pct
            },
            status: 'active',
            nextDueAt: new Date()
        },
        { transaction }
    );

    const rows = [];
    const now = new Date();

    rows.push({
        laybyPlanId: plan.id,
        sequence: 1,
        dueAt: now,
        amount: deposit,
        status: 'pending'
    });

    for (let i = 0; i < sliceCents.length; i++) {
        const amt = roundMoney2(sliceCents[i] / 100);
        const due = new Date(now.getTime() + (i + 1) * INTERVAL_DAYS * 86400000);
        rows.push({
            laybyPlanId: plan.id,
            sequence: i + 2,
            dueAt: due,
            amount: amt,
            status: 'pending'
        });
    }

    await LaybyPayment.bulkCreate(rows, { transaction });

    await plan.update({ nextDueAt: now }, { transaction });

    logger.info(
        { orderId: order.id, planId: plan.id, total, deposit, installments: INSTALLMENT_COUNT },
        'Layby plan created'
    );

    return plan;
}

/**
 * After a Lenco Payment row is marked completed, apply layby bookkeeping and order state.
 * Idempotent if installment already paid.
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

    const installment = await LaybyPayment.findByPk(payment.laybyPaymentId);
    if (!installment) {
        logger.warn({ laybyPaymentId: payment.laybyPaymentId }, 'LaybyPayment row missing');
        return null;
    }

    if (installment.status === 'paid') {
        return { alreadyApplied: true };
    }

    const plan = await LaybyPlan.findByPk(installment.laybyPlanId);
    if (!plan || plan.status !== 'active') {
        logger.warn({ planId: installment.laybyPlanId }, 'Layby plan missing or not active');
        return null;
    }

    const order = await Order.findByPk(plan.orderId);
    if (!order) return null;

    const paidAmt = roundMoney2(payment.amount);
    let newBal = roundMoney2(Number(plan.balanceRemaining) - paidAmt);
    if (newBal < 0) newBal = 0;

    installment.status = 'paid';
    installment.paidAt = new Date();
    installment.paymentId = payment.id;
    await installment.save();

    const nextPending = await LaybyPayment.findOne({
        where: { laybyPlanId: plan.id, status: 'pending' },
        order: [['sequence', 'ASC']]
    });

    plan.balanceRemaining = newBal;
    plan.nextDueAt = nextPending ? nextPending.dueAt : null;

    const fullyPaid = newBal <= 0;
    if (fullyPaid) {
        plan.status = 'completed';
    }
    await plan.save();

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
            : `Layby installment received (${paidAmt} ZMW); balance remaining ${newBal}`,
        updatedBy: 'system',
        updatedAt: new Date().toISOString(),
        source: 'layby_payment'
    });
    await order.save();

    logger.info(
        { orderNumber: order.orderNumber, planId: plan.id, newBal, fullyPaid },
        'Layby installment recorded'
    );

    return { order, plan, fullyPaid };
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
        return await sequelize.transaction(async (t) => {
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

            if (installment.status !== 'pending') {
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

            const paidAmt = roundMoney2(installment.amount);
            let newBal = roundMoney2(Number(plan.balanceRemaining) - paidAmt);
            if (newBal < 0) {
                newBal = 0;
            }

            const now = new Date();
            installment.status = 'paid';
            installment.paidAt = now;
            installment.adminConfirmedAt = now;
            await installment.save({ transaction: t });

            const nextPending = await LaybyPayment.findOne({
                where: { laybyPlanId: plan.id, status: 'pending' },
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

            return { plan, order, fullyPaid };
        });
    } catch (err) {
        logger.error({ err, laybyPaymentId: id }, 'confirmInstallmentOffline failed');
        return { error: 'TRANSACTION_FAILED' };
    }
}

module.exports = {
    createLaybyPlanAndPayments,
    recordLaybyInstallmentPaid,
    confirmInstallmentOffline,
    clampDepositPercent,
    MIN_PCT,
    MAX_PCT,
    INSTALLMENT_COUNT,
    INTERVAL_DAYS
};
