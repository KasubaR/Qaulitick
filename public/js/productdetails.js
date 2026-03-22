// Product Details Page JavaScript
// Handles all interactive functionality for the product details page

// ====================================
// STATE MANAGEMENT
// ====================================

let currentImageIndex = 0;
let selectedColor = null;
let selectedStrap = null;
let quantity = 1;
let reviewRating = 0;

// Product from server (window.productData) with reliable stock from data attributes as fallback
function parseStockValue(raw) {
    const n = parseInt(String(raw === undefined || raw === null ? '' : raw), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

const addToCartBtnRef = document.getElementById('addToCartBtn');
const product = (() => {
    const base =
        window.productData && typeof window.productData === 'object' ? { ...window.productData } : {};
    const id = base._id || base.id || (addToCartBtnRef && addToCartBtnRef.dataset.productId);
    const stockFromDom = addToCartBtnRef && addToCartBtnRef.dataset.productStock;
    const stockRaw = base.stock != null && base.stock !== '' ? base.stock : stockFromDom;
    return {
        ...base,
        _id: id,
        id: id,
        stock: parseStockValue(stockRaw)
    };
})();

// ====================================
// INITIALIZATION
// ====================================

function initProductPage() {
    initImageGallery();
    initTabs();
    initQuantityControls();
    initActionButtons();
    initReviewModal();
    initVariantSelectors();
    updateCartCount();

    // Listen for cart updates to update button state
    window.addEventListener('cartUpdated', (e) => {
        // Force reload from storage to ensure we have latest data
        // Clear any cached cart data and reload
        updateAddToCartButton();
        updateCartCount();
    });

    // Also listen for storage events (cross-tab sync and same-tab updates)
    window.addEventListener('storage', (e) => {
        if (e.key === 'cart') {
            updateAddToCartButton();
            updateCartCount();
        }
    });
}

// ====================================
// IMAGE GALLERY
// ====================================

function initImageGallery() {
    const thumbnails = document.querySelectorAll('.thumbnail');
    const mainImage = document.getElementById('mainImage');
    const zoomBtn = document.getElementById('zoomBtn');
    const zoomModal = document.getElementById('zoomModal');
    const zoomClose = document.getElementById('zoomClose');
    const zoomedImage = document.getElementById('zoomedImage');

    // Thumbnail click handler
    thumbnails.forEach((thumbnail, index) => {
        thumbnail.addEventListener('click', () => {
            if (thumbnail.dataset.video === 'true') {
                // Handle video thumbnail (future implementation)
                showNotification('Video preview coming soon!');
                return;
            }

            // Update active thumbnail
            thumbnails.forEach(t => t.classList.remove('active'));
            thumbnail.classList.add('active');

            // Update main image
            currentImageIndex = index;
            const imgSrc = product.images[index];
            mainImage.src = imgSrc;
            mainImage.style.animation = 'fadeIn 0.3s ease';
        });
    });

    // Zoom functionality
    if (zoomBtn && zoomModal) {
        zoomBtn.addEventListener('click', () => {
            zoomedImage.src = mainImage.src;
            zoomModal.classList.add('active');
            document.body.style.overflow = 'hidden';
        });

        zoomClose.addEventListener('click', closeZoomModal);
        zoomModal.addEventListener('click', (e) => {
            if (e.target === zoomModal) {
                closeZoomModal();
            }
        });

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (zoomModal.classList.contains('active')) {
                if (e.key === 'Escape') {
                    closeZoomModal();
                } else if (e.key === 'ArrowLeft') {
                    navigateImage(-1);
                } else if (e.key === 'ArrowRight') {
                    navigateImage(1);
                }
            }
        });
    }
}

function closeZoomModal() {
    const zoomModal = document.getElementById('zoomModal');
    zoomModal.classList.remove('active');
    document.body.style.overflow = 'auto';
}

function navigateImage(direction) {
    const newIndex = currentImageIndex + direction;
    if (newIndex >= 0 && newIndex < product.images.length) {
        const thumbnails = document.querySelectorAll('.thumbnail:not([data-video])');
        thumbnails[newIndex].click();
    }
}

// ====================================
// TABS SYSTEM
// ====================================

function initTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;

            // Remove active class from all buttons and contents
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));

            // Add active class to clicked button and corresponding content
            button.classList.add('active');
            document.getElementById(targetTab).classList.add('active');

            // Smooth scroll to tabs section on mobile
            if (window.innerWidth < 768) {
                document.querySelector('.tabs-section').scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Make review count clickable to open reviews tab
    const reviewCount = document.querySelector('.review-count');
    if (reviewCount) {
        reviewCount.addEventListener('click', () => {
            const reviewsTab = document.querySelector('[data-tab="reviews"]');
            reviewsTab.click();
        });
    }
}

// ====================================
// QUANTITY CONTROLS
// ====================================

function initQuantityControls() {
    const decreaseBtn = document.getElementById('decreaseQty');
    const increaseBtn = document.getElementById('increaseQty');
    const quantityInput = document.getElementById('quantityInput');

    if (!decreaseBtn || !increaseBtn || !quantityInput) return;

    decreaseBtn.addEventListener('click', () => {
        if (quantity > 1) {
            quantity--;
            quantityInput.value = quantity;
            updateButtonStates();
        }
    });

    increaseBtn.addEventListener('click', () => {
        const maxStock = parseInt(quantityInput.max) || 999;
        if (quantity < maxStock) {
            quantity++;
            quantityInput.value = quantity;
            updateButtonStates();
        }
    });

    // Handle manual input
    quantityInput.addEventListener('change', () => {
        let value = parseInt(quantityInput.value) || 1;
        const maxStock = parseInt(quantityInput.max) || 999;

        if (value < 1) value = 1;
        if (value > maxStock) value = maxStock;

        quantity = value;
        quantityInput.value = value;
        updateButtonStates();
    });

    updateButtonStates();
}

function updateButtonStates() {
    const decreaseBtn = document.getElementById('decreaseQty');
    const increaseBtn = document.getElementById('increaseQty');
    const quantityInput = document.getElementById('quantityInput');

    if (!decreaseBtn || !increaseBtn || !quantityInput) return;

    const maxStock = parseInt(quantityInput.max) || 999;

    decreaseBtn.disabled = quantity <= 1;
    increaseBtn.disabled = quantity >= maxStock;
}

// ====================================
// ACTION BUTTONS
// ====================================

function initActionButtons() {
    const addToCartBtn = document.getElementById('addToCartBtn');
    const buyNowBtn = document.getElementById('buyNowBtn');

    // Check if product is already in cart and update button
    updateAddToCartButton();

    // Add to Cart
    if (addToCartBtn) {
        addToCartBtn.addEventListener('click', handleAddToCartClick);
    }

    // Buy Now
    if (buyNowBtn) {
        buyNowBtn.addEventListener('click', handleBuyNow);
    }

}

// Check if current product variant is in cart
function isProductInCart() {
    const cart = getCartItems();
    // Ensure cart is an array and not empty
    if (!Array.isArray(cart) || cart.length === 0) return false;

    const currentColor = selectedColor || (product.colors && product.colors[0] ? product.colors[0].name : null);
    const currentStrap = selectedStrap || (product.strapOptions && product.strapOptions[0] ? product.strapOptions[0] : null);

    return cart.some(item => {
        // Check if product ID matches
        const productIdMatch = item.id === product._id ||
            item.productId === product._id ||
            item.id === String(product._id) ||
            item.productId === String(product._id);

        if (!productIdMatch) return false;

        // If no variants are selected, just check product ID
        if (!currentColor && !currentStrap) return true;

        // Check variant match
        const itemColor = item.variant?.color || item.color;
        const itemStrap = item.variant?.strap || item.strap;

        // Match if colors match (or both null/undefined)
        const colorMatch = !currentColor || !itemColor || itemColor === currentColor;
        // Match if straps match (or both null/undefined)
        const strapMatch = !currentStrap || !itemStrap || itemStrap === currentStrap;

        return colorMatch && strapMatch;
    });
}

