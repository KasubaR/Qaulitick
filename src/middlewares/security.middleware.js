// Security Middleware
// Input sanitization, rate limiting, XSS protection

const { sanitizeObject, validatePagination, validateSearch, validateSort, validateFilters } = require('../utils/validators');
const redisStore = require('../utils/redis.store');

// In-memory rate limiting store (fallback when Redis is not available)
const inMemoryStore = new Map();

/**
 * Rate Limiting Middleware
 * Uses Redis for production, falls back to in-memory store for development
 * @param {object} options - Rate limit options
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.max - Maximum requests per window
 * @param {string} options.message - Error message
 * @param {Function} options.keyGenerator - Optional custom key generator function
 * @returns {Function} - Express middleware
 */
function rateLimit(options = {}) {
    const {
        windowMs = 15 * 60 * 1000, // 15 minutes default
        max = 100, // 100 requests per window default
        message = 'Too many requests, please try again later.',
        keyGenerator = null // Optional custom key generator function
    } = options;
    
    return async (req, res, next) => {
        try {
            // Better IP detection (handles proxies)
            const ip = req.ip || 
                       req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                       req.connection?.remoteAddress || 
                       req.socket?.remoteAddress ||
                       'unknown';
            
            // Generate rate limit key: include route path to prevent cross-route interference
            // Use custom key generator if provided, otherwise use IP + actual request path
            // Use req.path (actual path) instead of req.route.path (template path) for dynamic routes
            const routePath = req.path || req.route?.path || 'unknown';
            const key = keyGenerator ? keyGenerator(req) : `${ip}:${routePath}`;
            
            const now = Date.now();
            
            // Use Redis store if available, otherwise use in-memory store
            const useRedis = redisStore.isRedisAvailable();
            const store = useRedis ? redisStore : inMemoryStore;
            
            // Clean expired entries (only for in-memory store, Redis handles TTL automatically)
            if (!useRedis && inMemoryStore.size > 0 && Math.random() < 0.1) {
                for (const [storeKey, data] of inMemoryStore.entries()) {
                    if (now - data.resetTime > windowMs) {
                        inMemoryStore.delete(storeKey);
                    }
                }
            }
            
            // Get or create rate limit data
            let rateLimitData;
            if (useRedis) {
                rateLimitData = await redisStore.get(key);
            } else {
                rateLimitData = inMemoryStore.get(key);
            }
            
            // Reset if expired or doesn't exist
            if (!rateLimitData || (now - rateLimitData.resetTime) > windowMs) {
                rateLimitData = {
                    count: 0,
                    resetTime: now
                };
            }
            
            // Check if limit exceeded
            if (rateLimitData.count >= max) {
                const retryAfter = Math.ceil((windowMs - (now - rateLimitData.resetTime)) / 1000);
                
                res.set({
                    'Retry-After': retryAfter,
                    'X-RateLimit-Limit': max,
                    'X-RateLimit-Remaining': 0,
                    'X-RateLimit-Reset': new Date(rateLimitData.resetTime + windowMs).toISOString()
                });
                
                return res.status(429).json({
                    success: false,
                    message: message,
                    retryAfter: retryAfter
                });
            }
            
            // Increment count
            rateLimitData.count++;
            
            // Save to store
            if (useRedis) {
                await redisStore.set(key, rateLimitData, windowMs);
            } else {
                inMemoryStore.set(key, rateLimitData);
            }
            
            // Set rate limit headers
            res.set({
                'X-RateLimit-Limit': max,
                'X-RateLimit-Remaining': Math.max(0, max - rateLimitData.count),
                'X-RateLimit-Reset': new Date(rateLimitData.resetTime + windowMs).toISOString()
            });
            
            next();
        } catch (error) {
            // If Redis fails, log error but allow request through (fail open)
            console.error('[Rate Limit] Error in rate limiting middleware:', error.message);
            // Continue without rate limiting on error
            next();
        }
    };
}

/**
 * Input Sanitization Middleware
 * Sanitizes req.body, req.query, and req.params
 * Skips multipart/form-data requests (handled by multer)
 */
