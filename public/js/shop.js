// Shop Page JavaScript

// Debounce utility function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Filter Manager Class
class FilterManager {
    constructor() {
        this.filters = this.loadFiltersFromURL();
        this.applyFilters = this.applyFilters.bind(this);
    }

    loadFiltersFromURL() {
        const params = new URLSearchParams(window.location.search);
        return {
            brands: params.get('brands') ? params.get('brands').split(',') : [],
            gender: params.get('gender') || 'all',
            straps: params.get('straps') ? params.get('straps').split(',') : [],
            ratings: params.get('ratings') ? params.get('ratings').split(',').map(r => parseInt(r)) : [],
            stockOnly: params.get('stockOnly') === 'true',
            lowStock: params.get('lowStock') === 'true',
            minPrice: parseInt(params.get('minPrice')) || 0,
            maxPrice: parseInt(params.get('maxPrice')) || 10000,
            search: params.get('search') || '',
            sort: params.get('sort') || 'latest'
        };
    }

    applyFiltersToDOM() {
        // Apply filters to DOM elements
        // Brands
        document.querySelectorAll('input[name="brand"]').forEach(cb => {
            cb.checked = this.filters.brands.includes(cb.value);
        });

        // Gender
        const genderRadio = document.querySelector(`input[name="gender"][value="${this.filters.gender}"]`);
        if (genderRadio) genderRadio.checked = true;

        // Straps
        document.querySelectorAll('input[name="strap"]').forEach(cb => {
            cb.checked = this.filters.straps.includes(cb.value);
        });

        // Ratings
        document.querySelectorAll('input[name="rating"]').forEach(cb => {
            cb.checked = this.filters.ratings.includes(parseInt(cb.value));
        });

        // Stock
        const stockOnlyCheckbox = document.querySelector('input[name="stock"][value="in-stock"]');
        const lowStockCheckbox = document.querySelector('input[name="stock"][value="low-stock"]');
        if (stockOnlyCheckbox) stockOnlyCheckbox.checked = this.filters.stockOnly;
        if (lowStockCheckbox) lowStockCheckbox.checked = this.filters.lowStock;

        // Price
        const priceMin = document.getElementById('priceMin');
        const priceMax = document.getElementById('priceMax');
        if (priceMin) {
            priceMin.value = this.filters.minPrice || 0;
        }
        if (priceMax) {
            priceMax.value = this.filters.maxPrice || 10000;
        }

        // Search
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = this.filters.search;

        // Sort
        const sortSelect = document.getElementById('sortSelect');
        if (sortSelect) sortSelect.value = this.filters.sort;
    }

    updateURL() {
        const params = new URLSearchParams();

        if (this.filters.brands.length > 0) {
            params.set('brands', this.filters.brands.join(','));
        }
        if (this.filters.gender !== 'all') {
            params.set('gender', this.filters.gender);
        }
        if (this.filters.straps.length > 0) {
            params.set('straps', this.filters.straps.join(','));
        }
        if (this.filters.ratings.length > 0) {
            params.set('ratings', this.filters.ratings.join(','));
        }
        if (this.filters.stockOnly) {
            params.set('stockOnly', 'true');
        }
        if (this.filters.lowStock) {
            params.set('lowStock', 'true');
        }
        if (this.filters.minPrice !== 0) {
            params.set('minPrice', this.filters.minPrice);
        }
        if (this.filters.maxPrice !== 10000) {
            params.set('maxPrice', this.filters.maxPrice);
        }
        if (this.filters.search) {
            params.set('search', this.filters.search);
        }
        if (this.filters.sort !== 'latest') {
            params.set('sort', this.filters.sort);
        }

        const newURL = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
        window.history.replaceState(null, '', newURL);
    }

    getFiltersFromDOM() {
        return {
            brands: Array.from(document.querySelectorAll('input[name="brand"]:checked'))
                .map(cb => cb.value),
            gender: document.querySelector('input[name="gender"]:checked')?.value || 'all',
            straps: Array.from(document.querySelectorAll('input[name="strap"]:checked'))
                .map(cb => cb.value),
            ratings: Array.from(document.querySelectorAll('input[name="rating"]:checked'))
                .map(cb => parseInt(cb.value)),
            stockOnly: document.querySelector('input[name="stock"][value="in-stock"]')?.checked || false,
            lowStock: document.querySelector('input[name="stock"][value="low-stock"]')?.checked || false,
            minPrice: parseInt(document.getElementById('priceMin')?.value) || 0,
            maxPrice: parseInt(document.getElementById('priceMax')?.value) || 10000,
            search: document.getElementById('searchInput')?.value.toLowerCase() || '',
            sort: document.getElementById('sortSelect')?.value || 'latest'
        };
    }

