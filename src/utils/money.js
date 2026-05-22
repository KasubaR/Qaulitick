/**
 * Shared money helpers used across services.
 */

/**
 * Round a number to 2 decimal places (banker-safe for values already at 2dp).
 * @param {number|string} x
 * @returns {number}
 */
function roundMoney2(x) {
    return Math.round(Number(x) * 100) / 100;
}

module.exports = { roundMoney2 };
