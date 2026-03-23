// Admin Orders Management JavaScript

// TODO: Implement authentication check
// TODO: Implement tracking number integration

let currentPage = 1;
let totalPages = 1;
let selectedOrders = [];
let currentOrderId = null;
let activeFilters = {}; // Filters last applied by an explicit admin action — polling always uses this

// HTML-escape helper — must wrap every server-returned value interpolated into innerHTML
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

/**
 * Show a styled confirm dialog. Returns a Promise that resolves to true (confirmed)
 * or false (cancelled). Replaces all native confirm() calls.
 * @param {string} message
 * @param {{ title?: string, confirmLabel?: string, isDanger?: boolean }} [opts]
 */
function showConfirmDialog(message, { title = 'Confirm', confirmLabel = 'Confirm', isDanger = true } = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        document.getElementById('confirmModalTitle').textContent = title;
        document.getElementById('confirmModalMessage').textContent = message;
        const okBtn = document.getElementById('okConfirmBtn');
        okBtn.textContent = confirmLabel;
        okBtn.className = isDanger ? 'btn-danger' : 'btn-primary';
        modal.style.display = 'flex';

        function onConfirm() { cleanup(); resolve(true); }
        function onCancel()  { cleanup(); resolve(false); }
        function cleanup() {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', onConfirm);
            document.getElementById('cancelConfirmBtn').removeEventListener('click', onCancel);
            document.getElementById('closeConfirmModal').removeEventListener('click', onCancel);
        }

        okBtn.addEventListener('click', onConfirm);
        document.getElementById('cancelConfirmBtn').addEventListener('click', onCancel);
        document.getElementById('closeConfirmModal').addEventListener('click', onCancel);
    });
}

// Real-time updates (polling)
let realTimeInterval = null;
let lastUpdateTime = null;
let currentOrdersMap = new Map(); // Track current orders for change detection
let isPollingActive = false;
const POLLING_INTERVAL = 15000; // 15 seconds

// Track unread orders for sidebar badge (using shared utility)

document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication before initializing
    const isAuthenticated = await window.AuthUtils?.initializeAuthCheck();
    if (!isAuthenticated) {
        return; // Redirect will happen in initializeAuthCheck
    }
    
    initializeOrdersPage();
    setupEventListeners();
    
    // Load orders from API
    loadOrders().then(() => {
        // Mark all current orders as viewed (user is on orders page)
        if (window.OrdersBadge) {
            window.OrdersBadge.markAsViewed();
        }
        
        // Start real-time updates after initial load
        startRealTimeUpdates();
    });
});

// Stop polling when page is hidden or unloaded
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopRealTimeUpdates();
    } else {
        startRealTimeUpdates();
    }
});

window.addEventListener('beforeunload', () => {
    stopRealTimeUpdates();
});

// Initialize orders page
function initializeOrdersPage() {
    // Authentication check is handled in DOMContentLoaded
    // TODO: Check admin authentication
    // if (!isAuthenticated()) {
    //     window.location.href = '/admin/login';
    //     return;
    // }
    
    setupSidebar();
    setupTabs();
}

// Setup event listeners
function setupEventListeners() {
    // Delegated listeners on the orders table — handles action buttons and checkboxes
    // for all rows without needing to re-attach on every render.
    setupTableDelegation();

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

    const orderSearch = document.getElementById('orderSearch');
    if (orderSearch) {
        orderSearch.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleSearch();
            }
        });
    }

    // Filters
    const filterInputs = document.querySelectorAll('.filter-select, .date-input');
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

    // Bulk actions
    setupBulkActions();

    // Modals
    setupModals();

    // Status buttons
    setupStatusButtons();
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

// Setup tabs
function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.dataset.tab;
            
            // Remove active class from all tabs and panes
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));
            
            // Add active class to clicked tab and corresponding pane
            btn.classList.add('active');
            const targetPane = document.getElementById(targetTab + 'Tab');
            if (targetPane) {
                targetPane.classList.add('active');
            }
        });
    });
}

// Setup bulk actions
function setupBulkActions() {
    // Select all checkbox (table header — canonical)
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            toggleAllOrders(e.target.checked);
        });
    }
    
    // Export orders
    const exportOrdersBtn = document.getElementById('exportOrdersBtn');
    if (exportOrdersBtn) {
        exportOrdersBtn.addEventListener('click', handleExportOrders);
    }
    
    // Delete selected orders button
    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', handleBulkDelete);
    }
    
    // Update delete button visibility when selection changes
    updateDeleteButtonVisibility();
}

// Setup modals
function setupModals() {
    // Order details modal
    const closeOrderModal = document.getElementById('closeOrderModal');
    const closeOrderDetailsBtn = document.getElementById('closeOrderDetailsBtn');
    const orderDetailsModal = document.getElementById('orderDetailsModal');
    
    if (closeOrderModal) {
        closeOrderModal.addEventListener('click', () => closeOrderDetails());
    }
    
    if (closeOrderDetailsBtn) {
        closeOrderDetailsBtn.addEventListener('click', () => closeOrderDetails());
    }
    
    if (orderDetailsModal) {
        orderDetailsModal.addEventListener('click', (e) => {
            if (e.target === orderDetailsModal) {
                closeOrderDetails();
            }
        });
    }
    
    // Status update modal
    setupStatusModal();
    
    // Invoice actions
    setupInvoiceActions();
}

