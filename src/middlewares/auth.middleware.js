// Authentication Middleware
// Handles admin authentication and authorization

const crypto = require('crypto');
const adminService = require('../services/admin.service');
const logger = require('../utils/logger').child({ module: 'AdminAuthMiddleware' });

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
        // Re-throw so callers can distinguish DB failure from "not found".
        logger.error({ err: error }, 'DB error fetching admin');
        throw error;
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
        logger.error({ err: error }, 'Error in authenticateAdmin');
        return res.status(503).json({
            success: false,
            message: 'Service temporarily unavailable. Please try again shortly.',
            error: 'SERVICE_UNAVAILABLE'
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
            // Not authenticated — redirect to access-denied.
            // The admin login page requires a secret URL token that cannot be
            // reconstructed here, so redirect to the access-denied page which
            // instructs the admin to use the correct secret URL.
            return res.redirect('/admin/access-denied?error=' + encodeURIComponent('Your session has expired. Please log in again using the admin secret URL.'));
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
        logger.error({ err: error }, 'Error in requireAdminAuth');
        // DB failure — don't treat as unauthenticated or redirect to access-denied,
        // which could itself require auth and cause a loop. Return 503 instead.
        return res.status(503).render('500', { message: 'Service temporarily unavailable. Please try again shortly.' });
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
        logger.error({ err: error }, 'Error in optionalAdminAuth');
        next();
    }
}

module.exports = {
    validateSecretToken,
    authenticateAdmin,
    requireAdminAuth,
    optionalAdminAuth
};

