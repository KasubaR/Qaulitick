/**
 * Admin Analytics Dashboard JavaScript
 * 
 * Handles:
 * - Date range selection
 * - Fetching analytics data from API
 * - Rendering charts with Chart.js
 * - Real-time data updates
 * - Data export
 */

// Chart instances
let trafficChart = null;
let pageViewsChart = null;
let trafficSourcesChart = null;
let devicesChart = null;
let browsersChart = null;

// Current date range
let currentDateRange = {
    startDate: null,
    endDate: null,
    range: '7' // Default: 7 days
};

// Real-time update interval
let realTimeInterval = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication before initializing
    const isAuthenticated = await window.AuthUtils?.initializeAuthCheck();
    if (!isAuthenticated) {
        return; // Redirect will happen in initializeAuthCheck
    }
    
    initializeAnalytics();
    setupEventListeners();
    setupDateRange();
    loadAnalyticsData();
    startRealTimeUpdates();
});

/**
 * Initialize analytics dashboard
 */
function initializeAnalytics() {
    console.log('[Analytics] Initializing analytics dashboard');
    
    // Set default date range (last 7 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    
    currentDateRange = {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        range: '7'
    };
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Sidebar toggle
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', toggleSidebar);
    }

    // Date range buttons
    const dateButtons = document.querySelectorAll('.date-btn');
    dateButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const range = e.currentTarget.dataset.range;
            if (range) {
                selectDateRange(range);
            } else if (e.currentTarget.id === 'customDateBtn') {
                openCustomDateModal();
            }
        });
    });

    // Custom date modal
    const customDateBtn = document.getElementById('customDateBtn');
    const customDateModal = document.getElementById('customDateModal');
    const closeDateModal = document.getElementById('closeDateModal');
    const cancelDateBtn = document.getElementById('cancelDateBtn');
    const applyDateBtn = document.getElementById('applyDateBtn');

    if (closeDateModal) {
        closeDateModal.addEventListener('click', closeCustomDateModal);
    }
    if (cancelDateBtn) {
        cancelDateBtn.addEventListener('click', closeCustomDateModal);
    }
    if (applyDateBtn) {
        applyDateBtn.addEventListener('click', applyCustomDateRange);
    }

    // Close modal on overlay click
    if (customDateModal) {
        customDateModal.addEventListener('click', (e) => {
            if (e.target === customDateModal) {
                closeCustomDateModal();
            }
        });
    }

    // Refresh button
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            refreshBtn.querySelector('i').classList.add('fa-spin');
            loadAnalyticsData().finally(() => {
                refreshBtn.querySelector('i').classList.remove('fa-spin');
            });
        });
    }

    // Export button
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportAnalyticsData);
    }

    // Error banner close
    const closeErrorBanner = document.getElementById('closeErrorBanner');
    if (closeErrorBanner) {
        closeErrorBanner.addEventListener('click', () => {
            document.getElementById('errorBanner').style.display = 'none';
        });
    }
}

/**
 * Setup initial date range
 */
function setupDateRange() {
    selectDateRange('7');
}

/**
 * Select date range
 */
function selectDateRange(range) {
    const endDate = new Date();
    const startDate = new Date();
    
    switch (range) {
        case '7':
            startDate.setDate(startDate.getDate() - 7);
            break;
        case '30':
            startDate.setDate(startDate.getDate() - 30);
            break;
        case '90':
            startDate.setDate(startDate.getDate() - 90);
            break;
        default:
            startDate.setDate(startDate.getDate() - 7);
    }
    
    currentDateRange = {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        range: range
    };

    // Update active button
    document.querySelectorAll('.date-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.range === range) {
            btn.classList.add('active');
        }
    });

    // Reload data
    loadAnalyticsData();
}

/**
 * Open custom date modal
 */
function openCustomDateModal() {
    const modal = document.getElementById('customDateModal');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    
    // Set current values
    if (currentDateRange.startDate) {
        startDateInput.value = currentDateRange.startDate;
    }
    if (currentDateRange.endDate) {
        endDateInput.value = currentDateRange.endDate;
    }
    
    // Set max date to today
    const today = new Date().toISOString().split('T')[0];
    endDateInput.max = today;
    startDateInput.max = today;
    
    modal.style.display = 'flex';
}

