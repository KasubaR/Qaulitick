/**
 * Shared session cookie name for storefront + admin (single express-session).
 * Override with SESSION_COOKIE_NAME if needed.
 */
module.exports = {
    cookieName: process.env.SESSION_COOKIE_NAME || 'qc.sid'
};
