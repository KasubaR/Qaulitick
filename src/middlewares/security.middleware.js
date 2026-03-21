// Security Middleware
// Input sanitization, rate limiting, XSS protection
//
// Raw SQL: use Sequelize `replacements` / bind parameters (see rateLimit below). Static DDL
// (CREATE TABLE IF NOT EXISTS) uses no user input. Other code should follow the same pattern;
// database.service validates identifiers before any dynamic identifier is embedded in SQL.

const { sanitizeObject, validatePagination, validateSearch, validateSort, validateFilters } = require('../utils/validators');
const { sequelize } = require('../config/mysql');

// Create rate_limits table if it doesn't exist.
// The table is keyed by (ip + route path); MySQL handles TTL by comparing reset_time.
sequelize.query(`
    CREATE TABLE IF NOT EXISTS rate_limits (
        \`rl_key\`    VARCHAR(500) NOT NULL,
        count       INT          NOT NULL DEFAULT 0,
        reset_time  BIGINT       NOT NULL,
        PRIMARY KEY (\`rl_key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`).catch(err => console.error('[Rate Limit] Failed to create rate_limits table:', err.message));

/**
 * Rate Limiting Middleware
 * Backed by MySQL — survives restarts and works correctly under multi-process deployments.
 * @param {object} options
 * @param {number} options.windowMs  - Time window in milliseconds
 * @param {number} options.max       - Maximum requests per window
 * @param {string} options.message   - Response message when limit exceeded
 * @param {Function} options.keyGenerator - Optional custom key function(req) → string
 */
function rateLimit(options = {}) {
    const {
        windowMs = 15 * 60 * 1000,
        max = 100,
        message = 'Too many requests, please try again later.',
        keyGenerator = null
    } = options;

    return async (req, res, next) => {
        try {
            const ip = req.ip ||
                       req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                       req.connection?.remoteAddress ||
                       'unknown';

            const routePath = req.path || req.route?.path || 'unknown';
            const key = keyGenerator ? keyGenerator(req) : `${ip}:${routePath}`;
            const now = Date.now();

            // Atomic upsert: insert a fresh counter, or increment the existing one.
            // If the window has expired (reset_time + windowMs <= now), reset the counter.
            await sequelize.query(
                `INSERT INTO rate_limits (rl_key, count, reset_time)
                 VALUES (:key, 1, :now)
                 ON DUPLICATE KEY UPDATE
                     count      = IF(reset_time + :windowMs <= :now, 1,     count + 1),
                     reset_time = IF(reset_time + :windowMs <= :now, :now,   reset_time)`,
                { replacements: { key, now, windowMs } }
            );

            const [[row]] = await sequelize.query(
                'SELECT count, reset_time FROM rate_limits WHERE rl_key = :key',
                { replacements: { key } }
            );

            const count     = row ? row.count      : 1;
            const resetTime = row ? row.reset_time : now;

            // Probabilistic cleanup of expired rows (~5 % of requests)
            if (Math.random() < 0.05) {
                sequelize.query(
                    'DELETE FROM rate_limits WHERE reset_time + :windowMs <= :now',
                    { replacements: { windowMs, now } }
                ).catch(() => {});
            }

            if (count > max) {
                const retryAfter = Math.ceil((windowMs - (now - resetTime)) / 1000);
                res.set({
                    'Retry-After': retryAfter,
                    'X-RateLimit-Limit': max,
                    'X-RateLimit-Remaining': 0,
                    'X-RateLimit-Reset': new Date(resetTime + windowMs).toISOString()
                });
                return res.status(429).json({
                    success: false,
                    message,
                    retryAfter
                });
            }

            res.set({
                'X-RateLimit-Limit': max,
                'X-RateLimit-Remaining': Math.max(0, max - count),
                'X-RateLimit-Reset': new Date(resetTime + windowMs).toISOString()
            });

            next();
        } catch (error) {
            // Fail open: if the DB is unavailable, do not block requests
            console.error('[Rate Limit] DB error — failing open:', error.message);
            next();
        }
    };
}

/**
 * Input Sanitization Middleware
 * Sanitizes req.body, req.query, and req.params
 * Skips multipart/form-data requests (handled by multer)
 */
