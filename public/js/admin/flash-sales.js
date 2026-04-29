(function () {
    'use strict';

    // Simple debounce utility for search input
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

    const tableBody = document.getElementById('flashSalesTableBody');
    const statusFilter = document.getElementById('statusFilter');
    const modal = document.getElementById('flashSaleModal');
    const modalTitle = document.getElementById('modalTitle');
    const form = document.getElementById('flashSaleForm');
    const flashSaleIdInput = document.getElementById('flashSaleId');
    const productSearchInput = document.getElementById('productSearch');
    const productList = document.getElementById('productList');

    let flashSales = [];
    let selectedProductIds = new Set();

    async function loadFlashSales() {
        if (!tableBody) return;
        
        // Show loading state
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="fs-state-cell">
                    <div class="fs-loading-state">
                        <div class="fs-spinner"></div>
                        <span>Loading flash sales…</span>
                    </div>
                </td>
            </tr>
        `;

        try {
            const response = await fetch('/api/admin/marketing/flash-sales');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.success && Array.isArray(data.flashSales)) {
                flashSales = data.flashSales;
                renderFlashSalesTable();
            } else {
                flashSales = [];
                renderFlashSalesTable();
            }
        } catch (error) {
            console.error('[Admin Flash Sales] Error loading flash sales:', error);
            if (tableBody) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="7" class="fs-state-cell">
                            <div class="fs-empty-state" style="color: var(--error);">
                                <i class="fas fa-exclamation-triangle"></i>
                                <h3>Failed to load flash sales</h3>
                                <p>${escapeHtml(error.message || 'An error occurred while loading flash sales.')}</p>
                                <button class="btn-primary" onclick="loadFlashSales()" style="margin-top: 8px;">
                                    <i class="fas fa-redo"></i> Retry
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }
        }
    }

    function renderFlashSalesTable() {
        if (!tableBody) return;

        tableBody.innerHTML = '';

        const filterValue = statusFilter ? statusFilter.value : 'all';
        const filteredSales = flashSales.filter(sale => {
            if (filterValue === 'all') return true;
            return getComputedStatus(sale) === filterValue;
        });

        // Update stat counters
        const counts = { active: 0, scheduled: 0, ended: 0 };
        flashSales.forEach(sale => {
            const s = getComputedStatus(sale);
            if (counts[s] !== undefined) counts[s]++;
        });
        const statActive    = document.getElementById('statActive');
        const statScheduled = document.getElementById('statScheduled');
        const statEnded     = document.getElementById('statEnded');
        if (statActive)    statActive.textContent    = counts.active;
        if (statScheduled) statScheduled.textContent = counts.scheduled;
        if (statEnded)     statEnded.textContent     = counts.ended;

        if (filteredSales.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="fs-state-cell">
                        <div class="fs-empty-state">
                            <i class="fas fa-bolt"></i>
                            <h3>No Flash Sales Found</h3>
                            <p>Create your first flash sale to start promoting products with time-limited discounts.</p>
                            <button class="btn-primary" onclick="openCreateFlashSaleModal()" style="margin-top:8px;">
                                <i class="fas fa-plus"></i> Create Flash Sale
                            </button>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        filteredSales.forEach(sale => {
            const row = document.createElement('tr');
            const id = sale._id || sale.id;
            const productCount = Array.isArray(sale.productIds) ? sale.productIds.length : 0;
            const status = getComputedStatus(sale);
            const statusClass = status.toLowerCase();
            const countdownLabel = getCountdownLabel(sale);
            const countdownClass = status === 'scheduled' ? 'scheduled' : status === 'ended' ? 'ended' : 'active';

            row.innerHTML = `
                <td>
                    <span class="fs-sale-name">${escapeHtml(sale.name || '—')}</span>
                    ${sale.bannerText ? `<span class="fs-sale-banner">${escapeHtml(sale.bannerText)}</span>` : ''}
                </td>
                <td>
                    <span class="product-count">
                        <i class="fas fa-box"></i>
                        ${productCount}
                    </span>
                </td>
                <td>
                    ${sale.discount ? `<span class="discount-badge">${sale.discount}% OFF</span>` : '—'}
                </td>
                <td>
                    <div class="fs-duration">
                        <span class="fs-date-line"><i class="fas fa-play"></i>${formatDate(sale.startDate)}</span>
                        <span class="fs-date-line"><i class="fas fa-stop"></i>${formatDate(sale.endDate)}</span>
                    </div>
                </td>
                <td>
                    <span class="countdown-timer ${countdownClass}">
                        <i class="fas fa-clock"></i>
                        ${escapeHtml(countdownLabel)}
                    </span>
                </td>
                <td>
                    <span class="flash-sale-status ${statusClass}">${status.toUpperCase()}</span>
                </td>
                <td>
                    <div class="fs-action-btns">
                        <button class="fs-btn-icon fs-btn-edit" data-action="edit" data-id="${id}" title="Edit sale">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="fs-btn-icon fs-btn-delete" data-action="delete" data-id="${id}" title="Delete sale">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;

            tableBody.appendChild(row);
        });
    }

    function formatDateTime(value) {
        if (!value) return '—';
        try {
            const date = new Date(value);
            return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
        } catch {
            return value;
        }
    }

    function formatDate(value) {
        if (!value) return '—';
        try {
            const date = new Date(value);
            return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch {
            return value;
        }
    }

    function formatDateForInput(value) {
        if (!value) return '';
        try {
            const date = new Date(value);
            // Format as YYYY-MM-DDTHH:mm for datetime-local input
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${year}-${month}-${day}T${hours}:${minutes}`;
        } catch {
            return '';
        }
    }

    function getComputedStatus(sale) {
        if (!sale.startDate || !sale.endDate) {
            return (sale.status || 'active').toLowerCase();
        }

        const now = new Date();
        const start = new Date(sale.startDate);
        const end = new Date(sale.endDate);

        if (now < start) return 'scheduled';
        if (now > end) return 'ended';
        return 'active';
    }

    function getCountdownLabel(sale) {
        if (!sale.startDate || !sale.endDate) return '-';

        const now = new Date();
        const start = new Date(sale.startDate);
        const end = new Date(sale.endDate);

        if (now < start) {
            const diff = start - now;
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            if (days > 0) {
                return `Starts in ${days}d ${hours}h`;
            }
            return `Starts in ${hours}h`;
        }
        if (now > end) {
            return 'Ended';
        }
        const diff = end - now;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        
        if (days > 0) {
            return `${days}d ${hours}h left`;
        }
        if (hours > 0) {
        return `${hours}h ${minutes}m left`;
        }
        return `${minutes}m left`;
    }
    
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Open create modal (exposed globally)
    function openCreateFlashSaleModal() {
        if (!modal || !form) return;
        modalTitle.textContent = 'Create Flash Sale';
        form.reset();
        flashSaleIdInput.value = '';
        selectedProductIds = new Set();
        if (productList) {
            productList.innerHTML = '';
        }
        modal.style.display = 'flex';
    }

    // Open edit modal (helper, uses data already loaded)
    function openEditFlashSaleModal(id) {
        if (!modal || !form) return;
        const sale = flashSales.find(s => String(s._id || s.id) === String(id));
        if (!sale) return;

        modalTitle.textContent = 'Edit Flash Sale';
        flashSaleIdInput.value = sale._id || sale.id;
        selectedProductIds = new Set(
            (Array.isArray(sale.productIds) ? sale.productIds : []).map(id => String(id))
        );
        if (productList) {
            productList.innerHTML = '';
        }

        document.getElementById('saleName').value = sale.name || '';
        document.getElementById('startDate').value = formatDateForInput(sale.startDate);
        document.getElementById('endDate').value = formatDateForInput(sale.endDate);
        document.getElementById('discount').value = sale.discount || '';
        document.getElementById('showBanner').checked = !!sale.showBanner;
        document.getElementById('showStockAlert').checked = !!sale.showStockAlert;
        document.getElementById('bannerText').value = sale.bannerText || '';

        modal.style.display = 'flex';
    }

    function closeFlashSaleModal() {
        if (!modal) return;
        modal.style.display = 'none';
    }

    async function saveFlashSale(event) {
        event.preventDefault();
        if (!form) return;

        const id = flashSaleIdInput.value || null;

        // Also sync any currently visible checked checkboxes (in case change events were missed)
        document.querySelectorAll('#productList input[type="checkbox"]').forEach(input => {
            if (input.checked) {
                selectedProductIds.add(input.value);
            } else {
                selectedProductIds.delete(input.value);
            }
        });

        const saleData = {
            name: document.getElementById('saleName').value.trim(),
            startDate: document.getElementById('startDate').value,
            endDate: document.getElementById('endDate').value,
            discount: parseInt(document.getElementById('discount').value, 10) || 0,
            productIds: Array.from(selectedProductIds),
            showBanner: document.getElementById('showBanner').checked,
            showStockAlert: document.getElementById('showStockAlert').checked,
            bannerText: document.getElementById('bannerText').value.trim()
        };

        if (!saleData.name || !saleData.startDate || !saleData.endDate || saleData.productIds.length === 0) {
            showNotification('Please fill in all required fields and select at least one product.', 'error');
            return;
        }

        if (new Date(saleData.endDate) <= new Date(saleData.startDate)) {
            showNotification('End date must be after the start date.', 'error');
            return;
        }

        if (saleData.productIds.length > 4) {
            showNotification('A flash sale can include a maximum of 4 products.', 'error');
            return;
        }

        try {
            const url = id ? `/api/admin/marketing/flash-sales/${id}` : '/api/admin/marketing/flash-sales';
            const method = id ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
                },
                body: JSON.stringify(saleData)
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || 'Failed to save flash sale');
            }

            showNotification(data.message || 'Flash sale saved successfully', 'success');
            closeFlashSaleModal();
            await loadFlashSales();
        } catch (error) {
            console.error('[Admin Flash Sales] Error saving flash sale:', error);
            showNotification('Failed to save flash sale. Please try again.', 'error');
        }
    }

    // Show delete confirmation modal
    function confirmDeleteFlashSale(id) {
        if (!id) return;
        
        const sale = flashSales.find(s => String(s._id || s.id) === String(id));
        const saleName = sale ? (sale.name || 'this flash sale') : 'this flash sale';
        
        const deleteModal = document.getElementById('deleteFlashSaleModal');
        const deleteSaleNameEl = document.getElementById('deleteFlashSaleName');
        
        if (deleteSaleNameEl) {
            deleteSaleNameEl.textContent = saleName;
        }
        
        if (deleteModal) {
            deleteModal.style.display = 'flex';
            // Store the ID for the confirm button
            deleteModal.dataset.saleId = id;
        }
    }

    // Close delete confirmation modal
    function closeDeleteModal() {
        const deleteModal = document.getElementById('deleteFlashSaleModal');
        if (deleteModal) {
            deleteModal.style.display = 'none';
            deleteModal.dataset.saleId = '';
        }
    }

    // Actually delete the flash sale
    async function deleteFlashSale(id) {
        if (!id) return;

        const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        if (!confirmDeleteBtn) return;

        // Show loading state
        const originalText = confirmDeleteBtn.innerHTML;
        confirmDeleteBtn.disabled = true;
        confirmDeleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';

        try {
            const response = await fetch(`/api/admin/marketing/flash-sales/${id}`, {
                method: 'DELETE',
                headers: {
                    'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
                }
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || 'Failed to delete flash sale');
            }

            // Close modal
            closeDeleteModal();
            
            // Show success notification (you can replace this with a toast notification if you have one)
            showNotification('Flash sale deleted successfully!', 'success');
            
            // Reload flash sales
            await loadFlashSales();
        } catch (error) {
            console.error('[Admin Flash Sales] Error deleting flash sale:', error);
            showNotification('Failed to delete flash sale: ' + error.message, 'error');
            
            // Reset button state
            confirmDeleteBtn.disabled = false;
            confirmDeleteBtn.innerHTML = originalText;
        }
    }

    // Simple notification function (you can replace with a toast library if preferred)
    function showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 10001;
            animation: slideInRight 0.3s ease;
            max-width: 400px;
        `;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    async function searchProducts(query) {
        if (!productList) return;

        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
            productList.innerHTML = '';
            productList.classList.remove('loading');
            return;
        }

        // Show loading state
        productList.classList.add('loading');
        productList.innerHTML = '<span>Searching products...</span>';

        try {
            const response = await fetch(`/api/products/search?q=${encodeURIComponent(trimmedQuery)}`, {
                credentials: 'same-origin',
                cache: 'no-store'
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            productList.classList.remove('loading');
            
            if (!data.success || !Array.isArray(data.products) || data.products.length === 0) {
                productList.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: var(--primary-500);">
                        <i class="fas fa-search" style="font-size: 32px; margin-bottom: 12px; opacity: 0.5; display: block;"></i>
                        <p>No products found matching "${escapeHtml(trimmedQuery)}"</p>
                    </div>
                `;
                return;
            }

            renderProductList(data.products);
        } catch (error) {
            console.error('[Admin Flash Sales] Error searching products:', error);
            productList.classList.remove('loading');
            productList.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--error);">
                    <i class="fas fa-exclamation-triangle" style="font-size: 32px; margin-bottom: 12px; display: block;"></i>
                    <p>Failed to load products. Please try again.</p>
                </div>
            `;
        }
    }

    const debouncedSearchProducts = debounce(searchProducts, 300);

    function renderProductList(products) {
        productList.innerHTML = '';
        productList.classList.remove('loading');

        if (products.length === 0) {
            productList.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--primary-500);">
                    <i class="fas fa-box-open" style="font-size: 32px; margin-bottom: 12px; opacity: 0.5; display: block;"></i>
                    <p>No products found.</p>
                </div>
            `;
            return;
        }

        products.forEach(product => {
            const productId = product._id || product.id;
            const productName = product.model || product.name || 'Unnamed product';
            const productPrice = product.finalPrice || product.price || 0;

            const item = document.createElement('label');
            item.className = 'product-list-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = productId;
            checkbox.checked = selectedProductIds.has(String(productId));

            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    selectedProductIds.add(String(productId));
                } else {
                    selectedProductIds.delete(String(productId));
                }
            });

            const info = document.createElement('span');
            info.className = 'product-list-label';
            info.innerHTML = `
                <strong>${escapeHtml(productName)}</strong>
                <span style="color: var(--primary-500); margin-left: 8px;">K${productPrice.toLocaleString()}</span>
            `;

            item.appendChild(checkbox);
            item.appendChild(info);
            productList.appendChild(item);
        });
    }

    function handleTableClick(event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        const button = target.closest('[data-action]');
        if (!button) return;

        const action = button.getAttribute('data-action');
        const id = button.getAttribute('data-id');

        if (!action || !id) return;

        if (action === 'edit') {
            openEditFlashSaleModal(id);
        } else if (action === 'delete') {
            confirmDeleteFlashSale(id);
        }
    }

    async function initFlashSalesAdmin() {
        // Check authentication before initializing
        const isAuthenticated = await window.AuthUtils?.initializeAuthCheck();
        if (!isAuthenticated) {
            return; // Redirect will happen in initializeAuthCheck
        }
        
        if (statusFilter) {
            statusFilter.addEventListener('change', renderFlashSalesTable);
        }

        if (tableBody) {
            tableBody.addEventListener('click', handleTableClick);
        }

        if (productSearchInput) {
            productSearchInput.addEventListener('input', (e) => {
                debouncedSearchProducts(e.target.value);
            });
        }

        if (form) {
            form.addEventListener('submit', saveFlashSale);
        }

        // Close modal when clicking outside content
        window.addEventListener('click', (event) => {
            if (event.target === modal) {
                closeFlashSaleModal();
            }
        });

        // Setup delete confirmation modal
        const deleteModal = document.getElementById('deleteFlashSaleModal');
        const closeDeleteModalBtn = document.getElementById('closeDeleteModal');
        const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
        const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

        if (closeDeleteModalBtn) {
            closeDeleteModalBtn.addEventListener('click', closeDeleteModal);
        }

        if (cancelDeleteBtn) {
            cancelDeleteBtn.addEventListener('click', closeDeleteModal);
        }

        if (confirmDeleteBtn) {
            confirmDeleteBtn.addEventListener('click', () => {
                const saleId = deleteModal ? deleteModal.dataset.saleId : null;
                if (saleId) {
                    deleteFlashSale(saleId);
                }
            });
        }

        // Close delete modal when clicking outside
        if (deleteModal) {
            deleteModal.addEventListener('click', (event) => {
                if (event.target === deleteModal) {
                    closeDeleteModal();
                }
            });
        }

        // Initial data load
        loadFlashSales();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initFlashSalesAdmin);
    } else {
        initFlashSalesAdmin();
    }

    // Expose functions for inline handlers (create button)
    window.openCreateFlashSaleModal = openCreateFlashSaleModal;
    window.closeFlashSaleModal = closeFlashSaleModal;
    window.saveFlashSale = saveFlashSale;
    window.closeDeleteModal = closeDeleteModal;
    window.loadFlashSales = loadFlashSales; // Expose for retry button
    
    // Expose escapeHtml for use in templates
    window.escapeHtml = escapeHtml;
})(); 


