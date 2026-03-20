// Admin Dashboard JavaScript

// Global chart instances
let salesChart = null;
let revenueChart = null;

// Real-time update interval
let updateInterval = null;
let lastUpdateTime = null; // Track last successful update time for efficient polling

// Pagination state for Recent Orders
let recentOrdersPagination = {
    currentPage: 1,
    totalPages: 1,
    totalCount: 0,
    limit: 10
};

// Retry configuration
const RETRY_CONFIG = {
    maxRetries: 3,
    baseDelay: 1000, // 1 second
    maxDelay: 10000 // 10 seconds
};

// Track retry attempts for each function
const retryAttempts = new Map();

// Fetch with timeout helper
function fetchWithTimeout(url, options = {}, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('Request timeout'));
        }, timeout);
        
        fetch(url, options)
            .then(response => {
                clearTimeout(timer);
                resolve(response);
            })
            .catch(error => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication before initializing
    const isAuthenticated = await window.AuthUtils?.initializeAuthCheck();
    if (!isAuthenticated) {
        return; // Redirect will happen in initializeAuthCheck
    }
    
    initializeDashboard();
    setupEventListeners();
    setupRecentOrdersPagination();
    loadDashboardData();
    // Removed automatic refresh - dashboard only updates on manual page refresh
    // startRealTimeUpdates();
});

// Initialize dashboard
function initializeDashboard() {
    setupSidebar();
    setupCharts();
}

// Load all dashboard data with graceful degradation
async function loadDashboardData() {
    // Initialize lastUpdateTime before loading
    lastUpdateTime = null; // Will be set after first successful API call
    
    // Load all data in parallel, but don't fail if one fails (graceful degradation)
    const loadPromises = [
        loadKPIData().catch(err => {
            console.error('[Dashboard] KPI data failed:', err);
            return null; // Continue even if this fails
        }),
        loadRecentOrders().catch(err => {
            console.error('[Dashboard] Recent orders failed:', err);
            return null;
        }),
        loadLowStockProducts().catch(err => {
            console.error('[Dashboard] Low stock products failed:', err);
            return null;
        }),
        loadBestSellingProducts().catch(err => {
            console.error('[Dashboard] Best selling products failed:', err);
            return null;
        }),
        loadTopCustomers().catch(err => {
            console.error('[Dashboard] Top customers failed:', err);
            return null;
        }),
        updateOrderSummary().catch(err => {
            console.error('[Dashboard] Order summary failed:', err);
            return null;
        })
    ];
    
    try {
        await Promise.allSettled(loadPromises);
        
        // Set lastUpdateTime after initial load completes (even if some failed)
        if (!lastUpdateTime) {
            lastUpdateTime = new Date();
        }
        
        // Show summary notification if some loads failed
        const results = await Promise.all(loadPromises);
        const failedCount = results.filter(r => r === null).length;
        if (failedCount > 0 && failedCount < loadPromises.length) {
            showNotification(
                `Dashboard loaded with ${failedCount} component${failedCount > 1 ? 's' : ''} unavailable. Some data may be incomplete.`,
                'info',
                5000
            );
        }
    } catch (error) {
        console.error('[Dashboard] Critical error loading dashboard data:', error);
        // Set lastUpdateTime even on error to prevent repeated full refreshes
        if (!lastUpdateTime) {
            lastUpdateTime = new Date();
        }
        showError('Some dashboard components failed to load. Please refresh the page.', 8000);
    }
}

// Setup event listeners
function setupEventListeners() {
    // Sidebar toggle (mobile)
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
        console.log('[Dashboard] Sidebar toggle button found');
        // Use onclick to ensure it works
        sidebarToggle.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('[Dashboard] Sidebar toggle button clicked');
            toggleSidebar(e);
            return false;
        };
    } else {
        console.error('[Dashboard] Sidebar toggle button not found!');
    }

    // Notifications dropdown
    const notificationsBtn = document.getElementById('notificationsBtn');
    if (notificationsBtn) {
        notificationsBtn.addEventListener('click', toggleNotifications);
    }

    // Profile dropdown
    const adminProfile = document.querySelector('.admin-profile');
    if (adminProfile) {
        adminProfile.addEventListener('click', toggleProfile);
    }

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.header-actions')) {
            closeDropdowns();
        }
    });

    // Chart period buttons
    const chartBtns = document.querySelectorAll('.chart-btn');
    chartBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            chartBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const period = btn.dataset.period;
            // Update both charts with the selected period
            updateCharts(period);
        });
    });

    // Quick action buttons
    setupQuickActions();

    // Search functionality
    const adminSearch = document.getElementById('adminSearch');
    if (adminSearch) {
        adminSearch.addEventListener('input', debounce((e) => {
            const query = e.target.value.trim();
            if (query.length > 0) {
                handleSearch(query);
            }
        }, 300));
    }
}

// Setup sidebar
function setupSidebar() {
    // TODO: Highlight active nav item based on current route
    const currentPath = window.location.pathname;
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        if (item.getAttribute('href') === currentPath) {
            item.classList.add('active');
        }
    });
}

// Toggle sidebar (mobile)
function toggleSidebar(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    const sidebar = document.getElementById('adminSidebar');
    if (!sidebar) {
        console.error('[Dashboard] Sidebar not found');
        return;
    }
    
    console.log('[Dashboard] Toggling sidebar, current state:', sidebar.classList.contains('active'));
    
    sidebar.classList.toggle('active');
    
    // Add/remove body class for overlay
    if (sidebar.classList.contains('active')) {
        document.body.classList.add('sidebar-open');
        document.body.style.overflow = 'hidden';
        console.log('[Dashboard] Sidebar opened');
    } else {
        document.body.classList.remove('sidebar-open');
        document.body.style.overflow = '';
        console.log('[Dashboard] Sidebar closed');
    }
}

// Close sidebar when clicking outside (on overlay)
document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('adminSidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    
    if (sidebar && sidebar.classList.contains('active')) {
        // If clicking outside sidebar and not on toggle button
        if (!sidebar.contains(e.target) && !sidebarToggle?.contains(e.target)) {
            sidebar.classList.remove('active');
            document.body.classList.remove('sidebar-open');
            document.body.style.overflow = '';
        }
    }
});

// Toggle notifications dropdown
function toggleNotifications() {
    const dropdown = document.getElementById('notificationsDropdown');
    const profileDropdown = document.getElementById('profileDropdown');
    
    if (dropdown) {
        const isVisible = dropdown.style.display !== 'none';
        dropdown.style.display = isVisible ? 'none' : 'block';
        
        // Load notifications when opening dropdown
        if (!isVisible) {
            loadNotifications();
        }
    }
    if (profileDropdown) {
        profileDropdown.style.display = 'none';
    }
}

// Toggle profile dropdown
function toggleProfile() {
    const dropdown = document.getElementById('profileDropdown');
    const notificationsDropdown = document.getElementById('notificationsDropdown');
    
    if (dropdown) {
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    }
    if (notificationsDropdown) {
        notificationsDropdown.style.display = 'none';
    }
}

// Close all dropdowns
function closeDropdowns() {
    const dropdowns = document.querySelectorAll('.notifications-dropdown, .profile-dropdown');
    dropdowns.forEach(dropdown => {
        dropdown.style.display = 'none';
    });
}

