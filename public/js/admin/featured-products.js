// Featured Products Management JavaScript

// Configuration: Maximum number of featured products allowed
const MAX_FEATURED_PRODUCTS = 4;

let allProducts = [];
let featuredProducts = [];
let sortableInstance = null;
let isLoading = false;
let productsLoaded = false;
let featuredLoaded = false;

// Initialize page
document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication before initializing
    const isAuthenticated = await window.AuthUtils?.initializeAuthCheck();
    if (!isAuthenticated) {
        return; // Redirect will happen in initializeAuthCheck
    }
    
    isLoading = true;
    setupEventListeners();
    
    // Update max count display
    const maxCountElement = document.getElementById('maxFeaturedCount');
    if (maxCountElement) {
        maxCountElement.textContent = MAX_FEATURED_PRODUCTS;
    }
    
    // Load both in parallel but wait for both before rendering
    Promise.all([
        loadAllProducts(),
        loadFeaturedProducts()
    ]).then(() => {
        isLoading = false;
        // Render after both are loaded
        renderAvailableProducts(allProducts);
        renderFeaturedProducts(featuredProducts);
        
        // Add loaded class for smooth fade-in
        const featuredGrid = document.getElementById('featuredProductsGrid');
        const availableGrid = document.getElementById('availableProductsGrid');
        if (featuredGrid) featuredGrid.classList.add('loaded');
        if (availableGrid) availableGrid.classList.add('loaded');
    });
});

// Setup event listeners
function setupEventListeners() {
    // Search functionality
    const productSearch = document.getElementById('productSearch');
    if (productSearch) {
        productSearch.addEventListener('input', handleProductSearch);
    }
}

// Load all products from API
async function loadAllProducts() {
    try {
        const response = await fetch('/api/products?limit=1000'); // Get all products
        const data = await response.json();
        
        if (data.success && data.products) {
            allProducts = data.products;
            productsLoaded = true;
        } else {
            console.error('Failed to load products:', data.message);
            productsLoaded = true;
            showError('Failed to load products. Please refresh the page.');
        }
    } catch (error) {
        console.error('Error loading products:', error);
        productsLoaded = true;
        showError('Error loading products. Please check your connection.');
    }
}

// Load featured products from API
async function loadFeaturedProducts() {
    try {
        const response = await fetch('/api/marketing/featured-products');
        const data = await response.json();
        
        if (data.success && data.products) {
            featuredProducts = data.products;
        } else {
            // No featured products yet
            featuredProducts = [];
        }
        featuredLoaded = true;
    } catch (error) {
        console.error('Error loading featured products:', error);
        featuredProducts = [];
        featuredLoaded = true;
        showError('Error loading featured products.');
    }
}

// Placeholder image data URI (simple gray placeholder)
const PLACEHOLDER_IMAGE = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect width="200" height="200" fill="%231a1a1a"/%3E%3Ctext x="50%25" y="50%25" font-family="Arial" font-size="14" fill="%23666" text-anchor="middle" dy=".3em"%3ENo Image%3C/text%3E%3C/svg%3E';

// Validate and get product image URL
function getProductImage(product) {
    // Check if product has images array and it's not empty
    if (product.images && Array.isArray(product.images) && product.images.length > 0) {
        const imageUrl = product.images[0];
        // Validate that it's a non-empty string and not just whitespace
        if (typeof imageUrl === 'string' && imageUrl.trim().length > 0) {
            return imageUrl.trim();
        }
    }
    // Fallback to placeholder
    return PLACEHOLDER_IMAGE;
}

// Handle image error with safe fallback
function handleImageError(img) {
    // Prevent infinite loop - if already trying to load placeholder, stop
    if (img.src === PLACEHOLDER_IMAGE || img.dataset.errorHandled === 'true') {
        return;
    }
    
    // Mark as handled to prevent multiple attempts
    img.dataset.errorHandled = 'true';
    img.src = PLACEHOLDER_IMAGE;
    img.onerror = null; // Remove error handler to prevent infinite loop
}