// Setup status modal
function setupStatusModal() {
    const closeStatusModal = document.getElementById('closeStatusModal');
    const cancelStatusUpdateBtn = document.getElementById('cancelStatusUpdateBtn');
    const confirmStatusUpdateBtn = document.getElementById('confirmStatusUpdateBtn');
    const statusUpdateModal = document.getElementById('statusUpdateModal');
    
    if (closeStatusModal) {
        closeStatusModal.addEventListener('click', () => {
            statusUpdateModal.style.display = 'none';
        });
    }
    
    if (cancelStatusUpdateBtn) {
        cancelStatusUpdateBtn.addEventListener('click', () => {
            statusUpdateModal.style.display = 'none';
        });
    }
    
    if (confirmStatusUpdateBtn) {
        confirmStatusUpdateBtn.addEventListener('click', async () => {
            const newStatus = document.getElementById('newStatusSelect').value;
            const notes = document.getElementById('statusNotes').value;
            
            if (!currentOrderId) {
                showNotification('No order selected', 'error');
                return;
            }

            try {
                await AdminOrdersAPI.updateOrderStatus(currentOrderId, newStatus, notes);
            statusUpdateModal.style.display = 'none';
                // Reload orders and order details
                await loadOrders();
                if (currentOrderId) {
                    await loadOrderDetails(currentOrderId);
                }
                showNotification('Order status updated successfully', 'success');
            } catch (error) {
                console.error('Error updating order status:', error);
                showNotification(error.message || 'Failed to update order status', 'error');
            }
        });
    }
}

// Setup status buttons
function setupStatusButtons() {
    document.getElementById('confirmOrderBtn')?.addEventListener('click', () => {
        updateStatus('confirmed');
    });
    
    document.getElementById('packOrderBtn')?.addEventListener('click', () => {
        updateStatus('packed');
    });
    
    document.getElementById('shipOrderBtn')?.addEventListener('click', () => {
        openShippingTab();
    });
    
    document.getElementById('deliverOrderBtn')?.addEventListener('click', () => {
        updateStatus('delivered');
    });
    
    document.getElementById('cancelOrderBtn')?.addEventListener('click', async () => {
        if (await showConfirmDialog('Are you sure you want to cancel this order?', { title: 'Cancel Order', confirmLabel: 'Cancel Order' })) {
            updateStatus('cancelled');
        }
    });
    
    // Tracking update
    document.getElementById('updateTrackingBtn')?.addEventListener('click', async () => {
        const trackingNumber = document.getElementById('trackingNumber').value;
        const courier = document.getElementById('courierSelect').value;
        
        if (!currentOrderId) {
            showNotification('No order selected', 'error');
            return;
        }

        if (!trackingNumber.trim()) {
            showNotification('Tracking number is required', 'error');
            return;
        }
        
        try {
            await AdminOrdersAPI.updateTracking(currentOrderId, trackingNumber.trim(), courier);
            showNotification('Tracking information updated successfully', 'success');
            // Reload order details
            await loadOrderDetails(currentOrderId);
        } catch (error) {
            console.error('Error updating tracking:', error);
            showNotification(error.message || 'Failed to update tracking information', 'error');
        }
    });
    
    // Add note
    document.getElementById('addNoteBtn')?.addEventListener('click', async () => {
        const note = document.getElementById('newNote').value;

        if (!currentOrderId) {
            showNotification('No order selected', 'error');
            return;
        }
        
        if (note.trim()) {
            try {
                await AdminOrdersAPI.addOrderNote(currentOrderId, note.trim());
            document.getElementById('newNote').value = '';
                showNotification('Note added successfully', 'success');
                // Reload order details
                await loadOrderDetails(currentOrderId);
            } catch (error) {
                console.error('Error adding note:', error);
                showNotification(error.message || 'Failed to add note', 'error');
            }
        }
    });
    
    // Payment verification button
    document.getElementById('verifyPaymentBtn')?.addEventListener('click', async () => {
        if (!currentOrderId) {
            showNotification('No order selected', 'error');
            return;
        }
        
        try {
            const verifyBtn = document.getElementById('verifyPaymentBtn');
            if (verifyBtn) {
                verifyBtn.disabled = true;
                verifyBtn.textContent = 'Verifying...';
            }
            
            const result = await AdminOrdersAPI.verifyOrderPayment(currentOrderId);
            
            if (result.verified) {
                showNotification('Payment verified successfully', 'success');
            } else {
                showNotification('Payment verification attempted. Using database status.', 'warning');
            }
            
            // Reload order details
            await loadOrderDetails(currentOrderId);
            await loadOrders();
            
            if (verifyBtn) {
                verifyBtn.disabled = false;
                verifyBtn.textContent = 'Verify Payment';
            }
        } catch (error) {
            console.error('Error verifying payment:', error);
            showNotification(error.message || 'Failed to verify payment', 'error');
            
            const verifyBtn = document.getElementById('verifyPaymentBtn');
            if (verifyBtn) {
                verifyBtn.disabled = false;
                verifyBtn.textContent = 'Verify Payment';
            }
        }
    });
}

