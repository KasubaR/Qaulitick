const newsletterService = require('../services/newsletter.service');
const emailService = require('../services/email.service');
const { validateNewsletterSubscribe, sanitizeObject } = require('../utils/validators');
const logger = require('../utils/logger').child({ module: 'NewsletterController' });

/** Same user-facing copy for new, existing, and per-email-throttled signups (privacy-preserving). */
const NEWSLETTER_SUCCESS_MESSAGE =
    "Thanks — you're on the list. We'll share new collections and offers when there's news.";

/**
 * POST /api/newsletter/subscribe
 */
exports.subscribe = async (req, res) => {
    try {
        const sanitizedBody = sanitizeObject(req.body);
        const validation = validateNewsletterSubscribe(sanitizedBody);
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        const email = sanitizedBody.email.trim().toLowerCase();
        const { sendWelcome, unsubscribeToken } = await newsletterService.subscribe(email, { source: 'home' });

        res.json({
            success: true,
            message: NEWSLETTER_SUCCESS_MESSAGE
        });

        // sendWelcome is true only for a new row, recovery create, or post-cooldown reactivation — never duplicate-active or throttle-only.
        if (sendWelcome && unsubscribeToken) {
            void emailService
                .sendNewsletterWelcomeEmail({ email, unsubscribeToken })
                .catch((err) => {
                    logger.warn({ errMessage: err && err.message }, 'newsletter welcome email failed');
                });
        }
    } catch (error) {
        logger.error({ errMessage: error.message }, 'newsletter subscribe failed');
        res.status(500).json({
            success: false,
            message: 'Something went wrong. Please try again later.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * GET /newsletter/unsubscribe?token=…
 * One-click from email; mutates subscription state. CSRF is intentionally omitted (see route comment).
 */
exports.unsubscribePage = async (req, res) => {
    try {
        await newsletterService.unsubscribeByToken(req.query.token);
    } catch (err) {
        logger.error({ errMessage: err.message }, 'newsletter unsubscribe page failed');
    }

    res.render('newsletter-unsubscribe', {
        title: 'Unsubscribed | Qualitick Collections',
        page: 'privacy',
        description: 'You have been unsubscribed from Qualitick Collections marketing emails.',
        canonicalUrl: 'https://qualitick-collections.com/newsletter/unsubscribe',
        url: '/newsletter/unsubscribe'
    });
};