// Render available products grid
let lastRenderedProducts = null;
function renderAvailableProducts(products) {
    const grid = document.getElementById('availableProductsGrid');
    if (!grid) return;

    // Prevent unnecessary re-renders if data hasn't changed
    const productsKey = JSON.stringify(products.map(p => p._id || p.id));
    if (lastRenderedProducts === productsKey && grid.innerHTML.trim() !== '') {
        return;
    }
    lastRenderedProducts = productsKey;

    if (products.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 40px;">
                <i class="fas fa-box-open" style="font-size: 48px; color: #666; margin-bottom: 20px;"></i>
                <p>No products found</p>
            </div>
        `;
        grid.classList.add('loaded');
        return;
    }

    grid.innerHTML = products.map(product => {
        const productId = product._id || product.id;
        const productName = product.model || product.name || 'Unnamed Product';
        const productImage = getProductImage(product);
        const productPrice = product.finalPrice || product.price || 0;
        const isFeatured = featuredProducts.some(fp => 
            String(fp._id || fp.id) === String(productId)
        );

        // Check if product exists in allProducts (for deleted products)
        const existsInAllProducts = allProducts.some(p => 
            String(p._id || p.id) === String(productId)
        );
        
        // Validate product
        const validation = isProductValidForFeaturing(product);
        const isValid = validation.valid && existsInAllProducts;
        const isInactive = product.status && product.status !== 'active';
        const isOutOfStock = !product.stock || product.stock <= 0;
        const isDeleted = !existsInAllProducts;

        // Determine badges to show
        let badges = '';
        if (isDeleted) {
            badges = '<div class="product-badge badge-deleted"><i class="fas fa-trash"></i> Deleted</div>';
        } else if (isInactive) {
            badges = `<div class="product-badge badge-warning"><i class="fas fa-exclamation-triangle"></i> ${product.status || 'Inactive'}</div>`;
        } else if (isOutOfStock) {
            badges = '<div class="product-badge badge-out-of-stock"><i class="fas fa-box-open"></i> Out of Stock</div>';
        }

        // Determine button state with better tooltips
        let buttonHtml = '';
        let buttonTitle = '';
        
        if (isFeatured) {
            buttonHtml = '<button class="btn-outline" style="width: 100%; padding: 8px; font-size: 12px;" disabled><i class="fas fa-check"></i> Featured</button>';
        } else if (!isValid) {
            // Provide specific reason for disabled state
            if (isDeleted) {
                buttonTitle = 'Product has been deleted and cannot be added';
            } else if (isInactive) {
                buttonTitle = `Product is ${product.status || 'inactive'}. Only active products can be featured.`;
            } else if (isOutOfStock) {
                buttonTitle = 'Product is out of stock. Only products with available stock can be featured.';
            } else {
                buttonTitle = validation.reason || 'Product is invalid and cannot be added';
            }
            
            buttonHtml = `<button class="btn-outline" style="width: 100%; padding: 8px; font-size: 12px; cursor: not-allowed; opacity: 0.6;" disabled title="${buttonTitle}">
                <i class="fas fa-ban"></i> Cannot Add
            </button>`;
        } else {
            buttonHtml = `<button class="btn-primary" style="width: 100%; padding: 8px; font-size: 12px;" onclick="addToFeatured('${productId}')" title="Add this product to featured list">
                <i class="fas fa-plus"></i> Add to Featured
            </button>`;
        }

        // Determine card classes for visual feedback
        let cardClasses = isFeatured ? 'featured' : '';
        if (!isValid) {
            cardClasses += ' invalid disabled';
            if (isDeleted) cardClasses += ' deleted';
            if (isInactive) cardClasses += ' inactive';
            if (isOutOfStock) cardClasses += ' out-of-stock';
        }
        
        return `
            <div class="featured-product-card ${cardClasses.trim()}" data-product-id="${productId}" title="${!isValid ? (isDeleted ? 'Product has been deleted' : isInactive ? `Product is ${product.status || 'inactive'}` : isOutOfStock ? 'Product is out of stock' : 'Product is invalid') : ''}">
                ${badges}
                <img src="${productImage}" alt="${productName}" onerror="handleImageError(this)" loading="lazy" style="${!isValid ? 'opacity: 0.5;' : ''}">
                <h4 style="margin: 10px 0; font-size: 14px; color: ${!isValid ? '#888' : '#fff'};">${productName}</h4>
                <p style="color: #aaa; font-size: 12px; margin-bottom: 10px;">K${productPrice.toLocaleString()}</p>
                ${buttonHtml}
            </div>
        `;
    }).join('');
    
    // Add loaded class for smooth fade-in
    grid.classList.add('loaded');
}

// Render featured products grid
let lastRenderedFeatured = null;
function renderFeaturedProducts(products) {
    const grid = document.getElementById('featuredProductsGrid');
    if (!grid) return;

    // Prevent unnecessary re-renders if data hasn't changed
    const featuredKey = JSON.stringify(products.map((p, i) => ({ id: p._id || p.id, order: i })));
    if (lastRenderedFeatured === featuredKey && grid.innerHTML.trim() !== '' && !grid.querySelector('.empty-state')) {
        return;
    }
    lastRenderedFeatured = featuredKey;

    // Destroy sortable before re-rendering to prevent flicker
    if (sortableInstance && sortableInstance.destroy) {
        sortableInstance.destroy();
        sortableInstance = null;
    }

    if (products.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 40px;">
                <i class="fas fa-star" style="font-size: 48px; color: #666; margin-bottom: 20px;"></i>
                <p>No featured products yet. Add products to display on the home page.</p>
            </div>
        `;
        grid.classList.add('loaded');
        return;
    }

    grid.innerHTML = products.map((product, index) => {
        const productId = product._id || product.id;
        const productName = product.model || product.name || 'Unnamed Product';
        const productImage = getProductImage(product);
        const productPrice = product.finalPrice || product.price || 0;

        // Check if product exists in allProducts (for deleted products)
        const existsInAllProducts = allProducts.some(p => 
            String(p._id || p.id) === String(productId)
        );
        
        // Check product status
        const isInactive = product.status && product.status !== 'active';
        const isOutOfStock = !product.stock || product.stock <= 0;
        const isDeleted = !existsInAllProducts;

        // Determine badges to show
        let badges = '';
        if (isDeleted) {
            badges = '<div class="product-badge badge-deleted"><i class="fas fa-trash"></i> Deleted</div>';
        } else if (isInactive) {
            badges = `<div class="product-badge badge-warning"><i class="fas fa-exclamation-triangle"></i> ${product.status || 'Inactive'}</div>`;
        } else if (isOutOfStock) {
            badges = '<div class="product-badge badge-out-of-stock"><i class="fas fa-box-open"></i> Out of Stock</div>';
        }

        // Determine card classes for visual feedback
        let cardClasses = 'featured';
        if (isDeleted || isInactive || isOutOfStock) {
            cardClasses += ' invalid';
            if (isDeleted) cardClasses += ' deleted';
            if (isInactive) cardClasses += ' inactive';
            if (isOutOfStock) cardClasses += ' out-of-stock';
        }
        
        // Build tooltip for invalid products
        let tooltip = '';
        if (isDeleted) {
            tooltip = 'Product has been deleted';
        } else if (isInactive) {
            tooltip = `Product is ${product.status || 'inactive'}`;
        } else if (isOutOfStock) {
            tooltip = 'Product is out of stock';
        }
        
        return `
            <div class="featured-product-card ${cardClasses.trim()}" data-product-id="${productId}" data-order="${index + 1}" title="${tooltip}">
                <div class="order-number">${index + 1}</div>
                ${badges}
                <button class="remove-btn" onclick="removeFromFeatured('${productId}')" title="Remove from featured">
                    <i class="fas fa-times"></i>
                </button>
                <img src="${productImage}" alt="${productName}" onerror="handleImageError(this)" loading="lazy" style="${isDeleted || isInactive || isOutOfStock ? 'opacity: 0.5;' : ''}">
                <h4 style="margin: 10px 0; font-size: 14px; color: ${isDeleted || isInactive || isOutOfStock ? '#888' : '#fff'};">${productName}</h4>
                <p style="color: #aaa; font-size: 12px;">K${productPrice.toLocaleString()}</p>
            </div>
        `;
    }).join('');

    // Add loaded class for smooth fade-in
    grid.classList.add('loaded');

    // Re-initialize sortable after rendering (with delay to prevent flicker)
    if (products.length > 0) {
        setTimeout(() => {
            initializeSortable();
        }, 50);
    }
}

