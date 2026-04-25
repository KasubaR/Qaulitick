/**
 * Admin offline sales: line items, product search, totals, POST sale, list history.
 */

(function () {
    'use strict';

    let lineIdSeq = 0;
    /** @type {Map<number, object>} */
    const lineProducts = new Map();
    /** @type {Map<number, ReturnType<typeof setTimeout>>} */
    const searchTimers = new Map();

    let listPage = 1;
    const listLimit = 15;
    let listTotalPages = 1;

    function csrfToken() {
        const m = document.querySelector('meta[name="csrf-token"]');
        return m ? m.getAttribute('content') || '' : '';
    }

    function round2(x) {
        return Math.round(Number(x) * 100) / 100;
    }

    function formatZmw(n) {
        return `K${round2(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function debounce(key, fn, ms) {
        const prev = searchTimers.get(key);
        if (prev) clearTimeout(prev);
        const t = setTimeout(() => {
            searchTimers.delete(key);
            fn();
        }, ms);
        searchTimers.set(key, t);
    }

    function showToast(message, type) {
        const el = document.getElementById('offlinePageNotification');
        if (!el) return;
        el.textContent = message;
        el.className = 'offline-page-notification is-visible is-' + (type || 'info');
        const ms = type === 'error' ? 6000 : 3500;
        setTimeout(() => {
            el.classList.remove('is-visible');
        }, ms);
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
        const has = tbody.querySelectorAll('tr[data-line-id]').length > 0;
        empty.classList.toggle('is-hidden', has);
    }

    function recalcLine(tr) {
        const qty = Math.max(1, parseInt(tr.querySelector('.offline-qty')?.value, 10) || 1);
        const unit = round2(parseFloat(tr.querySelector('.offline-unit-price')?.value) || 0);
        const total = round2(qty * unit);
        const totalEl = tr.querySelector('.offline-line-total');
        if (totalEl) totalEl.textContent = formatZmw(total);
        recalcGrandTotals();
    }

    function recalcGrandTotals() {
        const rows = document.querySelectorAll('#offlineLineRows tr[data-line-id]');
        let sub = 0;
        rows.forEach((tr) => {
            const qty = Math.max(1, parseInt(tr.querySelector('.offline-qty')?.value, 10) || 1);
            const unit = round2(parseFloat(tr.querySelector('.offline-unit-price')?.value) || 0);
            sub += round2(qty * unit);
        });
        const subEl = document.getElementById('offlineSubtotalDisplay');
        const grandEl = document.getElementById('offlineGrandTotalDisplay');
        if (subEl) subEl.textContent = formatZmw(sub);
        if (grandEl) grandEl.textContent = formatZmw(sub);
    }

    function closeAllSearchDropdowns() {
        document.querySelectorAll('.offline-search-results').forEach((d) => {
            d.classList.add('is-hidden');
            d.innerHTML = '';
        });
    }

    function renderSearchResults(lineId, products) {
        const wrap = document.querySelector(`tr[data-line-id="${lineId}"] .offline-search-results`);
        if (!wrap) return;
        if (!products || products.length === 0) {
            wrap.innerHTML = '<ul><li class="offline-search-empty">No products found</li></ul>';
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
                applyProductToLine(lineId, p);
                closeAllSearchDropdowns();
            });
            li.appendChild(btn);
            ul.appendChild(li);
        });
        wrap.innerHTML = '';
        wrap.appendChild(ul);
        wrap.classList.remove('is-hidden');
    }

    function applyProductToLine(lineId, product) {
        const tr = document.querySelector(`tr[data-line-id="${lineId}"]`);
        if (!tr) return;
        lineProducts.set(lineId, product);

        const idInput = tr.querySelector('.offline-product-id');
        if (idInput) idInput.value = String(product.id);

        const label = tr.querySelector('.offline-product-label');
        if (label) {
            label.textContent = product.model || product.name || `Product #${product.id}`;
            label.classList.add('is-selected');
        }

        const unitInput = tr.querySelector('.offline-unit-price');
        const price = round2(parseFloat(product.price) || 0);
        if (unitInput) unitInput.value = String(price);

        const colorSel = tr.querySelector('.offline-color-select');
        const colors = Array.isArray(product.colors) ? product.colors : [];
        if (colorSel) {
            colorSel.innerHTML = '';
            if (colors.length === 0) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = '—';
                colorSel.appendChild(opt);
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
                    colorSel.appendChild(o);
                });
                colorSel.disabled = false;
            }
        }

        const searchInput = tr.querySelector('.offline-product-search-input');
        if (searchInput) searchInput.value = '';

        recalcLine(tr);
    }

    async function runProductSearch(lineId, q) {
        const query = (q || '').trim();
        if (query.length < 2) {
            const wrap = document.querySelector(`tr[data-line-id="${lineId}"] .offline-search-results`);
            if (wrap) {
                wrap.classList.add('is-hidden');
                wrap.innerHTML = '';
            }
            return;
        }
        try {
            const url = `/api/products/search?q=${encodeURIComponent(query)}&limit=12`;
            const res = await fetch(url, { credentials: 'same-origin' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                renderSearchResults(lineId, []);
                return;
            }
            renderSearchResults(lineId, data.products || []);
        } catch {
            renderSearchResults(lineId, []);
        }
    }

    function bindLineRow(tr) {
        const lineId = parseInt(tr.dataset.lineId, 10);
        const searchInput = tr.querySelector('.offline-product-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                debounce(lineId, () => runProductSearch(lineId, searchInput.value), 350);
            });
            searchInput.addEventListener('focus', () => {
                if (searchInput.value.trim().length >= 2) {
                    runProductSearch(lineId, searchInput.value);
                }
            });
        }

        tr.querySelector('.offline-qty')?.addEventListener('input', () => recalcLine(tr));
        tr.querySelector('.offline-unit-price')?.addEventListener('input', () => recalcLine(tr));
        tr.querySelector('.offline-color-select')?.addEventListener('change', () => recalcLine(tr));

        tr.querySelector('.offline-remove-line')?.addEventListener('click', () => {
            lineProducts.delete(lineId);
            tr.remove();
            toggleLinesEmpty();
            recalcGrandTotals();
        });
    }

    function addLine() {
        lineIdSeq += 1;
        const lineId = lineIdSeq;
        const tbody = document.getElementById('offlineLineRows');
        if (!tbody) return;

        const tr = document.createElement('tr');
        tr.dataset.lineId = String(lineId);
        tr.innerHTML = `
            <td class="offline-line-product-cell">
                <div class="offline-product-search">
                    <input type="text" class="form-input offline-product-search-input" placeholder="Search by name, SKU…" autocomplete="off" aria-label="Search product">
                    <div class="offline-search-results is-hidden" role="listbox" aria-label="Search results"></div>
                </div>
                <input type="hidden" class="offline-product-id" value="">
                <span class="offline-product-label">No product selected</span>
            </td>
            <td>
                <select class="form-select offline-color-select" disabled aria-label="Color variant">
                    <option value="">—</option>
                </select>
            </td>
            <td><input type="number" class="form-input offline-qty" min="1" value="1" aria-label="Quantity"></td>
            <td><input type="number" class="form-input offline-unit-price" min="0" step="0.01" value="" aria-label="Unit price ZMW"></td>
            <td class="offline-line-total-cell offline-line-total">K0.00</td>
            <td>
                <button type="button" class="btn-icon offline-remove-line" aria-label="Remove line"><i class="fas fa-trash" aria-hidden="true"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
        bindLineRow(tr);
        toggleLinesEmpty();
    }

    function onDocClickCloseSearch(e) {
        if (!e.target.closest('.offline-product-search')) {
            closeAllSearchDropdowns();
        }
    }

    function collectPayload() {
        const rows = document.querySelectorAll('#offlineLineRows tr[data-line-id]');
        const items = [];
        for (const tr of rows) {
            const productId = parseInt(tr.querySelector('.offline-product-id')?.value, 10);
            if (Number.isNaN(productId) || productId < 1) continue;

            const qty = Math.max(1, parseInt(tr.querySelector('.offline-qty')?.value, 10) || 1);
            const unitPrice = round2(parseFloat(tr.querySelector('.offline-unit-price')?.value) || 0);
            const lineTotal = round2(qty * unitPrice);
            const name = tr.querySelector('.offline-product-label')?.textContent?.trim() || 'Item';
            const colorSel = tr.querySelector('.offline-color-select');
            let selectedColor = null;
            if (colorSel && !colorSel.disabled && colorSel.options.length > 0) {
                const v = colorSel.value;
                if (v) selectedColor = v;
            }
            const lineId = parseInt(tr.dataset.lineId, 10);
            const prod = lineProducts.get(lineId);
            if (prod && Array.isArray(prod.colors) && prod.colors.length > 0 && !selectedColor) {
                throw new Error(`Select a color for “${name}”`);
            }

            items.push({
                productId,
                name,
                quantity: qty,
                unitPrice,
                lineTotal,
                ...(selectedColor ? { selectedColor } : {})
            });
        }

        if (items.length === 0) {
            throw new Error('Add at least one product line with a selected product');
        }

        const subtotal = round2(items.reduce((s, it) => s + it.lineTotal, 0));

        const soldAtEl = document.getElementById('soldAtInput');
        let soldAt = null;
        if (soldAtEl && soldAtEl.value) {
            const d = new Date(soldAtEl.value);
            if (!Number.isNaN(d.getTime())) soldAt = d.toISOString();
        }

        return {
            items,
            totals: { subtotal, total: subtotal },
            soldAt: soldAt || undefined,
            customerName: document.getElementById('customerNameInput')?.value?.trim() || undefined,
            customerEmail: document.getElementById('customerEmailInput')?.value?.trim() || undefined,
            customerPhone: document.getElementById('customerPhoneInput')?.value?.trim() || undefined,
            notes: document.getElementById('notesInput')?.value?.trim() || undefined
        };
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
        if (btn) {
            btn.disabled = true;
        }

        try {
            const res = await fetch('/api/admin/offline-sales', {
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
                throw new Error(data.message || 'Failed to save sale');
            }

            setFormMessage('Sale recorded successfully.', 'success');
            showToast('Sale recorded.', 'success');

            document.getElementById('customerNameInput').value = '';
            document.getElementById('customerEmailInput').value = '';
            document.getElementById('customerPhoneInput').value = '';
            document.getElementById('notesInput').value = '';

            const tbody = document.getElementById('offlineLineRows');
            if (tbody) tbody.innerHTML = '';
            lineProducts.clear();
            lineIdSeq = 0;
            toggleLinesEmpty();
            recalcGrandTotals();

            initSoldAtDefault();
            listPage = 1;
            await loadHistory(1);
        } catch (err) {
            setFormMessage(err.message || 'Failed to save', 'error');
            showToast(err.message || 'Failed to save', 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function loadHistory(page) {
        const tbody = document.getElementById('offlineSalesHistoryBody');
        if (!tbody) return;

        const p = Math.max(1, page || 1);
        const url = `/api/admin/offline-sales?page=${p}&limit=${listLimit}`;
        try {
            const res = await fetch(url, { credentials: 'include' });
            if (res.status === 401 || res.status === 403) {
                if (window.AuthUtils?.handleAuthError) window.AuthUtils.handleAuthError(res);
                return;
            }
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                tbody.innerHTML = `<tr><td colspan="5" class="empty-state">${data.message || 'Could not load sales'}</td></tr>`;
                return;
            }

            listTotalPages = data.totalPages || 1;
            listPage = data.page || p;

            const info = document.getElementById('offlineSalesPageInfo');
            if (info) {
                info.textContent = `Page ${listPage} of ${listTotalPages}`;
            }

            const prev = document.getElementById('offlineSalesPrev');
            const next = document.getElementById('offlineSalesNext');
            if (prev) prev.disabled = listPage <= 1;
            if (next) next.disabled = listPage >= listTotalPages;

            const sales = data.sales || [];
            if (sales.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No offline sales yet</td></tr>';
                return;
            }

            tbody.innerHTML = sales
                .map((s) => {
                    const num = escapeHtml(s.saleNumber || '—');
                    const dt = s.soldAt ? escapeHtml(new Date(s.soldAt).toLocaleString()) : '—';
                    const tot = s.totals && s.totals.total != null ? formatZmw(s.totals.total) : '—';
                    const custParts = [s.customerName, s.customerEmail, s.customerPhone].filter(Boolean);
                    const cust =
                        custParts.length > 0 ? escapeHtml(custParts.join(' · ')) : '—';
                    const by =
                        escapeHtml(s.createdByAdmin?.email || s.createdByAdminEmail || '') || '—';
                    return `<tr>
                        <td><strong>${num}</strong></td>
                        <td>${dt}</td>
                        <td>${tot}</td>
                        <td>${cust}</td>
                        <td>${by}</td>
                    </tr>`;
                })
                .join('');
        } catch {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Failed to load sales</td></tr>';
        }
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function initSoldAtDefault() {
        const el = document.getElementById('soldAtInput');
        if (!el) return;
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        el.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    document.addEventListener('DOMContentLoaded', async () => {
        const ok = await window.AuthUtils?.initializeAuthCheck?.();
        if (ok === false) return;

        initSoldAtDefault();

        document.getElementById('addOfflineLineBtn')?.addEventListener('click', () => addLine());
        document.getElementById('submitOfflineSaleBtn')?.addEventListener('click', () => submitSale());

        document.getElementById('offlineSalesPrev')?.addEventListener('click', () => {
            if (listPage > 1) loadHistory(listPage - 1);
        });
        document.getElementById('offlineSalesNext')?.addEventListener('click', () => {
            if (listPage < listTotalPages) loadHistory(listPage + 1);
        });

        document.addEventListener('click', onDocClickCloseSearch, true);

        addLine();
        loadHistory(1);
    });
})();
