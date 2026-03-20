const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const compression = require('compression');
const ipaddr = require('ipaddr.js');
const cookieParser = require('cookie-parser');

// Database connection
const { connectDatabase } = require('./config/database');

// Connect to database before starting server
connectDatabase().catch(err => {
    console.error('Database connection failed:', err);
    process.exit(1);
});

// Create Express app
const app = express();

// Trust proxy for correct IP detection (important for rate limiting)
app.set('trust proxy', 1);

// Set EJS as view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// Make environment variables available to all templates
app.locals.GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID || null;

// CSRF token will be available to all templates via res.locals.csrfToken
// (set by csrfTokenGenerator middleware)

// Compression middleware (GZIP/Brotli)
// Automatically compresses responses using GZIP or Brotli based on client support
app.use(compression({
    filter: (req, res) => {
        // Don't compress if client explicitly doesn't want compression
        if (req.headers['x-no-compression']) {
            return false;
        }
        // Compress all other responses
        return true;
    },
    level: 6, // Compression level (1-9, 6 is good balance between speed and size)
    threshold: 1024, // Only compress responses larger than 1KB
    memLevel: 8 // Memory level for compression (1-9, 8 is good default)
}));

// Security Middleware (must be before body parser)
const { 
    rateLimit, 
    sanitizeInput, 
    validateQueryParams, 
    xssProtection,
    limitRequestSize,
    sqlInjectionProtection 
} = require('./middlewares/security.middleware');

// Authentication Middleware
const { requireAdminAuth, authenticateAdmin } = require('./middlewares/auth.middleware');

// XSS Protection Headers
app.use(xssProtection);

// Request Size Limiting
app.use(limitRequestSize('10mb'));

// SQL Injection Protection
app.use(sqlInjectionProtection);

// Cookie parser middleware (for reading cart cookie server-side)
app.use(cookieParser());

// Body parser middleware (with size limits)
// verify callback captures raw bytes for webhook signature verification before JSON.parse runs
app.use(express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
        if (req.path === '/api/payments/lenco/webhook') {
            req.rawBody = buf; // original bytes — used by validateWebhookSignature
        }
    }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Input Sanitization (after body parser)
app.use(sanitizeInput);

// Session Management
const session = require('express-session');

// CSRF Protection Middleware
const { csrfTokenGenerator, csrfTokenValidator } = require('./middlewares/csrf.middleware');

// Validate SESSION_SECRET in production
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production. Please set the SESSION_SECRET environment variable.');
}

// Validate LENCO_WEBHOOK_SECRET in production — placeholder or missing secret allows unauthenticated webhook calls
if (process.env.NODE_ENV === 'production') {
    const webhookSecret = process.env.LENCO_WEBHOOK_SECRET;
    if (!webhookSecret || webhookSecret === 'xxxxxxxxxxxxxxxxxxxxxxx') {
        throw new Error('LENCO_WEBHOOK_SECRET must be set to a real value in production.');
    }
}

// Session store — MemoryStore (dev/single-process). Replace with a persistent store
// (e.g. connect-session-sequelize) if multi-process or session persistence is needed.
if (process.env.NODE_ENV === 'production') {
    console.warn('[Session] Using in-memory MemoryStore. Sessions will not persist across restarts.');
}
const sessionStore = undefined; // express-session defaults to MemoryStore

// Session configuration
const sessionConfig = {
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'dev-secret-not-for-production-use',
    resave: false,
    saveUninitialized: false,
    name: 'admin.sid',
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: parseInt(process.env.SESSION_MAX_AGE || '28800000', 10) // Default: 8 hours
    },
    rolling: true
};

app.use(session(sessionConfig));

// CSRF Token Generation Middleware
// Generates CSRF tokens server-side and makes them available to templates
// Must be after session middleware
app.use(csrfTokenGenerator);

// Disable directory listing: return 403 for folder requests (no index file)
// Skip for root path so the app's routes can serve the homepage
const publicDir = path.join(__dirname, '..', 'public');
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
                try {
                    await fs.promises.access(path.join(resolved, name));
                    hasIndex = true;
                    break;
                } catch (_) { /* not found */ }
            }
            if (!hasIndex) return res.status(403).send('Forbidden');
        }
    } catch (_) { /* path not found — let static or 404 handler deal with it */ }
    next();
});

