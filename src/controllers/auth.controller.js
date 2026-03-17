// Authentication Controller
// Handles admin login, logout, and authentication

const adminService = require('../services/admin.service');
const { validateSecretToken } = require('../middlewares/auth.middleware');
const { sanitizeObject } = require('../utils/validators');

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
        
        // Valid secret - store in session temporarily for login form submission
        // This allows the POST /admin/login to validate the secret even if it's not in the URL
        req.session.secretToken = secret;
        
        // Get return URL if provided (for redirect after login)
        const returnUrl = req.query.returnUrl || '/admin/dashboard';
        
        // Render login page (pass csrfToken so form can submit)
        res.render('admin/login', {
            title: 'Admin Login | Qualitick Collections',
            page: 'admin',
            returnUrl: returnUrl,
            error: req.query.error || null,
            message: req.query.message || null,
            csrfToken: req.session.csrfToken || res.locals.csrfToken || ''
        });
    } catch (error) {
        console.error('[Auth Controller] Error rendering login page:', error);
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
        
        // Validate secret token (from session or query parameter)
        const secret = req.query.secret || req.session.secretToken;
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
        
        // Valid credentials - create admin session
        req.session.adminId = admin._id.toString();
        req.session.adminEmail = admin.email;
        req.session.adminName = admin.name || admin.email;
        
        // Clear temporary secret token from session (no longer needed)
        delete req.session.secretToken;
        
        // Update last login timestamp
        try {
            await adminService.updateLastLogin(admin._id);
        } catch (updateError) {
            // Log error but don't fail login if last login update fails
            console.error('[Auth Controller] Error updating last login:', updateError);
        }
        
        console.log(`[Auth Controller] Admin logged in: ${admin.email}`);
        
        // Redirect to intended page or dashboard
        const redirectUrl = returnUrl && returnUrl.startsWith('/admin') 
            ? returnUrl 
            : '/admin/dashboard';
        
        res.redirect(redirectUrl);
    } catch (error) {
        console.error('[Auth Controller] Error handling login:', error);
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
        const adminEmail = req.session?.adminEmail || 'unknown';
        
        // Destroy session
        req.session.destroy((err) => {
            if (err) {
                console.error('[Auth Controller] Error destroying session:', err);
                // Continue with redirect even if session destroy fails
            } else {
                console.log(`[Auth Controller] Admin logged out: ${adminEmail}`);
            }
            
            // Clear session cookie
            res.clearCookie('admin.sid', {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict'
            });
            
            // Redirect to home page
            res.redirect('/');
        });
    } catch (error) {
        console.error('[Auth Controller] Error handling logout:', error);
        // Clear cookie and redirect even on error
        res.clearCookie('admin.sid');
        res.redirect('/');
    }
};

