/**
 * Admin Customers API Client
 * 
 * Handles all API calls related to customer management
 * Includes retry logic, error handling, and request timeout
 */

(function (window) {
    const BASE_URL = '/api/admin/customers';

    /**
     * Make API request with retry logic and error handling
     * @param {string} url - API endpoint URL
     * @param {object} options - Fetch options
     * @param {number} retries - Number of retry attempts
     * @returns {Promise<object>} API response data
     */
    async function apiRequest(url, options = {}, retries = 2) {
        const defaultHeaders = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        const config = {
            ...options,
            headers: {
                ...defaultHeaders,
                ...(options.headers || {})
            }
        };

        try {
            const response = await fetch(url, config);
            const data = await response.json().catch(() => ({}));

            // Handle rate limiting (429) with retry
            if (response.status === 429 && retries > 0) {
                const retryAfter = response.headers.get('Retry-After');
                const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, 3 - retries) * 1000; // Exponential backoff
                
                console.warn(`[AdminCustomersAPI] Rate limited, retrying after ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return apiRequest(url, options, retries - 1);
            }

            if (!response.ok || data.success === false) {
                let message = data.message || 'Request to customers API failed';
                
                // Provide user-friendly error messages
                if (response.status === 429) {
                    message = 'Too many requests. Please wait a moment and try again.';
                } else if (response.status === 404) {
                    message = 'Customer not found';
                } else if (response.status === 403) {
                    message = 'Access denied';
                } else if (response.status >= 500) {
                    message = 'Server error. Please try again later.';
                }
                
                const errors = Array.isArray(data.errors) ? data.errors : [];
                const error = new Error(
                    errors.length > 0 ? errors.join('\n') : message
                );
                error.response = response;
                error.data = data;
                error.status = response.status;
                throw error;
            }

            return data;
        } catch (error) {
            // Don't log retry attempts
            if (error.status !== 429 || retries === 0) {
                console.error('[AdminCustomersAPI] Error during API request:', {
                    url: url,
                    method: config.method,
                    status: error.status,
                    message: error.message
                });
            }
            throw error;
        }
    }

    /**
     * Load customers with filters and pagination
     * @param {object} filters - Filter options
     * @param {object} pagination - Pagination options
     * @returns {Promise<object>} Customers data with pagination
     */
    async function loadCustomers(filters = {}, pagination = {}) {
        try {
            const queryParams = new URLSearchParams();
            
            // Add pagination params
            if (pagination.page) queryParams.append('page', pagination.page);
            if (pagination.limit) queryParams.append('limit', pagination.limit);
            
            // Add filter params
            if (filters.search) queryParams.append('search', filters.search);
            if (filters.customerType) queryParams.append('customerType', filters.customerType);
            if (filters.startDate) queryParams.append('startDate', filters.startDate);
            if (filters.endDate) queryParams.append('endDate', filters.endDate);
            if (filters.sortBy) queryParams.append('sortBy', filters.sortBy);
            
            const url = `${BASE_URL}?${queryParams.toString()}`;
            const data = await apiRequest(url);
            
            return {
                customers: data.data || [],
                pagination: data.pagination || {},
                stats: data.stats || {},
                timestamp: data.timestamp
            };
        } catch (error) {
            console.error('[AdminCustomersAPI] Error loading customers:', error);
            throw error;
        }
    }

    /**
     * Get customer statistics
     * @returns {Promise<object>} Customer statistics
     */
    async function getCustomerStats() {
        try {
            const url = `${BASE_URL}/stats`;
            const data = await apiRequest(url);
            
            return data.data || {};
        } catch (error) {
            console.error('[AdminCustomersAPI] Error loading customer stats:', error);
            throw error;
        }
    }

    /**
     * Get customer details by email
     * @param {string} email - Customer email
     * @returns {Promise<object>} Customer details with orders and payments
     */
    async function getCustomerByEmail(email) {
        try {
            if (!email || email.trim().length === 0) {
                throw new Error('Email is required');
            }
            
            const encodedEmail = encodeURIComponent(email.trim());
            const url = `${BASE_URL}/${encodedEmail}`;
            const data = await apiRequest(url);
            
            return data.data || null;
        } catch (error) {
            console.error('[AdminCustomersAPI] Error loading customer by email:', error);
            throw error;
        }
    }

    /**
     * Export customers to CSV or JSON
     * @param {string} format - Export format ('csv' or 'json')
     * @param {object} filters - Filter options (same as loadCustomers)
     * @returns {Promise<void>} Triggers file download
     */
    async function exportCustomers(format = 'csv', filters = {}) {
        try {
            // Load all customers and statistics (no pagination limit for export)
            const [result, stats] = await Promise.all([
                loadCustomers(filters, { page: 1, limit: 10000 }),
                getCustomerStats()
            ]);
            
            const customers = result.customers;
            const statistics = stats;
            
            if (customers.length === 0) {
                throw new Error('No customers to export');
            }
            
            let content;
            let filename;
            let mimeType;
            const exportDate = new Date().toISOString().split('T')[0];
            
            if (format.toLowerCase() === 'json') {
                // Export as JSON with statistics
                const exportData = {
                    exportDate: exportDate,
                    exportTime: new Date().toISOString(),
                    statistics: {
                        totalCustomers: statistics.totalCustomers || customers.length,
                        activeCustomers: statistics.activeCustomers || 0,
                        newCustomers: statistics.newCustomers || 0,
                        totalRevenue: statistics.totalRevenue || 0,
                        exportedCount: customers.length
                    },
                    filters: filters,
                    customers: customers.map(customer => ({
                        email: customer.email,
                        name: customer.name,
                        phone: customer.phone,
                        totalOrders: customer.totalOrders,
                        totalSpent: customer.totalSpent,
                        averageOrderValue: customer.averageOrderValue,
                        firstOrderDate: customer.firstOrderDate,
                        lastOrderDate: customer.lastOrderDate,
                        status: customer.status
                    }))
                };
                
                content = JSON.stringify(exportData, null, 2);
                filename = `customers_export_${exportDate}.json`;
                mimeType = 'application/json';
            } else {
                // Export as CSV
                // Add statistics section at the top
                const statsRows = [
                    ['Export Date', exportDate],
                    ['Total Customers', statistics.totalCustomers || customers.length],
                    ['Active Customers', statistics.activeCustomers || 0],
                    ['New Customers', statistics.newCustomers || 0],
                    ['Total Revenue', statistics.totalRevenue || 0],
                    ['Exported Count', customers.length],
                    [], // Empty row separator
                    ['Customer Data'], // Section header
                    [] // Empty row separator
                ];
                
                const headers = ['Email', 'Name', 'Phone', 'Total Orders', 'Total Spent', 'Average Order Value', 'First Order Date', 'Last Order Date', 'Status'];
                const customerRows = customers.map(customer => [
                    customer.email || '',
                    customer.name || '',
                    customer.phone || '',
                    customer.totalOrders || 0,
                    customer.totalSpent || 0,
                    customer.averageOrderValue || 0,
                    customer.firstOrderDate ? new Date(customer.firstOrderDate).toLocaleDateString() : '',
                    customer.lastOrderDate ? new Date(customer.lastOrderDate).toLocaleDateString() : '',
                    customer.status || 'active'
                ]);
                
                // Helper function to escape CSV cells
                const escapeCsvCell = (cell) => {
                    const cellStr = String(cell);
                    if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
                        return `"${cellStr.replace(/"/g, '""')}"`;
                    }
                    return cellStr;
                };
                
                // Combine statistics and customer data
                const csvContent = [
                    ...statsRows.map(row => row.map(escapeCsvCell).join(',')),
                    headers.map(escapeCsvCell).join(','),
                    ...customerRows.map(row => row.map(escapeCsvCell).join(','))
                ].join('\n');
                
                content = csvContent;
                filename = `customers_export_${exportDate}.csv`;
                mimeType = 'text/csv';
            }
            
            // Create blob and trigger download
            const blob = new Blob([content], { type: mimeType });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            
            return { 
                success: true, 
                count: customers.length,
                format: format.toLowerCase(),
                filename: filename
            };
        } catch (error) {
            console.error('[AdminCustomersAPI] Error exporting customers:', error);
            throw error;
        }
    }

    // Expose API functions
    window.AdminCustomersAPI = {
        loadCustomers,
        getCustomerStats,
        getCustomerByEmail,
        exportCustomers
    };

    // Also expose as globals for backwards compatibility
    window.loadCustomers = loadCustomers;
    window.getCustomerStats = getCustomerStats;
    window.getCustomerByEmail = getCustomerByEmail;
    window.exportCustomers = exportCustomers;

})(window);