// Setup invoice actions
function setupInvoiceActions() {
    document.getElementById('printInvoiceBtn')?.addEventListener('click', async () => {
        if (!currentOrderId) {
            showNotification('No order selected', 'error');
            return;
        }
        
        try {
            await AdminOrdersAPI.generateInvoice(currentOrderId);
            showNotification('Invoice generated successfully', 'success');
        } catch (error) {
            console.error('Error generating invoice:', error);
            showNotification(error.message || 'Failed to generate invoice', 'error');
        }
    });
    
    document.getElementById('emailInvoiceBtn')?.addEventListener('click', async () => {
        if (!currentOrderId) {
            showNotification('No order selected', 'error');
            return;
        }
        
        if (!await showConfirmDialog('Send invoice email to customer?', { title: 'Send Invoice', confirmLabel: 'Send', isDanger: false })) {
            return;
        }
        
        try {
            const emailBtn = document.getElementById('emailInvoiceBtn');
            if (emailBtn) {
                emailBtn.disabled = true;
                const originalText = emailBtn.innerHTML;
                emailBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
                
                const result = await AdminOrdersAPI.sendInvoiceEmail(currentOrderId);
                
                showNotification(`Invoice email sent to ${result.recipient}`, 'success');
                
                emailBtn.disabled = false;
                emailBtn.innerHTML = originalText;
            }
        } catch (error) {
            console.error('Error sending invoice email:', error);
            showNotification(error.message || 'Failed to send invoice email', 'error');
            
            const emailBtn = document.getElementById('emailInvoiceBtn');
            if (emailBtn) {
                emailBtn.disabled = false;
                emailBtn.innerHTML = '<i class="fas fa-envelope"></i> Email Invoice';
            }
        }
    });
}

// Open order details
async function openOrderDetails(orderId) {
    currentOrderId = orderId;
    const modal = document.getElementById('orderDetailsModal');
    if (!modal) return;
    
    document.getElementById('orderDetailsId').textContent = orderId;
    modal.style.display = 'flex';
    
    // Load order details from API
    await loadOrderDetails(orderId);
}

// Close order details
function closeOrderDetails() {
    const modal = document.getElementById('orderDetailsModal');
    if (modal) {
        modal.style.display = 'none';
    }
    currentOrderId = null;
}

// Update order status
async function updateStatus(newStatus) {
    if (!currentOrderId) return;
    
    // Show status update modal
    const modal = document.getElementById('statusUpdateModal');
    const modalTitle = document.getElementById('statusModalTitle');
    const statusSelect = document.getElementById('newStatusSelect');
    
    if (modal && modalTitle && statusSelect) {
        modalTitle.textContent = `Update Order Status - ${currentOrderId}`;
        statusSelect.value = newStatus;
        modal.style.display = 'flex';
    }
}

// Open shipping tab
function openShippingTab() {
    // Switch to shipping tab
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.dataset.tab === 'shipping') {
            btn.click();
        }
    });
}

// Handle search
async function handleSearch() {
    const searchTerm = document.getElementById('orderSearch').value.trim();

    if (searchTerm) {
        activeFilters = { search: searchTerm };
        await loadOrders(activeFilters);
    } else {
        activeFilters = {};
        await loadOrders();
    }
}

// Handle filter
async function handleFilter() {
    const filters = {};

    const orderStatus = document.getElementById('filterOrderStatus')?.value;
    const paymentStatus = document.getElementById('filterPaymentStatus')?.value;
    const paymentMethod = document.getElementById('filterPaymentMethod')?.value;
    const startDate = document.getElementById('startDate')?.value;
    const endDate = document.getElementById('endDate')?.value;

    if (orderStatus) filters.status = orderStatus;
    if (paymentStatus) filters.paymentStatus = paymentStatus;
    if (paymentMethod) filters.paymentMethod = paymentMethod;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;

    activeFilters = filters;
    await loadOrders(activeFilters);
}

// Handle sort
async function handleSort() {
    const sortBy = document.getElementById('sortBy').value;
    activeFilters = { ...activeFilters, sort: sortBy };
    await loadOrders(activeFilters);
}

// Clear filters
async function clearFilters() {
    document.getElementById('orderSearch').value = '';
    const filterOrderStatus = document.getElementById('filterOrderStatus');
    const filterPaymentStatus = document.getElementById('filterPaymentStatus');
    const filterPaymentMethod = document.getElementById('filterPaymentMethod');
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    const sortBy = document.getElementById('sortBy');
    
    if (filterOrderStatus) filterOrderStatus.value = '';
    if (filterPaymentStatus) filterPaymentStatus.value = '';
    if (filterPaymentMethod) filterPaymentMethod.value = '';
    if (startDate) startDate.value = '';
    if (endDate) endDate.value = '';
    if (sortBy) sortBy.value = 'newest';

    activeFilters = {};
    await loadOrders();
}

