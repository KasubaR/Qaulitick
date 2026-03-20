// Admin Authentication Utilities
// Shared authentication functions for all admin pages

/**
 * Check if user is authenticated
 * Makes a lightweight API call to verify session
 * @returns {Promise<boolean>} True if authenticated, false otherwise
 */
async function checkAuthentication() {
    try {
        // Make a lightweight API call to check authentication
        // Using a simple endpoint that requires authentication
        const response = await fetch('/api/admin/dashboard/stats', {
            method: 'GET',
            credentials: 'include', // Include session cookies
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // If status is 401 or 403, user is not authenticated
        if (response.status === 401 || response.status === 403) {
            return false;
        }

        // If status is 200, user is authenticated
        if (response.ok) {
            return true;
        }

        // For other status codes, assume not authenticated to be safe
        return false;
    } catch (error) {
        console.error('[Auth Utils] Error checking authentication:', error);
        // On network errors, assume not authenticated
        return false;
    }
}

/**
 * Redirect to login page
 * @param {string} message - Optional message to display
 */
function redirectToLogin(message = null) {
    const currentUrl = window.location.pathname + window.location.search;
    let loginUrl = '/admin/login?returnUrl=' + encodeURIComponent(currentUrl);
    
    if (message) {
        loginUrl += '&error=' + encodeURIComponent(message);
    }
    
    window.location.href = loginUrl;
}

/**
 * Handle authentication error (401/403)
 * Shows appropriate message and redirects to login
 * @param {Response} response - Fetch response object
 * @param {string} customMessage - Optional custom error message
 */
function handleAuthError(response, customMessage = null) {
    const status = response.status;
    
    let message = customMessage;
    
    if (!message) {
        if (status === 401) {
            message = 'Your session has expired. Please log in again.';
        } else if (status === 403) {
            message = 'Access denied. You do not have permission to perform this action.';
        } else {
            message = 'Authentication required. Please log in.';
        }
    }
    
    // Show notification if notification system is available
    if (window.showNotification) {
        window.showNotification(message, 'error');
    } else {
        // Fallback: alert
        alert(message);
    }
    
    // Redirect to login after a short delay
    setTimeout(() => {
        redirectToLogin(message);
    }, 1500);
}

/**
 * Get CSRF token from meta tag
 * @returns {string|null} CSRF token or null if not found
 */
function getCSRFToken() {
    const metaTag = document.querySelector('meta[name="csrf-token"]');
    return metaTag ? metaTag.getAttribute('content') : null;
}

/**
 * Authenticated fetch wrapper
 * Wraps fetch() to automatically handle 401/403 responses and include CSRF tokens
 * @param {string} url - Request URL
 * @param {object} options - Fetch options
 * @returns {Promise<Response>} Fetch response
 */
async function authenticatedFetch(url, options = {}) {
    // Get CSRF token from meta tag
    const csrfToken = getCSRFToken();
    
    // Build headers with CSRF token for state-changing methods
    const stateChangingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
    const method = (options.method || 'GET').toUpperCase();
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    // Add CSRF token for state-changing requests
    if (stateChangingMethods.includes(method) && csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
    }
    
    // Ensure credentials are included
    const fetchOptions = {
        ...options,
        credentials: 'include',
        headers
    };

    try {
        const response = await fetch(url, fetchOptions);

        // Handle authentication errors
        if (response.status === 401 || response.status === 403) {
            handleAuthError(response);
            // Return a rejected promise to stop further processing
            throw new Error(`Authentication failed: ${response.status}`);
        }

        return response;
    } catch (error) {
        // Re-throw network errors
        if (error.message.includes('Authentication failed')) {
            throw error;
        }
        
        // For other errors, check if it's a network error
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            console.error('[Auth Utils] Network error:', error);
            if (window.showNotification) {
                window.showNotification('Network error. Please check your connection.', 'error');
            }
        }
        
        throw error;
    }
}

/**
 * Initialize authentication check on page load
 * Should be called in DOMContentLoaded event
 */
async function initializeAuthCheck() {
    try {
        const isAuthenticated = await checkAuthentication();
        
        if (!isAuthenticated) {
            console.warn('[Auth Utils] User not authenticated, redirecting to login...');
            redirectToLogin('Please log in to access this page.');
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('[Auth Utils] Error during authentication check:', error);
        redirectToLogin('An error occurred while checking authentication.');
        return false;
    }
}

/**
 * Setup global fetch interceptor for API calls
 * Intercepts all fetch calls and handles 401/403 responses and CSRF tokens
 */
function setupFetchInterceptor() {
    // Store original fetch
    const originalFetch = window.fetch;
    
    // Override fetch
    window.fetch = async function(url, options = {}) {
        // Only intercept API calls
        if (typeof url === 'string' && url.startsWith('/api/admin')) {
            try {
                // Get CSRF token for state-changing methods
                const method = (options.method || 'GET').toUpperCase();
                const stateChangingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
                const csrfToken = getCSRFToken();
                
                const headers = {
                    ...options.headers
                };
                
                // Add CSRF token for state-changing requests
                if (stateChangingMethods.includes(method) && csrfToken) {
                    headers['X-CSRF-Token'] = csrfToken;
                }
                
                const response = await originalFetch(url, {
                    ...options,
                    credentials: 'include',
                    headers
                });
                
                // Handle authentication errors
                if (response.status === 401 || response.status === 403) {
                    handleAuthError(response);
                    // Return a response that will cause the caller to handle the error
                    return response;
                }
                
                return response;
            } catch (error) {
                throw error;
            }
        }
        
        // For non-admin API calls, use original fetch
        return originalFetch(url, options);
    };
}

// Export functions for use in other scripts
window.AuthUtils = {
    checkAuthentication,
    redirectToLogin,
    handleAuthError,
    authenticatedFetch,
    initializeAuthCheck,
    setupFetchInterceptor
};

// Auto-setup fetch interceptor when this script loads
setupFetchInterceptor();

