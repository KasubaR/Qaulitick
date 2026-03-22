// Validation and Sanitization Utilities

const validator = require('validator');

/**
 * Normalize string input: type-check, trim, and cap length.
 * NOT a security/XSS function — XSS prevention is at render/output time via EJS <%= %> escaping.
 * @param {string} input
 * @returns {string}
 */
function sanitizeString(input) {
    if (typeof input !== 'string') return '';
    return input.trim().slice(0, 1000);
}

/**
 * Sanitize object recursively
 * @param {object} obj - Object to sanitize
 * @returns {object} - Sanitized object
 */
function sanitizeObject(obj) {
    if (obj === null || obj === undefined) {
        return obj;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item));
    }
    
    if (typeof obj === 'object') {
        const sanitized = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                sanitized[key] = sanitizeObject(obj[key]);
            }
        }
        return sanitized;
    }
    
    if (typeof obj === 'string') {
        return sanitizeString(obj);
    }
    
    return obj;
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} - True if valid
 */
function validateEmail(email) {
    if (!email || typeof email !== 'string') {
        return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
}

/**
 * Validate phone number (Zambian format)
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - True if valid
 */
function validatePhone(phone) {
    if (!phone || typeof phone !== 'string') {
        return false;
    }
    // Zambian phone format: +260XXXXXXXXX or 0XXXXXXXXX
    const phoneRegex = /^(\+260|0)?[0-9]{9}$/;
    return phoneRegex.test(phone.replace(/\s/g, ''));
}

/**
 * Validate URL
 * @param {string} url - URL to validate
 * @returns {boolean} - True if valid
 */
function validateURL(url) {
    if (!url || typeof url !== 'string') {
        return false;
    }
    
    // Allow relative paths starting with / (e.g., /images/placeholder.jpg)
    if (url.startsWith('/')) {
        return true;
    }

    // Allow data URLs for images (e.g., data:image/png;base64,...)
    if (url.startsWith('data:image')) {
        return true;
    }
    
    try {
        const urlObj = new URL(url);
        // Only allow http and https protocols
        return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Validate product ID format
 * @param {string} id - Product ID to validate
 * @returns {boolean} - True if valid
 */
function validateProductId(id) {
    if (!id || typeof id !== 'string') {
        return false;
    }
    // Allow alphanumeric and hyphens
    const idRegex = /^[a-zA-Z0-9\-]+$/;
    return idRegex.test(id.trim());
}

/**
 * Validate price
 * @param {number|string} price - Price to validate
 * @returns {boolean} - True if valid
 */
function validatePrice(price) {
    const numPrice = typeof price === 'string' ? parseFloat(price) : price;
    return !isNaN(numPrice) && numPrice >= 0 && numPrice <= 1000000;
}

/**
 * Validate stock quantity
 * @param {number|string} stock - Stock quantity to validate
 * @returns {boolean} - True if valid
 */
function validateStock(stock) {
    const numStock = typeof stock === 'string' ? parseInt(stock) : stock;
    return !isNaN(numStock) && Number.isInteger(numStock) && numStock >= 0 && numStock <= 10000;
}

/**
 * Validate pagination parameters
 * @param {object} params - Query parameters
 * @returns {object} - Validated pagination params
 */
function validatePagination(params) {
    const page = parseInt(params.page) || 1;
    const limit = parseInt(params.limit) || 12;
    
    return {
        page: Math.max(1, Math.min(page, 100)), // Max 100 pages
        limit: Math.max(1, Math.min(limit, 100)) // Max 100 items per page
    };
}

/**
 * Validate search query
 * @param {string} search - Search query
 * @returns {string|null} - Sanitized search query or null
 */
function validateSearch(search) {
    if (!search || typeof search !== 'string') {
        return null;
    }
    
    const sanitized = sanitizeString(search);
    
    // Limit search length
    if (sanitized.length > 100) {
        return sanitized.substring(0, 100);
    }
    
    // Remove special characters that could be used for injection
    return sanitized.replace(/[<>'"\\]/g, '');
}

/**
 * Validate sort parameter
 * @param {string} sort - Sort parameter
 * @returns {string} - Validated sort parameter
 */
function validateSort(sort) {
    const validSorts = [
        'latest', 'oldest',
        'price-low', 'price-high', 'price-asc', 'price-desc',
        'popularity', 'rating',
        'name-asc', 'name-desc'
    ];
    
    if (!sort || typeof sort !== 'string') {
        return 'latest';
    }
    
    return validSorts.includes(sort) ? sort : 'latest';
}

/**
 * Validate filter parameters
 * @param {object} filters - Filter parameters
 * @returns {object} - Validated filters
 */
function validateFilters(filters) {
    const validated = {};
    
    // Brand filter
    if (filters.brand) {
        const brands = Array.isArray(filters.brand) ? filters.brand : [filters.brand];
        validated.brand = brands
            .filter(b => b && typeof b === 'string')
            .map(b => sanitizeString(b).toLowerCase())
            .filter(b => /^[a-z0-9\s-]+$/.test(b)); // Only alphanumeric, spaces, hyphens
    }
    
    // Gender filter
    if (filters.gender) {
        const genders = Array.isArray(filters.gender) ? filters.gender : [filters.gender];
        const validGenders = ['men', 'women', 'unisex', 'accessories', 'gift picks'];
        validated.gender = genders
            .filter(g => validGenders.includes(g.toLowerCase()));
    }
    
    // Price range
    if (filters.minPrice) {
        const min = parseFloat(filters.minPrice);
        if (!isNaN(min) && min >= 0) {
            validated.minPrice = Math.min(min, 1000000);
        }
    }
    
    if (filters.maxPrice) {
        const max = parseFloat(filters.maxPrice);
        if (!isNaN(max) && max >= 0) {
            validated.maxPrice = Math.min(max, 1000000);
        }
    }
    
    return validated;
}

/**
 * Validate order data
 * @param {object} orderData - Order data to validate
 * @returns {object} - Validation result { valid: boolean, errors: array }
 */
/**
 * Password policy: min 8 chars, at least one letter and one number.
 */
function validatePasswordStrength(password) {
    if (!password || typeof password !== 'string' || password.length < 8) {
        return false;
    }
    if (password.length > 128) {
        return false;
    }
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /\d/.test(password);
    return hasLetter && hasNumber;
}

/**
 * @param {{ name?: string, email?: string, phone?: string, password?: string }} body
 */
function validateRegister(body) {
    const errors = [];
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length < 2) {
        errors.push('Name must be at least 2 characters.');
    }
    if (!body.email || !validator.isEmail(String(body.email).trim())) {
        errors.push('A valid email address is required.');
    }
    if (!body.phone || !validatePhone(body.phone)) {
        errors.push('A valid Zambian phone number is required.');
    }
    if (!validatePasswordStrength(body.password)) {
        errors.push('Password must be at least 8 characters and include at least one letter and one number.');
    }
    return { valid: errors.length === 0, errors };
}

/**
 * @param {{ email?: string, password?: string }} body
 */
function validateLogin(body) {
    const errors = [];
    if (!body.email || !validator.isEmail(String(body.email).trim())) {
        errors.push('A valid email address is required.');
    }
    if (!body.password || typeof body.password !== 'string' || body.password.length < 1) {
        errors.push('Password is required.');
    }
    return { valid: errors.length === 0, errors };
}

/**
 * @param {{ email?: string }} body
 */
function validateForgotPasswordEmail(body) {
    const errors = [];
    if (!body.email || !validator.isEmail(String(body.email).trim())) {
        errors.push('A valid email address is required.');
    }
    return { valid: errors.length === 0, errors };
}

/**
 * @param {{ token?: string, password?: string, passwordConfirm?: string }} body
 */
function validateResetPassword(body) {
    const errors = [];
    if (!body.token || typeof body.token !== 'string' || body.token.trim().length < 32) {
        errors.push('Reset link is invalid or missing.');
    }
    if (!validatePasswordStrength(body.password)) {
        errors.push('Password must be at least 8 characters and include at least one letter and one number.');
    }
    if (!body.passwordConfirm || body.password !== body.passwordConfirm) {
        errors.push('Passwords do not match.');
    }
    return { valid: errors.length === 0, errors };
}

function validateOrder(orderData) {
    const errors = [];
    
    // Customer validation
    if (!orderData.customer) {
        errors.push('Customer information is required');
    } else {
        if (!orderData.customer.name || typeof orderData.customer.name !== 'string' || orderData.customer.name.trim().length < 2) {
            errors.push('Valid customer name is required');
        }
        if (!validateEmail(orderData.customer.email)) {
            errors.push('Valid email is required');
        }
        if (!validatePhone(orderData.customer.phone)) {
            errors.push('Valid phone number is required');
        }
    }
    
    // Shipping validation
    if (!orderData.shipping) {
        errors.push('Shipping information is required');
    } else {
        // If pickup is selected, address, province, and city are optional
        const isPickup = orderData.shipping.pickup === true || 
                        orderData.shipping.pickup === 'true' || 
                        orderData.shipping.pickupOption === true ||
                        orderData.shipping.pickupOption === 'true';
        
        if (!isPickup) {
            if (!orderData.shipping.address || typeof orderData.shipping.address !== 'string' || orderData.shipping.address.trim().length < 5) {
                errors.push('Valid delivery address is required');
            }
            if (!orderData.shipping.province || (typeof orderData.shipping.province === 'string' && orderData.shipping.province.trim().length === 0)) {
                errors.push('Province is required');
            }
            if (!orderData.shipping.city || typeof orderData.shipping.city !== 'string' || orderData.shipping.city.trim().length < 2) {
                errors.push('Valid city is required');
            }
        }
    }
    
    // Items validation
    if (!orderData.items || !Array.isArray(orderData.items) || orderData.items.length === 0) {
        errors.push('At least one item is required');
    } else {
        orderData.items.forEach((item, index) => {
            if (!item.id || !item.name || !item.price) {
                errors.push(`Item ${index + 1} is missing required fields`);
            }
            if (!validatePrice(item.price)) {
                errors.push(`Item ${index + 1} has invalid price`);
            }
        });
    }
    
    // Payment method validation
    const validPaymentMethods = ['mobile', 'mobile_money', 'card', 'paypal', 'bank', 'bank_transfer', 'crypto', 'cash_on_delivery'];
    if (!orderData.paymentMethod || !validPaymentMethods.includes(orderData.paymentMethod)) {
        errors.push('Valid payment method is required');
    }

    const checkoutMode = orderData.checkoutMode || 'standard';
    if (checkoutMode !== 'standard' && checkoutMode !== 'layby') {
        errors.push('Invalid checkout mode');
    }
    if (checkoutMode === 'layby') {
        const p = orderData.laybyDepositPercent;
        if (p !== undefined && p !== null && p !== '') {
            const num = parseFloat(String(p));
            if (Number.isNaN(num) || num < 1 || num > 100) {
                errors.push('Layby deposit percent must be a number between 1 and 100');
            }
        }
    }
    
    return {
        valid: errors.length === 0,
        errors: errors
    };
}

/**
 * Validate product data
 * @param {object} productData - Product data to validate
 * @returns {object} - Validation result { valid: boolean, errors: array }
 */
function validateProduct(productData, { partial = false } = {}) {
    const errors = [];

    // Required-field checks are skipped in partial mode (updates)
    if (!partial || productData.model !== undefined) {
        if (!productData.model || typeof productData.model !== 'string' || productData.model.trim().length < 2) {
            errors.push('Product model is required (min 2 characters)');
        }
    }

    if (!partial || productData.brand !== undefined) {
        if (!productData.brand || typeof productData.brand !== 'string' || productData.brand.trim().length < 2) {
            errors.push('Product brand is required');
        }
    }

    if (!partial || productData.sku !== undefined) {
        if (!productData.sku || typeof productData.sku !== 'string' || productData.sku.trim().length === 0) {
            errors.push('SKU is required');
        }
    }

    if (!partial || productData.price !== undefined) {
        if (!validatePrice(productData.price)) {
            errors.push('Valid price is required');
        }
    }

    if (productData.originalPrice !== undefined && productData.originalPrice !== null && productData.originalPrice !== '') {
        const origPrice = parseFloat(productData.originalPrice);
        const currPrice = parseFloat(productData.price);
        if (!isNaN(origPrice) && !isNaN(currPrice) && origPrice <= currPrice) {
            errors.push('Original price must be greater than the current price');
        }
    }

    if (productData.stock !== undefined && !validateStock(productData.stock)) {
        errors.push('Valid stock quantity is required');
    }
    
    if (productData.images && Array.isArray(productData.images)) {
        productData.images.forEach((image, index) => {
            if (!validateURL(image)) {
                errors.push(`Image ${index + 1} must be a valid URL`);
            }
        });
    }
    
    return {
        valid: errors.length === 0,
        errors: errors
    };
}

/**
 * Validate contact submission data
 * @param {object} data - Contact submission data
 * @returns {object} - Validation result with valid flag and errors array
 */
function validateContactSubmission(data) {
    const errors = [];
    
    if (!data) {
        errors.push('Contact submission data is required');
        return { valid: false, errors };
    }
    
    // Validate name
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length < 2) {
        errors.push('Name is required and must be at least 2 characters');
    } else if (data.name.trim().length > 100) {
        errors.push('Name cannot exceed 100 characters');
    }
    
    // Validate email
    if (!data.email || !validateEmail(data.email)) {
        errors.push('Valid email address is required');
    }
    
    // Validate phone (optional)
    if (data.phone && typeof data.phone === 'string' && data.phone.trim()) {
        if (!validatePhone(data.phone)) {
            errors.push('Phone number must be in valid Zambian format');
        }
    }
    
    // Validate subject
    const validSubjects = ['product-inquiry', 'order-support', 'shipping', 'returns', 'business', 'other'];
    if (!data.subject || !validSubjects.includes(data.subject)) {
        errors.push('Valid subject is required');
    }
    
    // Validate message
    if (!data.message || typeof data.message !== 'string' || data.message.trim().length < 10) {
        errors.push('Message is required and must be at least 10 characters');
    } else if (data.message.trim().length > 2000) {
        errors.push('Message cannot exceed 2000 characters');
    }
    
    return {
        valid: errors.length === 0,
        errors: errors
    };
}

module.exports = {
    sanitizeString,
    sanitizeObject,
    validateEmail,
    validatePhone,
    validatePasswordStrength,
    validateRegister,
    validateLogin,
    validateForgotPasswordEmail,
    validateResetPassword,
    validateURL,
    validateProductId,
    validatePrice,
    validateStock,
    validatePagination,
    validateSearch,
    validateSort,
    validateFilters,
    validateOrder,
    validateProduct,
    validateContactSubmission
};

