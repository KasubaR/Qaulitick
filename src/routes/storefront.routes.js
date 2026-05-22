const express = require('express');
const path = require('path');
const ipaddr = require('ipaddr.js');
const router = express.Router();

const { rateLimit, validateQueryParams } = require('../middlewares/security.middleware');
const { csrfTokenValidator } = require('../middlewares/csrf.middleware');
const { requireCustomerAuth } = require('../middlewares/customer-auth.middleware');
const { cacheMiddleware } = require('../middlewares/cache.middleware');
const { upload, handleUploadError } = require('../middlewares/upload.middleware');
const logger = require('../utils/logger');

const productController = require('../controllers/product.controller');
const marketingController = require('../controllers/marketing.controller');
const contactController = require('../controllers/contact.controller');
const newsletterController = require('../controllers/newsletter.controller');
const paymentController = require('../controllers/payment.controller');
const customerAuthController = require('../controllers/customer.auth.controller');
const customerAccountController = require('../controllers/customer.account.controller');

const cartUtils = require('../utils/cart.utils');
const laybyConfig = require('../config/layby');

const productRoutes = require('./product.routes');
const cartRoutes = require('./cart.routes');
const orderRoutes = require('./order.routes');
const paymentRoutes = require('./payment.routes');
const marketingRoutes = require('./marketing.routes');

// ============================================
// Favicon
// ============================================
router.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'images', 'icons', 'Qualitick-01.svg'));
});

// ============================================
// Public Product API
// ============================================
router.get('/api/products',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    validateQueryParams,
    cacheMiddleware(5 * 60 * 1000),
    productController.getProductsAPI
);

router.get('/api/products/search',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    validateQueryParams,
    cacheMiddleware(5 * 60 * 1000),
    productController.searchProducts
);

router.get('/api/products/brands',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    cacheMiddleware(5 * 60 * 1000),
    productController.getBrands
);

router.get('/api/products/:id(\\d+)',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    validateQueryParams,
    cacheMiddleware(60 * 1000),
    productController.getProductByIdAPI
);

// POST /api/products/:id/reviews — public, rate-limited per IP + product
router.post('/api/products/:id/reviews',
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 10,
        message: 'Too many review attempts. Please try again later.',
        keyGenerator: (req) => {
            let ip = req.ip ||
                req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                req.connection?.remoteAddress ||
                req.socket?.remoteAddress ||
                'unknown';
            if (ip === '::1' || ip === '::ffff:127.0.0.1' || ip.startsWith('127.0.0.1')) {
                const sessionId = req.session?.id || req.headers['user-agent']?.substring(0, 20) || 'localhost';
                ip = `localhost-${sessionId}`;
            }
            return `review:${ip}:${req.params.id || 'unknown'}`;
        }
    }),
    productController.submitReview
);

// ============================================
// Contact form
// ============================================
router.post('/api/contact',
    rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }),
    csrfTokenValidator(),
    contactController.submitContactForm
);

router.post('/api/newsletter/subscribe',
    rateLimit({
        windowMs: 60 * 60 * 1000,
        max: 30,
        message: 'Too many subscribe attempts. Please try again later.'
    }),
    csrfTokenValidator(),
    newsletterController.subscribe
);

// CSRF exception (intentional): one-click links in mail clients cannot carry session CSRF tokens, so
// this GET mutates state without csrfTokenValidator(). That is an explicit exception to the usual rule
// that state-changing requests must validate CSRF — do not “fix” by blindly applying
// csrfTokenValidator() to this path. Security for unsubscribe relies on an unguessable secret token
// in the query string and HTTPS, not on CSRF.
router.get('/newsletter/unsubscribe', newsletterController.unsubscribePage);

// ============================================
// Cart / Orders / Payments API
// ============================================
router.use('/api/cart',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    csrfTokenValidator(),
    cartRoutes
);

router.use('/api/orders',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    csrfTokenValidator(),
    orderRoutes
);