// Setup charts (Chart.js)
function setupCharts() {
    // Sales Chart
    const salesCtx = document.getElementById('salesChart');
    if (salesCtx) {
        // Show loading state
        const salesContainer = salesCtx.closest('.chart-container');
        if (salesContainer) {
            const loadingOverlay = document.createElement('div');
            loadingOverlay.id = 'salesChartLoading';
            loadingOverlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10;
                color: #aaa;
                text-align: center;
            `;
            loadingOverlay.innerHTML = `
                <div>
                    <i class="fas fa-spinner fa-spin" style="font-size: 24px; margin-bottom: 10px; display: block;"></i>
                    <span>Loading chart data...</span>
                </div>
            `;
            salesContainer.style.position = 'relative';
            salesContainer.appendChild(loadingOverlay);
        }
        
        salesChart = new Chart(salesCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Sales',
                    data: [],
                    borderColor: 'rgb(255, 238, 193)',
                    backgroundColor: 'rgba(255, 238, 193, 0.1)',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: '#aaa'
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)'
                        }
                    },
                    x: {
                        ticks: {
                            color: '#aaa'
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)'
                        }
                    }
                }
            }
        });
    }

    // Revenue Chart
    const revenueCtx = document.getElementById('revenueChart');
    if (revenueCtx) {
        // Show loading state
        const revenueContainer = revenueCtx.closest('.chart-container');
        if (revenueContainer) {
            const loadingOverlay = document.createElement('div');
            loadingOverlay.id = 'revenueChartLoading';
            loadingOverlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10;
                color: #aaa;
                text-align: center;
            `;
            loadingOverlay.innerHTML = `
                <div>
                    <i class="fas fa-spinner fa-spin" style="font-size: 24px; margin-bottom: 10px; display: block;"></i>
                    <span>Loading chart data...</span>
                </div>
            `;
            revenueContainer.style.position = 'relative';
            revenueContainer.appendChild(loadingOverlay);
        }
        
        revenueChart = new Chart(revenueCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'Revenue',
                    data: [],
                    backgroundColor: 'rgba(255, 238, 193, 0.3)',
                    borderColor: 'rgb(255, 238, 193)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: '#aaa',
                            callback: function(value) {
                                return 'K' + value.toLocaleString();
                            }
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)'
                        }
                    },
                    x: {
                        ticks: {
                            color: '#aaa'
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)'
                        }
                    }
                }
            }
        });
        
        // Load initial chart data for both charts
        // Sales chart uses 'daily' period, revenue chart uses 'monthly' period by default
        updateCharts('daily');
    }
}

// Setup quick actions
function setupQuickActions() {
    // TODO: Implement quick action handlers
    
    document.getElementById('addProductBtn')?.addEventListener('click', () => {
        // TODO: Navigate to add product page
        window.location.href = '/admin/products/new';
    });

    document.getElementById('createCouponBtn')?.addEventListener('click', () => {
        // TODO: Open coupon creation modal or navigate to coupon page
        window.location.href = '/admin/coupons/new';
    });

    document.getElementById('flashSaleBtn')?.addEventListener('click', () => {
        window.location.href = '/admin/marketing/flash-sales';
    });

    document.getElementById('sendNotificationBtn')?.addEventListener('click', () => {
        openNotificationModal();
    });

    document.getElementById('exportReportBtn')?.addEventListener('click', () => {
        exportDashboardReport();
    });

    document.getElementById('viewAnalyticsBtn')?.addEventListener('click', () => {
        window.location.href = '/admin/analytics';
    });
}

// Load KPI data from API with retry logic
async function loadKPIData() {
    const kpiCards = document.querySelectorAll('.kpi-card');
    const isLoading = !lastUpdateTime; // Show loading only on initial load
    
    // Show loading state on initial load
    if (isLoading) {
        kpiCards.forEach(card => {
            const valueEl = card.querySelector('.kpi-value');
            if (valueEl) {
                valueEl.style.opacity = '0.5';
                valueEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            }
        });
    }
    
    try {
        await retryWithBackoff(async () => {
            // Build URL with updatedSince parameter for efficient polling
            let url = '/api/admin/dashboard/stats';
            if (lastUpdateTime) {
                url += `?updatedSince=${encodeURIComponent(lastUpdateTime.toISOString())}`;
            }
            
            const response = await fetchWithTimeout(url, {}, 10000);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success || !result.data) {
                throw new Error('Invalid response format');
            }
            
            const data = result.data;
        
        // Update KPI cards
            const totalSalesEl = document.getElementById('totalSales');
            const totalOrdersEl = document.getElementById('totalOrders');
            const totalCustomersEl = document.getElementById('totalCustomers');
            const totalProductsEl = document.getElementById('totalProducts');
            const totalRevenueEl = document.getElementById('totalRevenue');
            const lowStockCountEl = document.getElementById('lowStockCount');
            
            if (totalSalesEl) {
                totalSalesEl.textContent = formatCurrency(data.totalSales || 0);
                totalSalesEl.style.opacity = '1';
            }
            if (totalOrdersEl) {
                totalOrdersEl.textContent = (data.totalOrders || 0).toLocaleString();
                totalOrdersEl.style.opacity = '1';
            }
            if (totalCustomersEl) {
                totalCustomersEl.textContent = (data.totalCustomers || 0).toLocaleString();
                totalCustomersEl.style.opacity = '1';
            }
            if (totalProductsEl) {
                totalProductsEl.textContent = (data.totalProducts || 0).toLocaleString();
                totalProductsEl.style.opacity = '1';
            }
            if (totalRevenueEl) {
                totalRevenueEl.textContent = formatCurrency(data.totalRevenue || 0);
                totalRevenueEl.style.opacity = '1';
            }
            if (lowStockCountEl) {
                lowStockCountEl.textContent = (data.lowStockCount || 0).toLocaleString();
                lowStockCountEl.style.opacity = '1';
            }
            
            // Update change indicators
            updateChangeIndicator('salesChange', data.salesChange);
            updateChangeIndicator('ordersChange', data.ordersChange);
            updateChangeIndicator('customersChange', data.customersChange);
            updateChangeIndicator('revenueChange', data.revenueChange);
            updateChangeIndicator('productsChange', data.productsChange || 0);
            
            // Update lastUpdateTime if timestamp is provided
            if (result.timestamp) {
                lastUpdateTime = new Date(result.timestamp);
            }
            
            return result;
        }, 'loadKPIData');
        
    } catch (error) {
        console.error('[Dashboard] Error loading KPI data:', error);
        
        // Reset loading state
        kpiCards.forEach(card => {
            const valueEl = card.querySelector('.kpi-value');
            if (valueEl) {
                valueEl.style.opacity = '1';
                if (valueEl.innerHTML.includes('fa-spinner')) {
                    valueEl.textContent = 'Error';
                    valueEl.style.color = '#ff4444';
                }
            }
        });
        
        // Show error notification only on initial load
        if (isLoading) {
            const errorMsg = error.message === 'Request timeout' || error.name === 'TimeoutError'
                ? 'Request timed out. Please check your connection.'
                : error.message || 'Failed to load dashboard statistics';
            showError(errorMsg, 5000);
        }
        // Graceful degradation: continue with other data loads
    }
}

/**
 * Update change indicator with color and icon
 * @param {string|HTMLElement} elementId - Element ID or element itself
 * @param {number} value - Change value (percentage)
 * @param {boolean} [isPositive] - Optional override for positive/negative (auto-detected if not provided)
 * @example
 * updateChangeIndicator('salesChange', 15.5) // Auto-detects positive
 * updateChangeIndicator('ordersChange', -5.2) // Auto-detects negative
 * updateChangeIndicator('revenueChange', 0, true) // Force positive display
 */
function updateChangeIndicator(elementId, value, isPositive = null) {
    // Support both element ID string and element object
    const element = typeof elementId === 'string' 
        ? document.getElementById(elementId) 
        : elementId;
    
    if (!element) {
        console.warn('[Dashboard] updateChangeIndicator: Element not found', elementId);
        return;
    }
    
    const changeValue = value || 0;
    
    // Auto-detect positive/negative if not explicitly provided
    if (isPositive === null) {
        isPositive = changeValue > 0;
    }
    
    const isNegative = changeValue < 0 && !isPositive;
    const isNeutral = changeValue === 0 || (!isPositive && !isNegative);
    
    // Update class
    element.className = 'kpi-change';
    if (isPositive) {
        element.classList.add('positive');
    } else if (isNegative) {
        element.classList.add('negative');
    } else {
        element.classList.add('neutral');
    }
    
    // Update icon
    let icon = element.querySelector('i');
    if (!icon) {
        icon = document.createElement('i');
        element.insertBefore(icon, element.firstChild);
    }
    icon.className = isPositive 
        ? 'fas fa-arrow-up' 
        : isNegative 
            ? 'fas fa-arrow-down' 
            : 'fas fa-minus';
    
    // Update text content
    const formattedPercentage = formatPercentage(Math.abs(changeValue));
    
    // Remove existing text nodes
    const textNodes = Array.from(element.childNodes).filter(
        node => node.nodeType === Node.TEXT_NODE
    );
    textNodes.forEach(node => node.remove());
    
    // Add formatted percentage text
    element.appendChild(document.createTextNode(` ${formattedPercentage}`));
}

