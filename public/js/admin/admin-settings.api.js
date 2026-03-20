/**
 * Admin Settings API Client
 * 
 * Handles all API calls for admin settings management
 * Follows the same pattern as other admin API clients
 */

(function (window) {
    const BASE_URL = '/api/admin/settings';

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

        // Construct full URL
        const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;

        try {
            const response = await fetch(fullUrl, config);
            const data = await response.json().catch(() => ({}));

            // Handle rate limiting (429) with retry
            if (response.status === 429 && retries > 0) {
                const retryAfter = response.headers.get('Retry-After');
                const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, 3 - retries) * 1000; // Exponential backoff

                console.warn(`[AdminSettingsAPI] Rate limited, retrying after ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return apiRequest(url, options, retries - 1);
            }

            if (!response.ok || data.success === false) {
                let message = data.message || 'Request to settings API failed';

                // Provide user-friendly error messages
                if (response.status === 429) {
                    message = 'Too many requests. Please wait a moment and try again.';
                } else if (response.status === 404) {
                    message = data.message || 'Settings not found.';
                } else if (response.status === 403) {
                    message = 'Access denied. You do not have permission to perform this action.';
                } else if (response.status === 400) {
                    message = data.message || 'Invalid request. Please check your input.';
                } else if (response.status === 401) {
                    message = 'Unauthorized. Please log in again.';
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
                console.error('[AdminSettingsAPI] Error during API request:', {
                    url: fullUrl,
                    method: config.method,
                    status: error.status,
                    message: error.message
                });
            }

            // Handle network errors
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                throw new Error('Network error. Please check your internet connection and try again.');
            }

            throw error;
        }
    }

    /**
     * Get all settings
     * @returns {Promise<object>} All settings data
     */
    async function getSettings() {
        try {
            const response = await apiRequest('');
            return response.data;
        } catch (error) {
            console.error('[AdminSettingsAPI] Error getting settings:', error);
            throw error;
        }
    }

    /**
     * Get notification settings only
     * @returns {Promise<object>} Notification settings data
     */
    async function getNotificationSettings() {
        try {
            const response = await apiRequest('/notifications');
            return response.data;
        } catch (error) {
            console.error('[AdminSettingsAPI] Error getting notification settings:', error);
            throw error;
        }
    }

    /**
     * Update settings by category
     * @param {string} category - Settings category (general, store, payment, email, security, notifications)
     * @param {object} data - Settings data to update
     * @returns {Promise<object>} Updated settings data
     */
    async function updateSettings(category, data) {
        try {
            if (!category) {
                throw new Error('Category is required');
            }

            if (!data || Object.keys(data).length === 0) {
                throw new Error('Settings data is required');
            }

            const validCategories = ['general', 'store', 'payment', 'email', 'security', 'notifications'];
            if (!validCategories.includes(category)) {
                throw new Error(`Invalid category. Valid categories: ${validCategories.join(', ')}`);
            }

            const response = await apiRequest(`/${category}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });

            return response.data;
        } catch (error) {
            console.error(`[AdminSettingsAPI] Error updating ${category} settings:`, error);
            throw error;
        }
    }

    /**
     * Send test notification email
     * @returns {Promise<object>} Test email result
     */
    async function testEmail() {
        try {
            const response = await apiRequest('/test-email', {
                method: 'POST'
            });

            return response.data;
        } catch (error) {
            console.error('[AdminSettingsAPI] Error sending test email:', error);
            throw error;
        }
    }

    /**
     * Test payment connection
     * @returns {Promise<object>} Payment test result
     */
    async function testPayment() {
        try {
            const response = await apiRequest('/test-payment', {
                method: 'POST'
            });

            return response.data;
        } catch (error) {
            console.error('[AdminSettingsAPI] Error testing payment connection:', error);
            throw error;
        }
    }

    // Expose API functions
    window.AdminSettingsAPI = {
        getSettings,
        getNotificationSettings,
        updateSettings,
        testEmail,
        testPayment
    };

    // Log initialization
    console.log('[AdminSettingsAPI] Settings API client initialized');

})(window);

