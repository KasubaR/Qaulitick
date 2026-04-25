'use strict';

function roundMoney2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

function parseSchedule(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }
    return raw && typeof raw === 'object' ? raw : null;
}

function formatDateLabel(value) {
    if (!value) return 'No due date';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 'No due date' : d.toLocaleDateString('en-ZM');
}

function isPast(value) {
    if (!value) return false;
    const d = new Date(value);
    return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}

function getPaymentStatusLabel(status) {
    const labels = {
        pending: 'Payment started',
        processing: 'Awaiting provider confirmation',
        completed: 'Payment received',
        failed: 'Payment failed',
        cancelled: 'Payment cancelled',
        refunded: 'Refunded'
    };
    return labels[String(status || '').toLowerCase()] || 'No payment attempt';
}

function getPaymentSourceLabel(payment) {
    if (!payment) return 'None';
    const metadata = parseSchedule(payment.metadata) || {};
    if (metadata.source === 'layby_admin_offline') return 'Admin offline';
    const method = String(payment.paymentMethod || '').toLowerCase();
    if (method === 'mobile_money') return 'Mobile money';
    if (method === 'bank_transfer') return 'Bank transfer';
    if (method === 'cash_on_delivery') return 'Admin offline';
    return method ? method.replace(/_/g, ' ') : 'Payment record';
}

function getInstallmentStatusLabel(row) {
    const status = String(row?.status || '').toLowerCase();
    if (status === 'pending') return Number(row?.sequence) === 1 ? 'Deposit due' : 'Payment due';
    if (status === 'overdue') return 'Overdue payment';
    if (status === 'paid') return 'Paid';
    if (status === 'waived') return 'Waived';
    return status || 'Unknown';
}

function getPlanStatusLabel(plan, nextPayable) {
    const status = String(plan?.status || '').toLowerCase();
    if (status === 'completed') return 'Fully paid';
    if (status === 'cancelled') return 'Cancelled layby';
    if (nextPayable?.status === 'overdue' || isPast(nextPayable?.dueAt)) return 'Active layby - overdue payment';
    if (Number(plan?.balanceRemaining) > 0) return 'Active layby - balance outstanding';
    return 'Active layby';
}

function getArrangementLabel(plan) {
    const schedule = parseSchedule(plan?.installmentSchedule);
    if (schedule?.policy === 'flexible_within_period') {
        const days = schedule.planPeriodDays ? Number(schedule.planPeriodDays) : null;
        return days ? `Flexible balance within ${days} days` : 'Flexible balance plan';
    }
    if (schedule?.policy === 'equal_interval_after_deposit') {
        const count = Number(plan?.installmentCount) || 0;
        const interval = Number(schedule.intervalDays) || null;
        return interval
            ? `${count} scheduled installment${count === 1 ? '' : 's'}, every ${interval} days`
            : `${count} scheduled installment${count === 1 ? '' : 's'}`;
    }
    if (schedule?.policy === 'equal_slices_within_period') {
        const count = Number(plan?.installmentCount) || 0;
        const days = Number(schedule.planPeriodDays) || null;
        return days
            ? `${count} scheduled installment${count === 1 ? '' : 's'} within ${days} days`
            : `${count} scheduled installment${count === 1 ? '' : 's'}`;
    }
    return 'Layby payment arrangement';
}

function getNextActionLabel(plan, nextPayable) {
    if (plan?.status === 'completed') return 'No action - fully paid';
    if (plan?.status === 'cancelled') return 'No action - cancelled';
    if (!nextPayable) return 'No payment due';
    if (Number(nextPayable.sequence) === 1) return 'Pay deposit';
    const schedule = parseSchedule(plan?.installmentSchedule);
    if (schedule?.policy === 'flexible_within_period') return 'Make a layby payment';
    return `Pay installment #${nextPayable.sequence}`;
}

function enrichInstallment(row) {
    const payment = row.payment || null;
    const paymentStatus = payment?.status || null;
    const providerLabel = getPaymentStatusLabel(paymentStatus);
    const sourceLabel = getPaymentSourceLabel(payment);
    return {
        ...row,
        displayStatus: getInstallmentStatusLabel(row),
        dueLabel: formatDateLabel(row.dueAt),
        isOverdue: row.status === 'overdue' || (row.status === 'pending' && isPast(row.dueAt) && Number(row.sequence) > 1),
        paymentSourceLabel: sourceLabel,
        providerStatusLabel: providerLabel,
        linkedPaymentLabel: payment ? `${sourceLabel} - ${providerLabel}` : 'No payment record'
    };
}

function enrichLaybyPlan(planInput) {
    const plan = planInput && typeof planInput.toJSON === 'function' ? planInput.toJSON() : { ...(planInput || {}) };
    const installments = Array.isArray(plan.laybyPayments) ? plan.laybyPayments.map(enrichInstallment) : [];
    const orderTotal = roundMoney2(plan.orderTotal);
    const balanceRemaining = roundMoney2(plan.balanceRemaining);
    const amountPaid = roundMoney2(Math.max(0, orderTotal - balanceRemaining));
    const progressPercent = orderTotal > 0 ? Math.min(100, roundMoney2((amountPaid / orderTotal) * 100)) : 0;
    const nextPayable = installments.find((row) => ['pending', 'overdue'].includes(row.status)) || null;
    const hasPaymentInProgress = installments.some((row) =>
        row.payment && ['pending', 'processing'].includes(String(row.payment.status || '').toLowerCase())
    );

    return {
        ...plan,
        laybyPayments: installments,
        amountPaid,
        progressPercent,
        laybyDisplayStatus: getPlanStatusLabel(plan, nextPayable),
        paymentArrangementLabel: getArrangementLabel(plan),
        nextActionLabel: getNextActionLabel(plan, nextPayable),
        nextDueLabel: nextPayable ? formatDateLabel(nextPayable.dueAt) : formatDateLabel(plan.nextDueAt),
        isOverdue: !!(nextPayable && (nextPayable.status === 'overdue' || nextPayable.isOverdue)),
        hasPaymentInProgress,
        nextPayableInstallmentId: nextPayable ? nextPayable.id : null
    };
}

module.exports = {
    enrichLaybyPlan,
    getInstallmentStatusLabel,
    getPaymentStatusLabel,
    getPaymentSourceLabel,
    getPlanStatusLabel
};
