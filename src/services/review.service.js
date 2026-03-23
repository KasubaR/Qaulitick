/**
 * Review Service
 * 
 * Handles review-related business logic:
 * - Purchase verification
 * - Duplicate review prevention
 * - Review data sanitization
 */

const { Op, literal } = require('sequelize');
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
            const productIdStr = String(productId);
            const normalizedEmail = email.toLowerCase().trim();

            // Query orders where customer.email matches and items contains productId
            const order = await Order.findOne({
                where: {
                    status: { [Op.in]: VALID_STATUSES },
                    [Op.and]: [
                        literal(`JSON_UNQUOTE(JSON_EXTRACT(customer, '$.email')) = ${Order.sequelize.escape(normalizedEmail)}`),
                        literal(`JSON_SEARCH(items, 'one', ${Order.sequelize.escape(productIdStr)}, NULL, '$[*].productId') IS NOT NULL`)
                    ]
                },
                attributes: ['orderNumber', 'status']
            });

            if (order) {
                return {
                    verified: true,
                    orderNumber: order.orderNumber
                };
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
    async checkDuplicateReview(productId, email, ipAddress, userId = null) {
        try {
            const product = await Product.findByPk(productId, { attributes: ['reviews'] });
            if (!product) {
                return { exists: true, reason: 'Product not found' };
            }

            const reviews = product.reviews || [];
            const normalizedEmail = email.toLowerCase().trim();

            // Multi-layer duplicate detection
            const emailExists = reviews.some(r =>
                r.email && r.email.toLowerCase() === normalizedEmail
            );

            const ipExists = reviews.some(r =>
                r.ipAddress && r.ipAddress === ipAddress
            );

            // Check by userId for logged-in users
            const userIdExists = userId != null && reviews.some(r =>
                r.userId != null && r.userId === userId
            );

            if (emailExists || ipExists || userIdExists) {
                return {
                    exists: true,
                    reason: emailExists ? 'Email already reviewed' : userIdExists ? 'Account already reviewed' : 'IP already reviewed'
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

