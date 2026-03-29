# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash

npm run seed       # Seed database with sample data
npm run seed:admin # Seed admin user
```

No test runner or linter is configured.

## Architecture Overview

**Qualitick Collections** is a luxury watch e-commerce platform built with Node.js/Express, MySQL/Sequelize, and EJS templating.

### Request Flow

```
server.js → src/app.js → middleware pipeline → routes → controllers → services → models
```

`server.js` bootstraps the app: connects the DB first, then initializes the email transporter and scheduler service, then starts the Express server.

### Key Architectural Decisions

**Mongoose Compatibility Layer** — Models are Sequelize-based but wrapped with Mongoose-style methods (`.findById()`, `.findByIdAndUpdate()`, `.lean()`, `.sort()`, etc.) in `src/models/index.js`. This was done during a Mongoose → Sequelize migration. When adding new model methods, follow this pattern.

**Session Storage** — Uses Sequelize session store (`connect-session-sequelize`), not Redis, despite `redis.store.js` existing as a legacy artifact.

**CSRF Protection** — All mutating routes (POST/PUT/DELETE) require a CSRF token. The token is injected into EJS templates via `res.locals.csrfToken` and must be included in forms/AJAX requests.

**Raw Body Preservation** — The Lenco payment webhook uses HMAC signature verification. Body parser is configured to capture the raw buffer on `/api/payments/lenco/webhook` before JSON parsing — do not change this middleware ordering.

### Route Organization

- **Admin routes** (`src/routes/admin.routes.js`): Protected by `requireAdminAuth`. Admin login requires a secret token query param (`?secret=TOKEN` from `.env`).
- **Storefront routes** (`src/routes/storefront.routes.js`): Mix of public and customer-authenticated endpoints.
- Separate route files for payment, cart, order, product, and marketing.

### Payment Flow (Lenco)

1. Order created → Lenco payment link generated via `src/services/lenco.service.js`
2. Customer pays externally
3. Lenco POSTs to webhook → HMAC verified → order/payment status updated
4. Confirmation email sent via `src/services/email.service.js`

### Layby (Installment) System

Configured in `src/config/layby.js`. Min deposit is 30%, plan period 90 days. Uses three linked models: `Order` → `LaybyPlan` → `LaybyPayment` (each installment) + `Payment` (actual payment records).

### Email Service

`src/services/email.service.js` tries cPanel SMTP first, falls back to Gmail. Both configured via `.env`. The `APP_PUBLIC_URL` env var is used to generate links in emails.

### Caching Strategy

- Product API responses: 5-minute HTTP cache (`cacheMiddleware`)
- Static images: 1-year immutable cache
- HTML pages: no-store

### Environment Variables

Copy `.env` and configure:
- `DB_HOST/DB_USER/DB_PASS/DB_NAME` — MySQL connection
- `SESSION_SECRET` — 64-char hex for production
- `ADMIN_SECRET_TOKEN` — appended to `/admin/login?secret=` URL
- `LENCO_SECRET_KEY` / `LENCO_PUBLIC_KEY` / `LENCO_WEBHOOK_SECRET` — payment gateway
- `SMTP_HOST/SMTP_USER/SMTP_PASS` — primary email (cPanel)
- `APP_PUBLIC_URL` — base URL used in email links (e.g., `https://qualitickzm.com`)
