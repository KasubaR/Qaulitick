const session = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const { sequelize: sequelizeInstance } = require('./mysql');
const { cookieName: sessionCookieName } = require('./session.constants');

if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production.');
}

if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'development') {
    if (!process.env.MYSQL_DATABASE && !process.env.DB_NAME) {
        throw new Error('[Session] MYSQL_DATABASE must be set. MemoryStore is not supported in production/development.');
    }
}

const sessionStore = new SequelizeStore({ db: sequelizeInstance });
sessionStore.sync(); // creates Sessions table if it doesn't exist

/**
 * Secure cookies: browsers only send them over HTTPS. In production, secure defaults to true.
 * On cPanel (or any host) where you still use http://, set SESSION_COOKIE_SECURE=false until SSL is enabled.
 * SESSION_COOKIE_SECURE=true forces secure cookies.
 */
function sessionCookieSecure() {
    if (process.env.SESSION_COOKIE_SECURE === 'false') return false;
    if (process.env.SESSION_COOKIE_SECURE === 'true') return true;
    return process.env.NODE_ENV === 'production';
}

module.exports = session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'dev-secret-not-for-production-use',
    resave: false,
    saveUninitialized: false,
    name: sessionCookieName,
    cookie: {
        httpOnly: true,
        secure: sessionCookieSecure(),
        sameSite: 'strict',
        maxAge: parseInt(process.env.SESSION_MAX_AGE || '14400000', 10) // 4 hours
    },
    rolling: true
});
