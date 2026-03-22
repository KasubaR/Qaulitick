// Price Calculation Utilities (Server-side only)

/**
 * Parse a monetary value from DB/API (decimal string, number, etc.)
 * @param {*} value
 * @returns {number} finite number or NaN
 */
function parseMoney(value) {
    if (value == null || value === '') return NaN;
    const n = parseFloat(String(value).replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : NaN;
}

/**
 * Calculate final price after discount (server-side)
 * @param {number|string} price - Original price
 * @param {number} discount - Discount percentage
 * @returns {number} - Final price
 */
function calculateFinalPrice(price, discount) {
    const p = parseMoney(price);
    if (!Number.isFinite(p) || p <= 0) return 0;
    const discountAmount = discount || 0;
    return Math.round(p * (1 - discountAmount / 100));
}

/**
 * Calculate savings amount
 * @param {number} price - Original price
 * @param {number} discount - Discount percentage
 * @returns {number} - Savings amount
 */
function calculateSavings(price, discount) {
    if (!price || price <= 0 || !discount || discount <= 0) return 0;
    return Math.round(price * (discount / 100));
}

/**
 * Calculate subtotal from items
 * @param {array} items - Array of items with price and quantity
 * @returns {number} - Subtotal
 */
function calculateSubtotal(items) {
    if (!Array.isArray(items)) return 0;
    return items.reduce((sum, item) => {
        const price = parseFloat(item.price) || 0;
        const quantity = parseInt(item.quantity) || 1;
        return sum + (price * quantity);
    }, 0);
}

/**
 * Calculate total with discount and delivery
 * @param {number} subtotal - Subtotal
 * @param {number} discount - Discount amount
 * @param {number} delivery - Delivery fee
 * @returns {number} - Total
 */
function calculateTotal(subtotal, discount = 0, delivery = 0) {
    return Math.max(0, subtotal - discount + delivery);
}

module.exports = {
    parseMoney,
    calculateFinalPrice,
    calculateSavings,
    calculateSubtotal,
    calculateTotal
};

