// Admin Products Management JavaScript

// TODO: Implement authentication check

let currentPage = 1;
let totalPages = 1;
let currentProductId = null;
let currentFilters = {};
let currentSearchTerm = '';

document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication before initializing
    const isAuthenticated = await window.AuthUtils?.initializeAuthCheck();
    if (!isAuthenticated) {
        return; // Redirect will happen in initializeAuthCheck
    }
    
    initializeProductsPage();
    setupEventListeners();
    
    // Load products from server-side data or API
    if (window.initialProducts && window.initialProducts.length > 0) {
        renderProducts(window.initialProducts);
        updateProductsCount(window.initialProducts.length);
        // Initialize pagination UI (will be updated when loading from API)
        renderPagination({
            currentPage: 1,
            totalPages: 1,
            totalProducts: window.initialProducts.length,
            hasNextPage: false,
            hasPrevPage: false
        });
    } else {
        // Load products from API with pagination
        loadProducts({}, 1, false);
    }
});

// Initialize products page
function initializeProductsPage() {
    setupSidebar();
    setupImageUpload();
    setupColorInputs();
    setupTabs();
    setupSKUGeneration();
    setupSlugGeneration();
}

// Setup event listeners
function setupEventListeners() {
    // Clear validation errors when user starts typing
    setupValidationErrorClearing();
    
    // Sidebar toggle
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', toggleSidebar);
    }

    // Add product button
    const addProductBtn = document.getElementById('addProductBtn');
    if (addProductBtn) {
        addProductBtn.addEventListener('click', () => openProductModal());
    }

    // Search
    const searchBtn = document.getElementById('searchBtn');
    if (searchBtn) {
        searchBtn.addEventListener('click', handleSearch);
    }

    const productSearch = document.getElementById('productSearch');
    if (productSearch) {
        productSearch.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleSearch();
            }
        });
    }

    // Filters
    const filterInputs = document.querySelectorAll('.filter-select, .price-input');
    filterInputs.forEach(input => {
        input.addEventListener('change', handleFilter);
    });

    // Sort
    const sortBy = document.getElementById('sortBy');
    if (sortBy) {
        sortBy.addEventListener('change', handleSort);
    }

    // Clear filters
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', clearFilters);
    }

    // Pagination
    setupPagination();

    // Modal
    setupModal();

    // Form submission
    const productForm = document.getElementById('productForm');
    if (productForm) {
        productForm.addEventListener('submit', handleFormSubmit);
    }

    // Bulk operations
    setupBulkOperations();

    // Event delegation for action menu items (view, edit, delete, duplicate)
    const productsTable = document.getElementById('productsTable');
    if (productsTable) {
        productsTable.addEventListener('click', (e) => {
            // Handle menu button clicks
            const menuBtn = e.target.closest('.action-menu-btn');
            if (menuBtn) {
                e.preventDefault();
                e.stopPropagation();
                
                const productId = menuBtn.getAttribute('data-product-id');
                const dropdown = document.getElementById(`productActionMenu-${productId}`);
                
                if (!dropdown) return;
                
                // Close all other menus
                document.querySelectorAll('.action-menu-dropdown').forEach(menu => {
                    if (menu.id !== dropdown.id) {
                        menu.style.display = 'none';
                    }
                });
                
                // Toggle current menu
                dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
                return;
            }
            
            // Handle menu item clicks
            const menuItem = e.target.closest('.action-menu-item');
            if (menuItem) {
                e.preventDefault();
                e.stopPropagation();
                
                const action = menuItem.getAttribute('data-action');
                const productId = menuItem.getAttribute('data-product-id');
                const productName = menuItem.getAttribute('data-product-name') || 'this product';
            
                if (!action || !productId) {
                    console.warn('Missing action or productId:', { action, productId });
                    return;
                }
                
                // Close the menu
                const dropdown = menuItem.closest('.action-menu-dropdown');
                if (dropdown) {
                    dropdown.style.display = 'none';
                }
                
                console.log('Menu item clicked:', { action, productId, productName });

            switch (action) {
                case 'view':
                        if (typeof viewProduct === 'function') {
                    viewProduct(productId);
                        } else {
                            console.error('viewProduct function not found');
                        }
                    break;
                case 'edit':
                        if (typeof editProduct === 'function') {
                    editProduct(productId);
                        } else {
                            console.error('editProduct function not found');
                        }
                    break;
                case 'duplicate':
                        if (typeof duplicateProduct === 'function') {
                    duplicateProduct(productId);
                        } else {
                            console.error('duplicateProduct function not found');
                        }
                    break;
                case 'delete':
                        if (typeof confirmDelete === 'function') {
                    confirmDelete(productId, productName);
                        } else {
                            console.error('confirmDelete function not found');
                        }
                    break;
                    default:
                        console.warn('Unknown action:', action);
                }
                return;
            }
        });
    }
    
    // Close menus when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.action-menu-container')) {
            document.querySelectorAll('.action-menu-dropdown').forEach(menu => {
                menu.style.display = 'none';
            });
        }
    });
}

// Setup sidebar
function setupSidebar() {
    const currentPath = window.location.pathname;
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        if (item.getAttribute('href') === currentPath) {
            item.classList.add('active');
        }
    });
}

// Toggle sidebar (mobile)
function toggleSidebar() {
    const sidebar = document.querySelector('.admin-sidebar');
    sidebar.classList.toggle('active');
}

// Image upload & preview functions have been moved to admin-products.images.js

// Setup color inputs
function setupColorInputs() {
    const addColorBtn = document.getElementById('addColorBtn');
    if (addColorBtn) {
        addColorBtn.addEventListener('click', addColorInput);
    }
}

// Setup SKU auto-generation
function setupSKUGeneration() {
    const brandInput = document.getElementById('brand');
    const modelInput = document.getElementById('model');
    const skuInput = document.getElementById('sku');
    const generateSkuBtn = document.getElementById('generateSkuBtn');
    
    // Auto-generate SKU when brand or model changes (if SKU is empty)
    if (brandInput && modelInput && skuInput) {
        const generateSKU = () => {
            const brand = brandInput.value.trim();
            const model = modelInput.value.trim();
            
            if (brand && model && !skuInput.value.trim()) {
                generateSKUFromBrandModel(brand, model);
            }
        };
        
        // Debounce to avoid too many API calls
        let skuTimeout;
        const debouncedGenerate = () => {
            clearTimeout(skuTimeout);
            skuTimeout = setTimeout(generateSKU, 500);
        };
        
        brandInput.addEventListener('input', debouncedGenerate);
        modelInput.addEventListener('input', debouncedGenerate);
    }
    
    // Manual generate button
    if (generateSkuBtn) {
        generateSkuBtn.addEventListener('click', () => {
            const brand = document.getElementById('brand')?.value.trim();
            const model = document.getElementById('model')?.value.trim();
            
            if (!brand || !model) {
                showNotification('Please enter brand and model first', 'warning');
                return;
            }
            
            generateSKUFromBrandModel(brand, model);
        });
    }
}

// Track if slug was manually edited
let slugManuallyEdited = false;
let lastAutoGeneratedSlug = '';

// Setup slug auto-generation
function setupSlugGeneration() {
    const modelInput = document.getElementById('model');
    const slugInput = document.getElementById('slug');
    
    if (!modelInput || !slugInput) return;
    
    // Track manual edits
    slugInput.addEventListener('input', () => {
        // If user is editing and the value differs from last auto-generated, mark as manually edited
        if (slugInput.value !== lastAutoGeneratedSlug) {
            slugManuallyEdited = true;
        }
    });
    
    slugInput.addEventListener('focus', () => {
        // When user focuses on slug field, they might want to edit it
        // Don't mark as manually edited yet, only on actual change
    });
    
    // Auto-generate slug when model changes (only if slug is empty or was auto-generated)
    let slugTimeout;
    modelInput.addEventListener('input', () => {
        clearTimeout(slugTimeout);
        slugTimeout = setTimeout(() => {
            generateSlugFromModel();
        }, 300); // Debounce for 300ms
    });
}

