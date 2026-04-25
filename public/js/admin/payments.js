// Admin Payments Management JavaScript

/**
 * Show a styled confirm dialog. Returns a Promise resolving to true/false.
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

let currentPage = 1;
let totalPages = 1;
let currentPaymentId = null;
const VERIFY_PAYMENT_BTN_DEFAULT_HTML = '<i class="fas fa-sync-alt"></i> Verify payment';

document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication before initializing
    const isAuthenticated = await window.AuthUtils?.initializeAuthCheck();
    if (!isAuthenticated) {
        return; // Redirect will happen in initializeAuthCheck
    }
    
    initializePaymentsPage();
    setupEventListeners();
    // Load payments from API
    loadPayments();
});

// Initialize payments page
function initializePaymentsPage() {
    setupSidebar();
    setupTabs();
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

    const paymentSearch = document.getElementById('paymentSearch');
    if (paymentSearch) {
        paymentSearch.addEventListener('keypress', (e) => {
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

    // Pagination
    setupPagination();

    // Export button
    const exportBtn = document.getElementById('exportPaymentsBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', handleExport);
    }

    // Modals
    setupModals();

    // Action buttons
    setupActionButtons();

    // Action menu (table row)
    setupActionMenu();
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

// Setup modals
function setupModals() {
    // Payment details modal
    const closePaymentModal = document.getElementById('closePaymentModal');
    const closePaymentDetailsBtn = document.getElementById('closePaymentDetailsBtn');
    const paymentDetailsModal = document.getElementById('paymentDetailsModal');
    
    if (closePaymentModal) {
        closePaymentModal.addEventListener('click', () => closePaymentDetails());
    }
    
    if (closePaymentDetailsBtn) {
        closePaymentDetailsBtn.addEventListener('click', () => closePaymentDetails());
    }
    
    if (paymentDetailsModal) {
        paymentDetailsModal.addEventListener('click', (e) => {
            if (e.target === paymentDetailsModal) {
                closePaymentDetails();
            }
        });
    }
}

// Setup action buttons
function setupActionButtons() {
    document.getElementById('verifyPaymentModalBtn')?.addEventListener('click', async () => {
        if (!currentPaymentId) {
            showNotification('No payment selected', 'error');
            return;
        }

        const verifyBtn = document.getElementById('verifyPaymentModalBtn');
        const originalHtml = verifyBtn ? verifyBtn.innerHTML : '';
        let keepSyncedState = false;

        try {
            if (verifyBtn) {
                verifyBtn.disabled = true;
                verifyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
            }

            const payment = await AdminPaymentsAPI.getPaymentById(currentPaymentId);
            if (!payment) {
                showNotification('Payment not found', 'error');
                return;
            }

            const txId = payment.transactionId || payment.lencoTransactionId || payment.lencoReference;
            if (!txId) {
                showNotification('No transaction reference available to verify', 'error');
                return;
            }

            const result = await AdminPaymentsAPI.verifyPayment(txId);
            showNotification(result.message || 'Payment verified', 'success');

            // Refresh both modal details and list row status.
            await loadPaymentDetails(currentPaymentId);
            await loadPayments(getCurrentFilters());
            keepSyncedState = true;
        } catch (error) {
            console.error('Error verifying payment:', error);
            showNotification(error.message || 'Failed to verify payment', 'error');
        } finally {
            if (verifyBtn && !keepSyncedState) {
                verifyBtn.disabled = false;
                verifyBtn.innerHTML = originalHtml || VERIFY_PAYMENT_BTN_DEFAULT_HTML;
            }
        }
    });

    // View order
    document.getElementById('viewOrderBtn')?.addEventListener('click', async () => {
        if (!currentPaymentId) {
            showNotification('No payment selected', 'error');
            return;
        }
        
        try {
            const payment = await AdminPaymentsAPI.getPaymentById(currentPaymentId);
            if (payment && payment.orderNumber) {
                window.location.href = `/admin/orders?search=${encodeURIComponent(payment.orderNumber)}`;
            } else {
                showNotification('Order number not found for this payment', 'error');
            }
        } catch (error) {
            console.error('Error getting payment:', error);
            showNotification('Failed to get payment details', 'error');
        }
    });

    document.getElementById('deletePaymentModalBtn')?.addEventListener('click', async () => {
        if (!currentPaymentId) {
            showNotification('No payment selected', 'error');
            return;
        }
        await deletePaymentById(currentPaymentId, { closeModalOnSuccess: true });
    });
}

// Handle search
async function handleSearch() {
    const searchTerm = document.getElementById('paymentSearch').value.trim();
    currentPage = 1; // Reset to first page on new search
    await loadPayments({ search: searchTerm });
}

// Handle filter
async function handleFilter() {
    const filters = {
        status: document.getElementById('filterPaymentStatus')?.value,
        paymentMethod: document.getElementById('filterPaymentMethod')?.value,
        provider: document.getElementById('filterProvider')?.value,
        startDate: document.getElementById('startDate')?.value,
        endDate: document.getElementById('endDate')?.value,
        sort: document.getElementById('sortBy')?.value || 'newest',
        page: currentPage,
        limit: 50
    };
    
    // Include search term if present
    const searchTerm = document.getElementById('paymentSearch')?.value.trim();
    if (searchTerm) {
        filters.search = searchTerm;
    }
    
    currentPage = 1; // Reset to first page on filter change
    await loadPayments(filters);
}

// Handle sort
async function handleSort() {
    const sortBy = document.getElementById('sortBy').value;
    currentPage = 1; // Reset to first page on sort change
    
    const filters = getCurrentFilters();
    filters.sort = sortBy;
    await loadPayments(filters);
}

// Get current filter values
function getCurrentFilters() {
    return {
        status: document.getElementById('filterPaymentStatus')?.value || '',
        paymentMethod: document.getElementById('filterPaymentMethod')?.value || '',
        provider: document.getElementById('filterProvider')?.value || '',
        startDate: document.getElementById('startDate')?.value || '',
        endDate: document.getElementById('endDate')?.value || '',
        sort: document.getElementById('sortBy')?.value || 'newest',
        search: document.getElementById('paymentSearch')?.value.trim() || '',
        page: currentPage,
        limit: 50
    };
}

// Clear filters
async function clearFilters() {
    document.getElementById('paymentSearch').value = '';
    const filterPaymentStatus = document.getElementById('filterPaymentStatus');
    const filterPaymentMethod = document.getElementById('filterPaymentMethod');
    const filterProvider = document.getElementById('filterProvider');
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    const sortBy = document.getElementById('sortBy');
    
    if (filterPaymentStatus) filterPaymentStatus.value = '';
    if (filterPaymentMethod) filterPaymentMethod.value = '';
    if (filterProvider) filterProvider.value = '';
    if (startDate) startDate.value = '';
    if (endDate) endDate.value = '';
    if (sortBy) sortBy.value = 'newest';
    
    currentPage = 1;
    await loadPayments();
}

// Open payment details
async function openPaymentDetails(paymentId) {
    currentPaymentId = paymentId;
    const modal = document.getElementById('paymentDetailsModal');
    if (!modal) return;
    
    document.getElementById('paymentDetailsId').textContent = paymentId;
    modal.style.display = 'flex';
    
    // Load payment details from API
    await loadPaymentDetails(paymentId);
}

// Close payment details
function closePaymentDetails() {
    const modal = document.getElementById('paymentDetailsModal');
    if (modal) {
        modal.style.display = 'none';
    }
    currentPaymentId = null;
}

// Load payments from API
async function loadPayments(filters = {}) {
    try {
        // Add pagination to filters
        const filtersWithPagination = {
            ...filters,
            page: filters.page || currentPage,
            limit: filters.limit || 50
        };
        
        const result = await AdminPaymentsAPI.loadPayments(filtersWithPagination);
        renderPayments(result.payments);
        updatePaymentsCount(result.pagination.totalPayments);
        updatePagination(result.pagination);
    } catch (error) {
        console.error('Error loading payments:', error);
        showNotification(error.message || 'Failed to load payments', 'error');
        renderPayments([]);
        updatePaymentsCount(0);
    }
}

// Load payment details from API
async function loadPaymentDetails(paymentId) {
    try {
        const payment = await AdminPaymentsAPI.getPaymentById(paymentId);
        if (payment) {
            populatePaymentDetails(payment);
        } else {
            showNotification('Payment not found', 'error');
        }
    } catch (error) {
        console.error('Error loading payment details:', error);
        showNotification(error.message || 'Failed to load payment details', 'error');
    }
}

// Render payments table
function renderPayments(payments) {
    const tbody = document.getElementById('paymentsTableBody');
    if (!tbody) return;
    
    if (payments.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="empty-state">
                    <i class="fas fa-credit-card"></i>
                    <p>No payments found</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = payments.map(payment => `
        <tr>
            <td>
                <a href="#" onclick="openPaymentDetails('${payment.id}'); return false;" class="order-link">
                    ${payment.orderNumber}
                </a>
            </td>
            <td>
                <div class="customer-cell">
                    ${(() => {
                        const ci = typeof payment.customerInfo === 'string'
                            ? (() => { try { return JSON.parse(payment.customerInfo); } catch { return {}; } })()
                            : (payment.customerInfo || {});
                        return `<div class="customer-name">${ci.name || 'N/A'}</div>
                    <div class="customer-contact">${ci.email || ci.phone || ''}</div>`;
                    })()}
                </div>
            </td>
            <td>${formatDate(payment.createdAt)}</td>
            <td>${formatPaymentMethod(payment.paymentMethod)}</td>
            <td>${payment.lencoProvider ? payment.lencoProvider.toUpperCase() : '-'}</td>
            <td>K${payment.amount?.toLocaleString() || '0'}</td>
            <td>
                <span class="payment-status-badge ${getPaymentStatusClass(payment.status)}">
                    ${payment.status || 'pending'}
                </span>
            </td>
            <td>
                <span class="transaction-id">${payment.transactionId || payment.lencoTransactionId || '-'}</span>
            </td>
            <td>
                <div class="action-menu-container">
                    <button class="action-menu-btn" data-payment-id="${payment.id}" title="Actions">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                    <div class="action-menu-dropdown" id="paymentActionMenu-${payment.id}" style="display:none;">
                        <button class="action-menu-item" data-action="view" data-payment-id="${payment.id}">
                            <i class="fas fa-eye"></i>
                            <span>View Details</span>
                        </button>
                <button class="action-menu-item" data-action="order" data-payment-id="${payment.id}">
                            <i class="fas fa-shopping-cart"></i>
                            <span>View Order</span>
                        </button>
                        <button class="action-menu-item" data-action="export" data-payment-id="${payment.id}">
                            <i class="fas fa-download"></i>
                            <span>Export Data</span>
                        </button>
                        <div class="action-menu-divider"></div>
                        <button class="action-menu-item danger" data-action="delete" data-payment-id="${payment.id}">
                            <i class="fas fa-trash"></i>
                            <span>Delete</span>
                        </button>
                        ${payment.status === 'failed' ? `
                        <div class="action-menu-divider"></div>
                        <button class="action-menu-item danger" data-action="retry" data-order-number="${payment.orderNumber}">
                            <i class="fas fa-redo"></i>
                            <span>Retry Payment</span>
                        </button>` : ''}
                    </div>
                </div>
            </td>
        </tr>
    `).join('');
}

// Populate payment details
function populatePaymentDetails(payment) {
    // Parse customerInfo if it came back as a raw JSON string
    const customerInfo = typeof payment.customerInfo === 'string'
        ? (() => { try { return JSON.parse(payment.customerInfo); } catch { return {}; } })()
        : (payment.customerInfo || {});

    // Customer info
    document.getElementById('customerName').textContent = customerInfo.name || '-';
    document.getElementById('customerEmail').textContent = customerInfo.email || '-';
    document.getElementById('customerPhone').textContent = customerInfo.phone || '-';
    
    // Payment info
    document.getElementById('orderNumber').textContent = payment.orderNumber || '-';
    document.getElementById('paymentMethod').textContent = formatPaymentMethod(payment.paymentMethod);
    document.getElementById('provider').textContent = payment.lencoProvider ? payment.lencoProvider.toUpperCase() : '-';
    document.getElementById('paymentStatus').textContent = payment.status || 'pending';
    document.getElementById('paymentAmount').textContent = `K${formatCurrency(payment.amount || 0)}`;
    document.getElementById('currency').textContent = payment.currency || 'ZMW';
    
    // Transaction info
    document.getElementById('transactionId').textContent = payment.transactionId || '-';
    document.getElementById('lencoTransactionId').textContent = payment.lencoTransactionId || '-';
    document.getElementById('lencoReference').textContent = payment.lencoReference || '-';
    document.getElementById('lencoStatus').textContent = payment.lencoStatus || '-';
    
    // Timeline
    document.getElementById('createdAt').textContent = formatDate(payment.createdAt);
    document.getElementById('completedAt').textContent = payment.completedAt ? formatDate(payment.completedAt) : '-';
    document.getElementById('failedAt').textContent = payment.failedAt ? formatDate(payment.failedAt) : '-';
    document.getElementById('expiresAt').textContent = payment.expiresAt ? formatDate(payment.expiresAt) : '-';
    document.getElementById('failureReason').textContent = payment.failureReason || '-';
    syncVerifyPaymentButton(payment);
    
    // Bank details
    const bankDetailsGroup = document.getElementById('bankDetailsGroup');
    if (payment.bankDetails) {
        if (bankDetailsGroup) bankDetailsGroup.style.display = 'block';
        document.getElementById('bankName').textContent = payment.bankDetails.bankName || '-';
        document.getElementById('accountNumber').textContent = payment.bankDetails.accountNumber || '-';
        document.getElementById('accountName').textContent = payment.bankDetails.accountName || '-';
    } else {
        if (bankDetailsGroup) bankDetailsGroup.style.display = 'none';
    }
    
    // Payment instructions
    if (payment.paymentInstructions) {
        document.getElementById('paymentInstructions').innerHTML = payment.paymentInstructions.replace(/\n/g, '<br>');
    }
    
    // QR Code
    if (payment.qrCode) {
        document.getElementById('qrCodeImage').src = payment.qrCode;
        document.getElementById('qrCodeSection').style.display = 'block';
    }
    
    // Webhook data
    document.getElementById('webhookReceived').textContent = payment.webhookReceived ? 'Yes' : 'No';
    document.getElementById('webhookReceivedAt').textContent = payment.webhookReceivedAt ? formatDate(payment.webhookReceivedAt) : '-';
    
    if (payment.lencoResponse) {
        document.getElementById('lencoResponseData').textContent = JSON.stringify(payment.lencoResponse, null, 2);
    }
    
    if (payment.webhookPayload) {
        document.getElementById('webhookPayloadData').textContent = JSON.stringify(payment.webhookPayload, null, 2);
    }
}

/**
 * Verify control mirrors orders behavior:
 * - Completed payments show as "Verified" and disable action.
 * - Other statuses stay actionable.
 */
