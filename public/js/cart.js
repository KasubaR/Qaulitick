// Cart Page JavaScript
document.addEventListener('DOMContentLoaded', function () {
    initializeCartPage();
});

// Cart state (use different variable name to avoid conflict with main.js)
let cartPageItems = [];
const SHIPPING_THRESHOLD = 500;
const SHIPPING_FEE = 50;

// Initialize cart page
function initializeCartPage() {
    // Check if cart items were server-rendered (SSR)
    const serverRenderedItems = getServerRenderedCartItems();
    
    if (serverRenderedItems && serverRenderedItems.length > 0) {
        // Use server-rendered items (SSR) - no need to reload from cookies
        cartPageItems = serverRenderedItems;
        // Sync server-corrected prices back to cookie/localStorage so future
        // requests don't trigger stale-price mismatch warnings.
        if (typeof window.setCartItems === 'function') {
            window.setCartItems(serverRenderedItems);
        }
    } else {
        // No server-rendered items, load from cookies/localStorage (client-side only)
        loadCartItems();
    }
    
    setupEventListeners();
    renderCart(); // Re-render to ensure consistency (handles any client-side updates)
    updateOrderSummary();
    updateSaveRestoreUI(); // Check for saved cart and show restore button if available
}

// Extract server-rendered cart items from DOM
// This allows client-side JS to take over for dynamic updates
function getServerRenderedCartItems() {
    try {
        const cartItemsBody = document.getElementById('cartItemsBody');
        if (!cartItemsBody) return null;
        
        const rows = cartItemsBody.querySelectorAll('tr.cart-item-row');
        if (rows.length === 0) return null;
        
        const items = [];
        rows.forEach(row => {
            const itemId = row.dataset.itemId;
            if (!itemId) return;
            
            // Extract data from DOM
            const productCol = row.querySelector('.product-col');
            const nameLink = productCol?.querySelector('.cart-product-name');
            const name = nameLink?.textContent?.trim() || '';
            const productId = nameLink?.href?.match(/\/product\/([^\/]+)/)?.[1] || itemId;
            const image = productCol?.querySelector('.cart-product-image')?.src || '';
            
            // Extract variant info
            const variantSpans = productCol?.querySelectorAll('.cart-product-variants span');
            let variant = { color: null, strap: null };
            variantSpans?.forEach(span => {
                const text = span.textContent?.trim() || '';
                if (text.startsWith('Color:')) {
                    variant.color = text.replace('Color:', '').trim();
                } else if (text.startsWith('Strap:')) {
                    variant.strap = text.replace('Strap:', '').trim();
                }
            });
            
            // Extract price
            const priceCol = row.querySelector('.price-col');
            const currentPriceSpan = priceCol?.querySelector('.current-price');
            const priceText = currentPriceSpan?.textContent?.replace(/[K,]/g, '') || '0';
            const price = parseFloat(priceText) || 0;
            
            const originalPriceSpan = priceCol?.querySelector('.original-price');
            const originalPrice = originalPriceSpan ? parseFloat(originalPriceSpan.textContent.replace(/[K,]/g, '')) : price;
            
            const discountBadge = priceCol?.querySelector('.discount-badge');
            const discount = discountBadge ? parseFloat(discountBadge.textContent.replace(/[^0-9]/g, '')) : 0;
            
            // Extract quantity
            const quantityInput = row.querySelector('.quantity-input');
            const quantity = parseInt(quantityInput?.value) || 1;
            
            // Extract subtotal (for validation)
            const subtotalCol = row.querySelector('.subtotal-col');
            const subtotalText = subtotalCol?.querySelector('.subtotal-amount')?.textContent?.replace(/[K,]/g, '') || '0';
            const subtotal = parseFloat(subtotalText) || 0;
            
            items.push({
                id: itemId,
                productId: productId,
                name: name,
                price: price,
                originalPrice: originalPrice,
                discount: discount,
                quantity: quantity,
                image: image,
                variant: variant,
                displayPrice: `K${price.toLocaleString()}`
            });
        });
        
        return items.length > 0 ? items : null;
    } catch (error) {
        console.error('[Cart Page] Error extracting server-rendered items:', error);
        return null;
    }
}

