// Marketing Routes
const express = require('express');
const router = express.Router();
const marketingController = require('../controllers/marketing.controller');

// Public routes (for home page)
router.get('/api/marketing/featured-products', marketingController.getFeaturedProducts);
router.get('/api/marketing/flash-sales', marketingController.getActiveFlashSales);

// Admin routes (TODO: Add authentication middleware)
router.get('/api/admin/marketing/flash-sales', marketingController.getAllFlashSales);
router.post('/api/admin/marketing/flash-sales', marketingController.createFlashSale);
router.put('/api/admin/marketing/flash-sales/:id', marketingController.updateFlashSale);
router.delete('/api/admin/marketing/flash-sales/:id', marketingController.deleteFlashSale);

router.put('/api/admin/marketing/featured-products', marketingController.updateFeaturedProducts);
router.post('/api/admin/marketing/featured-products/cleanup-deleted', marketingController.cleanupDeletedProducts);
router.post('/api/admin/marketing/featured-products/cleanup-inactive', marketingController.cleanupInactiveProducts);

module.exports = router;

