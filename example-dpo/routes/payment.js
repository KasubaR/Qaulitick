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

      return res.send(`
        <h2>✅ Payment Successful</h2>
        <p>Thank you! Your payment has been received.</p>
        <p>Reference: ${TransactionToken}</p>
        <a href="/">Back to home</a>
      `);
      // In production, redirect to a proper success page:
      // return res.redirect(`/invoices/${req.query.CompanyRef}?paid=1`);
    } else {
      return res.send(`
        <h2>⚠️ Payment Not Confirmed</h2>
        <p>Status: ${verification.explanation} (code ${verification.result})</p>
        <a href="/">Try again</a>
      `);
    }
  } catch (err) {
    console.error("[DPO] verify error:", err.message);
    return res.status(500).send("Payment verification failed. Please contact support.");
  }
});

// ─── GET /payment/cancelled ───────────────────────────────────────────────────
// DPO redirects here if the customer clicks Back / Cancel.

router.get("/cancelled", (req, res) => {
  return res.send(`
    <h2>❌ Payment Cancelled</h2>
    <p>You cancelled the payment. No money was deducted.</p>
    <a href="/">Go back</a>
  `);
  // In production: res.redirect("/invoices?cancelled=1");
});

module.exports = router;
