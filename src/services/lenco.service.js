// Lenco Payment Gateway Service
// Handles all interactions with Lenco payment API
//
// TODO: Request Signing
// If Lenco ever requires request signing for their Collections API, implement it here.
// Common patterns: HMAC-SHA256, JWT, etc.
// Reference: Lenco API documentation (check for signing requirements in future API versions)

const axios = require('axios');
const crypto = require('crypto');

const logger = require('../utils/logger').child({ module: 'LencoService' });

function log(level, message, data = {}) {
    const fn = logger[level] ?? logger.info;
    fn.call(logger, data, message);
}

/**
 * Retry Configuration
 */
const RETRY_CONFIG = {
    maxRetries: 3,
    initialDelay: 1000, // 1 second
    maxDelay: 10000, // 10 seconds
    backoffMultiplier: 2
};

/**
 * Sleep utility for retry delays
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate retry delay with exponential backoff
 */
function calculateRetryDelay(attempt) {
    const delay = Math.min(
        RETRY_CONFIG.initialDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
        RETRY_CONFIG.maxDelay
    );
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.3 * delay;
    return delay + jitter;
}

/**
 * Check if error is retryable
 */
function isRetryableError(error) {
    // Network errors (no response)
    if (!error.response) {
        return true;
    }
    
    // 5xx server errors
    if (error.response.status >= 500 && error.response.status < 600) {
        return true;
    }
    
    // 429 Too Many Requests
    if (error.response.status === 429) {
        return true;
    }
    
    // 408 Request Timeout
    if (error.response.status === 408) {
        return true;
    }
    
    return false;
}

/**
 * Parse Lenco API Error Response
 */
function parseApiError(error) {
    const errorData = {
        type: 'unknown',
        message: 'An unknown error occurred',
        code: null,
        details: null,
        retryable: false
    };
    
    // Network error (no response)
    if (!error.response) {
        errorData.type = 'network_error';
        errorData.message = error.message || 'Network error: Unable to reach Lenco API';
        errorData.retryable = true;
        return errorData;
    }
    
    // HTTP error response
    const status = error.response.status;
    const responseData = error.response.data || {};
    
    errorData.code = status;
    errorData.retryable = isRetryableError(error);
    
    // Parse error message from Lenco API response format
    // Lenco uses: { status: boolean, message: string, data: object }
    if (responseData.message) {
        errorData.message = responseData.message;
    } else if (responseData.error) {
        errorData.message = typeof responseData.error === 'string' 
            ? responseData.error 
            : responseData.error.message || 'API error';
    } else if (responseData.errors) {
        // Handle errorCode and errors mapping from Lenco
        if (typeof responseData.errors === 'object' && !Array.isArray(responseData.errors)) {
            // Lenco errors format: { errorCode: "01", errorMessage: "..." }
            const errorMessages = Object.values(responseData.errors)
                .map(err => err.errorMessage || err.message || JSON.stringify(err))
                .filter(Boolean);
            errorData.message = errorMessages.join(', ') || 'API error';
        } else if (Array.isArray(responseData.errors)) {
            errorData.message = responseData.errors.join(', ');
        } else {
            errorData.message = JSON.stringify(responseData.errors);
        }
    }
    
    // Check for Lenco errorCode
    if (responseData.errorCode) {
        errorData.errorCode = responseData.errorCode;
    }
    
    // Add error type based on status code
    if (status === 400) {
        errorData.type = 'validation_error';
        errorData.message = errorData.message || 'Invalid request parameters';
    } else if (status === 401) {
        errorData.type = 'authentication_error';
        errorData.message = errorData.message || 'Authentication failed';
    } else if (status === 403) {
        errorData.type = 'authorization_error';
        errorData.message = errorData.message || 'Access forbidden';
    } else if (status === 404) {
        errorData.type = 'not_found_error';
        errorData.message = errorData.message || 'Resource not found';
    } else if (status === 429) {
        errorData.type = 'rate_limit_error';
        errorData.message = errorData.message || 'Rate limit exceeded';
    } else if (status >= 500) {
        errorData.type = 'server_error';
        errorData.message = errorData.message || 'Lenco server error';
    }
    
    // Include full response data for debugging
    errorData.details = {
        status,
        statusText: error.response.statusText,
        data: responseData,
        headers: error.response.headers
    };
    
    return errorData;
}

/**
 * Make API request with retry logic
 */
