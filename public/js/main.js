// Global JavaScript - Used across all pages
// Cart management, notifications, navigation, utilities
//
// TODO: Server-side cart sync for cross-device cart recovery
// Planned feature: Store cart in session/database to enable cart recovery across devices
// Would require: POST /api/cart/sync and GET /api/cart/recover endpoints in cart.controller.js

// Global DOM Elements
const cartCount = document.getElementById("cartCount");

// Cart state
let cartItems = [];
let isAddingToCart = false;

// Cart Storage Configuration
const CART_COOKIE_NAME = 'cart';
const CART_COOKIE_EXPIRY_DAYS = 30; // 30 days expiration
const MAX_COOKIE_SIZE = 4000; // 4KB limit (leave some buffer)

/**
 * Get cart items from cookies (primary) or localStorage (fallback)
 * Uses cookies for server-side sync and cross-device persistence
 */
function getCartItems() {
    try {
        let cartData = null;
        
        // Try to get from cookies first (for server-side sync)
        if (typeof window.CookieUtils !== 'undefined') {
            const cookieData = window.CookieUtils.getCookie(CART_COOKIE_NAME);
            if (cookieData) {
                try {
                    cartData = JSON.parse(cookieData);
                    console.log('[Cart] Loaded from cookies');
                } catch (e) {
                    console.warn('[Cart] Failed to parse cookie data, trying localStorage');
                }
            }
        }
        
        // Fallback to localStorage if cookie not available or empty
        if (!cartData) {
            const localData = localStorage.getItem('cart');
            if (localData) {
                try {
                    cartData = JSON.parse(localData);
                    console.log('[Cart] Loaded from localStorage (fallback)');
                    
                    // Sync to cookie if possible (migrate from localStorage)
                    if (typeof window.CookieUtils !== 'undefined' && cartData) {
                        setCartItems(cartData); // This will save to both
                    }
                } catch (e) {
                    console.error('[Cart] Failed to parse localStorage data');
                }
            }
        }
        
        if (!cartData) {
            return [];
        }
        
        // Validate structure
        if (!Array.isArray(cartData)) {
            console.error('[Cart] Invalid cart data structure');
            clearCartStorage();
            return [];
        }
        
        // Validate each item - updated to handle both old and new cart formats
        const validItems = cartData.filter(item => 
            item && 
            (typeof item.id === 'number' || typeof item.id === 'string') &&
            typeof item.name === 'string' &&
            (typeof item.price === 'string' || typeof item.price === 'number') &&
            typeof item.quantity === 'number' &&
            item.quantity > 0
        );
        
        return validItems;
    } catch (error) {
        console.error('[Cart] Cart parsing error:', error);
        clearCartStorage(); // Clear corrupted data
        return [];
    }
}

/**
 * Set cart items to cookies (primary) and localStorage (fallback)
 * Uses cookies for server-side sync and cross-device persistence
 */
function setCartItems(items) {
    try {
        // Validate items before saving
        if (!Array.isArray(items)) {
            console.error('[Cart] Invalid cart items: must be an array');
            return false;
        }
        
        // Validate each item and normalize price to number
        const validItems = items.filter(item => {
            if (!item) return false;
            if (typeof item.id !== 'number' && typeof item.id !== 'string') return false;
            if (typeof item.name !== 'string') return false;
            if (typeof item.quantity !== 'number' || item.quantity <= 0) return false;
            
            // Normalize price to number (backward compatibility)
            if (typeof item.price === 'string') {
                // Convert string price to number
                item.price = parseFloat(item.price.replace(/[K,]/g, '')) || 0;
            } else if (typeof item.price !== 'number') {
                return false; // Invalid price type
            }
            
            // Ensure displayPrice exists for backward compatibility
            if (!item.displayPrice) {
                item.displayPrice = `K${item.price.toLocaleString()}`;
            }
            
            return true;
        });
        
        const cartJson = JSON.stringify(validItems);
        let savedToCookie = false;
        let savedToLocalStorage = false;
        
        // Try to save to cookie first (for server-side sync)
        if (typeof window.CookieUtils !== 'undefined') {
            // Check cookie size limit
            if (cartJson.length > MAX_COOKIE_SIZE) {
                console.warn('[Cart] Cart too large for cookie, using localStorage only');
                // For large carts, we could split into multiple cookies or compress
                // For now, fall back to localStorage
            } else {
                try {
                    const cookieSuccess = window.CookieUtils.setCookie(
                        CART_COOKIE_NAME,
                        cartJson,
                        CART_COOKIE_EXPIRY_DAYS,
                        {
                            secure: window.location.protocol === 'https:',
                            sameSite: 'Lax'
                        }
                    );
                    
                    if (cookieSuccess) {
                        savedToCookie = true;
                        console.log('[Cart] Saved to cookies');
                    }
                } catch (cookieError) {
                    console.warn('[Cart] Failed to save to cookie:', cookieError);
                }
            }
        }
        
        // Always save to localStorage as fallback
        try {
            localStorage.setItem('cart', cartJson);
            savedToLocalStorage = true;
            console.log('[Cart] Saved to localStorage');
        } catch (localStorageError) {
            console.error('[Cart] Failed to save to localStorage:', localStorageError);
            
            // Check if it's a quota exceeded error
            if (localStorageError.name === 'QuotaExceededError' || localStorageError.code === 22) {
                showNotification('Unable to save cart. Storage may be full. Please clear some space.', 'error');
            } else {
                showNotification('Unable to save cart. Please try again.', 'error');
            }
        }
        
        // If neither worked, return false
        if (!savedToCookie && !savedToLocalStorage) {
            return false;
        }
        
        // Notify other tabs (storage event is only fired in other tabs, not the current one)
        // We'll use a custom event for same-tab updates
        window.dispatchEvent(new CustomEvent('cartUpdated', {
            detail: { items: validItems }
        }));
        
        return true;
    } catch (error) {
        console.error('[Cart] Cart save error:', error);
        showNotification('Unable to save cart. Please try again.', 'error');
        return false;
    }
}