// Load orders from API
async function loadOrders(filters = {}, isPollingUpdate = false) {
    try {
        // Add updatedSince filter for polling updates
        if (isPollingUpdate && lastUpdateTime) {
            filters.updatedSince = lastUpdateTime;
        }
        
        const result = await AdminOrdersAPI.loadOrders(filters);
        
        if (isPollingUpdate) {
            // For polling updates, only update changed orders
            updateOrdersIfChanged(result.orders);
        } else {
            // Full reload - update everything
            renderOrders(result.orders);
            updateOrdersCount(result.count);
            // Store orders for change detection
            currentOrdersMap.clear();
            result.orders.forEach(order => {
                currentOrdersMap.set(order.orderNumber, order);
            });
            // Update select all checkbox state
            updateSelectAllCheckbox();
        }
        
        // Update last update time
        lastUpdateTime = new Date().toISOString();
        
        return result;
    } catch (error) {
        console.error('Error loading orders:', error);
        if (!isPollingUpdate) {
            showNotification(error.message || 'Failed to load orders', 'error');
            renderOrders([]);
        }
        throw error;
    }
}

// Load order details from API
async function loadOrderDetails(orderId) {
    try {
        const order = await AdminOrdersAPI.getOrderByNumber(orderId);
        
        if (!order) {
            showNotification('Order not found', 'error');
            return;
        }
        
        populateOrderDetails(order);
        loadOrderItems(order.items || []);
        loadOrderHistory(order.history || []);
        loadTrackingInfo(order);
    } catch (error) {
        console.error('Error loading order details:', error);
        showNotification(error.message || 'Failed to load order details', 'error');
    }
}