/**
 * Generate slug from model name
 */
function generateSlugFromModel() {
    const modelInput = document.getElementById('model');
    const slugInput = document.getElementById('slug');
    
    if (!modelInput || !slugInput) return;
    
    const model = modelInput.value.trim();
    
    // Only auto-generate if:
    // 1. Model has value
    // 2. Slug is empty OR slug was previously auto-generated (not manually edited)
    if (!model) {
        return;
    }
    
    // If slug was manually edited, don't auto-update
    if (slugManuallyEdited && slugInput.value.trim() !== lastAutoGeneratedSlug) {
        return;
    }
    
    // Generate slug
    const slug = generateSlug(model);
    
    if (slug) {
        slugInput.value = slug;
        lastAutoGeneratedSlug = slug;
        slugManuallyEdited = false;
    }
}

/**
 * Generate URL-friendly slug from text
 * @param {string} text - Text to convert to slug
 * @returns {string} Generated slug
 */
function generateSlug(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    // Convert to lowercase
    let slug = text.toLowerCase();
    
    // Remove accents/diacritics (basic approach)
    slug = slug.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
    // Replace spaces and underscores with hyphens
    slug = slug.replace(/[\s_]+/g, '-');
    
    // Remove special characters, keep only alphanumeric and hyphens
    slug = slug.replace(/[^a-z0-9\-]/gi, '-');
    
    // Replace multiple consecutive hyphens with single hyphen
    slug = slug.replace(/-+/g, '-');
    
    // Remove leading and trailing hyphens
    slug = slug.replace(/^-+|-+$/g, '');
    
    // Limit length to 100 characters
    if (slug.length > 100) {
        slug = slug.substring(0, 100);
        // Remove trailing hyphen if truncated
        slug = slug.replace(/-+$/, '');
    }
    
    return slug;
}

// Generate SKU from brand and model
async function generateSKUFromBrandModel(brand, model) {
    const skuInput = document.getElementById('sku');
    if (!skuInput) return;
    
    try {
        // Show loading state
        const generateBtn = document.getElementById('generateSkuBtn');
        if (generateBtn) {
            generateBtn.disabled = true;
            generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }
        
        // Call API to generate SKU
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
        const response = await fetch('/api/products/generate-sku', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({ brand, model })
        });
        
        const result = await response.json();
        
        if (response.ok && result.success && result.sku) {
            skuInput.value = result.sku;
            showNotification('SKU generated successfully!', 'success');
        } else {
            throw new Error(result.message || 'Failed to generate SKU');
        }
    } catch (error) {
        console.error('Error generating SKU:', error);
        showNotification('Error generating SKU: ' + error.message, 'error');
    } finally {
        const generateBtn = document.getElementById('generateSkuBtn');
        if (generateBtn) {
            generateBtn.disabled = false;
            generateBtn.innerHTML = '<i class="fas fa-magic"></i> Generate';
        }
    }
}

// Add color input
function addColorInput() {
    const container = document.getElementById('colorsContainer');
    if (!container) return;
    
    const colorGroup = document.createElement('div');
    colorGroup.className = 'color-input-group';
    colorGroup.innerHTML = `
        <input type="color" class="color-picker" value="#ffffff">
        <input type="text" class="color-name-input" placeholder="Color name">
        <button type="button" class="remove-color-btn" onclick="removeColor(this)">
            <i class="fas fa-times"></i>
        </button>
    `;
    container.appendChild(colorGroup);
}

// Remove color
function removeColor(btn) {
    btn.closest('.color-input-group').remove();
}

// Collect colors from form
function collectColors() {
    const colorsContainer = document.getElementById('colorsContainer');
    if (!colorsContainer) return [];
    
    const colorGroups = colorsContainer.querySelectorAll('.color-input-group');
    const colors = [];
    
    colorGroups.forEach(group => {
        const colorPicker = group.querySelector('.color-picker');
        const colorNameInput = group.querySelector('.color-name-input');
        
        if (colorPicker && colorNameInput) {
            const hex = colorPicker.value;
            const name = colorNameInput.value.trim();
            
            if (hex || name) {
                colors.push({
                    hex: hex || '#ffffff',
                    name: name || ''
                });
            }
        }
    });
    
    return colors;
}

// Setup tabs
function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');
    const prevStepBtn = document.getElementById('prevStepBtn');
    const nextStepBtn = document.getElementById('nextStepBtn');
    const saveProductBtn = document.getElementById('saveProductBtn');

    if (!tabBtns.length || !tabPanes.length) {
        return;
    }

    let currentStepIndex = 0;

    function updateStep(index) {
        if (index < 0 || index >= tabBtns.length) {
            return;
        }

        currentStepIndex = index;
            
        // Update active tab button and pane
        tabBtns.forEach((btn, i) => {
            btn.classList.toggle('active', i === index);
            const targetTab = btn.dataset.tab;
            const pane = document.getElementById(targetTab + 'Tab');
            if (pane) {
                pane.classList.toggle('active', i === index);
            }
        });

        const isFirst = index === 0;
        const isLast = index === tabBtns.length - 1;

        // Previous button: hidden on first step
        if (prevStepBtn) {
            prevStepBtn.style.display = isFirst ? 'none' : 'inline-flex';
        }

        // Next button: hidden on last step
        if (nextStepBtn) {
            nextStepBtn.style.display = isLast ? 'none' : 'inline-flex';
        }

        // Save button: only visible on last step
        if (saveProductBtn) {
            saveProductBtn.style.display = isLast ? 'inline-flex' : 'none';
        }
    }

    // Initial state (first tab)
    updateStep(0);

    // Click on tab headers
    tabBtns.forEach((btn, index) => {
        btn.addEventListener('click', () => {
            updateStep(index);
        });
    });
    
    // Previous / Next buttons
    if (prevStepBtn) {
        prevStepBtn.addEventListener('click', () => {
            updateStep(currentStepIndex - 1);
        });
    }
    
    if (nextStepBtn) {
        nextStepBtn.addEventListener('click', () => {
            updateStep(currentStepIndex + 1);
        });
    }
}


// Setup modal
function setupModal() {
    const closeModal = document.getElementById('closeModal');
    const cancelBtn = document.getElementById('cancelBtn');
    const modal = document.getElementById('productModal');
    
    if (closeModal) {
        closeModal.addEventListener('click', () => closeProductModal());
    }
    
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => closeProductModal());
    }
    
    // Delete modal
    setupDeleteModal();
}

// Setup delete modal
function setupDeleteModal() {
    const closeDeleteModal = document.getElementById('closeDeleteModal');
    const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    const deleteModal = document.getElementById('deleteModal');
    
    if (closeDeleteModal) {
        closeDeleteModal.addEventListener('click', () => {
            if (deleteModal) deleteModal.style.display = 'none';
        });
    }
    
    if (cancelDeleteBtn) {
        cancelDeleteBtn.addEventListener('click', () => {
            if (deleteModal) deleteModal.style.display = 'none';
        });
    }
    
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async () => {
            await deleteProduct(currentProductId);
        });
    }
    
    // Close on outside click
    if (deleteModal) {
        deleteModal.addEventListener('click', (e) => {
            if (e.target === deleteModal) {
                deleteModal.style.display = 'none';
            }
        });
    }
}

