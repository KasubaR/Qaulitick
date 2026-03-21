// Admin layby plan detail

function setupSidebar() {
    const currentPath = window.location.pathname;
    document.querySelectorAll('.nav-item').forEach((item) => {
        if (item.getAttribute('href') === currentPath) {
            item.classList.add('active');
        }
    });
}

function toggleSidebar() {
    const sidebar = document.querySelector('.admin-sidebar');
    if (sidebar) sidebar.classList.toggle('active');
}

function notify(message, type) {
    if (window.showNotification) {
        window.showNotification(message, type || 'info');
    } else {
        window.alert(message);
    }
}

function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function showError(msg) {
    const el = document.getElementById('laybyDetailError');
    const content = document.getElementById('laybyDetailContent');
    if (el) {
        el.textContent = msg || '';
        el.classList.toggle('layby-detail-alert--hidden', !msg);
    }
    if (content && msg) {
        content.classList.add('layby-detail-content--hidden');
    }
}

function hideError() {
    const el = document.getElementById('laybyDetailError');
    const content = document.getElementById('laybyDetailContent');
    if (el) {
        el.textContent = '';
        el.classList.add('layby-detail-alert--hidden');
    }
    if (content) {
        content.classList.remove('layby-detail-content--hidden');
    }
}

function renderInstallments(rows, planStatus) {
    const body = document.getElementById('installmentsBody');
    if (!body) return;
    body.textContent = '';

    rows.forEach((row) => {
        const tr = document.createElement('tr');
        const pay = row.payment;
        const paySummary = pay
            ? `${pay.status}${pay.lencoReference ? ` (${pay.lencoReference})` : ''}`
            : '—';

        [String(row.sequence), `${row.amount}`, formatDate(row.dueAt), row.status, formatDate(row.adminConfirmedAt), paySummary].forEach(
            (text) => {
                const td = document.createElement('td');
                td.textContent = text;
                tr.appendChild(td);
            }
        );

        const tdBtn = document.createElement('td');
        if (row.status === 'pending' && planStatus === 'active') {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-outline layby-confirm-offline-btn';
            btn.setAttribute('data-installment-id', String(row.id));
            btn.textContent = 'Confirm offline';
            tdBtn.appendChild(btn);
        } else {
            tdBtn.textContent = '—';
        }
        tr.appendChild(tdBtn);

        body.appendChild(tr);
    });
}

function fillSummary(plan) {
    const order = plan.order || {};
    const user = plan.user || {};
    document.getElementById('detailPlanIdLabel').textContent = String(plan.id);
    document.getElementById('summaryOrderNumber').textContent = order.orderNumber || '—';
    document.getElementById('summaryCheckout').textContent = order.checkoutMode || '—';
    const cust = [user.name, user.email].filter(Boolean).join(' · ');
    document.getElementById('summaryCustomer').textContent = cust || '—';
    document.getElementById('summaryPlanStatus').textContent = plan.status || '—';
    document.getElementById('summaryBalance').textContent = `${plan.balanceRemaining} / ${plan.orderTotal} ${plan.currency || 'ZMW'}`;
    document.getElementById('summaryNextDue').textContent = formatDate(plan.nextDueAt);

    const sel = document.getElementById('planStatusSelect');
    if (sel && plan.status) {
        sel.value = plan.status;
    }
}

async function loadPlan(planId) {
    try {
        const data = await window.AdminLaybyAPI.getPlan(planId);
        const plan = data.plan;
        if (!plan) {
            showError('Plan not found.');
            return;
        }
        hideError();
        fillSummary(plan);
        renderInstallments(plan.laybyPayments || [], plan.status);
    } catch (e) {
        showError(e.message || 'Failed to load plan');
        notify(e.message || 'Failed to load plan', 'error');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const ok = await window.AuthUtils?.initializeAuthCheck();
    if (!ok) return;

    setupSidebar();

    const main = document.getElementById('laybyDetailMain');
    const planId = main && main.dataset.planId ? parseInt(main.dataset.planId, 10) : NaN;
    if (Number.isNaN(planId)) {
        showError('Invalid plan id.');
        return;
    }

    document.getElementById('sidebarToggle')?.addEventListener('click', toggleSidebar);
    document.getElementById('refreshDetailBtn')?.addEventListener('click', () => loadPlan(planId));

    document.getElementById('savePlanStatusBtn')?.addEventListener('click', async () => {
        const sel = document.getElementById('planStatusSelect');
        const status = sel && sel.value;
        if (!status) return;
        try {
            await window.AdminLaybyAPI.updatePlanStatus(planId, status);
            notify('Plan status updated', 'success');
            await loadPlan(planId);
        } catch (e) {
            notify(e.message || 'Could not update status', 'error');
        }
    });

    document.getElementById('installmentsBody')?.addEventListener('click', async (e) => {
        const btn = e.target.closest('.layby-confirm-offline-btn');
        if (!btn) return;
        const iid = parseInt(btn.getAttribute('data-installment-id'), 10);
        if (Number.isNaN(iid)) return;
        const sure = window.confirm(
            'Record this installment as paid offline (cash / bank / in-store)? This cannot be undone.'
        );
        if (!sure) return;
        btn.disabled = true;
        try {
            const out = await window.AdminLaybyAPI.confirmInstallmentOffline(iid);
            if (out.alreadyApplied) {
                notify(out.message || 'Already paid', 'info');
            } else {
                notify(out.fullyPaid ? 'Plan fully paid.' : 'Installment recorded.', 'success');
            }
            await loadPlan(planId);
        } catch (err) {
            notify(err.message || 'Confirm failed', 'error');
        } finally {
            btn.disabled = false;
        }
    });

    loadPlan(planId);
});