// Update availability text and quantity max based on the current color's stock
function updateStockDisplay() {
    const colorStock = getColorStock();
    const quantityInput = document.getElementById('quantityInput');
    const availabilityEl = document.querySelector('.availability');

    if (quantityInput) {
        quantityInput.max = colorStock;
        // Clamp current quantity to new max
        if (quantity > colorStock) {
            quantity = Math.max(1, colorStock);
            quantityInput.value = quantity;
        }
        updateButtonStates();
    }

    if (availabilityEl) {
        const threshold = product.lowStockThreshold || 5;
        if (colorStock > threshold) {
            availabilityEl.innerHTML = '<i class="fas fa-check-circle"></i> In Stock';
            availabilityEl.className = 'availability in-stock';
        } else if (colorStock > 0) {
            availabilityEl.innerHTML = `<i class="fas fa-exclamation-circle"></i> Low Stock (${colorStock} left)`;
            availabilityEl.className = 'availability low-stock';
        } else {
            availabilityEl.innerHTML = '<i class="fas fa-times-circle"></i> Out of Stock';
            availabilityEl.className = 'availability out-of-stock';
        }
    }

    // Disable/enable add to cart based on color stock
    const addToCartBtn = document.getElementById('addToCartBtn');
    const buyNowBtn = document.getElementById('buyNowBtn');
    if (addToCartBtn && !isProductInCart()) {
        addToCartBtn.disabled = colorStock === 0;
        if (colorStock === 0) {
            addToCartBtn.innerHTML = '<i class="fas fa-shopping-cart"></i> Out of Stock';
        } else {
            addToCartBtn.innerHTML = '<i class="fas fa-shopping-cart"></i> Add to Cart';
        }
    }
    if (buyNowBtn) buyNowBtn.disabled = colorStock === 0;
}

// Update Add to Cart button based on cart state
function updateAddToCartButton() {
    const addToCartBtn = document.getElementById('addToCartBtn');
    if (!addToCartBtn) return;

    const inCart = isProductInCart();
    const icon = addToCartBtn.querySelector('i');

    if (inCart) {
        addToCartBtn.innerHTML = '<i class="fas fa-shopping-cart"></i> View in Cart';
        addToCartBtn.classList.add('in-cart');
    } else {
        addToCartBtn.innerHTML = '<i class="fas fa-shopping-cart"></i> Add to Cart';
        addToCartBtn.classList.remove('in-cart');
    }
}

// Handle Add to Cart button click
function handleAddToCartClick() {
    if (isProductInCart()) {
        // Navigate to cart if already in cart
        window.location.href = '/cart';
    } else {
        // Add to cart
        handleAddToCart();
    }
}

function getColorStock() {
    if (selectedColor && Array.isArray(product.colors)) {
        const colorEntry = product.colors.find(c => c.name === selectedColor);
        if (colorEntry && colorEntry.stock != null) return colorEntry.stock;
    }
    return product.stock;
}

