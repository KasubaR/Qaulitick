/**
 * DPO Pay (Direct Pay Online) — XML API integration.
 * @see https://secure.3gdirectpay.com/API/v6/ (createToken / verifyToken)
 */

const https = require('https');
const { parseStringPromise } = require('xml2js');

function escapeXml(text) {
    if (text == null || text === '') return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function getApiBaseUrl() {
    const url = process.env.DPO_API_BASE_URL || 'https://secure.3gdirectpay.com/API/v6/';
    return url.endsWith('/') ? url : `${url}/`;
}

function getPaymentPageBase() {
    return (
        process.env.DPO_PAYMENT_PAGE_URL ||
        'https://secure.3gdirectpay.com/payv2.php'
    ).replace(/\?.*$/, '');
}

function getCompanyToken() {
    const t = process.env.DPO_COMPANY_TOKEN;
    if (!t || !String(t).trim()) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('DPO_COMPANY_TOKEN is required in production');
        }
        throw new Error('DPO_COMPANY_TOKEN is not configured');
    }
    return String(t).trim();
}

function getDefaultServiceType() {
    const s = process.env.DPO_SERVICE_TYPE;
    if (s && String(s).trim()) return String(s).trim();
    if (process.env.NODE_ENV !== 'production') return '54841';
    throw new Error('DPO_SERVICE_TYPE is not configured');
}

function getCompanyRefUnique() {
    const raw = process.env.DPO_COMPANY_REF_UNIQUE;
    if (raw === '0' || raw === '1') return raw;
    return '1';
}

function getPtlAndType() {
    const ptl = parseInt(String(process.env.DPO_PTL || '24'), 10);
    const ptlType = String(process.env.DPO_PTL_TYPE || 'hours').toLowerCase();
    const type = ptlType === 'minutes' ? 'minutes' : 'hours';
    const safePtl = Number.isFinite(ptl) && ptl > 0 ? ptl : 24;
    return { ptl: safePtl, ptlType: type };
}

