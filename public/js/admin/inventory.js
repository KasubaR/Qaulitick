// Admin Inventory Management JavaScript

let currentPage = 1;
let totalPages = 1;
let currentProductId = null;
let currentFilters = {};
let currentSortBy = 'stock-asc';

document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication before initializing
    const isAuthenticated = await window.AuthUtils?.initializeAuthCheck();
    if (!isAuthenticated) {
        return; // Redirect will happen in initializeAuthCheck
    }
    
    initializeInventoryPage();
    setupEventListeners();
    loadInventory();
    loadInventoryStats();
    loadBrands();
});

// Initialize inventory page
function initializeInventoryPage() {
    setupSidebar();
    setupActionMenu();
    setupPagination();
}

// Setup event listeners
function setupEventListeners() {
    // Sidebar toggle
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', toggleSidebar);
    }

    // Search
    const searchBtn = document.getElementById('searchBtn');
    if (searchBtn) {
        searchBtn.addEventListener('click', handleSearch);
    }

    const inventorySearch = document.getElementById('inventorySearch');
    if (inventorySearch) {
        inventorySearch.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleSearch();
            }
        });
    }

    // Filters
    const filterInputs = document.querySelectorAll('.filter-select');
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

    // Update stock modal
    setupUpdateStockModal();

    // Export button
    const exportBtn = document.getElementById('exportInventoryBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', handleExport);
    }
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

// Setup update stock modal
function setupUpdateStockModal() {
    const closeModal = document.getElementById('closeUpdateStockModal');
    const cancelBtn = document.getElementById('cancelUpdateStockBtn');
    const confirmBtn = document.getElementById('confirmUpdateStockBtn');
    const modal = document.getElementById('updateStockModal');
    const adjustmentType = document.getElementById('adjustmentType');
    const stockAdjustment = document.getElementById('stockAdjustment');

    if (closeModal) {
        closeModal.addEventListener('click', () => closeUpdateStockModal());
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => closeUpdateStockModal());
    }

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeUpdateStockModal();
            }
        });
    }

    if (adjustmentType) {
        adjustmentType.addEventListener('change', updateAdjustmentLabel);
    }

    if (stockAdjustment) {
        stockAdjustment.addEventListener('input', updateStockPreview);
    }

    if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
            await handleUpdateStock();
        });
    }
}

// Update adjustment label based on type
function updateAdjustmentLabel() {
    const adjustmentType = document.getElementById('adjustmentType').value;
    const label = document.getElementById('adjustmentLabel');
    const input = document.getElementById('stockAdjustment');

    if (adjustmentType === 'set') {
        label.textContent = 'New Stock Quantity';
        input.placeholder = 'Enter new stock quantity';
    } else if (adjustmentType === 'add') {
        label.textContent = 'Quantity to Add';
        input.placeholder = 'Enter quantity to add';
    } else if (adjustmentType === 'subtract') {
        label.textContent = 'Quantity to Subtract';
        input.placeholder = 'Enter quantity to subtract';
    }

    updateStockPreview();
}

// Update stock preview
function updateStockPreview() {
    const currentStock = parseInt(document.getElementById('currentStock').value) || 0;
    const adjustmentType = document.getElementById('adjustmentType').value;
    const adjustment = parseInt(document.getElementById('stockAdjustment').value) || 0;

    let newStock = currentStock;

    if (adjustmentType === 'set') {
        newStock = adjustment;
    } else if (adjustmentType === 'add') {
        newStock = currentStock + adjustment;
    } else if (adjustmentType === 'subtract') {
        newStock = Math.max(0, currentStock - adjustment);
    }

    document.getElementById('previewCurrent').textContent = currentStock;
    document.getElementById('previewAdjustment').textContent = adjustmentType === 'set' ? adjustment : (adjustmentType === 'add' ? `+${adjustment}` : `-${adjustment}`);
    document.getElementById('previewNew').textContent = newStock;
}

// Handle search
async function handleSearch() {
    const searchTerm = document.getElementById('inventorySearch').value.trim();
    currentFilters.search = searchTerm || undefined;
    currentPage = 1;
    await loadInventory();
}

// Handle filter
async function handleFilter() {
    const stockStatus = document.getElementById('filterStockStatus')?.value || '';
    const category = document.getElementById('filterCategory')?.value || '';
    const brand = document.getElementById('filterBrand')?.value || '';
    
    currentFilters.stockStatus = stockStatus || undefined;
    currentFilters.category = category || undefined;
    currentFilters.brand = brand || undefined;
    
    currentPage = 1;
    await loadInventory();
}

// Handle sort
async function handleSort() {
    const sortBy = document.getElementById('sortBy').value;
    currentSortBy = sortBy;
    currentPage = 1;
    await loadInventory();
}

