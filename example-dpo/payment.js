/**
 * DPO Pay – Express Routes
 * Qualitick Collections
 *
 * Mount in app.js with:
 *   app.use("/payment", require("./routes/payment"));
 */

const express = require("express");
const router = express.Router();
const { createToken, verifyToken } = require("../services/dpoService");

// ─── Shared status page template ─────────────────────────────────────────────
function statusPage({ icon, iconBg, title, body, link }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} – Qualitick Collections</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f0f4f8;
      font-family: 'Segoe UI', system-ui, sans-serif;
      color: #1a202c;
    }
    .card {
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      padding: 48px 36px;
      width: 100%;
      max-width: 400px;
      text-align: center;
    }
    .icon-wrap {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: ${iconBg};
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
    }
    .icon-wrap svg { width: 36px; height: 36px; }
    h2 { font-size: 22px; font-weight: 700; margin-bottom: 12px; }
    p  { font-size: 15px; color: #4a5568; line-height: 1.6; margin-bottom: 8px; }
    .ref { font-size: 13px; color: #718096; }
    .btn {
      display: inline-block;
      margin-top: 28px;
      padding: 11px 28px;
      background: #4f46e5;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      border-radius: 8px;
      text-decoration: none;
      transition: background 0.2s;
    }
    .btn:hover { background: #4338ca; }
    .brand {
      margin-top: 32px;
      font-size: 12px;
      color: #a0aec0;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-wrap">${icon}</div>
    <h2>${title}</h2>
    ${body}
    <a href="${link.href}" class="btn">${link.label}</a>
    <p class="brand">Qualitick Collections</p>
  </div>
</body>
</html>`;
}

// ─── POST /payment/initiate ───────────────────────────────────────────────────
// Called from your checkout/invoice page to start a payment.
// Returns the DPO payment URL; your frontend redirects the customer there.
//
// Body (JSON):
//   { amount, currency, companyRef, customerEmail, customerFirst, customerLast }

router.post("/initiate", async (req, res) => {
  try {
    const {
      amount,
      currency = "ZMW",
      companyRef,
      customerEmail,
      customerFirst,
      customerLast,
      serviceDesc,
    } = req.body;

    if (!amount || !companyRef) {
      return res.status(400).json({ error: "amount and companyRef are required." });
    }

    const result = await createToken({
      amount: parseFloat(amount).toFixed(2),
      currency,
      companyRef,
      redirectUrl: `${process.env.APP_URL}/payment/success`,
      backUrl: `${process.env.APP_URL}/payment/cancelled`,
      serviceDesc,
      customerEmail,
      customerFirst,
      customerLast,
    });

    // Option A: return the URL and let the frontend redirect
    return res.json({
      success: true,
      token: result.token,
      paymentUrl: result.paymentUrl,
    });

    // Option B (server-side redirect): uncomment the line below instead
    // return res.redirect(result.paymentUrl);
  } catch (err) {
    console.error("[DPO] initiate error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /payment/success ─────────────────────────────────────────────────────
// DPO redirects here after the customer completes payment.
// Query params from DPO: ?TransID=...&CCDapproval=...&PnrID=...&TransactionToken=...

router.get("/success", async (req, res) => {
  const { TransactionToken } = req.query;

  if (!TransactionToken) {
    return res.status(400).send("Missing transaction token.");
  }

  try {
    const verification = await verifyToken(TransactionToken);

    if (verification.paid) {
      // ── Payment confirmed ──
      // TODO: mark invoice/order as paid in your database here
      // e.g. await Invoice.markPaid(req.query.CompanyRef);

      return res.send(statusPage({
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-5"/></svg>`,
        iconBg: "#f0fdf4",
        title: "Payment Successful",
        body: `<p>Thank you! Your payment has been received.</p><p class="ref">Reference: <strong>${TransactionToken}</strong></p>`,
        link: { href: "/", label: "Back to home" },
      }));
      // In production, redirect to a proper success page:
      // return res.redirect(`/invoices/${req.query.CompanyRef}?paid=1`);
    } else {
      return res.send(statusPage({
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>`,
        iconBg: "#fffbeb",
        title: "Payment Not Confirmed",
        body: `<p>Status: ${verification.explanation} (code ${verification.result})</p>`,
        link: { href: "/", label: "Try again" },
      }));
    }
  } catch (err) {
    console.error("[DPO] verify error:", err.message);
    return res.status(500).send("Payment verification failed. Please contact support.");
  }
});

// ─── GET /payment/cancelled ───────────────────────────────────────────────────
// DPO redirects here if the customer clicks Back / Cancel.

router.get("/cancelled", (req, res) => {
  return res.send(statusPage({
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>`,
    iconBg: "#fff5f5",
    title: "Payment Cancelled",
    body: `<p>You cancelled the payment. No money was deducted.</p>`,
    link: { href: "/", label: "Go back" },
  }));
  // In production: res.redirect("/invoices?cancelled=1");
});

module.exports = router;