// Load cart items from cookies (primary) or localStorage (fallback)
// Uses the same logic as main.js for consistency
function loadCartItems() {
    try {
        let cartData = null;
        
        // Try to get from cookies first (for server-side sync)
        if (typeof window.CookieUtils !== 'undefined') {
            const cookieData = window.CookieUtils.getCookie('cart');
            if (cookieData) {
                try {
                    cartData = JSON.parse(cookieData);
                } catch (e) {
                    console.warn('[Cart Page] Failed to parse cookie data, trying localStorage');
                }
            }
        }
        
        // Fallback to localStorage if cookie not available or empty
        if (!cartData) {
            const localData = localStorage.getItem('cart');
            if (localData) {
                try {
                    cartData = JSON.parse(localData);
                } catch (e) {
                    console.error('[Cart Page] Failed to parse localStorage data');
                }
            }
        }
        
        if (!cartData) {
            cartPageItems = [];
            return;
        }
        
        // Validate and enhance cart items
        cartPageItems = cartData.map(item => {
            // ✅ Normalize price to number (backward compatibility)
            let price = item.price;
            if (typeof price === 'string') {
                price = parseFloat(price.replace(/[K,]/g, '')) || 0;
            } else if (typeof price !== 'number') {
                price = 0;
            }
            
            // ✅ Ensure displayPrice exists
            const displayPrice = item.displayPrice || `K${price.toLocaleString()}`;
            
            // ✅ Normalize variant structure (backward compatibility)
            let variant = item.variant;
            if (!variant && (item.color || item.strap)) {
                // Convert old format (color/strap at top level) to new format (variant object)
                variant = {
                    color: item.color || null,
                    strap: item.strap || null
                };
            }
            variant = variant || { color: null, strap: null };
            
            return {
                id: item.id,
                name: item.name,
                price: price, // ✅ Always store as NUMBER
                displayPrice: displayPrice, // ✅ Formatted display string
                quantity: item.quantity || 1,
                timestamp: item.timestamp,
                productId: item.productId || item.id, // Fallback to id if productId missing
                variant: variant,
                discount: item.discount || 0,
                image: item.image || '/images/placeholder.jpg'
            };
        });
    } catch (error) {
        console.error('[Cart Page] Error loading cart:', error);
        cartPageItems = [];
    }
}

// Save cart items to cookies (primary) and localStorage (fallback)
// Uses the same logic as main.js for consistency
function saveCartItems() {
    try {
        const cartJson = JSON.stringify(cartPageItems);
        let savedToCookie = false;
        let savedToLocalStorage = false;
        const MAX_COOKIE_SIZE = 4000; // 4KB limit
        
        // Try to save to cookie first (for server-side sync)
        if (typeof window.CookieUtils !== 'undefined') {
            // Check cookie size limit
            if (cartJson.length > MAX_COOKIE_SIZE) {
                console.warn('[Cart Page] Cart too large for cookie, using localStorage only');
            } else {
                try {
                    const cookieSuccess = window.CookieUtils.setCookie(
                        'cart',
                        cartJson,
                        30, // 30 days expiration
                        {
                            secure: window.location.protocol === 'https:',
                            sameSite: 'Lax'
                        }
                    );
                    
                    if (cookieSuccess) {
                        savedToCookie = true;
                    }
                } catch (cookieError) {
                    console.warn('[Cart Page] Failed to save to cookie:', cookieError);
                }
            }
        }
        
        // Always save to localStorage as fallback
        try {
            localStorage.setItem('cart', cartJson);
            savedToLocalStorage = true;
        } catch (localStorageError) {
            console.error('[Cart Page] Failed to save to localStorage:', localStorageError);
            
            // Check if it's a quota exceeded error
            if (localStorageError.name === 'QuotaExceededError' || localStorageError.code === 22) {
                showNotification('Unable to save cart. Storage may be full. Please clear some space.', 'error');
            } else {
                showNotification('Failed to save cart. Please try again.', 'error');
            }
        }
        
        // If neither worked, return false
        if (!savedToCookie && !savedToLocalStorage) {
            return false;
        }
        
        // Dispatch event for cross-tab sync
        window.dispatchEvent(new CustomEvent('cartUpdated', {
            detail: { items: cartPageItems }
        }));
        
        // Update cart count in header
        const cartCount = document.getElementById('cartCount');
        if (cartCount) {
            const totalItems = cartPageItems.reduce((sum, item) => sum + item.quantity, 0);
            cartCount.textContent = totalItems;
        }
        
        return true;
    } catch (error) {
        console.error('[Cart Page] Error saving cart:', error);
        showNotification('Failed to save cart. Please try again.', 'error');
        return false;
    }
}