// Load recent orders from API with retry logic and pagination
async function loadRecentOrders(page = null) {
        const tbody = document.getElementById('recentOrdersBody');
        if (!tbody) return;
        
    // Use provided page or current page from state
    const targetPage = page !== null ? page : recentOrdersPagination.currentPage;
    const isLoading = !lastUpdateTime; // Show loading only on initial load
    
    // Show loading state on initial load or page change
    if (isLoading || page !== null) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <i class="fas fa-spinner fa-spin" style="margin-right: 8px;"></i>
                    Loading orders...
                </td>
            </tr>
        `;
        // Hide pagination while loading
        const paginationContainer = document.getElementById('recentOrdersPagination');
        if (paginationContainer) paginationContainer.style.display = 'none';
    }
    
    try {
        await retryWithBackoff(async () => {
            // Build URL with pagination parameters
            const url = `/api/admin/dashboard/recent-orders?limit=${recentOrdersPagination.limit}&page=${targetPage}`;
            
            const response = await fetchWithTimeout(url, {}, 10000);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success || !result.data) {
                throw new Error('Invalid response format');
            }
            
            const orders = result.data || [];
            
            // Update pagination state
            if (result.pagination) {
                recentOrdersPagination = {
                    currentPage: result.pagination.currentPage,
                    totalPages: result.pagination.totalPages,
                    totalCount: result.pagination.totalCount,
                    limit: result.pagination.limit,
                    hasNextPage: result.pagination.hasNextPage,
                    hasPreviousPage: result.pagination.hasPreviousPage
                };
            }
            
            if (orders.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No orders yet</td></tr>';
                // Hide pagination if no orders
                const paginationContainer = document.getElementById('recentOrdersPagination');
                if (paginationContainer) paginationContainer.style.display = 'none';
                return result;
            }
            
            // Render orders
            tbody.innerHTML = orders.map(order => {
                const statusClass = getStatusClass(order.status);
                return `
                    <tr>
                        <td><strong>${escapeHtml(order.orderNumber)}</strong></td>
                        <td>${escapeHtml(order.customerName)}</td>
                        <td>${formatDate(order.date)}</td>
                        <td>${formatCurrency(order.amount)}</td>
                        <td><span class="status-badge ${statusClass}">${formatStatus(order.status)}</span></td>
                        <td>
                            <a href="/admin/orders/${order.orderNumber}" class="action-link">View</a>
                        </td>
                    </tr>
                `;
            }).join('');
            
            // Update pagination controls
            updateRecentOrdersPagination();
            
            // Update lastUpdateTime if timestamp is provided
            if (result.timestamp) {
                const newTimestamp = new Date(result.timestamp);
                // Only update if this is a newer timestamp
                if (!lastUpdateTime || newTimestamp > lastUpdateTime) {
                    lastUpdateTime = newTimestamp;
                }
            }
            
            return result;
        }, 'loadRecentOrders');
        
    } catch (error) {
        console.error('[Dashboard] Error loading recent orders:', error);
        const errorMsg = error.message === 'Request timeout' || error.name === 'TimeoutError'
            ? 'Request timed out'
            : error.message || 'Failed to load orders';
        
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state" style="color: #ff4444;">
                    <i class="fas fa-exclamation-triangle" style="margin-right: 8px;"></i>
                    ${escapeHtml(errorMsg)}
                    ${isLoading ? '<br><button onclick="loadRecentOrders()" style="margin-top: 10px; padding: 8px 16px; background: var(--admin-yellow, #FFD700); border: none; border-radius: 4px; cursor: pointer; color: #000;">Retry</button>' : ''}
                </td>
            </tr>
        `;
        
        // Hide pagination on error
        const paginationContainer = document.getElementById('recentOrdersPagination');
        if (paginationContainer) paginationContainer.style.display = 'none';
        
        // Expose function globally for retry button
        window.loadRecentOrders = loadRecentOrders;
        
        if (isLoading) {
            showError(`Failed to load recent orders: ${errorMsg}`, 5000);
        }
        // Graceful degradation: continue with other data loads
    }
}

// Update pagination controls for Recent Orders
function updateRecentOrdersPagination() {
    const paginationContainer = document.getElementById('recentOrdersPagination');
    const paginationInfo = document.getElementById('recentOrdersPaginationInfo');
    const prevBtn = document.getElementById('recentOrdersPrevBtn');
    const nextBtn = document.getElementById('recentOrdersNextBtn');
    const pagesContainer = document.getElementById('recentOrdersPages');
    
    if (!paginationContainer || !paginationInfo || !prevBtn || !nextBtn || !pagesContainer) {
        return;
    }
    
    const { currentPage, totalPages, totalCount, limit } = recentOrdersPagination;
    
    // Show pagination only if there are multiple pages
    if (totalPages <= 1) {
        paginationContainer.style.display = 'none';
        return;
    }
    
    paginationContainer.style.display = 'flex';
    
    // Update pagination info
    const start = (currentPage - 1) * limit + 1;
    const end = Math.min(currentPage * limit, totalCount);
    paginationInfo.textContent = `Showing ${start}-${end} of ${totalCount}`;
    
    // Update Previous button
    prevBtn.disabled = !recentOrdersPagination.hasPreviousPage;
    
    // Update Next button
    nextBtn.disabled = !recentOrdersPagination.hasNextPage;
    
    // Generate page numbers
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    
    // Adjust if we're near the end
    if (endPage - startPage < maxVisiblePages - 1) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
    let pagesHTML = '';
    
    // First page
    if (startPage > 1) {
        pagesHTML += `<button class="pagination-page" onclick="loadRecentOrders(1)">1</button>`;
        if (startPage > 2) {
            pagesHTML += `<span class="pagination-ellipsis">...</span>`;
        }
    }
    
    // Page numbers
    for (let i = startPage; i <= endPage; i++) {
        pagesHTML += `<button class="pagination-page ${i === currentPage ? 'active' : ''}" onclick="loadRecentOrders(${i})">${i}</button>`;
    }
    
    // Last page
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            pagesHTML += `<span class="pagination-ellipsis">...</span>`;
        }
        pagesHTML += `<button class="pagination-page" onclick="loadRecentOrders(${totalPages})">${totalPages}</button>`;
    }
    
    pagesContainer.innerHTML = pagesHTML;
}

// Setup pagination event listeners
function setupRecentOrdersPagination() {
    const prevBtn = document.getElementById('recentOrdersPrevBtn');
    const nextBtn = document.getElementById('recentOrdersNextBtn');
    
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (recentOrdersPagination.currentPage > 1) {
                loadRecentOrders(recentOrdersPagination.currentPage - 1);
            }
        });
    }
    
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (recentOrdersPagination.currentPage < recentOrdersPagination.totalPages) {
                loadRecentOrders(recentOrdersPagination.currentPage + 1);
            }
        });
    }
}

// Load low stock products from API with retry logic
async function loadLowStockProducts() {
        const tbody = document.getElementById('lowStockBody');
        if (!tbody) return;
        
    const isLoading = !lastUpdateTime;
    
    // Show loading state on initial load
    if (isLoading) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state">
                    <i class="fas fa-spinner fa-spin" style="margin-right: 8px;"></i>
                    Loading products...
                </td>
            </tr>
        `;
    }
    
    try {
        await retryWithBackoff(async () => {
            const response = await fetch('/api/admin/dashboard/low-stock?limit=10', {
                signal: AbortSignal.timeout(10000) // 10 second timeout
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success || !result.data) {
                throw new Error('Invalid response format');
            }
            
            const products = result.data || [];
            
            if (products.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No low stock products</td></tr>';
                return result;
            }
            
            tbody.innerHTML = products.map(product => {
                const stockClass = product.stock <= 5 ? 'critical' : product.stock <= 10 ? 'warning' : '';
                return `
                    <tr>
                        <td><strong>${escapeHtml(product.model || 'Unknown')}</strong></td>
                        <td>${escapeHtml(product.sku || '-')}</td>
                        <td><span class="stock-badge ${stockClass}">${product.stock}</span></td>
                        <td><span class="status-badge ${product.status}">${product.status}</span></td>
                        <td>
                            <a href="/admin/products" class="action-link">Manage</a>
                        </td>
                    </tr>
                `;
            }).join('');
            
            return result;
        }, 'loadLowStockProducts');
        
    } catch (error) {
        console.error('[Dashboard] Error loading low stock products:', error);
        const errorMsg = error.name === 'TimeoutError' 
            ? 'Request timed out'
            : error.message || 'Failed to load products';
        
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state" style="color: #ff4444;">
                    <i class="fas fa-exclamation-triangle" style="margin-right: 8px;"></i>
                    ${escapeHtml(errorMsg)}
                    ${isLoading ? '<br><button onclick="loadLowStockProducts()" style="margin-top: 10px; padding: 8px 16px; background: var(--admin-yellow, #FFD700); border: none; border-radius: 4px; cursor: pointer; color: #000;">Retry</button>' : ''}
                </td>
            </tr>
        `;
        window.loadLowStockProducts = loadLowStockProducts;
        if (isLoading) {
            showError(`Failed to load low stock products: ${errorMsg}`, 5000);
        }
        // Graceful degradation: continue with other data loads
    }
}