// Open product modal
async function openProductModal(productId = null) {
    const modal = document.getElementById('productModal');
    const modalTitle = document.getElementById('modalTitle');
    const form = document.getElementById('productForm');
    
    if (!modal) return;
    
    currentProductId = productId;
    
    if (productId) {
        modalTitle.textContent = 'Edit Product';
        // Show loading state
        modalTitle.textContent = 'Loading Product...';
        try {
            await loadProductData(productId);
            modalTitle.textContent = 'Edit Product';
        } catch (error) {
            console.error('Error loading product data:', error);
            showNotification('Error loading product: ' + error.message, 'error');
            closeProductModal();
            return;
        }
    } else {
        modalTitle.textContent = 'Add New Product';
        form.reset();
        // Clear image previews
        const previewGrid = document.getElementById('imagePreviewGrid');
        if (previewGrid) previewGrid.innerHTML = '';
        // Clear colors
        const colorsContainer = document.getElementById('colorsContainer');
        if (colorsContainer) colorsContainer.innerHTML = '';
        // Reset status checkbox to checked
        const statusCheckbox = document.getElementById('status');
        if (statusCheckbox) statusCheckbox.checked = true;
        // Reset slug auto-generation state for new product
        slugManuallyEdited = false;
        lastAutoGeneratedSlug = '';
    }
    
    modal.style.display = 'flex';
}

// Load product data into form
async function loadProductData(productId) {
    try {
        // Fetch product data
        const product = await AdminProductsAPI.getProductById(productId);
        
        if (!product) {
            throw new Error('Product not found');
        }
        
        // Populate basic info fields
        const modelInput = document.getElementById('model');
        const brandInput = document.getElementById('brand');
        const categoryInput = document.getElementById('category');
        const skuInput = document.getElementById('sku');
        const descriptionInput = document.getElementById('description');
        const warrantyInput = document.getElementById('warranty');
        const waterResistanceInput = document.getElementById('waterResistance');
        const strapTypeInput = document.getElementById('strapType');
        
        if (modelInput) modelInput.value = product.model || '';
        if (brandInput) brandInput.value = product.brand || '';
        if (categoryInput) {
            // Map gender to category (gender: "Men" -> category: "men")
            const gender = product.gender || '';
            categoryInput.value = gender.toLowerCase() || '';
        }
        if (skuInput) skuInput.value = product.sku || '';
        if (descriptionInput) descriptionInput.value = product.description || '';
        if (warrantyInput) warrantyInput.value = product.warranty || '';
        if (waterResistanceInput) waterResistanceInput.value = product.waterResistance || '';
        if (strapTypeInput) strapTypeInput.value = product.strapType || '';
        
        // Populate pricing & inventory fields
        const priceInput = document.getElementById('price');
        const originalPriceInput = document.getElementById('originalPrice');
        const discountInput = document.getElementById('discount');
        const stockInput = document.getElementById('stock');
        const lowStockThresholdInput = document.getElementById('lowStockThreshold');
        
        if (priceInput) priceInput.value = product.price || 0;
        if (originalPriceInput) originalPriceInput.value = product.originalPrice || '';
        if (discountInput) discountInput.value = product.discount || 0;
        if (stockInput) stockInput.value = product.stock || 0;
        if (lowStockThresholdInput) lowStockThresholdInput.value = product.lowStockThreshold || 5;
        
        // Populate SEO fields
        const metaTitleInput = document.getElementById('metaTitle');
        const metaDescriptionInput = document.getElementById('metaDescription');
        const slugInput = document.getElementById('slug');
        
        if (metaTitleInput) metaTitleInput.value = product.metaTitle || '';
        if (metaDescriptionInput) metaDescriptionInput.value = product.metaDescription || '';
        if (slugInput) {
            slugInput.value = product.slug || '';
            // Reset slug auto-generation state when loading existing product
            slugManuallyEdited = false; // Reset flag - existing slug is considered manual
            lastAutoGeneratedSlug = product.slug || '';
        }
        
        // Populate video URL
        const videoUrlInput = document.getElementById('videoUrl');
        if (videoUrlInput) videoUrlInput.value = product.videoUrl || '';
        
        // Populate status checkbox
        const statusCheckbox = document.getElementById('status');
        if (statusCheckbox) {
            statusCheckbox.checked = product.status === 'active';
        }
        
        // Populate images using image management module
        // Normalize images: SQLite JSON field can return a string instead of array
        let productImages = product.images;
        if (typeof productImages === 'string') {
            try { productImages = JSON.parse(productImages); } catch (e) { productImages = []; }
        }
        if (!Array.isArray(productImages)) productImages = [];

        if (productImages.length > 0 && window.initializeProductImages) {
            window.initializeProductImages(productImages, productId);
        } else {
        const previewGrid = document.getElementById('imagePreviewGrid');
            if (previewGrid) {
            previewGrid.innerHTML = '';
            }
        }
        
        // Set current product ID for image management
        if (window.setCurrentProductId) {
            window.setCurrentProductId(productId);
        }
        
        // Populate colors (normalize possible formats from DB: array, JSON string, single object)
        const colorsContainer = document.getElementById('colorsContainer');
        if (colorsContainer && product.colors) {
            // Start with the raw value from the product
            let productColors = product.colors;

            // If stored as JSON string in the DB, parse it
            if (typeof productColors === 'string') {
                try {
                    const parsed = JSON.parse(productColors);
                    productColors = parsed;
                } catch (e) {
                    // If parsing fails, fall back to treating the string as a single color name
                    productColors = [{ hex: '#ffffff', name: productColors }];
                }
            }

            // If it's a single object, wrap in an array
            if (productColors && !Array.isArray(productColors) && typeof productColors === 'object') {
                productColors = [productColors];
            }

            // Ensure we have an array at this point
            if (!Array.isArray(productColors)) {
                productColors = [];
            }

            colorsContainer.innerHTML = '';

            productColors.forEach(color => {
                const hexValue = color && (color.hex || color.hexCode) ? (color.hex || color.hexCode) : '#ffffff';
                const nameValue = color && color.name ? color.name : '';

                const colorGroup = document.createElement('div');
                colorGroup.className = 'color-input-group';
                colorGroup.innerHTML = `
                    <input type="color" class="color-picker" value="${hexValue}">
                    <input type="text" class="color-name-input" placeholder="Color name" value="${nameValue}">
                    <button type="button" class="remove-color-btn" onclick="removeColor(this)">
                        <i class="fas fa-times"></i>
                    </button>
                `;
                colorsContainer.appendChild(colorGroup);
            });
        }
        
        // Reset to first tab
        const tabBtns = document.querySelectorAll('.tab-btn');
        if (tabBtns.length > 0) {
            tabBtns[0].click();
        }
        
    } catch (error) {
        console.error('Error loading product data:', error);
        throw error;
    }
}

// Close product modal
function closeProductModal() {
    const modal = document.getElementById('productModal');
    if (modal) {
        modal.style.display = 'none';
    }
    currentProductId = null;
    // Clear validation errors when closing modal
    clearValidationErrors();
    // Reset slug auto-generation state
    slugManuallyEdited = false;
    lastAutoGeneratedSlug = '';
    // Reset image management
    if (window.setCurrentProductId) {
        window.setCurrentProductId(null);
    }
}

/**
 * Setup event listeners to clear validation errors when user starts typing
 */
function setupValidationErrorClearing() {
    const form = document.getElementById('productForm');
    if (!form) return;
    
    // Clear errors on input/change events
    form.addEventListener('input', (e) => {
        if (e.target.classList.contains('error')) {
            e.target.classList.remove('error');
            const errorElement = e.target.parentElement.querySelector('.field-error');
            if (errorElement) {
                errorElement.remove();
            }
        }
    });
    
    form.addEventListener('change', (e) => {
        if (e.target.classList.contains('error')) {
            e.target.classList.remove('error');
            const errorElement = e.target.parentElement.querySelector('.field-error');
            if (errorElement) {
                errorElement.remove();
            }
        }
    });
}

/**
 * Validate product form data
 * @param {object} productData - Product data to validate
 * @returns {object} - Validation result { valid: boolean, errors: array, fieldErrors: object }
 */
