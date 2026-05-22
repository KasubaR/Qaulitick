// Admin layby list

let currentPage = 1;
let totalPages = 1;
const pageSize = 20;
let filters = { status: '', search: '' };

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
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

function formatZmw(n, currency) {
    const x = Number(n);
    if (Number.isNaN(x)) return '—';
    return `${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || 'ZMW'}`;
}

function appendStatusCell(tr, label, isOverdue) {
    const td = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'layby-admin-status-badge' + (isOverdue ? ' is-overdue' : '');
    badge.textContent = label || '—';
    td.appendChild(badge);
    tr.appendChild(td);
}

function renderPlans(plans) {
    const body = document.getElementById('laybyBody');
    if (!body) return;

    body.textContent = '';

    if (!plans.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 9;
        td.className = 'empty-state';
        td.textContent = 'No layby plans match your filters.';
        tr.appendChild(td);
        body.appendChild(tr);
        return;
    }

    plans.forEach((p) => {
        const tr = document.createElement('tr');
        const orderNum =
            (p.order && p.order.orderNumber) ||
            (p.offlineSale && p.offlineSale.saleNumber) ||
            '—';
        const email =
            (p.user && p.user.email) ||
            (p.offlineSale && p.offlineSale.customerEmail) ||
            '—';

        const cells = [
            String(p.id),
            orderNum,
            email
        ];

        cells.forEach((text) => {
            const td = document.createElement('td');
            td.textContent = text;
            tr.appendChild(td);
        });

        appendStatusCell(tr, p.laybyDisplayStatus || p.status, p.isOverdue);

        [
            formatZmw(p.amountPaid, p.currency),
            formatZmw(p.balanceRemaining, p.currency),
            p.nextActionLabel || '—',
            p.nextDueLabel || formatDate(p.nextDueAt)
        ].forEach((text) => {
            const td = document.createElement('td');
            td.textContent = text;
            tr.appendChild(td);
        });

        const tdAct = document.createElement('td');
        const a = document.createElement('a');
        a.href = `/admin/layby/${p.id}`;
        a.className = 'btn-outline layby-table-link';
        a.textContent = 'View';
        tdAct.appendChild(a);
        tr.appendChild(tdAct);

        body.appendChild(tr);
    });
}

async function loadPlans() {
    const body = document.getElementById('laybyBody');
    const countEl = document.getElementById('laybyCount');
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    const pageNumbers = document.getElementById('pageNumbers');

    if (body) {
        body.innerHTML = '<tr><td colspan="9" class="empty-state">Loading…</td></tr>';
    }

    try {
        const data = await window.AdminLaybyAPI.listPlans({
            page: currentPage,
            limit: pageSize,
            status: filters.status,
            search: filters.search
        });

        const plans = data.plans || [];
        totalPages = data.totalPages || 1;

        if (countEl) countEl.textContent = String(data.total != null ? data.total : plans.length);
        if (prevBtn) prevBtn.disabled = currentPage <= 1;
        if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

        if (pageNumbers) {
            const maxPages = 5;
            let startPage = Math.max(1, currentPage - Math.floor(maxPages / 2));
            let endPage = Math.min(totalPages, startPage + maxPages - 1);
            if (endPage - startPage < maxPages - 1) startPage = Math.max(1, endPage - maxPages + 1);
            let html = '';
            for (let i = startPage; i <= endPage; i++) {
                html += `<span class="page-number ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</span>`;
            }
            pageNumbers.innerHTML = html;
            pageNumbers.querySelectorAll('.page-number').forEach(el => {
                el.addEventListener('click', () => {
                    const page = parseInt(el.dataset.page);
                    if (page !== currentPage) { currentPage = page; loadPlans(); }
                });
            });
        }

        renderPlans(plans);
    } catch (e) {
        if (body) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 9;
            td.className = 'empty-state';
            td.textContent = e.message || 'Failed to load';
            tr.appendChild(td);
            body.replaceChildren(tr);
        }
        notify(e.message || 'Failed to load layby plans', 'error');
    }
}

function handleSearch() {
    const input = document.getElementById('laybySearch');
    filters.search = input && input.value ? input.value.trim() : '';
    currentPage = 1;
    loadPlans();
}

function clearFilters() {
    filters = { status: '', search: '' };
    const search = document.getElementById('laybySearch');
    const st = document.getElementById('filterPlanStatus');
    if (search) search.value = '';
    if (st) st.value = '';
    currentPage = 1;
    loadPlans();
}

document.addEventListener('DOMContentLoaded', async () => {
    const ok = await window.AuthUtils?.initializeAuthCheck();
    if (!ok) return;

    setupSidebar();

    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', toggleSidebar);
    }

    document.getElementById('searchBtn')?.addEventListener('click', handleSearch);
    document.getElementById('laybySearch')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });

    document.getElementById('filterPlanStatus')?.addEventListener('change', (e) => {
        filters.status = e.target.value;
        currentPage = 1;
        loadPlans();
    });

    document.getElementById('clearFiltersBtn')?.addEventListener('click', clearFilters);
    document.getElementById('refreshBtn')?.addEventListener('click', () => loadPlans());

    document.getElementById('prevPage')?.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage -= 1;
            loadPlans();
        }
    });
    document.getElementById('nextPage')?.addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage += 1;
            loadPlans();
        }
    });

    loadPlans();
});