async function handleAddToCart() {
    // Client-side stock check using color-specific stock
    const availableStock = getColorStock();

    if (availableStock === 0) {
        showNotification('This color is currently out of stock', 'error');
        return;
    }

    if (quantity > availableStock) {
        showNotification(`Only ${availableStock} item${availableStock !== 1 ? 's' : ''} available`, 'error');
        return;
    }

    try {
        // Validate stock server-side before adding to cart
        const response = await fetch('/api/cart/add', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': typeof window.getCSRFToken === 'function' ? window.getCSRFToken() : ''
            },
            body: JSON.stringify({
                productId: product._id || product.id || document.getElementById('addToCartBtn')?.dataset.productId,
                quantity: quantity,
                color: selectedColor || undefined
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            showNotification(data.message || 'Failed to add item to cart', 'error');
            return;
        }

        // Get server-validated cart item
        const cartItem = {
            ...data.cartItem,
            variant: {
                color: selectedColor,
                strap: selectedStrap
            }
        };

        // Get existing cart
        let cart = getCartItems();

        // Check if item already exists (same product, color, strap)
        const existingIndex = cart.findIndex(item => {
            const itemColor = item.variant?.color || item.color;
            const itemStrap = item.variant?.strap || item.strap;
            const cartColor = cartItem.variant?.color || cartItem.color;
            const cartStrap = cartItem.variant?.strap || cartItem.strap;
            return item.id === cartItem.id &&
                itemColor === cartColor &&
                itemStrap === cartStrap;
        });

        if (existingIndex > -1) {
            // Check if total quantity exceeds stock
            const newTotalQuantity = cart[existingIndex].quantity + cartItem.quantity;
            if (newTotalQuantity > cartItem.stock) {
                showNotification(`Only ${cartItem.stock} item${cartItem.stock !== 1 ? 's' : ''} available. You already have ${cart[existingIndex].quantity} in cart.`, 'error');
                return;
            }
            // Update quantity
            cart[existingIndex].quantity = newTotalQuantity;
        } else {
            // Add new item
            cart.push(cartItem);
        }

        // Save to localStorage
        if (setCartItems(cart)) {
            updateCartCount();
            showNotification(`${product.model} added to cart!`, 'success');
            // Update button to "View in Cart"
            updateAddToCartButton();
        } else {
            showNotification('Failed to add item to cart. Please try again.', 'error');
        }
    } catch (error) {
        console.error('Add to cart error:', error);
        showNotification('An error occurred. Please try again.', 'error');
    }
}

function handleBuyNow() {
    if (product.stock === 0) {
        showNotification('This product is currently out of stock', 'error');
        return;
    }

    // Add to cart first
    handleAddToCart();

    // Redirect to checkout after a brief delay
    setTimeout(() => {
        window.location.href = '/checkout';
    }, 500);
}


// ====================================
// VARIANT SELECTORS
// ====================================

function initVariantSelectors() {
    // Color selector
    const colorOptions = document.querySelectorAll('.color-option');
    colorOptions.forEach(option => {
        option.addEventListener('click', () => {
            colorOptions.forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            selectedColor = option.dataset.color;

            // Update color label
            const colorLabel = document.querySelector('.selected-color-label');
            if (colorLabel) colorLabel.textContent = option.dataset.color;

            // Swap main image to the color's image
            const colorImage = option.dataset.image;
            if (colorImage) {
                const mainImage = document.getElementById('mainImage');
                if (mainImage) mainImage.src = colorImage;
            }

            // Update stock display and quantity max for this color
            updateStockDisplay();
            updateAddToCartButton();
        });
    });

    // Initialize default color and refresh stock display
    if (colorOptions.length > 0) {
        selectedColor = colorOptions[0].dataset.color;
        updateStockDisplay();
    }

    // Strap selector
    const strapOptions = document.querySelectorAll('.strap-option');
    strapOptions.forEach(option => {
        option.addEventListener('click', () => {
            strapOptions.forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            selectedStrap = option.dataset.strap;
            // Update button state when variant changes
            updateAddToCartButton();
        });
    });

    // Initialize default strap
    if (strapOptions.length > 0) {
        selectedStrap = strapOptions[0].dataset.strap;
    }
}

// ====================================
// REVIEW MODAL
// ====================================

function initReviewModal() {
    const writeReviewBtn = document.getElementById('writeReviewBtn');
    const reviewModal = document.getElementById('reviewModal');
    const reviewClose = document.getElementById('reviewClose');
    const reviewForm = document.getElementById('reviewForm');
    const starInputs = document.querySelectorAll('.star-rating-input i');

    if (!writeReviewBtn || !reviewModal) return;

    // Open modal
    writeReviewBtn.addEventListener('click', () => {
        reviewModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    });

    // Close modal
    reviewClose.addEventListener('click', closeReviewModal);
    reviewModal.addEventListener('click', (e) => {
        if (e.target === reviewModal) {
            closeReviewModal();
        }
    });

    // Star rating
    starInputs.forEach((star, index) => {
        star.addEventListener('click', () => {
            reviewRating = parseInt(star.dataset.rating);
            document.getElementById('reviewRating').value = reviewRating;

            // Update star display
            starInputs.forEach((s, i) => {
                if (i < reviewRating) {
                    s.classList.remove('far');
                    s.classList.add('fas', 'active');
                } else {
                    s.classList.remove('fas', 'active');
                    s.classList.add('far');
                }
            });
        });

        // Hover effect
        star.addEventListener('mouseenter', () => {
            const hoverRating = parseInt(star.dataset.rating);
            starInputs.forEach((s, i) => {
                if (i < hoverRating) {
                    s.classList.add('active');
                }
            });
        });

        star.addEventListener('mouseleave', () => {
            starInputs.forEach((s, i) => {
                if (i >= reviewRating) {
                    s.classList.remove('active');
                }
            });
        });
    });

    // Form submission
    if (reviewForm) {
        reviewForm.addEventListener('submit', handleReviewSubmit);
    }
}

function closeReviewModal() {
    const reviewModal = document.getElementById('reviewModal');
    reviewModal.classList.remove('active');
    document.body.style.overflow = 'auto';
}

async function handleReviewSubmit(e) {
    e.preventDefault();

    // Prevent double-submission
    const submitButton = e.target.querySelector('button[type="submit"]');
    if (submitButton && submitButton.disabled) {
        return; // Already submitting
    }

    const formData = new FormData(e.target);
    const reviewData = {
        rating: reviewRating,
        title: formData.get('title'),
        comment: formData.get('comment'),
        name: formData.get('name'),
        email: formData.get('email')
    };

    if (reviewRating === 0) {
        showNotification('Please select a rating', 'error');
        return;
    }

    // Validate required fields
    if (!reviewData.email || !reviewData.title || !reviewData.comment || !reviewData.name) {
        showNotification('Please fill in all required fields', 'error');
        return;
    }

    // Show loading state
    let originalText = '';
    if (submitButton) {
        submitButton.disabled = true;
        originalText = submitButton.textContent;
        submitButton.textContent = 'Submitting...';
        submitButton.style.opacity = '0.6';
        submitButton.style.cursor = 'not-allowed';
    }

    try {
        const response = await fetch(`/api/products/${product._id}/reviews`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(reviewData)
        });

        const data = await response.json();

        if (!response.ok) {
            // Smart error messages
            if (response.status === 403) {
                showNotification('Please purchase this product before reviewing', 'error');
            } else if (response.status === 409) {
                showNotification('You already reviewed this product', 'error');
            } else if (response.status === 429) {
                showNotification('Too many attempts. Please try again later.', 'error');
            } else if (response.status === 400) {
                const errorMsg = data.errors && data.errors.length > 0
                    ? data.errors[0]
                    : (data.message || 'Please check your review details');
                showNotification(errorMsg, 'error');
            } else {
                showNotification(data.message || 'Failed to submit review', 'error');
            }
            // Reset button state on error
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = originalText;
                submitButton.style.opacity = '1';
                submitButton.style.cursor = 'pointer';
            }
            return;
        }

        // Success - inject review without reload
        injectNewReview(data.review);
        closeReviewModal();
        showNotification('Review submitted successfully!', 'success');

        // Reset form
        e.target.reset();
        reviewRating = 0;

        // Reset stars
        document.querySelectorAll('.star-rating-input i').forEach(star => {
            star.classList.remove('fas', 'active');
            star.classList.add('far');
        });

        // Update rating display
        updateRatingDisplay(data.productRating, data.totalReviews);

        // Reset button state on success
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = originalText;
            submitButton.style.opacity = '1';
            submitButton.style.cursor = 'pointer';
        }

    } catch (error) {
        console.error('Review submission error:', error);
        showNotification('Network error. Please try again.', 'error');
        // Reset button state on error
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = originalText;
            submitButton.style.opacity = '1';
            submitButton.style.cursor = 'pointer';
        }
    }
}