/**
 * Clear cart from both cookies and localStorage
 */
function clearCartStorage() {
    try {
        // Clear cookie
        if (typeof window.CookieUtils !== 'undefined') {
            window.CookieUtils.deleteCookie(CART_COOKIE_NAME);
        }
        
        // Clear localStorage
        localStorage.removeItem('cart');
        
        console.log('[Cart] Cart storage cleared');
    } catch (error) {
        console.error('[Cart] Error clearing cart storage:', error);
    }
}

// TODO: Server-side cart sync for cross-device cart recovery
// Planned feature: Store cart in session/database to enable cart recovery across devices
// Would require: POST /api/cart/sync and GET /api/cart/recover endpoints in cart.controller.js

// Initialize global functionality
function initGlobal() {
    // Load cart items on page load
    cartItems = getCartItems();
    updateCartCount();
    addGradientAnimations();
    setupGlobalEventListeners();
    setupCartSync();
    
    // Initialize session management if available
    if (typeof window.SessionManager !== 'undefined') {
        // Session is already initialized in session.js
        // Just verify it's working
        const sessionInfo = window.SessionManager.getSessionInfo();
        if (sessionInfo.sessionId) {
            console.log('[Main] Session management active');
        }
    }
}

// Add gradient animations to elements
function addGradientAnimations() {
    const gradientElements = document.querySelectorAll('.gradient-flow');
    gradientElements.forEach(el => {
        el.style.animation = 'gradientFlow 3s ease infinite';
    });
}

// Cart Functions
// Add item to cart with server-side validation
// Calls /api/cart/add to get authoritative price and stock validation
async function addToCart(productName, price, productId = null) {
    // Prevent race conditions from rapid clicks
    if (isAddingToCart) {
        showNotification('Please wait, adding item to cart...');
        return;
    }
    
    // Validate productId is provided
    if (!productId) {
        showNotification('Product ID is required', 'error');
        return;
    }
    
    isAddingToCart = true;
    setAddToCartButtonsEnabled(false);
    
    try {
        // Get CSRF token if available
        const csrfToken = typeof getCSRFToken === 'function' ? getCSRFToken() : (typeof window.getCSRFToken === 'function' ? window.getCSRFToken() : '');
        
        // Call server to validate stock and get authoritative price
        const response = await fetch('/api/cart/add', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(csrfToken && { 'X-CSRF-Token': csrfToken })
            },
            body: JSON.stringify({
                productId: productId,
                quantity: 1
            })
        });
        
        const data = await response.json();
        
        if (!response.ok || !data.success) {
            showNotification(data.message || 'Failed to add item to cart', 'error');
            return;
        }
        
        // Get server-validated cart item with authoritative price
        const cartItem = data.cartItem;
        
        if (!cartItem) {
            showNotification('Invalid response from server', 'error');
            return;
        }
        
        // Get existing cart
        let cart = getCartItems();
        
        // Check if item already exists (same product ID)
        const existingIndex = cart.findIndex(item => {
            const itemProductId = item.productId || item.id;
            const cartProductId = cartItem.productId || cartItem.id;
            return itemProductId === cartProductId;
        });
        
        if (existingIndex > -1) {
            // Check if total quantity exceeds stock
            const newTotalQuantity = cart[existingIndex].quantity + cartItem.quantity;
            if (cartItem.stock && newTotalQuantity > cartItem.stock) {
                showNotification(`Only ${cartItem.stock} item${cartItem.stock !== 1 ? 's' : ''} available. You already have ${cart[existingIndex].quantity} in cart.`, 'error');
                return;
            }
            // Update quantity
            cart[existingIndex].quantity = newTotalQuantity;
            // Update price to server-validated price (in case it changed)
            cart[existingIndex].price = cartItem.price;
            if (cartItem.originalPrice) cart[existingIndex].originalPrice = cartItem.originalPrice;
            if (cartItem.discount !== undefined) cart[existingIndex].discount = cartItem.discount;
        } else {
            // Add new item with server-validated data
            // Format display price
            const displayPrice = `K${cartItem.price.toLocaleString()}`;
            cart.push({
                ...cartItem,
                displayPrice: displayPrice,
                variant: cartItem.variant || { color: null, strap: null }
            });
        }
        
        // Save to storage
        if (setCartItems(cart)) {
            // Reload cartItems to get validated version
            cartItems = getCartItems();
            updateCartCount();
            showNotification(`${cartItem.name || productName} added to cart!`, 'success');
        } else {
            showNotification('Failed to save item to cart. Please try again.', 'error');
        }
    } catch (error) {
        console.error('[Main] Add to cart error:', error);
        showNotification('An error occurred. Please try again.', 'error');
    } finally {
        // Always reset the flag and re-enable buttons, even if an error occurred
        isAddingToCart = false;
        setAddToCartButtonsEnabled(true);
    }
}