function validateForm(productData) {
    const errors = [];
    const fieldErrors = {};
    
    // Validate model (required, min 2 characters)
    if (!productData.model || typeof productData.model !== 'string' || productData.model.trim().length < 2) {
        errors.push('Product model is required (minimum 2 characters)');
        fieldErrors.model = 'Product model is required (minimum 2 characters)';
    } else if (productData.model.trim().length > 200) {
        errors.push('Product model cannot exceed 200 characters');
        fieldErrors.model = 'Product model cannot exceed 200 characters';
    }
    
    // Validate brand (required, min 2 characters)
    if (!productData.brand || typeof productData.brand !== 'string' || productData.brand.trim().length < 2) {
        errors.push('Brand is required (minimum 2 characters)');
        fieldErrors.brand = 'Brand is required (minimum 2 characters)';
    } else if (productData.brand.trim().length > 100) {
        errors.push('Brand name cannot exceed 100 characters');
        fieldErrors.brand = 'Brand name cannot exceed 100 characters';
    }
    
    // Validate category (required)
    const validCategories = ['men', 'women', 'unisex', 'accessories', 'gift picks'];
    if (!productData.category || !validCategories.includes(productData.category.toLowerCase())) {
        errors.push('Category is required');
        fieldErrors.category = 'Please select a valid category';
    }
    
    // Validate SKU (required)
    if (!productData.sku || typeof productData.sku !== 'string' || productData.sku.trim().length === 0) {
        errors.push('SKU is required');
        fieldErrors.sku = 'SKU is required (will be auto-generated if brand and model are provided)';
    }
    
    // Validate description (required, min length)
    if (!productData.description || typeof productData.description !== 'string' || productData.description.trim().length < 10) {
        errors.push('Description is required (minimum 10 characters)');
        fieldErrors.description = 'Description is required (minimum 10 characters)';
    } else if (productData.description.trim().length > 2000) {
        errors.push('Description cannot exceed 2000 characters');
        fieldErrors.description = 'Description cannot exceed 2000 characters';
    }
    
    // Validate price (required, must be positive number)
    if (productData.price === null || productData.price === undefined || isNaN(productData.price)) {
        errors.push('Price is required');
        fieldErrors.price = 'Valid price is required';
    } else if (productData.price < 0) {
        errors.push('Price cannot be negative');
        fieldErrors.price = 'Price cannot be negative';
    }
    
    // Validate original price (if provided, must be >= price)
    if (productData.originalPrice !== null && productData.originalPrice !== undefined) {
        if (isNaN(productData.originalPrice) || productData.originalPrice < 0) {
            errors.push('Original price must be a valid positive number');
            fieldErrors.originalPrice = 'Original price must be a valid positive number';
        } else if (productData.originalPrice <= productData.price) {
            errors.push('Original price must be greater than the current price');
            fieldErrors.originalPrice = 'Original price must be greater than the current price';
        }
    }
    
    // Validate discount (if provided, must be between 0-100)
    if (productData.discount !== null && productData.discount !== undefined) {
        if (isNaN(productData.discount)) {
            errors.push('Discount must be a valid number');
            fieldErrors.discount = 'Discount must be a valid number';
        } else if (productData.discount < 0 || productData.discount > 100) {
            errors.push('Discount must be between 0 and 100');
            fieldErrors.discount = 'Discount must be between 0 and 100';
        }
    }
    
    // Validate stock (required, must be non-negative integer)
    if (productData.stock === null || productData.stock === undefined || isNaN(productData.stock)) {
        errors.push('Stock quantity is required');
        fieldErrors.stock = 'Valid stock quantity is required';
    } else if (!Number.isInteger(productData.stock) || productData.stock < 0) {
        errors.push('Stock must be a non-negative integer');
        fieldErrors.stock = 'Stock must be a non-negative integer';
    }
    
    // Validate low stock threshold (if provided, must be non-negative integer)
    if (productData.lowStockThreshold !== null && productData.lowStockThreshold !== undefined) {
        if (isNaN(productData.lowStockThreshold) || !Number.isInteger(productData.lowStockThreshold) || productData.lowStockThreshold < 0) {
            errors.push('Low stock threshold must be a non-negative integer');
            fieldErrors.lowStockThreshold = 'Low stock threshold must be a non-negative integer';
        }
    }
    
    // Validate images (at least one image required)
    if (!productData.images || !Array.isArray(productData.images) || productData.images.length === 0) {
        errors.push('At least one product image is required');
        fieldErrors.images = 'At least one product image is required';
    } else {
        // Validate image URLs
        productData.images.forEach((image, index) => {
            if (!image || typeof image !== 'string' || image.trim().length === 0) {
                errors.push(`Image ${index + 1} is invalid`);
            }
        });
    }
    
    // Validate video URL (if provided, must be valid URL)
    if (productData.videoUrl && productData.videoUrl.trim().length > 0) {
        try {
            // Allow relative paths or full URLs
            if (!productData.videoUrl.startsWith('/') && !productData.videoUrl.startsWith('http://') && !productData.videoUrl.startsWith('https://')) {
                throw new Error('Invalid URL format');
            }
            if (productData.videoUrl.startsWith('http://') || productData.videoUrl.startsWith('https://')) {
                new URL(productData.videoUrl);
            }
        } catch (error) {
            errors.push('Video URL must be a valid URL');
            fieldErrors.videoUrl = 'Video URL must be a valid URL';
        }
    }
    
    // Validate meta title (if provided, max 60 characters)
    if (productData.metaTitle && productData.metaTitle.trim().length > 60) {
        errors.push('Meta title cannot exceed 60 characters');
        fieldErrors.metaTitle = 'Meta title cannot exceed 60 characters';
    }
    
    // Validate meta description (if provided, max 160 characters)
    if (productData.metaDescription && productData.metaDescription.trim().length > 160) {
        errors.push('Meta description cannot exceed 160 characters');
        fieldErrors.metaDescription = 'Meta description cannot exceed 160 characters';
    }
    
    return {
        valid: errors.length === 0,
        errors: errors,
        fieldErrors: fieldErrors
    };
}

/**
 * Display validation errors near form fields
 * @param {object} fieldErrors - Object mapping field names to error messages
 */
function displayValidationErrors(fieldErrors) {
    // Clear previous errors first
    clearValidationErrors();
    
    // Display errors for each field
    Object.keys(fieldErrors).forEach(fieldName => {
        const field = document.getElementById(fieldName);
        if (field) {
            // Add error class to field
            field.classList.add('error');
            
            // Create or update error message element
            let errorElement = field.parentElement.querySelector('.field-error');
            if (!errorElement) {
                errorElement = document.createElement('span');
                errorElement.className = 'field-error';
                field.parentElement.appendChild(errorElement);
            }
            errorElement.textContent = fieldErrors[fieldName];
            errorElement.style.display = 'block';
        }
    });
    
    // Scroll to first error field
    const firstErrorField = document.querySelector('.form-input.error');
    if (firstErrorField) {
        firstErrorField.scrollIntoView({ behavior: 'smooth', block: 'center' });
        firstErrorField.focus();
    }
}

/**
 * Clear all validation errors from form
 */
function clearValidationErrors() {
    // Remove error classes from all fields
    document.querySelectorAll('.form-input.error').forEach(field => {
        field.classList.remove('error');
    });
    
    // Remove all error message elements
    document.querySelectorAll('.field-error').forEach(errorElement => {
        errorElement.remove();
    });
}