function syncVerifyPaymentButton(payment) {
    const btn = document.getElementById('verifyPaymentModalBtn');
    if (!btn) return;

    const isCompleted = payment?.status === 'completed';
    if (isCompleted) {
        btn.disabled = true;
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-outline');
        btn.innerHTML = '<i class="fas fa-check-circle"></i> Verified';
        btn.removeAttribute('title');
    } else {
        btn.disabled = false;
        btn.classList.add('btn-secondary');
        btn.classList.remove('btn-outline');
        btn.innerHTML = VERIFY_PAYMENT_BTN_DEFAULT_HTML;
        btn.setAttribute('title', 'Fetch latest status from payment provider');
    }
}

// Utility functions
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCurrency(amount) {
    return parseFloat(amount || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
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
    return status || 'pending';
}

// Action functions
function verifyPayment(paymentId) {
    openPaymentDetails(paymentId);
    // Verification is triggered from the modal button
}

/**
 * Permanently delete a payment (admin). Does not change the linked order's payment status.
 * @param {string|number} paymentId
 * @param {{ closeModalOnSuccess?: boolean }} [opts]
 */
async function deletePaymentById(paymentId, opts = {}) {
    const idStr = String(paymentId);
    const confirmed = await showConfirmDialog(
        'This permanently removes the payment record from the database. The linked order will not automatically revert to unpaid—update the order separately if needed.',
        {
            title: 'Delete payment?',
            confirmLabel: 'Delete',
            isDanger: true
        }
    );
    if (!confirmed) {
        return;
    }
    try {
        await AdminPaymentsAPI.deletePayment(idStr);
        showNotification('Payment deleted', 'success');
        if (opts.closeModalOnSuccess) {
            closePaymentDetails();
        }
        await loadPayments(getCurrentFilters());
    } catch (error) {
        console.error('Error deleting payment:', error);
        showNotification(error.message || 'Failed to delete payment', 'error');
    }
}

// Retry failed payment
async function retryPayment(orderNumber) {
    if (!orderNumber) {
        showNotification('Order number is required', 'error');
        return;
    }
    
    // Confirm retry
    if (!confirm(`Are you sure you want to retry payment for order ${orderNumber}? This will create a new payment attempt.`)) {
        return;
    }
    
    try {
        showNotification('Retrying payment...', 'info');
        
        const response = await fetch(`/api/payments/retry/${orderNumber}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Failed to retry payment');
        }
        
        showNotification('Payment retry initiated successfully. New payment instructions have been generated.', 'success');
        
        // Reload payments to show the new payment record
        setTimeout(() => {
            loadPayments();
        }, 1000);
        
    } catch (error) {
        console.error('Error retrying payment:', error);
        showNotification(error.message || 'Failed to retry payment', 'error');
    }
}

// Show notification
function showNotification(message, type = 'info') {
    // Create notification element if it doesn't exist
    let notification = document.getElementById('paymentNotification');
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'paymentNotification';
        notification.className = 'payment-notification';
        document.body.appendChild(notification);
    }
    
    // Set notification content and type
    notification.textContent = message;
    notification.className = `payment-notification payment-notification-${type}`;
    notification.style.display = 'block';
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        notification.style.display = 'none';
    }, 3000);
}

// Update payments count
function updatePaymentsCount(count) {
    const countEl = document.getElementById('paymentsCount');
    if (countEl) {
        countEl.textContent = count || 0;
    }
}

// Update pagination controls
function updatePagination(pagination) {
    if (!pagination) return;
    
    currentPage = pagination.currentPage || 1;
    totalPages = pagination.totalPages || 1;
    
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    const pageNumbers = document.getElementById('pageNumbers');
    
    if (prevBtn) {
        prevBtn.disabled = !pagination.hasPrev;
    }
    
    if (nextBtn) {
        nextBtn.disabled = !pagination.hasNext;
    }
    
    if (pageNumbers) {
        // Simple pagination display
        let html = '';
        const maxPages = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxPages / 2));
        let endPage = Math.min(totalPages, startPage + maxPages - 1);
        
        if (endPage - startPage < maxPages - 1) {
            startPage = Math.max(1, endPage - maxPages + 1);
        }
        
        for (let i = startPage; i <= endPage; i++) {
            html += `<span class="page-number ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</span>`;
        }
        
        pageNumbers.innerHTML = html;
        
        // Add click handlers to page numbers
        pageNumbers.querySelectorAll('.page-number').forEach(el => {
            el.addEventListener('click', () => {
                const page = parseInt(el.dataset.page);
                if (page !== currentPage) {
                    currentPage = page;
                    const filters = getCurrentFilters();
                    filters.page = currentPage;
                    loadPayments(filters);
                }
            });
        });
    }
}

// Setup pagination event listeners
function setupPagination() {
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                const filters = getCurrentFilters();
                filters.page = currentPage;
                loadPayments(filters);
            }
        });
    }
    
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (currentPage < totalPages) {
                currentPage++;
                const filters = getCurrentFilters();
                filters.page = currentPage;
                loadPayments(filters);
            }
        });
    }
}

