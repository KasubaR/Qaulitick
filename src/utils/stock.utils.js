'use strict';

/**
 * Derive a stock status label from an available quantity and threshold.
 * Pass (stock - reservedStock), not raw stock, so reservations are reflected.
 *
 * @param {number} qty       - Available stock (stock - reservedStock).
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
 * Units actually sellable: physical stock minus soft-reservations from unpaid/pending orders.
 * @param {object} productObj - Plain product row ({ stock, reservedStock })
 * @returns {number}
 */
function getSellableUnits(productObj) {
    const physical = Math.max(0, Number(productObj && productObj.stock) || 0);
    const reserved = Math.max(0, Number(productObj && productObj.reservedStock) || 0);
    return Math.max(0, physical - reserved);
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