// Clear filters
async function clearFilters() {
    document.getElementById('inventorySearch').value = '';
    const filterStockStatus = document.getElementById('filterStockStatus');
    const filterCategory = document.getElementById('filterCategory');
    const filterBrand = document.getElementById('filterBrand');
    const sortBy = document.getElementById('sortBy');
    
    if (filterStockStatus) filterStockStatus.value = '';
    if (filterCategory) filterCategory.value = '';
    if (filterBrand) filterBrand.value = '';
    if (sortBy) sortBy.value = 'stock-asc';
    
    currentFilters = {};
    currentSortBy = 'stock-asc';
    currentPage = 1;
    await loadInventory();
}

// Open update stock modal
function openUpdateStockModal(productId, productName, currentStock) {
    currentProductId = productId;
    const modal = document.getElementById('updateStockModal');
    
    if (!modal) return;
    
    document.getElementById('updateStockProductName').textContent = productName;
    document.getElementById('currentStock').value = currentStock;
    document.getElementById('stockAdjustment').value = '';
    document.getElementById('stockAdjustmentReason').value = '';
    document.getElementById('adjustmentType').value = 'set';
    
    updateAdjustmentLabel();
    updateStockPreview();
    
    modal.style.display = 'flex';
}

// Close update stock modal
function closeUpdateStockModal() {
    const modal = document.getElementById('updateStockModal');
    if (modal) {
        modal.style.display = 'none';
    }
    currentProductId = null;
}

// Handle update stock
async function handleUpdateStock() {
    if (!currentProductId) {
        showNotification('No product selected', 'error');
        return;
    }
    
    const adjustmentType = document.getElementById('adjustmentType').value;
    const adjustment = parseInt(document.getElementById('stockAdjustment').value);
    const reason = document.getElementById('stockAdjustmentReason').value.trim();
    
    if (isNaN(adjustment) || adjustment < 0) {
        showNotification('Please enter a valid quantity', 'error');
        return;
    }
    
    // Validate adjustment for 'set' type
    if (adjustmentType === 'set' && adjustment < 0) {
        showNotification('Stock quantity cannot be negative', 'error');
        return;
    }
    
    const confirmBtn = document.getElementById('confirmUpdateStockBtn');
    const originalText = confirmBtn ? confirmBtn.innerHTML : '';
    
    try {
        // Show loading state
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
        }
        
        await AdminInventoryAPI.updateStock(currentProductId, adjustmentType, adjustment, reason);
        
        showNotification('Stock updated successfully', 'success');
        closeUpdateStockModal();
        
        // Reload inventory and stats
        await Promise.all([
            loadInventory(),
            loadInventoryStats()
        ]);
    } catch (error) {
        console.error('Error updating stock:', error);
        showNotification(error.message || 'Failed to update stock', 'error');
    } finally {
        // Reset button state
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = originalText;
        }
    }
}

