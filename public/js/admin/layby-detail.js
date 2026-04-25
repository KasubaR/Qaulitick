// Admin layby plan detail

/**
 * Show an in-page confirmation modal instead of window.confirm().
 * Returns a Promise that resolves true (confirmed) or false (cancelled).
 */
function showConfirmModal(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const body  = document.getElementById('confirmModalBody');
        const okBtn = document.getElementById('confirmModalOk');
        const cancelBtn = document.getElementById('confirmModalCancel');
        if (!modal || !body || !okBtn || !cancelBtn) {
            // Fallback if markup is missing (should never happen)
            resolve(false);
            return;
        }

        body.textContent = message;
        modal.style.display = 'flex';
        okBtn.focus();

        function cleanup(result) {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('keydown', onKey);
            resolve(result);
        }
        function onOk()     { cleanup(true);  }
        function onCancel() { cleanup(false); }
        function onKey(e) {
            if (e.key === 'Escape') cleanup(false);
        }

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        modal.addEventListener('keydown', onKey);
    });
}

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

function escapeHtml(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
}

function formatZmw(n) {
    const x = Number(n);
    if (Number.isNaN(x)) return '—';
    return `K${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Line items + totals from the linked order (admin layby detail).
 */
function renderOrderSummary(order) {
    const el = document.getElementById('summaryOrderSummary');
    if (!el) return;

    const items = Array.isArray(order.items) ? order.items : [];
    const t = order.totals || {};
    const hasLines = items.length > 0;
    const hasTotals =
        t.subtotal != null ||
        t.total != null ||
        t.delivery != null ||
        (t.discount != null && Number(t.discount) > 0);

    if (!hasLines && !hasTotals) {
        el.classList.add('layby-order-summary--hidden');
        el.innerHTML = '';
        return;
    }

    el.classList.remove('layby-order-summary--hidden');

    let linesHtml = '';
    items.forEach((it) => {
        const name = it.name || 'Item';
        const qty = it.quantity || 1;
        const price = Number(it.price) || 0;
        const line = price * qty;
        linesHtml +=
            '<li class="layby-order-summary__line">' +
            '<span class="layby-order-summary__line-name">' +
            escapeHtml(name) +
            '<span class="layby-order-summary__line-meta">× ' +
            String(qty) +
            '</span></span>' +
            '<span class="layby-order-summary__line-price">' +
            formatZmw(line) +
            '</span></li>';
    });

    let totalsHtml = '<div class="layby-order-summary__totals">';
    if (t.subtotal != null) {
        totalsHtml +=
            '<div class="layby-order-summary__total-row"><span>Subtotal</span><span>' +
            formatZmw(t.subtotal) +
            '</span></div>';
    }
    if (t.discount != null && Number(t.discount) > 0) {
        totalsHtml +=
            '<div class="layby-order-summary__total-row"><span>Discount</span><span>− ' +
            formatZmw(t.discount) +
            '</span></div>';
    }
    if (t.delivery != null) {
        totalsHtml +=
            '<div class="layby-order-summary__total-row"><span>Delivery</span><span>' +
            formatZmw(t.delivery) +
            '</span></div>';
    }
    if (t.total != null) {
        totalsHtml +=
            '<div class="layby-order-summary__total-row layby-order-summary__total-row--strong"><span>Order total</span><span>' +
            formatZmw(t.total) +
            '</span></div>';
    }
    totalsHtml += '</div>';

    el.innerHTML =
        '<h4 class="layby-order-summary__title">Order summary</h4>' +
        (hasLines ? '<ul class="layby-order-summary__lines">' + linesHtml + '</ul>' : '') +
        (hasTotals ? totalsHtml : '');
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

function installmentPaySummary(row) {
    const pay = row.payment;
    return pay ? `${row.providerStatusLabel || pay.status}${pay.lencoReference ? ` (${pay.lencoReference})` : ''}` : 'No provider payment';
}

function buildInstallmentRow(row, planStatus) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-installment-id', String(row.id));

    [
        String(row.sequence),
        formatZmw(row.amount),
        row.dueLabel || formatDate(row.dueAt),
        row.displayStatus || row.status,
        formatDate(row.adminConfirmedAt),
        row.paymentSourceLabel || 'None',
        installmentPaySummary(row)
    ].forEach(
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
        btn.setAttribute('data-installment-amount', String(row.amount || ''));
        btn.textContent = 'Mark as paid offline';
        tdBtn.appendChild(btn);
    } else {
        tdBtn.textContent = '—';
    }
    tr.appendChild(tdBtn);
    return tr;
}

function updateInstallmentRow(tr, row, planStatus) {
    const texts = [
        String(row.sequence),
        formatZmw(row.amount),
        row.dueLabel || formatDate(row.dueAt),
        row.displayStatus || row.status,
        formatDate(row.adminConfirmedAt),
        row.paymentSourceLabel || 'None',
        installmentPaySummary(row)
    ];
    const tds = tr.querySelectorAll('td');
    for (let c = 0; c < 7; c++) {
        const td = tds[c];
        if (td && td.textContent !== texts[c]) {
            td.textContent = texts[c];
        }
    }
    const tdBtn = tds[7];
    if (!tdBtn) return;
    const wantBtn = row.status === 'pending' && planStatus === 'active';
    const btnEl = tdBtn.querySelector('.layby-confirm-offline-btn');
    if (wantBtn) {
        if (!btnEl || btnEl.getAttribute('data-installment-id') !== String(row.id)) {
            tdBtn.replaceChildren();
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-outline layby-confirm-offline-btn';
            btn.setAttribute('data-installment-id', String(row.id));
            btn.setAttribute('data-installment-amount', String(row.amount || ''));
            btn.textContent = 'Mark as paid offline';
            tdBtn.appendChild(btn);
        }
    } else if (btnEl || tdBtn.textContent !== '—') {
        tdBtn.textContent = '—';
    }
}

const INSTALLMENTS_REFRESH_MS = 160;

/**
 * Updates installment rows in place when order and ids match the previous render
 * to avoid clearing the tbody on every refresh. Opacity eases only for structural
 * changes and only when the tbody already had rows (skips first paint).
 */
function renderInstallments(rows, planStatus) {
    const body = document.getElementById('installmentsBody');
    if (!body) return;

    const hadAnyRows = body.childElementCount > 0;
    let easeActive = false;
    const startEase = () => {
        if (hadAnyRows && !easeActive) {
            easeActive = true;
            body.classList.add('layby-installments-body--refreshing');
        }
    };
    const finishEase = () => {
        if (easeActive) {
            window.setTimeout(() => body.classList.remove('layby-installments-body--refreshing'), INSTALLMENTS_REFRESH_MS);
        }
    };

    if (!rows.length) {
        if (hadAnyRows) startEase();
        body.replaceChildren();
        finishEase();
        return;
    }

    let diverged = false;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const tr = body.children[i];
        const idOk = tr && tr.getAttribute('data-installment-id') === String(row.id);
        if (!diverged && idOk) {
            updateInstallmentRow(tr, row, planStatus);
        } else {
            startEase();
            diverged = true;
            while (body.childElementCount > i) {
                body.removeChild(body.lastElementChild);
            }
            for (let j = i; j < rows.length; j++) {
                body.appendChild(buildInstallmentRow(rows[j], planStatus));
            }
            break;
        }
    }

    while (body.childElementCount > rows.length) {
        startEase();
        body.removeChild(body.lastElementChild);
    }

    finishEase();
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function fillSummary(plan) {
    const order = plan.order || {};
    const user = plan.user || {};
    setText('detailPlanIdLabel', String(plan.id));
    setText('summaryOrderNumber', order.orderNumber || '—');
    setText('summaryCheckout', order.checkoutMode || '—');
    const cust = [user.name, user.email].filter(Boolean).join(' · ');
    setText('summaryCustomer', cust || '—');
    setText('summaryPlanStatus', plan.laybyDisplayStatus || plan.status || '—');
    setText('summaryArrangement', plan.paymentArrangementLabel || '—');
    const cur = plan.currency || 'ZMW';
    setText(
        'summaryBalance',
        `${formatZmw(plan.balanceRemaining)} / ${formatZmw(plan.orderTotal)} ${cur}`
    );
    setText('summaryAmountPaid', `${formatZmw(plan.amountPaid)} ${cur}`);
    setText('summaryNextAction', plan.nextActionLabel || '—');
    setText('summaryNextDue', plan.nextDueLabel || formatDate(plan.nextDueAt));

    renderOrderSummary(order);

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
        const amount = btn.getAttribute('data-installment-amount');
        const sure = await showConfirmModal(
            `Mark ${amount ? formatZmw(amount) : 'this installment'} as paid offline (cash / bank / in-store)? This cannot be undone.`
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
