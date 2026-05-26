/**
 * Admin offline sales: line items, product search, totals, POST sale, list history.
 */

(function () {
    'use strict';

    let lineIdSeq = 0;
    /** @type {Map<number, {productId:number, name:string, color:string|null, qty:number, unitPrice:number, product:object}>} */
    const lineData = new Map();

    // Modal state
    let modalLineId = null; // null = adding new, number = editing existing

    let searchTimer = null;
    let userSearchTimer = null;
    let selectedLaybyUser = null;

    let listPage = 1;
    const listLimit = 15;
    let listTotalPages = 1;

    let saleMode = 'full';

    function getLaybyConfig() {
        const modal = document.getElementById('addSaleModal');
        const min = parseInt(modal?.dataset?.laybyMinPct, 10) || 30;
        const max = parseInt(modal?.dataset?.laybyMaxPct, 10) || 100;
        const planDays = parseInt(modal?.dataset?.laybyPlanDays, 10) || 90;
        return { min, max, planDays };
    }

    function clampDepositPercent(pct) {
        const { min, max } = getLaybyConfig();
        return Math.min(max, Math.max(min, Math.round(pct)));
    }

    function getCurrentSubtotal() {
        let sub = 0;
        lineData.forEach((d) => { sub += round2(d.qty * d.unitPrice); });
        return round2(sub);
    }

    function recalcLaybyDisplay() {
        const sub = getCurrentSubtotal();
        const pctInput = document.getElementById('laybyDepositPercentInput');
        const pctRange = document.getElementById('laybyDepositPercentRange');
        let pct = parseInt(pctInput?.value, 10);
        if (Number.isNaN(pct)) pct = getLaybyConfig().min;
        pct = clampDepositPercent(pct);
        if (pctInput) pctInput.value = String(pct);
        if (pctRange) pctRange.value = String(pct);

        const deposit = round2(sub * (pct / 100));
        const balance = round2(sub - deposit);
        const depEl = document.getElementById('laybyDepositAmountDisplay');
        const balEl = document.getElementById('laybyBalanceAmountDisplay');
        if (depEl) depEl.textContent = formatZmw(deposit);
        if (balEl) balEl.textContent = formatZmw(balance);
    }

    // ─── Layby user search ────────────────────────────────────────────────────

    function closeLaybyUserDropdown() {
        const d = document.getElementById('laybyUserSearchResults');
        if (d) { d.classList.add('is-hidden'); d.innerHTML = ''; }
    }

    function clearLaybyUser() {
        selectedLaybyUser = null;
        const idEl = document.getElementById('laybyUserId');
        const labelEl = document.getElementById('laybyUserLabel');
        const searchEl = document.getElementById('laybyUserSearch');
        if (idEl) idEl.value = '';
        if (labelEl) { labelEl.textContent = 'No account selected'; labelEl.classList.remove('is-selected'); }
        if (searchEl) searchEl.value = '';
        closeLaybyUserDropdown();
    }

    function applyLaybyUser(user) {
        selectedLaybyUser = user;
        const idEl = document.getElementById('laybyUserId');
        const labelEl = document.getElementById('laybyUserLabel');
        const searchEl = document.getElementById('laybyUserSearch');
        if (idEl) idEl.value = String(user.id);
        if (labelEl) { labelEl.textContent = `${user.name} (${user.email})`; labelEl.classList.add('is-selected'); }
        if (searchEl) searchEl.value = '';
        closeLaybyUserDropdown();

        // Pre-fill customer fields
        const nameEl = document.getElementById('customerNameInput');
        const emailEl = document.getElementById('customerEmailInput');
        const phoneEl = document.getElementById('customerPhoneInput');
        if (nameEl && !nameEl.value) nameEl.value = user.name || '';
        if (emailEl && !emailEl.value) emailEl.value = user.email || '';
        if (phoneEl && !phoneEl.value) phoneEl.value = user.phone || '';
    }

    function renderLaybyUserResults(users) {
        const wrap = document.getElementById('laybyUserSearchResults');
        if (!wrap) return;
        if (!users || users.length === 0) {
            wrap.innerHTML = '<ul><li class="offline-search-empty">No accounts found</li></ul>';
            wrap.classList.remove('is-hidden');
            return;
        }
        const ul = document.createElement('ul');
        users.forEach((u) => {
            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'offline-search-result-btn';
            btn.textContent = `${u.name} — ${u.email}`;
            btn.addEventListener('click', () => {
                applyLaybyUser(u);
            });
            li.appendChild(btn);
            ul.appendChild(li);
        });
        wrap.innerHTML = '';
        wrap.appendChild(ul);
        wrap.classList.remove('is-hidden');
    }

    async function runLaybyUserSearch(q) {
        const query = (q || '').trim();
        if (query.length < 2) { closeLaybyUserDropdown(); return; }
        try {
            const res = await fetch(`/api/admin/users/search?q=${encodeURIComponent(query)}`, { credentials: 'include' });
            const data = await res.json().catch(() => ({}));
            renderLaybyUserResults(res.ok && data.success ? (data.users || []) : []);
        } catch {
            renderLaybyUserResults([]);
        }
    }

    function setSaleMode(mode) {
        saleMode = mode === 'layby' ? 'layby' : 'full';
        if (saleMode === 'full') clearLaybyUser();
        const panel = document.getElementById('offlineLaybyPanel');
        const fullBtn = document.getElementById('saleModeFullBtn');
        const laybyBtn = document.getElementById('saleModeLaybyBtn');
        const submitBtn = document.getElementById('submitOfflineSaleBtn');

        if (panel) {
            const isLayby = saleMode === 'layby';
            panel.classList.toggle('is-hidden', !isLayby);
            panel.setAttribute('aria-hidden', isLayby ? 'false' : 'true');
        }
        if (fullBtn) fullBtn.classList.toggle('is-active', saleMode === 'full');
        if (laybyBtn) laybyBtn.classList.toggle('is-active', saleMode === 'layby');

        if (submitBtn) {
            submitBtn.innerHTML =
                saleMode === 'layby'
                    ? '<i class="fas fa-check"></i> Save layby sale'
                    : '<i class="fas fa-check"></i> Save sale';
        }

        document.querySelectorAll('.offline-customer-field').forEach((el) => {
            el.style.display = saleMode === 'layby' ? 'none' : '';
        });

        if (saleMode === 'layby') recalcLaybyDisplay();
    }

    function csrfToken() {
        const m = document.querySelector('meta[name=”csrf-token”]');
        return m ? m.getAttribute('content') || '' : '';
    }

    function round2(x) {
        return Math.round(Number(x) * 100) / 100;
    }

    function formatZmw(n) {
        return `K${round2(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function showToast(message, type) {
        const el = document.getElementById('offlinePageNotification');
        if (!el) return;
        el.textContent = message;
        el.className = 'offline-page-notification is-visible is-' + (type || 'info');
        const ms = type === 'error' ? 6000 : 3500;
        setTimeout(() => el.classList.remove('is-visible'), ms);
    }

    function setFormMessage(text, variant) {
        const el = document.getElementById('offlineFormMessage');
        if (!el) return;
        if (!text) {
            el.textContent = '';
            el.classList.add('offline-form-message--hidden');
            el.classList.remove('is-error', 'is-success');
            return;
        }
        el.textContent = text;
        el.classList.remove('offline-form-message--hidden', 'is-error', 'is-success');
        el.classList.add(variant === 'error' ? 'is-error' : 'is-success');
    }

    function toggleLinesEmpty() {
        const tbody = document.getElementById('offlineLineRows');
        const empty = document.getElementById('offlineLinesEmpty');
        if (!tbody || !empty) return;
        empty.classList.toggle('is-hidden', tbody.querySelectorAll('tr[data-line-id]').length > 0);
    }

    function recalcGrandTotals() {
        const sub = getCurrentSubtotal();
        const subEl = document.getElementById('offlineSubtotalDisplay');
        const grandEl = document.getElementById('offlineGrandTotalDisplay');
        if (subEl) subEl.textContent = formatZmw(sub);
        if (grandEl) grandEl.textContent = formatZmw(sub);
        if (saleMode === 'layby') recalcLaybyDisplay();
    }

    // ─── Read-only row rendering ──────────────────────────────────────────────

    function renderLineRow(lineId) {
        const d = lineData.get(lineId);
        if (!d) return;

        let tr = document.querySelector(`tr[data-line-id=”${lineId}”]`);
        const isNew = !tr;

        if (isNew) {
            tr = document.createElement('tr');
            tr.dataset.lineId = String(lineId);
            document.getElementById('offlineLineRows')?.appendChild(tr);
        }

        tr.innerHTML = `
            <td><span class=”offline-product-label is-selected”>${escapeHtml(d.name)}</span></td>
            <td>${escapeHtml(d.color || '—')}</td>
            <td>${d.qty}</td>
            <td>${formatZmw(d.unitPrice)}</td>
            <td class=”offline-line-total-cell”>${formatZmw(round2(d.qty * d.unitPrice))}</td>
            <td class=”offline-row-actions”>
                <button type=”button” class=”btn-icon offline-edit-line” aria-label=”Edit line”><i class=”fas fa-edit” aria-hidden=”true”></i></button>
                <button type=”button” class=”btn-icon offline-remove-line” aria-label=”Remove line”><i class=”fas fa-trash” aria-hidden=”true”></i></button>
            </td>
        `;

        tr.querySelector('.offline-edit-line').addEventListener('click', () => openLineModal(lineId));
        tr.querySelector('.offline-remove-line').addEventListener('click', () => {
            lineData.delete(lineId);
            tr.remove();
            toggleLinesEmpty();
            recalcGrandTotals();
        });
    }

    // ─── Modal ────────────────────────────────────────────────────────────────

    function getModal() { return document.getElementById('offlineLineModal'); }

    function openLineModal(lineId) {
        modalLineId = lineId ?? null;
        const modal = getModal();
        if (!modal) return;

        const title = modal.querySelector('#offlineLineModalTitle');
        if (title) title.textContent = modalLineId === null ? 'Add line' : 'Edit line';

        // Reset modal fields
        document.getElementById('modalProductSearch').value = '';
        document.getElementById('modalProductId').value = '';
        document.getElementById('modalProductLabel').textContent = 'No product selected';
        document.getElementById('modalProductLabel').classList.remove('is-selected');
        document.getElementById('modalQty').value = '1';
        document.getElementById('modalUnitPrice').value = '';
        document.getElementById('modalLineTotal').textContent = 'K0.00';

        const colorSel = document.getElementById('modalColorSelect');
        colorSel.innerHTML = '<option value=””>—</option>';
        colorSel.disabled = true;

        closeModalSearchDropdown();

        // If editing, pre-fill from existing line data
        if (modalLineId !== null) {
            const d = lineData.get(modalLineId);
            if (d) {
                document.getElementById('modalProductId').value = String(d.productId);
                document.getElementById('modalProductLabel').textContent = d.name;
                document.getElementById('modalProductLabel').classList.add('is-selected');
                document.getElementById('modalQty').value = String(d.qty);
                document.getElementById('modalUnitPrice').value = String(d.unitPrice);
                recalcModalTotal();

                if (d.product) {
                    populateModalColors(d.product, d.color);
                }
            }
        }

        modal.classList.remove('is-hidden');
        document.getElementById('modalProductSearch').focus();
    }

    function closeLineModal() {
        getModal()?.classList.add('is-hidden');
        modalLineId = null;
        clearTimeout(searchTimer);
        closeModalSearchDropdown();
    }

    function recalcModalTotal() {
        const qty = Math.max(1, parseInt(document.getElementById('modalQty')?.value, 10) || 1);
        const unit = round2(parseFloat(document.getElementById('modalUnitPrice')?.value) || 0);
        const el = document.getElementById('modalLineTotal');
        if (el) el.textContent = formatZmw(round2(qty * unit));
    }

    function populateModalColors(product, selectedColor) {
        const colorSel = document.getElementById('modalColorSelect');
        const colors = Array.isArray(product.colors) ? product.colors : [];
        colorSel.innerHTML = '';
        if (colors.length === 0) {
            colorSel.innerHTML = '<option value=””>—</option>';
            colorSel.disabled = true;
        } else {
            const ph = document.createElement('option');
            ph.value = '';
            ph.textContent = 'Select color';
            colorSel.appendChild(ph);
            colors.forEach((c) => {
                const o = document.createElement('option');
                o.value = c.name;
                const st = c.stock != null ? Number(c.stock) : '—';
                o.textContent = `${c.name} (${st} avail.)`;
                if (selectedColor && c.name === selectedColor) o.selected = true;
                colorSel.appendChild(o);
            });
            colorSel.disabled = false;
        }
    }

    function saveLineModal() {
        const productId = parseInt(document.getElementById('modalProductId').value, 10);
        if (Number.isNaN(productId) || productId < 1) {
            showToast('Select a product first', 'error');
            return;
        }

        const name = document.getElementById('modalProductLabel').textContent.trim();
        const qty = Math.max(1, parseInt(document.getElementById('modalQty').value, 10) || 1);
        const unitPrice = round2(parseFloat(document.getElementById('modalUnitPrice').value) || 0);
        const colorSel = document.getElementById('modalColorSelect');
        const color = (!colorSel.disabled && colorSel.value) ? colorSel.value : null;

        // Validate color required
        const existingProduct = modalLineId !== null
            ? lineData.get(modalLineId)?.product
            : null;
        const searchProduct = window._modalCurrentProduct || existingProduct;
        if (searchProduct && Array.isArray(searchProduct.colors) && searchProduct.colors.length > 0 && !color) {
            showToast(`Select a color for “${name}”`, 'error');
            return;
        }

        if (modalLineId === null) {
            // New line
            lineIdSeq += 1;
            modalLineId = lineIdSeq;
        }

        lineData.set(modalLineId, {
            productId,
            name,
            color,
            qty,
            unitPrice,
            product: window._modalCurrentProduct || lineData.get(modalLineId)?.product || null
        });

        renderLineRow(modalLineId);
        toggleLinesEmpty();
        recalcGrandTotals();
        closeLineModal();
        window._modalCurrentProduct = null;
    }

    // ─── Modal product search ─────────────────────────────────────────────────

    function closeModalSearchDropdown() {
        const d = document.getElementById('modalSearchResults');
        if (d) { d.classList.add('is-hidden'); d.innerHTML = ''; }
    }

    function renderModalSearchResults(products) {
        const wrap = document.getElementById('modalSearchResults');
        if (!wrap) return;
        if (!products || products.length === 0) {
            wrap.innerHTML = '<ul><li class=”offline-search-empty”>No products found</li></ul>';
            wrap.classList.remove('is-hidden');
            return;
        }
        const ul = document.createElement('ul');
        products.forEach((p) => {
            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'offline-search-result-btn';
            const name = p.model || p.name || 'Product';
            const brand = p.brand ? ` · ${p.brand}` : '';
            btn.textContent = `${name}${brand} — ${formatZmw(p.price)}`;
            btn.addEventListener('click', () => {
                applyProductToModal(p);
                closeModalSearchDropdown();
            });
            li.appendChild(btn);
            ul.appendChild(li);
        });
        wrap.innerHTML = '';
        wrap.appendChild(ul);
        wrap.classList.remove('is-hidden');
    }

    function applyProductToModal(product) {
        window._modalCurrentProduct = product;
        document.getElementById('modalProductId').value = String(product.id);
        const label = document.getElementById('modalProductLabel');
        label.textContent = product.model || product.name || `Product #${product.id}`;
        label.classList.add('is-selected');
        document.getElementById('modalProductSearch').value = '';
        const price = round2(parseFloat(product.price) || 0);
        document.getElementById('modalUnitPrice').value = String(price);
        populateModalColors(product, null);
        recalcModalTotal();
    }

    async function runModalSearch(q) {
        const query = (q || '').trim();
        if (query.length < 2) { closeModalSearchDropdown(); return; }
        try {
            const res = await fetch(`/api/products/search?q=${encodeURIComponent(query)}&limit=12`, { credentials: 'same-origin' });
            const data = await res.json().catch(() => ({}));
            renderModalSearchResults(res.ok && data.success ? (data.products || []) : []);
        } catch {
            renderModalSearchResults([]);
        }
    }

    // ─── Payload + submit ─────────────────────────────────────────────────────

    function collectPayload() {
        if (lineData.size === 0) {
            throw new Error('Add at least one product line');
        }

        const items = [];
        for (const [lineId, d] of lineData) {
            if (!d.productId) continue;
            const prod = d.product;
            if (prod && Array.isArray(prod.colors) && prod.colors.length > 0 && !d.color) {
                throw new Error(`Select a color for “${d.name}”`);
            }
            items.push({
                productId: d.productId,
                name: d.name,
                quantity: d.qty,
                unitPrice: d.unitPrice,
                lineTotal: round2(d.qty * d.unitPrice),
                ...(d.color ? { selectedColor: d.color } : {})
            });
        }

        if (items.length === 0) throw new Error('Add at least one product line with a selected product');

        const subtotal = round2(items.reduce((s, it) => s + it.lineTotal, 0));

        const soldAtEl = document.getElementById('soldAtInput');
        let soldAt = null;
        if (soldAtEl && soldAtEl.value) {
            const d = new Date(soldAtEl.value);
            if (!Number.isNaN(d.getTime())) soldAt = d.toISOString();
        }

        const base = {
            items,
            totals: { subtotal, total: subtotal },
            soldAt: soldAt || undefined,
            customerName: document.getElementById('customerNameInput')?.value?.trim() || undefined,
            customerEmail: document.getElementById('customerEmailInput')?.value?.trim() || undefined,
            customerPhone: document.getElementById('customerPhoneInput')?.value?.trim() || undefined,
            notes: document.getElementById('notesInput')?.value?.trim() || undefined
        };

        if (saleMode === 'layby') {
            const pct = clampDepositPercent(parseInt(document.getElementById('laybyDepositPercentInput')?.value, 10));
            base.depositPercent = pct;
            const userId = parseInt(document.getElementById('laybyUserId')?.value, 10);
            if (!selectedLaybyUser || Number.isNaN(userId) || userId < 1) {
                throw new Error('Select a registered customer account for layby sales');
            }
            base.userId = userId;
        }

        return base;
    }

    async function submitSale() {
        setFormMessage('', '');
        let payload;
        try {
            payload = collectPayload();
        } catch (err) {
            setFormMessage(err.message || 'Invalid form', 'error');
            showToast(err.message || 'Invalid form', 'error');
            return;
        }

        const btn = document.getElementById('submitOfflineSaleBtn');
        if (btn) btn.disabled = true;

        const isLayby = saleMode === 'layby';
        const endpoint = isLayby ? '/api/admin/offline-sales/layby' : '/api/admin/offline-sales';

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    ...(csrfToken() ? { 'X-CSRF-Token': csrfToken() } : {})
                },
                body: JSON.stringify(payload)
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                throw new Error(data.message || (isLayby ? 'Failed to save layby sale' : 'Failed to save sale'));
            }

            showToast(isLayby ? 'Layby sale recorded.' : 'Sale recorded.', 'success');
            closeSaleModal();

            clearLaybyUser();
            document.getElementById('customerNameInput').value = '';
            document.getElementById('customerEmailInput').value = '';
            document.getElementById('customerPhoneInput').value = '';
            document.getElementById('notesInput').value = '';
            setFormMessage('', '');

            const tbody = document.getElementById('offlineLineRows');
            if (tbody) tbody.innerHTML = '';
            lineData.clear();
            lineIdSeq = 0;
            toggleLinesEmpty();
            recalcGrandTotals();
            listPage = 1;
            await loadHistory(1);
        } catch (err) {
            setFormMessage(err.message || 'Failed to save', 'error');
            showToast(err.message || 'Failed to save', 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ─── History ──────────────────────────────────────────────────────────────

    async function loadHistory(page) {
        const tbody = document.getElementById('offlineSalesHistoryBody');
        if (!tbody) return;

        const p = Math.max(1, page || 1);
        try {
            const res = await fetch(`/api/admin/offline-sales?page=${p}&limit=${listLimit}`, { credentials: 'include' });
            if (res.status === 401 || res.status === 403) {
                if (window.AuthUtils?.handleAuthError) window.AuthUtils.handleAuthError(res);
                return;
            }
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHtml(data.message || 'Could not load sales')}</td></tr>`;
                return;
            }

            listTotalPages = data.totalPages || 1;
            listPage = data.page || p;

            const info = document.getElementById('offlineSalesPageInfo');
            if (info) info.textContent = `Page ${listPage} of ${listTotalPages}`;

            const prev = document.getElementById('offlineSalesPrev');
            const next = document.getElementById('offlineSalesNext');
            if (prev) prev.disabled = listPage <= 1;
            if (next) next.disabled = listPage >= listTotalPages;

            const sales = data.sales || [];
            if (sales.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No offline sales yet</td></tr>';
                return;
            }

            tbody.innerHTML = sales.map((s) => {
                const num = escapeHtml(s.saleNumber || '—');
                const isLayby = s.saleType === 'layby';
                const typeBadge = isLayby
                    ? '<span class="offline-type-badge offline-type-badge--layby">Layby</span>'
                    : '<span class="offline-type-badge offline-type-badge--full">Full</span>';
                const planId = s.laybyPlan && s.laybyPlan.id;
                const laybyLink = planId
                    ? `<a class="offline-layby-plan-link" href="/admin/layby/${planId}">View plan</a>`
                    : '';
                const dt = s.soldAt ? escapeHtml(new Date(s.soldAt).toLocaleString()) : '—';
                const tot = s.totals?.total != null ? formatZmw(s.totals.total) : '—';
                const custParts = [s.customerName, s.customerEmail, s.customerPhone].filter(Boolean);
                const cust = custParts.length > 0 ? escapeHtml(custParts.join(' · ')) : '—';
                const by = escapeHtml(s.createdByAdmin?.email || s.createdByAdminEmail || '') || '—';
                return `<tr>
                    <td><strong>${num}</strong></td>
                    <td>${typeBadge}${laybyLink}</td>
                    <td>${dt}</td>
                    <td>${tot}</td>
                    <td>${cust}</td>
                    <td>${by}</td>
                </tr>`;
            }).join('');
        } catch {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Failed to load sales</td></tr>';
        }
    }

    // ─── Utilities ────────────────────────────────────────────────────────────

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/”/g, '&quot;');
    }

    function initSoldAtDefault() {
        const el = document.getElementById('soldAtInput');
        if (!el) return;
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        el.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    // ─── Sale modal ───────────────────────────────────────────────────────────

    function openSaleModal() {
        const modal = document.getElementById('addSaleModal');
        if (!modal) return;
        initSoldAtDefault();
        clearLaybyUser();
        setSaleMode('full');
        const { min } = getLaybyConfig();
        const pctInput = document.getElementById('laybyDepositPercentInput');
        const pctRange = document.getElementById('laybyDepositPercentRange');
        if (pctInput) pctInput.value = String(min);
        if (pctRange) pctRange.value = String(min);
        modal.classList.remove('is-hidden');
    }

    function closeSaleModal() {
        document.getElementById('addSaleModal')?.classList.add('is-hidden');
    }

    // ─── Init ─────────────────────────────────────────────────────────────────

    document.addEventListener('DOMContentLoaded', async () => {
        const ok = await window.AuthUtils?.initializeAuthCheck?.();
        if (ok === false) return;

        // Open sale modal
        document.getElementById('openAddSaleModalBtn')?.addEventListener('click', () => openSaleModal());
        document.getElementById('closeSaleModalBtn')?.addEventListener('click', () => closeSaleModal());
        document.getElementById('closeSaleModalBtnFooter')?.addEventListener('click', () => closeSaleModal());
        document.getElementById('addSaleModal')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeSaleModal();
        });

        // Line actions inside sale modal
        document.getElementById('addOfflineLineBtn')?.addEventListener('click', () => openLineModal(null));
        document.getElementById('submitOfflineSaleBtn')?.addEventListener('click', () => submitSale());
        document.getElementById('saveLineModalBtn')?.addEventListener('click', () => saveLineModal());

        document.getElementById('saleModeFullBtn')?.addEventListener('click', () => setSaleMode('full'));
        document.getElementById('saleModeLaybyBtn')?.addEventListener('click', () => setSaleMode('layby'));

        const syncPctFromInput = () => {
            const pct = clampDepositPercent(parseInt(document.getElementById('laybyDepositPercentInput')?.value, 10));
            const range = document.getElementById('laybyDepositPercentRange');
            if (range) range.value = String(pct);
            recalcLaybyDisplay();
        };
        const syncPctFromRange = () => {
            const pct = clampDepositPercent(parseInt(document.getElementById('laybyDepositPercentRange')?.value, 10));
            const input = document.getElementById('laybyDepositPercentInput');
            if (input) input.value = String(pct);
            recalcLaybyDisplay();
        };
        document.getElementById('laybyDepositPercentInput')?.addEventListener('input', syncPctFromInput);
        document.getElementById('laybyDepositPercentInput')?.addEventListener('change', syncPctFromInput);
        document.getElementById('laybyDepositPercentRange')?.addEventListener('input', syncPctFromRange);
        document.getElementById('laybyDepositPercentRange')?.addEventListener('change', syncPctFromRange);

        // Close line picker modal
        document.querySelectorAll('.offline-line-modal-close').forEach((btn) => {
            btn.addEventListener('click', () => closeLineModal());
        });
        document.getElementById('offlineLineModal')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeLineModal();
        });

        // Modal product search
        const modalSearch = document.getElementById('modalProductSearch');
        if (modalSearch) {
            modalSearch.addEventListener('input', () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => runModalSearch(modalSearch.value), 350);
            });
            modalSearch.addEventListener('focus', () => {
                if (modalSearch.value.trim().length >= 2) runModalSearch(modalSearch.value);
            });
        }

        // Layby user search
        const laybyUserSearch = document.getElementById('laybyUserSearch');
        if (laybyUserSearch) {
            laybyUserSearch.addEventListener('input', () => {
                clearTimeout(userSearchTimer);
                userSearchTimer = setTimeout(() => runLaybyUserSearch(laybyUserSearch.value), 350);
            });
            laybyUserSearch.addEventListener('focus', () => {
                if (laybyUserSearch.value.trim().length >= 2) runLaybyUserSearch(laybyUserSearch.value);
            });
        }

        // Close search dropdowns when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#offlineLineModal .offline-product-search')) {
                closeModalSearchDropdown();
            }
            if (!e.target.closest('#laybyUserSearch, #laybyUserSearchResults')) {
                closeLaybyUserDropdown();
            }
        }, true);

        // Line modal totals recalc
        document.getElementById('modalQty')?.addEventListener('input', recalcModalTotal);
        document.getElementById('modalUnitPrice')?.addEventListener('input', recalcModalTotal);

        // History pagination
        document.getElementById('offlineSalesPrev')?.addEventListener('click', () => {
            if (listPage > 1) loadHistory(listPage - 1);
        });
        document.getElementById('offlineSalesNext')?.addEventListener('click', () => {
            if (listPage < listTotalPages) loadHistory(listPage + 1);
        });

        toggleLinesEmpty();
        loadHistory(1);
    });
})();
