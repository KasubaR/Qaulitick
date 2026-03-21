const cors = require('cors');

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : [];

// Admin routes: same-origin only — no cross-origin access permitted
const adminCors = cors({ origin: false });

// Public API routes: explicit allowlist from ALLOWED_ORIGINS env var
// e.g. ALLOWED_ORIGINS=https://qualitick.com,https://www.qualitick.com
const publicApiCors = cors({
    origin(origin, callback) {
        // Same-origin requests have no Origin header — always allow
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(Object.assign(new Error(`CORS policy does not allow origin: ${origin}`), { status: 403 }));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    credentials: true
});

module.exports = { adminCors, publicApiCors };