// Render orders table
function renderOrders(orders) {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;
    
    if (orders.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="empty-state">
                    <i class="fas fa-shopping-cart"></i>
                    <p>No orders found</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = orders.map(order => {
        const isSelected = selectedOrders.includes(order.orderNumber);
        const on = esc(order.orderNumber); // escaped once, reused throughout this row
        return `
        <tr>
            <td>
                <input type="checkbox" class="order-checkbox" data-order-id="${on}"
                       ${isSelected ? 'checked' : ''}>
            </td>
            <td>
                <a href="#" class="order-link" data-action="view" data-order="${on}">
                    ${on}
                </a>
            </td>
            <td>
                <div class="customer-cell">
                    <div class="customer-name">${esc(order.customer?.name || 'N/A')}</div>
                    <div class="customer-contact">${esc(order.customer?.email || order.customer?.phone || '')}</div>
                </div>
            </td>
            <td>${formatDate(order.createdAt)}</td>
            <td>${formatPaymentMethod(order.paymentMethod)}</td>
            <td>
                <span class="payment-status-badge ${getPaymentStatusClass(order.paymentStatus)}">
                    ${esc(order.paymentStatus || 'pending')}
                </span>
            </td>
            <td>
                <span class="order-status-badge ${esc(order.status || 'pending')}">
                    ${esc(order.status || 'pending')}
                </span>
            </td>
            <td>K${order.totals?.total?.toLocaleString() || '0'}</td>
            <td>${order.shipping?.pickup ? 'Pickup' : 'Delivery'}</td>
            <td>
                <div class="action-menu-container">
                    <button class="action-menu-btn" data-action="menu" data-order="${on}" title="Actions">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                    <div class="action-menu-dropdown" id="actionMenu-${on}" style="display: none;">
                        <button class="action-menu-item" data-action="view" data-order="${on}">
                            <i class="fas fa-eye"></i>
                            <span>View Details</span>
                        </button>
                        ${!['confirmed','packed','shipped','delivered'].includes(order.status) ? `
                        <button class="action-menu-item" data-action="process" data-order="${on}">
                            <i class="fas fa-check"></i>
                            <span>Confirm Order</span>
                        </button>` : ''}

                        <button class="action-menu-item" data-action="ship" data-order="${on}">
                            <i class="fas fa-shipping-fast"></i>
                            <span>Ship Order</span>
                        </button>
                        <button class="action-menu-item" data-action="print" data-order="${on}">
                            <i class="fas fa-print"></i>
                            <span>Print Invoice</span>
                        </button>
                        <div class="action-menu-divider"></div>
                        <button class="action-menu-item danger" data-action="cancel" data-order="${on}">
                            <i class="fas fa-times"></i>
                            <span>Cancel Order</span>
                        </button>
                        <button class="action-menu-item danger" data-action="delete" data-order="${on}">
                            <i class="fas fa-trash"></i>
                            <span>Delete Order</span>
                        </button>
                    </div>
                </div>
            </td>
        </tr>
    `;
    }).join('');
}

// Attach checkbox event listeners (kept for any non-delegated usage)
function attachCheckboxListeners() {
    const checkboxes = document.querySelectorAll('.order-checkbox');
    checkboxes.forEach(checkbox => {
        // Remove existing listeners by cloning
        const newCheckbox = checkbox.cloneNode(true);
        checkbox.parentNode.replaceChild(newCheckbox, checkbox);

        // Add new listener
        newCheckbox.addEventListener('change', (e) => {
            const orderNumber = e.target.dataset.orderId;
            toggleOrderSelection(orderNumber, e.target.checked);
        });
    });
}

/**
 * Set up a single delegated listener on the orders table body.
 * Handles action-button clicks and checkbox changes for all rows without
 * re-attaching per-row handlers on every render.
 */
function setupTableDelegation() {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;

    tbody.addEventListener('click', e => {
        // Prevent default navigation for anchor-based action links
        const anchor = e.target.closest('a[data-action]');
        if (anchor) e.preventDefault();

        const btn = e.target.closest('[data-action]');
        if (!btn) return;

        const orderNum = btn.dataset.order;
        switch (btn.dataset.action) {
            case 'view':
                openOrderDetails(orderNum);
                break;
            case 'menu':
                toggleActionMenu(orderNum);
                break;
            case 'process':
                processOrder(orderNum);
                closeActionMenu(orderNum);
                break;
            case 'ship':
                shipOrder(orderNum);
                closeActionMenu(orderNum);
                break;
            case 'print':
                printInvoice(orderNum);
                closeActionMenu(orderNum);
                break;
            case 'cancel':
                cancelOrder(orderNum);
                closeActionMenu(orderNum);
                break;
            case 'delete':
                deleteOrder(orderNum);
                closeActionMenu(orderNum);
                break;
        }
    });

    // Checkbox state changes
    tbody.addEventListener('change', e => {
        const checkbox = e.target.closest('.order-checkbox');
        if (!checkbox) return;
        toggleOrderSelection(checkbox.dataset.orderId, checkbox.checked);
    });
}

// Populate order details
function populateOrderDetails(order) {
    // Customer info
    document.getElementById('customerName').textContent = order.customer?.name || '-';
    document.getElementById('customerPhone').textContent = order.customer?.phone || '-';
    document.getElementById('customerEmail').textContent = order.customer?.email || '-';
    
    // Delivery info
    document.getElementById('deliveryAddress').textContent = order.shipping?.address || '-';
    document.getElementById('deliveryCity').textContent = order.shipping?.city || '-';
    document.getElementById('deliveryZone').textContent = order.shipping?.province || '-';
    document.getElementById('deliveryInstructions').textContent = order.shipping?.instructions || 'None';
    
    // Payment info
    document.getElementById('paymentMethod').textContent = formatPaymentMethod(order.paymentMethod);
    document.getElementById('paymentStatus').textContent = order.paymentStatus || 'pending';
    document.getElementById('transactionId').textContent = order.transactionId || '-';
    
    // Order summary
    document.getElementById('orderSubtotal').textContent = `K${order.totals?.subtotal?.toLocaleString() || '0'}`;
    document.getElementById('orderDiscount').textContent = `-K${order.totals?.discount?.toLocaleString() || '0'}`;
    document.getElementById('orderShipping').textContent = `K${order.totals?.delivery?.toLocaleString() || '0'}`;
    document.getElementById('orderTotal').textContent = `K${order.totals?.total?.toLocaleString() || '0'}`;
}

// Load order items
function loadOrderItems(items) {
    const container = document.getElementById('orderItemsList');
    if (!container) return;
    
    if (!items || items.length === 0) {
        container.innerHTML = '<p class="empty-state">No items in this order</p>';
        return;
    }
    
    container.innerHTML = items.map(item => {
        // Handle price - it can be a number or a string with 'K' prefix
        let unitPrice = 0;
        if (typeof item.price === 'number') {
            unitPrice = item.price;
        } else if (typeof item.price === 'string') {
            unitPrice = parseFloat(item.price.replace('K', '')) || 0;
        } else {
            unitPrice = 0;
        }
        
        const quantity = item.quantity || 1;
        const subtotal = unitPrice * quantity;
        
        return `
        <div class="order-item-card">
            <img src="${esc(item.image || '/images/placeholder.jpg')}" alt="${esc(item.name)}" class="order-item-image">
            <div class="order-item-details">
                <div class="order-item-name">${esc(item.name)}</div>
                <div class="order-item-sku">SKU: ${esc(item.sku || 'N/A')}</div>
                <div class="order-item-meta">
                    <span>Quantity: ${quantity}</span>
                </div>
            </div>
            <div class="order-item-price">
                <div class="unit-price">K${unitPrice.toLocaleString()} each</div>
                <div class="subtotal">K${subtotal.toLocaleString()}</div>
            </div>
        </div>
        `;
    }).join('');
}

// Utility functions
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatPaymentMethod(method) {
    const methods = {
        'mobile_money': 'Mobile Money',
        'bank_transfer': 'Bank Transfer',
        'card': 'Card',
        'cash_on_delivery': 'Cash on Delivery'
    };
    return methods[method] || method || 'N/A';
}

function getPaymentStatusClass(status) {
    // Normalize status to match payments.ejs
    if (!status) return 'pending';
    
    // Map common variations to standard statuses
    const statusMap = {
        'paid': 'completed',
        'success': 'completed',
        'successful': 'completed'
    };
    
    return statusMap[status.toLowerCase()] || status.toLowerCase();
}

// Action functions
async function processOrder(orderId) {
    const order = currentOrdersMap.get(orderId);
    const currentStatus = order?.status || 'unknown';

    // Guard: only confirm orders that haven't started fulfilment yet.
    if (currentStatus !== 'pending' && currentStatus !== 'paid') {
        showNotification(
            `Cannot confirm: order is already "${currentStatus}". Open the order details to change its status manually.`,
            'error'
        );
        return;
    }

    if (!await showConfirmDialog(`Confirm order ${orderId}? This will change its status to "confirmed".`, { title: 'Confirm Order', confirmLabel: 'Confirm Order', isDanger: false })) {
        return;
    }

    try {
        await AdminOrdersAPI.updateOrderStatus(orderId, 'confirmed', 'Order confirmed by admin');
        showNotification('Order confirmed successfully', 'success');
        await loadOrders();
        if (currentOrderId === orderId) {
            await loadOrderDetails(orderId);
        }
    } catch (error) {
        console.error('Error confirming order:', error);
        showNotification(error.message || 'Failed to confirm order', 'error');
    }
}

function shipOrder(orderId) {
    openOrderDetails(orderId);
    openShippingTab();
}

async function cancelOrder(orderId) {
    if (!await showConfirmDialog('Are you sure you want to cancel this order?', { title: 'Cancel Order', confirmLabel: 'Cancel Order' })) {
        return;
    }
    try {
        await AdminOrdersAPI.updateOrderStatus(orderId, 'cancelled', 'Order cancelled by admin');
        showNotification('Order cancelled successfully', 'success');
        await loadOrders();
        if (currentOrderId === orderId) {
            await loadOrderDetails(orderId);
        }
    } catch (error) {
        console.error('Error cancelling order:', error);
        showNotification(error.message || 'Failed to cancel order', 'error');
    }
}

async function printInvoice(orderId) {
    if (!orderId) {
        showNotification('No order selected', 'error');
        return;
    }
    
    try {
        await AdminOrdersAPI.generateInvoice(orderId);
        showNotification('Invoice generated successfully', 'success');
    } catch (error) {
        console.error('Error generating invoice:', error);
        showNotification(error.message || 'Failed to generate invoice', 'error');
    }
}

// Load order history
function loadOrderHistory(history) {
    const container = document.getElementById('orderHistoryTimeline');
    if (!container) return;
    
    if (!history || history.length === 0) {
        container.innerHTML = '<p class="empty-state">No history available</p>';
        return;
    }
    
    container.innerHTML = history.map(entry => `
        <div class="history-item">
            <div class="history-status">${esc(entry.status || 'N/A')}</div>
            <div class="history-details">
                <div class="history-notes">${esc(entry.notes || 'No notes')}</div>
                <div class="history-meta">
                    <span class="history-by">${esc(entry.updatedBy || 'system')}</span>
                    <span class="history-date">${formatDate(entry.updatedAt)}</span>
                </div>
            </div>
        </div>
    `).join('');
}

// Load tracking information
function loadTrackingInfo(order) {
    const trackingNumberEl = document.getElementById('trackingNumber');
    const courierSelect = document.getElementById('courierSelect');
    
    if (trackingNumberEl) {
        trackingNumberEl.value = order.trackingNumber || '';
    }
    
    if (courierSelect) {
        courierSelect.value = order.courier || '';
    }
}

// Update orders count
function updateOrdersCount(count) {
    const countEl = document.getElementById('ordersCount');
    if (countEl) {
        countEl.textContent = count || 0;
    }
}

// Show notification
function showNotification(message, type = 'info') {
    // Create notification element if it doesn't exist
    let notification = document.getElementById('orderNotification');
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'orderNotification';
        notification.className = 'order-notification';
        document.body.appendChild(notification);
    }
    
    // Set notification content and type
    notification.textContent = message;
    notification.className = `order-notification order-notification-${type}`;
    notification.style.display = 'block';
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        notification.style.display = 'none';
    }, 3000);
}