// Load inventory from API
async function loadInventory() {
    try {
        const tbody = document.getElementById('inventoryTableBody');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" class="empty-state">
                        <i class="fas fa-spinner fa-spin"></i>
                        <p>Loading inventory...</p>
                    </td>
                </tr>
            `;
        }
        
        const filters = {
            ...currentFilters,
            sortBy: currentSortBy
        };
        
        const pagination = {
            page: currentPage,
            limit: 10
        };
        
        const result = await AdminInventoryAPI.loadInventory(filters, pagination);
        
        renderInventory(result.products);
        updateInventoryCount(result.pagination.totalCount || 0);
        updatePagination(result.pagination);
    } catch (error) {
        console.error('Error loading inventory:', error);
        showNotification(error.message || 'Failed to load inventory', 'error');
        renderInventory([]);
    }
}

// Load inventory statistics
async function loadInventoryStats() {
    try {
        const stats = await AdminInventoryAPI.getInventoryStats();
        updateInventoryStats(stats);
    } catch (error) {
        console.error('Error loading inventory stats:', error);
        // Don't show error notification for stats, just log it
    }
}

// Load brands for filter dropdown
async function loadBrands() {
    try {
        const brands = await AdminInventoryAPI.getBrands();
        const brandSelect = document.getElementById('filterBrand');
        
        if (brandSelect && brands.length > 0) {
            // Clear existing options except "All Brands"
            const allBrandsOption = brandSelect.querySelector('option[value=""]');
            brandSelect.innerHTML = '';
            if (allBrandsOption) {
                brandSelect.appendChild(allBrandsOption);
            }
            
            // Add brand options
            brands.forEach(brand => {
                const option = document.createElement('option');
                option.value = brand;
                option.textContent = brand;
                brandSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading brands:', error);
        // Don't show error notification, just log it
    }
}

// Render inventory table
function renderInventory(products) {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;
    
    if (products.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="empty-state">
                    <i class="fas fa-warehouse"></i>
                    <p>No products found</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = products.map(product => {
        const stockStatus = getStockStatus(product.stock || 0, product.lowStockThreshold || 5);
        const totalValue = product.totalValue || ((product.stock || 0) * (product.price || 0));
        const productId = product._id || product.id;
        const safeModel = escapeHtml(product.model || 'N/A');
        const imageUrl = (product.images && product.images[0]) ? escapeHtml(product.images[0]) : '/images/placeholder.jpg';
        
        return `
        <tr>
            <td>
                <img src="${imageUrl}" alt="${safeModel}" class="product-thumbnail" onerror="this.src='/images/placeholder.jpg'">
            </td>
            <td>
                <div class="product-info">
                    <div class="product-name">${safeModel}</div>
                    <div class="product-sku">SKU: ${escapeHtml(product.sku || 'N/A')}</div>
                </div>
            </td>
            <td>${escapeHtml(product.sku || 'N/A')}</td>
            <td>${escapeHtml(product.brand || 'N/A')}</td>
            <td>
                <span class="stock-quantity ${stockStatus.class}">${product.stock || 0}</span>
            </td>
            <td>${product.lowStockThreshold || 5}</td>
            <td>
                <span class="stock-status-badge ${stockStatus.class}">
                    ${stockStatus.label}
                </span>
            </td>
            <td>K${formatCurrency(product.price || 0)}</td>
            <td>K${formatCurrency(totalValue)}</td>
            <td>
                <div class="action-menu-container">
                    <button class="action-menu-btn" data-product-id="${productId}">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                    <div class="action-menu-dropdown" id="inventoryActionMenu-${productId}">
                        <button class="action-menu-item" data-action="update-stock" data-product-id="${productId}" data-product-name="${safeModel}" data-current-stock="${product.stock || 0}">
                            <i class="fas fa-edit"></i>
                            <span>Update Stock</span>
                        </button>
                        <button class="action-menu-item" data-action="view" data-product-id="${productId}">
                            <i class="fas fa-eye"></i>
                            <span>View Product</span>
                        </button>
                    </div>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

// Get stock status
function getStockStatus(stock, threshold = 5) {
    if (stock === 0) {
        return { class: 'out-of-stock', label: 'Out of Stock' };
    } else if (stock <= threshold) {
        return { class: 'low-stock', label: 'Low Stock' };
    } else {
        return { class: 'in-stock', label: 'In Stock' };
    }
}

// Update inventory statistics
function updateInventoryStats(stats) {
    if (!stats) return;
    
    const totalProducts = document.getElementById('totalProducts');
    const inStockCount = document.getElementById('inStockCount');
    const lowStockCount = document.getElementById('lowStockCount');
    const outOfStockCount = document.getElementById('outOfStockCount');
    const totalValue = document.getElementById('totalValue');
    
    if (totalProducts) totalProducts.textContent = stats.totalProducts || 0;
    if (inStockCount) inStockCount.textContent = stats.inStock || 0;
    if (lowStockCount) lowStockCount.textContent = stats.lowStock || 0;
    if (outOfStockCount) outOfStockCount.textContent = stats.outOfStock || 0;
    if (totalValue) totalValue.textContent = `K${formatCurrency(stats.totalValue || 0)}`;
}

// Update inventory count
function updateInventoryCount(count) {
    const countEl = document.getElementById('inventoryCount');
    if (countEl) {
        countEl.textContent = count || 0;
    }
}

// Update pagination controls
function updatePagination(pagination) {
    if (!pagination) return;
    
    currentPage = pagination.currentPage || 1;
    totalPages = pagination.totalPages || 1;
    
    const prevPage = document.getElementById('prevPage');
    const nextPage = document.getElementById('nextPage');
    const pageNumbers = document.getElementById('pageNumbers');
    
    if (prevPage) {
        prevPage.disabled = !pagination.hasPreviousPage;
    }
    
    if (nextPage) {
        nextPage.disabled = !pagination.hasNextPage;
    }
    
    if (pageNumbers) {
        // Generate page numbers (show max 5 pages)
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, currentPage + 2);
        
        // Adjust if we're near the start or end
        if (endPage - startPage < 4) {
            if (startPage === 1) {
                endPage = Math.min(totalPages, startPage + 4);
            } else if (endPage === totalPages) {
                startPage = Math.max(1, endPage - 4);
            }
        }
        
        let pageHtml = '';
        
        // First page
        if (startPage > 1) {
            pageHtml += `<span class="page-number" data-page="1">1</span>`;
            if (startPage > 2) {
                pageHtml += `<span class="page-ellipsis">...</span>`;
            }
        }
        
        // Page range
        for (let i = startPage; i <= endPage; i++) {
            pageHtml += `<span class="page-number ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</span>`;
        }
        
        // Last page
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                pageHtml += `<span class="page-ellipsis">...</span>`;
            }
            pageHtml += `<span class="page-number" data-page="${totalPages}">${totalPages}</span>`;
        }
        
        pageNumbers.innerHTML = pageHtml;
        
        // Add click listeners to page numbers
        pageNumbers.querySelectorAll('.page-number').forEach(pageEl => {
            pageEl.addEventListener('click', () => {
                const page = parseInt(pageEl.getAttribute('data-page'));
                if (page !== currentPage && page >= 1 && page <= totalPages) {
                    currentPage = page;
                    loadInventory();
                }
            });
        });
    }
}