// Initialize drag and drop with SortableJS (if available) or native HTML5
function initializeSortable() {
    const grid = document.getElementById('featuredProductsGrid');
    if (!grid) return;
    
    // Don't initialize if grid is empty or has empty state
    if (grid.querySelector('.empty-state')) return;

    // Destroy existing sortable instance if it exists
    if (sortableInstance && sortableInstance.destroy) {
        sortableInstance.destroy();
        sortableInstance = null;
    }

    // Wait a bit to ensure DOM is ready
    setTimeout(() => {
        // Try to use SortableJS if available via CDN
        if (typeof Sortable !== 'undefined' && !sortableInstance) {
            sortableInstance = new Sortable(grid, {
                animation: 150,
                handle: '.featured-product-card',
                onEnd: function(evt) {
                    updateFeaturedOrder();
                }
            });
        }
    }, 100);
}

// Check if product is valid for featuring
function isProductValidForFeaturing(product) {
    if (!product) {
        return { valid: false, reason: 'Product is null or undefined' };
    }
    
    const productId = String(product._id || product.id);
    
    // First check: Product must exist in allProducts array
    const existsInAllProducts = allProducts.some(p => 
        String(p._id || p.id) === productId
    );
    
    if (!existsInAllProducts) {
        return { valid: false, reason: 'Product not found in available products (may have been deleted)' };
    }
    
    // Second check: Product must be active
    if (product.status && product.status !== 'active') {
        return { valid: false, reason: `Product is ${product.status} (must be active)` };
    }
    
    // Third check: Product must have stock
    if (!product.stock || product.stock <= 0) {
        return { valid: false, reason: 'Product is out of stock (must have stock > 0)' };
    }
    
    return { valid: true };
}