// Handle form submission
async function handleFormSubmit(e) {
    e.preventDefault();
    
    // Clear previous validation errors
    clearValidationErrors();
    
    const formData = new FormData(e.target);
    const productData = {
        model: formData.get('model')?.trim(),
        brand: formData.get('brand')?.trim(),
        category: formData.get('category'),
        sku: formData.get('sku')?.trim(),
        description: formData.get('description')?.trim(),
        warranty: formData.get('warranty')?.trim(),
        waterResistance: formData.get('waterResistance')?.trim(),
        strapType: formData.get('strapType')?.trim(),
        price: parseFloat(formData.get('price')),
        originalPrice: formData.get('originalPrice') ? parseFloat(formData.get('originalPrice')) : null,
        discount: formData.get('discount') ? parseFloat(formData.get('discount')) : 0,
        stock: parseInt(formData.get('stock')),
        lowStockThreshold: parseInt(formData.get('lowStockThreshold')) || 5,
        videoUrl: formData.get('videoUrl')?.trim() || null,
        metaTitle: formData.get('metaTitle')?.trim() || null,
        metaDescription: formData.get('metaDescription')?.trim() || null,
        slug: formData.get('slug')?.trim() || null,
        status: formData.get('status') === 'on'
    };
    
    // Auto-generate SKU if empty and brand/model are available
    const skuInput = document.getElementById('sku');
    if ((!productData.sku || productData.sku.length === 0) && productData.brand && productData.model) {
        try {
            await generateSKUFromBrandModel(productData.brand, productData.model);
            // Read SKU from input field after generation
            productData.sku = skuInput.value.trim();
        } catch (error) {
            console.error('Error auto-generating SKU:', error);
            // Continue - server will try to generate it
        }
    }
    
    // Ensure we use the current SKU value from the input field
    if (skuInput) {
        productData.sku = skuInput.value.trim() || productData.sku;
    }
    
    // Collect images before validation (needed for image validation)
    const previewGrid = document.getElementById('imagePreviewGrid');
    const imagePreviews = previewGrid ? previewGrid.querySelectorAll('.image-preview-item') : [];
    const existingImages = [];
    
    if (imagePreviews.length > 0) {
        imagePreviews.forEach(preview => {
            // data-image-url is the canonical source set by initializeProductImages and
            // the image module — always a server path, never a data URI for saved images.
            const url = preview.getAttribute('data-image-url');
            if (url && !url.startsWith('data:')) {
                existingImages.push(url);
            }
        });
    }
    
    // Temporarily set images for validation (will be updated after upload)
    productData.images = existingImages.length > 0 ? existingImages : ['/images/placeholder.jpg'];
    
    // Validate form data
    const validation = validateForm(productData);
    
    if (!validation.valid) {
        // Display validation errors
        displayValidationErrors(validation.fieldErrors);
        
        // Show general error notification
        showNotification('Please fix the errors in the form before submitting.', 'error');
        return; // Prevent form submission
    }
    
    // Collect colors from form
    const colors = collectColors();
    if (colors.length > 0) {
        productData.colors = colors;
    }
    
    // Collect new File objects from the image module's pending map
    const newFiles = window.getNewFiles ? window.getNewFiles() : [];
    
    // Upload new images if any
    let uploadedImageUrls = [];
    if (newFiles.length > 0) {
        try {
            // Show loading state
            const saveBtn = document.getElementById('saveProductBtn');
            if (saveBtn) {
                saveBtn.disabled = true;
                const originalText = saveBtn.innerHTML;
                saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading Images...';
                
                // Upload images
                uploadedImageUrls = await window.uploadImages(newFiles);
                
                // Restore button
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalText;
            } else {
                uploadedImageUrls = await window.uploadImages(newFiles);
            }
        } catch (error) {
            console.error('Error uploading images:', error);
            // Restore button if it was disabled
            const saveBtn = document.getElementById('saveProductBtn');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Product';
            }
            throw new Error('Failed to upload images: ' + error.message);
        }
    }
    
    // Combine existing and newly uploaded images
    productData.images = [...existingImages, ...uploadedImageUrls];
    
    // If no images at all, use placeholder
    if (productData.images.length === 0) {
        productData.images = ['/images/placeholder.jpg'];
    }
    
    try {
        // Map category to gender field
        if (productData.category) {
            const cat = productData.category.toLowerCase();
            const genderMap = { 'men': 'Men', 'women': 'Women', 'unisex': 'Unisex', 'accessories': 'Accessories', 'gift picks': 'Gift Picks' };
            productData.gender = genderMap[cat] || (productData.category.charAt(0).toUpperCase() + productData.category.slice(1));
            delete productData.category;
        }
        
        // Map status checkbox to status field
        productData.status = productData.status ? 'active' : 'inactive';
        
        // Ensure images array exists
        if (!productData.images || productData.images.length === 0) {
            productData.images = ['/images/placeholder.jpg'];
        }
        
        // Decide whether to create or update
        if (currentProductId) {
            await AdminProductsAPI.updateProduct(currentProductId, productData);
        } else {
            await AdminProductsAPI.createProduct(productData);
        }

        showNotification('Product saved successfully!', 'success');
            closeProductModal();
            // Reset to page 1 and reload products with current filters
            currentPage = 1;
            loadProducts(currentFilters, 1, currentSearchTerm.trim().length > 0);
    } catch (error) {
        console.error('Error saving product:', error);
        showNotification('Error saving product: ' + error.message, 'error');
    }
}

// Handle search
function handleSearch() {
    const searchTerm = document.getElementById('productSearch').value.trim();
    currentSearchTerm = searchTerm;
    
    // Reset to page 1 when searching
    currentPage = 1;
    
    // If there's a search term, use search endpoint
    if (searchTerm) {
        loadProducts({}, 1, true);
    } else {
        // No search term, use filters
        loadProducts(currentFilters, 1, false);
    }
}

// Handle filter
function handleFilter() {
    const category = document.getElementById('filterCategory').value;
    const stock = document.getElementById('filterStock').value;
    const minPrice = document.getElementById('minPrice').value;
    const maxPrice = document.getElementById('maxPrice').value;
    
    // Build filters object for API
    const filters = {};
    
    // Map category (UI: men/women/unisex) to gender (API: Men/Women/Unisex)
    if (category) {
        // Capitalize first letter to match API format
        filters.gender = category.charAt(0).toUpperCase() + category.slice(1);
    }
    
    // Map stock status
    if (stock === 'in-stock') {
        filters.inStockOnly = true;
    } else if (stock === 'low-stock') {
        // Low stock: stock > 0 and stock <= lowStockThreshold
        filters.lowStockOnly = true;
    } else if (stock === 'out-of-stock') {
        // Out of stock: stock === 0
        filters.outOfStockOnly = true;
    }
    
    // Price range
    if (minPrice) {
        filters.minPrice = parseFloat(minPrice);
    }
    if (maxPrice) {
        filters.maxPrice = parseFloat(maxPrice);
    }
    
    // Store current filters
    currentFilters = filters;
    
    // Reset to page 1 when filtering
    currentPage = 1;
    
    // Load products with filters (don't use search if filters are applied)
    if (currentSearchTerm) {
        // If there's a search term, we can't combine it with filters easily
        // So clear search and use filters only
        currentSearchTerm = '';
        document.getElementById('productSearch').value = '';
    }
    
    loadProducts(filters, 1, false);
}

// Handle sort
function handleSort() {
    const sortByValue = document.getElementById('sortBy').value;
    
    // Map UI sort values to API sortBy values
    let apiSortBy = 'newest'; // default
    
    switch (sortByValue) {
        case 'latest':
            apiSortBy = 'newest';
            break;
        case 'price-asc':
            apiSortBy = 'price_asc';
            break;
        case 'price-desc':
            apiSortBy = 'price_desc';
            break;
        case 'stock-asc':
            // Stock sorting not directly supported by API, will need client-side sorting
            // For now, use default sort
            apiSortBy = 'newest';
            break;
        case 'stock-desc':
            // Stock sorting not directly supported by API, will need client-side sorting
            // For now, use default sort
            apiSortBy = 'newest';
            break;
        default:
            apiSortBy = 'newest';
    }
    
    // Add sort to current filters
    currentFilters.sortBy = apiSortBy;
    
    // Reset to page 1 when sorting
    currentPage = 1;
    
    // Load products with updated sort
    loadProducts(currentFilters, 1, false);
}

