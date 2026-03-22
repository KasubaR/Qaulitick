const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const { rateLimit } = require('../middlewares/security.middleware');
const { authenticateAdmin } = require('../middlewares/auth.middleware');

/**
 * Payment Routes
 * 
 * Note: The Lenco webhook route (/lenco/webhook) is registered in app.js
 * with special middleware (rate limiting, IP whitelist, logging) because
 * webhooks require different security handling than regular API endpoints.
 * 
 * Regular Payment Routes:
 */

// Process payment
router.post('/process', paymentController.processPayment);

// Verify payment status - MUST come before /:id to avoid route conflict
// More permissive rate limit (designed for polling): 60 requests per 15 minutes
router.get('/verify/:transactionId', 
    rateLimit({ 
        windowMs: 15 * 60 * 1000, 
        max: 60,
        message: 'Too many verification requests. Please wait before checking again.'
    }), 
    paymentController.verifyPayment
);

// Get payment methods (must come before /:id to avoid route conflict)
router.get('/methods', paymentController.getPaymentMethods);

// Get list of supported banks from Lenco (must come before /:id to avoid route conflict)
router.get('/banks', paymentController.getBanks);

// Get all payments (admin) - MUST come before /:id route
router.get('/', authenticateAdmin, paymentController.getAllPayments);

// Export payments (admin) - MUST come before /:id route
router.get('/export', authenticateAdmin, paymentController.exportPayments);

// Retry failed payment (must come before /:id to avoid route conflict)
router.post('/retry/:orderNumber', paymentController.retryPayment);

// Cancel a pending payment by transaction ID (must come before /:id to avoid route conflict)
router.patch('/cancel/:transactionId', paymentController.cancelPayment);

// Get payment by ID (admin) - MUST be last to avoid matching other routes
router.get('/:id', authenticateAdmin, paymentController.getPaymentById);

/**
 * Lenco Webhook Route
 * 
 * IMPORTANT: This route is registered in app.js (not here) with special middleware
 * to ensure proper security and middleware ordering.
 * 
 * Route: POST /api/payments/lenco/webhook
 * Handler: paymentController.handleLencoWebhook
 * 
 * Middleware Order (in app.js):
 * 1. Rate limiting (webhook-specific: 100 requests/hour, more permissive than regular API)
 * 2. Logging middleware (logs IP, headers, body preview for debugging)
 * 3. IP whitelist check (optional, configured via LENCO_WEBHOOK_IPS env var)
 * 4. Controller handler (signature verification + webhook processing)
 * 
 * Why registered in app.js instead of here:
 * - Webhooks require different rate limiting than regular API endpoints
 * - Needs IP whitelist middleware before route handler
 * - Requires comprehensive logging middleware
 * - Signature verification happens in controller, but middleware must run first
 * 
 * Security Features:
 * - Separate rate limiting (100 requests/hour vs 20/15min for regular API)
 * - IP whitelist check (optional, configure LENCO_WEBHOOK_IPS in .env)
 * - Comprehensive logging for debugging
 * - Signature verification (handled in controller via lencoService)
 * 
 * See app.js around line 215-320 for the actual route registration.
 */

module.exports = router;
