const Product = require('../models/Product.model');
const { Op } = require('sequelize');

/**
 * SKU Generator Utility
 * 
 * Generates SKUs based on brand and model with automatic numbering
 */

/**
 * Generate SKU from brand and model
 * @param {String} brand - Product brand
 * @param {String} model - Product model
 * @param {Number} sequence - Optional sequence number (auto-incremented if not provided)
 * @returns {Promise<String>} Generated SKU
 */
async function generateSKU(brand, model, sequence = null) {
    if (!brand || !model) {
        throw new Error('Brand and model are required to generate SKU');
    }

    // Clean and format brand (first 3-5 letters, uppercase)
    const brandCode = cleanBrandCode(brand);
    
    // Clean and format model (first 3-5 letters, uppercase)
    const modelCode = cleanModelCode(model);
    
    // Generate base SKU
    const baseSKU = `${brandCode}-${modelCode}`;
    
    // If sequence not provided, find the next available number
    if (sequence === null) {
        sequence = await getNextSequenceNumber(baseSKU);
    }
    
    // Format sequence as 3-digit number (001, 002, etc.)
    const sequenceStr = String(sequence).padStart(3, '0');
    
    return `${baseSKU}-${sequenceStr}`;
}

/**
 * Clean brand name to create brand code
 * @param {String} brand - Brand name
 * @returns {String} Brand code (3-5 uppercase letters)
 */
function cleanBrandCode(brand) {
    // Remove special characters, keep only letters and numbers
    let cleaned = brand.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    
    // Take first 3-5 characters
    // Common brands: ROLEX (5), OMEGA (5), TAG (3), CARTIER (7 -> CART)
    if (cleaned.length <= 5) {
        return cleaned;
    }
    
    // For longer brands, use abbreviation
    const abbreviations = {
        'AUDEMARSPIGUET': 'AP',
        'AUDEMARS': 'AP',
        'PATEKPHILIPPE': 'PATEK',
        'CARTIER': 'CART',
        'TAGHEUER': 'TAG',
        'BREITLING': 'BREIT',
        'IWC': 'IWC',
        'JAEGERLECOULTRE': 'JLC',
        'VACHERONCONSTANTIN': 'VC'
    };
    
    if (abbreviations[cleaned]) {
        return abbreviations[cleaned];
    }
    
    // Default: take first 4-5 characters
    return cleaned.substring(0, 5);
}

/**
 * Clean model name to create model code
 * @param {String} model - Model name
 * @returns {String} Model code (3-5 uppercase letters)
 */
function cleanModelCode(model) {
    // Remove special characters, keep only letters and numbers
    let cleaned = model.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    
    // Common model abbreviations
    const abbreviations = {
        'SUBMARINER': 'SUB',
        'SPEEDMASTER': 'SPEED',
        'CARRERA': 'CAR',
        'SANTOS': 'SANT',
        'ROYALOAK': 'RO',
        'NAUTILUS': 'NAUT',
        'DAYTONA': 'DAYT',
        'GMTMASTER': 'GMT',
        'SEAMASTER': 'SEA',
        'AQUARACER': 'AQUA',
        'EXPLORER': 'EXPL',
        'YACHTMASTER': 'YACHT'
    };
    
    // Check for exact match
    if (abbreviations[cleaned]) {
        return abbreviations[cleaned];
    }
    
    // Check for partial match (e.g., "SUBMARINER DATE" -> "SUB")
    for (const [key, value] of Object.entries(abbreviations)) {
        if (cleaned.includes(key)) {
            return value;
        }
    }
    
    // Default: take first 3-5 characters
    if (cleaned.length <= 5) {
        return cleaned;
    }
    
    // For longer models, take first 4-5 characters
    return cleaned.substring(0, 5);
}

/**
 * Get next sequence number for a base SKU
 * @param {String} baseSKU - Base SKU (e.g., "ROLEX-SUB")
 * @returns {Promise<Number>} Next sequence number
 */
async function getNextSequenceNumber(baseSKU) {
    try {
        // Find all products with SKU starting with baseSKU
        const products = await Product.findAll({
            where: { sku: { [Op.like]: `${baseSKU}-%` } },
            attributes: ['sku']
        });
        
        if (products.length === 0) {
            return 1; // First product
        }
        
        // Extract sequence numbers
        const sequences = products
            .map(p => {
                const match = p.sku.match(/-(\d+)$/);
                return match ? parseInt(match[1]) : 0;
            })
            .filter(n => !isNaN(n));
        
        if (sequences.length === 0) {
            return 1;
        }
        
        // Return next sequence number
        return Math.max(...sequences) + 1;
    } catch (error) {
        console.error('Error getting next sequence number:', error);
        return 1; // Default to 1 on error
    }
}

/**
 * Validate SKU format
 * @param {String} sku - SKU to validate
 * @returns {Boolean} True if valid format
 */
function validateSKUFormat(sku) {
    // Format: BRAND-MODEL-NUMBER (e.g., ROLEX-SUB-001)
    const pattern = /^[A-Z0-9]{2,10}-[A-Z0-9]{2,10}-\d{3,6}$/;
    return pattern.test(sku);
}

/**
 * Check if SKU is available (not already in use)
 * @param {String} sku - SKU to check
 * @param {String} excludeId - Optional product ID to exclude from check (for updates)
 * @returns {Promise<Boolean>} True if available
 */
async function isSKUAvailable(sku, excludeId = null) {
    try {
        const where = { sku: String(sku).toUpperCase() };
        if (excludeId !== null && excludeId !== undefined && excludeId !== '') {
            const pk = parseInt(String(excludeId), 10);
            // Exclude the current product record when checking availability during updates.
            if (!Number.isNaN(pk)) where.id = { [Op.ne]: pk };
        }

        const existing = await Product.findOne({ where });
        return !existing;
    } catch (error) {
        console.error('Error checking SKU availability:', error);
        return false;
    }
}

module.exports = {
    generateSKU,
    cleanBrandCode,
    cleanModelCode,
    getNextSequenceNumber,
    validateSKUFormat,
    isSKUAvailable
};