/**
 * Close custom date modal
 */
function closeCustomDateModal() {
    document.getElementById('customDateModal').style.display = 'none';
}

/**
 * Apply custom date range
 */
function applyCustomDateRange() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    
    if (!startDate || !endDate) {
        showError('Please select both start and end dates');
        return;
    }
    
    if (new Date(startDate) > new Date(endDate)) {
        showError('Start date must be before end date');
        return;
    }
    
    currentDateRange = {
        startDate: startDate,
        endDate: endDate,
        range: 'custom'
    };
    
    // Update active button
    document.querySelectorAll('.date-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.getElementById('customDateBtn').classList.add('active');
    
    closeCustomDateModal();
    loadAnalyticsData();
}

/**
 * Load analytics data from API
 */
async function loadAnalyticsData() {
    showLoading(true);
    hideError();
    
    try {
        const params = new URLSearchParams({
            startDate: currentDateRange.startDate,
            endDate: currentDateRange.endDate
        });
        
        const response = await fetch(`/api/admin/analytics?${params}`);
        const result = await response.json();
        
        if (!response.ok || !result.success) {
            throw new Error(result.message || 'Failed to load analytics data');
        }
        
        // Update UI with data
        updateSummaryStats(result.data.summary);
        updateTopPages(result.data.topPages);
        updateCharts(result.data);
        updateConversions(result.data.conversions);
        
        showLoading(false);
    } catch (error) {
        console.error('[Analytics] Error loading data:', error);
        showError(error.message || 'Failed to load analytics data. Please try again.');
        showLoading(false);
        
        // Show mock data for demonstration
        loadMockData();
    }
}

/**
 * Load real-time data
 */
async function loadRealTimeData() {
    try {
        const response = await fetch('/api/admin/analytics/realtime');
        const result = await response.json();
        
        if (result.success && result.data) {
            updateRealTimeStats(result.data);
        }
    } catch (error) {
        console.error('[Analytics] Error loading real-time data:', error);
    }
}

/**
 * Update summary statistics
 */
function updateSummaryStats(summary) {
    if (!summary) return;
    
    updateStatCard('activeUsers', summary.users || 0);
    updateStatCard('pageViews', summary.pageViews || 0);
    updateStatCard('sessions', summary.sessions || 0);
    updateStatCard('bounceRate', (summary.bounceRate || 0) + '%');
}

/**
 * Update stat card
 */
function updateStatCard(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = typeof value === 'number' ? value.toLocaleString() : value;
    }
}

/**
 * Update real-time stats
 */
function updateRealTimeStats(data) {
    if (data.activeUsers !== undefined) {
        updateStatCard('activeUsers', data.activeUsers);
    }
}

/**
 * Update top pages table
 */
