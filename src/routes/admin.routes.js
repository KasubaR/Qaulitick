const express = require('express');
const router = express.Router();

const { rateLimit } = require('../middlewares/security.middleware');
const { csrfTokenValidator } = require('../middlewares/csrf.middleware');
const { requireAdminAuth, authenticateAdmin } = require('../middlewares/auth.middleware');
const { upload, handleUploadError } = require('../middlewares/upload.middleware');
const { clearRateLimit, cleanExpiredRateLimits, getAllRateLimitEntries } = require('../middlewares/security.middleware');

const authController = require('../controllers/auth.controller');
const productController = require('../controllers/product.controller');
const productService = require('../services/product.service');
const analyticsController = require('../controllers/analytics.controller');
const dashboardController = require('../controllers/dashboard.controller');
const customerController = require('../controllers/customer.controller');
const inventoryController = require('../controllers/inventory.controller');
const contactController = require('../controllers/contact.controller');
const adminLaybyController = require('../controllers/admin.layby.controller');
const reviewAdminController = require('../controllers/review.admin.controller');

const adminOrderRoutes = require('./admin.order.routes');

// ============================================
// Admin Auth
// ============================================
router.get('/admin/login',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }),
    authController.renderLoginPage
);
router.post('/admin/login',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }),
    csrfTokenValidator({ excludedPaths: ['/admin/login'] }),
    authController.handleLogin
);
router.post('/admin/logout', csrfTokenValidator(), authController.handleLogout);

router.get('/admin/access-denied', (req, res) => {
    res.render('admin/access-denied', {
        title: 'Access Denied | Admin Panel',
        page: 'admin',
        error: req.query.error || null,
        showLoginLink: req.query.showLoginLink !== 'false'
    });
});

// ============================================
// Admin Pages
// ============================================
router.get('/admin/dashboard', requireAdminAuth, (req, res) => {
    res.render('admin/dashboard', { title: 'Admin Dashboard | Qualitick Collections', page: 'admin' });
});

router.get('/admin/analytics', requireAdminAuth, analyticsController.renderAnalyticsPage);

router.get('/admin/products', requireAdminAuth, async (req, res) => {
    try {
        const products = await productService.getAllProducts({}, { sort: [['createdAt', 'DESC']] });
        res.render('admin/products', {
            title: 'Product Management | Admin Panel',
            page: 'admin',
            activePage: 'products',
            products: products.map(p => p.toJSON())
        });
    } catch (error) {
        res.render('admin/products', {
            title: 'Product Management | Admin Panel',
            page: 'admin',
            activePage: 'products',
            products: []
        });
    }
});

router.get('/admin/orders', requireAdminAuth, (req, res) => {
    res.render('admin/orders', { title: 'Orders Management | Admin Panel', page: 'admin' });
});

router.get('/admin/payments', requireAdminAuth, (req, res) => {
    res.render('admin/payments', { title: 'Payments Management | Admin Panel', page: 'admin' });
});

router.get('/admin/layby', requireAdminAuth, adminLaybyController.renderLaybyListPage);
router.get('/admin/layby/:planId', requireAdminAuth, adminLaybyController.renderLaybyDetailPage);

router.get('/admin/customers', requireAdminAuth, (req, res) => {
    res.render('admin/customers', { title: 'Customers Management | Admin Panel', page: 'admin' });
});

router.get('/admin/inventory', requireAdminAuth, (req, res) => {
    res.render('admin/inventory', { title: 'Inventory Management | Admin Panel', page: 'admin' });
});

router.get('/admin/marketing', requireAdminAuth, (req, res) => {
    res.render('admin/marketing/index', { title: 'Marketing Management | Admin Panel', page: 'admin' });
});

router.get('/admin/marketing/flash-sales', requireAdminAuth, (req, res) => {
    res.render('admin/marketing/flash-sales', { title: 'Flash Sales Management | Admin Panel', page: 'admin' });
});

router.get('/admin/marketing/featured-products', requireAdminAuth, (req, res) => {
    res.render('admin/marketing/featured-products', { title: 'Featured Products Management | Admin Panel', page: 'admin' });
});

router.get('/admin/contact-submissions', requireAdminAuth, contactController.renderContactSubmissionsPage);

router.get('/admin/reviews', requireAdminAuth, (req, res) => {
    res.render('admin/reviews', { title: 'Reviews | Admin Panel', page: 'admin', activePage: 'reviews' });
});

// ============================================
// Admin Product API
// ============================================

// Must be declared before /:id to prevent "search" being treated as an ID
router.get('/api/products/search',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    productController.searchProducts
);

router.get('/api/products/export',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }),
    authenticateAdmin,
    productController.exportProducts
);

router.post('/api/products/generate-sku',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    csrfTokenValidator(),
    productController.generateSKU
);

router.post('/api/products',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    productController.createProduct
);

router.post('/api/products/upload-images',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    upload.array('images', 10),
    handleUploadError,
    productController.uploadImages
);

router.delete('/api/products/bulk',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    productController.bulkDeleteProducts
);

// :id must be numeric only — otherwise "search", "export", etc. match :id and break those routes
router.put('/api/products/:id(\\d+)',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    productController.updateProduct
);

