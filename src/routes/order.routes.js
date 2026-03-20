const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const { authenticateAdmin } = require('../middlewares/auth.middleware');

// Create a new order
router.post('/create', orderController.createOrder);

// Get all orders
router.get('/', orderController.getAllOrders);

// Export orders — admin only regardless of which router prefix this file is mounted under
router.get('/export', authenticateAdmin, orderController.exportOrders);

// Unread orders count for sidebar badge — returns { count } only, no PII
// authenticateAdmin is inherited from the /api/admin/orders mount in app.js;
// the explicit guard here ensures it cannot be reached via the public /api/orders prefix.
router.get('/unread-count', authenticateAdmin, orderController.getUnreadOrderCount);

// Get order by order number
router.get('/:orderNumber', orderController.getOrderByNumber);

// Update order status
router.patch('/:orderNumber/status', orderController.updateOrderStatus);

// Update tracking information
router.patch('/:orderNumber/tracking', orderController.updateTracking);

// Add order note
router.post('/:orderNumber/notes', orderController.addOrderNote);

// Verify payment for order
router.get('/:orderNumber/verify-payment', orderController.verifyOrderPayment);

// Generate invoice PDF
router.get('/:orderNumber/invoice', orderController.generateInvoice);

// Send invoice email
router.post('/:orderNumber/send-invoice', orderController.sendInvoiceEmail);

// Delete order (soft delete)
router.delete('/:orderNumber', orderController.deleteOrder);

// Delete multiple orders (bulk delete)
router.delete('/', orderController.deleteOrders);

// Export orders array for testing/development
router.orders = orderController.orders;

module.exports = router;