// ============================================
// Lenco Payment Webhook
// POST /api/payments/lenco/webhook — no CSRF (external service)
// ============================================
router.post('/api/payments/lenco/webhook',
    rateLimit({
        windowMs: 60 * 60 * 1000,
        max: 100,
        message: 'Too many webhook requests. Please contact support if this persists.'
    }),
    // Structured debug logging — suppressed in production (level: info default)
    (req, res, next) => {
        const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
        const hasSignature = !!(
            req.headers['x-lenco-signature'] ||
            req.headers['x-signature'] ||
            req.headers['signature']
        );
        const bodyData = req.body?.data || req.body;
        logger.debug({
            webhookIp: ip,
            hasSignature,
            contentType: req.headers['content-type'],
            userAgent: req.headers['user-agent'],
            hasBody: !!req.body,
            bodyKeys: req.body ? Object.keys(req.body) : [],
            hasData: !!req.body?.data,
            hasTransactionId: !!(bodyData?.id || bodyData?.transactionId || bodyData?.transaction_id),
            status: bodyData?.status || req.body?.status,
            hasReference: !!(bodyData?.reference || req.body?.reference),
            hasLencoReference: !!bodyData?.lencoReference,
            hasOrderNumber: !!(bodyData?.orderNumber || bodyData?.order_number || bodyData?.metadata?.orderNumber)
        }, 'Lenco webhook received');
        req.webhookLog = { ip, hasSignature };
        next();
    },
    // Optional IP whitelist (configure LENCO_WEBHOOK_IPS in .env)
    (req, res, next) => {
        const lencoIPs = process.env.LENCO_WEBHOOK_IPS;
        if (!lencoIPs) return next();

        const allowedIPs = lencoIPs.split(',').map(ip => ip.trim());
        const clientIP = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim();

        if (!clientIP) {
            logger.warn('Lenco webhook: unable to determine client IP');
            return res.status(403).json({ success: false, message: 'IP address could not be determined' });
        }

        const isAllowed = allowedIPs.some(allowedIP => {
            try {
                if (allowedIP.includes('/')) {
                    const [networkStr, prefixLengthStr] = allowedIP.split('/');
                    const prefixLength = parseInt(prefixLengthStr, 10);
                    if (isNaN(prefixLength) || prefixLength < 0) {
                        logger.warn({ allowedIP }, 'Lenco webhook: invalid CIDR prefix length');
                        return false;
                    }
                    return ipaddr.process(clientIP).match(ipaddr.process(networkStr), prefixLength);
                }
                return ipaddr.process(allowedIP).toString() === ipaddr.process(clientIP).toString();
            } catch (error) {
                logger.warn({ err: error.message }, 'Lenco webhook: error checking IP whitelist entry');
                return false;
            }
        });

        if (!isAllowed) {
            logger.warn({ webhookIp: clientIP }, 'Lenco webhook: IP not in whitelist');
            return res.status(403).json({ success: false, message: 'IP address not authorized' });
        }

        next();
    },
    paymentController.handleLencoWebhook
);

router.use('/api/payments',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }),
    csrfTokenValidator({ excludedPaths: ['/api/payments/lenco/webhook'] }),
    paymentRoutes
);

// ============================================
// Storefront pages
// ============================================
router.get('/', async (req, res) => {
    let flashSale = null;
    try {
        flashSale = await marketingController.buildHomeFlashSaleViewModel();
    } catch (e) {
        flashSale = null;
    }
    res.render('home', {
        title: 'Qualitick Collections | Luxury Watches',
        page: 'home',
        flashSale
    });
});

router.get('/shop', productController.renderShop);

router.get('/about', (req, res) => {
    res.render('about', { title: 'About Us | Qualitick Collections', page: 'about' });
});

router.get('/contact', (req, res) => {
    res.render('contact', { title: 'Contact Us | Qualitick Collections', page: 'contact' });
});

router.get('/terms', (req, res) => {
    res.render('terms', { title: 'Terms & Conditions | Qualitick Collections', page: 'terms' });
});

router.get('/privacy', (req, res) => {
    res.render('privacy', { title: 'Privacy Policy | Qualitick Collections', page: 'privacy' });
});

router.get('/shipping', (req, res) => {
    res.render('shipping', { title: 'Shipping Policy | Qualitick Collections', page: 'shipping' });
});

router.get('/layby', (req, res) => {
    res.render('layby', { title: 'How Layby Works | Qualitick Collections', page: 'layby' });
});

