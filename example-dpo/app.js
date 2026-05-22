/**
 * app.js – Qualitick Collections (DPO Pay integration example)
 *
 * Run:  node app.js
 * Test: POST http://localhost:3000/payment/initiate
 */

require("dotenv").config();
const express = require("express");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── DPO payment routes ──
app.use("/payment", require("./routes/payment"));

// ── Basic home route ──
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Qualitick Collections – Pay</title>
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
          background: #ffffff;
          border-radius: 16px;
          box-shadow: 0 4px 24px rgba(0,0,0,0.08);
          padding: 40px 36px;
          width: 100%;
          max-width: 420px;
        }

        .card-header {
          text-align: center;
          margin-bottom: 32px;
        }

        .card-header .logo {
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #718096;
          margin-bottom: 8px;
        }

        .card-header h1 {
          font-size: 22px;
          font-weight: 700;
          color: #1a202c;
        }

        .form-group {
          margin-bottom: 20px;
        }

        .form-group label {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: #4a5568;
          margin-bottom: 6px;
          letter-spacing: 0.03em;
        }

        .form-group input {
          width: 100%;
          padding: 11px 14px;
          border: 1.5px solid #e2e8f0;
          border-radius: 8px;
          font-size: 15px;
          color: #1a202c;
          background: #f7fafc;
          transition: border-color 0.2s, box-shadow 0.2s;
          outline: none;
        }

        .form-group input:focus {
          border-color: #4f46e5;
          background: #fff;
          box-shadow: 0 0 0 3px rgba(79,70,229,0.12);
        }

        .btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          padding: 13px;
          margin-top: 8px;
          background: #4f46e5;
          color: #fff;
          font-size: 15px;
          font-weight: 600;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.2s, transform 0.1s;
        }

        .btn:hover  { background: #4338ca; }
        .btn:active { transform: scale(0.98); }

        .btn:disabled {
          background: #a5b4fc;
          cursor: not-allowed;
          transform: none;
        }

        .btn .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255,255,255,0.4);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
          display: none;
        }

        .btn.loading .spinner { display: block; }
        .btn.loading .btn-text { opacity: 0.8; }

        @keyframes spin { to { transform: rotate(360deg); } }

        .error-msg {
          display: none;
          background: #fff5f5;
          border: 1px solid #fed7d7;
          color: #c53030;
          border-radius: 8px;
          padding: 10px 14px;
          font-size: 13px;
          margin-top: 16px;
        }

        .secure-note {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin-top: 20px;
          font-size: 12px;
          color: #a0aec0;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="card-header">
          <p class="logo">Qualitick Collections</p>
          <h1>Complete Payment</h1>
        </div>

        <form onsubmit="event.preventDefault(); initiatePayment()">
          <div class="form-group">
            <label for="amount">Amount (ZMW)</label>
            <input id="amount" type="number" step="0.01" min="0.01" value="150.00" placeholder="0.00" required />
          </div>
          <div class="form-group">
            <label for="ref">Invoice Reference</label>
            <input id="ref" type="text" value="INV-001" placeholder="INV-001" required />
          </div>
          <div class="form-group">
            <label for="email">Customer Email</label>
            <input id="email" type="email" value="test@example.com" placeholder="you@example.com" required />
          </div>

          <button type="submit" class="btn" id="payBtn">
            <div class="spinner"></div>
            <span class="btn-text">Pay with DPO</span>
          </button>

          <div class="error-msg" id="errorMsg"></div>
        </form>

        <p class="secure-note">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          Secured by DPO Pay
        </p>
      </div>

      <script>
        async function initiatePayment() {
          const btn = document.getElementById("payBtn");
          const errEl = document.getElementById("errorMsg");

          btn.disabled = true;
          btn.classList.add("loading");
          errEl.style.display = "none";

          try {
            const res = await fetch("/payment/initiate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                amount: document.getElementById("amount").value,
                companyRef: document.getElementById("ref").value,
                customerEmail: document.getElementById("email").value,
              })
            });
            const data = await res.json();
            if (data.paymentUrl) {
              window.location.href = data.paymentUrl;
            } else {
              throw new Error(data.error || "Unknown error");
            }
          } catch (err) {
            errEl.textContent = "Payment failed: " + err.message;
            errEl.style.display = "block";
            btn.disabled = false;
            btn.classList.remove("loading");
          }
        }
      </script>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Qualitick Collections server running on http://localhost:${PORT}`);
  console.log(`DPO payment route: POST http://localhost:${PORT}/payment/initiate`);
});