// Make addToCart available globally
window.addToCart = addToCart;

function updateCartCount() {
    if (!cartCount) return; // Element doesn't exist on this page
    
    // Calculate total items (sum of quantities)
    const totalItems = cartItems.reduce((sum, item) => sum + (item.quantity || 1), 0);
    cartCount.textContent = totalItems;
}

// Helper function to toggle add-to-cart buttons
function setAddToCartButtonsEnabled(enabled) {
    const buttons = document.querySelectorAll('.add-to-cart-btn, .btn.gradient-flow');
    buttons.forEach(btn => {
        if (btn.textContent.includes('Add to Cart') || btn.textContent.includes('Cart')) {
            btn.disabled = !enabled;
            btn.style.opacity = enabled ? '1' : '0.6';
            btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
        }
    });
}

// Navigation
function goToShop() {
    window.location.href = "/shop";
}

function toggleMenu() {
    const nav = document.getElementById("mainNav");
    if (nav) {
        nav.classList.toggle("active");
    }
}

// Newsletter Subscription
function subscribeNewsletter(event) {
    event.preventDefault();
    const email = event.target.querySelector('.newsletter-input').value;

    // In a real app, you would send this to your backend
    console.log('Subscribing email:', email);

    // Show success message
    showNotification('Thank you for subscribing! Check your email for confirmation.');
    event.target.reset();
}

// Make subscribeNewsletter available globally
window.subscribeNewsletter = subscribeNewsletter;

// Notification System
// Global notification function used across all pages
// Supports: 'success', 'error', 'warning', 'info'
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    
    // Set background and text color based on type
    let background, textColor, boxShadow;
    if (type === 'error') {
        background = '#dc3545';
        textColor = 'white';
        boxShadow = '0 5px 15px rgba(220, 53, 69, 0.3)';
    } else if (type === 'warning') {
        background = '#ffc107';
        textColor = 'black';
        boxShadow = '0 5px 15px rgba(255, 193, 7, 0.3)';
    } else if (type === 'info') {
        background = '#17a2b8';
        textColor = 'white';
        boxShadow = '0 5px 15px rgba(23, 162, 184, 0.3)';
    } else {
        // success (default)
        background = 'var(--gold-gradient-horizontal)';
        textColor = 'black';
        boxShadow = '0 5px 15px rgba(255, 238, 193, 0.3)';
    }
    
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${background};
        color: ${textColor};
        padding: 15px 25px;
        border-radius: 5px;
        font-weight: 600;
        z-index: 10000;
        animation: fadeInUp 0.3s ease;
        box-shadow: ${boxShadow};
        max-width: 400px;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    // Error messages stay longer (5s), others stay for 3s
    setTimeout(() => {
        notification.style.animation = 'fadeOutDown 0.3s ease';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, type === 'error' ? 5000 : 3000);
}

// Make showNotification available globally
window.showNotification = showNotification;

// Setup global event listeners
function setupGlobalEventListeners() {
    // Mobile menu button
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', toggleMenu);
    }
}

// Setup cross-tab cart synchronization
// Consolidates storage and custom event listeners to prevent duplicate handlers
function setupCartSync() {
    // Listen for changes from other tabs (cross-tab sync via localStorage)
    window.addEventListener('storage', (e) => {
        if (e.key === 'cart') {
            cartItems = getCartItems();
            updateCartCount();
        }
    });
    
    // Listen for custom cart updates in the same tab
    window.addEventListener('cartUpdated', (e) => {
        if (e.detail && e.detail.items) {
            cartItems = e.detail.items;
            updateCartCount();
        } else {
            // If no detail, reload from storage
            cartItems = getCartItems();
            updateCartCount();
        }
    });
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', initGlobal);