// Add product to featured list
async function addToFeatured(productId) {
    // Check if already at max
    if (featuredProducts.length >= MAX_FEATURED_PRODUCTS) {
        showError(`Maximum ${MAX_FEATURED_PRODUCTS} featured products allowed. Please remove one first.`);
        return;
    }

    // First, check if product exists in allProducts array
    const product = allProducts.find(p => 
        String(p._id || p.id) === String(productId)
    );

    if (!product) {
        showError('Product not found in available products. The product may have been deleted. Please refresh the page.');
        // Reload products to get latest data
        await loadAllProducts();
        renderAvailableProducts(allProducts);
        return;
    }

    // Validate product before adding
    const validation = isProductValidForFeaturing(product);
    if (!validation.valid) {
        let errorMessage = `Cannot add product: ${validation.reason}`;
        
        // Provide more specific error messages
        if (!allProducts.some(p => String(p._id || p.id) === String(productId))) {
            errorMessage = 'Product not found in available products. The product may have been deleted.';
        } else if (product.status && product.status !== 'active') {
            errorMessage = `Cannot add product: Product is ${product.status}. Only active products can be featured.`;
        } else if (!product.stock || product.stock <= 0) {
            errorMessage = 'Cannot add product: Product is out of stock. Only products with available stock can be featured.';
        }
        
        showError(errorMessage);
        return;
    }

    // Add to featured list locally
    featuredProducts.push({
        ...product,
        featuredOrder: featuredProducts.length + 1
    });

    // Update order numbers
    updateOrderNumbers();

    // Save to API
    await saveFeaturedProducts();

    // Re-render both grids
    renderFeaturedProducts(featuredProducts);
    renderAvailableProducts(allProducts);
}