// CDN and Cache headers for static files
app.use(express.static(publicDir, {
    maxAge: '1y', // Cache static files for 1 year
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        // Set CDN-friendly headers
        if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg') || filePath.endsWith('.png') || filePath.endsWith('.webp') || filePath.endsWith('.svg')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year for images
            res.setHeader('X-Content-Type-Options', 'nosniff');
        } else if (filePath.endsWith('.css') || filePath.endsWith('.js')) {
            res.setHeader('Cache-Control', 'no-cache'); // Always revalidate CSS/JS
        } else {
            res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day for other files
        }
        
        // CDN support headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    }
}));

// CORS configuration
// Admin routes: same-origin only — no cross-origin access permitted
app.use('/api/admin', cors({ origin: false }));

// Public API routes: explicit allowlist from ALLOWED_ORIGINS env var
// e.g. ALLOWED_ORIGINS=https://qualitick.com,https://www.qualitick.com
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : [];

app.use('/api', cors({
    origin(origin, callback) {
        // Same-origin requests have no Origin header — always allow
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(Object.assign(new Error(`CORS policy does not allow origin: ${origin}`), { status: 403 }));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    credentials: true
}));

// Serve favicon.ico to prevent 404 errors (browsers auto-request this)
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'images', 'icons', 'Qualitick-01.svg'));
});

// Import routes
// NOTE: Cart routes are defined in src/routes/cart.routes.js
// This is the canonical cart routes file - do not create duplicates
const productRoutes = require('./routes/product.routes');
const orderRoutes = require('./routes/order.routes');
const paymentRoutes = require('./routes/payment.routes');
const cartRoutes = require('./routes/cart.routes'); // Path: src/routes/cart.routes.js
const marketingRoutes = require('./routes/marketing.routes');
const productController = require('./controllers/product.controller');
const contactController = require('./controllers/contact.controller');
const paymentController = require('./controllers/payment.controller');
const customerController = require('./controllers/customer.controller');
const inventoryController = require('./controllers/inventory.controller');
const settingsController = require('./controllers/settings.controller');
const authController = require('./controllers/auth.controller');

// Register routes
app.use('/product', productRoutes);
app.use('/', marketingRoutes); // Marketing routes (public and admin)

// Import middleware
const { cacheMiddleware } = require('./middlewares/cache.middleware');

// API Routes with caching and security
// GET /api/products - Products API endpoint for shop.ejs
// Rate limit: 100 requests per 15 minutes per IP
app.get('/api/products', 
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    validateQueryParams,
    cacheMiddleware(5 * 60 * 1000), 
    productController.getProductsAPI
);

// GET /api/products/search - Product search API endpoint
// Used by shop.js and admin flash-sales.js
app.get('/api/products/search',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    cacheMiddleware(5 * 60 * 1000),
    productController.searchProducts
);

// GET /api/products/brands - List product brands
app.get('/api/products/brands',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    cacheMiddleware(5 * 60 * 1000),
    productController.getBrands
);

// GET /api/products/export - Export products to CSV/JSON (Admin)
app.get('/api/products/export',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }),
    authenticateAdmin,
    productController.exportProducts
);

// POST /api/products/generate-sku - Generate SKU (Admin)
app.post('/api/products/generate-sku',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    csrfTokenValidator(),
    productController.generateSKU
);

// POST /api/products - Create product
app.post('/api/products',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    productController.createProduct
);