    applyFilters() {
        // Update filters from DOM
        this.filters = this.getFiltersFromDOM();

        // Validate price range
        if (!this.validatePriceRange()) {
            return; // Stop if validation fails
        }

        // Clear search query when applying filters (filters take precedence)
        currentSearchQuery = null;

        // Update URL with current filters
        this.updateURL();

        // Reset to first page when filters change
        currentPage = 1;

        // Filter products - reload from API with filters
        // Note: Filtering is now done server-side via API
        loadProducts();

        // Scroll to product grid so filtered results are visible
        const productSection = document.getElementById('productGrid') || document.querySelector('.product-grid-section');
        if (productSection) {
            productSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // Close the filter drawer if open
        closeFilterDrawer();

        return;
        
        // Legacy client-side filtering (kept for reference, but not used)
        /* filteredProducts = filteredProducts.filter(product => {
            // Brand filter
            if (this.filters.brands.length > 0 && !this.filters.brands.includes(product.brand)) {
                return false;
            }

            // Gender filter
            if (this.filters.gender !== 'all' && product.gender !== this.filters.gender) {
                return false;
            }

            // Strap filter
            if (this.filters.straps.length > 0 && !this.filters.straps.includes(product.strap)) {
                return false;
            }

            // Rating filter
            if (this.filters.ratings.length > 0) {
                const meetsRating = this.filters.ratings.some(rating => {
                    if (rating === 5) return product.rating >= 4.75;
                    if (rating === 4) return product.rating >= 3.75;
                    if (rating === 3) return product.rating >= 2.75;
                    return true;
                });
                if (!meetsRating) return false;
            }

            // Stock filter
            if (this.filters.stockOnly && product.stock !== 'in-stock') {
                return false;
            }
            if (!this.filters.lowStock && product.stock === 'low-stock') {
                return false;
            }

            // Price filter
            if (product.price < this.filters.minPrice || product.price > this.filters.maxPrice) {
                return false;
            }

            // Search filter
            if (this.filters.search) {
                const search = this.filters.search.toLowerCase();
                if (!product.name.toLowerCase().includes(search) &&
                    !product.description.toLowerCase().includes(search)) {
                    return false;
                }
            }

            return true;
        }); */

        // Apply sorting (don't update URL here, we'll do it after)
        const sortType = this.filters.sort;
        switch (sortType) {
            case 'price-low':
                filteredProducts.sort((a, b) => a.price - b.price);
                break;
            case 'price-high':
                filteredProducts.sort((a, b) => b.price - a.price);
                break;
            case 'rating':
                filteredProducts.sort((a, b) => b.rating - a.rating);
                break;
            case 'popularity':
                filteredProducts.sort((a, b) => b.reviews - a.reviews);
                break;
            default: // latest
                filteredProducts.sort((a, b) => {
                    // ✅ Use _id for sorting (MongoDB standard)
                    const aId = String(a._id || a.id || '');
                    const bId = String(b._id || b.id || '');
                    return bId.localeCompare(aId);
                });
        }

        // Update URL
        this.updateURL();

        // Reset to first page and reload
        currentPage = 1;
        loadProducts();
        updateActiveFilters();
        updateProductCount();
    }

    validatePriceRange() {
        const minPrice = this.filters.minPrice || 0;
        const maxPrice = this.filters.maxPrice || 10000;

        // Check if minPrice is greater than maxPrice
        if (minPrice > maxPrice) {
            // Show error notification
            if (typeof showNotification === 'function') {
                showNotification('Minimum price cannot be greater than maximum price. Please adjust your price range.');
            } else {
                alert('Minimum price cannot be greater than maximum price. Please adjust your price range.');
            }

            // Highlight the invalid inputs
            const priceMinInput = document.getElementById('priceMin');
            const priceMaxInput = document.getElementById('priceMax');
            
            if (priceMinInput) {
                priceMinInput.style.borderColor = '#ff4444';
                priceMinInput.style.boxShadow = '0 0 5px rgba(255, 68, 68, 0.5)';
                // Remove error styling after 3 seconds
                setTimeout(() => {
                    priceMinInput.style.borderColor = '';
                    priceMinInput.style.boxShadow = '';
                }, 3000);
            }
            
            if (priceMaxInput) {
                priceMaxInput.style.borderColor = '#ff4444';
                priceMaxInput.style.boxShadow = '0 0 5px rgba(255, 68, 68, 0.5)';
                // Remove error styling after 3 seconds
                setTimeout(() => {
                    priceMaxInput.style.borderColor = '';
                    priceMaxInput.style.boxShadow = '';
                }, 3000);
            }

            return false; // Validation failed
        }

        // Check if prices are within valid range
        if (minPrice < 0 || maxPrice < 0) {
            if (typeof showNotification === 'function') {
                showNotification('Price cannot be negative. Please enter a valid price range.');
            } else {
                alert('Price cannot be negative. Please enter a valid price range.');
            }
            return false;
        }

        return true; // Validation passed
    }
}

// Create global filter manager instance
const filterManager = new FilterManager();

document.addEventListener('DOMContentLoaded', function () {
    initializeShopPage();
});

function initializeShopPage() {
    // Hide loading spinner initially (products may be server-rendered)
    showLoadingSpinner(false);

    // Apply filters from URL to DOM
    filterManager.applyFiltersToDOM();

    // Apply filters and load products
    filterManager.applyFilters();

    setupEventListeners();
}

// Products are loaded from the database via API
let currentPage = 1;
const productsPerPage = 8;
let filteredProducts = [];
let currentPagination = null; // Store pagination data from API
let currentSearchQuery = null; // Store current search query for pagination

// Track the current in-flight product request to prevent race conditions
let currentProductRequest = null;

// Map frontend sort values to API sortBy values
function mapSortToAPI(sortValue) {
    const sortMap = {
        'latest': 'newest',
        'price-low': 'price_asc',
        'price-high': 'price_desc',
        'rating': 'rating',
        'popularity': 'newest' // Fallback to newest if popularity not supported
    };
    return sortMap[sortValue] || 'newest';
}

// Helper function to show/hide loading spinner
function showLoadingSpinner(show = true) {
    const loadingSpinner = document.getElementById('loadingSpinner');
    if (loadingSpinner) {
        loadingSpinner.style.display = show ? 'flex' : 'none';
    }
}

async function loadProducts(page = null) {
    // Optional page override (e.g., when pagination explicitly passes a page)
    if (page !== null) {
        currentPage = page;
    }

    // Cancel any previous in-flight request
    if (currentProductRequest) {
        currentProductRequest.cancelled = true;
    }

    const thisRequest = { cancelled: false };
    currentProductRequest = thisRequest;

    const productGrid = document.getElementById('productGrid');

    // Show loading spinner
    showLoadingSpinner(true);

    // Try to load products from API with retry mechanism
    try {
        const { fetchWithRetry } = window;
        
        // Prepare API parameters
        const apiParams = {
            page: currentPage,
            limit: productsPerPage
        };
        
        // Map filters to API format
        if (filterManager && filterManager.filters) {
            const filters = filterManager.filters;
            
            // Map brands array to brand parameter (API expects comma-separated string for regex matching)
            // Frontend: filters.brands = ['rolex', 'omega'] → API: brand = 'rolex,omega'
            if (filters.brands && filters.brands.length > 0) {
                apiParams.brand = filters.brands.join(',');
            }
            
            // Gender - already in correct format
            // Frontend: filters.gender = 'men' → API: gender = 'men'
            if (filters.gender && filters.gender !== 'all') {
                apiParams.gender = filters.gender;
            }
            
            // Straps
            if (filters.straps && filters.straps.length > 0) {
                apiParams.strap = filters.straps.join(',');
            }

            // Ratings - send the minimum selected rating
            if (filters.ratings && filters.ratings.length > 0) {
                apiParams.minRating = Math.min(...filters.ratings);
            }
            
            // Stock filters
            // Frontend: filters.stockOnly = true → API: inStockOnly = true (boolean)
            // API accepts both boolean true and string 'true', but boolean is preferred
            if (filters.stockOnly) {
                apiParams.inStockOnly = true;
            }
            
            if (filters.lowStock) {
                apiParams.lowStock = 'true';
            }
            
            // Price range - already in correct format
            // Frontend: filters.minPrice = 100 → API: minPrice = 100
            if (filters.minPrice && filters.minPrice > 0) {
                apiParams.minPrice = filters.minPrice.toString();
            }
            if (filters.maxPrice && filters.maxPrice < 10000) {
                apiParams.maxPrice = filters.maxPrice.toString();
            }
            
            // Search - Note: search uses a different endpoint (/api/products/search)
            // If search is active, it should use the searchProducts() function instead
            // For now, we'll skip search in the filter API call
            // The search functionality is handled separately in searchProducts() function
            
            // Sort - map to API format
            // Frontend: filters.sort = 'price-low' → API: sortBy = 'price_asc'
            if (filters.sort) {
                apiParams.sortBy = mapSortToAPI(filters.sort);
            }
        }
        
        // URLSearchParams converts booleans to strings, which is fine since API accepts both
        // Convert boolean true to string 'true' for consistency
        if (apiParams.inStockOnly === true) {
            apiParams.inStockOnly = 'true';
        }
        
        const apiUrl = '/api/products?' + new URLSearchParams(apiParams);
        
        // ✅ Use fetchWithRetry with proper parameters (3 retries with exponential backoff)
        // Prerequisite: error-handler.js must be loaded before shop.js (verified in footer.ejs)
        let response;
        if (fetchWithRetry) {
            response = await fetchWithRetry(apiUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            }, 3); // 3 retries with exponential backoff
        } else {
            // Fallback to regular fetch if fetchWithRetry not available
            console.warn('[Shop] fetchWithRetry not available, using regular fetch');
            response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        }

        // If this request was cancelled while the fetch was in-flight, ignore it
        if (thisRequest.cancelled) {
            console.log('[Shop] Product request cancelled before response handling');
            // Hide spinner if this request was cancelled (new request will show it again)
            showLoadingSpinner(false);
            return;
        }

        if (!response.ok) {
            // Create more specific error based on status code
            let errorMessage = `HTTP error! status: ${response.status}`;
            if (response.status === 404) {
                errorMessage = 'Products endpoint not found (404). Please refresh the page.';
            } else if (response.status === 500) {
                errorMessage = 'Server error (500). The server encountered an issue. Please try again in a moment.';
            } else if (response.status === 503) {
                errorMessage = 'Service unavailable (503). The server is temporarily down. Please try again later.';
            } else if (response.status === 429) {
                errorMessage = 'Too many requests (429). Please wait a moment before trying again.';
            } else if (response.status >= 400 && response.status < 500) {
                errorMessage = `Client error (${response.status}). Please check your request and try again.`;
            } else if (response.status >= 500) {
                errorMessage = `Server error (${response.status}). Please try again later.`;
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();

        // If this request was cancelled while parsing/processing, ignore it
        if (thisRequest.cancelled) {
            console.log('[Shop] Product request cancelled after response parsing');
            // Hide spinner if this request was cancelled (new request will show it again)
            showLoadingSpinner(false);
            return;
        }

        if (data.success && data.products && data.products.length > 0) {
            // Use API products
            filteredProducts = data.products;
            // Store pagination data
            currentPagination = data.pagination || null;
            // Update currentPage from API pagination if available
            if (currentPagination && currentPagination.currentPage) {
                currentPage = currentPagination.currentPage;
            }
            renderProductsFromAPI(data.products);
            updatePagination(currentPagination);
            updateProductCount(currentPagination ? currentPagination.totalProducts : filteredProducts.length);
            updateActiveFilters(); // Update active filters display
            // Hide loading spinner
            showLoadingSpinner(false);
            return;
        } else if (data.success && data.products && data.products.length === 0) {
            // No products found from API - always clear the grid first
            const productGrid = document.getElementById('productGrid');
            if (productGrid) productGrid.innerHTML = '';

            const hasActiveFilters = hasFiltersApplied();
            if (hasActiveFilters) {
                showNoProductsMessage('No products found matching your search criteria. Try adjusting your filters.', true);
            } else {
                showNoProductsMessage('No watches found', false);
            }
            updateActiveFilters(); // Update active filters display even when no products
            // Update product count (will show 0 when no products)
            if (currentPagination && currentPagination.totalProducts !== undefined) {
                updateProductCount(currentPagination.totalProducts);
            } else {
                updateProductCount(0);
            }
            // Hide loading spinner
            showLoadingSpinner(false);
            return;
        }
    } catch (error) {
        // If this request was cancelled, silently ignore errors
        if (!thisRequest.cancelled) {
            console.error('[Shop] Error loading products from API:', error);
            
            // Determine error type and create user-friendly message
            let errorMessage = 'Unable to load products. Please try again later.';
            if (error.message && error.message.includes('Failed to fetch')) {
                errorMessage = 'Network error: Unable to connect to the server. Please check your internet connection.';
            } else if (error.message && error.message.includes('404')) {
                errorMessage = 'Products endpoint not found. Please refresh the page.';
            } else if (error.message && error.message.includes('500')) {
                errorMessage = 'Server error: The server encountered an issue. Please try again in a moment.';
            } else if (error.message && error.message.includes('timeout')) {
                errorMessage = 'Request timed out. The server is taking too long to respond.';
            }
            
            // Show error message with retry functionality
            showNoProductsMessage(errorMessage, false, true, () => {
                // Retry function - reload products
                loadProducts();
            });
        }
        // Hide loading spinner on error
        showLoadingSpinner(false);
        return;
    } finally {
        // Clear the tracker only if this request is still the active one
        if (currentProductRequest === thisRequest) {
            currentProductRequest = null;
        }
    }
}

// Render products from API response
function renderProductsFromAPI(products) {
    const productGrid = document.getElementById('productGrid');
    productGrid.innerHTML = '';

    products.forEach(product => {
        const currentPrice    = Number(product.finalPrice || product.price) || 0;
        const originalPrice   = Number(product.originalPrice) || 0;
        const stockQty        = (product.availableStock != null ? product.availableStock : product.stock) || 0;
        const stockStatus     = product.stockStatus;

        const productCard = createProductCard({
            _id: product.id || product._id,
            name: product.model,
            price: currentPrice,
            originalPrice: originalPrice > currentPrice ? originalPrice : null,
            discount: product.discount || 0,
            image: (() => { let imgs = product.images; if (typeof imgs === 'string') { try { imgs = JSON.parse(imgs); } catch(e) { imgs = []; } } return (Array.isArray(imgs) && imgs[0]) ? imgs[0] : '/images/placeholder.jpg'; })(),
            brand: product.brand ? product.brand.toLowerCase() : 'brand',
            gender: product.gender ? product.gender.toLowerCase() : 'unisex',
            color: product.color ? product.color.toLowerCase() : 'black',
            strap: product.strap ? product.strap.toLowerCase() : 'metal',
            rating: product.rating || 0,
            reviews: 0,
            stock: stockStatus,
            stockQuantity: stockQty,
            description: product.description || '',
            features: []
        });
        productGrid.appendChild(productCard);
    });
}

// Check if any filters are currently applied (not default values)
function hasFiltersApplied() {
    if (!filterManager || !filterManager.filters) {
        return false;
    }
    
    const filters = filterManager.filters;
    
    // Default filter values (must match FilterManager.loadFiltersFromURL defaults)
    const defaults = {
        brands: [],
        gender: 'all',
        straps: [],
        ratings: [],
        stockOnly: false, // default is false unless user explicitly enables it
        lowStock: false,
        minPrice: 0,
        maxPrice: 10000,
        search: '',
        sort: 'latest'
    };
    
    // Check if any filters differ from defaults
    return (
        (filters.brands && filters.brands.length > 0) ||
        (filters.gender && filters.gender !== defaults.gender) ||
        (filters.straps && filters.straps.length > 0) ||
        (filters.ratings && filters.ratings.length > 0) ||
        (filters.stockOnly !== defaults.stockOnly) ||
        (filters.lowStock !== defaults.lowStock) ||
        (filters.minPrice !== defaults.minPrice) ||
        (filters.maxPrice !== defaults.maxPrice) ||
        (filters.search && filters.search.trim().length > 0)
    );
}

// Show no products message or error message
function showNoProductsMessage(message, showFilterOptions = true, isError = false, retryFunction = null) {
    const productGrid = document.getElementById('productGrid');
    
    // Clear any existing no-products message
    const existingMessage = productGrid.querySelector('.no-products');
    if (existingMessage) {
        existingMessage.remove();
    }
    
    const noProductsDiv = document.createElement('div');
    noProductsDiv.className = 'no-products';
    noProductsDiv.style.cssText = 'grid-column: 1 / -1; text-align: center; padding: 60px 20px;';

    // Icon - different for errors vs no products
    const icon = document.createElement('i');
    if (isError) {
        icon.className = 'fas fa-exclamation-triangle';
        icon.style.cssText = 'font-size: 64px; color: #ff6b6b; margin-bottom: 20px;';
    } else {
        icon.className = 'fas fa-search';
        icon.style.cssText = 'font-size: 64px; color: #666; margin-bottom: 20px;';
    }
    noProductsDiv.appendChild(icon);

    const h3 = document.createElement('h3');
    h3.textContent = message || (isError ? 'Error loading products' : 'No watches found');
    h3.style.cssText = 'font-size: 24px; margin-bottom: 10px; color: #000;';
    noProductsDiv.appendChild(h3);

    // Show retry button for errors
    if (isError && retryFunction) {
        const errorP = document.createElement('p');
        errorP.textContent = 'We encountered an issue while loading products. Please try again.';
        errorP.style.cssText = 'color: #aaa; margin-bottom: 20px;';
        noProductsDiv.appendChild(errorP);

        const retryButton = document.createElement('button');
        retryButton.className = 'btn gradient-flow';
        retryButton.style.cssText = 'margin: 0 10px 10px 0;';
        retryButton.innerHTML = '<i class="fas fa-redo"></i> Retry';
        retryButton.addEventListener('click', () => {
            retryFunction();
        });
        noProductsDiv.appendChild(retryButton);

        // Also add a refresh page button as fallback
        const refreshButton = document.createElement('button');
        refreshButton.className = 'btn';
        refreshButton.style.cssText = 'margin: 0 10px 10px 0; background: #333; color: #fff; border: 1px solid #555;';
        refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh Page';
        refreshButton.addEventListener('click', () => {
            window.location.reload();
        });
        noProductsDiv.appendChild(refreshButton);
    }

    // Only show filter-related options if showFilterOptions is true and not an error
    if (showFilterOptions && !isError) {
        const p = document.createElement('p');
        p.textContent = 'Try adjusting your filters or search terms';
        p.style.cssText = 'color: #aaa; margin-bottom: 30px;';
        noProductsDiv.appendChild(p);

        const button = document.createElement('button');
        button.className = 'btn';
        button.textContent = 'Clear All Filters';
        button.addEventListener('click', clearAllFilters);
        noProductsDiv.appendChild(button);
    }

    productGrid.appendChild(noProductsDiv);
}

function createProductCard(product) {
    const productId = product._id || product.id;
    const productUrl = `/product/${productId}`;

    const card = document.createElement('div');
    card.className = 'shop-product-card';

    const productImageWrapper = document.createElement('div');
    productImageWrapper.className = 'product-image-wrapper';

    if (product.originalPrice && product.originalPrice > product.price) {
        const discountBadge = document.createElement('span');
        discountBadge.className = 'discount-badge';
        discountBadge.textContent = `-${product.discount || Math.round((1 - product.price / product.originalPrice) * 100)}%`;
        productImageWrapper.appendChild(discountBadge);
    }

    if (product.stock === 'out-of-stock') {
        const outOfStockOverlay = document.createElement('div');
        outOfStockOverlay.className = 'out-of-stock-overlay';
        outOfStockOverlay.textContent = 'Out of Stock';
        productImageWrapper.appendChild(outOfStockOverlay);
    } else if (product.stock === 'low-stock') {
        const lowStockBadge = document.createElement('div');
        lowStockBadge.className = 'low-stock-badge';
        lowStockBadge.textContent = `Only ${product.stockQuantity} left`;
        productImageWrapper.appendChild(lowStockBadge);
    }

    const productImage = document.createElement('div');
    productImage.className = 'product-image';

    const mediaLink = document.createElement('a');
    mediaLink.href = productUrl;
    mediaLink.className = 'product-link product-link--media';

    const img = document.createElement('img');
    img.src = product.image;
    img.alt = product.name;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 400;
    img.height = 400;
    img.style.cssText = 'aspect-ratio: 1 / 1; object-fit: cover;';

    if (img.complete) {
        img.classList.add('loaded');
    } else {
        img.addEventListener('load', () => img.classList.add('loaded'));
        img.addEventListener('error', () => {
            img.src = '/images/placeholder.jpg';
            img.classList.add('loaded');
        });
    }

    mediaLink.appendChild(img);
    productImage.appendChild(mediaLink);

    const productActions = document.createElement('div');
    productActions.className = 'product-actions';
    const quickViewBtn = document.createElement('button');
    quickViewBtn.type = 'button';
    quickViewBtn.className = 'quick-view-btn';
    quickViewBtn.setAttribute('data-product-id', String(productId));
    quickViewBtn.setAttribute('aria-label', 'Quick view: ' + (product.name || 'Product'));
    quickViewBtn.innerHTML = '<i class="fas fa-eye" aria-hidden="true"></i>';
    productActions.appendChild(quickViewBtn);
    productImage.appendChild(productActions);

    productImageWrapper.appendChild(productImage);
    card.appendChild(productImageWrapper);

    const infoLink = document.createElement('a');
    infoLink.href = productUrl;
    infoLink.className = 'product-link product-link--info';

    const productInfo = document.createElement('div');
    productInfo.className = 'product-info';

    const brandDiv = document.createElement('div');
    brandDiv.className = 'product-brand';
    brandDiv.textContent = (product.brand || '').toUpperCase();
    productInfo.appendChild(brandDiv);

    const productName = document.createElement('h3');
    productName.className = 'product-name';
    productName.textContent = product.name;
    productInfo.appendChild(productName);

    const ratingDiv = document.createElement('div');
    ratingDiv.className = 'product-rating';
    ratingDiv.innerHTML = getStarRating(product.rating);
    const ratingValue = document.createElement('span');
    ratingValue.className = 'rating-value';
    ratingValue.textContent = `(${product.rating || 0})`;
    ratingDiv.appendChild(ratingValue);
    productInfo.appendChild(ratingDiv);

    const priceDiv = document.createElement('div');
    priceDiv.className = 'product-price';
    if (product.originalPrice && product.originalPrice > product.price) {
        const originalPriceSpan = document.createElement('span');
        originalPriceSpan.className = 'original-price';
        originalPriceSpan.textContent = `K${product.originalPrice.toLocaleString()}`;
        priceDiv.appendChild(originalPriceSpan);
    }
    const currentPriceEl = document.createElement('span');
    currentPriceEl.className = 'current-price';
    currentPriceEl.textContent = `K${product.price.toLocaleString()}`;
    priceDiv.appendChild(currentPriceEl);
    productInfo.appendChild(priceDiv);

    infoLink.appendChild(productInfo);
    card.appendChild(infoLink);

    return card;
}

function setupEventListeners() {
    // Sort select
    document.getElementById('sortSelect').addEventListener('change', function () {
        sortProducts(this.value);
    });

    // Filter checkboxes - removed automatic apply (now requires Apply button)
    // Checkboxes and radios no longer trigger filter application automatically

    // Price inputs - add real-time validation
    const priceMinInput = document.getElementById('priceMin');
    const priceMaxInput = document.getElementById('priceMax');
    
    if (priceMinInput && priceMaxInput) {
        // Validate on input change
        const validatePriceInputs = () => {
            const minPrice = parseInt(priceMinInput.value) || 0;
            const maxPrice = parseInt(priceMaxInput.value) || 10000;
            const errorDiv = document.getElementById('priceRangeError');
            
            // Clear previous error styling
            priceMinInput.style.borderColor = '';
            priceMinInput.style.boxShadow = '';
            priceMaxInput.style.borderColor = '';
            priceMaxInput.style.boxShadow = '';
            
            if (errorDiv) {
                errorDiv.style.display = 'none';
                errorDiv.textContent = '';
            }
            
            // Validate if both fields have values
            if (priceMinInput.value && priceMaxInput.value) {
                if (minPrice > maxPrice) {
                    // Show error
                    if (errorDiv) {
                        errorDiv.textContent = 'Minimum price cannot be greater than maximum price';
                        errorDiv.style.display = 'block';
                    }
                    priceMinInput.style.borderColor = '#ff4444';
                    priceMinInput.style.boxShadow = '0 0 5px rgba(255, 68, 68, 0.5)';
                    priceMaxInput.style.borderColor = '#ff4444';
                    priceMaxInput.style.boxShadow = '0 0 5px rgba(255, 68, 68, 0.5)';
                } else if (minPrice < 0 || maxPrice < 0) {
                    // Show error for negative values
                    if (errorDiv) {
                        errorDiv.textContent = 'Price cannot be negative';
                        errorDiv.style.display = 'block';
                    }
                    if (minPrice < 0) {
                        priceMinInput.style.borderColor = '#ff4444';
                        priceMinInput.style.boxShadow = '0 0 5px rgba(255, 68, 68, 0.5)';
                    }
                    if (maxPrice < 0) {
                        priceMaxInput.style.borderColor = '#ff4444';
                        priceMaxInput.style.boxShadow = '0 0 5px rgba(255, 68, 68, 0.5)';
                    }
                }
            }
        };
        
        priceMinInput.addEventListener('input', validatePriceInputs);
        priceMaxInput.addEventListener('input', validatePriceInputs);
        priceMinInput.addEventListener('blur', validatePriceInputs);
        priceMaxInput.addEventListener('blur', validatePriceInputs);
    }

    // Filter drawer: chip opens it, close button / backdrop / Escape close it
    const filterToggleBtn = document.getElementById('filterToggleBtn');
    if (filterToggleBtn) {
        filterToggleBtn.addEventListener('click', toggleFilterDrawer);
    }

    const filterCloseBtn = document.getElementById('filterCloseBtn');
    if (filterCloseBtn) {
        filterCloseBtn.addEventListener('click', closeFilterDrawer);
    }

    const filterBackdrop = document.getElementById('filterBackdrop');
    if (filterBackdrop) {
        filterBackdrop.addEventListener('click', closeFilterDrawer);
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const sidebar = document.getElementById('filterSidebar');
            if (sidebar && sidebar.classList.contains('active')) {
                closeFilterDrawer();
            }
        }
    });