// Setup pagination event listeners
function setupPagination() {
    const prevPage = document.getElementById('prevPage');
    const nextPage = document.getElementById('nextPage');
    
    if (prevPage) {
        prevPage.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                loadInventory();
            }
        });
    }
    
    if (nextPage) {
        nextPage.addEventListener('click', () => {
            if (currentPage < totalPages) {
                currentPage++;
                loadInventory();
            }
        });
    }
}

// Setup action menu event delegation
function setupActionMenu() {
    const inventoryTable = document.getElementById('inventoryTable');
    if (!inventoryTable) return;
    
    inventoryTable.addEventListener('click', (e) => {
        // Handle menu button clicks
        const menuBtn = e.target.closest('.action-menu-btn');
        if (menuBtn) {
            e.preventDefault();
            e.stopPropagation();
            
            const productId = menuBtn.getAttribute('data-product-id');
            const menuId = `inventoryActionMenu-${productId}`;
            const dropdown = document.getElementById(menuId);
            
            if (!dropdown) return;
            
            // Close all other menus
            document.querySelectorAll('.action-menu-dropdown').forEach(menu => {
                if (menu.id !== menuId) {
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
            
            if (!action || !productId) return;
            
            switch (action) {
                case 'update-stock':
                    const productName = menuItem.getAttribute('data-product-name');
                    const currentStock = parseInt(menuItem.getAttribute('data-current-stock')) || 0;
                    openUpdateStockModal(productId, productName, currentStock);
                    break;
                case 'view':
                    viewProduct(productId);
                    break;
            }
            
            // Close the menu
            const dropdown = menuItem.closest('.action-menu-dropdown');
            if (dropdown) {
                dropdown.style.display = 'none';
            }
            return;
        }
    });
    
    // Close menus when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.action-menu-container')) {
            document.querySelectorAll('.action-menu-dropdown').forEach(menu => {
                menu.style.display = 'none';
            });
        }
    });
}

// Handle export
async function handleExport() {
    try {
        // Show format selection
        const format = confirm('Export as CSV? (Cancel for JSON)') ? 'csv' : 'json';
        
        const exportBtn = document.getElementById('exportInventoryBtn');
        if (exportBtn) {
            exportBtn.disabled = true;
            exportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';
        }
        
        const filters = {
            ...currentFilters,
            sortBy: currentSortBy
        };
        
        await AdminInventoryAPI.exportInventory(format, filters);
        
        showNotification(`Successfully exported inventory to ${format.toUpperCase()}`, 'success');
        
        if (exportBtn) {
            exportBtn.disabled = false;
            exportBtn.innerHTML = '<i class="fas fa-download"></i> Export';
        }
    } catch (error) {
        console.error('Error exporting inventory:', error);
        showNotification(error.message || 'Failed to export inventory', 'error');
        
        const exportBtn = document.getElementById('exportInventoryBtn');
        if (exportBtn) {
            exportBtn.disabled = false;
            exportBtn.innerHTML = '<i class="fas fa-download"></i> Export';
        }
    }
}

// Utility functions
function formatCurrency(amount) {
    return parseFloat(amount || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Action functions
function viewProduct(productId) {
    // Navigate to product details or open modal
    window.location.href = `/admin/products?view=${productId}`;
}

// Show notification
function showNotification(message, type = 'info') {
    // Create notification element if it doesn't exist
    let notification = document.getElementById('inventoryNotification');
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'inventoryNotification';
        notification.className = 'inventory-notification';
        document.body.appendChild(notification);
    }
    
    // Set notification content and type
    notification.textContent = message;
    notification.className = `inventory-notification inventory-notification-${type}`;
    notification.style.display = 'block';
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        notification.style.display = 'none';
    }, 3000);
}

// Make functions globally available
window.openUpdateStockModal = openUpdateStockModal;
window.viewProduct = viewProduct;