// POST /api/products/:id/reviews - Submit product review
// Note: CSRF validation excluded for public review submissions (handled by rate limiting)
app.post('/api/products/:id/reviews',
    rateLimit({ 
        windowMs: 15 * 60 * 1000, // 15 minutes (more reasonable)
        max: 10, // 10 review attempts per 15 minutes per IP (allows retries for validation errors)
        message: 'Too many review attempts. Please try again later.',
        keyGenerator: (req) => {
            // Include IP and product ID in key to prevent abuse per product
            // Use the same IP detection logic as the middleware
            let ip = req.ip || 
                     req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                     req.connection?.remoteAddress || 
                     req.socket?.remoteAddress ||
                     'unknown';
            
            // Normalize localhost IPs to avoid collisions (::1, 127.0.0.1, etc.)
            // But keep them unique per session by adding a session identifier if available
            if (ip === '::1' || ip === '::ffff:127.0.0.1' || ip.startsWith('127.0.0.1')) {
                // For localhost, use session ID or a timestamp-based identifier to avoid collisions
                const sessionId = req.session?.id || req.headers['user-agent']?.substring(0, 20) || 'localhost';
                ip = `localhost-${sessionId}`;
            }
            
            const productId = req.params.id || 'unknown';
            return `review:${ip}:${productId}`;
        }
    }),
    productController.submitReview
);

// POST /api/products/upload-images - Upload product images
// Configure multer for image uploads
const multer = require('multer');
// Note: 'fs' is already required at the top of this file

// Ensure upload directory exists
// Note: __dirname is 'src', so we need to go up one level to reach 'public'
const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'products');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('[Image Upload] Created upload directory:', uploadDir);
} else {
    console.log('[Image Upload] Upload directory exists:', uploadDir);
}

// Configure multer storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Generate unique filename: timestamp-random-originalname
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '-');
        cb(null, `${name}-${uniqueSuffix}${ext}`);
    }
});

// Configure multer with file filter
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB per file
        files: 10 // Maximum 10 files
    },
    fileFilter: (req, file, cb) => {
        // Accept only image files
        const allowedTypes = /jpeg|jpg|png|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPG, PNG, and WebP images are allowed.'));
        }
    }
});

// Error handler for multer errors
const handleUploadError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File too large. Maximum size is 10MB per file.'
            });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                message: 'Too many files. Maximum 10 files allowed.'
            });
        }
        return res.status(400).json({
            success: false,
            message: err.message || 'File upload error'
        });
    }
    if (err) {
        return res.status(400).json({
            success: false,
            message: err.message || 'Failed to upload images'
        });
    }
    next();
};

app.post('/api/products/upload-images',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    upload.array('images', 10),
    handleUploadError,
    productController.uploadImages
);

// DELETE /api/products/bulk - Bulk delete products
app.delete('/api/products/bulk',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    productController.bulkDeleteProducts
);

// Product routes with :id - must be registered AFTER static segments (search, brands, export, generate-sku, upload-images, bulk)
// GET /api/products/:id - Get single product (for editing)
app.get('/api/products/:id',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    productController.getProductByIdAPI
);

// PUT /api/products/:id - Update product
app.put('/api/products/:id',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    productController.updateProduct
);

// DELETE /api/products/:id - Delete product
app.delete('/api/products/:id',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    productController.deleteProduct
);

// PUT /api/products/:id/images/reorder - Reorder product images
app.put('/api/products/:id/images/reorder',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    productController.reorderProductImages
);

// PUT /api/products/:id/images/primary - Set primary image
app.put('/api/products/:id/images/primary',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    productController.setPrimaryImage
);

// DELETE /api/products/:id/images/:imageId - Delete single image
app.delete('/api/products/:id/images/:imageId',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    productController.deleteProductImage
);

// POST /api/contact - Contact form submission
app.post('/api/contact',
    rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }), // 5 submissions per hour (more reasonable)
    csrfTokenValidator(),
    contactController.submitContactForm
);

// API Routes with rate limiting
// Cart API: 100 requests per 15 minutes
// Route file: src/routes/cart.routes.js (canonical - do not create duplicates)
app.use('/api/cart', rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }), csrfTokenValidator(), cartRoutes);

// Orders API: 50 requests per 15 minutes (for customers)
app.use('/api/orders', rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }), csrfTokenValidator(), orderRoutes);

// Admin Orders API: Higher rate limit for admin operations (200 requests per 15 minutes)
app.use('/api/admin/orders', 
    rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }),
    authenticateAdmin,
    csrfTokenValidator(),
    orderRoutes
);