// Load best selling products from API with retry logic
async function loadBestSellingProducts() {
        const tbody = document.getElementById('bestSellingBody');
        if (!tbody) return;
        
    const isLoading = !lastUpdateTime;
    
    // Show loading state on initial load
    if (isLoading) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="empty-state">
                    <i class="fas fa-spinner fa-spin" style="margin-right: 8px;"></i>
                    Loading products...
                </td>
            </tr>
        `;
    }
    
    try {
        await retryWithBackoff(async () => {
            const response = await fetch('/api/admin/dashboard/best-selling?limit=10', {
                signal: AbortSignal.timeout(10000) // 10 second timeout
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success || !result.data) {
                throw new Error('Invalid response format');
            }
            
            const products = result.data || [];
            
            if (products.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No data available</td></tr>';
                return result;
            }
            
            tbody.innerHTML = products.map(product => {
                const productName = product.name || product.model || 'Unknown Product';
                return `
                    <tr>
                        <td>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                ${product.image ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(productName)}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 4px;">` : ''}
                                <strong>${escapeHtml(productName)}</strong>
                            </div>
                        </td>
                        <td>${product.sales || 0} sold</td>
                        <td>${formatCurrency(product.revenue || 0)}</td>
                        <td>
                            <span class="trend-badge positive">
                                <i class="fas fa-arrow-up"></i> Top Seller
                            </span>
                        </td>
                    </tr>
                `;
            }).join('');
            
            return result;
        }, 'loadBestSellingProducts');
        
    } catch (error) {
        console.error('[Dashboard] Error loading best selling products:', error);
        const errorMsg = error.name === 'TimeoutError' 
            ? 'Request timed out'
            : error.message || 'Failed to load products';
        
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="empty-state" style="color: #ff4444;">
                    <i class="fas fa-exclamation-triangle" style="margin-right: 8px;"></i>
                    ${escapeHtml(errorMsg)}
                    ${isLoading ? '<br><button onclick="loadBestSellingProducts()" style="margin-top: 10px; padding: 8px 16px; background: var(--admin-yellow, #FFD700); border: none; border-radius: 4px; cursor: pointer; color: #000;">Retry</button>' : ''}
                </td>
            </tr>
        `;
        window.loadBestSellingProducts = loadBestSellingProducts;
        if (isLoading) {
            showError(`Failed to load best selling products: ${errorMsg}`, 5000);
        }
        // Graceful degradation: continue with other data loads
    }
}

// Load top customers from API with retry logic
async function loadTopCustomers() {
        const tbody = document.getElementById('topCustomersBody');
        if (!tbody) return;
        
    const isLoading = !lastUpdateTime;
    
    // Show loading state on initial load
    if (isLoading) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="empty-state">
                    <i class="fas fa-spinner fa-spin" style="margin-right: 8px;"></i>
                    Loading customers...
                </td>
            </tr>
        `;
    }
    
    try {
        await retryWithBackoff(async () => {
            const response = await fetch('/api/admin/dashboard/top-customers?limit=10', {
                signal: AbortSignal.timeout(10000) // 10 second timeout
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success || !result.data) {
                throw new Error('Invalid response format');
            }
            
            const customers = result.data || [];
            
            if (customers.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No data available</td></tr>';
                return result;
            }
            
            tbody.innerHTML = customers.map(customer => {
                return `
                    <tr>
                        <td>
                            <div>
                                <strong>${escapeHtml(customer.name || 'Unknown')}</strong>
                                <div style="font-size: 12px; color: #aaa; margin-top: 2px;">${escapeHtml(customer.email || '')}</div>
                            </div>
                        </td>
                        <td>${customer.orders || 0} orders</td>
                        <td>${formatCurrency(customer.totalSpent || 0)}</td>
                        <td>
                            <span class="status-badge active">Active</span>
                        </td>
                    </tr>
                `;
            }).join('');
            
            return result;
        }, 'loadTopCustomers');
        
    } catch (error) {
        console.error('[Dashboard] Error loading top customers:', error);
        const errorMsg = error.name === 'TimeoutError' 
            ? 'Request timed out'
            : error.message || 'Failed to load customers';
        
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="empty-state" style="color: #ff4444;">
                    <i class="fas fa-exclamation-triangle" style="margin-right: 8px;"></i>
                    ${escapeHtml(errorMsg)}
                    ${isLoading ? '<br><button onclick="loadTopCustomers()" style="margin-top: 10px; padding: 8px 16px; background: var(--admin-yellow, #FFD700); border: none; border-radius: 4px; cursor: pointer; color: #000;">Retry</button>' : ''}
                </td>
            </tr>
        `;
        window.loadTopCustomers = loadTopCustomers;
        if (isLoading) {
            showError(`Failed to load top customers: ${errorMsg}`, 5000);
        }
        // Graceful degradation: continue with other data loads
    }
}

