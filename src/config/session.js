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

module.exports = session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'dev-secret-not-for-production-use',
    resave: false,
    saveUninitialized: false,
    name: sessionCookieName,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: parseInt(process.env.SESSION_MAX_AGE || '28800000', 10) // 8 hours
    },
    rolling: true
});
