// Price Calculation Utilities (Server-side only)

/**
 * Calculate final price after discount (server-side)
 * Use when the base amount is the **pre-discount** list price and you need to apply a % off
 * (e.g. flash sale on top of catalogue price). Do not use for normal products: DB `price` is
 * already the selling price — use {@link getSellingUnitPrice} instead.
 * @param {number} price - Original price
 * @param {number} discount - Discount percentage
 * @returns {number} - Final price
 */
function calculateFinalPrice(price, discount) {
    if (!price || price <= 0) return 0;
    const discountAmount = discount || 0;
    return Math.round(price * (1 - discountAmount / 100));
}

/**
 * Authoritative unit price from the product row for cart, checkout, and orders.
 * `price` is the current selling amount; `discount` is informational (badge % derived from
 * original vs price in Product hooks) and must not be applied again.
 * @param {object} productObj - Plain product object with `price`
 * @returns {number}
 */
function getSellingUnitPrice(productObj) {
    const p = Number(productObj && productObj.price);
    if (!p || p <= 0) return 0;
    return Math.round(p);
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
    calculateFinalPrice,
    getSellingUnitPrice,
    calculateSavings,
    calculateSubtotal,
    calculateTotal
};