// Setup event listeners
function setupEventListeners() {
    // Cart actions
    const clearCartBtn = document.getElementById('clearCartBtn');
    if (clearCartBtn) {
        clearCartBtn.addEventListener('click', showClearCartModal);
    }
    
    const saveCartBtn = document.getElementById('saveCartBtn');
    if (saveCartBtn) {
        saveCartBtn.addEventListener('click', saveCartForLater);
    }
    
    const restoreCartBtn = document.getElementById('restoreCartBtn');
    if (restoreCartBtn) {
        restoreCartBtn.addEventListener('click', restoreSavedCart);
    }
    
    // Checkout buttons
    const checkoutBtn = document.getElementById('checkoutBtn');
    const checkoutBtnMobile = document.getElementById('checkoutBtnMobile');
    
    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', proceedToCheckout);
    }
    
    if (checkoutBtnMobile) {
        checkoutBtnMobile.addEventListener('click', proceedToCheckout);
    }
    
    // Modal handlers
    setupModalHandlers();
    
    // Event delegation for cart item actions (CSP-compliant, no inline handlers)
    setupCartItemEventDelegation();
    
    // Listen for cart updates from other tabs
    window.addEventListener('storage', (e) => {
        if (e.key === 'cart') {
            loadCartItems();
            renderCart();
            updateOrderSummary();
        }
    });
    
    window.addEventListener('cartUpdated', () => {
        loadCartItems();
        renderCart();
        updateOrderSummary();
    });
}

// Setup event delegation for cart item actions
// Uses data-action and data-item-id attributes instead of inline onclick handlers
// This is CSP-compliant and more reliable than index-based handlers
function setupCartItemEventDelegation() {
    const cartItemsBody = document.getElementById('cartItemsBody');
    if (!cartItemsBody) return;
    
    // Single event listener on table body for all cart item actions
    cartItemsBody.addEventListener('click', (e) => {
        const actionElement = e.target.closest('[data-action]');
        if (!actionElement) return;
        
        const action = actionElement.getAttribute('data-action');
        const itemId = actionElement.getAttribute('data-item-id');
        
        if (!itemId) {
            console.warn('[Cart] Action element missing data-item-id:', actionElement);
            return;
        }
        
        // Find item by ID (more reliable than index)
        const itemIndex = cartPageItems.findIndex(item => {
            const id = item.id || item.productId;
            return id && id.toString() === itemId.toString();
        });
        
        if (itemIndex === -1) {
            console.warn('[Cart] Item not found for ID:', itemId);
            return;
        }
        
        // Route to appropriate handler
        switch (action) {
            case 'increase':
                e.preventDefault();
                increaseQuantity(itemIndex);
                break;
            case 'decrease':
                e.preventDefault();
                decreaseQuantity(itemIndex);
                break;
            case 'remove':
                e.preventDefault();
                removeItem(itemIndex);
                break;
            default:
                console.warn('[Cart] Unknown action:', action);
        }
    });
    
    // Handle quantity input changes
    cartItemsBody.addEventListener('change', (e) => {
        if (e.target.classList.contains('quantity-input')) {
            const actionElement = e.target;
            const action = actionElement.getAttribute('data-action');
            const itemId = actionElement.getAttribute('data-item-id');
            
            if (action !== 'update' || !itemId) return;
            
            // Find item by ID
            const itemIndex = cartPageItems.findIndex(item => {
                const id = item.id || item.productId;
                return id && id.toString() === itemId.toString();
            });
            
            if (itemIndex === -1) {
                console.warn('[Cart] Item not found for ID:', itemId);
                return;
            }
            
            const newQuantity = parseInt(e.target.value);
            updateQuantity(itemIndex, newQuantity);
        }
    });
}

// Setup modal handlers
function setupModalHandlers() {
    // Clear cart modal
    const clearCartModal = document.getElementById('clearCartModal');
    const closeClearCartModal = document.getElementById('closeClearCartModal');
    const cancelClearCartBtn = document.getElementById('cancelClearCartBtn');
    const confirmClearCartBtn = document.getElementById('confirmClearCartBtn');
    
    if (closeClearCartModal) {
        closeClearCartModal.addEventListener('click', () => {
            clearCartModal.style.display = 'none';
        });
    }
    
    if (cancelClearCartBtn) {
        cancelClearCartBtn.addEventListener('click', () => {
            clearCartModal.style.display = 'none';
        });
    }
    
    if (confirmClearCartBtn) {
        confirmClearCartBtn.addEventListener('click', clearCart);
    }
    
    // Close modal on outside click
    if (clearCartModal) {
        clearCartModal.addEventListener('click', (e) => {
            if (e.target === clearCartModal) {
                clearCartModal.style.display = 'none';
            }
        });
    }
}

