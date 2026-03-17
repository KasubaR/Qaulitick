/**
 * Review Service
 * 
 * Handles review-related business logic:
 * - Purchase verification
 * - Duplicate review prevention
 * - Review data sanitization
 */

const Order = require('../models/Order.model');
const Product = require('../models/Product.model');

// Valid order statuses that indicate a successful purchase
const VALID_STATUSES = ['paid', 'confirmed', 'processing', 'packed', 'shipped', 'delivered'];

class ReviewService {
    /**
     * Verify if a customer has purchased a product
     * @param {String} productId - Product ID
     * @param {String} email - Customer email
     * @returns {Promise<Object|null>} - Returns order info if verified, null otherwise
     */
    async verifyPurchase(productId, email) {
        try {
            // Convert productId to string for comparison (Order stores productId as String)
            const productIdStr = String(productId);
            const normalizedEmail = email.toLowerCase().trim();
            
            // Use findOne() to get order details (exists() doesn't return orderNumber)
            // Optimized query: uses indexes on customer.email and status
            const order = await Order.findOne({
                'customer.email': normalizedEmail,
                'items.productId': productIdStr,
                status: { $in: VALID_STATUSES }
            }).select('orderNumber status').lean();

            if (order) {
                return {
                    verified: true,
                    orderNumber: order.orderNumber
                };
            }

            // Log failed verification attempts for analytics (non-blocking)
            // This helps identify potential issues or abuse patterns
            if (process.env.NODE_ENV === 'production') {
                // In production, you might want to log to analytics service
                // For now, we'll just log to console in development
                console.log(`[Review Service] Purchase verification failed: productId=${productIdStr}, email=${normalizedEmail.substring(0, 5)}...`);
            }

            return null;
        } catch (error) {
            console.error('[Review Service] Error verifying purchase:', error);
            throw error;
        }
    }

    /**
     * Check if a duplicate review exists for this product
     * @param {String} productId - Product ID
     * @param {String} email - Customer email
     * @param {String} ipAddress - Customer IP address
     * @returns {Promise<Object>} - Returns { exists: boolean, reason?: string }
     */
    async checkDuplicateReview(productId, email, ipAddress) {
        try {
            // Optimized: Only select reviews array, not entire product document
            const product = await Product.findById(productId).select('reviews.email reviews.ipAddress').lean();
            if (!product) {
                return { exists: true, reason: 'Product not found' };
            }

            const normalizedEmail = email.toLowerCase().trim();

            // Multi-layer duplicate detection
            // Check by email (indexed for fast lookup)
            const emailExists = product.reviews && product.reviews.some(r => 
                r.email && r.email.toLowerCase() === normalizedEmail
            );

            // Check by IP (for guest users, also indexed)
            const ipExists = product.reviews && product.reviews.some(r => 
                r.ipAddress && r.ipAddress === ipAddress
            );

            if (emailExists || ipExists) {
                return {
                    exists: true,
                    reason: emailExists ? 'Email already reviewed' : 'IP already reviewed'
                };
            }

            return { exists: false };
        } catch (error) {
            console.error('[Review Service] Error checking duplicate review:', error);
            throw error;
        }
    }

    /**
     * Sanitize review data
     * @param {Object} data - Review data
     * @returns {Object} - Sanitized review data
     */
    sanitizeReviewData(data) {
        const { sanitizeObject } = require('../utils/validators');
        
        // Sanitize the data
        const sanitized = sanitizeObject({
            name: (data.name || '').trim().substring(0, 100),
            email: (data.email || '').toLowerCase().trim(),
            title: (data.title || '').trim().substring(0, 100),
            comment: (data.comment || '').trim().substring(0, 1000),
            rating: parseInt(data.rating) || 0
        });

        return sanitized;
    }

    /**
     * Validate review data
     * @param {Object} data - Review data
     * @returns {Object} - { valid: boolean, errors: string[] }
     */
    validateReviewData(data) {
        const errors = [];
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!data.name || data.name.trim().length === 0) {
            errors.push('Name is required');
        }
        if (data.name && data.name.length > 100) {
            errors.push('Name cannot exceed 100 characters');
        }

        if (!data.email || data.email.trim().length === 0) {
            errors.push('Email is required');
        } else if (!emailRegex.test(data.email)) {
            errors.push('Invalid email format');
        }

        if (!data.title || data.title.trim().length === 0) {
            errors.push('Review title is required');
        }
        if (data.title && data.title.length > 100) {
            errors.push('Title cannot exceed 100 characters');
        }

        if (!data.comment || data.comment.trim().length === 0) {
            errors.push('Review comment is required');
        }
        if (data.comment && data.comment.length > 1000) {
            errors.push('Comment cannot exceed 1000 characters');
        }

        if (!data.rating || data.rating < 1 || data.rating > 5) {
            errors.push('Rating must be between 1 and 5');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}

// Create singleton instance
const reviewService = new ReviewService();

module.exports = reviewService;

