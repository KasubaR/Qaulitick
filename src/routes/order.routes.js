const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');

// Customer-facing order routes (mounted at /api/orders in app.js).
// No admin operations here — see admin.order.routes.js for those.

// Create a new order
router.post('/create', orderController.createOrder);

// Get order by order number (customers tracking their own order)
router.get('/:orderNumber', orderController.getOrderByNumber);

// Verify payment for an order (post-checkout redirect)
router.get('/:orderNumber/verify-payment', orderController.verifyOrderPayment);

module.exports = router;
