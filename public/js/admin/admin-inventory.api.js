/**
 * Admin Inventory API Client
 * 
 * Handles all API calls related to inventory management
 * Includes retry logic, error handling, and request timeout
 */

(function (window) {
    const BASE_URL = '/api/admin/inventory';

    /**
     * Make API request with retry logic and error handling
     * @param {string} url - API endpoint URL
     * @param {object} options - Fetch options
     * @param {number} retries - Number of retry attempts
     * @returns {Promise<object>} API response data
     */
    async function apiRequest(url, options = {}, retries = 2) {
        const method = (options.method || 'GET').toUpperCase();
        const stateChangingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];

        const defaultHeaders = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        // Add CSRF token for state-changing requests
        if (stateChangingMethods.includes(method)) {
            const csrfToken = typeof window.getCSRFToken === 'function' ? window.getCSRFToken() : '';
            if (csrfToken) {
                defaultHeaders['X-CSRF-Token'] = csrfToken;
            }
        }

        const config = {
            ...options,
            method: method,
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

                console.warn(`[AdminInventoryAPI] Rate limited, retrying after ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return apiRequest(url, options, retries - 1);
            }

            if (!response.ok || data.success === false) {
                let message = data.message || 'Request to inventory API failed';

                // Provide user-friendly error messages
                if (response.status === 429) {
                    message = 'Too many requests. Please wait a moment and try again.';
                } else if (response.status === 404) {
                    message = 'Product not found';
                } else if (response.status === 403) {
                    message = 'Access denied';
                } else if (response.status === 400) {
                    message = data.message || 'Invalid request. Please check your input.';
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
                console.error('[AdminInventoryAPI] Error during API request:', {
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
     * Load inventory products with filters and pagination
     * @param {object} filters - Filter options
     * @param {object} pagination - Pagination options
     * @returns {Promise<object>} Inventory data with pagination
     */
    async function loadInventory(filters = {}, pagination = {}) {
        try {
            const queryParams = new URLSearchParams();

            // Add pagination params
            if (pagination.page) queryParams.append('page', pagination.page);
            if (pagination.limit) queryParams.append('limit', pagination.limit);

            // Add filter params
            if (filters.search) queryParams.append('search', filters.search);
            if (filters.stockStatus) queryParams.append('stockStatus', filters.stockStatus);
            if (filters.category) queryParams.append('category', filters.category);
            if (filters.brand) queryParams.append('brand', filters.brand);
            if (filters.sortBy) queryParams.append('sortBy', filters.sortBy);

            const url = `${BASE_URL}?${queryParams.toString()}`;
            const data = await apiRequest(url);

            return {
                products: data.data?.products || [],
                pagination: data.data?.pagination || {},
                stats: data.data?.stats || {},
                timestamp: data.timestamp
            };
        } catch (error) {
            console.error('[AdminInventoryAPI] Error loading inventory:', error);
            throw error;
        }
    }

    /**
     * Get inventory statistics
     * @returns {Promise<object>} Inventory statistics
     */
    async function getInventoryStats() {
        try {
            const url = `${BASE_URL}/stats`;
            const data = await apiRequest(url);

            return data.data || {};
        } catch (error) {
            console.error('[AdminInventoryAPI] Error loading inventory stats:', error);
            throw error;
        }
    }

    /**
     * Update product stock
     * @param {string} productId - Product ID
     * @param {string} adjustmentType - Adjustment type ('set', 'add', 'subtract')
     * @param {number} quantity - Quantity to adjust
     * @param {string} reason - Optional reason for adjustment
     * @returns {Promise<object>} Updated product data
     */
    async function updateStock(productId, adjustmentType, quantity, reason = '') {
        try {
            if (!productId || productId.trim().length === 0) {
                throw new Error('Product ID is required');
            }

            if (!adjustmentType || !['set', 'add', 'subtract'].includes(adjustmentType)) {
                throw new Error('Invalid adjustment type. Must be: set, add, or subtract.');
            }

            if (quantity === undefined || quantity === null || isNaN(parseInt(quantity))) {
                throw new Error('Quantity must be a valid number');
            }

            const url = `${BASE_URL}/stock/${encodeURIComponent(productId)}`;
            const body = {
                adjustmentType: adjustmentType,
                quantity: parseInt(quantity),
                reason: reason || undefined
            };

            const data = await apiRequest(url, {
                method: 'PUT',
                body: JSON.stringify(body)
            });

            return data.data || null;
        } catch (error) {
            console.error('[AdminInventoryAPI] Error updating stock:', error);
            throw error;
        }
    }

    /**
     * Get list of unique brands
     * @returns {Promise<Array>} Array of brand names
     */
    async function getBrands() {
        try {
            const url = `${BASE_URL}/brands`;
            const data = await apiRequest(url);

            return data.data || [];
        } catch (error) {
            console.error('[AdminInventoryAPI] Error loading brands:', error);
            throw error;
        }
    }

    /**
     * Export inventory to CSV or JSON
     * @param {string} format - Export format ('csv' or 'json')
     * @param {object} filters - Filter options (same as loadInventory)
     * @returns {Promise<void>} Triggers file download
     */
    async function exportInventory(format = 'csv', filters = {}) {
        try {
            if (format !== 'csv' && format !== 'json') {
                throw new Error('Invalid format. Must be: csv or json.');
            }

            const queryParams = new URLSearchParams();

            // Add format param
            queryParams.append('format', format);

            // Add filter params
            if (filters.search) queryParams.append('search', filters.search);
            if (filters.stockStatus) queryParams.append('stockStatus', filters.stockStatus);
            if (filters.category) queryParams.append('category', filters.category);
            if (filters.brand) queryParams.append('brand', filters.brand);
            if (filters.sortBy) queryParams.append('sortBy', filters.sortBy);

            const url = `${BASE_URL}/export?${queryParams.toString()}`;

            // For file downloads, we need to handle the response differently
            const response = await fetch(url);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || 'Failed to export inventory');
            }

            // Get filename from Content-Disposition header or generate one
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = `inventory_export_${new Date().toISOString().split('T')[0]}.${format}`;

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

            return {
                success: true,
                format: format.toLowerCase(),
                filename: filename
            };
        } catch (error) {
            console.error('[AdminInventoryAPI] Error exporting inventory:', error);
            throw error;
        }
    }

    // Expose API functions
    window.AdminInventoryAPI = {
        loadInventory,
        getInventoryStats,
        updateStock,
        getBrands,
        exportInventory
    };

    // Also expose as globals for backwards compatibility
    window.loadInventory = loadInventory;
    window.getInventoryStats = getInventoryStats;
    window.updateStock = updateStock;
    window.getBrands = getBrands;
    window.exportInventory = exportInventory;

})(window);

