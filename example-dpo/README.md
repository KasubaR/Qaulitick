# DPO Pay Integration – Qualitick Collections (Node.js)

## Overview

This integration connects Qualitick Collections to **DPO Pay (Direct Pay Online)**
using the v6 XML API. The flow has three steps:

```
1. POST /payment/initiate  →  createToken (your server → DPO API)
2. Redirect customer       →  https://secure.3gdirectpay.com/payv3.php?ID={token}
3. GET  /payment/success   →  verifyToken (your server → DPO API) ← DPO redirects here
```

---

## Files

| File | Purpose |
|------|---------|
| `services/dpoService.js` | Core DPO API logic (createToken + verifyToken) |
| `routes/payment.js` | Express routes (/initiate, /success, /cancelled) |
| `app.js` | Example Express app wiring everything together |
| `.env.example` | Environment variables template |

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:
- Set `APP_URL` to your server's public URL (e.g. `https://qualitick.com`)
- Use the test credentials provided by DPO during testing
- Replace with live credentials after DPO approves your account

### 3. Run the server

```bash
npm start
# or for development with auto-reload:
npm run dev
```

---

## API Routes

### `POST /payment/initiate`

Start a payment. Call this from your invoice/checkout page.

**Request body (JSON):**
```json
{
  "amount": "150.00",
  "currency": "ZMW",
  "companyRef": "INV-001",
  "customerEmail": "customer@example.com",
  "customerFirst": "John",
  "customerLast": "Banda",
  "serviceDesc": "Invoice INV-001"
}
```

**Response:**
```json
{
  "success": true,
  "token": "72983CAC-5DB1-4C7F-BD88-352066B71592",
  "paymentUrl": "https://secure.3gdirectpay.com/payv3.php?ID=72983CAC-..."
}
```

Then redirect the customer to `paymentUrl`.

---

### `GET /payment/success`

DPO redirects customers here after payment. The route automatically calls
`verifyToken` to confirm the payment. **You must verify within 30 minutes**
or DPO sends an alert email to your account.

Query params sent by DPO:
- `TransactionToken` – the token to verify
- `TransID` – DPO's internal transaction ID
- `CCDapproval` – approval code (card payments)

---

### `GET /payment/cancelled`

DPO redirects here if the customer clicks Back or Cancel. No charge occurs.

---

## Test Credentials

| Company Token | Service Types |
|---------------|--------------|
| `B3F59BE7-0756-420E-BB88-1D98E7A6B040` | 54841 (Product), 85325 (Service) |
| `C40E4138-3DF7-4A56-A6D1-375A49407A1C` | 54842 (Product), 86275 (Service) |
| `8BB9CF9A-6E89-4E78-828F-088D5A000269` | 54843 (Product), 86277 (Service) |
| `732CDD7C-34B3-4506-ACF6-B03F94FB44C8` | 54844 (Product), 86278 (Service) |
| `8E0F3AD8-B254-419A-80DF-6D9C280A5130` | 54845 (Product), 86280 (Service) |
| `8D3DA73D-9D7F-4E09-96D4-3D44E7A83EA3` | 3854 (Product),  5525 (Service)  |

**Test card:** Any card number, expiry `01/26`

**Mobile Money:** Confirm you receive a push prompt — do NOT approve it.

---

## verifyToken Result Codes

| Code | Meaning |
|------|---------|
| `000` | ✅ Transaction paid |
| `001` | Transaction pre-authorised |
| `002` | ❌ Transaction failed |
| `003` | ❌ Token expired or not found |
| `004` | ❌ Transaction cancelled |

---

## Going Live

1. Replace `DPO_COMPANY_TOKEN` and `DPO_SERVICE_TYPE` in `.env` with your live credentials
2. Ensure `APP_URL` points to your production domain with HTTPS
3. Update `redirectUrl` and `backUrl` in `routes/payment.js` if needed
4. Add database calls in `/payment/success` to mark invoices as paid

---

## Integrating into Existing Express App

If you already have an Express app, just do:

```js
// In your main app.js / server.js
const { createToken, verifyToken } = require("./services/dpoService");
app.use("/payment", require("./routes/payment"));
```

Make sure `xml2js` and `dotenv` are in your dependencies.
