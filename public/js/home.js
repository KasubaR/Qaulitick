// Home Page Specific JavaScript
// Featured Products Slider, Timers, Flash Sales
// Now fetches data from admin-managed marketing API

// Wrap in IIFE to avoid variable conflicts
(function() {
    'use strict';
    
    // DOM Elements
    const featuredSlider = document.getElementById("featuredSlider");
    const featuredViewAllWrapper = document.getElementById("featuredViewAllWrapper");
    const flashSalesSection = document.getElementById("flashSalesSection");
    const flashProducts = document.getElementById("flashProducts");
    const flashTimer = document.getElementById("flashTimer");

    // Marketing data (loaded from API)
    let featuredProductsData = [];
    let flashSalesData = [];
    /** True only when /api/marketing/flash-sales returned success (used to avoid clearing SSR cards on network errors). */
    let flashSalesApiSucceeded = false;

    // Timer intervals
    let flashTimerInterval = null;
    let sliderInterval = null; // Kept for cleanup, but not used for auto-sliding

    let newsletterSubmitting = false;

    // Reveal server-rendered product card images (shop.css sets opacity:0 until .loaded)
    function revealProductCardImages(container) {
        const imgs = (container || document).querySelectorAll('.product-image img');
        imgs.forEach(function (img) {
            if (img.complete) {
                img.classList.add('loaded');
            } else {
                img.addEventListener('load', function () { img.classList.add('loaded'); });
                img.addEventListener('error', function () {
                    img.src = '/images/placeholder.jpg';
                    img.classList.add('loaded');
                });
            }
        });
    }

    // Initialize home page
    async function initHomePage() {
        revealProductCardImages();
        await loadMarketingData();
        renderFeaturedProducts();
        renderFlashProducts();
        initTimers();
        setupSliderNavigation();
        setupHomeEventListeners();
    }

    // Load marketing data from API
    async function loadMarketingData() {
        try {
            // Load featured products
            const featuredResponse = await fetch('/api/marketing/featured-products');
            if (featuredResponse.ok) {
                const featuredData = await featuredResponse.json();
                if (featuredData.success) {
                    featuredProductsData = featuredData.products || [];
                }
            }

            flashSalesApiSucceeded = false;
            const flashResponse = await fetch('/api/marketing/flash-sales');
            if (flashResponse.ok) {
                const flashData = await flashResponse.json();
                if (flashData.success) {
                    flashSalesApiSucceeded = true;
                    flashSalesData = flashData.flashSales || [];
                }
            }
        } catch (error) {
            console.error('Error loading marketing data:', error);
            // Fallback to empty arrays - sections won't display
        }
    }

    // Render Featured Products (static display, no auto-sliding)
    function renderFeaturedProducts() {
        if (!featuredSlider) return;
        
        // Hide the "View All Products" button when there are no featured items
        if (featuredViewAllWrapper) {
            featuredViewAllWrapper.classList.toggle('is-hidden', featuredProductsData.length === 0);
        }

        featuredSlider.innerHTML = '';
        
        if (featuredProductsData.length === 0) {
            featuredSlider.innerHTML = `
                <div class="featured-empty-state">
                    <div class="featured-empty-icon">
                        <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <circle cx="32" cy="32" r="31" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
                            <path d="M20 26l12-8 12 8v14a2 2 0 01-2 2H22a2 2 0 01-2-2V26z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                            <path d="M28 44V32h8v12" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                        </svg>
                    </div>
                    <h3 class="featured-empty-title">No Featured Products Yet</h3>
                    <p class="featured-empty-sub">Our curated selection is being prepared. Check back soon or explore our full collection.</p>
                    <a href="/shop" class="featured-empty-btn">
                        Browse All Watches
                        <img src="/images/icons/arrow-Icon-2.svg" alt="">
                    </a>
                </div>`;
            return;
        }

        // Display all featured products (no limit on display, but admin limits to MAX_FEATURED_PRODUCTS)
        featuredProductsData.forEach(product => {
            const card = createProductCard(product);
            featuredSlider.appendChild(card);
        });
        
        // Setup static display (no auto-sliding)
        setupSliderNavigation();
    }

    // Flash sale product cards are server-rendered (partials/product-card.ejs). Sync banner + hide if API says sale ended.
    function renderFlashProducts() {
        if (!flashProducts) return;

        if (flashProducts.dataset.ssrFlashCards !== '1') {
            return;
        }

        const visibleSales = flashSalesData.filter(sale => sale.showBanner);
        if (flashSalesApiSucceeded && visibleSales.length === 0) {
            if (flashSalesSection) {
                flashSalesSection.classList.add('is-hidden');
            }
            flashProducts.innerHTML = '';
            flashProducts.removeAttribute('data-ssr-flash-cards');
            if (flashSalesSection) {
                flashSalesSection.removeAttribute('data-flash-end');
            }
            return;
        }

        const activeSale = visibleSales[0];
        const flashBannerText = document.getElementById('flashBannerText');
        if (flashBannerText && activeSale.bannerText) {
            flashBannerText.textContent = activeSale.bannerText;
        }
    }

    // Create Product Card (featured slider only — flash sale uses server-rendered partials/product-card.ejs)
    function createProductCard(product) {
        const productId = product._id || product.id;
        const productName = product.model || product.name;

        const productRating = Number(product.rating) || 0;
        const productDiscount = Number(product.discount) || 0;
        const productStock = Number(product.stock) || 0;

        let images = product.images;
        if (typeof images === 'string') {
            try { images = JSON.parse(images); } catch (e) { images = []; }
        }
        if (!Array.isArray(images)) images = [];

        const productImage = images[0] || product.image || '/images/placeholder.jpg';

        const currentPrice = Number(product.finalPrice || product.price || 0) || 0;
        const originalPrice = Number(product.originalPrice || product.price || 0) || 0;

        // Featured: align with views/partials/product-card.ejs (shop.css + quick view on home).
        const productUrl = `/product/${productId}`;
        const card = document.createElement("div");
        card.className = "shop-product-card product-card";

        const imageWrapper = document.createElement("div");
        imageWrapper.className = "product-image-wrapper";

        if (productDiscount > 0) {
            const badge = document.createElement("span");
            badge.className = "discount-badge";
            badge.textContent = `-${productDiscount}%`;
            imageWrapper.appendChild(badge);
        }

        if (productStock === 0) {
            const overlay = document.createElement("div");
            overlay.className = "out-of-stock-overlay";
            overlay.textContent = "Out of Stock";
            imageWrapper.appendChild(overlay);
        }

        const imageBox = document.createElement("div");
        imageBox.className = "product-image";

        const mediaLink = document.createElement("a");
        mediaLink.href = productUrl;
        mediaLink.className = "product-link product-link--media";

        const img = document.createElement("img");
        img.src = productImage;
        img.alt = productName;
        img.loading = "lazy";
        img.decoding = "async";
        img.width = 400;
        img.height = 400;
        if (img.complete) {
            img.classList.add('loaded');
        } else {
            img.addEventListener('load', function () { img.classList.add('loaded'); });
            img.addEventListener('error', function () {
                img.src = '/images/placeholder.jpg';
                img.classList.add('loaded');
            });
        }
        mediaLink.appendChild(img);
        imageBox.appendChild(mediaLink);

        const productActions = document.createElement("div");
        productActions.className = "product-actions";
        const quickViewBtn = document.createElement("button");
        quickViewBtn.type = "button";
        quickViewBtn.className = "quick-view-btn";
        quickViewBtn.setAttribute("data-product-id", String(productId));
        quickViewBtn.setAttribute("aria-label", "Quick view: " + productName);
        quickViewBtn.innerHTML = '<i class="fas fa-eye" aria-hidden="true"></i>';
        productActions.appendChild(quickViewBtn);
        imageBox.appendChild(productActions);

        imageWrapper.appendChild(imageBox);
        card.appendChild(imageWrapper);

        const infoLink = document.createElement("a");
        infoLink.href = productUrl;
        infoLink.className = "product-link product-link--info";

        const productInfo = document.createElement("div");
        productInfo.className = "product-info";

        const brand = document.createElement("div");
        brand.className = "product-brand";
        brand.textContent = product.brand || "Brand";
        productInfo.appendChild(brand);

        const h3 = document.createElement("h3");
        h3.className = "product-name";
        h3.textContent = productName;
        productInfo.appendChild(h3);

        const ratingDiv = document.createElement("div");
        ratingDiv.className = "product-rating";
        for (let i = 1; i <= 5; i++) {
            const star = document.createElement("i");
            if (i <= Math.floor(productRating)) {
                star.className = "fas fa-star";
            } else if (i === Math.ceil(productRating) && productRating % 1 !== 0) {
                star.className = "fas fa-star-half-alt";
            } else {
                star.className = "far fa-star";
            }
            ratingDiv.appendChild(star);
        }
        const ratingValue = document.createElement("span");
        ratingValue.className = "rating-value";
        ratingValue.textContent = `(${productRating})`;
        ratingDiv.appendChild(ratingValue);
        productInfo.appendChild(ratingDiv);

        const priceDiv = document.createElement("div");
        priceDiv.className = "product-price";
        if (productDiscount > 0) {
            const originalEl = document.createElement("span");
            originalEl.className = "original-price";
            originalEl.textContent = `K${originalPrice.toLocaleString()}`;
            priceDiv.appendChild(originalEl);
            const currentEl = document.createElement("span");
            currentEl.className = "current-price";
            currentEl.dataset.finalPrice = String(currentPrice);
            currentEl.textContent = `K${currentPrice.toLocaleString()}`;
            priceDiv.appendChild(currentEl);
        } else {
            const currentEl = document.createElement("span");
            currentEl.className = "current-price";
            currentEl.dataset.finalPrice = String(currentPrice);
            currentEl.textContent = `K${currentPrice.toLocaleString()}`;
            priceDiv.appendChild(currentEl);
        }
        productInfo.appendChild(priceDiv);

        const meta = document.createElement("div");
        meta.className = "product-meta";
        const strapSpan = document.createElement("span");
        strapSpan.className = "product-strap";
        const linkIcon = document.createElement("i");
        linkIcon.className = "fas fa-link";
        strapSpan.appendChild(linkIcon);
        strapSpan.appendChild(document.createTextNode(` ${product.strapType || "N/A"}`));
        meta.appendChild(strapSpan);
        productInfo.appendChild(meta);

        infoLink.appendChild(productInfo);
        card.appendChild(infoLink);
        return card;
    }

    function getActiveFlashEndDate() {
        const visibleSales = flashSalesData.filter(sale => sale.showBanner);
        if (visibleSales.length > 0 && visibleSales[0].endDate) {
            return new Date(visibleSales[0].endDate);
        }
        const iso = flashSalesSection && flashSalesSection.dataset.flashEnd;
        if (iso && flashProducts && flashProducts.dataset.ssrFlashCards === '1') {
            const d = new Date(iso);
            if (!Number.isNaN(d.getTime())) return d;
        }
        return null;
    }

    // Timer Functions
    function initTimers() {
        clearInterval(flashTimerInterval);

        const endTime = getActiveFlashEndDate();
        const sectionVisible = flashSalesSection && !flashSalesSection.classList.contains('is-hidden');
        if (flashTimer && endTime && sectionVisible) {
            updateFlashTimer();
            flashTimerInterval = setInterval(updateFlashTimer, 1000);
        }
    }

    function updateFlashTimer() {
        const endTime = getActiveFlashEndDate();
        if (!flashTimer || !endTime) return;

        const now = new Date();
        const timeLeft = endTime - now;

        if (timeLeft <= 0) {
            flashTimer.textContent = '00:00:00';
            clearInterval(flashTimerInterval);

            if (flashSalesSection) {
                flashSalesSection.classList.add('is-hidden');
                flashSalesSection.removeAttribute('data-flash-end');
            }
            if (flashProducts) {
                flashProducts.innerHTML = '';
                flashProducts.removeAttribute('data-ssr-flash-cards');
            }
            return;
        }

        // Full breakdown: days + time remaining today (was wrongly using only % 24h as "hours", so 8d 1h showed as ~01:26:00)
        const msDay = 1000 * 60 * 60 * 24;
        const msHour = 1000 * 60 * 60;
        const msMin = 1000 * 60;
        const days = Math.floor(timeLeft / msDay);
        const remD = timeLeft % msDay;
        const hours = Math.floor(remD / msHour);
        const remH = remD % msHour;
        const minutes = Math.floor(remH / msMin);
        const seconds = Math.floor((remH % msMin) / 1000);

        const hms = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        flashTimer.textContent = days > 0 ? `${days}d ${hms}` : hms;
    }

    // Setup Featured Products (no auto-sliding)
    function setupSliderNavigation() {
        if (!featuredSlider) return;
        
        // Clear any existing slider interval
        clearInterval(sliderInterval);
        sliderInterval = null;
        
        // Reset transform to ensure products are visible
        featuredSlider.style.transform = 'translateX(0)';
        featuredSlider.style.transition = 'none';
        featuredSlider.classList.add('no-slide');
        
        // Add accessibility attributes
        featuredSlider.setAttribute('role', 'region');
        featuredSlider.setAttribute('aria-label', 'Featured products');
    }

    // Handle window resize (no auto-sliding, just ensure proper display)
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (featuredSlider) {
                // Just reset position, no auto-sliding
                featuredSlider.style.transform = 'translateX(0)';
            }
        }, 250);
    });

    // Setup home page event listeners
    function setupHomeEventListeners() {
        // Shop navigation buttons
        const heroShopBtn = document.getElementById('heroShopBtn');
        if (heroShopBtn) {
            heroShopBtn.addEventListener('click', () => {
                window.location.href = '/shop';
            });
        }

        const featuredShopBtn = document.getElementById('featuredShopBtn');
        if (featuredShopBtn) {
            featuredShopBtn.addEventListener('click', () => {
                window.location.href = '/shop';
            });
        }

        // Newsletter form
        const newsletterForm = document.getElementById('newsletterForm');
        if (newsletterForm) {
            newsletterForm.addEventListener('submit', handleNewsletterSubmit);
        }
    }

    async function handleNewsletterSubmit(e) {
        e.preventDefault();
        const form = e.target;
        if (newsletterSubmitting || !(form instanceof HTMLFormElement)) {
            return;
        }

        const emailInput = form.querySelector('input[name="email"]');
        const email = emailInput && typeof emailInput.value === 'string' ? emailInput.value.trim() : '';
        if (!email) {
            if (window.showNotification) {
                window.showNotification('Please enter your email address.', 'error');
            }
            return;
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        const prevBtnText = submitBtn ? submitBtn.textContent : '';

        newsletterSubmitting = true;
        if (submitBtn) {
            submitBtn.disabled = true;
        }

        try {
            const response = await fetch('/api/newsletter/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': typeof window.getCSRFToken === 'function' ? window.getCSRFToken() : ''
                },
                body: JSON.stringify({ email })
            });

            let data = {};
            try {
                data = await response.json();
            } catch (_) {
                data = {};
            }

            if (!response.ok) {
                if (response.status === 429 && data.retryAfter != null) {
                    const minutes = Math.ceil(data.retryAfter / 60);
                    const seconds = data.retryAfter % 60;
                    const timeMessage = minutes > 1
                        ? `Please try again in ${minutes} minutes.`
                        : `Please try again in ${seconds} seconds.`;
                    throw new Error(`${data.message || 'Too many requests.'} ${timeMessage}`);
                }
                if (data.errors && Array.isArray(data.errors)) {
                    throw new Error(data.errors.join(', '));
                }
                throw new Error(data.message || 'Something went wrong. Please try again.');
            }

            if (data.success !== true) {
                throw new Error(data.message || 'Something went wrong. Please try again.');
            }

            form.reset();

            // GA: only after HTTP OK and JSON success — never in finally (failed/non-OK must not count).
            if (window.AnalyticsEvents && typeof window.AnalyticsEvents.trackNewsletterSubscribe === 'function') {
                window.AnalyticsEvents.trackNewsletterSubscribe();
            }

            if (window.showNotification) {
                window.showNotification(
                    data.message || "Thanks — you're on the list. We'll share new collections and offers when there's news.",
                    'success'
                );
            }
        } catch (err) {
            const msg = err && err.message
                ? err.message
                : 'Unable to reach the server. Please check your connection and try again.';
            if (window.showNotification) {
                window.showNotification(msg, 'error');
            }
        } finally {
            newsletterSubmitting = false;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = prevBtnText;
            }
        }
    }

    // Cleanup timers
    function cleanupHomeTimers() {
        clearInterval(flashTimerInterval);
        clearInterval(sliderInterval);
        flashTimerInterval = null;
        sliderInterval = null;
    }

    // Pause/resume timers based on page visibility
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearInterval(flashTimerInterval);
            clearInterval(sliderInterval);
            flashTimerInterval = null;
            sliderInterval = null;
        } else {
            if (flashTimer && getActiveFlashEndDate() && flashSalesSection && !flashSalesSection.classList.contains('is-hidden')) {
                initTimers();
            }
        }
    });

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        cleanupHomeTimers();
    });

    // Initialize when page loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initHomePage);
    } else {
        initHomePage();
    }
})(); // End IIFE
