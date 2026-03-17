/**
 * CSRF Protection Middleware
 * 
 * Generates CSRF tokens server-side and validates them on state-changing requests.
 * Tokens are stored in the session and exposed to templates via res.locals.csrfToken.
 * 
 * Security features:
 * - Server-side token generation using crypto.randomBytes
 * - Tokens stored in session (server-side, not accessible to client JS)
 * - HttpOnly cookie support (optional, via meta tag for client access)
 * - Validation on POST, PUT, DELETE, PATCH requests
 * - Token rotation on each request (optional, configurable)
 */

const crypto = require('crypto');

/**
 * Generate a secure random CSRF token
 * @returns {string} - Hex-encoded random token (64 characters)
 */
function generateCSRFToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * CSRF Token Generation Middleware
 * Generates a CSRF token and stores it in the session.
 * Makes the token available to templates via res.locals.csrfToken.
 * 
 * This should be applied after session middleware but before routes.
 */
function csrfTokenGenerator(req, res, next) {
    // Generate token if it doesn't exist in session
    if (!req.session.csrfToken) {
        req.session.csrfToken = generateCSRFToken();
    }
    
    // Make token available to templates
    res.locals.csrfToken = req.session.csrfToken;
    
    next();
}

/**
 * CSRF Token Validation Middleware
 * Validates CSRF tokens on state-changing requests (POST, PUT, DELETE, PATCH).
 * 
 * Token can be provided via:
 * - Header: X-CSRF-Token or X-CSRFToken
 * - Body: _csrf or csrfToken
 * - Query: _csrf (less secure, but supported for compatibility)
 * 
 * @param {object} options - Configuration options
 * @param {boolean} options.rotateToken - Whether to rotate token after validation (default: false)
 * @param {Array<string>} options.excludedPaths - Paths to exclude from CSRF validation
 * @returns {Function} - Express middleware
 */
function csrfTokenValidator(options = {}) {
    const {
        rotateToken = false, // Don't rotate by default to avoid issues with multiple tabs
        excludedPaths = [] // Paths that don't need CSRF validation (e.g., webhooks)
    } = options;
    
    return (req, res, next) => {
        // Only validate state-changing methods
        const stateChangingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
        if (!stateChangingMethods.includes(req.method)) {
            return next();
        }
        
        // Check if path is excluded
        if (excludedPaths.some(path => req.path.startsWith(path))) {
            return next();
        }
        
        // Get token from session
        const sessionToken = req.session.csrfToken;
        
        if (!sessionToken) {
            return res.status(403).json({
                success: false,
                message: 'CSRF token missing from session. Please refresh the page.'
            });
        }
        
        // Get token from request (check multiple sources)
        const requestToken = 
            req.headers['x-csrf-token'] || 
            req.headers['x-csrftoken'] ||
            req.body?._csrf ||
            req.body?.csrfToken ||
            req.query?._csrf;
        
        if (!requestToken) {
            return res.status(403).json({
                success: false,
                message: 'CSRF token missing from request. Please include it in headers or body.'
            });
        }
        
        // Validate token (use constant-time comparison to prevent timing attacks)
        // timingSafeEqual requires buffers of the same length
        const sessionBuffer = Buffer.from(sessionToken, 'utf8');
        const requestBuffer = Buffer.from(requestToken, 'utf8');
        
        if (sessionBuffer.length !== requestBuffer.length) {
            return res.status(403).json({
                success: false,
                message: 'Invalid CSRF token. Please refresh the page and try again.'
            });
        }
        
        if (!crypto.timingSafeEqual(sessionBuffer, requestBuffer)) {
            return res.status(403).json({
                success: false,
                message: 'Invalid CSRF token. Please refresh the page and try again.'
            });
        }
        
        // Optionally rotate token after successful validation
        if (rotateToken) {
            req.session.csrfToken = generateCSRFToken();
            res.locals.csrfToken = req.session.csrfToken;
        }
        
        next();
    };
}

/**
 * Get CSRF token from session (helper function for routes)
 * @param {object} req - Express request object
 * @returns {string|null} - CSRF token or null if not found
 */
function getCSRFToken(req) {
    return req.session?.csrfToken || null;
}

module.exports = {
    csrfTokenGenerator,
    csrfTokenValidator,
    getCSRFToken,
    generateCSRFToken
};

