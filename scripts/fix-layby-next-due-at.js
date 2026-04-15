/**
 * One-time migration: fix stale nextDueAt on LaybyPlan rows.
 *
 * Before bugs #1/#2 were fixed, createLaybyPlanAndPayments always wrote
 * nextDueAt: now (creation timestamp) instead of the actual next due date.
 * This script corrects every plan row in the DB:
 *
 *   - Finds the earliest unpaid installment (status 'pending' or 'overdue',
 *     sequence > 1) for each plan and sets nextDueAt to its dueAt.
 *   - If no such installment exists (all paid), sets nextDueAt to null.
 *
 * Sequence 1 (deposit) is excluded — it is due on creation and is not a
 * future scheduled date.
 *
 * Safe to re-run: uses the same idempotent logic each time.
 *
 * Usage: node scripts/fix-layby-next-due-at.js
 */

require('dotenv').config();

const { sequelize } = require('../src/config/mysql');
const { Op } = require('sequelize');
require('../src/models'); // register all models

const { LaybyPlan, LaybyPayment } = sequelize.models;

async function run() {
    await sequelize.authenticate();
    console.log('[Migration] Connected to database');

    const plans = await LaybyPlan.findAll();
    console.log(`[Migration] Found ${plans.length} layby plan(s) to process`);

    let updated = 0;
    let skipped = 0;

    for (const plan of plans) {
        const nextInstallment = await LaybyPayment.findOne({
            where: {
                laybyPlanId: plan.id,
                sequence: { [Op.gt]: 1 },
                status: { [Op.in]: ['pending', 'overdue'] }
            },
            order: [['sequence', 'ASC']]
        });

        const correctDueAt = nextInstallment ? nextInstallment.dueAt : null;

        // Skip if already correct (avoids unnecessary writes on re-runs)
        const currentDueAt = plan.nextDueAt ? new Date(plan.nextDueAt).getTime() : null;
        const targetDueAt = correctDueAt ? new Date(correctDueAt).getTime() : null;

        if (currentDueAt === targetDueAt) {
            skipped++;
            continue;
        }

        await plan.update({ nextDueAt: correctDueAt });
        console.log(
            `[Migration] Plan ${plan.id}: ${plan.nextDueAt ? new Date(plan.nextDueAt).toISOString() : 'null'} → ${correctDueAt ? new Date(correctDueAt).toISOString() : 'null'}`
        );
        updated++;
    }

    console.log(`[Migration] Done — ${updated} updated, ${skipped} already correct`);
    await sequelize.close();
}

run().catch(err => {
    console.error('[Migration] Fatal error:', err);
    process.exit(1);
});