// Handle export
async function handleExport() {
    try {
        // Show format selection dialog
        const format = await showExportFormatDialog();
        if (!format) {
            return; // User cancelled
        }

        // Get current filters
        const filters = getCurrentFilters();
        // Remove pagination from export filters
        delete filters.page;

        // Show loading state
        const exportBtn = document.getElementById('exportPaymentsBtn');
        if (exportBtn) {
            const originalText = exportBtn.innerHTML;
            exportBtn.disabled = true;
            exportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';

            try {
                // Build query string
                const params = new URLSearchParams({
                    format: format,
                    ...filters
                });

                // Fetch export data
                const response = await fetch(`/api/payments/export?${params}`);
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.message || 'Failed to export payments');
                }

                // Get filename from Content-Disposition header or generate one
                const contentDisposition = response.headers.get('Content-Disposition');
                let filename = `payments_export_${new Date().toISOString().split('T')[0]}.${format}`;
                
                if (contentDisposition) {
                    const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
                    if (filenameMatch) {
                        filename = filenameMatch[1];
                    }
                }

                // Get content type
                const contentType = response.headers.get('Content-Type') || 
                    (format === 'json' ? 'application/json' : 'text/csv');

                // Get blob data
                const blob = await response.blob();
                
                // Create download link and trigger download
                const downloadUrl = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(downloadUrl);

                // Show success notification
                showNotification(`Payments exported successfully as ${filename}`, 'success');
            } catch (error) {
                console.error('[Payments] Error exporting data:', error);
                showNotification(error.message || 'Failed to export payments', 'error');
            } finally {
                // Restore button state
                exportBtn.disabled = false;
                exportBtn.innerHTML = originalText;
            }
        }
    } catch (error) {
        console.error('[Payments] Error in export function:', error);
        showNotification('Failed to export payments', 'error');
    }
}