// Admin Analytics API: 50 requests per 15 minutes
const analyticsController = require('./controllers/analytics.controller');
app.get('/api/admin/analytics', 
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    analyticsController.getAnalyticsData
);
app.get('/api/admin/analytics/realtime',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    analyticsController.getRealTimeData
);
app.get('/api/admin/analytics/export',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }),
    authenticateAdmin,
    analyticsController.exportAnalyticsData
);

// Admin Dashboard API: 100 requests per 15 minutes
const dashboardController = require('./controllers/dashboard.controller');
app.get('/api/admin/dashboard/stats',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    dashboardController.getDashboardStats
);
app.get('/api/admin/dashboard/recent-orders',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    dashboardController.getRecentOrders
);
app.get('/api/admin/dashboard/order-summary',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    dashboardController.getOrderSummary
);
app.get('/api/admin/dashboard/low-stock',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    dashboardController.getLowStockProducts
);
app.get('/api/admin/dashboard/best-selling',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    dashboardController.getBestSellingProducts
);
app.get('/api/admin/dashboard/top-customers',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    dashboardController.getTopCustomers
);
app.get('/api/admin/dashboard/charts/:type',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    dashboardController.getChartData
);
app.get('/api/admin/dashboard/search',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    dashboardController.searchDashboard
);

// ============================================
// Customer API Routes (Admin)
// ============================================
app.get('/api/admin/customers',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    customerController.getCustomers
);
app.get('/api/admin/customers/stats',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    customerController.getCustomerStats
);
app.get('/api/admin/customers/:email',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    customerController.getCustomerByEmail
);

// ============================================
// Inventory API Routes (Admin)
// ============================================
app.get('/api/admin/inventory', 
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    inventoryController.getInventoryProducts
);

app.get('/api/admin/inventory/stats',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    inventoryController.getInventoryStats
);

app.put('/api/admin/inventory/stock/:productId',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    inventoryController.updateStock
);

app.get('/api/admin/inventory/brands',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    inventoryController.getBrands
);

app.get('/api/admin/inventory/export',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }),
    authenticateAdmin,
    inventoryController.exportInventory
);

// ============================================
// Settings API Routes (Admin)
// ============================================
app.get('/api/admin/settings',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    settingsController.getSettings
);

app.get('/api/admin/settings/notifications',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    settingsController.getNotificationSettings
);

app.put('/api/admin/settings/:category',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    csrfTokenValidator(),
    settingsController.updateSettings
);

app.post('/api/admin/settings/test-email',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    csrfTokenValidator(),
    settingsController.testEmail
);

app.post('/api/admin/settings/test-payment',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    csrfTokenValidator(),
    settingsController.testPayment
);

