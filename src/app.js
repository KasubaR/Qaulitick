const express = require('express');
const path = require('path');
const fs = require('fs');
const compression = require('compression');
const cookieParser = require('cookie-parser');

// Database connection
const { connectDatabase } = require('./config/database');
connectDatabase().catch(err => {
    console.error('Database connection failed:', err);
    process.exit(1);
});

// Validate required secrets before anything else
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production.');
}
if (process.env.NODE_ENV === 'production') {
    const webhookSecret = process.env.LENCO_WEBHOOK_SECRET;
    if (!webhookSecret || webhookSecret === 'xxxxxxxxxxxxxxxxxxxxxxx') {
        throw new Error('LENCO_WEBHOOK_SECRET must be set to a real value in production.');
    }
}

const app = express();

// ============================================
// App settings
// ============================================
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.locals.GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID || null;

// ============================================
// Core middleware
// ============================================
app.use(compression({
    filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
    },
    level: 6,
    threshold: 1024,
    memLevel: 8
}));

const {
    sanitizeInput,
    xssProtection,
    limitRequestSize,
    sqlInjectionProtection
} = require('./middlewares/security.middleware');

app.use(xssProtection);
app.use(limitRequestSize('10mb'));
app.use(sqlInjectionProtection);
app.use(cookieParser());

// Body parser — captures raw bytes for webhook signature verification
app.use(express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
        if (req.path === '/api/payments/lenco/webhook') {
            req.rawBody = buf;
        }
    }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(sanitizeInput);

// ============================================
// Session + CSRF
// ============================================
app.use(require('./config/session'));

const { csrfTokenGenerator } = require('./middlewares/csrf.middleware');
app.use(csrfTokenGenerator);

const { optionalCustomer } = require('./middlewares/customer-auth.middleware');
app.use(optionalCustomer);

// ============================================
// Static files
// ============================================
const publicDir = path.join(__dirname, '..', 'public');

// Block directory listing (return 403 for folder requests with no index file)
app.use(async (req, res, next) => {
    const p = path.normalize(req.path).replace(/^(\.\.(\/|\\|$))+/, '');
    if (p === '' || p === '/' || p === '\\') return next();
    const requestedPath = path.join(publicDir, p);
    const resolved = path.resolve(requestedPath);
    if (!resolved.startsWith(path.resolve(publicDir))) return next();
    try {
        const stat = await fs.promises.stat(resolved);
        if (stat.isDirectory()) {
            let hasIndex = false;
            for (const name of ['index.html', 'index.htm']) {
                try { await fs.promises.access(path.join(resolved, name)); hasIndex = true; break; }
                catch (_) { /* not found */ }
            }
            if (!hasIndex) return res.status(403).send('Forbidden');
        }
    } catch (_) { /* path not found — let static or 404 handler deal with it */ }
    next();
});

app.use(express.static(publicDir, {
    maxAge: '1y',
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg') || filePath.endsWith('.png') || filePath.endsWith('.webp') || filePath.endsWith('.svg')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            res.setHeader('X-Content-Type-Options', 'nosniff');
        } else if (filePath.endsWith('.css') || filePath.endsWith('.js')) {
            res.setHeader('Cache-Control', 'no-cache');
        } else {
            res.setHeader('Cache-Control', 'public, max-age=86400');
        }
        const publicAssets = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.css', '.js', '.woff2', '.woff', '.ttf', '.ico'];
        if (publicAssets.some(ext => filePath.endsWith(ext))) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        }
    }
}));

// ============================================
// CORS
// ============================================
const { adminCors, publicApiCors } = require('./config/cors');
app.use('/api/admin', adminCors);
app.use('/api', publicApiCors);

// ============================================
// Routes
// ============================================
app.use('/', require('./routes/admin.routes'));
app.use('/', require('./routes/storefront.routes'));

// ============================================
// Error handlers (must be last)
// ============================================
const { errorHandler, notFoundHandler } = require('./middlewares/error.middleware');
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
