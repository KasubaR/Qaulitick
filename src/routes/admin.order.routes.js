const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const { authenticateAdmin } = require('../middlewares/auth.middleware');

// All routes in this file require admin authentication.
// authenticateAdmin is also enforced on the mount in app.js — this is defense-in-depth.

router.get('/', authenticateAdmin, orderController.getAllOrders);
router.get('/export', authenticateAdmin, orderController.exportOrders);
router.get('/unread-count', authenticateAdmin, orderController.getUnreadOrderCount);
router.get('/:orderNumber', authenticateAdmin, orderController.getOrderByNumber);
router.get('/:orderNumber/invoice', authenticateAdmin, orderController.generateInvoice);
router.get('/:orderNumber/verify-payment', authenticateAdmin, orderController.verifyOrderPayment);
router.patch('/:orderNumber/status', authenticateAdmin, orderController.updateOrderStatus);
router.patch('/:orderNumber/tracking', authenticateAdmin, orderController.updateTracking);
router.post('/:orderNumber/dispatch', authenticateAdmin, orderController.dispatchOrder);
router.post('/:orderNumber/notes', authenticateAdmin, orderController.addOrderNote);
router.post('/:orderNumber/send-invoice', authenticateAdmin, orderController.sendInvoiceEmail);
router.delete('/:orderNumber', authenticateAdmin, orderController.deleteOrder);
router.delete('/', authenticateAdmin, orderController.deleteOrders);

module.exports = router;
