// Error Handling Middleware

const logger = require('../utils/logger').child({ module: 'ErrorMiddleware' });

/**
 * Custom Error Classes
 */
class AppError extends Error {
    constructor(message, statusCode, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        
        Error.captureStackTrace(this, this.constructor);
    }
}

class NotFoundError extends AppError {
    constructor(message = 'Resource not found') {
        super(message, 404);
    }
}

class NoProductsError extends AppError {
    constructor(message = 'No products found') {
        super(message, 404);
    }
}

class ServerError extends AppError {
    constructor(message = 'Internal server error') {
        super(message, 500);
    }
}

class NetworkError extends AppError {
    constructor(message = 'Network request failed') {
        super(message, 503);
    }
}

/**
 * Error Handler Middleware
 * Must be used after all routes
 */
function errorHandler(err, req, res, next) {
    // If a response is already underway (e.g. the client disconnected mid-stream,
    // or a handler already wrote a partial response before erroring), writing
    // headers/body again throws ERR_HTTP_HEADERS_SENT. Hand off to Express's
    // default handler, which just closes the connection in that case.
    if (res.headersSent) {
        return next(err);
    }

    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    // Log error
    console.error(`[Error Handler] ${err.statusCode} - ${err.message}`);
    if (err.stack && process.env.NODE_ENV === 'development') {
        console.error(err.stack);
    }

    // Only expose the raw message for operational errors (intentional AppError throws).
    // Non-operational errors (Sequelize, third-party libs, uncaught exceptions) may
    // contain table names, column names, internal URLs, or API keys — hide them in prod.
    const isOperational = err.isOperational === true;
    const safeMessage = (isOperational || process.env.NODE_ENV === 'development')
        ? err.message
        : 'An unexpected error occurred.';

    // Determine if it's an API request or page request
    const isAPIRequest = req.path.startsWith('/api') || req.xhr || req.accepts(['json', 'html']) === 'json';

    if (isAPIRequest) {
        // API Error Response
        return res.status(err.statusCode).json({
            success: false,
            status: err.status,
            message: safeMessage,
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        });
    } else {
        // Page Error Response
        const errorPage = getErrorPage(err.statusCode);
        return res.status(err.statusCode).render(errorPage, {
            title: `${err.statusCode} - ${getErrorTitle(err.statusCode)}`,
            page: 'error',
            message: safeMessage,
            statusCode: err.statusCode,
            errorType: getErrorType(err.statusCode)
        });
    }
}

/**
 * 404 Not Found Handler
 * Must be used after all routes
 */
function notFoundHandler(req, res, next) {
    const isAPIRequest = req.path.startsWith('/api') || req.xhr || req.accepts(['json', 'html']) === 'json';
    
    if (isAPIRequest) {
        return res.status(404).json({
            success: false,
            status: 'fail',
            message: `API endpoint ${req.path} not found`
        });
    }
    
    res.status(404).render('404', {
        title: '404 - Page Not Found',
        page: '404',
        message: `The page "${req.path}" was not found.`
    });
}

/**
 * No Products Found Handler
 */
function handleNoProducts(req, res, message = 'No products found matching your criteria') {
    const isAPIRequest = req.path.startsWith('/api') || req.xhr || req.accepts(['json', 'html']) === 'json';
    
    if (isAPIRequest) {
        return res.status(404).json({
            success: false,
            status: 'fail',
            message: message,
            products: [],
            pagination: {
                currentPage: 1,
                totalPages: 0,
                totalProducts: 0,
                limit: 12,
                hasNextPage: false,
                hasPrevPage: false
            }
        });
    }
    
    // For page requests, pass empty products array
    // The view will handle displaying the friendly message
    return {
        products: [],
        noProductsMessage: message
    };
}

/**
 * Get error page template name
 */
function getErrorPage(statusCode) {
    switch (statusCode) {
        case 404:
            return '404';
        case 500:
        case 503:
            return '500';
        default:
            return '500';
    }
}

/**
 * Get error title
 */
function getErrorTitle(statusCode) {
    switch (statusCode) {
        case 404:
            return 'Page Not Found';
        case 500:
            return 'Server Error';
        case 503:
            return 'Service Unavailable';
        default:
            return 'Error';
    }
}

/**
 * Get error type
 */
function getErrorType(statusCode) {
    switch (statusCode) {
        case 404:
            return 'not-found';
        case 500:
            return 'server-error';
        case 503:
            return 'network-error';
        default:
            return 'error';
    }
}

/**
 * Async Error Wrapper
 * Wraps async route handlers to catch errors
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Retry Mechanism for Network Requests
 */
async function retryRequest(fn, maxRetries = 3, delay = 1000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            // Don't retry on client errors (4xx)
            if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
                throw error;
            }
            
            // Don't retry on last attempt
            if (attempt === maxRetries) {
                break;
            }
            
            // Exponential backoff
            const waitTime = delay * Math.pow(2, attempt - 1);
            logger.warn({ attempt, maxRetries, waitTime }, 'Retrying failed request');
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
    
    throw new NetworkError(`Request failed after ${maxRetries} attempts: ${lastError.message}`);
}

module.exports = {
    AppError,
    NotFoundError,
    NoProductsError,
    ServerError,
    NetworkError,
    errorHandler,
    notFoundHandler,
    handleNoProducts,
    asyncHandler,
    retryRequest
};