function postToApi(xmlBody) {
    return new Promise((resolve, reject) => {
        const base = getApiBaseUrl();
        const url = new URL(base);
        const postData = Buffer.from(xmlBody, 'utf8');

        const options = {
            hostname: url.hostname,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/xml',
                'Content-Length': postData.length,
                'User-Agent': 'Mozilla/5.0 (compatible; QualitickCollections/1.0)'
            }
        };

        const req = https.request(options, (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                raw += chunk;
            });
            res.on('end', async () => {
                try {
                    const parsed = await parseStringPromise(raw, {
                        explicitArray: false,
                        ignoreAttrs: true
                    });
                    resolve(parsed.API3G);
                } catch (err) {
                    reject(new Error(`XML parse error: ${err.message}`));
                }
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

/**
 * Map DPO verifyToken Result code to structured outcome (plan-aligned).
 * @param {string} result
 * @param {string} [explanation]
 */
function mapVerifyOutcome(result, explanation = '') {
    const code = result != null ? String(result).trim() : '';
    const expl = explanation != null ? String(explanation) : '';

    if (code === '000') {
        return {
            paid: true,
            terminal: true,
            kind: 'paid',
            success: true,
            result: code,
            explanation: expl
        };
    }
    if (code === '001') {
        return {
            paid: false,
            terminal: false,
            kind: 'authorized_pending',
            success: true,
            result: code,
            explanation: expl
        };
    }
    if (code === '002') {
        return {
            paid: false,
            terminal: false,
            kind: 'pending',
            success: true,
            result: code,
            explanation: expl
        };
    }
    if (code === '003') {
        return {
            paid: false,
            terminal: true,
            kind: 'expired_or_missing',
            success: true,
            result: code,
            explanation: expl
        };
    }
    if (code === '004') {
        return {
            paid: false,
            terminal: true,
            kind: 'cancelled',
            success: true,
            result: code,
            explanation: expl
        };
    }
    if (code.startsWith('90')) {
        const is903 = code === '903';
        return {
            paid: false,
            terminal: true,
            kind: is903 ? 'ptl_expired' : 'gateway_error',
            success: false,
            result: code,
            explanation: expl
        };
    }
    return {
        paid: false,
        terminal: false,
        kind: 'unknown',
        success: false,
        result: code || 'unknown',
        explanation: expl
    };
}

/**
 * @param {object} params
 * @returns {Promise<{ token: string, transRef: string|null, paymentUrl: string, companyRef: string }>}
 */
async function createToken(params) {
    const {
        amount,
        currency = 'ZMW',
        companyRef,
        redirectUrl,
        backUrl,
        serviceType = getDefaultServiceType(),
        serviceDesc = 'Qualitick Collections Payment',
        customerEmail = '',
        customerFirst = '',
        customerLast = ''
    } = params;

    if (!amount || !companyRef || !redirectUrl || !backUrl) {
        throw new Error('createToken: amount, companyRef, redirectUrl and backUrl are required.');
    }

    const companyToken = getCompanyToken();
    const { ptl, ptlType } = getPtlAndType();
    const companyRefUnique = getCompanyRefUnique();

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const serviceDate = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<API3G>
  <CompanyToken>${escapeXml(companyToken)}</CompanyToken>
  <Request>createToken</Request>
  <Transaction>
    <PaymentAmount>${escapeXml(amount)}</PaymentAmount>
    <PaymentCurrency>${escapeXml(currency)}</PaymentCurrency>
    <CompanyRef>${escapeXml(companyRef)}</CompanyRef>
    <RedirectURL>${escapeXml(redirectUrl)}</RedirectURL>
    <BackURL>${escapeXml(backUrl)}</BackURL>
    <CompanyRefUnique>${companyRefUnique}</CompanyRefUnique>
    <PTL>${ptl}</PTL>
    <PTLtype>${ptlType}</PTLtype>
    ${customerEmail ? `<customerEmail>${escapeXml(customerEmail)}</customerEmail>` : ''}
    ${customerFirst ? `<customerFirstName>${escapeXml(customerFirst)}</customerFirstName>` : ''}
    ${customerLast ? `<customerLastName>${escapeXml(customerLast)}</customerLastName>` : ''}
  </Transaction>
  <Services>
    <Service>
      <ServiceType>${escapeXml(serviceType)}</ServiceType>
      <ServiceDescription>${escapeXml(serviceDesc)}</ServiceDescription>
      <ServiceDate>${escapeXml(serviceDate)}</ServiceDate>
    </Service>
  </Services>
</API3G>`;

    const response = await postToApi(xml);

    if (response.Result !== '000') {
        throw new Error(
            `createToken failed [${response.Result}]: ${response.ResultExplanation || 'unknown'}`
        );
    }

    const token = response.TransToken;
    if (!token) {
        throw new Error('createToken: missing TransToken in response');
    }

    const paymentPageBase = getPaymentPageBase();
    const paymentUrl = `${paymentPageBase}?ID=${encodeURIComponent(token)}`;

    return {
        token,
        transRef: response.TransRef || null,
        paymentUrl,
        companyRef,
        ptl,
        ptlType,
        serviceDate
    };
}

/**
 * @param {string} transactionToken
 * @returns {Promise<{ outcome: object, raw: object }>}
 */
async function verifyToken(transactionToken) {
    if (!transactionToken) {
        throw new Error('verifyToken: transactionToken is required.');
    }

    const companyToken = getCompanyToken();

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<API3G>
  <CompanyToken>${escapeXml(companyToken)}</CompanyToken>
  <Request>verifyToken</Request>
  <TransactionToken>${escapeXml(transactionToken)}</TransactionToken>
</API3G>`;

    const response = await postToApi(xml);
    const result = response.Result != null ? String(response.Result).trim() : '';
    const explanation = response.ResultExplanation != null ? String(response.ResultExplanation) : '';

    const outcome = mapVerifyOutcome(result, explanation);

    return {
        outcome,
        raw: response,
        legacyPaid: outcome.paid
    };
}

module.exports = {
    createToken,
    verifyToken,
    mapVerifyOutcome,
    escapeXml,
    getApiBaseUrl,
    getPaymentPageBase,
    getPtlAndType
};