function updateTopPages(topPages) {
    const tbody = document.getElementById('topPagesBody');
    if (!tbody) return;
    
    if (!topPages || topPages.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No data available</td></tr>';
        return;
    }
    
    tbody.innerHTML = topPages.map((page, index) => {
        const percentage = page.percentage || 0;
        return `
            <tr>
                <td>
                    <span class="page-rank">${index + 1}</span>
                    <span class="page-path">${page.path || page.page || 'N/A'}</span>
                </td>
                <td>${(page.views || 0).toLocaleString()}</td>
                <td>
                    <div class="percentage-bar">
                        <div class="percentage-fill" style="width: ${percentage}%"></div>
                        <span class="percentage-text">${percentage.toFixed(1)}%</span>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Update charts
 */
function updateCharts(data) {
    // Traffic chart (Users & Sessions)
    updateTrafficChart(data.timeSeries);
    
    // Page views chart
    updatePageViewsChart(data.timeSeries);
    
    // Traffic sources chart
    updateTrafficSourcesChart(data.trafficSources);
    
    // Devices chart
    updateDevicesChart(data.devices);
    
    // Browsers chart
    updateBrowsersChart(data.browsers);
}

/**
 * Update traffic chart
 */
function updateTrafficChart(timeSeries) {
    const ctx = document.getElementById('trafficChart');
    if (!ctx) return;
    
    const labels = timeSeries?.map(item => {
        const date = new Date(item.date);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }) || [];
    
    const usersData = timeSeries?.map(item => item.users || 0) || [];
    const sessionsData = timeSeries?.map(item => item.sessions || 0) || [];
    
    if (trafficChart) {
        trafficChart.destroy();
    }
    
    trafficChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Users',
                    data: usersData,
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102, 126, 234, 0.1)',
                    tension: 0.4,
                    fill: true
                },
                {
                    label: 'Sessions',
                    data: sessionsData,
                    borderColor: '#f5576c',
                    backgroundColor: 'rgba(245, 87, 108, 0.1)',
                    tension: 0.4,
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

/**
 * Update page views chart
 */
function updatePageViewsChart(timeSeries) {
    const ctx = document.getElementById('pageViewsChart');
    if (!ctx) return;
    
    const labels = timeSeries?.map(item => {
        const date = new Date(item.date);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }) || [];
    
    const pageViewsData = timeSeries?.map(item => item.pageViews || 0) || [];
    
    if (pageViewsChart) {
        pageViewsChart.destroy();
    }
    
    pageViewsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Page Views',
                data: pageViewsData,
                backgroundColor: 'rgba(79, 172, 254, 0.6)',
                borderColor: '#4facfe',
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
                    beginAtZero: true
                }
            }
        }
    });
}

/**
 * Update traffic sources chart
 */
function updateTrafficSourcesChart(trafficSources) {
    const ctx = document.getElementById('trafficSourcesChart');
    if (!ctx) return;
    
    if (!trafficSources || trafficSources.length === 0) {
        return;
    }
    
    const labels = trafficSources.map(source => source.source || 'Unknown');
    const data = trafficSources.map(source => source.count || 0);
    
    if (trafficSourcesChart) {
        trafficSourcesChart.destroy();
    }
    
    trafficSourcesChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    '#667eea',
                    '#f5576c',
                    '#4facfe',
                    '#43e97b',
                    '#f093fb'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

/**
 * Update devices chart
 */
function updateDevicesChart(devices) {
    const ctx = document.getElementById('devicesChart');
    if (!ctx) return;
    
    if (!devices || devices.length === 0) {
        return;
    }
    
    const labels = devices.map(device => device.device || 'Unknown');
    const data = devices.map(device => device.count || 0);
    
    if (devicesChart) {
        devicesChart.destroy();
    }
    
    devicesChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    '#667eea',
                    '#f5576c',
                    '#4facfe'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

/**
 * Update browsers chart
 */
function updateBrowsersChart(browsers) {
    const ctx = document.getElementById('browsersChart');
    if (!ctx) return;
    
    if (!browsers || browsers.length === 0) {
        return;
    }
    
    const labels = browsers.map(browser => browser.browser || 'Unknown');
    const data = browsers.map(browser => browser.count || 0);
    
    if (browsersChart) {
        browsersChart.destroy();
    }
    
    browsersChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Users',
                data: data,
                backgroundColor: 'rgba(102, 126, 234, 0.6)',
                borderColor: '#667eea',
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
                    beginAtZero: true
                }
            }
        }
    });
}

/**
 * Update conversions
 */
function updateConversions(conversions) {
    if (!conversions) return;
    
    updateStatCard('addToCartCount', conversions.addToCart || 0);
    updateStatCard('checkoutStartedCount', conversions.checkoutStarted || 0);
    updateStatCard('purchasesCount', conversions.purchases || 0);
}

/**
 * Start real-time updates
 */
function startRealTimeUpdates() {
    // Load real-time data every 30 seconds
    loadRealTimeData();
    realTimeInterval = setInterval(loadRealTimeData, 30000);
}

/**
 * Stop real-time updates
 */
function stopRealTimeUpdates() {
    if (realTimeInterval) {
        clearInterval(realTimeInterval);
        realTimeInterval = null;
    }
}

/**
 * Load mock data for demonstration
 */
function loadMockData() {
    console.log('[Analytics] Loading mock data for demonstration');
    
    const mockData = {
        summary: {
            users: 1234,
            sessions: 1890,
            pageViews: 4567,
            bounceRate: 45.2,
            avgSessionDuration: 180
        },
        topPages: [
            { path: '/shop', views: 1234, percentage: 27.0 },
            { path: '/', views: 890, percentage: 19.5 },
            { path: '/product/123', views: 567, percentage: 12.4 },
            { path: '/cart', views: 345, percentage: 7.6 },
            { path: '/checkout', views: 234, percentage: 5.1 }
        ],
        trafficSources: [
            { source: 'Direct', count: 1200 },
            { source: 'Organic Search', count: 800 },
            { source: 'Social Media', count: 400 },
            { source: 'Referral', count: 200 }
        ],
        devices: [
            { device: 'Desktop', count: 800 },
            { device: 'Mobile', count: 600 },
            { device: 'Tablet', count: 200 }
        ],
        browsers: [
            { browser: 'Chrome', count: 1000 },
            { browser: 'Safari', count: 400 },
            { browser: 'Firefox', count: 200 },
            { browser: 'Edge', count: 100 }
        ],
        conversions: {
            addToCart: 234,
            checkoutStarted: 123,
            purchases: 89
        },
        timeSeries: generateMockTimeSeries(7)
    };
    
    updateSummaryStats(mockData.summary);
    updateTopPages(mockData.topPages);
    updateCharts(mockData);
    updateConversions(mockData.conversions);
}

/**
 * Generate mock time series data
 */
function generateMockTimeSeries(days) {
    const series = [];
    const today = new Date();
    
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        
        series.push({
            date: date.toISOString().split('T')[0],
            users: Math.floor(Math.random() * 200) + 100,
            sessions: Math.floor(Math.random() * 300) + 150,
            pageViews: Math.floor(Math.random() * 500) + 200
        });
    }
    
    return series;
}

/**
 * Export analytics data
 */
async function exportAnalyticsData() {
    try {
        // Check if date range is set
        if (!currentDateRange.startDate || !currentDateRange.endDate) {
            alert('Please select a date range before exporting.');
            return;
        }

        // Show format selection dialog
        const format = await showExportFormatDialog();
        if (!format) {
            return; // User cancelled
        }

        // Show loading state
        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) {
            const originalText = exportBtn.innerHTML;
            exportBtn.disabled = true;
            exportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';

            try {
                // Build query string
                const params = new URLSearchParams({
                    format: format,
                    startDate: currentDateRange.startDate,
                    endDate: currentDateRange.endDate
                });

                // Fetch export data
                const response = await fetch(`/api/admin/analytics/export?${params}`);
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.message || 'Failed to export analytics data');
                }

                // Get filename from Content-Disposition header or generate one
                const contentDisposition = response.headers.get('Content-Disposition');
                let filename = `analytics_export_${new Date().toISOString().split('T')[0]}.${format}`;
                
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
                showNotification(`Analytics data exported successfully as ${filename}`, 'success');
            } catch (error) {
                console.error('[Analytics] Error exporting data:', error);
                showNotification(error.message || 'Failed to export analytics data', 'error');
            } finally {
                // Restore button state
                exportBtn.disabled = false;
                exportBtn.innerHTML = originalText;
            }
        }
    } catch (error) {
        console.error('[Analytics] Error in export function:', error);
        showNotification('Failed to export analytics data', 'error');
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
            <h2 style="margin-top: 0;">Export Analytics Data</h2>
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

/**
 * Show notification
 */
function showNotification(message, type = 'info') {
    // Try to use existing notification system if available
    if (window.showNotification) {
        window.showNotification(message, type);
        return;
    }

    // Fallback: simple alert
    alert(message);
}

/**
 * Show loading state
 */
function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.style.display = show ? 'flex' : 'none';
    }
}

/**
 * Show error message
 */
function showError(message) {
    const banner = document.getElementById('errorBanner');
    const messageEl = document.getElementById('errorMessage');
    
    if (banner && messageEl) {
        messageEl.textContent = message;
        banner.style.display = 'flex';
    }
}

/**
 * Hide error message
 */
function hideError() {
    const banner = document.getElementById('errorBanner');
    if (banner) {
        banner.style.display = 'none';
    }
}

/**
 * Toggle sidebar (delegated to sidebar.js)
 */
function toggleSidebar() {
    if (typeof window.AdminSidebar !== 'undefined') {
        window.AdminSidebar.toggle();
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    stopRealTimeUpdates();
});

