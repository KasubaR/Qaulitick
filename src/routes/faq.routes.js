// FAQ Routes
const express = require('express');
const router = express.Router();
const faqController = require('../controllers/faq.controller');
const { authenticateAdmin } = require('../middlewares/auth.middleware');
const { csrfTokenValidator } = require('../middlewares/csrf.middleware');

// Public
router.get('/faq', faqController.renderFaqPage);
router.get('/api/faqs', faqController.getPublishedFaqs);

// Admin — authentication + CSRF required on all mutations
router.get('/api/admin/faqs', authenticateAdmin, faqController.getAllFaqs);
router.post('/api/admin/faqs', authenticateAdmin, csrfTokenValidator(), faqController.createFaq);
router.put('/api/admin/faqs/:id', authenticateAdmin, csrfTokenValidator(), faqController.updateFaq);
router.delete('/api/admin/faqs/:id', authenticateAdmin, csrfTokenValidator(), faqController.deleteFaq);

module.exports = router;
