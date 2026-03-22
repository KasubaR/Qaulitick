// Authentication Middleware
// Handles admin authentication and authorization

const crypto = require('crypto');
const adminService = require('../services/admin.service');

/**
 * Validate secret token against environment variable
 * @param {string} secret - Secret token to validate
 * @returns {boolean} - True if secret is valid, false otherwise
 */
function validateSecretToken(secret) {
    const adminSecretToken = process.env.ADMIN_SECRET_TOKEN;

    if (!adminSecretToken) {
        console.warn('[Auth Middleware] ADMIN_SECRET_TOKEN not configured in environment variables');
        return false;
    }

    if (!secret) return false;

    try {
        const a = Buffer.from(String(adminSecretToken), 'utf8');
        const b = Buffer.from(String(secret), 'utf8');
        // Lengths must match — timingSafeEqual requires equal-length buffers.
        // Returning false here does leak that the length is wrong, but secret
        // length is not a meaningful oracle since the token is never user-chosen.
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

/**
 * Get authenticated admin from session
 * @param {Object} req - Express request object
 * @returns {Promise<Object|null>} - Admin object if authenticated, null otherwise
 */
async function getAuthenticatedAdmin(req) {
    if (!req.session?.adminId) return null;

    try {
        const admin = await adminService.getAdminById(req.session.adminId);

        if (!admin) {
            // Admin record confirmed deleted — clear the stale session data
            req.session.adminId = null;
            req.session.adminEmail = null;
            return null;
        }

        return admin;
    } catch (error) {
        // DB error (timeout, connection failure, etc.) — do NOT clear the session.
        // Treating a transient DB blip the same as a deleted admin would log the
        // admin out under load, and the session data is still valid.
        console.error('[Auth Middleware] DB error fetching admin:', error);
        return null;
    }
}

/**
 * Middleware to check if user has valid admin session
 * For API routes - returns 401/403 JSON response if not authenticated
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function authenticateAdmin(req, res, next) {
    try {
        const admin = await getAuthenticatedAdmin(req);
        
        if (!admin) {
            // Not authenticated
            return res.status(401).json({
                success: false,
                message: 'Authentication required. Please log in.',
                error: 'UNAUTHORIZED'
            });
        }
        
        // Attach admin to request object for use in route handlers
        req.admin = admin;
        next();
    } catch (error) {
        console.error('[Auth Middleware] Error in authenticateAdmin:', error);
        return res.status(500).json({
            success: false,
            message: 'Authentication error occurred',
            error: 'INTERNAL_ERROR'
        });
    }
}

/**
 * Middleware that redirects to login if not authenticated
 * For page routes - redirects to login page if not authenticated
 * Also attaches admin data to res.locals for use in EJS templates
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function requireAdminAuth(req, res, next) {
    try {
        const admin = await getAuthenticatedAdmin(req);
        
        if (!admin) {
            // Not authenticated - redirect to login
            // Store intended destination for redirect after login
            const returnUrl = req.path; // path only — strips query strings that may contain sensitive params
            return res.redirect(`/admin/login?returnUrl=${encodeURIComponent(returnUrl)}`);
        }
        
        // Attach admin to request object for use in route handlers
        req.admin = admin;
        
        // Attach admin to res.locals for use in EJS templates
        res.locals.admin = {
            email: admin.email,
            name: admin.name || admin.email,
            id: admin._id || admin.id
        };
        
        next();
    } catch (error) {
        console.error('[Auth Middleware] Error in requireAdminAuth:', error);
        // Redirect to login on error
        return res.redirect('/admin/login?error=authentication_error');
    }
}

/**
 * Optional middleware: Check if admin is authenticated (doesn't block)
 * Useful for conditionally showing content based on auth status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function optionalAdminAuth(req, res, next) {
    try {
        const admin = await getAuthenticatedAdmin(req);
        if (admin) {
            req.admin = admin;
        }
        next();
    } catch (error) {
        // Don't block on error, just continue
        console.error('[Auth Middleware] Error in optionalAdminAuth:', error);
        next();
    }
}

module.exports = {
    validateSecretToken,
    authenticateAdmin,
    requireAdminAuth,
    optionalAdminAuth,
    getAuthenticatedAdmin
};