// Render cart items
function renderCart() {
    const emptyCart = document.getElementById('emptyCart');
    const cartItemsContainer = document.getElementById('cartItemsContainer');
    const cartItemsBody = document.getElementById('cartItemsBody');
    const cartItemCount = document.getElementById('cartItemCount');
    
    if (!cartItemsBody) return;
    
    if (cartPageItems.length === 0) {
        emptyCart.style.display = 'block';
        cartItemsContainer.style.display = 'none';
        if (cartItemCount) {
            cartItemCount.textContent = '0 items';
        }
        return;
    }
    
    emptyCart.style.display = 'none';
    cartItemsContainer.style.display = 'block';
    
    // Update item count
    const totalItems = cartPageItems.reduce((sum, item) => sum + item.quantity, 0);
    if (cartItemCount) {
        cartItemCount.textContent = `${totalItems} ${totalItems === 1 ? 'item' : 'items'}`;
    }
    
    // Check if items are already rendered (from SSR)
    // Only re-render if the number of items changed or if we need to update
    const existingRows = cartItemsBody.querySelectorAll('tr.cart-item-row');
    const needsRerender = existingRows.length !== cartPageItems.length || 
                         Array.from(existingRows).some((row, index) => {
                             const itemId = row.dataset.itemId;
                             const item = cartPageItems[index];
                             return !item || (item.id !== itemId && item.productId !== itemId);
                         });
    
    if (needsRerender) {
        // Clear existing items and re-render
        cartItemsBody.innerHTML = '';
        
        // Render each cart item
        cartPageItems.forEach((item, index) => {
            const row = createCartItemRow(item, index);
            cartItemsBody.appendChild(row);
        });
    } else {
        // Update existing rows (e.g., quantity, price changes)
        cartPageItems.forEach((item, index) => {
            const row = existingRows[index];
            if (!row) return;
            
            // Update quantity input
            const quantityInput = row.querySelector('.quantity-input');
            if (quantityInput) {
                quantityInput.value = item.quantity;
            }
            
            // Update price display if changed
            const currentPriceSpan = row.querySelector('.current-price');
            if (currentPriceSpan) {
                currentPriceSpan.textContent = `K${item.price.toLocaleString()}`;
            }
            
            // Update subtotal
            const subtotalSpan = row.querySelector('.subtotal-amount');
            if (subtotalSpan) {
                const subtotal = item.price * item.quantity;
                subtotalSpan.textContent = `K${subtotal.toLocaleString()}`;
            }
        });
    }
}