function sanitizeInput(req, res, next) {
    // Skip sanitization for multipart/form-data (file uploads)
    // Multer will handle these requests
    if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
        return next();
    }
    
    // Sanitize query parameters
    if (req.query) {
        req.query = sanitizeObject(req.query);
    }
    
    // Sanitize body parameters
    if (req.body) {
        req.body = sanitizeObject(req.body);
    }
    
    // Sanitize route parameters
    if (req.params) {
        req.params = sanitizeObject(req.params);
    }
    
    next();
}

/**
 * Query Parameter Validation Middleware
 * Validates and sanitizes query parameters for API endpoints
 */
function validateQueryParams(req, res, next) {
    // Validate pagination
    if (req.query.page || req.query.limit) {
        const pagination = validatePagination(req.query);
        req.query.page = pagination.page;
        req.query.limit = pagination.limit;
    }
    
    // Validate search
    if (req.query.search) {
        req.query.search = validateSearch(req.query.search);
    }
    
    // Validate sort
    if (req.query.sort) {
        req.query.sort = validateSort(req.query.sort);
    }
    
    // Validate filters
    const validatedFilters = validateFilters(req.query);
    Object.assign(req.query, validatedFilters);
    
    next();
}

/**
 * XSS Protection Middleware
 * Sets security headers and validates content
 */
function xssProtection(req, res, next) {
    // Set security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Content Security Policy (CSP)
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://fonts.googleapis.com https://www.googletagmanager.com",
        "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://fonts.googleapis.com",
        "img-src 'self' data: https: http:",
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
        "connect-src 'self' https://www.google-analytics.com https://www.googletagmanager.com",
        "frame-ancestors 'none'"
    ].join('; '));
    
    next();
}

/**
 * Request Size Limiting Middleware
 * Prevents large payload attacks
 */
function limitRequestSize(maxSize = '10mb') {
    return (req, res, next) => {
        const contentLength = req.get('content-length');
        
        if (contentLength) {
            const sizeInBytes = parseInt(contentLength);
            const maxSizeInBytes = parseSize(maxSize);
            
            if (sizeInBytes > maxSizeInBytes) {
                return res.status(413).json({
                    success: false,
                    message: `Request payload too large. Maximum size is ${maxSize}.`
                });
            }
        }
        
        next();
    };
}

/**
 * Parse size string to bytes
 */
function parseSize(size) {
    const units = {
        'kb': 1024,
        'mb': 1024 * 1024,
        'gb': 1024 * 1024 * 1024
    };
    
    const match = size.toLowerCase().match(/^(\d+)(kb|mb|gb)$/);
    if (match) {
        return parseInt(match[1]) * units[match[2]];
    }
    
    return 10 * 1024 * 1024; // Default 10MB
}

/**
 * SQL Injection Protection
 * Validates that input doesn't contain SQL injection patterns
 */
function sqlInjectionProtection(req, res, next) {
    const sqlPatterns = [
        /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/gi,
        /('|(\\')|(;)|(\\)|(\/\*)|(\*\/)|(\-\-)|(\+)|(\%27)|(\%22))/gi
    ];
    
    const checkValue = (value) => {
        if (typeof value === 'string') {
            return sqlPatterns.some(pattern => pattern.test(value));
        }
        if (typeof value === 'object' && value !== null) {
            return Object.values(value).some(checkValue);
        }
        return false;
    };
    
    // Check query, body, and params
    const allInputs = { ...req.query, ...req.body, ...req.params };
    
    if (checkValue(allInputs)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid input detected'
        });
    }
    
    next();
}

/**
 * Clear rate limit for a specific IP or key (useful for debugging)
 * @param {string} ipOrKey - IP address or rate limit key to clear
 * @returns {Promise<boolean>} Success status
 */
