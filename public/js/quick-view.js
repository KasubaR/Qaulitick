/**
 * Quick view modal — triggered from .quick-view-btn[data-product-id] (e.g. product-card.ejs).
 * Fetches GET /api/products/:id and fills the modal; no inline handlers.
 */
(function () {
    'use strict';

    const modal = document.getElementById('quickViewModal');
    if (!modal) return;

    const closeBtn = document.getElementById('quickViewClose');
    const inner = document.getElementById('quickViewInner');
    const loadingEl = document.getElementById('quickViewLoading');
    const errorEl = document.getElementById('quickViewError');
    const bodyEl = document.getElementById('quickViewBody');
    const qvImage = document.getElementById('qvImage');
    const qvTitle = document.getElementById('qvTitle');
    const qvBrand = document.getElementById('qvBrand');
    const qvRating = document.getElementById('qvRating');
    const qvPriceRow = document.getElementById('qvPriceRow');
    const qvColorSection = document.getElementById('qvColorSection');
    const qvColorSelect = document.getElementById('qvColorSelect');
    const qvQtyInput = document.getElementById('qvQtyInput');
    const qvQtyDec = document.getElementById('qvQtyDec');
    const qvQtyInc = document.getElementById('qvQtyInc');
    const qvAddToCart = document.getElementById('qvAddToCart');
    const qvFullDetails = document.getElementById('qvFullDetails');

    let lastFocus = null;
    let currentProduct = null;
    let colorImageMap = new Map();

    function starRatingHtml(rating) {
        const r = Number(rating) || 0;
        let html = '';
        for (let i = 0; i < 5; i++) {
            if (r >= i + 1) {
                html += '<i class="fas fa-star text-warning"></i>';
            } else if (r > i) {
                html += '<i class="fas fa-star-half-alt text-warning"></i>';
            } else {
                html += '<i class="far fa-star text-warning"></i>';
            }
        }
        return html;
    }

    function escapeHtml(s) {
        if (s == null) return '';
        const d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    }

    function truncate(text, max) {
        if (!text) return '';
        const t = String(text).trim();
        if (t.length <= max) return t;
        return t.slice(0, max).trim() + '…';
    }

    function setOpen(open) {
        if (open) {
            modal.classList.add('is-open');
            modal.removeAttribute('hidden');
            document.body.classList.add('quick-view-open');
        } else {
            modal.classList.remove('is-open');
            modal.setAttribute('hidden', '');
            document.body.classList.remove('quick-view-open');
            if (lastFocus && typeof lastFocus.focus === 'function') {
                lastFocus.focus();
            }
            lastFocus = null;
            currentProduct = null;
            qvQtyInput.value = 1;
            qvColorSelect.value = '';
        }
    }

    function showLoading() {
        loadingEl.hidden = false;
        errorEl.hidden = true;
        bodyEl.hidden = true;
        errorEl.textContent = '';
    }

    function showError(msg) {
        loadingEl.hidden = true;
        bodyEl.hidden = true;
        errorEl.hidden = false;
        errorEl.textContent = msg || 'Could not load product.';
    }

    function renderProduct(p) {
        currentProduct = p;
        const id = p._id || p.id;
        let images = p.images;
        if (typeof images === 'string') {
            try {
                images = JSON.parse(images);
            } catch {
                images = [];
            }
        }
        if (!Array.isArray(images)) images = [];
        const imgSrc = images[0] || '/images/placeholder.jpg';

        qvImage.src = imgSrc;
        qvImage.alt = p.model || 'Product';
        qvTitle.textContent = p.model || 'Product';
        qvBrand.textContent = (p.brand || '').toUpperCase();
        qvRating.innerHTML = starRatingHtml(p.rating) + ' <span class="rating-value">(' + (Number(p.rating) || 0) + ')</span>';

        const finalPrice = Number(p.finalPrice != null ? p.finalPrice : p.price) || 0;
        const origPrice = Number(p.originalPrice) || 0;
        let priceHtml = '';
        if (origPrice > finalPrice) {
            priceHtml =
                '<span class="original-price">K' +
                origPrice.toLocaleString() +
                '</span>' +
                '<span class="current-price">K' +
                finalPrice.toLocaleString() +
                '</span>';
        } else {
            priceHtml = '<span class="current-price">K' + finalPrice.toLocaleString() + '</span>';
        }
        qvPriceRow.innerHTML = priceHtml;

        // Colors
        let colors = p.colors;
        if (typeof colors === 'string') {
            try { colors = JSON.parse(colors); } catch { colors = []; }
        }
        if (!Array.isArray(colors)) colors = [];
        const normalizedColors = colors.map(function (c) {
            if (typeof c === 'string') return { name: c, image: '' };
            const img = c.image || c.imageUrl || c.img || '';
            return { name: (c.name || '').trim(), image: typeof img === 'string' ? img.trim() : '' };
        }).filter(function (c) { return c.name; });

        // Build color → image map
        colorImageMap = new Map();
        normalizedColors.forEach(function (c) { if (c.image) colorImageMap.set(c.name, c.image); });

        if (normalizedColors.length > 0) {
            qvColorSelect.innerHTML = '<option value="">Select a color</option>' +
                normalizedColors.map(function (c) {
                    return '<option value="' + escapeHtml(c.name) + '">' + escapeHtml(c.name) + '</option>';
                }).join('');
            qvColorSection.hidden = false;
        } else {
            qvColorSelect.innerHTML = '<option value="">Select a color</option>';
            qvColorSection.hidden = true;
        }
        qvColorSelect.value = '';

        // Reset quantity
        const maxStock = Number(p.stock) || 99;
        qvQtyInput.max = maxStock;
        qvQtyInput.value = 1;
        qvQtyDec.disabled = true;
        qvQtyInc.disabled = maxStock <= 1;

        const oos = p.stockStatus === 'out-of-stock' || (Number(p.stock) || 0) <= 0;

        qvFullDetails.href = '/product/' + id;
        qvAddToCart.disabled = oos;
        qvAddToCart.setAttribute('aria-disabled', oos ? 'true' : 'false');

        loadingEl.hidden = true;
        errorEl.hidden = true;
        bodyEl.hidden = false;
    }

    async function openQuickView(productId) {
        lastFocus = document.activeElement;
        setOpen(true);
        showLoading();
        closeBtn.focus();

        try {
            const res = await fetch('/api/products/' + encodeURIComponent(productId), {
                credentials: 'same-origin',
                headers: { Accept: 'application/json' }
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success || !data.product) {
                showError(data.message || 'Product not found.');
                return;
            }
            renderProduct(data.product);
        } catch {
            showError('Network error. Please try again.');
        }
    }

    document.addEventListener(
        'click',
        function (e) {
            const btn = e.target.closest('.quick-view-btn[data-product-id]');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            const id = btn.getAttribute('data-product-id');
            if (!id) return;
            openQuickView(id);
        },
        true
    );

    function closeModal() {
        setOpen(false);
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }

    modal.addEventListener('click', function (e) {
        if (e.target === modal) closeModal();
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal.classList.contains('is-open')) {
            closeModal();
        }
    });

    if (qvColorSelect) {
        qvColorSelect.addEventListener('change', function () {
            const colorName = qvColorSelect.value.trim();
            if (colorName && colorImageMap.has(colorName)) {
                qvImage.src = colorImageMap.get(colorName);
            } else if (currentProduct) {
                // fall back to the first product image
                let imgs = currentProduct.images;
                if (typeof imgs === 'string') { try { imgs = JSON.parse(imgs); } catch { imgs = []; } }
                if (!Array.isArray(imgs)) imgs = [];
                qvImage.src = imgs[0] || '/images/placeholder.jpg';
            }
        });
    }

    if (qvQtyDec) {
        qvQtyDec.addEventListener('click', function () {
            let v = parseInt(qvQtyInput.value, 10) || 1;
            if (v > 1) {
                v--;
                qvQtyInput.value = v;
            }
            qvQtyDec.disabled = v <= 1;
            qvQtyInc.disabled = v >= (parseInt(qvQtyInput.max, 10) || 99);
        });
    }

    if (qvQtyInc) {
        qvQtyInc.addEventListener('click', function () {
            const max = parseInt(qvQtyInput.max, 10) || 99;
            let v = parseInt(qvQtyInput.value, 10) || 1;
            if (v < max) {
                v++;
                qvQtyInput.value = v;
            }
            qvQtyDec.disabled = v <= 1;
            qvQtyInc.disabled = v >= max;
        });
    }

    if (qvAddToCart) {
        qvAddToCart.addEventListener('click', function () {
            if (!currentProduct || qvAddToCart.disabled) return;
            const id = currentProduct._id || currentProduct.id;
            const name = currentProduct.model || 'Product';
            const price = Number(currentProduct.finalPrice != null ? currentProduct.finalPrice : currentProduct.price) || 0;
            const qty = parseInt(qvQtyInput.value, 10) || 1;
            const color = qvColorSelect.value || null;
            if (typeof window.addToCart === 'function') {
                window.addToCart(name, price, id, qty, color);
            }
        });
    }
})();