// ============================================
// Lenco Payment Webhook Endpoint
// ============================================
// POST /api/payments/lenco/webhook - Lenco payment webhook
// Note: CSRF validation excluded for webhook (external service)
// 
// Security Features:
// - Separate rate limiting (100 requests/hour, more permissive than regular API)
// - IP whitelist check (optional, configure LENCO_WEBHOOK_IPS in .env)
// - Signature verification (handled in controller via lencoService)
// - Comprehensive logging for debugging
//
// Configuration:
// 1. Set LENCO_WEBHOOK_URL in .env: https://yourdomain.com/api/payments/lenco/webhook
// 2. Configure webhook URL in Lenco dashboard
// 3. (Optional) Set LENCO_WEBHOOK_IPS in .env: "192.168.1.0/24,203.0.113.0/24"
//
// Note: Webhook signature verification uses parsed JSON body. If Lenco requires raw body
// for signature verification, you may need to configure Express to capture raw body:
// const express = require('express');
// app.use('/api/payments/lenco/webhook', express.raw({ type: 'application/json' }), ...);
// ============================================
app.post('/api/payments/lenco/webhook',
    // Webhook-specific rate limiting (more permissive than regular API)
    // Allow up to 100 webhook calls per hour per IP (Lenco may retry)
    // CSRF validation excluded - webhooks come from external service
    rateLimit({ 
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 100,
        message: 'Too many webhook requests. Please contact support if this persists.'
    }),
    // Log webhook requests for debugging
    (req, res, next) => {
        const timestamp = new Date().toISOString();
        const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
        const signature = req.headers['x-lenco-signature'] || 
                        req.headers['x-signature'] || 
                        req.headers['signature'] || 
                        'not provided';
        
        console.log(`[Lenco Webhook] ${timestamp} - IP: ${ip}`);
        console.log(`[Lenco Webhook] Headers:`, {
            'x-lenco-signature': req.headers['x-lenco-signature'] ? 'present' : 'missing',
            'x-signature': req.headers['x-signature'] ? 'present' : 'missing',
            'content-type': req.headers['content-type'],
            'user-agent': req.headers['user-agent']
        });
        // Log body structure - check both direct fields and data wrapper
        const bodyData = req.body?.data || req.body;
        console.log(`[Lenco Webhook] Body preview:`, {
            hasBody: !!req.body,
            bodyKeys: req.body ? Object.keys(req.body) : [],
            hasData: !!req.body?.data,
            transactionId: bodyData?.id || bodyData?.transactionId || bodyData?.transaction_id,
            status: bodyData?.status || req.body?.status,
            reference: bodyData?.reference || req.body?.reference,
            lencoReference: bodyData?.lencoReference,
            orderNumber: bodyData?.orderNumber || bodyData?.order_number || bodyData?.metadata?.orderNumber
        });
        
        // Store request info for error handling
        req.webhookLog = {
            timestamp,
            ip,
            signature: signature.substring(0, 20) + '...', // Log partial signature only
            hasSignature: !!signature && signature !== 'not provided'
        };
        
        next();
    },
    // IP Whitelist check (optional - configure Lenco IPs in .env)
    (req, res, next) => {
        const lencoIPs = process.env.LENCO_WEBHOOK_IPS;
        
        // If IP whitelist is configured, enforce it strictly
        if (lencoIPs) {
            const allowedIPs = lencoIPs.split(',').map(ip => ip.trim());
            const clientIP = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim();
            
            if (!clientIP) {
                console.error('[Lenco Webhook] Unable to determine client IP address');
                return res.status(403).json({
                    success: false,
                    message: 'IP address could not be determined'
                });
            }
            
            // Check if IP matches any allowed IP or CIDR range using ipaddr.js
            const isAllowed = allowedIPs.some(allowedIP => {
                try {
                    if (allowedIP.includes('/')) {
                        // CIDR notation (e.g., 192.168.1.0/24, 2001:db8::/32)
                        const [networkStr, prefixLengthStr] = allowedIP.split('/');
                        const prefixLength = parseInt(prefixLengthStr, 10);
                        
                        if (isNaN(prefixLength) || prefixLength < 0) {
                            console.error(`[Lenco Webhook] Invalid CIDR prefix length: ${prefixLengthStr}`);
                            return false;
                        }
                        
                        // Parse network address
                        const network = ipaddr.process(networkStr);
                        const client = ipaddr.process(clientIP);
                        
                        // Check if client IP matches the CIDR range
                        return client.match(network, prefixLength);
                    } else {
                        // Exact IP match
                        const allowedAddr = ipaddr.process(allowedIP);
                        const clientAddr = ipaddr.process(clientIP);
                        return allowedAddr.toString() === clientAddr.toString();
                    }
                } catch (error) {
                    console.error(`[Lenco Webhook] Error checking IP whitelist for ${allowedIP}:`, error.message);
                    return false;
                }
            });
            
            if (!isAllowed) {
                console.warn(`[Lenco Webhook] IP ${clientIP} not in whitelist. Allowed IPs: ${lencoIPs}`);
                return res.status(403).json({
                    success: false,
                    message: 'IP address not authorized'
                });
            }
        }
        
        next();
    },
    // Webhook handler
    paymentController.handleLencoWebhook
);

