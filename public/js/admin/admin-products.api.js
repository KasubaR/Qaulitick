// Admin Products API - data layer (no DOM access)
// Provides helper functions for CRUD operations on /api/products

(function (window) {
    const BASE_URL = '/api/products';

    /**
     * Internal helper to perform API requests
     * @param {string} url
     * @param {RequestInit} options
     * @returns {Promise<any>} Parsed JSON response
     */
    async function apiRequest(url, options = {}) {
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

            if (!response.ok || data.success === false) {
                const message = data.message || 'Request to products API failed';
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
            console.error('[AdminProductsAPI] Error during API request:', {
                url: url,
                method: config.method,
                message: error.message
            });
            throw error;
        }
    }

    /**
     * Load products with optional filters and pagination
     * @param {object} filters - Filter parameters
     * @param {number} page - Page number (default: 1)
     * @param {number} limit - Items per page (default: 12)
     * @returns {Promise<Object>} - { products: Array, pagination: Object }
     */
    async function loadProducts(filters = {}, page = 1, limit = 12) {
        const queryParams = new URLSearchParams(
            Object.assign(
                {
                    status: filters.status || 'all', // 'all' for admin to show all products
                    page: page.toString(),
                    limit: limit.toString()
                },
                filters
            )
        );

        const data = await apiRequest(`${BASE_URL}?${queryParams.toString()}`, {
            method: 'GET'
        });

        return {
            products: Array.isArray(data.products) ? data.products : [],
            pagination: data.pagination || {
                currentPage: 1,
                totalPages: 0,
                totalProducts: 0,
                limit: limit,
                hasNextPage: false,
                hasPrevPage: false
            }
        };
    }

    /**
     * Search products by text query
     * @param {string} searchQuery - Search term
     * @param {number} page - Page number (default: 1)
     * @param {number} limit - Items per page (default: 12)
     * @returns {Promise<Object>} - { products: Array, pagination: Object }
     */
    async function searchProducts(searchQuery, page = 1, limit = 12) {
        const queryParams = new URLSearchParams({
            q: searchQuery,
            page: page.toString(),
            limit: limit.toString()
        });

        const data = await apiRequest(`${BASE_URL}/search?${queryParams.toString()}`, {
            method: 'GET'
        });

        return {
            products: Array.isArray(data.products) ? data.products : [],
            pagination: data.pagination || {
                currentPage: 1,
                totalPages: 0,
                totalProducts: 0,
                limit: limit,
                hasNextPage: false,
                hasPrevPage: false
            }
        };
    }

    /**
     * Create a new product
     * @param {object} productData
     * @returns {Promise<object>} Created product
     */
    async function createProduct(productData) {
        const data = await apiRequest(BASE_URL, {
            method: 'POST',
            body: JSON.stringify(productData)
        });

        return data.product || null;
    }

    /**
     * Get a single product by ID
     * @param {string} id
     * @returns {Promise<object>} Product data
     */
    async function getProductById(id) {
        if (!id) {
            throw new Error('Product ID is required to get a product');
        }

        const data = await apiRequest(`${BASE_URL}/${id}`, {
            method: 'GET'
        });

        return data.product || null;
    }

    /**
     * Update an existing product by ID
     * @param {string} id
     * @param {object} productData
     * @returns {Promise<object>} Updated product
     */
    async function updateProduct(id, productData) {
        if (!id) {
            throw new Error('Product ID is required to update a product');
        }

        const data = await apiRequest(`${BASE_URL}/${id}`, {
            method: 'PUT',
            body: JSON.stringify(productData)
        });

        return data.product || null;
    }

    /**
     * Delete a product by ID
     * @param {string} id
     * @returns {Promise<void>}
     */
    async function deleteProduct(id) {
        if (!id) {
            throw new Error('Product ID is required to delete a product');
        }

        await apiRequest(`${BASE_URL}/${id}`, {
            method: 'DELETE'
        });
    }

    // Expose API on global window object
    window.AdminProductsAPI = {
        loadProducts: loadProducts,
        searchProducts: searchProducts,
        getProductById: getProductById,
        createProduct: createProduct,
        updateProduct: updateProduct,
        deleteProduct: deleteProduct
    };
})(window);


