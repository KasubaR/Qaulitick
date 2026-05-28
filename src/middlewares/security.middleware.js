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

// In-memory fallback store used by fail-closed limiters when DB is unavailable.
// Structure: Map<key, { count: number, resetTime: number }>
// Intentionally module-level so it persists for the process lifetime.
const _memFallback = new Map();
const _MAX_MEM_ENTRIES = 50_000;

function _memIncrement(key, windowMs, now) {
    const entry = _memFallback.get(key);
    if (!entry || entry.resetTime + windowMs <= now) {
        // Don't grow unboundedly under a DDoS with unique IPs. If the map is full
        // and this is a new key, return a count of 1 without storing — fail open
        // so legitimate traffic isn't blocked, but memory is protected.
        if (!_memFallback.has(key) && _memFallback.size >= _MAX_MEM_ENTRIES) {
            return { count: 1, resetTime: now };
        }
        const next = { count: 1, resetTime: now };
        _memFallback.set(key, next);
        return next;
    }
    entry.count += 1;
    return entry;
}

// Periodically evict expired in-memory entries to prevent unbounded growth.
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of _memFallback) {
        // Use a generous 2× window before evicting so late DB recovery doesn't reset counters prematurely
        if (v.resetTime + 30 * 60 * 1000 <= now) _memFallback.delete(k);
    }
}, 5 * 60 * 1000).unref();

// Periodically delete expired DB rate-limit rows (max window across all limiters is 1 hour).
setInterval(() => {
    const now = Date.now();
    sequelize.query(
        'DELETE FROM rate_limits WHERE reset_time + 3600000 <= :now',
        { replacements: { now } }
    ).catch(() => {});
}, 5 * 60 * 1000).unref();

/**
 * Rate Limiting Middleware
 * Backed by MySQL — survives restarts and works correctly under multi-process deployments.
 * @param {object} options
 * @param {number}   options.windowMs     - Time window in milliseconds
 * @param {number}   options.max          - Maximum requests per window
 * @param {string}   options.message      - Response message when limit exceeded
 * @param {boolean}  options.failClosed   - If true, enforce limits via in-memory fallback when DB is down (default false)
 * @param {Function} options.keyGenerator - Optional custom key function(req) → string
 */
function rateLimit(options = {}) {
    const {
        windowMs = 15 * 60 * 1000,
        max = 100,
        message = 'Too many requests, please try again later.',
        failClosed = false,
        keyGenerator = null
    } = options;

    return async (req, res, next) => {
        const ip = req.ip ||
                   req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                   req.connection?.remoteAddress ||
                   'unknown';
        const routePath = req.path || req.route?.path || 'unknown';
        const key = keyGenerator ? keyGenerator(req) : `${ip}:${routePath}`;

        // Helper shared by the happy path and the fail-closed fallback
        const sendLimited = (count, resetTime, now) => {
            const retryAfter = Math.ceil((windowMs - (now - resetTime)) / 1000);
            res.set({
                'Retry-After': retryAfter,
                'X-RateLimit-Limit': max,
                'X-RateLimit-Remaining': 0,
                'X-RateLimit-Reset': new Date(resetTime + windowMs).toISOString()
            });
            const isApiRequest = req.originalUrl.startsWith('/api/') || req.xhr;
            if (!isApiRequest) {
                const mins = Math.floor(retryAfter / 60);
                const secs = retryAfter % 60;
                const timeStr = mins > 0
                    ? `${mins} minute${mins !== 1 ? 's' : ''} and ${secs} second${secs !== 1 ? 's' : ''}`
                    : `${secs} second${secs !== 1 ? 's' : ''}`;
                return res.status(429).render('500', {
                    title: '429 - Too Many Requests',
                    message: 'Too Many Requests',
                    errorType: 'rate-limit',
                    rateLimitMessage: `${message} Please wait ${timeStr} before trying again.`
                });
            }
            return res.status(429).json({ success: false, message, retryAfter });
        };

        // INSERT ... ON DUPLICATE KEY UPDATE can still deadlock in InnoDB when two
        // concurrent requests race to insert the same new key (both acquire a shared
        // gap lock then try to upgrade). Retry up to 2 times on ER_LOCK_DEADLOCK (1213).
        let attempts = 0;
        while (true) {
            try {
                const now = Date.now();

                await sequelize.query(
                    `INSERT INTO rate_limits (rl_key, count, reset_time)
                     VALUES (:key, 1, :now)
                     ON DUPLICATE KEY UPDATE
                       count      = IF(reset_time + :windowMs <= :now, 1, count + 1),
                       reset_time = IF(reset_time + :windowMs <= :now, :now, reset_time)`,
                    { replacements: { key, now, windowMs } }
                );

                const [[row]] = await sequelize.query(
                    'SELECT count, reset_time FROM rate_limits WHERE rl_key = :key',
                    { replacements: { key } }
                );

                const count     = row ? row.count      : 1;
                const resetTime = row ? row.reset_time : now;

                if (count > max) return sendLimited(count, resetTime, now);

                res.set({
                    'X-RateLimit-Limit': max,
                    'X-RateLimit-Remaining': Math.max(0, max - count),
                    'X-RateLimit-Reset': new Date(resetTime + windowMs).toISOString()
                });

                return next();
            } catch (error) {
                const isDeadlock = (error.original || error.parent || error).errno === 1213
                    || error.message.includes('Deadlock');

                if (isDeadlock && attempts < 2) {
                    attempts++;
                    await new Promise(r => setTimeout(r, 5 * attempts));
                    continue;
                }

                console.error('[Rate Limit] DB error:', error.message);

                if (failClosed) {
                    const now = Date.now();
                    const entry = _memIncrement(key, windowMs, now);
                    if (entry.count > max) return sendLimited(entry.count, entry.resetTime, now);
                    return next();
                }

                // Non-sensitive routes: fail open (original behaviour)
                return next();
            }
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
// Fast pre-reject based on the Content-Length header. This is client-supplied and can be
// spoofed (missing or understated), so it is NOT the authoritative size enforcement.
// Actual body size is enforced by express.json({ limit }) and express.urlencoded({ limit })
// in app.js, which measure the streamed bytes. This check exists only to reject honest
// clients early and avoid unnecessary body parsing overhead.
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
    clearRateLimit,
    cleanExpiredRateLimits,
    getAllRateLimitEntries
};
