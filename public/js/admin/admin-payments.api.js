// Admin Payments API - data layer (no DOM access)
// Provides helper functions for CRUD operations on /api/payments

(function (window) {
    const BASE_URL = '/api/payments';

    /**
     * Internal helper to perform API requests
     * @param {string} url
     * @param {RequestInit} options
     * @returns {Promise<any>} Parsed JSON response
     */
    async function apiRequest(url, options = {}) {
        const method = (options.method || 'GET').toUpperCase();
        const stateChangingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];

        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };

        if (stateChangingMethods.includes(method)) {
            const csrfMeta = document.querySelector('meta[name="csrf-token"]');
            const csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';
            if (csrfToken) {
                headers['X-CSRF-Token'] = csrfToken;
            }
        }

        const config = {
            ...options,
            method,
            credentials: 'include',
            headers: { ...headers, ...(options.headers || {}) }
        };

        try {
            const response = await fetch(url, config);
            const data = await response.json().catch(() => ({}));

            if (!response.ok || data.success === false) {
                const message = data.message || 'Request to payments API failed';
                const errors = Array.isArray(data.errors) ? data.errors : [];
                const error = new Error(
                    errors.length > 0 ? errors.join('\n') : message
                );
                error.response = response;
                error.data = data;
                throw error;
            }

            return data;
        } catch (error) {
            // Centralized logging for debugging
            console.error('[AdminPaymentsAPI] Error during API request:', {
                url: url,
                method: config.method,
                message: error.message
            });
            throw error;
        }
    }

    /**
     * Load payments with optional filters
     * @param {object} filters - Filter parameters (status, paymentMethod, provider, startDate, endDate, sort, search, page, limit)
     * @returns {Promise<Object>} - { payments: Array, pagination: Object }
     */
    async function loadPayments(filters = {}) {
        const queryParams = new URLSearchParams();
        
        // Add filters to query params
        if (filters.status) queryParams.append('status', filters.status);
        if (filters.paymentMethod) queryParams.append('paymentMethod', filters.paymentMethod);
        if (filters.provider) queryParams.append('provider', filters.provider);
        if (filters.startDate) queryParams.append('startDate', filters.startDate);
        if (filters.endDate) queryParams.append('endDate', filters.endDate);
        if (filters.sort) queryParams.append('sort', filters.sort);
        if (filters.search) queryParams.append('search', filters.search);
        if (filters.page) queryParams.append('page', filters.page);
        if (filters.limit) queryParams.append('limit', filters.limit);

        const queryString = queryParams.toString();
        const url = queryString ? `${BASE_URL}?${queryString}` : BASE_URL;

        const data = await apiRequest(url, {
            method: 'GET'
        });

        return {
            payments: Array.isArray(data.payments) ? data.payments : [],
            pagination: data.pagination || {
                currentPage: 1,
                totalPages: 1,
                totalPayments: 0,
                limit: 50,
                hasNext: false,
                hasPrev: false
            }
        };
    }

    /**
     * Get a single payment by ID
     * @param {string} paymentId
     * @returns {Promise<object>} Payment data
     */
    async function getPaymentById(paymentId) {
        if (!paymentId) {
            throw new Error('Payment ID is required to get a payment');
        }

        const data = await apiRequest(`${BASE_URL}/${paymentId}`, {
            method: 'GET'
        });

        return data.payment || null;
    }

    /**
     * Delete a payment by primary key id (admin)
     * @param {number|string} paymentId
     */
    async function deletePayment(paymentId) {
        const id = parseInt(String(paymentId), 10);
        if (!Number.isFinite(id) || id < 1) {
            throw new Error('Invalid payment ID');
        }
        return apiRequest(`${BASE_URL}/${id}`, {
            method: 'DELETE'
        });
    }

    /**
     * Verify payment status with Lenco
     * @param {string} transactionId - Payment transaction ID
     * @returns {Promise<object>} Verification result
     */
    async function verifyPayment(transactionId) {
        if (!transactionId) {
            throw new Error('Transaction ID is required to verify payment');
        }

        const data = await apiRequest(`${BASE_URL}/verify/${transactionId}`, {
            method: 'GET'
        });

        return data;
    }

    // Expose API on global window object
    window.AdminPaymentsAPI = {
        loadPayments: loadPayments,
        getPaymentById: getPaymentById,
        deletePayment: deletePayment,
        verifyPayment: verifyPayment
    };
})(window);

