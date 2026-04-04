/**
 * One-time script: revert an accidentally confirmed layby installment.
 * Order: ORD-29032026-000013
 *
 * Usage: node scripts/revert-layby-confirm.js
 *
 * What it undoes:
 *   1. Deletes the Payment record created by the offline confirmation
 *   2. Reverts the LaybyPayment installment back to 'pending'
 *   3. Restores the LaybyPlan balanceRemaining and status
 *   4. Restores the Order paymentStatus and status to their pre-confirmation values
 */

require('dotenv').config();

const { sequelize } = require('../src/config/mysql');
require('../src/models'); // register all models

const { Payment, LaybyPayment, LaybyPlan, Order } = sequelize.models;

const ORDER_NUMBER = 'ORD-29032026-000013';

async function main() {
    await sequelize.authenticate();
    console.log('DB connected.\n');

    await sequelize.transaction(async (t) => {
        // 1. Find the offline Payment record for this order
        const payment = await Payment.findOne({
            where: { orderNumber: ORDER_NUMBER, status: 'completed' },
            order: [['createdAt', 'DESC']],
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!payment) {
            throw new Error(`No completed Payment record found for ${ORDER_NUMBER}`);
        }

        const metadata = payment.metadata || {};
        if (metadata.source !== 'layby_admin_offline') {
            throw new Error(`Payment ${payment.id} source is "${metadata.source}", not layby_admin_offline — aborting to be safe`);
        }

        console.log(`Found Payment id=${payment.id}, amount=${payment.amount}, source=${metadata.source}`);

        // 2. Find the LaybyPayment installment linked to this Payment
        const installment = await LaybyPayment.findOne({
            where: { paymentId: payment.id },
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!installment) {
            throw new Error(`No LaybyPayment found with paymentId=${payment.id}`);
        }

        console.log(`Found LaybyPayment id=${installment.id}, amount=${installment.amount}, status=${installment.status}`);

        const paidAmt = Number(installment.amount);

        // 3. Find the LaybyPlan
        const plan = await LaybyPlan.findByPk(installment.laybyPlanId, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!plan) {
            throw new Error(`No LaybyPlan found with id=${installment.laybyPlanId}`);
        }

        console.log(`Found LaybyPlan id=${plan.id}, status=${plan.status}, balanceRemaining=${plan.balanceRemaining}`);

        // 4. Find the Order
        const order = await Order.findOne({
            where: { orderNumber: ORDER_NUMBER },
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!order) {
            throw new Error(`Order ${ORDER_NUMBER} not found`);
        }

        console.log(`Found Order status=${order.status}, paymentStatus=${order.paymentStatus}`);

        // --- Apply reversals ---

        // Revert LaybyPayment installment
        installment.status = 'pending';
        installment.paidAt = null;
        installment.adminConfirmedAt = null;
        installment.paymentId = null;
        await installment.save({ transaction: t });
        console.log(`Reverted LaybyPayment ${installment.id} back to pending`);

        // Restore LaybyPlan balance and status
        const restoredBalance = Math.round((Number(plan.balanceRemaining) + paidAmt) * 100) / 100;
        plan.balanceRemaining = restoredBalance;
        plan.nextDueAt = installment.dueAt;
        if (plan.status === 'completed') {
            plan.status = 'active';
        }
        await plan.save({ transaction: t });
        console.log(`Restored LaybyPlan balance to ${restoredBalance}, status=${plan.status}`);

        // Restore Order status
        order.paymentStatus = 'pending';
        order.status = 'pending';
        order.history = order.history || [];
        order.history.push({
            status: 'pending',
            paymentStatus: 'pending',
            notes: 'Reverted accidental offline layby confirmation (admin script)',
            updatedBy: 'admin:revert-script',
            updatedAt: new Date().toISOString(),
            source: 'revert_script'
        });
        await order.save({ transaction: t });
        console.log(`Restored Order status=pending, paymentStatus=pending`);

        // Delete the erroneously created Payment record
        await payment.destroy({ transaction: t });
        console.log(`Deleted Payment record id=${payment.id}`);

        console.log('\nAll changes applied within transaction — committing...');
    });

    console.log('\nDone. Layby installment reverted successfully.');
    process.exit(0);
}

main().catch((err) => {
    console.error('\nFailed — no changes were committed:\n', err.message);
    process.exit(1);
});
