const Payment = require('../models/Payment.model');
const {
    applyPaymentStatusSideEffects,
    sendAdminPaymentNotificationOnce
} = require('./paymentCompletion.service');
const logger = require('../utils/logger').child({ module: 'DpoPaymentOutcomeService' });

function compactDpoVerifyRaw(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    const pick = [
        'Result',
        'ResultExplanation',
        'TransRef',
        'TransactionPaymentDate',
        'CustomerName',
        'CustomerCredit'
    ];
    const out = {};
    for (const k of pick) {
        if (raw[k] != null) out[k] = raw[k];
    }
    return out;
}

/**
 * Mutates payment row from DPO verifyToken outcome (plan-aligned mapper output).
 */
async function applyDpoVerificationOutcome(payment, outcome, rawResponse, sourceNote) {
    const compactRaw = compactDpoVerifyRaw(rawResponse);

    if (outcome.paid) {
        const [affected] = await Payment.update(
            {
                status: 'completed',
                completedAt: new Date(),
                gatewayResponse: compactRaw,
                lencoStatus: null
            },
            { where: { id: payment.id, status: ['pending', 'processing'] } }
        );
        const fresh = await Payment.findByPk(payment.id);
        if (affected === 0) return fresh; // already completed by a concurrent call
        try {
            await applyPaymentStatusSideEffects(fresh, {
                source: sourceNote || 'DPO verify',
                note: 'Payment completed via DPO'
            });
            await sendAdminPaymentNotificationOnce(payment.id);
        } catch (sideEffectErr) {
            // Payment is genuinely completed in the DB — do not let side-effect
            // failures obscure that or cause the caller to retry the completion.
            logger.error(
                { err: sideEffectErr, paymentId: payment.id },
                'DPO payment marked completed but side effects failed — manual follow-up may be required'
            );
        }
        return fresh;
    }

    if (!outcome.terminal) {
        await payment.update({
            gatewayResponse: compactRaw
        });
        return Payment.findByPk(payment.id);
    }

    const terminalStatuses = ['expired_or_missing', 'cancelled', 'ptl_expired', 'gateway_error'];
    const shouldCancel = terminalStatuses.includes(outcome.kind);
    if (shouldCancel) {
        const reason = outcome.explanation || `DPO ${outcome.kind}`;
        await payment.update({
            status: 'cancelled',
            cancelledAt: new Date(),
            failureReason: reason,
            gatewayResponse: compactRaw
        });
        const fresh = await Payment.findByPk(payment.id);
        await applyPaymentStatusSideEffects(fresh, {
            source: sourceNote || 'DPO verify',
            note: `Payment cancelled: ${reason}`
        });
        return fresh;
    }

    logger.warn(
        { paymentId: payment.id, result: outcome.result, kind: outcome.kind },
        'DPO unknown result code — payment left in current status, manual review required'
    );
    await payment.update({ gatewayResponse: compactRaw });
    return Payment.findByPk(payment.id);
}

module.exports = {
    compactDpoVerifyRaw,
    applyDpoVerificationOutcome
};