// Create cart item row
function createCartItemRow(item, index) {
    const row = document.createElement('tr');
    row.className = 'cart-item-row';
    row.dataset.itemId = item.id;
    
    // ✅ Normalize price to number (handle both string and number for backward compatibility)
    // Note: item.price is already the final discounted price from server
    let finalPrice;
    if (typeof item.price === 'number') {
        finalPrice = item.price;
    } else if (typeof item.price === 'string') {
        // Backward compatibility: parse string price
        finalPrice = parseFloat(String(item.price).replace(/[K,]/g, '')) || 0;
    } else {
        finalPrice = 0;
    }
    
    // Get original price for display (if discount exists)
    let originalPrice = item.originalPrice || finalPrice;
    if (typeof originalPrice === 'string') {
        originalPrice = parseFloat(String(originalPrice).replace(/[K,]/g, '')) || finalPrice;
    }
    
    const subtotal = finalPrice * item.quantity;
    
    row.innerHTML = `
        <td class="product-col" data-label="Product">
            <div class="cart-product">
                <img src="${item.image}" alt="${item.name}" class="cart-product-image">
                <div class="cart-product-info">
                    <a href="/product/${item.productId || item.id}" class="cart-product-name">${escapeHtml(item.name)}</a>
                    ${item.variant && (item.variant.color || item.variant.strap) ? `
                        <div class="cart-product-variants">
                            ${item.variant.color ? `<span>Color: ${escapeHtml(item.variant.color)}</span>` : ''}
                            ${item.variant.strap ? `<span>Strap: ${escapeHtml(item.variant.strap)}</span>` : ''}
                        </div>
                    ` : ''}
                </div>
            </div>
        </td>
        <td class="variant-col" data-label="Variants">
            <div class="variant-display">
                ${item.variant && item.variant.color ? `
                    <div class="color-swatch" style="background-color: ${getColorHex(item.variant.color)}"></div>
                ` : ''}
            </div>
        </td>
        <td class="price-col" data-label="Price">
            <div class="price-display">
                ${item.discount > 0 && originalPrice > finalPrice ? `
                    <span class="original-price">K${originalPrice.toLocaleString()}</span>
                    <span class="discount-badge">-${item.discount}%</span>
                ` : ''}
                <span class="current-price">K${finalPrice.toLocaleString()}</span>
            </div>
        </td>
        <td class="quantity-col" data-label="Quantity">
            <div class="quantity-controls">
                <button class="quantity-btn" data-action="decrease" data-item-id="${item.id || item.productId}" aria-label="Decrease quantity">
                    <i class="fas fa-minus"></i>
                </button>
                <input 
                    type="number" 
                    class="quantity-input" 
                    data-action="update"
                    data-item-id="${item.id || item.productId}"
                    value="${item.quantity}" 
                    min="1" 
                    max="99"
                >
                <button class="quantity-btn" data-action="increase" data-item-id="${item.id || item.productId}" aria-label="Increase quantity">
                    <i class="fas fa-plus"></i>
                </button>
            </div>
        </td>
        <td class="subtotal-col" data-label="Subtotal">
            <span class="subtotal-amount">K${subtotal.toLocaleString()}</span>
        </td>
        <td class="action-col" data-label="Actions">
            <div class="cart-item-actions">
                <button class="action-btn remove-btn" data-action="remove" data-item-id="${item.id || item.productId}" title="Remove Item">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </td>
    `;
    
    return row;
}

// Update quantity
async function updateQuantity(index, newQuantity) {
    const item = cartPageItems[index];
    if (!item) return;
    
    const quantity = parseInt(newQuantity);
    if (isNaN(quantity) || quantity < 1) {
        showNotification('Quantity must be at least 1', 'error');
        renderCart();
        return;
    }
    
    if (quantity > 99) {
        showNotification('Maximum quantity is 99', 'error');
        renderCart();
        return;
    }
    
    // If quantity unchanged, no need to update
    if (quantity === item.quantity) {
        return;
    }
    
    const previousQuantity = item.quantity;
    
    // Optimistically update UI (will revert if validation fails)
    item.quantity = quantity;
    renderCart();
    updateOrderSummary();
    
    // Validate with server
    try {
        const productId = item.productId || item.id;
        if (!productId) {
            throw new Error('Product ID is missing');
        }
        
        // Get CSRF token
        const csrfToken = typeof getCSRFToken === 'function' ? getCSRFToken() : (typeof window.getCSRFToken === 'function' ? window.getCSRFToken() : '');
        
        const response = await fetch('/api/cart/update', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({
                productId: productId,
                quantity: quantity
            })
        });
        
        const data = await response.json();
        
        if (!response.ok || !data.success) {
            // Revert to previous quantity
            item.quantity = previousQuantity;
            renderCart();
            updateOrderSummary();
            showNotification(data.message || 'Failed to update quantity', 'error');
            return;
        }
        
        // Update stock info if provided
        if (data.availableStock !== undefined) {
            item.stock = data.availableStock;
        }
        
        // Save validated cart
        saveCartItems();
        showNotification('Cart updated', 'success');
    } catch (error) {
        console.error('Error updating quantity:', error);
        // Revert to previous quantity
        item.quantity = previousQuantity;
        renderCart();
        updateOrderSummary();
        showNotification('Failed to update quantity. Please try again.', 'error');
    }
}