// Real-time updates using polling
function startRealTimeUpdates() {
    if (isPollingActive) {
        return; // Already polling
    }
    
    isPollingActive = true;
    console.log('[Orders] Starting real-time updates (polling every', POLLING_INTERVAL / 1000, 'seconds)');
    
    // Load updates immediately, then set interval
    loadOrderUpdates();
    realTimeInterval = setInterval(loadOrderUpdates, POLLING_INTERVAL);
}

function stopRealTimeUpdates() {
    if (realTimeInterval) {
        clearInterval(realTimeInterval);
        realTimeInterval = null;
        isPollingActive = false;
        console.log('[Orders] Stopped real-time updates');
    }
}

async function loadOrderUpdates() {
    // Don't poll if page is hidden
    if (document.hidden) {
        return;
    }
    
    try {
        // Use the last admin-applied filters, not live DOM state
        await loadOrders(activeFilters, true);
    } catch (error) {
        // Silently fail for polling updates to avoid spam
        console.error('[Orders] Error loading order updates:', error);
    }
}

function getCurrentFilters() {
    const filters = {};
    
    const orderStatus = document.getElementById('filterOrderStatus')?.value;
    const paymentStatus = document.getElementById('filterPaymentStatus')?.value;
    const paymentMethod = document.getElementById('filterPaymentMethod')?.value;
    const startDate = document.getElementById('startDate')?.value;
    const endDate = document.getElementById('endDate')?.value;
    const sortBy = document.getElementById('sortBy')?.value;
    const searchTerm = document.getElementById('orderSearch')?.value.trim();
    
    if (orderStatus) filters.status = orderStatus;
    if (paymentStatus) filters.paymentStatus = paymentStatus;
    if (paymentMethod) filters.paymentMethod = paymentMethod;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    if (sortBy) filters.sort = sortBy;
    if (searchTerm) filters.search = searchTerm;
    
    return filters;
}

