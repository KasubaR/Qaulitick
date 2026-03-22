/**
 * When a product has named color variants, total `stock` is the sum of each color's stock.
 * Mutates the payload so DB and checkout always see a consistent aggregate.
 *
 * @param {object} data - Sanitized product body (may be mutated)
 */
function normalizeProductStockFromColors(data) {
    if (!data || !Array.isArray(data.colors)) {
        return;
    }
    const named = data.colors.filter(
        (c) => c && typeof c.name === 'string' && c.name.trim().length > 0
    );
    if (named.length === 0) {
        return;
    }
    let sum = 0;
    for (const c of named) {
        const n = parseInt(c.stock, 10);
        if (Number.isNaN(n) || n < 0) {
            continue;
        }
        sum += n;
    }
    data.stock = sum;
}

module.exports = {
    normalizeProductStockFromColors
};