// Increase quantity (with server-side stock validation)
async function increaseQuantity(index) {
    const item = cartPageItems[index];
    if (!item) return;
    
    // Client-side max check
    if (item.quantity >= 99) {
        showNotification('Maximum quantity is 99', 'error');
        return;
    }
    
    const newQuantity = item.quantity + 1;
    const previousQuantity = item.quantity;
    
    // Optimistically update UI (will revert if validation fails)
    item.quantity = newQuantity;
    renderCart();
    updateOrderSummary();
    
    // Validate with server
    try {
        const productId = item.productId || item.id;
        if (!productId) {
            throw new Error('Product ID is missing');
        }
        
        // Get CSRF token
        const csrfToken = typeof getCSRFToken === 'function' ? getCSRFToken() : (typeof window.getCSRFToken === 'function' ? window.getCSRFToken() : '');
        
        const response = await fetch('/api/cart/update', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({
                productId: productId,
                quantity: newQuantity
            })
        });
        
        const data = await response.json();
        
        if (!response.ok || !data.success) {
            // Revert to previous quantity
            item.quantity = previousQuantity;
            renderCart();
            updateOrderSummary();
            showNotification(data.message || 'Failed to update quantity', 'error');
            return;
        }
        
        // Update stock info if provided
        if (data.availableStock !== undefined) {
            item.stock = data.availableStock;
        }
        
        // Save validated cart
        saveCartItems();
        showNotification('Quantity updated', 'success');
    } catch (error) {
        console.error('Error updating quantity:', error);
        // Revert to previous quantity
        item.quantity = previousQuantity;
        renderCart();
        updateOrderSummary();
        showNotification('Failed to update quantity. Please try again.', 'error');
    }
}

// Decrease quantity (with server-side stock validation)
async function decreaseQuantity(index) {
    const item = cartPageItems[index];
    if (!item) return;
    
    // If quantity is 1, remove item instead
    if (item.quantity <= 1) {
        removeItem(index);
        return;
    }
    
    const newQuantity = item.quantity - 1;
    const previousQuantity = item.quantity;
    
    // Optimistically update UI (will revert if validation fails)
    item.quantity = newQuantity;
    renderCart();
    updateOrderSummary();
    
    // Validate with server
    try {
        const productId = item.productId || item.id;
        if (!productId) {
            throw new Error('Product ID is missing');
        }
        
        // Get CSRF token
        const csrfToken = typeof getCSRFToken === 'function' ? getCSRFToken() : (typeof window.getCSRFToken === 'function' ? window.getCSRFToken() : '');
        
        const response = await fetch('/api/cart/update', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({
                productId: productId,
                quantity: newQuantity
            })
        });
        
        const data = await response.json();
        
        if (!response.ok || !data.success) {
            // Revert to previous quantity
            item.quantity = previousQuantity;
            renderCart();
            updateOrderSummary();
            showNotification(data.message || 'Failed to update quantity', 'error');
            return;
        }
        
        // Update stock info if provided
        if (data.availableStock !== undefined) {
            item.stock = data.availableStock;
        }
        
        // Save validated cart
        saveCartItems();
    } catch (error) {
        console.error('Error updating quantity:', error);
        // Revert to previous quantity
        item.quantity = previousQuantity;
        renderCart();
        updateOrderSummary();
        showNotification('Failed to update quantity. Please try again.', 'error');
    }
}

// Remove item
function removeItem(index) {
    cartPageItems.splice(index, 1);
    saveCartItems();
    renderCart();
    updateOrderSummary();
    showNotification('Item removed from cart', 'success');
}


// Update order summary
function updateOrderSummary() {
    // Calculate subtotal
    let subtotal = 0;
    cartPageItems.forEach(item => {
        // ✅ Normalize price to number (item.price is already the final discounted price from server)
        let finalPrice;
        if (typeof item.price === 'number') {
            finalPrice = item.price;
        } else if (typeof item.price === 'string') {
            // Backward compatibility: parse string price
            finalPrice = parseFloat(String(item.price).replace(/[K,]/g, '')) || 0;
        } else {
            finalPrice = 0;
        }
        
        // Use finalPrice directly (discount already applied by server)
        subtotal += finalPrice * item.quantity;
    });
    
    // Calculate shipping from per-product shipping prices (once per unique product)
    const seenIds = new Set();
    let shipping = 0;
    cartPageItems.forEach(item => {
        const pid = item.productId || item.id;
        if (!seenIds.has(pid)) {
            seenIds.add(pid);
            shipping += parseFloat(item.shippingPrice) || 0;
        }
    });

    // Calculate total (no tax)
    const total = subtotal + shipping;
    
    // Update DOM
    const subtotalEl = document.getElementById('subtotal');
    const shippingFee = document.getElementById('shippingFee');
    const taxRow = document.getElementById('taxRow');
    const totalAmount = document.getElementById('totalAmount');
    const mobileTotal = document.getElementById('mobileTotal');
    const checkoutBtn = document.getElementById('checkoutBtn');
    const checkoutBtnMobile = document.getElementById('checkoutBtnMobile');
    
    if (subtotalEl) {
        subtotalEl.textContent = `K${subtotal.toLocaleString()}`;
    }
    
    if (shippingFee) {
        if (shipping > 0) {
            shippingFee.textContent = `K${shipping.toLocaleString()}`;
        } else {
            shippingFee.textContent = 'Free';
            shippingFee.style.color = '#28a745';
        }
    }
    
    // Hide tax row
    if (taxRow) {
        taxRow.style.display = 'none';
    }
    
    if (totalAmount) {
        totalAmount.innerHTML = `<strong>K${total.toLocaleString()}</strong>`;
    }
    
    if (mobileTotal) {
        mobileTotal.textContent = `K${total.toLocaleString()}`;
    }
    
    // Enable/disable checkout buttons
    const canCheckout = cartPageItems.length > 0;
    if (checkoutBtn) {
        checkoutBtn.disabled = !canCheckout;
    }
    if (checkoutBtnMobile) {
        checkoutBtnMobile.disabled = !canCheckout;
    }
}