function sanitizeInput(req, res, next) {
    if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
        return next();
    }
    if (req.query)  req.query  = sanitizeObject(req.query);
    if (req.body)   req.body   = sanitizeObject(req.body);
    if (req.params) req.params = sanitizeObject(req.params);
    next();
}

/**
 * Query Parameter Validation Middleware
 */
function validateQueryParams(req, res, next) {
    if (req.query.page || req.query.limit) {
        const pagination = validatePagination(req.query);
        req.query.page  = pagination.page;
        req.query.limit = pagination.limit;
    }
    if (req.query.search) req.query.search = validateSearch(req.query.search);
    if (req.query.sort)   req.query.sort   = validateSort(req.query.sort);
    Object.assign(req.query, validateFilters(req.query));
    next();
}

/**
 * XSS Protection Middleware — sets security headers
 */
function xssProtection(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://fonts.googleapis.com https://www.googletagmanager.com",
        "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://fonts.googleapis.com",
        "img-src 'self' data: https: http:",
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
        "connect-src 'self' https://www.google-analytics.com https://www.googletagmanager.com",
        "frame-ancestors 'none'"
    ].join('; '));
    next();
}

/**
 * Request Size Limiting Middleware
 */
function limitRequestSize(maxSize = '10mb') {
    return (req, res, next) => {
        const contentLength = req.get('content-length');
        if (contentLength) {
            const sizeInBytes = parseInt(contentLength);
            const maxSizeInBytes = parseSize(maxSize);
            if (sizeInBytes > maxSizeInBytes) {
                return res.status(413).json({
                    success: false,
                    message: `Request payload too large. Maximum size is ${maxSize}.`
                });
            }
        }
        next();
    };
}

function parseSize(size) {
    const units = { kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 };
    const match = size.toLowerCase().match(/^(\d+)(kb|mb|gb)$/);
    return match ? parseInt(match[1]) * units[match[2]] : 10 * 1024 * 1024;
}

/**
 * SQL Injection Protection
 */
function sqlInjectionProtection(req, res, next) {
    const sqlPatterns = [
        /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/gi,
        /('|(\\')|(;)|(\\)|(\/\*)|(\*\/)|(\-\-)|(\+)|(\%27)|(\%22))/gi
    ];
    const checkValue = (value) => {
        if (typeof value === 'string') return sqlPatterns.some(p => p.test(value));
        if (typeof value === 'object' && value !== null) return Object.values(value).some(checkValue);
        return false;
    };
    if (checkValue({ ...req.query, ...req.body, ...req.params })) {
        return res.status(400).json({ success: false, message: 'Invalid input detected' });
    }
    next();
}

// ── Debug helpers (development only) ─────────────────────────────────────────

async function clearRateLimit(ipOrKey) {
    try {
        if (ipOrKey) {
            const [result] = await sequelize.query(
                'DELETE FROM rate_limits WHERE rl_key = :key OR rl_key LIKE :pattern',
                { replacements: { key: ipOrKey, pattern: `%${ipOrKey}%` } }
            );
            return result.affectedRows > 0;
        }
        await sequelize.query('DELETE FROM rate_limits');
        return true;
    } catch (err) {
        console.error('[Rate Limit] clearRateLimit error:', err.message);
        return false;
    }
}

async function cleanExpiredRateLimits(windowMs = 15 * 60 * 1000) {
    try {
        const [result] = await sequelize.query(
            'DELETE FROM rate_limits WHERE reset_time + :windowMs <= :now',
            { replacements: { windowMs, now: Date.now() } }
        );
        return result.affectedRows || 0;
    } catch (err) {
        console.error('[Rate Limit] cleanExpiredRateLimits error:', err.message);
        return 0;
    }
}

async function getAllRateLimitEntries() {
    try {
        const [rows] = await sequelize.query('SELECT rl_key AS `key`, count, reset_time FROM rate_limits');
        return rows;
    } catch (err) {
        console.error('[Rate Limit] getAllRateLimitEntries error:', err.message);
        return [];
    }
}

module.exports = {
    rateLimit,
    sanitizeInput,
    validateQueryParams,
    xssProtection,
    limitRequestSize,
    sqlInjectionProtection,
    clearRateLimit,
    cleanExpiredRateLimits,
    getAllRateLimitEntries
};
