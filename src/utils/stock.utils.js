'use strict';

/**
 * Derive a stock status label from an available quantity and threshold.
 *
 * @param {number} qty       - Sellable units (product.stock, or color-capped where applicable).
 * @param {number} threshold - Low-stock threshold (defaults to 5).
 * @returns {'in-stock' | 'low-stock' | 'out-of-stock'}
 */
function getStockStatus(qty, threshold = 5) {
    const quantity = Number(qty) || 0;
    if (quantity <= 0) return 'out-of-stock';
    if (quantity <= threshold) return 'low-stock';
    return 'in-stock';
}

/**
 * Sellable units from the product row (uses `stock` only).
 * @param {object} productObj - Plain product row
 * @returns {number}
 */
function getSellableUnits(productObj) {
    return Math.max(0, Number(productObj && productObj.stock) || 0);
}

/**
 * Sellable units for a cart/API line: cap by color variant stock when present.
 * @param {object} productObj
 * @param {string|null|undefined} colorName
 * @returns {number}
 */
function getSellableUnitsForLine(productObj, colorName) {
    const base = getSellableUnits(productObj);
    if (!colorName || !Array.isArray(productObj.colors)) return base;
    const colorEntry = productObj.colors.find(c => c.name === colorName);
    if (!colorEntry || colorEntry.stock == null) return base;
    return Math.min(base, Math.max(0, Number(colorEntry.stock) || 0));
}

module.exports = { getStockStatus, getSellableUnits, getSellableUnitsForLine };