// Load notifications from API
async function loadNotifications() {
    try {
        // Check if notifications API exists
        const response = await fetch('/api/admin/notifications');
        
        if (!response.ok) {
            // API doesn't exist yet, show placeholder
            const list = document.getElementById('notificationsList');
            if (list) {
                list.innerHTML = `
                    <div class="notification-item">
                        <div class="notification-icon">
                            <i class="fas fa-info-circle"></i>
                        </div>
                        <div class="notification-content">
                            <p class="notification-text">Notifications feature coming soon</p>
                        </div>
                    </div>
                `;
            }
            return;
        }
        
        const result = await response.json();
        
        if (!result.success || !result.data) {
            return;
        }
        
        const notifications = result.data || [];
        const list = document.getElementById('notificationsList');
        if (!list) return;
        
        if (notifications.length === 0) {
            list.innerHTML = `
                <div class="notification-item">
                    <div class="notification-content">
                        <p class="notification-text">No new notifications</p>
                    </div>
                </div>
            `;
            return;
        }
        
        list.innerHTML = notifications.map(notification => `
            <div class="notification-item ${notification.read ? '' : 'unread'}">
                <div class="notification-icon">
                    <i class="fas ${getNotificationIcon(notification.type)}"></i>
                </div>
                <div class="notification-content">
                    <p class="notification-text">${escapeHtml(notification.message || '')}</p>
                    <span class="notification-time">${formatTimeAgo(notification.createdAt)}</span>
                </div>
            </div>
        `).join('');
        
        // Update notification dot
        const notificationDot = document.getElementById('notificationDot');
        const unreadCount = notifications.filter(n => !n.read).length;
        if (notificationDot) {
            if (unreadCount > 0) {
                notificationDot.style.display = 'block';
                notificationDot.textContent = unreadCount > 9 ? '9+' : unreadCount;
            } else {
                notificationDot.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('[Dashboard] Error loading notifications:', error);
        // Silently fail - notifications are optional
    }
}

// Get notification icon based on type
function getNotificationIcon(type) {
    const icons = {
        'order': 'fa-shopping-cart',
        'payment': 'fa-credit-card',
        'product': 'fa-box',
        'customer': 'fa-user',
        'alert': 'fa-exclamation-triangle',
        'info': 'fa-info-circle'
    };
    return icons[type] || 'fa-bell';
}

// Format time ago
function formatTimeAgo(dateString) {
    if (!dateString) return 'Just now';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    return formatDate(dateString);
}

// Update order summary counts with retry logic
async function updateOrderSummary() {
    const isLoading = !lastUpdateTime;
    
    try {
        await retryWithBackoff(async () => {
            // Build URL with updatedSince parameter for efficient polling
            let url = '/api/admin/dashboard/order-summary';
            if (lastUpdateTime) {
                url += `?updatedSince=${encodeURIComponent(lastUpdateTime.toISOString())}`;
            }
            
            const response = await fetchWithTimeout(url, {}, 10000);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success || !result.data) {
                throw new Error('Invalid response format');
            }
            
            const summary = result.data;
            
            const newOrdersEl = document.getElementById('newOrdersCount');
            const processingOrdersEl = document.getElementById('processingOrdersCount');
            const deliveredOrdersEl = document.getElementById('deliveredOrdersCount');
            const cancelledOrdersEl = document.getElementById('cancelledOrdersCount');
            
            if (newOrdersEl) {
                newOrdersEl.textContent = (summary.new || 0).toLocaleString();
                newOrdersEl.style.opacity = '1';
            }
            if (processingOrdersEl) {
                processingOrdersEl.textContent = (summary.processing || 0).toLocaleString();
                processingOrdersEl.style.opacity = '1';
            }
            if (deliveredOrdersEl) {
                deliveredOrdersEl.textContent = (summary.delivered || 0).toLocaleString();
                deliveredOrdersEl.style.opacity = '1';
            }
            if (cancelledOrdersEl) {
                cancelledOrdersEl.textContent = (summary.cancelled || 0).toLocaleString();
                cancelledOrdersEl.style.opacity = '1';
            }
            
            // Update order badge if exists (from orders-badge.js)
            const newOrdersBadge = document.getElementById('newOrdersBadge');
            if (newOrdersBadge) {
                if (summary.new > 0) {
                    newOrdersBadge.textContent = summary.new;
                    newOrdersBadge.style.display = 'inline-block';
                } else {
                    newOrdersBadge.style.display = 'none';
                }
            }
            
            // Update lastUpdateTime if timestamp is provided
            if (result.timestamp) {
                lastUpdateTime = new Date(result.timestamp);
            }
            
            return result;
        }, 'updateOrderSummary');
        
    } catch (error) {
        console.error('[Dashboard] Error updating order summary:', error);
        // Silently fail for polling updates, but show error on initial load
        if (isLoading) {
            const errorMsg = error.name === 'TimeoutError' 
                ? 'Request timed out'
                : error.message || 'Failed to load order summary';
            showError(`Failed to load order summary: ${errorMsg}`, 5000);
        }
        // Graceful degradation: continue with other data loads
    }
}

// Update charts with new data and retry logic
async function updateCharts(period) {
    const isLoading = !lastUpdateTime;
    
    try {
        await retryWithBackoff(async () => {
            // Determine revenue period based on sales period
            // For daily/weekly sales, use monthly revenue; for monthly sales, use monthly revenue
            const revenuePeriod = period === 'monthly' ? 'monthly' : 'monthly';
            
            let salesResponse, revenueResponse;
            let salesError = null;
            let revenueError = null;
            
            // Fetch both charts, but handle errors individually for graceful degradation
            try {
                salesResponse = await fetchWithTimeout(`/api/admin/dashboard/charts/sales?period=${period}`, {}, 15000);
            } catch (error) {
                salesError = error;
                console.error('[Dashboard] Sales chart fetch error:', error);
            }
            
            try {
                revenueResponse = await fetchWithTimeout(`/api/admin/dashboard/charts/revenue?period=${revenuePeriod}`, {}, 15000);
            } catch (error) {
                revenueError = error;
                console.error('[Dashboard] Revenue chart fetch error:', error);
            }
            
            // Remove loading overlays
            const salesLoading = document.getElementById('salesChartLoading');
            const revenueLoading = document.getElementById('revenueChartLoading');
            if (salesLoading) salesLoading.remove();
            if (revenueLoading) revenueLoading.remove();
            
            let salesResult = null;
            let revenueResult = null;
            let hasError = false;
            
            // Process sales chart
            if (salesError) {
                hasError = true;
                if (isLoading) {
                    showChartError('salesChart', `Sales chart: ${salesError.message || 'Failed to load'}`, period);
                }
            } else if (salesResponse && salesResponse.ok) {
                try {
                    salesResult = await salesResponse.json();
                    if (salesResult.success && salesResult.data && salesChart) {
                        salesChart.data.labels = salesResult.data.labels || [];
                        salesChart.data.datasets[0].data = salesResult.data.data || [];
                        salesChart.update('none');
                        // Remove any existing error overlay on success
                        removeChartError('salesChart');
                    } else {
                        hasError = true;
                        if (isLoading) {
                            showChartError('salesChart', 'Sales chart: Invalid data format', period);
                        }
                    }
                } catch (error) {
                    hasError = true;
                    console.error('[Dashboard] Sales chart JSON parse error:', error);
                    if (isLoading) {
                        showChartError('salesChart', 'Sales chart: Invalid response', period);
                    }
                }
            } else if (salesResponse && !salesResponse.ok) {
                hasError = true;
                const statusText = salesResponse.statusText || `HTTP ${salesResponse.status}`;
                console.error(`[Dashboard] Sales chart HTTP error: ${salesResponse.status} ${statusText}`);
                if (isLoading) {
                    showChartError('salesChart', `Sales chart: ${statusText}`, period);
                }
            }
            
            // Process revenue chart
            if (revenueError) {
                hasError = true;
                if (isLoading) {
                    showChartError('revenueChart', `Revenue chart: ${revenueError.message || 'Failed to load'}`, period);
                }
            } else if (revenueResponse && revenueResponse.ok) {
                try {
                    revenueResult = await revenueResponse.json();
                    if (revenueResult.success && revenueResult.data && revenueChart) {
                        revenueChart.data.labels = revenueResult.data.labels || [];
                        revenueChart.data.datasets[0].data = revenueResult.data.data || [];
                        revenueChart.update('none');
                        // Remove any existing error overlay on success
                        removeChartError('revenueChart');
                    } else {
                        hasError = true;
                        if (isLoading) {
                            showChartError('revenueChart', 'Revenue chart: Invalid data format', period);
                        }
                    }
                } catch (error) {
                    hasError = true;
                    console.error('[Dashboard] Revenue chart JSON parse error:', error);
                    if (isLoading) {
                        showChartError('revenueChart', 'Revenue chart: Invalid response', period);
                    }
                }
            } else if (revenueResponse && !revenueResponse.ok) {
                hasError = true;
                const statusText = revenueResponse.statusText || `HTTP ${revenueResponse.status}`;
                console.error(`[Dashboard] Revenue chart HTTP error: ${revenueResponse.status} ${statusText}`);
                if (isLoading) {
                    showChartError('revenueChart', `Revenue chart: ${statusText}`, period);
                }
            }
            
            // Only throw error if both charts failed on initial load
            if (hasError && isLoading && (!salesResult && !revenueResult)) {
                throw new Error('Both charts failed to load');
            }
            
            return { salesResult, revenueResult };
        }, 'updateCharts');
        
    } catch (error) {
        console.error('[Dashboard] Error updating charts:', error);
        
        // Remove loading overlays on error
        const salesLoading = document.getElementById('salesChartLoading');
        const revenueLoading = document.getElementById('revenueChartLoading');
        if (salesLoading) salesLoading.remove();
        if (revenueLoading) revenueLoading.remove();
        
        // Show error overlays only if not already shown
        if (isLoading) {
            const errorMsg = error.message === 'Request timeout' || error.name === 'TimeoutError'
                ? 'Request timed out'
                : error.message || 'Failed to load chart';
            
            showChartError('salesChart', errorMsg, period);
            showChartError('revenueChart', errorMsg, period);
            showError(`Failed to load chart data: ${errorMsg}`, 5000);
        }
        // Graceful degradation: continue with other data loads
    }
}

// Helper function to show chart error overlay
function showChartError(chartId, errorMsg, period) {
    const chartElement = document.getElementById(chartId);
    if (!chartElement) return;
    
    const container = chartElement.closest('.chart-container');
    if (!container) return;
    
    // Remove existing error overlay if any
    removeChartError(chartId);
    
    const errorOverlay = document.createElement('div');
    errorOverlay.className = 'chart-error-overlay';
    errorOverlay.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10;
        color: #ff4444;
        text-align: center;
        padding: 20px;
    `;
    errorOverlay.innerHTML = `
        <div>
            <i class="fas fa-exclamation-triangle" style="font-size: 32px; margin-bottom: 12px; display: block; color: #ff4444;"></i>
            <div style="font-size: 14px; margin-bottom: 16px; color: #fff;">${escapeHtml(errorMsg)}</div>
            <button onclick="updateCharts('${period}')" style="
                padding: 10px 20px;
                background: var(--admin-yellow, #FFD700);
                border: none;
                border-radius: 6px;
                cursor: pointer;
                color: #000;
                font-weight: 600;
                font-size: 14px;
                transition: all 0.3s;
            " onmouseover="this.style.background='var(--admin-yellow-light, #FFEB3B)'" onmouseout="this.style.background='var(--admin-yellow, #FFD700)'">
                <i class="fas fa-redo"></i> Retry
            </button>
        </div>
    `;
    container.style.position = 'relative';
    container.appendChild(errorOverlay);
}

// Helper function to remove chart error overlay
function removeChartError(chartId) {
    const chartElement = document.getElementById(chartId);
    if (!chartElement) return;
    
    const container = chartElement.closest('.chart-container');
    if (!container) return;
    
    const existingError = container.querySelector('.chart-error-overlay');
    if (existingError) {
        existingError.remove();
    }
}

// Expose updateCharts globally for retry buttons
window.updateCharts = updateCharts;

// Handle search functionality
async function handleSearch(query) {
    try {
        if (!query || query.trim().length === 0) {
            return;
        }
        
        const response = await fetch(`/api/admin/dashboard/search?q=${encodeURIComponent(query)}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (!result.success || !result.data) {
            return;
        }
        
        const { orders, products, customers } = result.data;
        
        // Display search results (you can customize this UI)
        // For now, navigate to orders page if orders found, otherwise show modal
        if (orders && orders.length > 0) {
            // Navigate to orders page with search query
            window.location.href = `/admin/orders?search=${encodeURIComponent(query)}`;
        } else if (products && products.length > 0) {
            // Navigate to products page
            window.location.href = `/admin/products?search=${encodeURIComponent(query)}`;
        } else if (customers && customers.length > 0) {
            // Navigate to customers page
            window.location.href = `/admin/customers?search=${encodeURIComponent(query)}`;
        } else {
            // Show no results message
            showNotification('No results found', 'info');
        }
    } catch (error) {
        console.error('[Dashboard] Error searching:', error);
        showNotification('Search failed. Please try again.', 'error');
    }
}

// Export dashboard report (CSV/JSON)
async function exportDashboardReport() {
    try {
        // Show loading state
        const exportBtn = document.getElementById('exportReportBtn');
        const originalText = exportBtn?.querySelector('span')?.textContent || 'Export Reports';
        if (exportBtn) {
            exportBtn.disabled = true;
            const span = exportBtn.querySelector('span');
            if (span) span.textContent = 'Generating...';
        }
        
        // Fetch comprehensive dashboard data
        const [statsResponse, ordersResponse, productsResponse, customersResponse] = await Promise.all([
            fetch('/api/admin/dashboard/stats'),
            fetch('/api/admin/dashboard/recent-orders?limit=100'),
            fetch('/api/admin/dashboard/best-selling?limit=50'),
            fetch('/api/admin/dashboard/top-customers?limit=50')
        ]);
        
        if (!statsResponse.ok || !ordersResponse.ok || !productsResponse.ok || !customersResponse.ok) {
            throw new Error('Failed to fetch dashboard data');
        }
        
        const [stats, orders, products, customers] = await Promise.all([
            statsResponse.json(),
            ordersResponse.json(),
            productsResponse.json(),
            customersResponse.json()
        ]);
        
        // Prepare comprehensive report data
        const reportData = {
            generatedAt: new Date().toISOString(),
            reportType: 'Dashboard Summary Report',
            kpis: stats.success ? stats.data : {},
            recentOrders: orders.success ? orders.data : [],
            bestSellingProducts: products.success ? products.data : [],
            topCustomers: customers.success ? customers.data : [],
            summary: {
                totalOrders: stats.success ? stats.data.totalOrders : 0,
                totalRevenue: stats.success ? stats.data.totalRevenue : 0,
                totalCustomers: stats.success ? stats.data.totalCustomers : 0,
                totalProducts: stats.success ? stats.data.totalProducts : 0,
                lowStockCount: stats.success ? stats.data.lowStockCount : 0
            }
        };
        
        // Show format selection modal
        const format = await showExportFormatModal();
        if (!format) {
            // User cancelled
            if (exportBtn) {
                exportBtn.disabled = false;
                const span = exportBtn.querySelector('span');
                if (span) span.textContent = originalText;
            }
            return;
        }
        
        let blob, filename, mimeType;
        
        if (format === 'json') {
            // Export as JSON
            const jsonStr = JSON.stringify(reportData, null, 2);
            blob = new Blob([jsonStr], { type: 'application/json' });
            filename = `dashboard-report-${new Date().toISOString().split('T')[0]}.json`;
            mimeType = 'application/json';
        } else {
            // Export as CSV
            const csvRows = [];
            
            // KPI Section
            csvRows.push('=== DASHBOARD KPIs ===');
            csvRows.push('Metric,Value');
            if (stats.success) {
                csvRows.push(`Total Sales,${stats.data.totalSales || 0}`);
                csvRows.push(`Total Orders,${stats.data.totalOrders || 0}`);
                csvRows.push(`Total Customers,${stats.data.totalCustomers || 0}`);
                csvRows.push(`Total Products,${stats.data.totalProducts || 0}`);
                csvRows.push(`Total Revenue,${stats.data.totalRevenue || 0}`);
                csvRows.push(`Low Stock Count,${stats.data.lowStockCount || 0}`);
            }
            csvRows.push('');
            
            // Recent Orders Section
            csvRows.push('=== RECENT ORDERS ===');
            csvRows.push('Order Number,Customer,Date,Amount,Status');
            if (orders.success && orders.data) {
                orders.data.forEach(order => {
                    csvRows.push([
                        order.orderNumber || '',
                        `"${(order.customerName || '').replace(/"/g, '""')}"`,
                        order.date ? new Date(order.date).toISOString().split('T')[0] : '',
                        order.amount || 0,
                        order.status || ''
                    ].join(','));
                });
            }
            csvRows.push('');
            
            // Best Selling Products Section
            csvRows.push('=== BEST SELLING PRODUCTS ===');
            csvRows.push('Product Name,Sales,Revenue');
            if (products.success && products.data) {
                products.data.forEach(product => {
                    csvRows.push([
                        `"${(product.name || product.model || '').replace(/"/g, '""')}"`,
                        product.sales || 0,
                        product.revenue || 0
                    ].join(','));
                });
            }
            csvRows.push('');
            
            // Top Customers Section
            csvRows.push('=== TOP CUSTOMERS ===');
            csvRows.push('Customer Name,Email,Orders,Total Spent');
            if (customers.success && customers.data) {
                customers.data.forEach(customer => {
                    csvRows.push([
                        `"${(customer.name || '').replace(/"/g, '""')}"`,
                        customer.email || '',
                        customer.orders || 0,
                        customer.totalSpent || 0
                    ].join(','));
                });
            }
            
            const csvContent = csvRows.join('\n');
            blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            filename = `dashboard-report-${new Date().toISOString().split('T')[0]}.csv`;
            mimeType = 'text/csv';
        }
        
        // Download file
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showNotification(`Dashboard report exported as ${format.toUpperCase()} successfully`, 'success');
        
        // Reset button
        if (exportBtn) {
            exportBtn.disabled = false;
            const span = exportBtn.querySelector('span');
            if (span) span.textContent = originalText;
        }
    } catch (error) {
        console.error('[Dashboard] Error exporting report:', error);
        showNotification('Failed to export report. Please try again.', 'error');
        
        // Reset button
        const exportBtn = document.getElementById('exportReportBtn');
        if (exportBtn) {
            exportBtn.disabled = false;
            const span = exportBtn.querySelector('span');
            if (span) span.textContent = 'Export Reports';
        }
    }
}

// Show export format selection modal
function showExportFormatModal() {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'export-modal-overlay';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10002;
        `;
        
        modal.innerHTML = `
            <div class="export-modal" style="
                background: var(--admin-bg-card, #111);
                border: 1px solid var(--admin-border, rgba(255, 215, 0, 0.2));
                border-radius: 12px;
                padding: 30px;
                max-width: 400px;
                width: 90%;
                color: #fff;
            ">
                <h3 style="margin: 0 0 20px 0; color: var(--admin-yellow, #FFD700);">
                    <i class="fas fa-download"></i> Export Format
                </h3>
                <p style="margin: 0 0 20px 0; color: #aaa;">
                    Choose the format for your dashboard report:
                </p>
                <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                    <button class="export-format-btn" data-format="json" style="
                        flex: 1;
                        padding: 15px;
                        background: rgba(255, 215, 0, 0.1);
                        border: 1px solid var(--admin-yellow, #FFD700);
                        border-radius: 8px;
                        color: var(--admin-yellow, #FFD700);
                        cursor: pointer;
                        font-weight: 600;
                        transition: all 0.3s;
                    ">
                        <i class="fas fa-file-code"></i><br>
                        JSON
                    </button>
                    <button class="export-format-btn" data-format="csv" style="
                        flex: 1;
                        padding: 15px;
                        background: rgba(255, 215, 0, 0.1);
                        border: 1px solid var(--admin-yellow, #FFD700);
                        border-radius: 8px;
                        color: var(--admin-yellow, #FFD700);
                        cursor: pointer;
                        font-weight: 600;
                        transition: all 0.3s;
                    ">
                        <i class="fas fa-file-csv"></i><br>
                        CSV
                    </button>
                </div>
                <button class="export-cancel-btn" style="
                    width: 100%;
                    padding: 12px;
                    background: transparent;
                    border: 1px solid #666;
                    border-radius: 8px;
                    color: #aaa;
                    cursor: pointer;
                ">Cancel</button>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const formatBtns = modal.querySelectorAll('.export-format-btn');
        const cancelBtn = modal.querySelector('.export-cancel-btn');
        
        formatBtns.forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                btn.style.background = 'rgba(255, 215, 0, 0.2)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.background = 'rgba(255, 215, 0, 0.1)';
            });
            btn.addEventListener('click', () => {
                const format = btn.dataset.format;
                document.body.removeChild(modal);
                resolve(format);
            });
        });
        
        cancelBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve(null);
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
                resolve(null);
            }
        });
    });
}

