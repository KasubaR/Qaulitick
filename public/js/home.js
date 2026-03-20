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

    // Timer intervals
    let flashTimerInterval = null;
    let sliderInterval = null; // Kept for cleanup, but not used for auto-sliding

    // Initialize home page
    async function initHomePage() {
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

            // Load flash sales
            const flashResponse = await fetch('/api/marketing/flash-sales');
            if (flashResponse.ok) {
                const flashData = await flashResponse.json();
                if (flashData.success) {
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

    // Render Flash Sale Products
    function renderFlashProducts() {
        if (!flashProducts) return;
        
        flashProducts.innerHTML = '';
        
        // Filter to only show sales with showBanner === true
        const visibleSales = flashSalesData.filter(sale => sale.showBanner);
        
        if (visibleSales.length === 0) {
            // Hide flash sales section if no visible sales
            if (flashSalesSection) {
                flashSalesSection.classList.add('is-hidden');
            }
            return;
        }

        // Ensure section is visible when there are visible sales
        if (flashSalesSection) {
            flashSalesSection.classList.remove('is-hidden');
        }

        // Get products from first visible flash sale
        const activeSale = visibleSales[0];
        
        // Update banner text if available
        const flashBannerText = document.getElementById('flashBannerText');
        if (flashBannerText && activeSale.bannerText) {
            flashBannerText.textContent = activeSale.bannerText;
        }
        
        if (activeSale && activeSale.products && activeSale.products.length > 0) {
            activeSale.products.forEach(product => {
                const card = createProductCard(product, true);
                flashProducts.appendChild(card);
            });
        }
    }

    // Create Product Card
    function createProductCard(product, isFlashSale = false) {
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

        // Featured products: reuse the same markup/classes as views/partials/product-card.ejs
        // so shop.css styling applies on home.
        if (!isFlashSale) {
            const link = document.createElement("a");
            link.href = `/product/${productId}`;
            link.className = "product-link";

            const card = document.createElement("div");
            // Add home slider sizing via home.css while keeping shop.card styling via shop.css classes
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

            const img = document.createElement("img");
            img.src = productImage;
            img.alt = productName;
            img.className = "product-image";
            img.loading = "lazy";
            img.decoding = "async";
            img.width = 400;
            img.height = 400;
            imageWrapper.appendChild(img);

            card.appendChild(imageWrapper);

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

            // Strap meta line (matches shop.ejs)
            const meta = document.createElement("div");
            meta.className = "product-meta";

            const strapSpan = document.createElement("span");
            strapSpan.className = "product-strap";

            const linkIcon = document.createElement("i");
            linkIcon.className = "fas fa-link";
            strapSpan.appendChild(linkIcon);

            const strapText = document.createTextNode(` ${product.strapType || "N/A"}`);
            strapSpan.appendChild(strapText);

            meta.appendChild(strapSpan);
            productInfo.appendChild(meta);

            card.appendChild(productInfo);
            link.appendChild(card);
            return link;
        }

        // Flash sale product card — uses fs-card CSS classes from home.css
        const link = document.createElement("a");
        link.href = `/product/${productId}`;
        link.className = "fs-card";

        // Image wrap + badge
        const imageWrap = document.createElement("div");
        imageWrap.className = "fs-card-image-wrap";

        const img = document.createElement("img");
        img.src = productImage;
        img.alt = productName;
        img.loading = "lazy";
        imageWrap.appendChild(img);

        const badge = document.createElement("span");
        badge.className = "fs-card-badge";
        badge.textContent = "Flash Sale";
        imageWrap.appendChild(badge);

        link.appendChild(imageWrap);

        // Body
        const body = document.createElement("div");
        body.className = "fs-card-body";

        const brandEl = document.createElement("div");
        brandEl.className = "fs-card-brand";
        brandEl.textContent = product.brand || "";
        body.appendChild(brandEl);

        const nameEl = document.createElement("div");
        nameEl.className = "fs-card-name";
        nameEl.textContent = productName;
        body.appendChild(nameEl);

        const pricesEl = document.createElement("div");
        pricesEl.className = "fs-card-prices";

        const priceEl = document.createElement("span");
        priceEl.className = "fs-card-price";
        priceEl.textContent = `K${(currentPrice || 0).toLocaleString()}`;
        pricesEl.appendChild(priceEl);

        if (originalPrice && originalPrice > currentPrice) {
            const origEl = document.createElement("span");
            origEl.className = "fs-card-original";
            origEl.textContent = `K${originalPrice.toLocaleString()}`;
            pricesEl.appendChild(origEl);
        }
        body.appendChild(pricesEl);

        const button = document.createElement("button");
        button.className = "fs-card-btn";
        button.textContent = "Add to Cart";
        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (window.addToCart) {
                window.addToCart(productName, currentPrice || 0, product.id || product._id);
            }
        });
        body.appendChild(button);

        link.appendChild(body);
        return link;
    }

    // Timer Functions
    function initTimers() {
        clearInterval(flashTimerInterval);
        
        // Only show timer for flash sales with showBanner === true
        const visibleSales = flashSalesData.filter(sale => sale.showBanner);
        if (flashTimer && visibleSales.length > 0) {
            updateFlashTimer();
            flashTimerInterval = setInterval(updateFlashTimer, 1000);
        }
    }

    function updateFlashTimer() {
        // Only show timer for flash sales with showBanner === true
        const visibleSales = flashSalesData.filter(sale => sale.showBanner);
        if (!flashTimer || visibleSales.length === 0) return;
        
        const activeSale = visibleSales[0];
        if (!activeSale) return;

        const now = new Date();
        const endTime = new Date(activeSale.endDate);
        const timeLeft = endTime - now;

        if (timeLeft <= 0) {
            flashTimer.textContent = '00:00:00';
            clearInterval(flashTimerInterval);

            // Hide flash sales section when sale has ended
            if (flashSalesSection) {
                flashSalesSection.classList.add('is-hidden');
            }
            if (flashProducts) {
                flashProducts.innerHTML = '';
            }
            return;
        }

        const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);

        flashTimer.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
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
            newsletterForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const email = e.target.querySelector('.newsletter-input').value;
                if (window.subscribeNewsletter) {
                    window.subscribeNewsletter({ target: e.target });
                }
                e.target.reset();
            });
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
            // Only show timer for flash sales with showBanner === true
            const visibleSales = flashSalesData.filter(sale => sale.showBanner);
            if (flashTimer && visibleSales.length > 0) {
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