// Clear filters
function clearFilters() {
    document.getElementById('productSearch').value = '';
    document.getElementById('filterCategory').value = '';
    document.getElementById('filterStock').value = '';
    document.getElementById('minPrice').value = '';
    document.getElementById('maxPrice').value = '';
    document.getElementById('sortBy').value = 'latest';
    
    // Reset filter state
    currentFilters = {};
    currentSearchTerm = '';
    
    // Reset to page 1 and reload products
    currentPage = 1;
    loadProducts({}, 1, false);
}

// Load products from API via AdminProductsAPI (data layer)
async function loadProducts(filters = null, page = null, useSearch = false) {
    try {
        // Use provided filters or current filters
        const filtersToUse = filters !== null ? filters : currentFilters;
        const searchTerm = currentSearchTerm.trim();
        
        // Use provided page or current page
        const pageToLoad = page !== null ? page : currentPage;
        const limit = 12; // Items per page
        
        let result;
        
        // If there's a search term, use search endpoint
        if (useSearch && searchTerm) {
            result = await AdminProductsAPI.searchProducts(searchTerm, pageToLoad, limit);
        } else {
            // Use filters endpoint
            result = await AdminProductsAPI.loadProducts(filtersToUse, pageToLoad, limit);
        }
        
        const { products, pagination } = result;
        
        // Update global pagination state
        currentPage = pagination.currentPage || 1;
        totalPages = pagination.totalPages || 1;
        
        // Render products
        AdminProductsTable.renderProducts(products);
        AdminProductsTable.updateProductsCount(pagination.totalProducts || 0);
        
        // Update bulk action buttons (clear selections when products reload)
        updateBulkActionButtons();
        
        // Update pagination UI
        renderPagination(pagination);
        
    } catch (error) {
        console.error('Error loading products:', error);
        AdminProductsTable.renderProducts([]);
        AdminProductsTable.updateProductsCount(0);
        showNotification('Error loading products: ' + error.message, 'error');
        
        // Reset pagination on error
        renderPagination({
            currentPage: 1,
            totalPages: 0,
            totalProducts: 0,
            hasNextPage: false,
            hasPrevPage: false
        });
    }
}

// Setup pagination event listeners
function setupPagination() {
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');
    
    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                loadProducts(currentFilters, currentPage - 1, currentSearchTerm.trim().length > 0);
                // Scroll to top of products table
                const productsTable = document.getElementById('productsTable');
                if (productsTable) {
                    productsTable.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }
        });
    }
    
    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', () => {
            if (currentPage < totalPages) {
                loadProducts(currentFilters, currentPage + 1, currentSearchTerm.trim().length > 0);
                // Scroll to top of products table
                const productsTable = document.getElementById('productsTable');
                if (productsTable) {
                    productsTable.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }
        });
    }
}

// Render pagination controls
function renderPagination(pagination) {
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');
    const pageNumbers = document.getElementById('pageNumbers');
    
    if (!prevPageBtn || !nextPageBtn || !pageNumbers) {
        return;
    }
    
    const { currentPage: page, totalPages, hasNextPage, hasPrevPage } = pagination;
    
    // Update prev/next button states
    prevPageBtn.disabled = !hasPrevPage;
    nextPageBtn.disabled = !hasNextPage;
    
    // Clear existing page numbers
    pageNumbers.innerHTML = '';
    
    // Don't show pagination if there's only one page or no pages
    if (totalPages <= 1) {
        pageNumbers.innerHTML = '<span class="page-number active">1</span>';
        return;
    }
    
    // Calculate which page numbers to show (max 7 pages)
    let startPage = Math.max(1, page - 3);
    let endPage = Math.min(totalPages, page + 3);
    
    // Adjust if we're near the start or end
    if (endPage - startPage < 6) {
        if (startPage === 1) {
            endPage = Math.min(totalPages, startPage + 6);
        } else if (endPage === totalPages) {
            startPage = Math.max(1, endPage - 6);
        }
    }
    
    // Add first page and ellipsis if needed
    if (startPage > 1) {
        const firstPage = document.createElement('span');
        firstPage.className = 'page-number';
        firstPage.textContent = '1';
        firstPage.addEventListener('click', () => loadProducts(currentFilters, 1, currentSearchTerm.trim().length > 0));
        pageNumbers.appendChild(firstPage);
        
        if (startPage > 2) {
            const ellipsis = document.createElement('span');
            ellipsis.className = 'page-ellipsis';
            ellipsis.textContent = '...';
            pageNumbers.appendChild(ellipsis);
        }
    }
    
    // Add page numbers
    for (let i = startPage; i <= endPage; i++) {
        const pageNumber = document.createElement('span');
        pageNumber.className = 'page-number';
        if (i === page) {
            pageNumber.classList.add('active');
        }
        pageNumber.textContent = i.toString();
        pageNumber.addEventListener('click', () => {
            if (i !== page) {
                loadProducts(currentFilters, i, currentSearchTerm.trim().length > 0);
                // Scroll to top of products table
                const productsTable = document.getElementById('productsTable');
                if (productsTable) {
                    productsTable.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }
        });
        pageNumbers.appendChild(pageNumber);
    }
    
    // Add last page and ellipsis if needed
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            const ellipsis = document.createElement('span');
            ellipsis.className = 'page-ellipsis';
            ellipsis.textContent = '...';
            pageNumbers.appendChild(ellipsis);
        }
        
        const lastPage = document.createElement('span');
        lastPage.className = 'page-number';
        lastPage.textContent = totalPages.toString();
        lastPage.addEventListener('click', () => loadProducts(currentFilters, totalPages, currentSearchTerm.trim().length > 0));
        pageNumbers.appendChild(lastPage);
    }
}


// View product
function viewProduct(productId) {
    window.location.href = `/product/${productId}`;
}

// Edit product
function editProduct(productId) {
    openProductModal(productId);
}