router.delete('/api/products/:id(\\d+)',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    productController.deleteProduct
);

router.put('/api/products/:id(\\d+)/images/reorder',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    productController.reorderProductImages
);

router.put('/api/products/:id(\\d+)/images/primary',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    productController.setPrimaryImage
);

router.delete('/api/products/:id(\\d+)/images/:imageId',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    productController.deleteProductImage
);

// ============================================
// Admin Orders API
// ============================================
router.use('/api/admin/orders',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }),
    authenticateAdmin,
    csrfTokenValidator(),
    adminOrderRoutes
);

// ============================================
// Admin Analytics API
// ============================================
router.get('/api/admin/analytics',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    analyticsController.getAnalyticsData
);
router.get('/api/admin/analytics/realtime',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    analyticsController.getRealTimeData
);
router.get('/api/admin/analytics/export',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }),
    authenticateAdmin,
    analyticsController.exportAnalyticsData
);

// ============================================
// Admin Dashboard API
// ============================================
router.get('/api/admin/dashboard/stats',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    dashboardController.getDashboardStats
);
router.get('/api/admin/dashboard/recent-orders',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    dashboardController.getRecentOrders
);
router.get('/api/admin/dashboard/order-summary',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    dashboardController.getOrderSummary
);
router.get('/api/admin/dashboard/low-stock',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    dashboardController.getLowStockProducts
);
router.get('/api/admin/dashboard/best-selling',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    dashboardController.getBestSellingProducts
);
router.get('/api/admin/dashboard/top-customers',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    dashboardController.getTopCustomers
);
router.get('/api/admin/dashboard/charts/:type',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    dashboardController.getChartData
);
router.get('/api/admin/dashboard/search',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    dashboardController.searchDashboard
);
router.get('/api/admin/dashboard/layby-overview',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    dashboardController.getLaybyOverview
);

// ============================================
// Admin Customer API
// ============================================
router.get('/api/admin/customers',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    customerController.getCustomers
);
router.get('/api/admin/customers/stats',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    customerController.getCustomerStats
);
router.get('/api/admin/customers/:email',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    customerController.getCustomerByEmail
);
router.get('/api/admin/registered-users',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    customerController.getRegisteredUsers
);
router.post('/api/admin/users/:id/suspend',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }),
    requireAdminAuth,
    csrfTokenValidator(),
    customerController.suspendUser
);
router.post('/api/admin/users/:id/activate',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }),
    requireAdminAuth,
    csrfTokenValidator(),
    customerController.activateUser
);

// ============================================
// Admin Inventory API
// ============================================
router.get('/api/admin/inventory',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    inventoryController.getInventoryProducts
);
router.get('/api/admin/inventory/stats',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    inventoryController.getInventoryStats
);
router.put('/api/admin/inventory/stock/:productId',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    inventoryController.updateStock
);
router.get('/api/admin/inventory/brands',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    inventoryController.getBrands
);
router.get('/api/admin/inventory/export',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }),
    authenticateAdmin,
    inventoryController.exportInventory
);

// ============================================
// ============================================
// Admin Contact Submissions API
// ============================================
router.get('/api/admin/contact-submissions',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    contactController.getContactSubmissions
);
router.patch('/api/admin/contact-submissions/:id/status',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    csrfTokenValidator(),
    contactController.updateSubmissionStatus
);
router.delete('/api/admin/contact-submissions/:id',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    contactController.deleteSubmission
);

// ============================================
// Admin Layby API
// ============================================
router.get('/api/admin/layby/plans',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    adminLaybyController.listPlans
);
router.get('/api/admin/layby/plans/:id',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    adminLaybyController.getPlan
);
router.patch('/api/admin/layby/plans/:id/status',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    csrfTokenValidator(),
    adminLaybyController.updatePlanStatus
);
router.post('/api/admin/layby/installments/:installmentId/confirm-offline',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    csrfTokenValidator(),
    adminLaybyController.confirmInstallmentOffline
);

// ============================================
// Admin Reviews API
// ============================================

// Static segments must come before :productId/:reviewId param routes
router.get('/api/admin/reviews/homepage-testimonials',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    reviewAdminController.getHomepageTestimonials
);

router.get('/api/admin/reviews',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    reviewAdminController.getAllReviews
);

router.delete('/api/admin/reviews/:productId/:reviewId',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    reviewAdminController.deleteReview
);

router.post('/api/admin/reviews/:productId/:reviewId/feature',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    reviewAdminController.featureReview
);

router.delete('/api/admin/reviews/:productId/:reviewId/feature',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    reviewAdminController.unfeatureReview
);

// ============================================
// Debug (development only)
// ============================================
if (process.env.NODE_ENV !== 'production') {
    router.post('/api/debug/rate-limit/clear', (req, res) => {
        const { key } = req.body;
        const cleared = clearRateLimit(key);
        const cleaned = cleanExpiredRateLimits();
        res.json({
            success: true,
            message: cleared ? `Cleared rate limit for: ${key || 'all'}` : 'No matching rate limit found',
            expiredCleaned: cleaned,
            allEntries: getAllRateLimitEntries()
        });
    });
}

module.exports = router;
