const Payment = require('../models/Payment.model');
const {
    applyPaymentStatusSideEffects,
    sendAdminPaymentNotificationOnce
} = require('./paymentCompletion.service');

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
        if (raw[k] !== undefined) out[k] = raw[k];
    }
    return out;
}

/**
 * Mutates payment row from DPO verifyToken outcome (plan-aligned mapper output).
 */
async function applyDpoVerificationOutcome(payment, outcome, rawResponse, sourceNote) {
    const compactRaw = compactDpoVerifyRaw(rawResponse);

    if (outcome.paid) {
        await payment.update({
            status: 'completed',
            completedAt: payment.completedAt || new Date(),
            gatewayResponse: compactRaw,
            lencoStatus: null
        });
        const fresh = await Payment.findByPk(payment.id);
        await applyPaymentStatusSideEffects(fresh, {
            source: sourceNote || 'DPO verify',
            note: 'Payment completed via DPO'
        });
        await sendAdminPaymentNotificationOnce(payment.id);
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

    await payment.update({ gatewayResponse: compactRaw });
    return Payment.findByPk(payment.id);
}

module.exports = {
    compactDpoVerifyRaw,
    applyDpoVerificationOutcome
};