// Remove product from featured list
async function removeFromFeatured(productId) {
    if (!confirm('Remove this product from featured list?')) {
        return;
    }

    // Remove from featured list
    featuredProducts = featuredProducts.filter(p => 
        String(p._id || p.id) !== String(productId)
    );

    // Update order numbers
    updateOrderNumbers();

    // Save to API
    await saveFeaturedProducts();

    // Re-render both grids
    renderFeaturedProducts(featuredProducts);
    renderAvailableProducts(allProducts);
}

// Update featured products order after drag and drop
function updateFeaturedOrder() {
    const grid = document.getElementById('featuredProductsGrid');
    if (!grid) return;

    const cards = grid.querySelectorAll('.featured-product-card[data-product-id]');
    featuredProducts = [];

    cards.forEach((card, index) => {
        const productId = card.getAttribute('data-product-id');
        const product = allProducts.find(p => 
            String(p._id || p.id) === String(productId)
        );
        
        // Only add product if it exists and is valid
        if (product) {
            const validation = isProductValidForFeaturing(product);
            if (validation.valid) {
                featuredProducts.push({
                    ...product,
                    featuredOrder: index + 1
                });
            } else {
                // Log warning for invalid products
                console.warn(`[Featured Products] Skipping invalid product ${productId}: ${validation.reason}`);
            }
        } else {
            // Product not found in allProducts (deleted)
            console.warn(`[Featured Products] Product ${productId} not found in available products (may be deleted)`);
        }
    });

    updateOrderNumbers();
    saveFeaturedProducts();
    
    // Re-render to show any validation issues
    renderFeaturedProducts(featuredProducts);
}

// Update order numbers in featured products
function updateOrderNumbers() {
    featuredProducts.forEach((product, index) => {
        product.featuredOrder = index + 1;
    });
}

// Save featured products to API
async function saveFeaturedProducts() {
    try {
        const products = featuredProducts.map(p => ({
            productId: String(p._id || p.id),
            order: p.featuredOrder || 1
        }));

        const response = await fetch('/api/admin/marketing/featured-products', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
            },
            body: JSON.stringify({ products })
        });

        const data = await response.json();

        if (data.success) {
            showSuccess('Featured products updated successfully!');
        } else {
            showError(data.message || 'Failed to update featured products.');
        }
    } catch (error) {
        console.error('Error saving featured products:', error);
        showError('Error saving featured products. Please try again.');
    }
}

// Handle product search
function handleProductSearch(e) {
    const searchTerm = e.target.value.toLowerCase().trim();
    
    if (searchTerm === '') {
        renderAvailableProducts(allProducts);
        return;
    }

    const filtered = allProducts.filter(product => {
        const name = (product.model || product.name || '').toLowerCase();
        const brand = (product.brand || '').toLowerCase();
        const sku = (product.sku || '').toLowerCase();
        
        return name.includes(searchTerm) || 
               brand.includes(searchTerm) || 
               sku.includes(searchTerm);
    });

    renderAvailableProducts(filtered);
}

// Open add product modal (placeholder)
function openAddProductModal() {
    // This could open a modal to search and add products
    // For now, users can click "Add to Featured" buttons directly
    alert('Click "Add to Featured" on any product below to add it to the featured list.');
}