// Payments API: 20 requests per 15 minutes (more restrictive for other endpoints)
// Note: CSRF validation excluded for webhook route (handled separately in app.js)
// Note: Verify route is registered in payment.routes.js before /:id to ensure proper route matching
app.use('/api/payments', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }), csrfTokenValidator({ excludedPaths: ['/api/payments/lenco/webhook'] }), paymentRoutes);

// Home route
app.get('/', (req, res) => {
    res.render('home', {
        title: 'Qualitick Collections | Luxury Watches',
        page: 'home'
    });
});

// Shop route (SSR rendering)
app.get('/shop', productController.renderShop);

// Static pages
app.get('/about', (req, res) => {
    res.render('about', {
        title: 'About Us | Qualitick Collections',
        page: 'about'
    });
});

app.get('/contact', (req, res) => {
    res.render('contact', {
        title: 'Contact Us | Qualitick Collections',
        page: 'contact'
    });
});

app.get('/terms', (req, res) => {
    res.render('terms', {
        title: 'Terms & Conditions | Qualitick Collections',
        page: 'terms'
    });
});

app.get('/privacy', (req, res) => {
    res.render('privacy', {
        title: 'Privacy Policy | Qualitick Collections',
        page: 'privacy'
    });
});

// Cart and checkout routes
app.get('/cart', async (req, res) => {
    try {
        // Parse and validate cart cookie server-side for SSR
        // This eliminates blank flash and provides graceful degradation
        const cartUtils = require('./utils/cart.utils');
        const cartData = await cartUtils.parseAndValidateCartCookie(req);
        
        res.render('cart', {
            title: 'Cart | Qualitick Collections',
            page: 'cart',
            initialCartItems: cartData.items, // Server-rendered cart items
            initialCartTotals: cartData.totals, // Server-calculated totals
            cartWarnings: cartData.warnings // Warnings (price/stock updates)
        });
    } catch (error) {
        console.error('[Cart Route] Error loading cart:', error);
        // Render with empty cart on error (graceful degradation)
        res.render('cart', {
            title: 'Cart | Qualitick Collections',
            page: 'cart',
            initialCartItems: [],
            initialCartTotals: {
                subtotal: 0,
                discount: 0,
                delivery: 0,
                total: 0
            },
            cartWarnings: []
        });
    }
});

app.get('/checkout', (req, res) => {
    res.render('checkout', {
        title: 'Checkout | Qualitick Collections',
        page: 'checkout'
    });
});

app.get('/order-success/:orderNumber', (req, res) => {
    const { orderNumber } = req.params;
    res.render('order-success', {
        title: 'Order Success | Qualitick Collections',
        page: 'order-success',
        orderNumber: orderNumber
    });
});

// Admin Authentication Routes
// GET /admin/login - Render login page (requires secret URL)
app.get('/admin/login',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }), // Rate limit login page access
    authController.renderLoginPage
);

// POST /admin/login - Handle login form submission
// CSRF optional: login is protected by secret URL + rate limit; token still sent when form has it
app.post('/admin/login',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }), // Stricter rate limit for login attempts
    csrfTokenValidator({ excludedPaths: ['/admin/login'] }),
    authController.handleLogin
);

// GET /admin/logout - Handle logout
app.get('/admin/logout', authController.handleLogout);

// POST /admin/logout - Handle logout (alternative method)
app.post('/admin/logout', csrfTokenValidator(), authController.handleLogout);

// GET /admin/access-denied - Render access denied page
app.get('/admin/access-denied', (req, res) => {
    res.render('admin/access-denied', {
        title: 'Access Denied | Admin Panel',
        page: 'admin',
        error: req.query.error || null,
        showLoginLink: req.query.showLoginLink !== 'false'
    });
});

// Admin routes (protected with authentication)
app.get('/admin/dashboard', requireAdminAuth, (req, res) => {
    res.render('admin/dashboard', {
        title: 'Admin Dashboard | Qualitick Collections',
        page: 'admin'
    });
});

app.get('/admin/analytics', requireAdminAuth, (req, res) => {
    const analyticsController = require('./controllers/analytics.controller');
    analyticsController.renderAnalyticsPage(req, res);
});

