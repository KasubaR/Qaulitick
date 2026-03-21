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

// Admin routes: same-origin only — no cross-origin access permitted
const adminCors = cors({ origin: false });

// Public API routes: SITE_URL / APP_PUBLIC_URL / ALLOWED_ORIGINS (deduped)
// e.g. ALLOWED_ORIGINS=https://qualitick.com,https://www.qualitick.com
const publicApiCors = cors({
    origin(origin, callback) {
        // Non-browser or same-origin tools may omit Origin
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(Object.assign(new Error(`CORS policy does not allow origin: ${origin}`), { status: 403 }));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    credentials: true
});

module.exports = { adminCors, publicApiCors };
