/**
 * Customer session (storefront). requireCustomerAuth protects /account/* HTML routes and returns
 * 401 JSON when Accept prefers JSON (e.g. XHR to POST /account/layby/:id/pay).
 * Layby/payment JSON under /api/payments enforces ownership in payment.controller where needed.
 */
const { User } = require('../models');
const logger = require('../utils/logger').child({ module: 'CustomerAuthMiddleware' });

function wantsJsonResponse(req) {
    if (req.xhr) return true;
    const accept = req.get('Accept') || '';
    const first = accept.split(',')[0].trim();
    return first.includes('application/json');
}

/**
 * Load storefront user from session (by userId). Does not block.
 */
async function optionalCustomer(req, res, next) {
    res.locals.currentUser = null;
    req.customerUser = null;

    try {
        const id = req.session?.userId;
        if (!id) return next();

        const user = await User.findByPk(id);
        if (!user) {
            req.session.userId = null;
            return next();
        }

        const plain = user.toJSON();
        req.customerUser = user;
        res.locals.currentUser = {
            id: plain.id,
            name: plain.name,
            email: plain.email,
            phone: plain.phone,
            emailVerifiedAt: plain.emailVerifiedAt,
            deliveryAddress: plain.deliveryAddress || '',
            city: plain.city || '',
            province: plain.province || ''
        };
    } catch (err) {
        logger.error({ err }, 'optionalCustomer failed');
    }
    next();
}

/**
 * Resolve session userId to User row. Returns null if missing or invalid.
 */
async function getAuthenticatedCustomer(req) {
    const id = req.session?.userId;
    if (!id) return null;
    const user = await User.findByPk(id);
    if (!user) {
        req.session.userId = null;
        return null;
    }
    return user;
}

/**
 * Require logged-in customer for HTML pages (redirect to /login).
 */
async function requireCustomerAuth(req, res, next) {
    try {
        const user = await getAuthenticatedCustomer(req);
        if (!user) {
            if (wantsJsonResponse(req)) {
                return res.status(401).json({
                    success: false,
                    message: 'Please sign in to continue.',
                    error: 'UNAUTHORIZED'
                });
            }
            const returnUrl = req.originalUrl || req.url;
            return res.redirect(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
        }
        req.customerUser = user;
        next();
    } catch (err) {
        logger.error({ err }, 'requireCustomerAuth failed');
        if (wantsJsonResponse(req)) {
            return res.status(500).json({ success: false, message: 'Authentication error' });
        }
        return res.redirect('/login?error=auth_error');
    }
}

module.exports = {
    optionalCustomer,
    getAuthenticatedCustomer,
    requireCustomerAuth,
    wantsJsonResponse
};