app.get('/admin/products', requireAdminAuth, async (req, res) => {
    try {
        const productService = require('./services/product.service');
        // Load all products from database (not just active ones for admin)
        const products = await productService.getAllProducts({}, { sort: [['createdAt', 'DESC']] });
        
        // Convert to plain objects for EJS
        const productsData = products.map(product => {
            const productObj = product.toJSON();
            return productObj;
        });
        
        res.render('admin/products', {
            title: 'Product Management | Admin Panel',
            page: 'admin',
            activePage: 'products',
            products: productsData
        });
    } catch (error) {
        console.error('[Admin] Error loading products:', error);
        res.render('admin/products', {
            title: 'Product Management | Admin Panel',
            page: 'admin',
            activePage: 'products',
            products: []
        });
    }
});

app.get('/admin/orders', requireAdminAuth, (req, res) => {
    res.render('admin/orders', {
        title: 'Orders Management | Admin Panel',
        page: 'admin'
    });
});

app.get('/admin/payments', requireAdminAuth, (req, res) => {
    res.render('admin/payments', {
        title: 'Payments Management | Admin Panel',
        page: 'admin'
    });
});

app.get('/admin/customers', requireAdminAuth, (req, res) => {
    res.render('admin/customers', {
        title: 'Customers Management | Admin Panel',
        page: 'admin'
    });
});

app.get('/admin/settings', requireAdminAuth, (req, res) => {
    res.render('admin/settings', {
        title: 'Settings | Admin Panel',
        page: 'admin'
    });
});

app.get('/admin/inventory', requireAdminAuth, (req, res) => {
    res.render('admin/inventory', {
        title: 'Inventory Management | Admin Panel',
        page: 'admin'
    });
});

// Admin Marketing routes
app.get('/admin/marketing', requireAdminAuth, (req, res) => {
    res.render('admin/marketing/index', {
        title: 'Marketing Management | Admin Panel',
        page: 'admin'
    });
});

app.get('/admin/marketing/flash-sales', requireAdminAuth, (req, res) => {
    res.render('admin/marketing/flash-sales', {
        title: 'Flash Sales Management | Admin Panel',
        page: 'admin'
    });
});

app.get('/admin/marketing/featured-products', requireAdminAuth, (req, res) => {
    res.render('admin/marketing/featured-products', {
        title: 'Featured Products Management | Admin Panel',
        page: 'admin'
    });
});

// Admin Contact Submissions routes
app.get('/admin/contact-submissions', requireAdminAuth, contactController.renderContactSubmissionsPage);

// GET /api/admin/contact-submissions - Get contact submissions (API)
app.get('/api/admin/contact-submissions',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    contactController.getContactSubmissions
);

// PATCH /api/admin/contact-submissions/:id/status - Update submission status
app.patch('/api/admin/contact-submissions/:id/status',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
    authenticateAdmin,
    csrfTokenValidator(),
    contactController.updateSubmissionStatus
);

// DELETE /api/admin/contact-submissions/:id - Delete submission
app.delete('/api/admin/contact-submissions/:id',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }),
    authenticateAdmin,
    csrfTokenValidator(),
    contactController.deleteSubmission
);

// Debug endpoint to clear rate limits (development only)
if (process.env.NODE_ENV !== 'production') {
    const { clearRateLimit, cleanExpiredRateLimits, getAllRateLimitEntries } = require('./middlewares/security.middleware');
    
    app.post('/api/debug/rate-limit/clear', (req, res) => {
        const { key } = req.body;
        const cleared = clearRateLimit(key);
        const cleaned = cleanExpiredRateLimits();
        res.json({
            success: true,
            message: cleared ? `Cleared rate limit for: ${key || 'all'}` : 'No matching rate limit found',
            expiredCleaned: cleaned,
            allEntries: getAllRateLimitEntries()
        });
    });
}

// Error Handling Middleware
// Must be added after all routes
const { errorHandler, notFoundHandler } = require('./middlewares/error.middleware');

// 404 Handler (must be last route)
app.use(notFoundHandler);

// Global Error Handler (must be last middleware)
app.use(errorHandler);

// Export the app (not starting the server here)
module.exports = app;