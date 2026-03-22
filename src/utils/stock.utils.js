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

module.exports = { getStockStatus };