// Clear cart
function clearCart() {
    cartPageItems = [];
    
    // Explicitly clear both cookie and localStorage
    try {
        // Clear cookie
        if (typeof window.CookieUtils !== 'undefined') {
            window.CookieUtils.deleteCookie('cart');
        }
        
        // Clear localStorage
        localStorage.removeItem('cart');
    } catch (error) {
        console.error('[Cart] Error clearing cart storage:', error);
    }
    
    // Dispatch cart updated event with empty array
    // This will notify all pages listening for cart updates
    window.dispatchEvent(new CustomEvent('cartUpdated', {
        detail: { items: [] }
    }));
    
    // Update cart count in header immediately
    const cartCount = document.getElementById('cartCount');
    if (cartCount) {
        cartCount.textContent = '0';
    }
    
    // Update UI
    renderCart();
    updateOrderSummary();
    
    const clearCartModal = document.getElementById('clearCartModal');
    if (clearCartModal) {
        clearCartModal.style.display = 'none';
    }
    
    showNotification('Cart cleared', 'success');
}

// Show clear cart modal
function showClearCartModal() {
    const clearCartModal = document.getElementById('clearCartModal');
    if (clearCartModal) {
        clearCartModal.style.display = 'flex';
    }
}

// Save cart for later
function saveCartForLater() {
    try {
        if (cartPageItems.length === 0) {
            showNotification('Your cart is empty. Nothing to save.', 'warning');
            return;
        }
        
        localStorage.setItem('savedCart', JSON.stringify(cartPageItems));
        showNotification('Cart saved for later', 'success');
        updateSaveRestoreUI(); // Update UI to show restore button
    } catch (error) {
        console.error('Error saving cart:', error);
        showNotification('Failed to save cart', 'error');
    }
}

// Restore saved cart
function restoreSavedCart() {
    try {
        const savedCartData = localStorage.getItem('savedCart');
        if (!savedCartData) {
            showNotification('No saved cart found', 'warning');
            updateSaveRestoreUI();
            return;
        }
        
        const savedItems = JSON.parse(savedCartData);
        if (!Array.isArray(savedItems) || savedItems.length === 0) {
            showNotification('Saved cart is empty', 'warning');
            localStorage.removeItem('savedCart');
            updateSaveRestoreUI();
            return;
        }
        
        // Merge saved items into current cart (avoid duplicates)
        const existingProductIds = new Set(cartPageItems.map(item => item.productId || item.id));
        let itemsAdded = 0;
        let itemsSkipped = 0;
        
        savedItems.forEach(savedItem => {
            const productId = savedItem.productId || savedItem.id;
            if (!productId) return;
            
            // Check if item already exists in cart (same product ID and variant)
            const existingIndex = cartPageItems.findIndex(item => {
                const itemProductId = item.productId || item.id;
                if (itemProductId !== productId) return false;
                
                // Check variant match
                const savedVariant = savedItem.variant || { color: savedItem.color, strap: savedItem.strap };
                const existingVariant = item.variant || { color: item.color, strap: item.strap };
                
                return (savedVariant.color === existingVariant.color) && 
                       (savedVariant.strap === existingVariant.strap);
            });
            
            if (existingIndex > -1) {
                // Item exists, update quantity (add saved quantity to existing)
                cartPageItems[existingIndex].quantity += (savedItem.quantity || 1);
                itemsSkipped++;
            } else {
                // New item, add to cart
                cartPageItems.push(savedItem);
                itemsAdded++;
            }
        });
        
        // Save merged cart
        saveCartItems();
        renderCart();
        updateOrderSummary();
        
        // Clear saved cart after successful restore
        localStorage.removeItem('savedCart');
        updateSaveRestoreUI();
        
        // Show success message
        if (itemsAdded > 0 && itemsSkipped > 0) {
            showNotification(`Restored ${itemsAdded} item(s) from saved cart. ${itemsSkipped} item(s) were already in your cart and quantities were updated.`, 'success');
        } else if (itemsAdded > 0) {
            showNotification(`Restored ${itemsAdded} item(s) from saved cart`, 'success');
        } else if (itemsSkipped > 0) {
            showNotification(`All saved items were already in your cart. Quantities have been updated.`, 'info');
        }
    } catch (error) {
        console.error('Error restoring saved cart:', error);
        showNotification('Failed to restore saved cart', 'error');
    }
}

