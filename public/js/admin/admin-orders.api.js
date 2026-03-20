// Admin Orders API - data layer (no DOM access)
// Provides helper functions for CRUD operations on /api/admin/orders

(function (window) {
    const BASE_URL = '/api/admin/orders';

    /**
     * Internal helper to perform API requests with retry logic for rate limits
     * @param {string} url
     * @param {RequestInit} options
     * @param {number} retries - Number of retries remaining
     * @returns {Promise<any>} Parsed JSON response
     */
    async function apiRequest(url, options = {}, retries = 2) {
        const method = (options.method || 'GET').toUpperCase();
        const stateChangingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];

        const defaultHeaders = {
            'Content-Type': 'application/json'
        };

        // Add CSRF token for state-changing requests
        if (stateChangingMethods.includes(method)) {
            const csrfToken = typeof window.getCSRFToken === 'function' ? window.getCSRFToken() : '';
            if (csrfToken) {
                defaultHeaders['X-CSRF-Token'] = csrfToken;
            }
        }

        const config = Object.assign(
            {
                method: method,
                headers: defaultHeaders
            },
            options
        );

        try {
            const response = await fetch(url, config);
            const data = await response.json().catch(() => ({}));

            // Handle rate limiting (429) with retry
            if (response.status === 429 && retries > 0) {
                const retryAfter = response.headers.get('Retry-After');
                const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, 3 - retries) * 1000; // Exponential backoff

                console.warn(`[AdminOrdersAPI] Rate limited, retrying after ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return apiRequest(url, options, retries - 1);
            }

            if (!response.ok || data.success === false) {
                let message = data.message || 'Request to orders API failed';

                // Provide user-friendly error messages
                if (response.status === 429) {
                    message = 'Too many requests. Please wait a moment and try again.';
                } else if (response.status === 404) {
                    message = 'Order not found';
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
                console.error('[AdminOrdersAPI] Error during API request:', {
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
     * Load orders with optional filters
     * @param {object} filters - Filter parameters (status, paymentStatus, email, startDate, endDate, sort, search, updatedSince)
     * @returns {Promise<Object>} - { orders: Array, count: number }
     */
    async function loadOrders(filters = {}) {
        const queryParams = new URLSearchParams();

        // Add filters to query params
        if (filters.status) queryParams.append('status', filters.status);
        if (filters.paymentStatus) queryParams.append('paymentStatus', filters.paymentStatus);
        if (filters.paymentMethod) queryParams.append('paymentMethod', filters.paymentMethod);
        if (filters.email) queryParams.append('email', filters.email);
        if (filters.startDate) queryParams.append('startDate', filters.startDate);
        if (filters.endDate) queryParams.append('endDate', filters.endDate);
        if (filters.sort) queryParams.append('sort', filters.sort);
        if (filters.search) queryParams.append('search', filters.search);
        if (filters.updatedSince) queryParams.append('updatedSince', filters.updatedSince);

        const queryString = queryParams.toString();
        const url = queryString ? `${BASE_URL}?${queryString}` : BASE_URL;

        const data = await apiRequest(url, {
            method: 'GET'
        });

        return {
            orders: Array.isArray(data.orders) ? data.orders : [],
            count: data.count || 0
        };
    }

    /**
     * Get a single order by order number
     * @param {string} orderNumber
     * @returns {Promise<object>} Order data
     */
    async function getOrderByNumber(orderNumber) {
        if (!orderNumber) {
            throw new Error('Order number is required to get an order');
        }

        const data = await apiRequest(`${BASE_URL}/${orderNumber}`, {
            method: 'GET'
        });

        return data.order || null;
    }

    /**
     * Update order status
     * @param {string} orderNumber
     * @param {string} status - New status
     * @param {string} notes - Optional notes
     * @returns {Promise<object>} Updated order
     */
    async function updateOrderStatus(orderNumber, status, notes = '') {
        if (!orderNumber) {
            throw new Error('Order number is required to update status');
        }
        if (!status) {
            throw new Error('Status is required');
        }

        const data = await apiRequest(`${BASE_URL}/${orderNumber}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status, notes })
        });

        return data.order || null;
    }

    /**
     * Update tracking information
     * @param {string} orderNumber
     * @param {string} trackingNumber
     * @param {string} courier
     * @returns {Promise<object>} Updated order
     */
    async function updateTracking(orderNumber, trackingNumber, courier) {
        if (!orderNumber) {
            throw new Error('Order number is required to update tracking');
        }
        if (!trackingNumber) {
            throw new Error('Tracking number is required');
        }

        const data = await apiRequest(`${BASE_URL}/${orderNumber}/tracking`, {
            method: 'PATCH',
            body: JSON.stringify({ trackingNumber, courier })
        });

        return data.order || null;
    }

    /**
     * Add a note to an order
     * @param {string} orderNumber
     * @param {string} note
     * @returns {Promise<object>} Updated order
     */
    async function addOrderNote(orderNumber, note) {
        if (!orderNumber) {
            throw new Error('Order number is required to add a note');
        }
        if (!note || !note.trim()) {
            throw new Error('Note text is required');
        }

        const data = await apiRequest(`${BASE_URL}/${orderNumber}/notes`, {
            method: 'POST',
            body: JSON.stringify({ note: note.trim() })
        });

        return data.order || null;
    }

    /**
     * Verify payment for an order
     * @param {string} orderNumber
     * @returns {Promise<object>} Verification result
     */
    async function verifyOrderPayment(orderNumber) {
        if (!orderNumber) {
            throw new Error('Order number is required to verify payment');
        }

        const data = await apiRequest(`${BASE_URL}/${orderNumber}/verify-payment`, {
            method: 'GET'
        });

        return data;
    }

    /**
     * Generate and download invoice PDF
     * @param {string} orderNumber
     * @returns {Promise<void>}
     */
    async function generateInvoice(orderNumber) {
        if (!orderNumber) {
            throw new Error('Order number is required to generate invoice');
        }

        // Create a download link
        const url = `${BASE_URL}/${orderNumber}/invoice`;

        // Open in new window to trigger download
        window.open(url, '_blank');
    }

    /**
     * Send invoice email to customer
     * @param {string} orderNumber
     * @param {object} options - Optional { cc, bcc }
     * @returns {Promise<object>} Email send result
     */
    async function sendInvoiceEmail(orderNumber, options = {}) {
        if (!orderNumber) {
            throw new Error('Order number is required to send invoice email');
        }

        const data = await apiRequest(`${BASE_URL}/${orderNumber}/send-invoice`, {
            method: 'POST',
            body: JSON.stringify(options)
        });

        return data;
    }

    /**
     * Delete a single order
     * @param {string} orderNumber
     * @returns {Promise<object>} Delete result
     */
    async function deleteOrder(orderNumber) {
        if (!orderNumber) {
            throw new Error('Order number is required to delete an order');
        }

        const data = await apiRequest(`${BASE_URL}/${orderNumber}`, {
            method: 'DELETE'
        });

        return data;
    }

    /**
     * Delete multiple orders (bulk delete)
     * @param {string[]} orderNumbers - Array of order numbers to delete
     * @returns {Promise<object>} Delete result
     */
    async function deleteOrders(orderNumbers) {
        if (!orderNumbers || !Array.isArray(orderNumbers) || orderNumbers.length === 0) {
            throw new Error('Order numbers array is required for bulk delete');
        }

        const data = await apiRequest(BASE_URL, {
            method: 'DELETE',
            body: JSON.stringify({ orderNumbers })
        });

        return data;
    }

    /**
     * Export orders to CSV or JSON
     * @param {string} format - 'csv' or 'json' (default: 'csv')
     * @param {object} filters - Filter criteria (same as loadOrders)
     * @returns {Promise<object>} Export result with filename
     */
    async function exportOrders(format = 'csv', filters = {}) {
        try {
            // Build query string from filters
            const queryParams = new URLSearchParams();
            queryParams.append('format', format.toLowerCase());

            if (filters.email) queryParams.append('email', filters.email);
            if (filters.status) queryParams.append('status', filters.status);
            if (filters.paymentStatus) queryParams.append('paymentStatus', filters.paymentStatus);
            if (filters.paymentMethod) queryParams.append('paymentMethod', filters.paymentMethod);
            if (filters.startDate) queryParams.append('startDate', filters.startDate);
            if (filters.endDate) queryParams.append('endDate', filters.endDate);
            if (filters.search) queryParams.append('search', filters.search);
            if (filters.sort) queryParams.append('sort', filters.sort);

            const url = `${BASE_URL}/export?${queryParams.toString()}`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || 'Failed to export orders');
            }

            // Get filename from Content-Disposition header or generate one
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = `orders_export_${new Date().toISOString().split('T')[0]}.${format}`;

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
            console.error('[AdminOrdersAPI] Error exporting orders:', error);
            throw error;
        }
    }

    // Expose API on global window object
    window.AdminOrdersAPI = {
        loadOrders: loadOrders,
        getOrderByNumber: getOrderByNumber,
        updateOrderStatus: updateOrderStatus,
        updateTracking: updateTracking,
        addOrderNote: addOrderNote,
        verifyOrderPayment: verifyOrderPayment,
        generateInvoice: generateInvoice,
        sendInvoiceEmail: sendInvoiceEmail,
        deleteOrder: deleteOrder,
        deleteOrders: deleteOrders,
        exportOrders: exportOrders
    };
})(window);