    // Clear filters button
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', clearAllFilters);
    }

    // Search input with debouncing
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', debouncedSearch);
    }

    // Search button
    const searchBtn = document.getElementById('searchBtn');
    if (searchBtn) {
        searchBtn.addEventListener('click', searchProducts);
    }

    // Apply Filters button (applies all filters at once)
    const applyFiltersBtn = document.getElementById('applyFiltersBtn');
    if (applyFiltersBtn) {
        applyFiltersBtn.addEventListener('click', applyFilters);
    }

    // Pagination buttons
    const prevPageBtn = document.getElementById('prevPageBtn');
    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', prevPage);
    }

    const nextPageBtn = document.getElementById('nextPageBtn');
    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', nextPage);
    }

}

// Legacy applyFilters function - now uses FilterManager
function applyFilters() {
    filterManager.applyFilters();
}

function sortProducts(sortType) {
    // Update filterManager sort value
    if (filterManager) {
        filterManager.filters.sort = sortType;
        
        // Update URL with new sort parameter
        filterManager.updateURL();
        
        // Reset to first page when sorting changes
        currentPage = 1;
        
        // Reload products with new sort (API will handle sorting)
        loadProducts();
    }
}

function updatePagination(pagination = null) {
    // Use API pagination data if available, otherwise fall back to client-side calculation
    const paginationData = pagination || currentPagination;
    
    let totalPages = 0;
    let currentPageNum = currentPage;
    
    if (paginationData && paginationData.totalPages !== undefined) {
        totalPages = paginationData.totalPages;
        currentPageNum = paginationData.currentPage || currentPage;
    } else {
        // Fallback: calculate from filtered products length
        totalPages = Math.ceil(filteredProducts.length / productsPerPage);
    }
    
    const pageNumbers = document.getElementById('pageNumbers');
    const paginationElement = document.getElementById('pagination');

    if (!paginationElement || !pageNumbers) {
        return;
    }

    if (totalPages <= 1) {
        paginationElement.style.display = 'none';
        return;
    }

    paginationElement.style.display = 'flex';
    pageNumbers.innerHTML = '';

    // Show page numbers (max 5 pages at a time)
    const maxPagesToShow = 5;
    let startPage = Math.max(1, currentPageNum - Math.floor(maxPagesToShow / 2));
    let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
    
    // Adjust start page if we're near the end
    if (endPage - startPage < maxPagesToShow - 1) {
        startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }

    // Previous button indicator (if not showing first page)
    if (startPage > 1) {
        const ellipsis = document.createElement('span');
        ellipsis.textContent = '...';
        ellipsis.style.padding = '0 5px';
        pageNumbers.appendChild(ellipsis);
    }

    for (let i = startPage; i <= endPage; i++) {
        const pageBtn = document.createElement('button');
        pageBtn.className = `page-number ${i === currentPageNum ? 'active' : ''}`;
        pageBtn.textContent = i;
        pageBtn.dataset.page = i;
        pageBtn.addEventListener('click', () => goToPage(i));
        pageNumbers.appendChild(pageBtn);
    }

    // Next button indicator (if not showing last page)
    if (endPage < totalPages) {
        const ellipsis = document.createElement('span');
        ellipsis.textContent = '...';
        ellipsis.style.padding = '0 5px';
        pageNumbers.appendChild(ellipsis);
    }
}