// Open notification sending modal
function openNotificationModal() {
    const modal = document.createElement('div');
    modal.className = 'notification-modal-overlay';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10002;
    `;
    
    modal.innerHTML = `
        <div class="notification-modal" style="
            background: var(--admin-bg-card, #111);
            border: 1px solid var(--admin-border, rgba(255, 215, 0, 0.2));
            border-radius: 12px;
            padding: 30px;
            max-width: 500px;
            width: 90%;
            max-height: 90vh;
            overflow-y: auto;
            color: #fff;
        ">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="margin: 0; color: var(--admin-yellow, #FFD700);">
                    <i class="fas fa-bell"></i> Send Notification
                </h3>
                <button class="close-notification-modal" style="
                    background: none;
                    border: none;
                    color: #aaa;
                    font-size: 24px;
                    cursor: pointer;
                    padding: 0;
                    width: 30px;
                    height: 30px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                ">&times;</button>
            </div>
            
            <form id="notificationForm" style="display: flex; flex-direction: column; gap: 20px;">
                <div>
                    <label style="display: block; margin-bottom: 8px; color: #fff; font-weight: 600;">
                        Recipient Type
                    </label>
                    <select id="notificationRecipientType" required style="
                        width: 100%;
                        padding: 12px;
                        background: var(--admin-bg-medium, #1a1a1a);
                        border: 1px solid var(--admin-border, rgba(255, 215, 0, 0.2));
                        border-radius: 8px;
                        color: #fff;
                        font-size: 14px;
                    ">
                        <option value="all">All Customers</option>
                        <option value="recent">Recent Customers (Last 30 days)</option>
                        <option value="top">Top Customers</option>
                        <option value="custom">Custom Email</option>
                    </select>
                </div>
                
                <div id="customEmailField" style="display: none;">
                    <label style="display: block; margin-bottom: 8px; color: #fff; font-weight: 600;">
                        Email Address
                    </label>
                    <input type="email" id="notificationEmail" style="
                        width: 100%;
                        padding: 12px;
                        background: var(--admin-bg-medium, #1a1a1a);
                        border: 1px solid var(--admin-border, rgba(255, 215, 0, 0.2));
                        border-radius: 8px;
                        color: #fff;
                        font-size: 14px;
                    " placeholder="customer@example.com">
                </div>
                
                <div>
                    <label style="display: block; margin-bottom: 8px; color: #fff; font-weight: 600;">
                        Subject
                    </label>
                    <input type="text" id="notificationSubject" required style="
                        width: 100%;
                        padding: 12px;
                        background: var(--admin-bg-medium, #1a1a1a);
                        border: 1px solid var(--admin-border, rgba(255, 215, 0, 0.2));
                        border-radius: 8px;
                        color: #fff;
                        font-size: 14px;
                    " placeholder="Notification subject">
                </div>
                
                <div>
                    <label style="display: block; margin-bottom: 8px; color: #fff; font-weight: 600;">
                        Message
                    </label>
                    <textarea id="notificationMessage" required rows="6" style="
                        width: 100%;
                        padding: 12px;
                        background: var(--admin-bg-medium, #1a1a1a);
                        border: 1px solid var(--admin-border, rgba(255, 215, 0, 0.2));
                        border-radius: 8px;
                        color: #fff;
                        font-size: 14px;
                        resize: vertical;
                        font-family: inherit;
                    " placeholder="Enter notification message..."></textarea>
                </div>
                
                <div style="display: flex; gap: 10px;">
                    <button type="submit" style="
                        flex: 1;
                        padding: 12px 24px;
                        background: var(--admin-yellow, #FFD700);
                        border: none;
                        border-radius: 8px;
                        color: #000;
                        font-weight: 600;
                        cursor: pointer;
                        font-size: 14px;
                    ">
                        <i class="fas fa-paper-plane"></i> Send Notification
                    </button>
                    <button type="button" class="cancel-notification-btn" style="
                        padding: 12px 24px;
                        background: transparent;
                        border: 1px solid #666;
                        border-radius: 8px;
                        color: #aaa;
                        cursor: pointer;
                        font-size: 14px;
                    ">Cancel</button>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Handle recipient type change
    const recipientType = modal.querySelector('#notificationRecipientType');
    const customEmailField = modal.querySelector('#customEmailField');
    const emailInput = modal.querySelector('#notificationEmail');
    
    recipientType.addEventListener('change', (e) => {
        if (e.target.value === 'custom') {
            customEmailField.style.display = 'block';
            emailInput.required = true;
        } else {
            customEmailField.style.display = 'none';
            emailInput.required = false;
        }
    });
    
    // Handle form submission
    const form = modal.querySelector('#notificationForm');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
        
        try {
            const notificationData = {
                recipientType: recipientType.value,
                email: recipientType.value === 'custom' ? emailInput.value : null,
                subject: modal.querySelector('#notificationSubject').value,
                message: modal.querySelector('#notificationMessage').value
            };
            
            // TODO: Replace with actual API endpoint when available
            // For now, simulate API call
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // In production, uncomment this:
            // const response = await fetch('/api/admin/notifications/send', {
            //     method: 'POST',
            //     headers: { 'Content-Type': 'application/json' },
            //     body: JSON.stringify(notificationData)
            // });
            // if (!response.ok) throw new Error('Failed to send notification');
            
            showNotification('Notification sent successfully!', 'success');
            document.body.removeChild(modal);
        } catch (error) {
            console.error('[Dashboard] Error sending notification:', error);
            showNotification('Failed to send notification. Please try again.', 'error');
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    });
    
    // Handle close
    const closeBtn = modal.querySelector('.close-notification-modal');
    const cancelBtn = modal.querySelector('.cancel-notification-btn');
    
    const closeModal = () => {
        document.body.removeChild(modal);
    };
    
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });
}

// Exponential backoff retry helper
async function retryWithBackoff(fn, functionName, attempt = 0) {
    try {
        const result = await fn();
        // Reset retry attempts on success
        retryAttempts.set(functionName, 0);
        return result;
    } catch (error) {
        const currentAttempts = retryAttempts.get(functionName) || 0;
        
        if (currentAttempts < RETRY_CONFIG.maxRetries) {
            const delay = Math.min(
                RETRY_CONFIG.baseDelay * Math.pow(2, currentAttempts),
                RETRY_CONFIG.maxDelay
            );
            
            retryAttempts.set(functionName, currentAttempts + 1);
            
            console.warn(`[Dashboard] Retrying ${functionName} (attempt ${currentAttempts + 1}/${RETRY_CONFIG.maxRetries}) after ${delay}ms`);
            
            await new Promise(resolve => setTimeout(resolve, delay));
            return retryWithBackoff(fn, functionName, currentAttempts + 1);
        } else {
            // Max retries reached
            retryAttempts.set(functionName, 0);
            throw error;
        }
    }
}

// Show notification
function showNotification(message, type = 'info', duration = 3000) {
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
        word-wrap: break-word;
    `;
    
    // Add icon based on type
    const icon = type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle';
    notification.innerHTML = `<i class="fas ${icon}" style="margin-right: 8px;"></i>${escapeHtml(message)}`;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, duration);
}

// Show error message
function showError(message) {
    showNotification(message, 'error');
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Get status class for styling
function getStatusClass(status) {
    const statusMap = {
        'pending': 'pending',
        'payment_pending': 'pending',
        'paid': 'paid',
        'confirmed': 'confirmed',
        'processing': 'processing',
        'packed': 'processing',
        'shipped': 'shipped',
        'delivered': 'delivered',
        'cancelled': 'cancelled',
        'payment_failed': 'failed',
        'returned': 'returned'
    };
    return statusMap[status] || 'pending';
}

// Format status for display
function formatStatus(status) {
    return status.split('_').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
// These functions provide consistent formatting and display utilities
// for the dashboard components.

/**
 * Format currency amount as K{amount}
 * @param {number|string} amount - Amount to format
 * @returns {string} Formatted currency string (e.g., "K1,234.56")
 * @example
 * formatCurrency(1234.56) // Returns "K1,234.56"
 * formatCurrency("K500") // Returns "K500.00"
 */
function formatCurrency(amount) {
    // Handle null, undefined, or empty values
    if (amount === null || amount === undefined || amount === '') {
        return 'K0.00';
    }
    
    // Convert string to number if needed
    if (typeof amount === 'string') {
        // Remove currency symbols and whitespace
        amount = parseFloat(amount.replace(/[^0-9.-]/g, '')) || 0;
    }
    
    // Ensure it's a number
    const numAmount = Number(amount);
    
    // Handle NaN or invalid numbers
    if (isNaN(numAmount) || !isFinite(numAmount)) {
        return 'K0.00';
    }
    
    // Format with thousand separators and 2 decimal places
    return `K${numAmount.toLocaleString('en-US', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
    })}`;
}

/**
 * Format date string consistently
 * @param {string|Date} dateString - Date string or Date object
 * @param {object} options - Formatting options
 * @param {boolean} options.includeTime - Include time in format
 * @param {string} options.format - Format style: 'short', 'medium', 'long', 'full'
 * @returns {string} Formatted date string
 * @example
 * formatDate('2024-01-15') // Returns "Jan 15, 2024"
 * formatDate('2024-01-15', { format: 'long' }) // Returns "January 15, 2024"
 * formatDate('2024-01-15', { includeTime: true }) // Returns "Jan 15, 2024, 12:00 AM"
 */
function formatDate(dateString, options = {}) {
    if (!dateString) return '-';
    
    let date;
    try {
        date = dateString instanceof Date ? dateString : new Date(dateString);
        
        // Check if date is valid
        if (isNaN(date.getTime())) {
            return '-';
        }
    } catch (error) {
        console.warn('[Dashboard] formatDate: Invalid date', dateString);
        return '-';
    }
    
    const { includeTime = false, format = 'medium' } = options;
    
    if (includeTime) {
        // Include time in format
        return date.toLocaleString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    
    // Format based on style
    switch (format) {
        case 'short':
            return date.toLocaleDateString('en-US', { 
                month: 'numeric', 
                day: 'numeric', 
                year: 'numeric' 
            });
        case 'long':
            return date.toLocaleDateString('en-US', { 
                month: 'long', 
                day: 'numeric', 
                year: 'numeric' 
            });
        case 'full':
            return date.toLocaleDateString('en-US', { 
                weekday: 'long',
                month: 'long', 
                day: 'numeric', 
                year: 'numeric' 
            });
        case 'medium':
        default:
            return date.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                year: 'numeric' 
            });
    }
}

/**
 * Format percentage value consistently
 * @param {number|string} value - Percentage value (as decimal or percentage)
 * @param {object} options - Formatting options
 * @param {number} options.decimals - Number of decimal places (default: 1)
 * @param {boolean} options.showSign - Show + sign for positive values (default: false)
 * @param {boolean} options.isDecimal - Value is already a decimal (0.15 = 15%) (default: false)
 * @returns {string} Formatted percentage string (e.g., "15.5%")
 * @example
 * formatPercentage(15.5) // Returns "15.5%"
 * formatPercentage(15.5, { showSign: true }) // Returns "+15.5%"
 * formatPercentage(0.155, { isDecimal: true }) // Returns "15.5%"
 * formatPercentage(15.567, { decimals: 2 }) // Returns "15.57%"
 */
function formatPercentage(value, options = {}) {
    const { 
        decimals = 1, 
        showSign = false, 
        isDecimal = false 
    } = options;
    
    // Handle null, undefined, or empty values
    if (value === null || value === undefined || value === '') {
        return '0%';
    }
    
    // Convert string to number if needed
    let numValue = typeof value === 'string' 
        ? parseFloat(value.replace(/[^0-9.-]/g, '')) || 0
        : Number(value);
    
    // Handle NaN or invalid numbers
    if (isNaN(numValue) || !isFinite(numValue)) {
        return '0%';
    }
    
    // Convert decimal to percentage if needed (0.15 -> 15)
    if (isDecimal) {
        numValue = numValue * 100;
    }
    
    // Format with specified decimal places
    const formatted = numValue.toFixed(decimals);
    
    // Add sign if requested and value is positive
    const sign = showSign && numValue > 0 ? '+' : '';
    
    return `${sign}${formatted}%`;
}

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

// Real-time updates with efficient polling
// DISABLED: Dashboard only refreshes on manual page refresh
function startRealTimeUpdates() {
    // This function is disabled - dashboard only updates on manual page refresh
    // To re-enable automatic updates, uncomment the code below and call startRealTimeUpdates() in DOMContentLoaded
    
    /*
    // Clear any existing interval
    if (updateInterval) {
        clearInterval(updateInterval);
    }
    
    // Initialize lastUpdateTime on first load
    if (!lastUpdateTime) {
        lastUpdateTime = new Date();
    }
    
    // Update every 30 seconds
    updateInterval = setInterval(() => {
        // Only update if tab is visible
        if (!document.hidden) {
            // Use efficient polling with updatedSince parameter
            // These functions will pass updatedSince to the API
            loadKPIData();
            updateOrderSummary();
            // Load recent orders with current page (don't reset pagination)
            loadRecentOrders(recentOrdersPagination.currentPage);
            loadNotifications();
            
            // Note: lastUpdateTime is updated inside each function after successful API call
        }
    }, 30000); // 30 seconds
    
    // Handle page visibility changes
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && updateInterval) {
            // Tab became visible, update immediately
            // Reset lastUpdateTime to force full refresh when tab becomes visible
            const previousUpdateTime = lastUpdateTime;
            lastUpdateTime = null; // Force full refresh
            
            Promise.all([
                loadKPIData(),
                updateOrderSummary(),
                loadRecentOrders(),
                loadNotifications()
            ]).then(() => {
                // Restore lastUpdateTime after initial refresh
                if (!lastUpdateTime) {
                    lastUpdateTime = previousUpdateTime || new Date();
                }
            }).catch(error => {
                console.error('[Dashboard] Error refreshing on visibility change:', error);
                // Restore lastUpdateTime even on error
                if (!lastUpdateTime) {
                    lastUpdateTime = previousUpdateTime || new Date();
                }
            });
        }
    });
    */
}

// Stop real-time updates (if needed)
function stopRealTimeUpdates() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
}