// Show success message
function showSuccess(message) {
    // Simple notification (can be enhanced with a toast library)
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4caf50;
        color: white;
        padding: 15px 20px;
        border-radius: 5px;
        z-index: 10000;
        box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Show error message
function showError(message) {
    // Simple notification (can be enhanced with a toast library)
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #ff4444;
        color: white;
        padding: 15px 20px;
        border-radius: 5px;
        z-index: 10000;
        box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Cleanup deleted products
async function cleanupDeletedProducts() {
    if (!confirm('This will remove all featured products that reference deleted products. Continue?')) {
        return;
    }

    try {
        const response = await fetch('/api/admin/marketing/featured-products/cleanup-deleted', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
            }
        });

        const data = await response.json();

        if (data.success) {
            showSuccess(data.message || `Cleaned up ${data.removedCount || 0} featured product(s)`);
            // Reload both products and featured products to reflect changes
            await Promise.all([
                loadAllProducts(),
                loadFeaturedProducts()
            ]);
            renderFeaturedProducts(featuredProducts);
            renderAvailableProducts(allProducts);
        } else {
            showError(data.message || 'Failed to cleanup deleted products');
        }
    } catch (error) {
        console.error('[Featured Products] Error cleaning up deleted products:', error);
        showError('Failed to cleanup deleted products. Please try again.');
    }
}

// Cleanup inactive/out-of-stock products
async function cleanupInactiveProducts() {
    const autoRemove = confirm(
        'This will check all featured products for inactive status or no stock.\n\n' +
        'Click OK to automatically remove them, or Cancel to only see warnings.'
    );

    try {
        const response = await fetch('/api/admin/marketing/featured-products/cleanup-inactive', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
            },
            body: JSON.stringify({ autoRemove })
        });

        const data = await response.json();

        if (data.success) {
            if (data.removedCount > 0) {
                showSuccess(data.message || `Removed ${data.removedCount} inactive/out-of-stock product(s)`);
                // Reload both products and featured products to reflect changes
                await Promise.all([
                    loadAllProducts(),
                    loadFeaturedProducts()
                ]);
                renderFeaturedProducts(featuredProducts);
                renderAvailableProducts(allProducts);
            } else if (data.warnings && data.warnings.length > 0) {
                // Show warnings in a more detailed way
                const warningMessage = `Found ${data.warnings.length} issue(s):\n\n${data.warnings.slice(0, 5).join('\n')}${data.warnings.length > 5 ? `\n... and ${data.warnings.length - 5} more` : ''}`;
                alert(warningMessage);
                showSuccess(data.message || 'Check completed. No products were removed.');
            } else {
                showSuccess('All featured products are active and in stock!');
            }
        } else {
            showError(data.message || 'Failed to cleanup inactive products');
        }
    } catch (error) {
        console.error('[Featured Products] Error cleaning up inactive products:', error);
        showError('Failed to cleanup inactive products. Please try again.');
    }
}

// Make functions available globally
window.addToFeatured = addToFeatured;
window.removeFromFeatured = removeFromFeatured;
window.openAddProductModal = openAddProductModal;
window.handleImageError = handleImageError;
window.cleanupDeletedProducts = cleanupDeletedProducts;
window.cleanupInactiveProducts = cleanupInactiveProducts;

// Wire up header buttons
document.addEventListener('DOMContentLoaded', function () {
    const el = (id) => document.getElementById(id);
    const addBtn = el('addProductBtn');
    const cleanupDeletedBtn = el('cleanupDeletedBtn');
    const cleanupInactiveBtn = el('cleanupInactiveBtn');
    if (addBtn) addBtn.addEventListener('click', openAddProductModal);
    if (cleanupDeletedBtn) cleanupDeletedBtn.addEventListener('click', cleanupDeletedProducts);
    if (cleanupInactiveBtn) cleanupInactiveBtn.addEventListener('click', cleanupInactiveProducts);
});

