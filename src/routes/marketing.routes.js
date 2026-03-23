// Marketing Routes
const express = require('express');
const router = express.Router();
const marketingController = require('../controllers/marketing.controller');
const { authenticateAdmin } = require('../middlewares/auth.middleware');
const { csrfTokenValidator } = require('../middlewares/csrf.middleware');

// Public routes (for home page) — no auth required
router.get('/api/marketing/featured-products', marketingController.getFeaturedProducts);
router.get('/api/marketing/flash-sales', marketingController.getActiveFlashSales);
router.get('/api/marketing/testimonials', marketingController.getHomepageTestimonials);

// Admin routes — authentication + CSRF required on all mutations
router.get('/api/admin/marketing/flash-sales',
    authenticateAdmin, marketingController.getAllFlashSales);
router.post('/api/admin/marketing/flash-sales',
    authenticateAdmin, csrfTokenValidator(), marketingController.createFlashSale);
router.put('/api/admin/marketing/flash-sales/:id',
    authenticateAdmin, csrfTokenValidator(), marketingController.updateFlashSale);
router.delete('/api/admin/marketing/flash-sales/:id',
    authenticateAdmin, csrfTokenValidator(), marketingController.deleteFlashSale);

router.put('/api/admin/marketing/featured-products',
    authenticateAdmin, csrfTokenValidator(), marketingController.updateFeaturedProducts);
router.post('/api/admin/marketing/featured-products/cleanup-deleted',
    authenticateAdmin, csrfTokenValidator(), marketingController.cleanupDeletedProducts);
router.post('/api/admin/marketing/featured-products/cleanup-inactive',
    authenticateAdmin, csrfTokenValidator(), marketingController.cleanupInactiveProducts);

module.exports = router;

