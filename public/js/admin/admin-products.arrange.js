// Admin Products - Arrange / drag-and-drop display order

(function (window) {
    const DRAG_OVER_CLASS = 'arrange-row--dragover';
    let allProducts = [];   // full flat list loaded for arrange mode
    let dragSrc = null;

    function open() {
        loadAllAndShow();
    }

    async function loadAllAndShow() {
        const btn = document.getElementById('arrangeProductsBtn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading…'; }

        try {
            // Load all products (no pagination) sorted by current sortOrder
            const result = await AdminProductsAPI.loadProducts({ sortBy: 'sort_order', status: 'all' }, 1, 9999);
            allProducts = result.products || [];
            renderList(allProducts);
            document.getElementById('arrangeModal').style.display = 'flex';
        } catch (err) {
            alert('Failed to load products: ' + err.message);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sort"></i> Arrange'; }
        }
    }

    function renderList(products) {
        const list = document.getElementById('arrangeList');
        list.innerHTML = '';

        products.forEach((p, index) => {
            const row = document.createElement('div');
            row.className = 'arrange-row';
            row.draggable = true;
            row.dataset.id = p.id || p._id;
            row.style.cssText = [
                'display:flex',
                'align-items:center',
                'gap:12px',
                'padding:10px 14px',
                'cursor:grab',
                'user-select:none',
                'border-bottom:1px solid var(--admin-border,#2a2a2a)',
                'background:var(--admin-card,#1a1a1a)',
                'transition:background 0.15s'
            ].join(';');

            const thumb = (Array.isArray(p.images) && p.images[0]) ? p.images[0] : '/images/placeholder.png';

            row.innerHTML =
                '<span style="color:#555;font-size:18px;flex-shrink:0;"><i class="fas fa-grip-vertical"></i></span>' +
                '<img src="' + thumb + '" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:4px;flex-shrink:0;" onerror="this.src=\'/images/placeholder.png\'">' +
                '<span style="flex:1;font-size:14px;color:var(--admin-text,#e0e0e0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(p.model || p.name || 'Product') + '</span>' +
                '<span style="font-size:12px;color:#666;">' + escapeHtml(p.brand || '') + '</span>' +
                '<span style="font-size:11px;color:#444;min-width:28px;text-align:right;">#' + (index + 1) + '</span>';

            row.addEventListener('dragstart', onDragStart);
            row.addEventListener('dragover', onDragOver);
            row.addEventListener('dragleave', onDragLeave);
            row.addEventListener('drop', onDrop);
            row.addEventListener('dragend', onDragEnd);

            list.appendChild(row);
        });
    }

    function renumberRows() {
        const rows = document.querySelectorAll('#arrangeList .arrange-row');
        rows.forEach((r, i) => {
            const num = r.querySelector('span:last-child');
            if (num) num.textContent = '#' + (i + 1);
        });
    }

    // ---- Drag handlers ----
    function onDragStart(e) {
        dragSrc = this;
        e.dataTransfer.effectAllowed = 'move';
        this.style.opacity = '0.4';
    }

    function onDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        this.style.background = 'var(--admin-hover,#252525)';
        return false;
    }

    function onDragLeave() {
        this.style.background = '';
    }

    function onDrop(e) {
        e.stopPropagation();
        if (dragSrc !== this) {
            const list = this.parentNode;
            const allRows = Array.from(list.querySelectorAll('.arrange-row'));
            const srcIdx = allRows.indexOf(dragSrc);
            const tgtIdx = allRows.indexOf(this);
            if (srcIdx < tgtIdx) {
                list.insertBefore(dragSrc, this.nextSibling);
            } else {
                list.insertBefore(dragSrc, this);
            }
            renumberRows();
        }
        this.style.background = '';
        return false;
    }

    function onDragEnd() {
        document.querySelectorAll('#arrangeList .arrange-row').forEach(r => {
            r.style.opacity = '';
            r.style.background = '';
        });
    }

    // ---- Save ----
    async function save() {
        const rows = document.querySelectorAll('#arrangeList .arrange-row');
        const orderedIds = Array.from(rows).map(r => parseInt(r.dataset.id, 10));

        const btn = document.getElementById('saveArrangeBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

        try {
            await AdminProductsAPI.reorderProducts(orderedIds);
            close();
            // Reload the table to reflect the new order
            if (typeof loadProducts === 'function') {
                loadProducts({}, 1, false);
            } else if (typeof window.reloadProducts === 'function') {
                window.reloadProducts();
            }
            showToast('Product order saved successfully', 'success');
        } catch (err) {
            alert('Failed to save order: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Save Order';
        }
    }

    function close() {
        document.getElementById('arrangeModal').style.display = 'none';
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function showToast(message, type) {
        if (typeof window.showAdminToast === 'function') {
            window.showAdminToast(message, type);
            return;
        }
        // Fallback simple toast
        const t = document.createElement('div');
        t.textContent = message;
        t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#2ecc71;color:#fff;padding:12px 20px;border-radius:6px;font-size:14px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.3)';
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }

    // ---- Wire up events ----
    document.addEventListener('DOMContentLoaded', function () {
        const openBtn = document.getElementById('arrangeProductsBtn');
        if (openBtn) openBtn.addEventListener('click', open);

        const closeBtn = document.getElementById('closeArrangeModal');
        if (closeBtn) closeBtn.addEventListener('click', close);

        const cancelBtn = document.getElementById('cancelArrangeBtn');
        if (cancelBtn) cancelBtn.addEventListener('click', close);

        const saveBtn = document.getElementById('saveArrangeBtn');
        if (saveBtn) saveBtn.addEventListener('click', save);

        // Close when clicking backdrop
        const modal = document.getElementById('arrangeModal');
        if (modal) {
            modal.addEventListener('click', function (e) {
                if (e.target === modal) close();
            });
        }
    });
})(window);