// Handle export orders
async function handleExportOrders() {
    try {
        // Show format selection dialog
        const format = await showExportFormatDialog();
        if (!format) {
            return; // User cancelled
        }

        // Get current filters
        const filters = getCurrentFilters();

        // Show loading state
        const exportBtn = document.getElementById('exportOrdersBtn');
        const originalText = exportBtn.innerHTML;
        exportBtn.disabled = true;
        exportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';

        // Export orders
        const result = await AdminOrdersAPI.exportOrders(format, filters);

        showNotification(`Orders exported successfully as ${result.filename}`, 'success');
    } catch (error) {
        console.error('Error exporting orders:', error);
        showNotification(error.message || 'Failed to export orders', 'error');
    } finally {
        // Restore button state
        const exportBtn = document.getElementById('exportOrdersBtn');
        if (exportBtn) {
            exportBtn.disabled = false;
            exportBtn.innerHTML = '<i class="fas fa-download"></i> Export';
        }
    }
}

// Show export format selection dialog
function showExportFormatDialog() {
    return new Promise((resolve) => {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;';
        
        // Create modal
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.cssText = 'background: white; padding: 30px; border-radius: 8px; max-width: 400px; width: 90%;';
        
        modal.innerHTML = `
            <h2 style="margin-top: 0;">Export Orders</h2>
            <p style="margin-bottom: 20px;">Choose export format:</p>
            <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                <button class="btn-primary" data-format="csv" style="flex: 1; padding: 12px;">
                    <i class="fas fa-file-csv"></i> CSV
                </button>
                <button class="btn-primary" data-format="json" style="flex: 1; padding: 12px;">
                    <i class="fas fa-file-code"></i> JSON
                </button>
            </div>
            <button class="btn-outline" data-cancel style="width: 100%; padding: 10px;">Cancel</button>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        // Handle button clicks
        modal.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const format = btn.dataset.format;
                const cancel = btn.dataset.cancel;
                
                document.body.removeChild(overlay);
                
                if (cancel) {
                    resolve(null);
                } else if (format) {
                    resolve(format);
                }
            });
        });
        
        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
                resolve(null);
            }
        });
    });
}

function updateOrdersIfChanged(updatedOrders) {
    if (!updatedOrders || updatedOrders.length === 0) {
        return; // No updates
    }
    
    let hasChanges = false;
    const newOrders = [];
    const updatedOrderNumbers = [];
    
    updatedOrders.forEach(order => {
        const existingOrder = currentOrdersMap.get(order.orderNumber);
        
        if (!existingOrder) {
            // New order
            newOrders.push(order);
            hasChanges = true;
        } else {
            // Check if order was updated
            const existingUpdated = new Date(existingOrder.updatedAt || existingOrder.createdAt);
            const newUpdated = new Date(order.updatedAt || order.createdAt);
            
            if (newUpdated > existingUpdated || 
                existingOrder.status !== order.status ||
                existingOrder.paymentStatus !== order.paymentStatus) {
                // Order was updated
                updatedOrderNumbers.push(order.orderNumber);
                hasChanges = true;
            }
        }
        
        // Update map
        currentOrdersMap.set(order.orderNumber, order);
    });
    
    if (hasChanges) {
        // Reload full orders list using the last admin-applied filters
        loadOrders(activeFilters, false).then(() => {
            // Show notifications for new/updated orders
            if (newOrders.length > 0) {
                showNotification(`${newOrders.length} new order(s) received`, 'success');
                
                // Update sidebar badge when new orders arrive (only if not on orders page)
                if (window.OrdersBadge && window.location.pathname !== '/admin/orders') {
                    window.OrdersBadge.refresh();
                }
            }
            
            if (updatedOrderNumbers.length > 0 && newOrders.length === 0) {
                // Only show notification if there are updates but no new orders
                if (updatedOrderNumbers.length === 1) {
                    const updatedOrder = currentOrdersMap.get(updatedOrderNumbers[0]);
                    if (updatedOrder && currentOrderId !== updatedOrder.orderNumber) {
                        showNotification(`Order ${updatedOrder.orderNumber} was updated`, 'info');
                    }
                } else {
                    showNotification(`${updatedOrderNumbers.length} order(s) updated`, 'info');
                }
            }
            
            // If viewing an updated order, refresh its details
            if (currentOrderId && updatedOrderNumbers.includes(currentOrderId)) {
                loadOrderDetails(currentOrderId);
            }
            
            // Update sidebar badge when new orders arrive (only if not on orders page)
            if (window.OrdersBadge && window.location.pathname !== '/admin/orders') {
                window.OrdersBadge.refresh();
            }
        });
    }
}

// Toggle order selection
function toggleOrderSelection(orderNumber, isChecked) {
    if (isChecked) {
        if (!selectedOrders.includes(orderNumber)) {
            selectedOrders.push(orderNumber);
        }
    } else {
        selectedOrders = selectedOrders.filter(id => id !== orderNumber);
    }
    updateDeleteButtonVisibility();
    updateSelectAllCheckbox();
}

// Toggle all orders selection
function toggleAllOrders(checked) {
    const checkboxes = document.querySelectorAll('.order-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = checked;
        const orderNumber = checkbox.dataset.orderId;
        if (checked) {
            if (!selectedOrders.includes(orderNumber)) {
                selectedOrders.push(orderNumber);
            }
        } else {
            selectedOrders = selectedOrders.filter(id => id !== orderNumber);
        }
    });
    updateDeleteButtonVisibility();
}

// Update select all checkbox state
function updateSelectAllCheckbox() {
    const checkboxes = document.querySelectorAll('.order-checkbox');
    const allChecked = checkboxes.length > 0 && Array.from(checkboxes).every(cb => cb.checked);
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) selectAllCheckbox.checked = allChecked;

    const selectedCount = document.getElementById('selectedCount');
    if (selectedCount) {
        if (selectedOrders.length > 0) {
            selectedCount.textContent = `${selectedOrders.length} selected`;
            selectedCount.style.display = 'inline';
        } else {
            selectedCount.style.display = 'none';
        }
    }
}

// Update delete button visibility
function updateDeleteButtonVisibility() {
    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    if (deleteSelectedBtn) {
        if (selectedOrders.length > 0) {
            deleteSelectedBtn.style.display = 'inline-flex';
            deleteSelectedBtn.textContent = `Delete Selected (${selectedOrders.length})`;
        } else {
            deleteSelectedBtn.style.display = 'none';
        }
    }
}

// Handle bulk delete
async function handleBulkDelete() {
    if (selectedOrders.length === 0) {
        showNotification('No orders selected', 'warning');
        return;
    }
    
    const count = selectedOrders.length;
    const confirmMessage = `Are you sure you want to delete ${count} order(s)? This action cannot be undone.`;
    
    if (!await showConfirmDialog(confirmMessage, { title: 'Delete Orders', confirmLabel: `Delete ${count} Order(s)` })) {
        return;
    }
    
    try {
        const deleteBtn = document.getElementById('deleteSelectedBtn');
        if (deleteBtn) {
            deleteBtn.disabled = true;
            deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
        }
        
        const result = await AdminOrdersAPI.deleteOrders(selectedOrders);
        
        if (result.success) {
            showNotification(`Successfully deleted ${result.results.deleted.length} order(s)`, 'success');
            
            // Clear selection
            selectedOrders = [];
            updateDeleteButtonVisibility();
            
            // Reload orders
            await loadOrders();
        } else {
            showNotification(result.message || 'Failed to delete some orders', 'error');
        }
        
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete Selected';
        }
    } catch (error) {
        console.error('Error deleting orders:', error);
        showNotification(error.message || 'Failed to delete orders', 'error');
        
        const deleteBtn = document.getElementById('deleteSelectedBtn');
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete Selected';
        }
    }
}

// Delete single order
async function deleteOrder(orderNumber) {
    if (!orderNumber) {
        showNotification('No order selected', 'error');
        return;
    }
    
    if (!await showConfirmDialog(`Are you sure you want to delete order ${orderNumber}? This action cannot be undone.`, { title: 'Delete Order', confirmLabel: 'Delete Order' })) {
        return;
    }
    
    try {
        await AdminOrdersAPI.deleteOrder(orderNumber);
        showNotification('Order deleted successfully', 'success');
        
        // Remove from selection if selected
        selectedOrders = selectedOrders.filter(id => id !== orderNumber);
        updateDeleteButtonVisibility();
        
        // Reload orders
        await loadOrders();
        
        // Close modal if viewing this order
        if (currentOrderId === orderNumber) {
            closeOrderDetails();
        }
    } catch (error) {
        console.error('Error deleting order:', error);
        showNotification(error.message || 'Failed to delete order', 'error');
    }
}

// Make functions globally available
window.openOrderDetails = openOrderDetails;
window.processOrder = processOrder;

// Action menu functions
function toggleActionMenu(orderNumber) {
    // Close all other menus first
    document.querySelectorAll('.action-menu-dropdown').forEach(menu => {
        if (menu.id !== `actionMenu-${orderNumber}`) {
            menu.style.display = 'none';
        }
    });
    
    const menu = document.getElementById(`actionMenu-${orderNumber}`);
    if (menu) {
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    }
}

function closeActionMenu(orderNumber) {
    const menu = document.getElementById(`actionMenu-${orderNumber}`);
    if (menu) {
        menu.style.display = 'none';
    }
}

// Close menus when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.action-menu-container')) {
        document.querySelectorAll('.action-menu-dropdown').forEach(menu => {
            menu.style.display = 'none';
        });
    }
});

// Expose functions globally
window.toggleActionMenu = toggleActionMenu;
window.closeActionMenu = closeActionMenu;
window.shipOrder = shipOrder;
window.cancelOrder = cancelOrder;
window.printInvoice = printInvoice;
window.toggleOrderSelection = toggleOrderSelection;
window.deleteOrder = deleteOrder;