router.get('/cart', async (req, res) => {
    try {
        const cartData = await cartUtils.parseAndValidateCartCookie(req);
        res.render('cart', {
            title: 'Cart | Qualitick Collections',
            page: 'cart',
            initialCartItems: cartData.items,
            initialCartTotals: cartData.totals,
            cartWarnings: cartData.warnings
        });
    } catch (error) {
        logger.error({ err: error.message }, '[Cart] Error loading cart');
        res.render('cart', {
            title: 'Cart | Qualitick Collections',
            page: 'cart',
            initialCartItems: [],
            initialCartTotals: { subtotal: 0, discount: 0, delivery: 0, total: 0 },
            cartWarnings: []
        });
    }
});

router.get('/checkout', (req, res) => {
    const u = res.locals.currentUser;
    const enableBankTransfer =
        process.env.ENABLE_BANK_TRANSFER === 'true' || process.env.ENABLE_BANK_TRANSFER === '1';
    res.render('checkout', {
        title: 'Checkout | Qualitick Collections',
        page: 'checkout',
        loggedIn: !!u,
        laybyEligible: !!(u && u.emailVerifiedAt),
        laybyPlanDays: laybyConfig.PLAN_PERIOD_DAYS,
        enableBankTransfer,
        prefill: u ? {
            name: u.name || '',
            email: u.email || '',
            phone: u.phone || '',
            deliveryAddress: u.deliveryAddress || '',
            city: u.city || '',
            province: u.province || ''
        } : null
    });
});

router.get('/order-success/:orderNumber', (req, res) => {
    const dpo = req.query.dpo || null;
    res.render('order-success', {
        title: 'Order Success | Qualitick Collections',
        page: 'order-success',
        orderNumber: req.params.orderNumber,
        dpo
    });
});

// ============================================
// Customer Auth
// ============================================
router.get('/register',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }),
    customerAuthController.renderRegisterPage
);
router.post('/register',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 15 }),
    csrfTokenValidator(),
    customerAuthController.handleRegister
);
router.get('/login',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 40 }),
    customerAuthController.renderLoginPage
);
router.post('/login',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 10, failClosed: true }),
    csrfTokenValidator({ rotateToken: true }),
    customerAuthController.handleLogin
);
router.post('/logout',
    csrfTokenValidator({ rotateToken: true }),
    customerAuthController.handleLogout
);
router.get('/verify-email',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }),
    customerAuthController.verifyEmail
);
router.post('/resend-verification',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }),
    csrfTokenValidator(),
    customerAuthController.handleResendVerification
);

router.get('/forgot-password',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }),
    customerAuthController.renderForgotPasswordPage
);
router.post('/forgot-password',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 8, failClosed: true }),
    csrfTokenValidator(),
    customerAuthController.handleForgotPassword
);
router.get('/reset-password',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 40 }),
    customerAuthController.renderResetPasswordPage
);
router.post('/reset-password',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 8, failClosed: true }),
    csrfTokenValidator({ rotateToken: true }),
    customerAuthController.handleResetPassword
);

// ============================================
// Customer Account
// ============================================
router.get('/account', requireCustomerAuth, customerAccountController.renderDashboard);
router.get('/account/profile', requireCustomerAuth, customerAccountController.renderProfile);
router.post('/account/profile', requireCustomerAuth, csrfTokenValidator(), customerAccountController.updateProfile);
router.post('/account/password', requireCustomerAuth, csrfTokenValidator({ rotateToken: true }), customerAccountController.updatePassword);
router.get('/account/address', requireCustomerAuth, customerAccountController.renderAddress);
router.post('/account/address', requireCustomerAuth, csrfTokenValidator(), customerAccountController.updateAddress);
router.get('/account/orders', requireCustomerAuth, customerAccountController.renderOrders);
router.get('/account/layby', requireCustomerAuth, customerAccountController.renderLayby);
router.post('/account/layby/:id/pay', requireCustomerAuth, csrfTokenValidator(), customerAccountController.startLaybyPayment);
router.post('/account/logout-all-devices', requireCustomerAuth, csrfTokenValidator({ rotateToken: true }), customerAccountController.logoutAllDevices);

// ============================================
// Product & Marketing page routes
// ============================================
router.use('/product', productRoutes);
router.use('/', marketingRoutes);

module.exports = router;
