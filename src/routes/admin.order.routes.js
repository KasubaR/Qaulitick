const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const { authenticateAdmin } = require('../middlewares/auth.middleware');
const { csrfTokenValidator } = require('../middlewares/csrf.middleware');

// All routes in this file require admin authentication.
// authenticateAdmin is also enforced on the mount in app.js — this is defense-in-depth.

router.get('/', authenticateAdmin, orderController.getAllOrders);
router.get('/export', authenticateAdmin, orderController.exportOrders);
router.get('/unread-count', authenticateAdmin, orderController.getUnreadOrderCount);
router.get('/:orderNumber', authenticateAdmin, orderController.getOrderByNumber);
router.get('/:orderNumber/invoice', authenticateAdmin, orderController.generateInvoice);
router.get('/:orderNumber/verify-payment', authenticateAdmin, orderController.verifyOrderPayment);
router.patch('/:orderNumber/status', authenticateAdmin, csrfTokenValidator(), orderController.updateOrderStatus);
router.patch('/:orderNumber/tracking', authenticateAdmin, csrfTokenValidator(), orderController.updateTracking);
router.post('/:orderNumber/dispatch', authenticateAdmin, csrfTokenValidator(), orderController.dispatchOrder);
router.post('/:orderNumber/notes', authenticateAdmin, csrfTokenValidator(), orderController.addOrderNote);
router.post('/:orderNumber/send-invoice', authenticateAdmin, csrfTokenValidator(), orderController.sendInvoiceEmail);
router.delete('/:orderNumber', authenticateAdmin, csrfTokenValidator(), orderController.deleteOrder);
router.delete('/', authenticateAdmin, csrfTokenValidator(), orderController.deleteOrders);

module.exports = router;
