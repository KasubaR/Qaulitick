/**
 * Slug Generator Utility
 * 
 * Generates URL-friendly slugs from text strings
 */

/**
 * Generate a URL-friendly slug from text
 * @param {String} text - Text to convert to slug
 * @param {Object} options - Options for slug generation
 * @param {String} options.separator - Separator character (default: '-')
 * @param {Number} options.maxLength - Maximum length of slug (default: 100)
 * @param {Boolean} options.lowercase - Convert to lowercase (default: true)
 * @returns {String} Generated slug
 */
function generateSlug(text, options = {}) {
    if (!text || typeof text !== 'string') {
        return '';
    }

    const {
        separator = '-',
        maxLength = 100,
        lowercase = true
    } = options;

    // Convert to lowercase if specified
    let slug = lowercase ? text.toLowerCase() : text;

    // Remove accents/diacritics
    slug = slug.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Replace spaces and underscores with separator
    slug = slug.replace(/[\s_]+/g, separator);

    // Remove special characters, keep only alphanumeric and separator
    slug = slug.replace(/[^a-z0-9\-]/gi, separator);

    // Replace multiple consecutive separators with single separator
    slug = slug.replace(new RegExp(`[${separator}]+`, 'g'), separator);

    // Remove leading and trailing separators
    slug = slug.replace(new RegExp(`^[${separator}]+|[${separator}]+$`, 'g'), '');

    // Truncate to max length
    if (slug.length > maxLength) {
        slug = slug.substring(0, maxLength);
        // Remove trailing separator if truncated
        slug = slug.replace(new RegExp(`[${separator}]+$`, 'g'), '');
    }

    return slug;
}

/**
 * Generate a unique slug by appending a number suffix if needed
 * @param {String} baseSlug - Base slug
 * @param {Number} suffix - Suffix number to append
 * @returns {String} Slug with suffix
 */
function generateSlugWithSuffix(baseSlug, suffix = 1) {
    if (suffix === 1) {
        return baseSlug;
    }
    return `${baseSlug}-${suffix}`;
}

/**
 * Validate slug format
 * @param {String} slug - Slug to validate
 * @returns {Object} Validation result { valid: boolean, errors: array }
 */
function validateSlug(slug) {
    const errors = [];

    if (!slug || slug.trim().length === 0) {
        errors.push('Slug cannot be empty');
    }

    // Check for invalid characters
    if (!/^[a-z0-9\-]+$/.test(slug)) {
        errors.push('Slug can only contain lowercase letters, numbers, and hyphens');
    }

    // Check for leading/trailing hyphens
    if (slug.startsWith('-') || slug.endsWith('-')) {
        errors.push('Slug cannot start or end with a hyphen');
    }

    // Check for consecutive hyphens
    if (slug.includes('--')) {
        errors.push('Slug cannot contain consecutive hyphens');
    }

    // Check length
    if (slug.length > 100) {
        errors.push('Slug cannot exceed 100 characters');
    }

    return {
        valid: errors.length === 0,
        errors: errors
    };
}

module.exports = {
    generateSlug,
    generateSlugWithSuffix,
    validateSlug
};