async function makeApiRequest(config, retryCount = 0) {
    try {
        log('info', 'API Request', {
            method: config.method || 'GET',
            url: config.url,
            retryAttempt: retryCount,
            orderNumber: config.metadata?.orderNumber,
            transactionId: config.metadata?.transactionId
        });
        
        const response = await lencoAxiosInstance(config);
        
        log('info', 'API Response', {
            method: config.method || 'GET',
            url: config.url,
            status: response.status,
            transactionId: response.data?.transactionId || response.data?.id,
            orderNumber: config.metadata?.orderNumber
        });
        
        return response;
    } catch (error) {
        const errorData = parseApiError(error);
        
        log('error', 'API Request Failed', {
            method: config.method || 'GET',
            url: config.url,
            error: errorData,
            retryAttempt: retryCount,
            orderNumber: config.metadata?.orderNumber
        });
        
        // Retry logic
        if (errorData.retryable && retryCount < RETRY_CONFIG.maxRetries) {
            const delay = calculateRetryDelay(retryCount);
            
            log('warn', 'Retrying API Request', {
                method: config.method || 'GET',
                url: config.url,
                retryAttempt: retryCount + 1,
                maxRetries: RETRY_CONFIG.maxRetries,
                delayMs: delay,
                orderNumber: config.metadata?.orderNumber
            });
            
            await sleep(delay);
            return makeApiRequest(config, retryCount + 1);
        }
        
        // Create enhanced error
        const enhancedError = new Error(errorData.message);
        enhancedError.name = errorData.type;
        enhancedError.code = errorData.code;
        enhancedError.retryable = errorData.retryable;
        enhancedError.details = errorData.details;
        
        throw enhancedError;
    }
}

/**
 * Validate API Response
 * Lenco API response format: { status: boolean, message: string, data: object }
 */
function validateApiResponse(response, expectedFields = []) {
    if (!response || !response.data) {
        throw new Error('Invalid response: Response or response.data is missing');
    }
    
    const responseData = response.data;
    
    // Lenco uses 'status' (boolean) not 'success'
    // Check if status is false (even with 200 status code)
    if (responseData.status === false) {
        const errorMessage = responseData.message || 'API returned status: false';
        log('error', 'Lenco API returned status: false', {
            message: responseData.message,
            errorCode: responseData.errorCode,
            errors: responseData.errors
        });
        throw new Error(errorMessage);
    }
    
    // Extract data from response.data.data (Lenco wraps results in 'data' key)
    const data = responseData.data || responseData;
    
    // Validate expected fields if provided
    if (expectedFields.length > 0) {
        const missingFields = expectedFields.filter(field => !(field in data));
        if (missingFields.length > 0) {
            log('warn', 'Response missing expected fields', {
                missingFields,
                receivedFields: Object.keys(data),
                fullResponse: responseData
            });
        }
    }
    
    return true;
}

/**
 * Lenco Payment Service
 * 
 * Provides functions for:
 * - Initiating mobile money payments
 * - Initiating bank transfers
 * - Verifying payment status
 * - Handling webhook callbacks
 */

// Configuration
// NOTE: If you get 404 errors, verify the correct base URL with Lenco support
// The base URL might be: 'https://api.lenco.co' or 'https://api.lenco.co/v1' or similar
const LENCO_CONFIG = {
    baseURL: process.env.LENCO_API_BASE_URL || 'https://api.lenco.co/access/v2',
    apiSecretKey: process.env.LENCO_API_SECRET_KEY,
    publicKey: process.env.LENCO_PUBLIC_KEY,
    webhookSecret: process.env.LENCO_WEBHOOK_SECRET,
    webhookURL: process.env.LENCO_WEBHOOK_URL,
    environment: process.env.LENCO_ENVIRONMENT || 'production'
};

// Validate configuration
if (!LENCO_CONFIG.apiSecretKey || LENCO_CONFIG.apiSecretKey === 'xxxxxxxxxxxxxxxxxxxxxxx') {
    log('warn', 'API Secret Key not configured', {
        configured: !!LENCO_CONFIG.apiSecretKey,
        environment: LENCO_CONFIG.environment
    });
}

/**
 * Generate unique payment reference
 * Format: QC-{orderNumber}-{timestamp}
 * @param {string} orderNumber - Order number
 * @returns {string} Payment reference
 */