// Duplicate product
async function duplicateProduct(productId) {
    if (!productId) {
        console.error('No product ID provided for duplication');
        showNotification('Error: Product ID is required', 'error');
        return;
    }
    
    try {
        // Show loading notification
        showNotification('Loading product data...', 'info');
        
        // Fetch the original product data
        const originalProduct = await AdminProductsAPI.getProductById(productId);
        
        if (!originalProduct) {
            throw new Error('Product not found');
        }
        
        // Create a copy of the product data (excluding MongoDB-specific fields)
        const productCopy = {
            model: (originalProduct.model || '') + ' (Copy)',
            brand: originalProduct.brand || '',
            category: originalProduct.gender ? originalProduct.gender.toLowerCase() : '',
            description: originalProduct.description || '',
            warranty: originalProduct.warranty || '',
            waterResistance: originalProduct.waterResistance || '',
            strapType: originalProduct.strapType || '',
            price: originalProduct.price || originalProduct.originalPrice || 0,
            originalPrice: originalProduct.originalPrice || null,
            discount: originalProduct.discount || 0,
            stock: originalProduct.stock || 0,
            lowStockThreshold: originalProduct.lowStockThreshold || 5,
            videoUrl: originalProduct.videoUrl || null,
            metaTitle: originalProduct.metaTitle || null,
            metaDescription: originalProduct.metaDescription || null,
            slug: null, // Will be auto-generated or user can set it
            status: originalProduct.status === 'active',
            images: originalProduct.images ? [...originalProduct.images] : [],
            colors: originalProduct.colors ? [...originalProduct.colors] : []
        };
        
        // Generate a new SKU for the duplicate
        // Try to generate SKU from brand and model (without the " (Copy)" suffix)
        const baseModel = originalProduct.model || '';
        if (productCopy.brand && baseModel) {
            try {
                const skuResponse = await fetch('/api/products/generate-sku', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
                    },
                    body: JSON.stringify({
                        brand: productCopy.brand,
                        model: baseModel
                    })
                });
                
                const skuResult = await skuResponse.json();
                if (skuResponse.ok && skuResult.success && skuResult.sku) {
                    productCopy.sku = skuResult.sku;
                } else {
                    // Fallback: append "-COPY" to original SKU
                    productCopy.sku = (originalProduct.sku || '') + '-COPY';
                }
            } catch (error) {
                console.error('Error generating SKU for duplicate:', error);
                // Fallback: append "-COPY" to original SKU
                productCopy.sku = (originalProduct.sku || '') + '-COPY';
            }
        } else {
            // Fallback: append "-COPY" to original SKU
            productCopy.sku = (originalProduct.sku || '') + '-COPY';
        }
        
        // Open modal in create mode (no productId)
        currentProductId = null;
        const modal = document.getElementById('productModal');
        const modalTitle = document.getElementById('modalTitle');
        
        if (!modal) {
            throw new Error('Product modal not found');
        }
        
        modalTitle.textContent = 'Duplicate Product';
        
        // Populate form fields with the copied data
        const modelInput = document.getElementById('model');
        const brandInput = document.getElementById('brand');
        const categoryInput = document.getElementById('category');
        const skuInput = document.getElementById('sku');
        const descriptionInput = document.getElementById('description');
        const warrantyInput = document.getElementById('warranty');
        const waterResistanceInput = document.getElementById('waterResistance');
        const strapTypeInput = document.getElementById('strapType');
        
        if (modelInput) modelInput.value = productCopy.model;
        if (brandInput) brandInput.value = productCopy.brand;
        if (categoryInput) categoryInput.value = productCopy.category;
        if (skuInput) skuInput.value = productCopy.sku;
        if (descriptionInput) descriptionInput.value = productCopy.description;
        if (warrantyInput) warrantyInput.value = productCopy.warranty;
        if (waterResistanceInput) waterResistanceInput.value = productCopy.waterResistance;
        if (strapTypeInput) strapTypeInput.value = productCopy.strapType;
        
        // Populate pricing & inventory fields
        const priceInput = document.getElementById('price');
        const originalPriceInput = document.getElementById('originalPrice');
        const discountInput = document.getElementById('discount');
        const stockInput = document.getElementById('stock');
        const lowStockThresholdInput = document.getElementById('lowStockThreshold');
        
        if (priceInput) priceInput.value = productCopy.price;
        if (originalPriceInput) originalPriceInput.value = productCopy.originalPrice || '';
        if (discountInput) discountInput.value = productCopy.discount;
        if (stockInput) stockInput.value = productCopy.stock;
        if (lowStockThresholdInput) lowStockThresholdInput.value = productCopy.lowStockThreshold;
        
        // Populate SEO fields
        const metaTitleInput = document.getElementById('metaTitle');
        const metaDescriptionInput = document.getElementById('metaDescription');
        const slugInput = document.getElementById('slug');
        
        if (metaTitleInput) metaTitleInput.value = productCopy.metaTitle || '';
        if (metaDescriptionInput) metaDescriptionInput.value = productCopy.metaDescription || '';
        if (slugInput) slugInput.value = productCopy.slug || '';
        
        // Populate video URL
        const videoUrlInput = document.getElementById('videoUrl');
        if (videoUrlInput) videoUrlInput.value = productCopy.videoUrl || '';
        
        // Populate status checkbox
        const statusCheckbox = document.getElementById('status');
        if (statusCheckbox) {
            statusCheckbox.checked = productCopy.status;
        }
        
        // Populate images — use the same initializer as the edit flow so every item
        // gets data-image-url, draggable, drag handlers, and primary badge correctly.
        // Pass null as the product ID: this is a new product, so drag-reorder must not
        // fire server API calls before the duplicate is saved.
        if (window.initializeProductImages) {
            window.initializeProductImages(productCopy.images || [], null);
        }
        
        // Populate colors
        const colorsContainer = document.getElementById('colorsContainer');
        if (colorsContainer) {
            colorsContainer.innerHTML = '';
            if (productCopy.colors && productCopy.colors.length > 0) {
                productCopy.colors.forEach(color => {
                    const colorGroup = document.createElement('div');
                    colorGroup.className = 'color-input-group';
                    // Note: The color object might have 'hex' or 'hexCode' property
                    const hexValue = color.hex || color.hexCode || '#ffffff';
                    colorGroup.innerHTML = `
                        <input type="color" class="color-picker" value="${hexValue}">
                        <input type="text" class="color-name-input" placeholder="Color name" value="${color.name || ''}">
                        <button type="button" class="remove-color-btn" onclick="removeColor(this)">
                            <i class="fas fa-times"></i>
                        </button>
                    `;
                    colorsContainer.appendChild(colorGroup);
                });
            }
        }
        
        // Reset to first tab
        const tabBtns = document.querySelectorAll('.tab-btn');
        if (tabBtns.length > 0) {
            tabBtns[0].click();
        }
        
        // Open the modal
        modal.style.display = 'flex';
        
        showNotification('Product duplicated! Review and save to create the new product.', 'success');
        
    } catch (error) {
        console.error('Error duplicating product:', error);
        showNotification('Error duplicating product: ' + error.message, 'error');
    }
}

// Confirm delete
function confirmDelete(productId, productName) {
    console.log('confirmDelete called with:', productId, productName);
    if (!productId) {
        console.error('No product ID provided');
        return;
    }
    
    currentProductId = productId;
    const deleteProductNameEl = document.getElementById('deleteProductName');
    if (deleteProductNameEl) {
        // Use textContent to prevent XSS
        deleteProductNameEl.textContent = productName || 'this product';
    } else {
        console.error('deleteProductName element not found');
    }
    
    const deleteModal = document.getElementById('deleteModal');
    if (deleteModal) {
        deleteModal.style.display = 'flex';
        console.log('Delete modal opened');
    } else {
        console.error('Delete modal element not found');
    }
}

// Delete product via API
async function deleteProduct(productId) {
    console.log('deleteProduct called with ID:', productId);
    if (!productId) {
        console.error('No product ID provided to deleteProduct');
        return;
    }
    
    try {
        // Show loading state
        const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        if (!confirmDeleteBtn) {
            console.error('Confirm delete button not found');
            return;
        }
        
        const originalText = confirmDeleteBtn.innerHTML;
        confirmDeleteBtn.disabled = true;
        confirmDeleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
        
        console.log('Deleting product via AdminProductsAPI:', productId);

        await AdminProductsAPI.deleteProduct(productId);

        // Close delete modal
        const deleteModal = document.getElementById('deleteModal');
        if (deleteModal) {
            deleteModal.style.display = 'none';
        }
        
        // Remove product from current list (optimistic update)
        removeProductFromList(productId);
        
        // Show success message
        showNotification('Product deleted successfully!', 'success');
        
        // Reload products list from API using current filters/search
        // Ensures we always render from fresh DB data, not initial SSR state
        currentPage = 1;
        loadProducts(currentFilters, currentPage, currentSearchTerm && currentSearchTerm.trim().length > 0);
    } catch (error) {
        console.error('Error deleting product:', error);
        showNotification('Error deleting product: ' + error.message, 'error');
        
        // Reset button state
        const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        if (confirmDeleteBtn) {
            confirmDeleteBtn.disabled = false;
            confirmDeleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete Product';
        }
    }
}

