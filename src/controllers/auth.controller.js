// Authentication Controller
// Handles admin login, logout, and authentication

const adminService = require('../services/admin.service');
const { validateSecretToken } = require('../middlewares/auth.middleware');
const { sanitizeObject, sanitizeString } = require('../utils/validators');
const { cookieName: sessionCookieName } = require('../config/session.constants');
const logger = require('../utils/logger').child({ module: 'AuthController' });

/**
 * Validate and sanitize a return URL to prevent open redirect.
 * Decodes percent-encoding first so path-traversal tricks like
 * /admin%2F..%2F%2Fevil.com are caught before the prefix check.
 */
function safeAdminReturnUrl(raw) {
    try {
        const decoded = decodeURIComponent(typeof raw === 'string' ? raw : '');
        return /^\/admin(\/|$)/.test(decoded) && !decoded.startsWith('//') ? decoded : '/admin/dashboard';
    } catch {
        return '/admin/dashboard';
    }
}

/**
 * Render login page (validates secret URL first)
 * GET /admin/login
 */
exports.renderLoginPage = async (req, res) => {
    try {
        // Get secret token from query parameter
        const secret = req.query.secret;
        
        // Validate secret token
        if (!secret || !validateSecretToken(secret)) {
            // Invalid or missing secret - show access denied
            return res.render('admin/access-denied', {
                title: 'Access Denied | Admin Login',
                page: 'admin',
                error: 'Invalid or missing secret URL token. Please use the correct secret URL to access the login page.',
                showLoginLink: false
            });
        }
        
        // Get return URL if provided (for redirect after login)
        const returnUrl = safeAdminReturnUrl(req.query.returnUrl);

        // Render login page (pass csrfToken and secretToken as hidden form fields)
        res.render('admin/login', {
            title: 'Admin Login | Qualitick Collections',
            page: 'admin',
            returnUrl: returnUrl,
            secretToken: secret,
            error: sanitizeString(req.query.error || ''),
            message: sanitizeString(req.query.message || ''),
            csrfToken: req.session.csrfToken || res.locals.csrfToken || ''
        });
    } catch (error) {
        logger.error({ op: 'renderLoginPage', err: error }, 'Error rendering login page');
        res.status(500).render('admin/access-denied', {
            title: 'Error | Admin Login',
            page: 'admin',
            error: 'An error occurred while loading the login page. Please try again.',
            showLoginLink: false
        });
    }
};

/**
 * Handle login form submission
 * POST /admin/login
 */
exports.handleLogin = async (req, res) => {
    try {
        // Sanitize input
        const sanitizedBody = sanitizeObject(req.body);
        const { email, password, returnUrl } = sanitizedBody;
        
        // Validate secret token (from hidden form field or query parameter)
        const secret = sanitizedBody.secretToken || req.query.secret;
        if (!secret || !validateSecretToken(secret)) {
            return res.status(403).render('admin/access-denied', {
                title: 'Access Denied | Admin Login',
                page: 'admin',
                error: 'Invalid or expired secret URL token. Please access the login page using the correct secret URL.',
                showLoginLink: false
            });
        }
        
        // Validate required fields
        if (!email || !password) {
            return res.status(400).render('admin/login', {
                title: 'Admin Login | Qualitick Collections',
                page: 'admin',
                error: 'Email and password are required.',
                returnUrl: returnUrl || '/admin/dashboard',
                email: email || ''
            });
        }
        
        // Validate email format (basic validation)
        const emailRegex = /^\S+@\S+\.\S+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).render('admin/login', {
                title: 'Admin Login | Qualitick Collections',
                page: 'admin',
                error: 'Please enter a valid email address.',
                returnUrl: returnUrl || '/admin/dashboard',
                email: email
            });
        }
        
        // Validate admin credentials
        const admin = await adminService.validateAdminCredentials(email, password);
        
        if (!admin) {
            // Invalid credentials - don't reveal which field is wrong (security best practice)
            return res.status(401).render('admin/login', {
                title: 'Admin Login | Qualitick Collections',
                page: 'admin',
                error: 'Invalid email or password. Please try again.',
                returnUrl: returnUrl || '/admin/dashboard',
                email: '' // Don't pre-fill email on error for security
            });
        }
        
        // Valid credentials - regenerate session ID before writing auth data (prevents session fixation)
        const adminPk = admin.id != null ? admin.id : admin._id;

        // Update last login timestamp (do before regenerate so errors don't block login)
        try {
            await adminService.updateLastLogin(adminPk);
        } catch (updateError) {
            logger.error({ op: 'updateLastLogin', err: updateError }, 'Error updating last login');
        }

        logger.info({ op: 'adminLogin' }, 'Admin authenticated');

        const redirectUrl = safeAdminReturnUrl(returnUrl);

        req.session.regenerate((regenErr) => {
            if (regenErr) {
                logger.error({ op: 'sessionRegenerate', err: regenErr }, 'Session regeneration failed');
                return res.status(500).render('admin/login', {
                    title: 'Admin Login | Qualitick Collections',
                    page: 'admin',
                    error: 'Could not establish a secure session. Please try again.',
                    returnUrl: redirectUrl,
                    email: ''
                });
            }

            req.session.adminId = String(adminPk);
            req.session.adminEmail = admin.email;
            req.session.adminName = admin.name || admin.email;
            req.session.csrfToken = require('crypto').randomBytes(32).toString('hex');

            req.session.save((saveErr) => {
                if (saveErr) {
                    logger.error({ op: 'sessionSave', err: saveErr }, 'Session save failed');
                    return res.status(500).render('admin/login', {
                        title: 'Admin Login | Qualitick Collections',
                        page: 'admin',
                        error: 'Could not save session. Please try again.',
                        returnUrl: redirectUrl,
                        email: ''
                    });
                }
                res.redirect(redirectUrl);
            });
        });
    } catch (error) {
        logger.error({ op: 'handleLogin', err: error }, 'Error handling login');
        res.status(500).render('admin/login', {
            title: 'Admin Login | Qualitick Collections',
            page: 'admin',
            error: 'An error occurred during login. Please try again later.',
            returnUrl: req.body.returnUrl || '/admin/dashboard',
            email: ''
        });
    }
};

/**
 * Handle logout
 * GET /admin/logout or POST /admin/logout
 */
exports.handleLogout = async (req, res) => {
    try {
        // Destroy session
        req.session.destroy((err) => {
            if (err) {
                logger.error({ op: 'sessionDestroy', err }, 'Error destroying session');
                return res.status(500).render('admin/access-denied', {
                    title: 'Logout Error | Admin',
                    page: 'admin',
                    error: 'Could not log out. Please try again.',
                    showLoginLink: false
                });
            }

            logger.info({ op: 'adminLogout' }, 'Admin logged out');

            // Clear session cookie
            res.clearCookie(sessionCookieName, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                path: '/'
            });

            res.redirect('/');
        });
    } catch (error) {
        logger.error({ op: 'handleLogout', err: error }, 'Error handling logout');
        // Clear cookie and redirect even on error
        res.clearCookie(sessionCookieName, { path: '/' });
        res.redirect('/');
    }
};