function generatePaymentReference(orderNumber) {
    if (!orderNumber) {
        log('warn', 'Order number is missing when generating payment reference', {
            orderNumber,
            function: 'generatePaymentReference'
        });
        // Fallback: use timestamp + random suffix if orderNumber is missing
        const timestamp = Date.now();
        const randomSuffix = crypto.randomBytes(4).toString('hex');
        return `QC-UNKNOWN-${timestamp}-${randomSuffix}`;
    }
    const timestamp = Date.now();
    // Append cryptographically random suffix to prevent collisions under high concurrency
    // crypto.randomBytes(4) generates 4 bytes = 8 hex characters, making collisions practically impossible
    const randomSuffix = crypto.randomBytes(4).toString('hex');
    return `QC-${orderNumber}-${timestamp}-${randomSuffix}`;
}


/**
 * Create axios instance with default headers
 * @returns {axios.AxiosInstance}
 */
function createAxiosInstance() {
    const instance = axios.create({
        baseURL: LENCO_CONFIG.baseURL,
        timeout: 30000, // 30 seconds timeout
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LENCO_CONFIG.apiSecretKey}`
            // Note: X-Public-Key removed as Lenco API uses Bearer token authentication only
        }
    });

    // Add request interceptor for logging (basic logging, detailed logging in makeApiRequest)
    instance.interceptors.request.use(
        (config) => {
            log('debug', 'Axios Request', {
                method: config.method?.toUpperCase(),
                url: config.url,
                baseURL: config.baseURL
            });
            return config;
        },
        (error) => {
            log('error', 'Axios Request Error', {
                message: error.message,
                code: error.code
            });
            return Promise.reject(error);
        }
    );

    // Add response interceptor for logging (basic logging, detailed logging in makeApiRequest)
    instance.interceptors.response.use(
        (response) => {
            log('debug', 'Axios Response', {
                status: response.status,
                url: response.config.url
            });
            return response;
        },
        (error) => {
            log('debug', 'Axios Response Error', {
                status: error.response?.status,
                url: error.config?.url,
                message: error.message
            });
            return Promise.reject(error);
        }
    );

    return instance;
}

/** Shared client for Lenco v2 API (connection pooling, single interceptor chain). */
const lencoAxiosInstance = createAxiosInstance();

/**
 * Initiate Mobile Money Payment
 * @param {object} orderData - Order information
 * @param {string} customerPhone - Customer phone number (format: +260XXXXXXXXX)
 * @param {string} provider - Mobile money provider ('airtel', 'mtn')
 * @param {number|null} [amountOverride] - When set (e.g. layby installment), charge this amount instead of orderData.totals.total
 * @returns {Promise<object>} Payment initiation response
 */
async function initiateMobileMoneyPayment(orderData, customerPhone, provider, amountOverride = null) {
    // Validate API Secret Key
    if (!LENCO_CONFIG.apiSecretKey || LENCO_CONFIG.apiSecretKey === 'xxxxxxxxxxxxxxxxxxxxxxx') {
        log('error', 'API Secret Key not configured', { function: 'initiateMobileMoneyPayment' });
        throw new Error('Lenco API Secret Key not configured');
    }

    // Validate orderNumber exists
    if (!orderData || !orderData.orderNumber) {
        log('error', 'Order number is missing in orderData', {
            orderData: orderData ? Object.keys(orderData) : 'null',
            function: 'initiateMobileMoneyPayment'
        });
        throw new Error('Order number is required for payment initiation');
    }

    if (!['airtel', 'mtn'].includes(provider.toLowerCase())) {
        log('error', 'Invalid mobile money provider', {
            provider,
            function: 'initiateMobileMoneyPayment',
            orderNumber: orderData.orderNumber
        });
        throw new Error(`Invalid mobile money provider: ${provider}. Must be 'airtel' or 'mtn'`);
    }

    const paymentReference = generatePaymentReference(orderData.orderNumber);

    const rawAmount = amountOverride != null && !Number.isNaN(Number(amountOverride))
        ? Number(amountOverride)
        : Number(orderData.totals?.total);

    const chargeAmount = Math.round(rawAmount * 100) / 100; // Round to 2 decimal places

    if (!chargeAmount || isNaN(chargeAmount) || chargeAmount <= 0) {
        log('error', 'Invalid charge amount', {
            orderNumber: orderData.orderNumber,
            rawTotal: orderData.totals?.total,
            amountOverride,
            chargeAmount
        });
        const err = new Error(`Invalid amount: ${chargeAmount}`);
        err.name = 'validation_error';
        err.code = 400;
        err.retryable = false;
        throw err;
    }

    if (chargeAmount < 1) {
        log('error', 'Charge amount below Lenco minimum (K1)', {
            orderNumber: orderData.orderNumber,
            chargeAmount
        });
        const err = new Error('Payment amount must be at least K1.00');
        err.name = 'validation_error';
        err.code = 400;
        err.retryable = false;
        throw err;
    }

    log('info', 'Initiating mobile money payment', {
        orderNumber: orderData.orderNumber,
        provider: provider.toLowerCase(),
        amount: chargeAmount,
        reference: paymentReference,
        customerPhone: customerPhone.replace(/(\d{3})(\d{3})(\d{3})/, '***-***-$3') // Mask phone for privacy
    });

    try {
        // Prepare payment request payload (Lenco's required format)
        const paymentPayload = {
            phone: customerPhone,              // Required: Customer's phone number
            operator: provider.toLowerCase(),  // Required: airtel or mtn
            amount: chargeAmount,   // Required: Amount to collect
            currency: 'ZMW',                  // Required: Currency code
            reference: paymentReference,       // Required: Your unique reference
            country: 'ZM',                    // Required: Country code
            description:
                amountOverride != null
                    ? `Layby payment for order ${orderData.orderNumber}`
                    : `Payment for order ${orderData.orderNumber}` // Optional
        };

        // Make API request with retry logic
        const response = await makeApiRequest({
            method: 'POST',
            url: '/collections/mobile-money',
            data: paymentPayload,
            metadata: {
                orderNumber: orderData.orderNumber,
                transactionId: null,
                operation: 'initiate_mobile_money_payment'
            }
        });

        // Validate response (Lenco format: { status: boolean, message: string, data: object })
        validateApiResponse(response, ['id']);
        
        // Extract data from response.data.data (Lenco wraps results in 'data' key)
        const responseData = response.data;
        const collectionData = responseData.data || responseData;

        // Extract collection ID (this is Lenco's transaction ID)
        const collectionId = collectionData.id;  // Use 'id' not 'transactionId'

        if (!collectionId) {
            log('error', 'Collection ID missing in response', {
                orderNumber: orderData.orderNumber,
                responseData: collectionData
            });
            throw new Error('Collection ID not returned by payment gateway');
        }

        // Handle the 'pay-offline' status
        const lencoStatus = collectionData.status;
        const isPayOffline = lencoStatus === 'pay-offline';

        // Prepare payment instructions
        let paymentInstructions = '';
        if (isPayOffline) {
            paymentInstructions = `Please check your ${provider.toUpperCase()} phone (${customerPhone}) for a payment prompt. Approve the transaction to complete your payment.`;
        } else if (lencoStatus === 'pending') {
            paymentInstructions = `Payment is being processed. You may receive a prompt on your ${provider.toUpperCase()} phone shortly.`;
        }

        const result = {
            success: true,
            transactionId: collectionId,                    // Lenco's collection ID
            reference: paymentReference,                     // Your reference
            lencoReference: collectionData.lencoReference,   // Lenco's reference
            status: lencoStatus,                             // 'pay-offline', 'pending', etc.
            amount: parseFloat(collectionData.amount),
            currency: collectionData.currency || 'ZMW',
            provider: provider.toLowerCase(),
            paymentInstructions: paymentInstructions,
            mobileMoneyDetails: collectionData.mobileMoneyDetails,
            initiatedAt: collectionData.initiatedAt,
            completedAt: collectionData.completedAt,
            fee: collectionData.fee,
            bearer: collectionData.bearer,
            rawResponse: collectionData,
            message: responseData.message // Include Lenco's message
        };

        log('info', 'Mobile money payment initiated successfully', {
            orderNumber: orderData.orderNumber,
            transactionId: result.transactionId,
            reference: paymentReference,
            status: result.status,
            provider: provider
        });

        return result;
    } catch (error) {
        log('error', 'Failed to initiate mobile money payment', {
            orderNumber: orderData.orderNumber,
            provider: provider,
            chargeAmount,
            error: {
                message: error.message,
                type: error.name,
                code: error.code,
                retryable: error.retryable
            }
        });
        
        throw error;
    }
}

/**
 * Initiate Bank Transfer Payment
 * @param {object} orderData - Order information
 * @param {object} bankDetails - Bank account details
 * @param {string} bankDetails.bankName - Bank name
 * @param {string} bankDetails.accountNumber - Account number (optional)
 * @param {string} bankDetails.accountName - Account holder name
 * @returns {Promise<object>} Payment initiation response
 */
async function initiateBankTransfer(orderData, bankDetails) {
    if (!LENCO_CONFIG.apiSecretKey || LENCO_CONFIG.apiSecretKey === 'xxxxxxxxxxxxxxxxxxxxxxx') {
        log('error', 'API Secret Key not configured', { function: 'initiateBankTransfer' });
        throw new Error('Lenco API Secret Key not configured');
    }

    if (!bankDetails || !bankDetails.bankName) {
        log('error', 'Bank name required', {
            function: 'initiateBankTransfer',
            orderNumber: orderData.orderNumber
        });
        throw new Error('Bank name is required for bank transfer');
    }

    const paymentReference = generatePaymentReference(orderData.orderNumber);
    
    log('info', 'Initiating bank transfer', {
        orderNumber: orderData.orderNumber,
        bankName: bankDetails.bankName,
        amount: orderData.totals.total,
        reference: paymentReference
    });

    try {
        // Prepare payment request payload (Lenco Collections API format)
        const paymentPayload = {
            amount: orderData.totals.total,   // Required: Amount to collect
            currency: 'ZMW',                  // Required: Currency code
            reference: paymentReference,       // Required: Your unique reference
            country: 'ZM',                    // Required: Country code
            description: `Payment for order ${orderData.orderNumber}`, // Optional
            bankName: bankDetails.bankName,   // Required: Customer's bank name
            accountName: bankDetails.accountName || orderData.customer.name, // Account holder name
            accountNumber: bankDetails.accountNumber || null, // Account number if available
            customer: {
                name: orderData.customer.name,
                email: orderData.customer.email,
                phone: orderData.customer.phone
            },
            callbackUrl: LENCO_CONFIG.webhookURL
        };

        // Make API request with retry logic
        // Using Lenco Collections API endpoint (same pattern as mobile money)
        const response = await makeApiRequest({
            method: 'POST',
            url: '/collections/bank-transfer',
            data: paymentPayload,
            metadata: {
                orderNumber: orderData.orderNumber,
                transactionId: null,
                operation: 'initiate_bank_transfer'
            }
        });

        // Validate response (Lenco format: { status: boolean, message: string, data: object })
        validateApiResponse(response, ['transactionId', 'id']);
        
        // Extract data from response.data.data (Lenco wraps results in 'data' key)
        const responseData = response.data;
        const paymentData = responseData.data || responseData;

        const result = {
            success: true,
            transactionId: paymentData.transactionId || paymentData.id || paymentData.transaction_id,
            reference: paymentReference,
            paymentInstructions: paymentData.paymentInstructions || paymentData.instructions,
            bankAccount: paymentData.bankAccount || paymentData.account || paymentData.bank_account,
            status: paymentData.status || 'pending',
            bankName: bankDetails.bankName,
            expiresAt: paymentData.expiresAt || paymentData.expires_at,
            rawResponse: responseData, // Include full response for debugging
            message: responseData.message // Include Lenco's message
        };

        log('info', 'Bank transfer initiated successfully', {
            orderNumber: orderData.orderNumber,
            transactionId: result.transactionId,
            reference: paymentReference,
            status: result.status,
            bankName: bankDetails.bankName
        });

        return result;
    } catch (error) {
        log('error', 'Failed to initiate bank transfer', {
            orderNumber: orderData.orderNumber,
            bankName: bankDetails.bankName,
            error: {
                message: error.message,
                type: error.name,
                code: error.code,
                retryable: error.retryable
            }
        });
        
        throw error;
    }
}

/**
 * Normalize Lenco verify API response into a consistent result object.
 */
function parseVerifyCollectionResponse(response, fallbackCollectionId) {
    validateApiResponse(response, ['id', 'status']);
    const responseData = response.data;
    const collectionData = responseData.data || responseData;

    return {
        success: true,
        transactionId: collectionData.id || fallbackCollectionId,
        reference: collectionData.reference,
        lencoReference: collectionData.lencoReference,
        status: collectionData.status,
        amount: parseFloat(collectionData.amount),
        currency: collectionData.currency || 'ZMW',
        type: collectionData.type,
        provider: collectionData.mobileMoneyDetails?.operator || collectionData.provider,
        completedAt: collectionData.completedAt,
        initiatedAt: collectionData.initiatedAt,
        failedAt: collectionData.reasonForFailure ? new Date() : null,
        failureReason: collectionData.reasonForFailure,
        fee: collectionData.fee,
        bearer: collectionData.bearer,
        settlementStatus: collectionData.settlementStatus,
        mobileMoneyDetails: collectionData.mobileMoneyDetails,
        bankAccountDetails: collectionData.bankAccountDetails,
        rawResponse: collectionData,
        message: responseData.message
    };
}

function isVerifyNotFoundError(error) {
    return error.code === 404 || error.name === 'not_found_error';
}

/**
 * Verify Payment Status
 * @param {string} collectionId - Lenco collection ID (e.g. col_xxx) from initiate response
 * @param {string|null} merchantReference - Your reference sent in the collection payload (same as payments.transactionId).
 *   Lenco GET /collections/status/:reference expects this value, NOT lencoReference (LNC-xxx).
 * @returns {Promise<object>} Payment status information
 */
async function verifyPayment(collectionId, merchantReference = null) {
    if (!LENCO_CONFIG.apiSecretKey || LENCO_CONFIG.apiSecretKey === 'xxxxxxxxxxxxxxxxxxxxxxx') {
        log('error', 'API Secret Key not configured', { function: 'verifyPayment' });
        throw new Error('Lenco API Secret Key not configured');
    }

    const ref = merchantReference && String(merchantReference).trim() ? String(merchantReference).trim() : null;

    if (!collectionId && !ref) {
        log('error', 'Collection ID or merchant reference required', { function: 'verifyPayment' });
        throw new Error('Transaction ID or reference is required');
    }

    log('info', 'Verifying payment status', {
        collectionId,
        merchantReference: ref,
        operation: 'verify_payment'
    });

    const metadataBase = {
        orderNumber: null,
        transactionId: collectionId,
        reference: ref,
        operation: 'verify_payment'
    };

    const fetchByMerchantReference = async () => {
        const enc = encodeURIComponent(ref);
        const response = await makeApiRequest({
            method: 'GET',
            url: `/collections/status/${enc}`,
            metadata: { ...metadataBase, verifyPath: 'status_by_merchant_ref' }
        });
        return parseVerifyCollectionResponse(response, collectionId);
    };

    const fetchByCollectionId = async () => {
        const response = await makeApiRequest({
            method: 'GET',
            url: `/collections/${collectionId}`,
            metadata: { ...metadataBase, verifyPath: 'by_collection_id' }
        });
        return parseVerifyCollectionResponse(response, collectionId);
    };

    try {
        // Prefer merchant reference — matches the `reference` field sent to POST /collections/mobile-money
        if (ref) {
            try {
                const result = await fetchByMerchantReference();
                log('info', 'Payment status verified (by merchant reference)', {
                    collectionId: result.transactionId,
                    status: result.status
                });
                return result;
            } catch (error) {
                if (isVerifyNotFoundError(error) && collectionId) {
                    log('warn', 'Status by merchant reference not found; retrying by collection id', {
                        merchantReference: ref,
                        collectionId
                    });
                    const result = await fetchByCollectionId();
                    log('info', 'Payment status verified (by collection id)', {
                        collectionId: result.transactionId,
                        status: result.status
                    });
                    return result;
                }
                throw error;
            }
        }

        if (collectionId) {
            const result = await fetchByCollectionId();
            log('info', 'Payment status verified', {
                collectionId: result.transactionId,
                status: result.status,
                amount: result.amount,
                currency: result.currency
            });
            return result;
        }

        throw new Error('Transaction ID or reference is required');
    } catch (error) {
        if (isVerifyNotFoundError(error)) {
            log('warn', 'Collection not found when verifying payment', {
                collectionId,
                merchantReference: ref,
                error: error.message
            });
            throw new Error('Transaction not found');
        }

        log('error', 'Failed to verify payment', {
            collectionId,
            error: {
                message: error.message,
                type: error.name,
                code: error.code,
                retryable: error.retryable
            }
        });

        throw error;
    }
}

/**
 * Validate Webhook Signature
 * @param {object|string} payload - Webhook payload (object or JSON string)
 * @param {string} signature - Signature from webhook headers
 * @returns {boolean} True if signature is valid
 */
function validateWebhookSignature(payload, signature) {
    if (!LENCO_CONFIG.webhookSecret) {
        log('warn', 'Webhook secret not configured', {
            function: 'validateWebhookSignature',
            action: 'skipping_validation'
        });
        return true; // Allow if secret not configured (for development)
    }

    if (!signature) {
        log('error', 'Webhook signature missing', {
            function: 'validateWebhookSignature',
            hasPayload: !!payload
        });
        return false;
    }

    try {
        // Use raw bytes when available (Buffer from req.rawBody) so the HMAC matches
        // what Lenco signed. Fall back to re-serialisation only when no raw body exists.
        const payloadString = Buffer.isBuffer(payload)
            ? payload.toString('utf8')
            : typeof payload === 'string' ? payload : JSON.stringify(payload);
        
        // HMAC-SHA256 signature verification
        const expectedSignature = crypto
            .createHmac('sha256', LENCO_CONFIG.webhookSecret)
            .update(payloadString)
            .digest('hex');
        
        // Normalize signatures for comparison (remove any prefixes like 'sha256=')
        const normalizedSignature = signature.replace(/^sha256=/, '').trim();
        const normalizedExpected = expectedSignature.trim();

        // Reject non-hex signatures before attempting Buffer decode.
        // Buffer.from(str, 'hex') silently produces zeroes for invalid hex — reject explicitly.
        if (!/^[0-9a-f]+$/i.test(normalizedSignature)) {
            log('error', 'Webhook signature is not valid hex — rejecting', {
                function: 'validateWebhookSignature'
            });
            return false;
        }

        // Timing-safe comparison only — any length mismatch means invalid, no fallback
        let isValid = false;
        try {
            const sigBuffer = Buffer.from(normalizedSignature, 'hex');
            const expectedBuffer = Buffer.from(normalizedExpected, 'hex');

            if (sigBuffer.length !== expectedBuffer.length) {
                log('error', 'Webhook signature length mismatch — rejecting', {
                    function: 'validateWebhookSignature'
                });
                return false;
            }

            isValid = crypto.timingSafeEqual(sigBuffer, expectedBuffer);
        } catch (bufferError) {
            log('error', 'Webhook signature buffer error — rejecting', {
                function: 'validateWebhookSignature',
                error: bufferError.message
            });
            return false;
        }
        
        if (!isValid) {
            log('error', 'Webhook signature validation failed', {
                function: 'validateWebhookSignature',
                signatureLength: signature.length,
                expectedLength: expectedSignature.length
            });
        } else {
            log('debug', 'Webhook signature validated successfully', {
                function: 'validateWebhookSignature'
            });
        }
        
        return isValid;
    } catch (error) {
        log('error', 'Error validating webhook signature', {
            function: 'validateWebhookSignature',
            error: {
                message: error.message,
                stack: error.stack
            }
        });
        return false;
    }
}

/**
 * Handle Webhook Callback
 * @param {object} payload - Webhook payload from Lenco
 * @param {string} signature - Webhook signature from headers
 * @returns {Promise<object>} Parsed webhook data
 */
async function handleWebhook(payload) {
    const transactionId = payload?.transactionId || payload?.transaction_id || payload?.id || 'unknown';
    const orderNumber = payload?.orderNumber || payload?.order_number || payload?.metadata?.orderNumber || 'unknown';
    
    log('info', 'Webhook received', {
        function: 'handleWebhook',
        transactionId,
        orderNumber,
        status: payload?.status,
        reference: payload?.reference
    });

    try {
        // Log full webhook payload for debugging (sanitize sensitive data)
        log('debug', 'Webhook payload', {
            function: 'handleWebhook',
            transactionId,
            orderNumber,
            payload: {
                transactionId: payload?.transactionId || payload?.transaction_id,
                status: payload?.status,
                reference: payload?.reference,
                amount: payload?.amount,
                currency: payload?.currency,
                paymentMethod: payload?.paymentMethod || payload?.payment_method,
                provider: payload?.provider
            }
        });

        // Note: Signature validation is handled in the controller (payment.controller.js)
        // This service function only parses the webhook payload

        // Parse webhook payload
        // Lenco webhook format: { status: boolean, message: string, data: object }
        // Extract data from payload.data if it exists (Lenco wraps results in 'data' key)
        const webhookPayload = payload.data || payload;
        
        const webhookData = {
            transactionId: webhookPayload.id || webhookPayload.transactionId || webhookPayload.transaction_id, // Collection ID (col_xxx)
            reference: webhookPayload.reference, // Your reference (QC-ORD-xxx)
            lencoReference: webhookPayload.lencoReference, // Lenco's reference (LNC-xxx)
            orderNumber: webhookPayload.orderNumber || webhookPayload.order_number || webhookPayload.metadata?.orderNumber,
            status: webhookPayload.status, // 'successful', 'failed', 'pay-offline', etc.
            amount: webhookPayload.amount,
            currency: webhookPayload.currency || 'ZMW',
            paymentMethod: webhookPayload.type || webhookPayload.paymentMethod || webhookPayload.payment_method,
            provider: webhookPayload.mobileMoneyDetails?.operator || webhookPayload.provider,
            completedAt: webhookPayload.completedAt,
            initiatedAt: webhookPayload.initiatedAt,
            failedAt: webhookPayload.reasonForFailure ? new Date() : null,
            failureReason: webhookPayload.reasonForFailure || webhookPayload.failureReason || webhookPayload.failure_reason || webhookPayload.error,
            mobileMoneyDetails: webhookPayload.mobileMoneyDetails,
            bankAccountDetails: webhookPayload.bankAccountDetails,
            rawPayload: payload // Full webhook payload
        };

        // Log payment status change
        log('info', 'Payment status change', {
            function: 'handleWebhook',
            transactionId: webhookData.transactionId,
            orderNumber: webhookData.orderNumber,
            status: webhookData.status,
            amount: webhookData.amount,
            currency: webhookData.currency,
            provider: webhookData.provider,
            completedAt: webhookData.completedAt,
            failedAt: webhookData.failedAt,
            failureReason: webhookData.failureReason
        });

        return {
            success: true,
            data: webhookData
        };
    } catch (error) {
        log('error', 'Error handling webhook', {
            function: 'handleWebhook',
            transactionId,
            orderNumber,
            error: {
                message: error.message,
                name: error.name,
                stack: error.stack
            },
            payload: {
                transactionId: payload?.transactionId || payload?.transaction_id,
                status: payload?.status,
                reference: payload?.reference
            }
        });
        
        return {
            success: false,
            error: error.message,
            data: null
        };
    }
}

/**
 * Get list of banks and financial institutions
 * Note: Banks endpoint uses v1, not v2
 * @returns {Promise<object>} List of banks with code and name
 */
async function getBanks() {
    // Validate API Secret Key
    if (!LENCO_CONFIG.apiSecretKey || LENCO_CONFIG.apiSecretKey === 'xxxxxxxxxxxxxxxxxxxxxxx') {
        log('error', 'API Secret Key not configured', { function: 'getBanks' });
        throw new Error('Lenco API Secret Key not configured');
    }

    log('info', 'Fetching banks list from Lenco API');

    try {
        // Banks endpoint uses v1, not v2 - create separate axios instance
        const v1BaseURL = 'https://api.lenco.co/access/v1';
        const axiosInstance = axios.create({
            baseURL: v1BaseURL,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LENCO_CONFIG.apiSecretKey}`
            }
        });

        const response = await axiosInstance.get('/banks');

        // Validate response
        if (!response.data) {
            throw new Error('Invalid response from Lenco API');
        }

        const responseData = response.data;
        
        // Handle Lenco response format: { status: boolean, message: string, data: array }
        if (responseData.status === false) {
            throw new Error(responseData.message || 'Failed to fetch banks');
        }

        const banks = responseData.data || [];
        
        log('info', 'Banks list fetched successfully', {
            count: banks.length
        });

        return {
            success: true,
            banks: banks,
            count: banks.length
        };
    } catch (error) {
        const errorData = parseApiError(error);
        log('error', 'Error fetching banks list', {
            function: 'getBanks',
            error: errorData
        });
        throw error;
    }
}

/**
 * Cancel a Lenco collection (stops retries and USSD prompts on the user's phone)
 * @param {string} collectionId - Lenco collection ID (col_xxx / lencoTransactionId)
 * @returns {Promise<boolean>} true if cancelled, false if already terminal or not found
 */
async function cancelCollection(collectionId) {
    if (!collectionId) return false;
    try {
        await makeApiRequest({
            method: 'DELETE',
            url: `/collections/${collectionId}`,
            metadata: { operation: 'cancel_collection', transactionId: collectionId }
        });
        log('info', 'Collection cancelled on Lenco', { collectionId });
        return true;
    } catch (error) {
        // 404 = already gone, 4xx = already terminal — treat as success
        const code = error.code || error.status;
        if (code === 404 || (code >= 400 && code < 500)) {
            log('info', 'Collection already terminal or not found on Lenco', { collectionId, code });
            return true;
        }
        log('warn', 'Failed to cancel collection on Lenco', { collectionId, error: error.message });
        return false;
    }
}

module.exports = {
    initiateMobileMoneyPayment,
    initiateBankTransfer,
    verifyPayment,
    cancelCollection,
    handleWebhook,
    generatePaymentReference,
    validateWebhookSignature,
    getBanks
};