async function clearRateLimit(ipOrKey) {
    try {
        const useRedis = redisStore.isRedisAvailable();
        
        if (ipOrKey) {
            // Try exact match first
            if (useRedis) {
                const exists = await redisStore.get(ipOrKey);
                if (exists) {
                    await redisStore.del(ipOrKey);
                    return true;
                }
            } else {
                if (inMemoryStore.has(ipOrKey)) {
                    inMemoryStore.delete(ipOrKey);
                    return true;
                }
            }
            
            // Try to find keys matching the pattern
            const pattern = `*${ipOrKey}*`;
            if (useRedis) {
                const deleted = await redisStore.delPattern(pattern);
                return deleted > 0;
            } else {
                let deleted = false;
                for (const [key] of inMemoryStore.entries()) {
                    if (key.includes(ipOrKey)) {
                        inMemoryStore.delete(key);
                        deleted = true;
                    }
                }
                return deleted;
            }
        } else {
            // Clear all
            if (useRedis) {
                await redisStore.clear();
            } else {
                inMemoryStore.clear();
            }
            return true;
        }
    } catch (error) {
        console.error('[Rate Limit] Error clearing rate limit:', error.message);
        return false;
    }
}

/**
 * Get rate limit status for an IP or key (useful for debugging)
 * @param {string} ipOrKey - IP address or rate limit key to check
 * @returns {Promise<object|null>} - Rate limit data or null
 */
async function getRateLimitStatus(ipOrKey) {
    if (!ipOrKey) return null;
    
    try {
        const useRedis = redisStore.isRedisAvailable();
        
        // Try exact match first
        if (useRedis) {
            const data = await redisStore.get(ipOrKey);
            if (data) return data;
        } else {
            if (inMemoryStore.has(ipOrKey)) {
                return inMemoryStore.get(ipOrKey);
            }
        }
        
        // Try to find keys matching the pattern
        const pattern = `*${ipOrKey}*`;
        if (useRedis) {
            const keys = await redisStore.keys(pattern);
            if (keys.length > 0) {
                return await redisStore.get(keys[0]);
            }
        } else {
            for (const [key, data] of inMemoryStore.entries()) {
                if (key.includes(ipOrKey)) {
                    return data;
                }
            }
        }
        
        return null;
    } catch (error) {
        console.error('[Rate Limit] Error getting rate limit status:', error.message);
        return null;
    }
}

/**
 * Clean all expired entries from rate limit store
 * Note: Redis handles TTL automatically, so this only affects in-memory store
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Promise<number>} Number of entries cleaned
 */
async function cleanExpiredRateLimits(windowMs = 15 * 60 * 1000) {
    try {
        const useRedis = redisStore.isRedisAvailable();
        
        if (useRedis) {
            // Redis handles TTL automatically, but we can still check for expired keys
            // This is mainly for in-memory fallback
            return 0;
        }
        
        const now = Date.now();
        let cleaned = 0;
        for (const [key, data] of inMemoryStore.entries()) {
            if (now - data.resetTime > windowMs) {
                inMemoryStore.delete(key);
                cleaned++;
            }
        }
        return cleaned;
    } catch (error) {
        console.error('[Rate Limit] Error cleaning expired rate limits:', error.message);
        return 0;
    }
}

/**
 * Get all rate limit entries (for debugging)
 * @returns {Promise<Array>} Array of {key, data} objects
 */
async function getAllRateLimitEntries() {
    try {
        const useRedis = redisStore.isRedisAvailable();
        
        if (useRedis) {
            const keys = await redisStore.keys('*');
            const entries = [];
            for (const key of keys) {
                const data = await redisStore.get(key);
                if (data) {
                    entries.push({ key, data });
                }
            }
            return entries;
        }
        
        return Array.from(inMemoryStore.entries()).map(([key, data]) => ({ key, data }));
    } catch (error) {
        console.error('[Rate Limit] Error getting all rate limit entries:', error.message);
        return [];
    }
}

module.exports = {
    rateLimit,
    sanitizeInput,
    validateQueryParams,
    xssProtection,
    limitRequestSize,
    sqlInjectionProtection,
    clearRateLimit,
    getRateLimitStatus,
    cleanExpiredRateLimits,
    getAllRateLimitEntries
};