// Update save/restore UI based on cart state
function updateSaveRestoreUI() {
    const saveCartBtn = document.getElementById('saveCartBtn');
    const restoreCartBtn = document.getElementById('restoreCartBtn');
    
    // Show/hide save button based on cart contents
    if (saveCartBtn) {
        if (cartPageItems.length === 0) {
            saveCartBtn.style.display = 'none';
        } else {
            saveCartBtn.style.display = 'inline-flex';
        }
    }
    
    // Show/hide restore button based on saved cart existence
    if (restoreCartBtn) {
        try {
            const savedCartData = localStorage.getItem('savedCart');
            if (savedCartData) {
                const savedItems = JSON.parse(savedCartData);
                if (Array.isArray(savedItems) && savedItems.length > 0) {
                    restoreCartBtn.style.display = 'inline-flex';
                    return;
                }
            }
        } catch (error) {
            console.warn('Error checking saved cart:', error);
        }
        
        // No valid saved cart, hide restore button
        restoreCartBtn.style.display = 'none';
    }
}

// Proceed to checkout
async function proceedToCheckout() {
    if (cartPageItems.length === 0) {
        showNotification('Your cart is empty', 'error');
        return;
    }
    
    // SECURITY: Validate cart prices server-side before proceeding to checkout
    try {
        showNotification('Validating cart...', 'info');
        
        // Get CSRF token
        const csrfToken = typeof getCSRFToken === 'function' ? getCSRFToken() : (typeof window.getCSRFToken === 'function' ? window.getCSRFToken() : '');
        
        const response = await fetch('/api/cart/validate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({
                items: cartPageItems,
                delivery: 0, // Will be calculated on checkout page
                couponDiscount: 0
            })
        });
        
        const data = await response.json();
        
        if (!response.ok || !data.success) {
            showNotification(data.message || 'Cart validation failed. Please review your cart.', 'error');
            // Reload cart to show updated prices
            loadCartItems();
            return;
        }
        
        // Update cart with server-validated prices
        if (data.items && data.items.length > 0) {
            cartPageItems = data.items;
            setCartItems(cartPageItems);
            
            // Show warnings if prices were updated
            if (data.warnings && data.warnings.length > 0) {
                const priceWarnings = data.warnings.filter(w => w.message && w.message.includes('Price updated'));
                if (priceWarnings.length > 0) {
                    showNotification('Some prices have been updated. Please review your cart.', 'warning');
                    // Reload cart to show updated prices
                    loadCartItems();
                    return;
                }
            }
        }
        
        // Navigate to checkout with validated cart
        showNotification('Redirecting to checkout...', 'success');
        setTimeout(() => {
            window.location.href = '/checkout';
        }, 500);
    } catch (error) {
        console.error('Error validating cart:', error);
        showNotification('Error validating cart. Please try again.', 'error');
    }
}

// showNotification() is defined in main.js and available globally via window.showNotification
// No need to redefine it here - all pages use the single implementation from main.js
// Supports: 'success', 'error', 'warning', 'info'

// Helper functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getColorHex(colorName) {
    const colorMap = {
        'black': '#000000',
        'blue': '#4169E1',
        'silver': '#C0C0C0',
        'gold': '#FFD700',
        'brown': '#8B4513',
        'white': '#FFFFFF',
        'green': '#228B22'
    };
    return colorMap[colorName.toLowerCase()] || '#000000';
}

// Make functions globally available for inline handlers
// Functions are no longer exposed globally since we use event delegation
// Keep restoreSavedCart available for the restore button
window.restoreSavedCart = restoreSavedCart;