function goToPage(page) {
    currentPage = page;
    // If we're in search mode, use searchProducts, otherwise use loadProducts
    if (currentSearchQuery) {
        searchProducts(page);
    } else {
        loadProducts(page);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function nextPage() {
    // Use API pagination data if available
    let totalPages = 0;
    if (currentPagination && currentPagination.totalPages !== undefined) {
        totalPages = currentPagination.totalPages;
    } else {
        // Fallback: calculate from filtered products length
        totalPages = Math.ceil(filteredProducts.length / productsPerPage);
    }
    
    if (currentPage < totalPages) {
        goToPage(currentPage + 1);
    }
}

function prevPage() {
    if (currentPage > 1) {
        goToPage(currentPage - 1);
    }
}

function updateProductCount(count = null) {
    const productCountElement = document.getElementById('productCount');
    if (!productCountElement) return;
    
    // Use provided count, or currentPagination total, or fallback to filteredProducts length
    let totalCount = count;
    
    if (totalCount === null || totalCount === undefined) {
        // Try to get from currentPagination
        if (currentPagination && currentPagination.totalProducts !== undefined) {
            totalCount = currentPagination.totalProducts;
        } else {
            // Fallback to filteredProducts length
            totalCount = filteredProducts.length;
        }
    }
    
    productCountElement.textContent = totalCount;
}

function updateFilterChipCount() {
    const chipBtn = document.getElementById('filterToggleBtn');
    const chipCount = document.getElementById('filterChipCount');
    if (!chipBtn || !chipCount || !filterManager || !filterManager.filters) return;

    const f = filterManager.filters;
    const count = (f.brands ? f.brands.length : 0) +
        (f.straps ? f.straps.length : 0) +
        (f.ratings ? f.ratings.length : 0) +
        (f.gender && f.gender !== 'all' ? 1 : 0) +
        (f.lowStock ? 1 : 0) +
        ((f.minPrice > 0 || (f.maxPrice > 0 && f.maxPrice < 10000)) ? 1 : 0);

    chipCount.textContent = count;
    chipBtn.classList.toggle('has-active-filters', count > 0);
}

function updateActiveFilters() {
    updateFilterChipCount();

    const activeFilters = document.getElementById('activeFilters');
    if (!activeFilters) return;

    const currentFilters = filterManager ? filterManager.filters : {};
    const currentGender = currentFilters.gender || 'all';

    // Define category chips for gender
    const genderCategories = [
        { value: 'all', label: 'All' },
        { value: 'men', label: "Men's" },
        { value: 'women', label: "Women" },
        { value: 'unisex', label: 'Unisex' },
        { value: 'accessories', label: 'Accessories' },
        { value: 'gift picks', label: 'Gift Picks' }
    ];

    // Clear existing content
    activeFilters.innerHTML = '';

    genderCategories.forEach(cat => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'category-chip';
        if (cat.value === currentGender) {
            chip.classList.add('active');
        }
        chip.textContent = cat.label;

        chip.addEventListener('click', () => {
            const genderInput = document.querySelector(`input[name="gender"][value="${cat.value}"]`);
            if (genderInput) {
                genderInput.checked = true;
            }

            if (filterManager && typeof filterManager.applyFilters === 'function') {
                filterManager.applyFilters();
            }
        });

        activeFilters.appendChild(chip);
    });
}

function removeFilter(type, value) {
    switch (type) {
        case 'brand':
            const brandInput = document.querySelector(`input[name="brand"][value="${value}"]`);
            if (brandInput) brandInput.checked = false;
            break;
        case 'gender':
            const allGenderInput = document.querySelector('input[name="gender"][value="all"]');
            if (allGenderInput) allGenderInput.checked = true;
            break;
        case 'strap':
            const strapInput = document.querySelector(`input[name="strap"][value="${value}"]`);
            if (strapInput) strapInput.checked = false;
            break;
        case 'rating':
            const ratingInput = document.querySelector(`input[name="rating"][value="${value}"]`);
            if (ratingInput) ratingInput.checked = false;
            break;
        case 'stock':
            if (value === 'in-stock') {
                const stockOnlyInput = document.querySelector('input[name="stock"][value="in-stock"]');
                if (stockOnlyInput) stockOnlyInput.checked = false;
            } else if (value === 'low-stock') {
                const lowStockInput = document.querySelector('input[name="stock"][value="low-stock"]');
                if (lowStockInput) lowStockInput.checked = false;
            }
            break;
        case 'price':
            const priceMin = document.getElementById('priceMin');
            const priceMax = document.getElementById('priceMax');
            if (priceMin) priceMin.value = 0;
            if (priceMax) priceMax.value = 10000;
            break;
        case 'search':
            const searchInput = document.getElementById('searchInput');
            if (searchInput) searchInput.value = '';
            break;
    }
    // Apply filters immediately when removing a filter tag (user explicitly removed it)
    applyFilters();
}

function clearAllFilters() {
    // Reset filterManager filters to defaults
    filterManager.filters = {
        brands: [],
        gender: 'all',
        straps: [],
        ratings: [],
        stockOnly: true,
        lowStock: false,
        minPrice: 0,
        maxPrice: 10000,
        search: '',
        sort: 'latest'
    };

    // Apply filters to DOM
    filterManager.applyFiltersToDOM();

    // Apply filters and update URL
    filterManager.applyFilters();
}

function openFilterDrawer() {
    const sidebar = document.getElementById('filterSidebar');
    const backdrop = document.getElementById('filterBackdrop');
    const toggleBtn = document.getElementById('filterToggleBtn');
    if (!sidebar) return;
    sidebar.classList.add('active');
    sidebar.setAttribute('aria-hidden', 'false');
    if (backdrop) backdrop.classList.add('active');
    document.body.classList.add('filters-open');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
}

function closeFilterDrawer() {
    const sidebar = document.getElementById('filterSidebar');
    const backdrop = document.getElementById('filterBackdrop');
    const toggleBtn = document.getElementById('filterToggleBtn');
    if (!sidebar) return;
    sidebar.classList.remove('active');
    sidebar.setAttribute('aria-hidden', 'true');
    if (backdrop) backdrop.classList.remove('active');
    document.body.classList.remove('filters-open');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
}

function toggleFilterDrawer() {
    const sidebar = document.getElementById('filterSidebar');
    if (sidebar && sidebar.classList.contains('active')) {
        closeFilterDrawer();
    } else {
        openFilterDrawer();
    }
}

// Debounced search function
const debouncedSearch = debounce(() => {
    // Use the same search logic as the search button
    searchProducts();
}, 300);

// Product search using dedicated search API endpoint
async function searchProducts(page = null) {
    const searchInput = document.getElementById('searchInput');
    const searchQuery = (searchInput?.value || '').trim();

    // If no search query, fall back to standard filter-based loading
    if (!searchQuery) {
        currentSearchQuery = null; // Clear search query
        filterManager.applyFilters();
        return;
    }

    // Store current search query for pagination
    currentSearchQuery = searchQuery;

    // Optional page override (e.g., when pagination explicitly passes a page)
    if (page !== null) {
        currentPage = page;
    } else {
        // Reset to first page when starting a new search
        currentPage = 1;
    }

    const productGrid = document.getElementById('productGrid');

    // Show loading spinner
    showLoadingSpinner(true);

    try {
        const { fetchWithRetry } = window;
        // ✅ Use dedicated search endpoint for product search with pagination
        const apiUrl = `/api/products/search?q=${encodeURIComponent(searchQuery)}&page=${currentPage}&limit=${productsPerPage}`;

        let response;
        if (fetchWithRetry) {
            response = await fetchWithRetry(apiUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            }, 3);
        } else {
            console.warn('[Shop] fetchWithRetry not available, using regular fetch for search');
            response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        }

        if (!response.ok) {
            // Create more specific error based on status code
            let errorMessage = `HTTP error! status: ${response.status}`;
            if (response.status === 404) {
                errorMessage = 'Search endpoint not found (404). Please refresh the page.';
            } else if (response.status === 500) {
                errorMessage = 'Server error (500). The server encountered an issue. Please try again in a moment.';
            } else if (response.status === 503) {
                errorMessage = 'Service unavailable (503). The server is temporarily down. Please try again later.';
            } else if (response.status === 429) {
                errorMessage = 'Too many requests (429). Please wait a moment before trying again.';
            } else if (response.status >= 400 && response.status < 500) {
                errorMessage = `Client error (${response.status}). Please check your search query and try again.`;
            } else if (response.status >= 500) {
                errorMessage = `Server error (${response.status}). Please try again later.`;
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();

        if (data.success && data.products && data.products.length > 0) {
            filteredProducts = data.products;
            // Store pagination data
            currentPagination = data.pagination || null;
            // Update currentPage from API pagination if available
            if (currentPagination && currentPagination.currentPage) {
                currentPage = currentPagination.currentPage;
            }
            renderProductsFromAPI(data.products);
            updatePagination(currentPagination);
            updateProductCount(currentPagination ? currentPagination.totalProducts : data.count || data.products.length);
            updateActiveFilters(); // Update active filters display
            // Hide loading spinner
            showLoadingSpinner(false);
        } else {
            // No products found
            const hasActiveFilters = hasFiltersApplied();
            if (hasActiveFilters) {
                showNoProductsMessage('No products found matching your search query.', true);
            } else {
                // No filters active - do not show global "no products" error,
                // keep any server-rendered products visible.
            }
            // Store pagination data even when no products (for count display)
            currentPagination = data.pagination || null;
            updatePagination(currentPagination);
            updateActiveFilters(); // Update active filters display even when no products
            // Update product count (will show 0 when no products)
            if (currentPagination && currentPagination.totalProducts !== undefined) {
                updateProductCount(currentPagination.totalProducts);
            } else {
                updateProductCount(0);
            }
            // Hide loading spinner
            showLoadingSpinner(false);
        }
    } catch (error) {
        console.error('[Shop] Error searching products:', error);
        
        // Determine error type and create user-friendly message
        let errorMessage = 'Unable to search products. Please try again later.';
        if (error.message && error.message.includes('Failed to fetch')) {
            errorMessage = 'Network error: Unable to connect to the server. Please check your internet connection.';
        } else if (error.message && error.message.includes('404')) {
            errorMessage = 'Search endpoint not found. Please refresh the page.';
        } else if (error.message && error.message.includes('500')) {
            errorMessage = 'Server error: The server encountered an issue. Please try again in a moment.';
        } else if (error.message && error.message.includes('timeout')) {
            errorMessage = 'Request timed out. The server is taking too long to respond.';
        }
        
        // Show error message with retry functionality
        showNoProductsMessage(errorMessage, false, true, () => {
            // Retry function - retry search
            searchProducts();
        });
        // Hide loading spinner on error
        showLoadingSpinner(false);
    }
}

// applyPriceFilter removed - now using single Apply Filters button at bottom

// ====================================
// LAZY LOADING ENHANCEMENT
// ====================================

// Enhanced lazy loading with IntersectionObserver
function initLazyLoading() {
    // Check if IntersectionObserver is supported
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;

                    // Add loaded class when image loads
                    if (img.complete) {
                        img.classList.add('loaded');
                    } else {
                        img.addEventListener('load', () => {
                            img.classList.add('loaded');
                        });

                        img.addEventListener('error', () => {
                            // Fallback to placeholder on error
                            img.src = '/images/placeholder.jpg';
                            img.classList.add('loaded');
                        });
                    }

                    observer.unobserve(img);
                }
            });
        }, {
            rootMargin: '50px' // Start loading 50px before image enters viewport
        });

        // Observe all lazy-loaded images
        document.querySelectorAll('img[loading="lazy"]').forEach(img => {
            imageObserver.observe(img);
        });
    } else {
        // Fallback for browsers without IntersectionObserver
        document.querySelectorAll('img[loading="lazy"]').forEach(img => {
            img.addEventListener('load', () => {
                img.classList.add('loaded');
            });
        });
    }
}

// Initialize lazy loading when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLazyLoading);
} else {
    initLazyLoading();
}



function getStarRating(rating) {
    let stars = '';
    for (let i = 0; i < 5; i++) {
        if (rating >= i + 1) {
            stars += '<i class="fas fa-star text-warning"></i>';
        } else if (rating > i) {
            stars += '<i class="fas fa-star-half-alt text-warning"></i>';
        } else {
            stars += '<i class="far fa-star text-warning"></i>';
        }
    }
    return stars;
}