function injectNewReview(review) {
    const reviewsList = document.querySelector('.reviews-list');
    if (!reviewsList) return;

    // Create review card element
    const reviewCard = document.createElement('div');
    reviewCard.className = 'review-card';

    const verifiedBadge = review.verified
        ? '<div class="verified-badge"><i class="fas fa-check-circle"></i> Verified Purchase</div>'
        : '';

    const reviewDate = new Date(review.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    reviewCard.innerHTML = `
        <div class="review-header">
            <div class="reviewer-info">
                <div class="reviewer-avatar">${review.name.charAt(0)}</div>
                <div>
                    <h4>${escapeHtml(review.name)}</h4>
                    <p class="review-date">${reviewDate}</p>
                </div>
            </div>
            <div class="review-rating">
                ${generateStars(review.rating)}
            </div>
        </div>
        <div class="review-content">
            <h5>${escapeHtml(review.title)}</h5>
            <p>${escapeHtml(review.comment)}</p>
        </div>
        ${verifiedBadge}
    `;

    // Insert at the beginning of reviews list
    const noReviews = reviewsList.querySelector('.no-reviews');
    if (noReviews) {
        noReviews.remove();
    }

    reviewsList.insertBefore(reviewCard, reviewsList.firstChild);
}

function generateStars(rating) {
    let stars = '';
    for (let i = 1; i <= 5; i++) {
        if (i <= rating) {
            stars += '<i class="fas fa-star filled"></i>';
        } else {
            stars += '<i class="fas fa-star"></i>';
        }
    }
    return stars;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateRatingDisplay(newRating, totalReviews) {
    // Update overall rating display
    const ratingNumber = document.querySelector('.rating-number');
    const reviewCount = document.querySelector('.review-count');
    const ratingValue = document.querySelector('.rating-value');

    if (ratingNumber) ratingNumber.textContent = newRating;
    if (ratingValue) ratingValue.textContent = newRating;
    if (reviewCount) reviewCount.textContent = `(${totalReviews} reviews)`;

    // Update stars
    const starsLarge = document.querySelectorAll('.stars-large i');
    const starsSmall = document.querySelectorAll('.product-rating .stars i');

    updateStars(starsLarge, newRating);
    updateStars(starsSmall, newRating);

    // Update reviews tab button
    const reviewsTab = document.querySelector('[data-tab="reviews"]');
    if (reviewsTab) {
        reviewsTab.textContent = `Reviews (${totalReviews})`;
    }
}

function updateStars(starElements, rating) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 !== 0;

    starElements.forEach((star, index) => {
        const starNum = index + 1;
        star.className = '';

        if (starNum <= fullStars) {
            star.classList.add('fas', 'fa-star');
        } else if (starNum === fullStars + 1 && hasHalfStar) {
            star.classList.add('fas', 'fa-star-half-alt');
        } else {
            star.classList.add('far', 'fa-star');
        }
    });
}

// ====================================
// CART HELPERS
// ====================================

function getCartItems() {
    try {
        const data = localStorage.getItem('cart');
        if (!data) return [];

        const parsed = JSON.parse(data);
        // Ensure we return an array (handle case where cart is cleared but localStorage has empty string)
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('Cart retrieval error:', error);
        return [];
    }
}

function setCartItems(items) {
    try {
        localStorage.setItem('cart', JSON.stringify(items));

        // Dispatch custom event for cross-tab sync
        window.dispatchEvent(new CustomEvent('cartUpdated', {
            detail: { items }
        }));

        return true;
    } catch (error) {
        console.error('Cart save error:', error);
        return false;
    }
}


function updateCartCount() {
    const cartCount = document.getElementById('cartCount');
    if (cartCount) {
        const cart = getCartItems();
        const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
        cartCount.textContent = totalItems;
    }
}

// ====================================
// NOTIFICATION SYSTEM
// ====================================

function showNotification(message, type = 'success') {
    const notification = document.createElement('div');

    const icons = {
        success: '✓',
        error: '✕',
        info: 'ℹ'
    };

    const colors = {
        success: 'var(--gold-gradient-horizontal)',
        error: 'linear-gradient(to right, #ff4444, #cc0000)',
        info: 'linear-gradient(to right, #2196F3, #1976D2)'
    };

    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${colors[type]};
        color: ${type === 'success' ? 'black' : 'white'};
        padding: 15px 25px;
        border-radius: 8px;
        font-weight: 600;
        z-index: 10000;
        animation: slideInRight 0.3s ease, fadeOut 0.3s ease 2.7s;
        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: 350px;
    `;

    notification.innerHTML = `
        <span style="font-size: 20px;">${icons[type] || icons.info}</span>
        <span>${message}</span>
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// ====================================
// ANIMATIONS
// ====================================

// Add CSS for notification animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes fadeOut {
        to {
            opacity: 0;
            transform: translateX(400px);
        }
    }
`;
document.head.appendChild(style);

// ====================================
// CROSS-TAB SYNC
// ====================================
// Note: Mobile menu is handled by main.js (loaded in footer)

// Listen for cart updates from other tabs
window.addEventListener('storage', (e) => {
    if (e.key === 'cart') {
        updateCartCount();
    }
});

// Listen for custom cart updates in the same tab
window.addEventListener('cartUpdated', () => {
    updateCartCount();
});

// ====================================
// INITIALIZE ON PAGE LOAD
// ====================================

document.addEventListener('DOMContentLoaded', () => {
    initProductPage();

});

// ====================================
// PERFORMANCE OPTIMIZATION
// ====================================

// Lazy load images
if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src || img.src;
                img.classList.add('loaded');
                observer.unobserve(img);
            }
        });
    });

    document.querySelectorAll('img[data-src]').forEach(img => {
        imageObserver.observe(img);
    });
}