/**
 * Show export format selection dialog
 */
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
            <h2 style="margin-top: 0;">Export Payments</h2>
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

// Setup action menu event delegation
function setupActionMenu() {
    const table = document.getElementById('paymentsTable');
    if (!table) return;

    table.addEventListener('click', (e) => {
        // Menu toggle button
        const menuBtn = e.target.closest('.action-menu-btn');
        if (menuBtn) {
            e.preventDefault();
            e.stopPropagation();
            const id = menuBtn.getAttribute('data-payment-id');
            const dropdown = document.getElementById(`paymentActionMenu-${id}`);
            if (!dropdown) return;
            // Close all other menus
            document.querySelectorAll('.action-menu-dropdown').forEach(m => {
                if (m !== dropdown) m.style.display = 'none';
            });
            dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
            return;
        }

        // Menu item click
        const menuItem = e.target.closest('.action-menu-item');
        if (menuItem) {
            e.preventDefault();
            e.stopPropagation();
            const action      = menuItem.getAttribute('data-action');
            const paymentId   = menuItem.getAttribute('data-payment-id');
            const orderNumber = menuItem.getAttribute('data-order-number');
            // Close menu
            menuItem.closest('.action-menu-dropdown').style.display = 'none';

            switch (action) {
                case 'view':   openPaymentDetails(paymentId); break;
                case 'order':  goToOrder(paymentId); break;
                case 'export': exportPaymentData(paymentId); break;
                case 'delete': deletePaymentById(paymentId); break;
                case 'retry':  retryPayment(orderNumber); break;
            }
        }
    });

    // Close menus when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.action-menu-container')) {
            document.querySelectorAll('.action-menu-dropdown').forEach(m => {
                m.style.display = 'none';
            });
        }
    });
}


// Navigate to linked order
async function goToOrder(paymentId) {
    try {
        const payment = await AdminPaymentsAPI.getPaymentById(paymentId);
        if (payment && payment.orderNumber) {
            window.location.href = `/admin/orders?search=${encodeURIComponent(payment.orderNumber)}`;
        } else {
            showNotification('Order number not found for this payment', 'error');
        }
    } catch (err) {
        showNotification('Failed to get payment details', 'error');
    }
}

// Export single payment as JSON
async function exportPaymentData(paymentId) {
    try {
        const payment = await AdminPaymentsAPI.getPaymentById(paymentId);
        if (!payment) { showNotification('Payment not found', 'error'); return; }
        const blob = new Blob([JSON.stringify(payment, null, 2)], { type: 'application/json' });
        const url  = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `payment_${(payment.orderNumber || paymentId).replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        showNotification('Payment data exported', 'success');
    } catch (err) {
        showNotification('Failed to export payment data', 'error');
    }
}

// Make functions globally available
window.openPaymentDetails = openPaymentDetails;
window.verifyPayment = verifyPayment;

