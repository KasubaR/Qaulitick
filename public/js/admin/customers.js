// Admin Customers Management JavaScript

let currentPage = 1;
let totalPages = 1;
let currentCustomerEmail = null;
let currentFilters = {};
let currentSortBy = 'newest';

document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication before initializing
    const isAuthenticated = await window.AuthUtils?.initializeAuthCheck();
    if (!isAuthenticated) {
        return; // Redirect will happen in initializeAuthCheck
    }
    
    initializeCustomersPage();
    setupEventListeners();
    loadCustomers();
    loadCustomerStats();
});

// Initialize customers page
function initializeCustomersPage() {
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

    const customerSearch = document.getElementById('customerSearch');
    if (customerSearch) {
        customerSearch.addEventListener('keypress', (e) => {
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

    // Export button
    const exportBtn = document.getElementById('exportCustomersBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', handleExport);
    }

    // Pagination
    setupPagination();

    // Action menu event delegation
    setupActionMenu();

    // Modals
    setupModals();
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
    // Customer details modal
    const closeCustomerModal = document.getElementById('closeCustomerModal');
    const closeCustomerDetailsBtn = document.getElementById('closeCustomerDetailsBtn');
    const customerDetailsModal = document.getElementById('customerDetailsModal');
    
    if (closeCustomerModal) {
        closeCustomerModal.addEventListener('click', () => closeCustomerDetails());
    }
    
    if (closeCustomerDetailsBtn) {
        closeCustomerDetailsBtn.addEventListener('click', () => closeCustomerDetails());
    }
    
    if (customerDetailsModal) {
        customerDetailsModal.addEventListener('click', (e) => {
            if (e.target === customerDetailsModal) {
                closeCustomerDetails();
            }
        });
    }
}

// Handle search
async function handleSearch() {
    const searchTerm = document.getElementById('customerSearch').value.trim();
    currentFilters.search = searchTerm || undefined;
    currentPage = 1;
    await loadCustomers();
}

// Handle filter
async function handleFilter() {
    const customerType = document.getElementById('filterCustomerType')?.value || '';
    const startDate = document.getElementById('startDate')?.value || '';
    const endDate = document.getElementById('endDate')?.value || '';
    
    currentFilters.customerType = customerType || undefined;
    currentFilters.startDate = startDate || undefined;
    currentFilters.endDate = endDate || undefined;
    
    currentPage = 1;
    await loadCustomers();
}

// Handle sort
async function handleSort() {
    const sortBy = document.getElementById('sortBy').value;
    currentSortBy = sortBy;
    currentPage = 1;
    await loadCustomers();
}

// Clear filters
async function clearFilters() {
    document.getElementById('customerSearch').value = '';
    const filterCustomerType = document.getElementById('filterCustomerType');
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    const sortBy = document.getElementById('sortBy');
    
    if (filterCustomerType) filterCustomerType.value = '';
    if (startDate) startDate.value = '';
    if (endDate) endDate.value = '';
    if (sortBy) sortBy.value = 'newest';
    
    currentFilters = {};
    currentSortBy = 'newest';
    currentPage = 1;
    await loadCustomers();
}

// Handle export
async function handleExport() {
    try {
        // Show format selection modal or use default CSV
        const format = confirm('Export as CSV? (Cancel for JSON)') ? 'csv' : 'json';
        
        const exportBtn = document.getElementById('exportCustomersBtn');
        if (exportBtn) {
            exportBtn.disabled = true;
            exportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';
        }
        
        const result = await AdminCustomersAPI.exportCustomers(format, { ...currentFilters, sortBy: currentSortBy });
        
        showNotification(`Successfully exported ${result.count} customers to ${result.format.toUpperCase()}`, 'success');
        
        if (exportBtn) {
            exportBtn.disabled = false;
            exportBtn.innerHTML = '<i class="fas fa-download"></i> Export';
        }
    } catch (error) {
        console.error('Error exporting customers:', error);
        showNotification(error.message || 'Failed to export customers', 'error');
        
        const exportBtn = document.getElementById('exportCustomersBtn');
        if (exportBtn) {
            exportBtn.disabled = false;
            exportBtn.innerHTML = '<i class="fas fa-download"></i> Export';
        }
    }
}

// Open customer details
async function openCustomerDetails(customerEmail) {
    currentCustomerEmail = customerEmail;
    const modal = document.getElementById('customerDetailsModal');
    if (!modal) return;
    
    modal.style.display = 'flex';
    
    // Load customer details from API
    await loadCustomerDetails(customerEmail);
}

// Close customer details
function closeCustomerDetails() {
    const modal = document.getElementById('customerDetailsModal');
    if (modal) {
        modal.style.display = 'none';
    }
    currentCustomerEmail = null;
}

// Load customers from API
async function loadCustomers() {
    try {
        const tbody = document.getElementById('customersTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Loading customers...</td></tr>';
        }

        const filters = {
            ...currentFilters,
            sortBy: currentSortBy
        };

        const pagination = {
            page: currentPage,
            limit: 50
        };

        const result = await AdminCustomersAPI.loadCustomers(filters, pagination);
        
        renderCustomers(result.customers);
        updateCustomersCount(result.pagination.totalCount);
        updatePagination(result.pagination);
        
        // Update stats if provided
        if (result.stats) {
            updateCustomersStats(result.stats);
        }
    } catch (error) {
        console.error('Error loading customers:', error);
        showNotification(error.message || 'Failed to load customers', 'error');
        
        const tbody = document.getElementById('customersTableBody');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state error">
                        <i class="fas fa-exclamation-triangle"></i>
                        <p>Failed to load customers. <button class="btn-link" onclick="loadCustomers()">Retry</button></p>
                    </td>
                </tr>
            `;
        }
    }
}

// Load customer statistics
async function loadCustomerStats() {
    try {
        const stats = await AdminCustomersAPI.getCustomerStats();
        updateCustomersStats(stats);
    } catch (error) {
        console.error('Error loading customer stats:', error);
        // Don't show error notification for stats, just log it
    }
}

// Load customer details from API
async function loadCustomerDetails(customerEmail) {
    try {
        const customerData = await AdminCustomersAPI.getCustomerByEmail(customerEmail);
        
        if (!customerData) {
            throw new Error('Customer not found');
        }
        
        populateCustomerDetails(customerData.customer);
        loadCustomerOrders(customerData.orders || []);
        loadCustomerPayments(customerData.payments || []);
    } catch (error) {
        console.error('Error loading customer details:', error);
        showNotification(error.message || 'Failed to load customer details', 'error');
    }
}

// Render customers table
function renderCustomers(customers) {
    const tbody = document.getElementById('customersTableBody');
    if (!tbody) return;
    
    if (customers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">
                    <i class="fas fa-users"></i>
                    <p>No customers found</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = customers.map(customer => {
        const status = getCustomerStatus(customer);
        const safeEmail = escapeHtml(customer.email || '');
        const customerEmail = customer.email || '';
        
        return `
        <tr>
            <td>
                <div class="customer-cell">
                    <div class="customer-name">${escapeHtml(customer.name || 'N/A')}</div>
                    <div class="customer-email">${safeEmail}</div>
                </div>
            </td>
            <td>
                <div class="contact-cell">
                    <div><a href="mailto:${safeEmail}">${safeEmail}</a></div>
                    <div>${escapeHtml(customer.phone || '-')}</div>
                </div>
            </td>
            <td>${customer.totalOrders || 0}</td>
            <td>K${formatCurrency(customer.totalSpent || 0)}</td>
            <td>${formatDate(customer.lastOrderDate)}</td>
            <td>
                <span class="customer-status-badge ${status.class}">
                    ${status.label}
                </span>
            </td>
            <td>
                <div class="action-menu-container">
                    <button class="action-menu-btn" data-customer-email="${customerEmail}">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                    <div class="action-menu-dropdown" id="customerActionMenu-${customerEmail}" style="display: none;">
                        <button class="action-menu-item" data-action="view" data-customer-email="${customerEmail}">
                            <i class="fas fa-eye"></i>
                            <span>View Details</span>
                        </button>
                        <button class="action-menu-item" data-action="orders" data-customer-email="${customerEmail}">
                            <i class="fas fa-shopping-cart"></i>
                            <span>View Orders</span>
                        </button>
                        <button class="action-menu-item" data-action="export" data-customer-email="${customerEmail}">
                            <i class="fas fa-download"></i>
                            <span>Export Data</span>
                        </button>
                    </div>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

// Get customer status
function getCustomerStatus(customer) {
    if (customer.status === 'vip' || customer.totalSpent >= 10000) {
        return { class: 'vip', label: 'VIP' };
    } else if (customer.status === 'new') {
        return { class: 'new', label: 'New' };
    } else {
        return { class: 'active', label: 'Active' };
    }
}

// Setup action menu event delegation
function setupActionMenu() {
    const customersTable = document.getElementById('customersTable');
    if (customersTable) {
        customersTable.addEventListener('click', (e) => {
            // Handle menu button clicks
            const menuBtn = e.target.closest('.action-menu-btn');
            if (menuBtn) {
                e.preventDefault();
                e.stopPropagation();
                
                const email = menuBtn.getAttribute('data-customer-email');
                const menuId = `customerActionMenu-${email}`;
                const dropdown = document.getElementById(menuId);
                
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
                const email = menuItem.getAttribute('data-customer-email');
                
                if (!action || !email) return;
                
                // Close the menu
                const dropdown = menuItem.closest('.action-menu-dropdown');
                if (dropdown) {
                    dropdown.style.display = 'none';
                }
                
                switch (action) {
                    case 'view':
                        openCustomerDetails(email);
                        break;
                    case 'orders':
                        viewCustomerOrders(email);
                        break;
                    case 'export':
                        exportCustomerData(email);
                        break;
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

// Setup pagination
function setupPagination() {
    const prevPage = document.getElementById('prevPage');
    const nextPage = document.getElementById('nextPage');
    
    if (prevPage) {
        prevPage.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                loadCustomers();
            }
        });
    }
    
    if (nextPage) {
        nextPage.addEventListener('click', () => {
            if (currentPage < totalPages) {
                currentPage++;
                loadCustomers();
            }
        });
    }
}

// Update pagination controls
function updatePagination(pagination) {
    if (!pagination) return;
    
    totalPages = pagination.totalPages || 1;
    currentPage = pagination.currentPage || 1;
    
    const prevPage = document.getElementById('prevPage');
    const nextPage = document.getElementById('nextPage');
    const pageNumbers = document.getElementById('pageNumbers');
    
    if (prevPage) {
        prevPage.disabled = currentPage === 1;
    }
    
    if (nextPage) {
        nextPage.disabled = currentPage >= totalPages;
    }
    
    if (pageNumbers) {
        // Simple pagination display (can be enhanced later)
        const pages = [];
        const maxVisible = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
        let endPage = Math.min(totalPages, startPage + maxVisible - 1);
        
        if (endPage - startPage < maxVisible - 1) {
            startPage = Math.max(1, endPage - maxVisible + 1);
        }
        
        for (let i = startPage; i <= endPage; i++) {
            pages.push(i);
        }
        
        pageNumbers.innerHTML = pages.map(page => `
            <span class="page-number ${page === currentPage ? 'active' : ''}" 
                  onclick="if (${page} !== ${currentPage}) { currentPage = ${page}; loadCustomers(); }">
                ${page}
            </span>
        `).join('');
    }
}

// Export customer data
async function exportCustomerData(email) {
    try {
        const customerData = await AdminCustomersAPI.getCustomerByEmail(email);
        
        if (!customerData) {
            throw new Error('Customer not found');
        }
        
        const exportData = {
            customer: customerData.customer,
            orders: customerData.orders,
            payments: customerData.payments
        };
        
        const content = JSON.stringify(exportData, null, 2);
        const blob = new Blob([content], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `customer_${email.replace(/[@.]/g, '_')}_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        
        showNotification('Customer data exported successfully', 'success');
    } catch (error) {
        console.error('Error exporting customer data:', error);
        showNotification(error.message || 'Failed to export customer data', 'error');
    }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Populate customer details
function populateCustomerDetails(customer) {
    document.getElementById('customerDetailsName').textContent = customer.name || 'N/A';
    document.getElementById('customerName').textContent = customer.name || '-';
    document.getElementById('customerEmail').textContent = customer.email || '-';
    document.getElementById('customerPhone').textContent = customer.phone || '-';
    
    document.getElementById('totalOrders').textContent = customer.totalOrders || 0;
    document.getElementById('totalSpent').textContent = `K${formatCurrency(customer.totalSpent || 0)}`;
    document.getElementById('averageOrderValue').textContent = `K${formatCurrency(customer.averageOrderValue || 0)}`;
    document.getElementById('firstOrderDate').textContent = formatDate(customer.firstOrderDate);
    document.getElementById('lastOrderDate').textContent = formatDate(customer.lastOrderDate);
}

// Load customer orders
function loadCustomerOrders(orders) {
    const container = document.getElementById('customerOrdersList');
    if (!container) return;
    
    if (!orders || orders.length === 0) {
        container.innerHTML = '<p class="empty-state">No orders found</p>';
        return;
    }
    
    container.innerHTML = orders.map(order => `
        <div class="order-item-card" onclick="viewOrder('${escapeHtml(order.orderNumber)}')">
            <div class="order-item-info">
                <div class="order-item-title">${escapeHtml(order.orderNumber)}</div>
                <div class="order-item-meta">
                    <span>${formatDate(order.createdAt)}</span>
                    <span>Status: ${escapeHtml(order.status)}</span>
                </div>
            </div>
            <div class="order-item-amount">
                <div class="amount-value">K${formatCurrency(order.total || 0)}</div>
                <div class="amount-label">${order.itemCount || 0} item(s)</div>
            </div>
        </div>
    `).join('');
}

// Load customer payments
function loadCustomerPayments(payments) {
    const container = document.getElementById('customerPaymentsList');
    if (!container) return;
    
    if (!payments || payments.length === 0) {
        container.innerHTML = '<p class="empty-state">No payments found</p>';
        return;
    }
    
    container.innerHTML = payments.map(payment => `
        <div class="payment-item-card" onclick="viewPayment('${escapeHtml(payment.orderNumber)}')">
            <div class="payment-item-info">
                <div class="payment-item-title">${escapeHtml(payment.orderNumber)}</div>
                <div class="payment-item-meta">
                    <span>${formatDate(payment.createdAt)}</span>
                    <span>${formatPaymentMethod(payment.paymentMethod)}</span>
                    <span class="payment-status-badge ${escapeHtml(payment.status)}">${escapeHtml(payment.status)}</span>
                </div>
            </div>
            <div class="payment-item-amount">
                <div class="amount-value">K${formatCurrency(payment.amount || 0)}</div>
                <div class="amount-label">${escapeHtml(payment.currency || 'ZMW')}</div>
            </div>
        </div>
    `).join('');
}

// Update customers statistics
function updateCustomersStats(stats) {
    if (!stats) return;
    
    const totalCustomers = document.getElementById('totalCustomers');
    const activeCustomers = document.getElementById('activeCustomers');
    const newCustomers = document.getElementById('newCustomers');
    const totalRevenue = document.getElementById('totalRevenue');
    
    if (totalCustomers) totalCustomers.textContent = stats.totalCustomers || 0;
    if (activeCustomers) activeCustomers.textContent = stats.activeCustomers || 0;
    if (newCustomers) newCustomers.textContent = stats.newCustomers || 0;
    if (totalRevenue) totalRevenue.textContent = `K${formatCurrency(stats.totalRevenue || 0)}`;
}

// Update customers count
function updateCustomersCount(count) {
    const countEl = document.getElementById('customersCount');
    if (countEl) {
        countEl.textContent = count || 0;
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

// Action functions
function viewCustomerOrders(customerEmail) {
    openCustomerDetails(customerEmail);
    // Switch to orders tab
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.dataset.tab === 'orders') {
            btn.click();
        }
    });
}

function viewOrder(orderNumber) {
    window.location.href = `/admin/orders?view=${orderNumber}`;
}

function viewPayment(paymentId) {
    window.location.href = `/admin/payments?view=${paymentId}`;
}

// Show notification
function showNotification(message, type = 'info') {
    // Create notification element if it doesn't exist
    let notification = document.getElementById('customerNotification');
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'customerNotification';
        notification.className = 'customer-notification';
        document.body.appendChild(notification);
    }
    
    // Set notification content and type
    notification.textContent = message;
    notification.className = `customer-notification customer-notification-${type}`;
    notification.style.display = 'block';
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        notification.style.display = 'none';
    }, 3000);
}

// ── Registered Users Section ─────────────────────────────────────────────────

let regCurrentPage = 1;
let regTotalPages = 1;
let regSearch = '';

function switchSection(section) {
    const custSection = document.getElementById('sectionCustomers');
    const regSection  = document.getElementById('sectionRegistered');
    const btnCust     = document.getElementById('btnSectionCustomers');
    const btnReg      = document.getElementById('btnSectionRegistered');

    if (section === 'registered') {
        custSection.style.display = 'none';
        regSection.style.display  = 'block';
        btnCust.classList.remove('active');
        btnReg.classList.add('active');
        loadRegisteredUsers();
    } else {
        regSection.style.display  = 'none';
        custSection.style.display = 'block';
        btnReg.classList.remove('active');
        btnCust.classList.add('active');
    }
}

async function loadRegisteredUsers() {
    const tbody = document.getElementById('registeredTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Loading...</td></tr>';

    try {
        const params = new URLSearchParams({ page: regCurrentPage, limit: 50 });
        if (regSearch) params.set('search', regSearch);

        const res = await fetch(`/api/admin/registered-users?${params}`, {
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
        });
        if (!res.ok) throw new Error('Failed to fetch');
        const json = await res.json();

        renderRegisteredUsers(json.data || []);
        updateRegPagination(json.pagination || {});

        const countEl = document.getElementById('registeredCount');
        if (countEl) countEl.textContent = json.pagination?.totalCount || 0;
        const totalEl = document.getElementById('totalRegistered');
        if (totalEl) totalEl.textContent = json.pagination?.totalCount || 0;
    } catch (err) {
        console.error(err);
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="empty-state error"><i class="fas fa-exclamation-triangle"></i><p>Failed to load users.</p></td></tr>';
    }
}

function renderRegisteredUsers(users) {
    const tbody = document.getElementById('registeredTableBody');
    if (!tbody) return;

    if (!users.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><i class="fas fa-user-shield"></i><p>No registered users found</p></td></tr>';
        return;
    }

    tbody.innerHTML = users.map(u => {
        const verified = u.emailVerifiedAt
            ? `<span style="color:#2e7d32;font-weight:500;"><i class="fas fa-check-circle"></i> Verified</span>`
            : `<span style="color:#c62828;"><i class="fas fa-times-circle"></i> Unverified</span>`;
        return `
        <tr>
            <td>${escapeHtml(u.name || '-')}</td>
            <td><a href="mailto:${escapeHtml(u.email || '')}">${escapeHtml(u.email || '-')}</a></td>
            <td>${escapeHtml(u.phone || '-')}</td>
            <td>${verified}</td>
            <td>${formatDate(u.createdAt)}</td>
        </tr>`;
    }).join('');
}

function updateRegPagination(pagination) {
    regTotalPages   = pagination.totalPages  || 1;
    regCurrentPage  = pagination.currentPage || 1;

    const prev    = document.getElementById('regPrevPage');
    const next    = document.getElementById('regNextPage');
    const nums    = document.getElementById('regPageNumbers');

    if (prev) prev.disabled = regCurrentPage === 1;
    if (next) next.disabled = regCurrentPage >= regTotalPages;

    if (nums) {
        const maxV = 5;
        let start = Math.max(1, regCurrentPage - Math.floor(maxV / 2));
        let end   = Math.min(regTotalPages, start + maxV - 1);
        if (end - start < maxV - 1) start = Math.max(1, end - maxV + 1);
        const pages = [];
        for (let i = start; i <= end; i++) pages.push(i);
        nums.innerHTML = pages.map(p => `
            <span class="page-number ${p === regCurrentPage ? 'active' : ''}"
                  onclick="if(${p}!==${regCurrentPage}){regCurrentPage=${p};loadRegisteredUsers();}">
                ${p}
            </span>`).join('');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const searchBtn = document.getElementById('registeredSearchBtn');
    if (searchBtn) searchBtn.addEventListener('click', () => {
        regSearch = document.getElementById('registeredSearch')?.value.trim() || '';
        regCurrentPage = 1;
        loadRegisteredUsers();
    });
    const searchInput = document.getElementById('registeredSearch');
    if (searchInput) searchInput.addEventListener('keypress', e => {
        if (e.key === 'Enter') {
            regSearch = searchInput.value.trim();
            regCurrentPage = 1;
            loadRegisteredUsers();
        }
    });
    const prevBtn = document.getElementById('regPrevPage');
    if (prevBtn) prevBtn.addEventListener('click', () => {
        if (regCurrentPage > 1) { regCurrentPage--; loadRegisteredUsers(); }
    });
    const nextBtn = document.getElementById('regNextPage');
    if (nextBtn) nextBtn.addEventListener('click', () => {
        if (regCurrentPage < regTotalPages) { regCurrentPage++; loadRegisteredUsers(); }
    });
});

// Make functions globally available
window.openCustomerDetails = openCustomerDetails;
window.viewCustomerOrders = viewCustomerOrders;
window.viewOrder = viewOrder;
window.viewPayment = viewPayment;
window.loadCustomers = loadCustomers;
window.exportCustomerData = exportCustomerData;
window.switchSection = switchSection;

