// SEO Utility Functions

/**
 * Generate SEO-friendly slug from string
 * @param {string} text - Text to convert to slug
 * @returns {string} - SEO-friendly slug
 */
function generateSlug(text) {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')           // Replace spaces with hyphens
        .replace(/[^\w\-]+/g, '')       // Remove special characters
        .replace(/\-\-+/g, '-')         // Replace multiple hyphens with single
        .replace(/^-+/, '')              // Remove leading hyphens
        .replace(/-+$/, '');             // Remove trailing hyphens
}

/**
 * Generate product URL slug
 * @param {string} model - Product model name
 * @param {string} id - Product ID
 * @returns {string} - SEO-friendly URL slug
 */
function generateProductSlug(model, id) {
    const slug = generateSlug(model);
    return `${slug}-${id}`;
}

/**
 * Extract product ID from slug
 * @param {string} slug - Product slug
 * @returns {string} - Product ID
 */
function extractProductIdFromSlug(slug) {
    // Slug format: "product-name-123" -> extract "123"
    const parts = slug.split('-');
    return parts[parts.length - 1];
}

/**
 * Generate meta description from product
 * @param {object} product - Product object
 * @returns {string} - Meta description
 */
function generateMetaDescription(product) {
    if (product.description) {
        // Take first 155 characters of description
        return product.description.substring(0, 155).trim() + '...';
    }
    return `Buy ${product.model} - ${product.brand} luxury watch. ${product.gender} watch with ${product.rating || 0} star rating. Free shipping worldwide.`;
}

/**
 * Generate keywords from product
 * @param {object} product - Product object
 * @returns {string} - Comma-separated keywords
 */
function generateKeywords(product) {
    const keywords = [
        product.model,
        product.brand,
        product.gender,
        product.color,
        product.strap,
        'luxury watch',
        'AAA replica',
        'premium watch'
    ].filter(Boolean);
    
    return keywords.join(', ');
}

module.exports = {
    generateSlug,
    generateProductSlug,
    extractProductIdFromSlug,
    generateMetaDescription,
    generateKeywords
};

