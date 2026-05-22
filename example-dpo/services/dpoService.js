/**
 * DPO Pay (Direct Pay Online) Integration Service
 * Qualitick Collections – Node.js / Express
 *
 * API Endpoint : https://secure.3gdirectpay.com/API/v6/
 * Payment URL  : https://secure.3gdirectpay.com/payv3.php?ID={token}
 */

const https = require("https");
const { parseStringPromise } = require("xml2js");

// ─── Config ──────────────────────────────────────────────────────────────────

const DPO_CONFIG = {
  apiUrl: "https://secure.3gdirectpay.com/API/v6/",
  paymentUrl: "https://secure.3gdirectpay.com/payv3.php",

  // Test credentials – replace with live values after DPO account approval
  companyToken: process.env.DPO_COMPANY_TOKEN || "B3F59BE7-0756-420E-BB88-1D98E7A6B040",
  defaultServiceType: process.env.DPO_SERVICE_TYPE || "54841", // 54841 = Test Product
};

// ─── Internal: POST XML to DPO API ───────────────────────────────────────────

function postToApi(xmlBody) {
  return new Promise((resolve, reject) => {
    const url = new URL(DPO_CONFIG.apiUrl);
    const postData = Buffer.from(xmlBody, "utf8");

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/xml",
        "Content-Length": postData.length,
        "User-Agent": "Mozilla/5.0 (compatible; QualitickCollections/1.0)",
      },
    };

    const req = https.request(options, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", async () => {
        try {
          const parsed = await parseStringPromise(raw, {
            explicitArray: false,
            ignoreAttrs: true,
          });
          resolve(parsed.API3G);
        } catch (err) {
          reject(new Error(`XML parse error: ${err.message}\nRaw response: ${raw}`));
        }
      });
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

// ─── 1. createToken ───────────────────────────────────────────────────────────

/**
 * Step 1: Create a DPO payment token.
 *
 * @param {object} params
 * @param {string}  params.amount          Payment amount e.g. "150.00"
 * @param {string}  params.currency        ISO code e.g. "ZMW" or "USD"
 * @param {string}  params.companyRef      Your internal invoice / order reference
 * @param {string}  params.redirectUrl     DPO redirects here after successful payment
 * @param {string}  params.backUrl         DPO redirects here if customer cancels
 * @param {string}  [params.serviceType]   Override default service type
 * @param {string}  [params.serviceDesc]   Description shown on DPO payment page
 * @param {string}  [params.customerEmail]
 * @param {string}  [params.customerFirst]
 * @param {string}  [params.customerLast]
 * @param {number}  [params.ptl]           Payment time limit in hours (default 5)
 *
 * @returns {Promise<{token: string, paymentUrl: string, transRef: string}>}
 */
async function createToken(params) {
  const {
    amount,
    currency = "ZMW",
    companyRef,
    redirectUrl,
    backUrl,
    serviceType = DPO_CONFIG.defaultServiceType,
    serviceDesc = "Qualitick Collections Payment",
    customerEmail = "",
    customerFirst = "",
    customerLast = "",
    ptl = 5,
  } = params;

  if (!amount || !companyRef || !redirectUrl || !backUrl) {
    throw new Error("createToken: amount, companyRef, redirectUrl and backUrl are required.");
  }

  // DPO expects date in format: YYYY/MM/DD HH:MM
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const serviceDate = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<API3G>
  <CompanyToken>${DPO_CONFIG.companyToken}</CompanyToken>
  <Request>createToken</Request>
  <Transaction>
    <PaymentAmount>${amount}</PaymentAmount>
    <PaymentCurrency>${currency}</PaymentCurrency>
    <CompanyRef>${companyRef}</CompanyRef>
    <RedirectURL>${redirectUrl}</RedirectURL>
    <BackURL>${backUrl}</BackURL>
    <CompanyRefUnique>0</CompanyRefUnique>
    <PTL>${ptl}</PTL>
    ${customerEmail ? `<customerEmail>${customerEmail}</customerEmail>` : ""}
    ${customerFirst ? `<customerFirstName>${customerFirst}</customerFirstName>` : ""}
    ${customerLast ? `<customerLastName>${customerLast}</customerLastName>` : ""}
  </Transaction>
  <Services>
    <Service>
      <ServiceType>${serviceType}</ServiceType>
      <ServiceDescription>${serviceDesc}</ServiceDescription>
      <ServiceDate>${serviceDate}</ServiceDate>
    </Service>
  </Services>
</API3G>`;

  const response = await postToApi(xml);

  if (response.Result !== "000") {
    throw new Error(`createToken failed [${response.Result}]: ${response.ResultExplanation}`);
  }

  const token = response.TransToken;
  return {
    token,
    transRef: response.TransRef || null,
    paymentUrl: `${DPO_CONFIG.paymentUrl}?ID=${token}`,
  };
}

// ─── 2. verifyToken ───────────────────────────────────────────────────────────

/**
 * Step 3: Verify whether a DPO token has been paid.
 * Call this when the customer returns to your redirectUrl.
 * Must be called within 30 minutes of payment or DPO sends an alert.
 *
 * Result codes:
 *   000 – Transaction paid          ✅
 *   001 – Transaction pre-auth
 *   002 – Transaction failed        ❌
 *   003 – Token expired / not found ❌
 *   004 – Transaction cancelled     ❌
 *
 * @param {string} transactionToken – Token returned by createToken
 * @returns {Promise<{paid: boolean, result: string, explanation: string, raw: object}>}
 */
async function verifyToken(transactionToken) {
  if (!transactionToken) {
    throw new Error("verifyToken: transactionToken is required.");
  }

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<API3G>
  <CompanyToken>${DPO_CONFIG.companyToken}</CompanyToken>
  <Request>verifyToken</Request>
  <TransactionToken>${transactionToken}</TransactionToken>
</API3G>`;

  const response = await postToApi(xml);

  return {
    paid: response.Result === "000",
    result: response.Result,
    explanation: response.ResultExplanation,
    raw: response,
  };
}

module.exports = { createToken, verifyToken, DPO_CONFIG };
