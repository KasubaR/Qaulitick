const cors = require('cors');

/**
 * Origins derived from public site URL (so admin pages on the same host can call /api/* without
 * duplicating the domain in ALLOWED_ORIGINS).
 */
function originsFromPublicUrlEnv() {
    const set = new Set();
    for (const key of ['APP_PUBLIC_URL', 'SITE_URL']) {
        const raw = process.env[key];
        if (!raw || typeof raw !== 'string') continue;
        const trimmed = raw.trim().replace(/\/$/, '');
        try {
            const u = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
            if (u.origin && u.origin !== 'null') {
                set.add(u.origin);
            }
        } catch {
            /* ignore bad URL */
        }
    }
    return [...set];
}

const allowedOriginsList = [
    ...originsFromPublicUrlEnv(),
    ...(process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
        : [])
];
const allowedOrigins = [...new Set(allowedOriginsList)];

/** Treat www and apex as the same host so SITE_URL and browser Origin can differ. */
function canonicalHost(hostname) {
    return String(hostname || '')
        .replace(/^www\./i, '')
        .toLowerCase();
}

/**
 * Exact origin match, or same protocol + canonical host as any configured origin.
 */
function isPublicApiOriginAllowed(requestOrigin) {
    if (allowedOrigins.includes(requestOrigin)) return true;
    let req;
    try {
        req = new URL(requestOrigin);
    } catch {
        return false;
    }
    const reqHost = canonicalHost(req.hostname);
    for (const allowed of allowedOrigins) {
        try {
            const u = new URL(allowed);
            if (u.protocol === req.protocol && canonicalHost(u.hostname) === reqHost) {
                return true;
            }
        } catch {
            continue;
        }
    }
    return false;
}

/**
 * When env allowlist is empty or wrong, still allow browser calls where Origin matches this
 * request's Host (same deployment). Does not match cross-site fetches (Origin ≠ Host).
 */
function originMatchesRequestHost(origin, req) {
    if (!req) return false;
    try {
        const o = new URL(origin);
        let host = req.get('x-forwarded-host') || req.get('host') || '';
        host = host.split(',')[0].trim().split(':')[0];
        if (!host) return false;
        return canonicalHost(o.hostname) === canonicalHost(host);
    } catch {
        return false;
    }
}

// Admin routes: same-origin only — no cross-origin access permitted
const adminCors = cors({ origin: false });

const publicApiCorsMethods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
const publicApiCorsAllowedHeaders = ['Content-Type', 'Authorization', 'X-CSRF-Token'];

// Public API routes: SITE_URL / APP_PUBLIC_URL / ALLOWED_ORIGINS (deduped)
// e.g. ALLOWED_ORIGINS=https://qualitick.com,https://www.qualitick.com
const publicApiCors = cors((req, callback) => {
    const origin = req.header('Origin');
    const base = {
        credentials: true,
        methods: publicApiCorsMethods,
        allowedHeaders: publicApiCorsAllowedHeaders
    };

    if (!origin) {
        return callback(null, { ...base, origin: true });
    }
    if (isPublicApiOriginAllowed(origin) || originMatchesRequestHost(origin, req)) {
        return callback(null, { ...base, origin: true });
    }

    const err = new Error(`CORS policy does not allow origin: ${origin}`);
    err.statusCode = 403;
    callback(err);
});

module.exports = { adminCors, publicApiCors };
