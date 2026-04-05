# Android Sales & Inventory Integration Guide

The Android app will connect to the **admin API** to read orders, payments, layby plans, and inventory. All these endpoints already exist and return JSON — you just need to add JWT login so the Android app can authenticate without a browser session.

---

## What Data You Can Get

### Orders
```
GET /api/admin/orders                          — full order list (filterable, paginated)
GET /api/admin/orders/:orderNumber             — single order detail
GET /api/admin/dashboard/recent-orders         — latest orders for dashboard
GET /api/admin/dashboard/order-summary         — order counts by status
GET /api/admin/dashboard/stats                 — total revenue, order count, etc.
```

### Payments
Payments are embedded inside each order's detail response (`GET /api/admin/orders/:orderNumber`). There is no standalone payments list endpoint — payment data lives on the order.

### Layby (Installments)
```
GET /api/admin/layby/plans                     — all layby plans with status
GET /api/admin/layby/plans/:id                 — single plan with all installments and payment history
```

### Inventory
```
GET /api/admin/inventory                       — all products with stock levels
GET /api/admin/inventory/stats                 — low stock count, total SKUs, etc.
GET /api/admin/inventory/brands                — brands list
```

### Analytics / Charts
```
GET /api/admin/analytics                       — revenue, orders, customers over time
GET /api/admin/analytics/realtime              — live visitor/order counts
GET /api/admin/dashboard/best-selling          — top products by sales
GET /api/admin/dashboard/low-stock             — products running low
GET /api/admin/dashboard/top-customers         — highest spending customers
GET /api/admin/dashboard/charts/:type          — chart data (revenue, orders, etc.)
GET /api/admin/dashboard/layby-overview        — layby summary stats
```

---

## Changes to This App

### Step 1: Install JWT package

```bash
npm install jsonwebtoken
```

### Step 2: Add to `.env`

```env
JWT_SECRET=replace-with-64-char-hex
JWT_EXPIRES_IN=30d
```

Generate the secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 3: Add JWT support to the admin auth middleware

Edit `src/middlewares/auth.middleware.js`. Add `require('jsonwebtoken')` at the top and update `authenticateAdmin` to also accept a Bearer token:

At the top of the file, add:
```js
const jwt = require('jsonwebtoken');
```

Replace the `authenticateAdmin` function with:
```js
async function authenticateAdmin(req, res, next) {
    try {
        let admin = null;

        // JWT auth (Android / mobile)
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.slice(7);
            try {
                const payload = jwt.verify(token, process.env.JWT_SECRET);
                admin = await adminService.getAdminById(payload.adminId);
            } catch {
                return res.status(401).json({ success: false, message: 'Invalid or expired token', error: 'UNAUTHORIZED' });
            }
        } else {
            // Session auth (web browser)
            admin = await getAuthenticatedAdmin(req);
        }

        if (!admin) {
            return res.status(401).json({ success: false, message: 'Authentication required.', error: 'UNAUTHORIZED' });
        }

        req.admin = admin;
        next();
    } catch (error) {
        console.error('[Auth Middleware] Error in authenticateAdmin:', error);
        return res.status(500).json({ success: false, message: 'Authentication error occurred', error: 'INTERNAL_ERROR' });
    }
}
```

### Step 4: Skip CSRF for Bearer token requests

Edit `src/middlewares/csrf.middleware.js`. Find the block that validates the CSRF token on POST/PUT/DELETE/PATCH requests and add this bypass at the very start of that validation:

```js
// Skip CSRF for JWT-authenticated requests (Android app)
if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return next();
}
```

### Step 5: Add a mobile login endpoint

Create `src/routes/mobile.routes.js`:

```js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const adminService = require('../services/admin.service');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');

const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });

// POST /api/mobile/admin-login
router.post('/admin-login', loginLimit, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ success: false, message: 'Email and password required' });

        const admin = await adminService.getAdminByEmail(email.toLowerCase());
        if (!admin)
            return res.status(401).json({ success: false, message: 'Invalid credentials' });

        const valid = await bcrypt.compare(password, admin.passwordHash);
        if (!valid)
            return res.status(401).json({ success: false, message: 'Invalid credentials' });

        const token = jwt.sign(
            { adminId: admin.id },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
        );

        res.json({
            success: true,
            token,
            admin: { id: admin.id, email: admin.email, name: admin.name }
        });
    } catch (err) {
        console.error('[Mobile Login]', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
```

> **Note:** This assumes `adminService.getAdminByEmail()` exists. If it doesn't, check what method your admin service exposes and adjust — or look up the admin directly with `Admin.findOne({ where: { email } })`.

### Step 6: Register the route in `src/app.js`

Find where routes are mounted and add:

```js
const mobileRoutes = require('./routes/mobile.routes');
app.use('/api/mobile', mobileRoutes);
```

---

## Android App — What to Implement

### 1. Login

```
POST https://qualitickzm.com/api/mobile/admin-login
Content-Type: application/json

{ "email": "admin@qualitickzm.com", "password": "yourpassword" }
```

Response:
```json
{ "success": true, "token": "eyJ...", "admin": { "id": 1, "email": "..." } }
```

Store the token in `EncryptedSharedPreferences`. Send it on every request:

```
Authorization: Bearer eyJ...
```

If you get a `401` response, the token has expired — send the user back to the login screen.

### 2. Fetch Data Examples

**Recent orders:**
```
GET /api/admin/orders?limit=20&page=1
Authorization: Bearer <token>
```

**Single order (includes payment info):**
```
GET /api/admin/orders/ORD-12345
Authorization: Bearer <token>
```

**Layby plans:**
```
GET /api/admin/layby/plans
Authorization: Bearer <token>
```

**Layby plan detail (installments + payments):**
```
GET /api/admin/layby/plans/42
Authorization: Bearer <token>
```

**Inventory:**
```
GET /api/admin/inventory
Authorization: Bearer <token>
```

**Inventory stats (for dashboard card):**
```
GET /api/admin/inventory/stats
Authorization: Bearer <token>
```

**Sales analytics:**
```
GET /api/admin/analytics
Authorization: Bearer <token>
```

---

## Summary Checklist

### This App
- [ ] `npm install jsonwebtoken`
- [ ] Add `JWT_SECRET` and `JWT_EXPIRES_IN` to `.env`
- [ ] Update `authenticateAdmin` in `auth.middleware.js` to accept Bearer tokens
- [ ] Add CSRF bypass for Bearer token requests in `csrf.middleware.js`
- [ ] Create `src/routes/mobile.routes.js` with the admin login endpoint
- [ ] Register `/api/mobile` in `src/app.js`

### Android App
- [ ] POST to `/api/mobile/admin-login` to get token
- [ ] Store token in `EncryptedSharedPreferences`
- [ ] Send `Authorization: Bearer <token>` on every request
- [ ] Handle `401` by redirecting to login
- [ ] Consume orders, layby, inventory, and analytics endpoints listed above