// Remove product from list (optimistic update)
function removeProductFromList(productId) {
    const tbody = document.getElementById('productsTableBody');
    if (!tbody) return;
    
    // Find and remove the product row using action button data-product-id
    const rows = tbody.querySelectorAll('tr');
    rows.forEach(row => {
        const actionButton = row.querySelector(`button[data-product-id="${productId}"]`);
        if (actionButton) {
            row.remove();
            
            // Update products count
            const remainingProducts = tbody.querySelectorAll('tr').length;
            AdminProductsTable.updateProductsCount(remainingProducts);
            
            // If no products left, show empty state
            if (remainingProducts === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="9" class="empty-state">
                            <i class="fas fa-box-open"></i>
                            <p>No products found</p>
                        </td>
                    </tr>
                `;
            }
        }
    });
}

// Show notification
function showNotification(message, type = 'info') {
    // Remove existing notifications
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
            <span>${message}</span>
        </div>
        <button class="notification-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    // Add to page
    document.body.appendChild(notification);
    
    // Show notification
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 300);
    }, 5000);
}


// ============================================
// Bulk Operations
// ============================================

/**
 * Setup bulk operations event listeners
 */
function setupBulkOperations() {
    // Select all checkbox
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', selectAllProducts);
    }

    // Bulk action buttons
    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
    if (bulkDeleteBtn) {
        bulkDeleteBtn.addEventListener('click', handleBulkDelete);
    }

    const bulkExportBtn = document.getElementById('bulkExportBtn');
    if (bulkExportBtn) {
        bulkExportBtn.addEventListener('click', handleExportProducts);
    }

    // Individual product checkboxes (event delegation)
    const productsTable = document.getElementById('productsTable');
    if (productsTable) {
        productsTable.addEventListener('change', (e) => {
            if (e.target.classList.contains('product-checkbox')) {
                updateBulkActionButtons();
            }
        });
    }
}

/**
 * Select/Deselect all products
 */
function selectAllProducts() {
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const productCheckboxes = document.querySelectorAll('.product-checkbox');
    
    if (!selectAllCheckbox) return;
    
    const isChecked = selectAllCheckbox.checked;
    
    productCheckboxes.forEach(checkbox => {
        checkbox.checked = isChecked;
    });
    
    updateBulkActionButtons();
}

/**
 * Get selected product IDs
 * @returns {Array<string>} Array of selected product IDs
 */
function getSelectedProductIds() {
    const checkboxes = document.querySelectorAll('.product-checkbox:checked');
    return Array.from(checkboxes).map(cb => cb.getAttribute('data-product-id'));
}

/**
 * Update bulk action buttons visibility and state
 */
function updateBulkActionButtons() {
    const selectedIds = getSelectedProductIds();
    const bulkActions = document.getElementById('bulkActions');
    const bulkSelectionCount = document.getElementById('bulkSelectionCount');
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    
    if (!bulkActions || !bulkSelectionCount) return;
    
    if (selectedIds.length > 0) {
        bulkActions.style.display = 'flex';
        bulkSelectionCount.textContent = `${selectedIds.length} selected`;
    } else {
        bulkActions.style.display = 'none';
    }
    
    // Update select all checkbox state
    if (selectAllCheckbox) {
        const allCheckboxes = document.querySelectorAll('.product-checkbox');
        const checkedCount = document.querySelectorAll('.product-checkbox:checked').length;
        selectAllCheckbox.checked = allCheckboxes.length > 0 && checkedCount === allCheckboxes.length;
        selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < allCheckboxes.length;
    }
}

/**
 * Handle bulk delete
 */
async function handleBulkDelete() {
    const selectedIds = getSelectedProductIds();
    
    if (selectedIds.length === 0) {
        showNotification('Please select at least one product to delete', 'error');
        return;
    }
    
    // Confirm deletion
    const confirmed = confirm(`Are you sure you want to delete ${selectedIds.length} product(s)? This action cannot be undone.`);
    if (!confirmed) return;
    
    try {
        // Show loading state
        const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
        if (bulkDeleteBtn) {
            bulkDeleteBtn.disabled = true;
            bulkDeleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
        }
        
        // Call API
        const response = await fetch('/api/products/bulk', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
            },
            body: JSON.stringify({ productIds: selectedIds })
        });
        
        const data = await response.json();
        
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Failed to delete products');
        }
        
        // Show success message
        showNotification(`Successfully deleted ${data.data.deletedCount} product(s)`, 'success');
        
        // Clear selections
        document.querySelectorAll('.product-checkbox').forEach(cb => cb.checked = false);
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        if (selectAllCheckbox) selectAllCheckbox.checked = false;
        updateBulkActionButtons();
        
        // Reload products
        loadProducts(currentFilters, currentPage, currentSearchTerm.trim().length > 0);
        
    } catch (error) {
        console.error('[Products] Error in bulk delete:', error);
        showNotification(error.message || 'Failed to delete products', 'error');
    } finally {
        // Reset button state
        const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
        if (bulkDeleteBtn) {
            bulkDeleteBtn.disabled = false;
            bulkDeleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete';
        }
    }
}

/**
 * Handle export products
 */
async function handleExportProducts() {
    const selectedIds = getSelectedProductIds();
    
    // Ask for format
    const format = confirm('Export as CSV?\n\nClick OK for CSV, Cancel for JSON') ? 'csv' : 'json';
    
    try {
        // Show loading state
        const bulkExportBtn = document.getElementById('bulkExportBtn');
        if (bulkExportBtn) {
            bulkExportBtn.disabled = true;
            bulkExportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';
        }
        
        // Build query string with current filters
        const queryParams = new URLSearchParams();
        queryParams.append('format', format);
        
        // Add current filters if they exist
        if (currentSearchTerm && currentSearchTerm.trim()) {
            queryParams.append('search', currentSearchTerm.trim());
        }
        if (currentFilters.category) {
            queryParams.append('category', currentFilters.category);
        }
        if (currentFilters.stockStatus) {
            queryParams.append('stockStatus', currentFilters.stockStatus);
        }
        if (currentFilters.minPrice) {
            queryParams.append('minPrice', currentFilters.minPrice);
        }
        if (currentFilters.maxPrice) {
            queryParams.append('maxPrice', currentFilters.maxPrice);
        }
        
        // If specific products are selected, we could filter on the backend
        // For now, export all products matching current filters
        // Note: The backend doesn't support filtering by specific IDs yet
        
        const url = `/api/products/export?${queryParams.toString()}`;
        
        // Trigger download
        const response = await fetch(url);
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'Failed to export products');
        }
        
        // Get filename from Content-Disposition header or generate one
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = `products_export_${new Date().toISOString().split('T')[0]}.${format}`;
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename="?(.+)"?/);
            if (filenameMatch) {
                filename = filenameMatch[1];
            }
        }
        
        // Get blob and create download link
        const blob = await response.blob();
        const url_blob = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url_blob;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url_blob);
        
        showNotification(`Products exported successfully as ${format.toUpperCase()}`, 'success');
        
    } catch (error) {
        console.error('[Products] Error in export:', error);
        showNotification(error.message || 'Failed to export products', 'error');
    } finally {
        // Reset button state
        const bulkExportBtn = document.getElementById('bulkExportBtn');
        if (bulkExportBtn) {
            bulkExportBtn.disabled = false;
            bulkExportBtn.innerHTML = '<i class="fas fa-download"></i> Export';
        }
    }
}

// Utility functions
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Product action menu functions
function toggleProductActionMenu(productId) {
    // Close all other menus first
    document.querySelectorAll('.action-menu-dropdown').forEach(menu => {
        if (menu.id !== `productActionMenu-${productId}`) {
            menu.style.display = 'none';
        }
    });
    
    const menu = document.getElementById(`productActionMenu-${productId}`);
    if (menu) {
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    }
}

function closeProductActionMenu(productId) {
    const menu = document.getElementById(`productActionMenu-${productId}`);
    if (menu) {
        menu.style.display = 'none';
    }
}

// Make functions globally available
window.removeImage = removeImage;
window.removeColor = removeColor;
window.viewProduct = viewProduct;
window.editProduct = editProduct;
window.duplicateProduct = duplicateProduct;
window.confirmDelete = confirmDelete;
window.toggleProductActionMenu = toggleProductActionMenu;
window.closeProductActionMenu = closeProductActionMenu;

