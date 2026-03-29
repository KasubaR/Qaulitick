// Cart Utilities (Server-side)
// Helper functions for parsing and validating cart data from cookies

const productService = require('../services/product.service');
const { calculateFinalPrice, calculateSubtotal, calculateTotal } = require('./price.utils');

/**
 * Parse cart cookie and validate/enrich items with product data from database
 * @param {Object} req - Express request object (must have cookies parsed)
 * @returns {Promise<Object>} - { items: Array, totals: Object, warnings: Array }
 */
async function parseAndValidateCartCookie(req) {
    try {
        const cartCookie = req.cookies?.cart;
        
        if (!cartCookie) {
            return {
                items: [],
                totals: {
                    subtotal: 0,
                    discount: 0,
                    delivery: 0,
                    total: 0
                },
                warnings: []
            };
        }
        
        // Parse cart JSON from cookie
        let cartData;
        try {
            cartData = JSON.parse(cartCookie);
        } catch (parseError) {
            console.warn('[Cart Utils] Failed to parse cart cookie:', parseError.message);
            return {
                items: [],
                totals: {
                    subtotal: 0,
                    discount: 0,
                    delivery: 0,
                    total: 0
                },
                warnings: []
            };
        }
        
        // Validate cart data is an array
        if (!Array.isArray(cartData) || cartData.length === 0) {
            return {
                items: [],
                totals: {
                    subtotal: 0,
                    discount: 0,
                    delivery: 0,
                    total: 0
                },
                warnings: []
            };
        }
        
        // Limit cart size to prevent DoS
        const MAX_CART_ITEMS = 100;
        if (cartData.length > MAX_CART_ITEMS) {
            console.warn(`[Cart Utils] Cart exceeds maximum items (${cartData.length} > ${MAX_CART_ITEMS})`);
            cartData = cartData.slice(0, MAX_CART_ITEMS);
        }
        
        const validatedItems = [];
        const warnings = [];
        
        // Validate and enrich each cart item with product data from database
        for (const item of cartData) {
            const productId = item.productId || item.id;
            if (!productId) {
                warnings.push({
                    itemId: item.id,
                    message: 'Product ID is missing'
                });
                continue;
            }
            
            try {
                // Fetch product from database
                const product = await productService.getProductById(productId);
                
                if (!product) {
                    warnings.push({
                        itemId: item.id,
                        productId: productId,
                        message: `Product "${item.name || productId}" not found`
                    });
                    continue;
                }
                
                const productObj = product.toJSON();
                let requestedQuantity = Math.max(1, parseInt(item.quantity) || 1);
                
                // Validate stock
                if (productObj.stock < requestedQuantity) {
                    warnings.push({
                        itemId: item.id,
                        productId: String(productObj.id),
                        message: `Only ${productObj.stock} item${productObj.stock !== 1 ? 's' : ''} available for "${productObj.model}"`,
                        availableStock: productObj.stock,
                        requestedQuantity: requestedQuantity
                    });
                    // Use available stock instead
                    requestedQuantity = productObj.stock;
                }
                
                // CRITICAL: Recalculate price from database (ignore client-provided price)
                const originalPrice = productObj.price || 0;
                const discount = productObj.discount || 0;
                const authoritativePrice = calculateFinalPrice(originalPrice, discount);
                
                // Warn if client price doesn't match server price
                const clientPrice = parseFloat(item.price) || 0;
                if (Math.abs(clientPrice - authoritativePrice) > 0.01) {
                    console.warn(`[Cart Utils] Price mismatch for product ${productId}: client=${clientPrice}, server=${authoritativePrice}`);
                    warnings.push({
                        itemId: item.id,
                        productId: String(productObj.id),
                        message: `Price updated for "${productObj.model}"`,
                        oldPrice: clientPrice,
                        newPrice: authoritativePrice
                    });
                }
                
                // Normalize variant structure
                let variant = item.variant;
                if (!variant && (item.color || item.strap)) {
                    variant = {
                        color: item.color || null,
                        strap: item.strap || null
                    };
                }
                variant = variant || { color: null, strap: null };
                
                // Build validated item with authoritative data
                validatedItems.push({
                    id: item.id || String(productObj.id),
                    productId: String(productObj.id),
                    name: productObj.model || item.name,
                    brand: productObj.brand,
                    price: authoritativePrice, // Server-calculated price
                    originalPrice: originalPrice,
                    discount: discount,
                    quantity: requestedQuantity,
                    image: productObj.images && productObj.images[0] ? productObj.images[0] : (item.image || '/images/placeholder.jpg'),
                    stock: productObj.stock,
                    sku: productObj.sku || null,
                    variant: variant,
                    shippingPrice: parseFloat(productObj.shippingPrice) || 0
                });
            } catch (itemError) {
                console.error(`[Cart Utils] Error validating item ${productId}:`, itemError);
                warnings.push({
                    itemId: item.id,
                    productId: productId,
                    message: `Error validating product: ${itemError.message}`
                });
            }
        }
        
        // Calculate authoritative totals
        const subtotal = calculateSubtotal(validatedItems);
        // Sum each unique product's shipping price (once per product, not per quantity)
        const seenProductIds = new Set();
        let delivery = 0;
        for (const item of validatedItems) {
            if (!seenProductIds.has(item.productId)) {
                seenProductIds.add(item.productId);
                delivery += item.shippingPrice || 0;
            }
        }
        const discount = 0; // No coupon discount at cart stage
        const total = calculateTotal(subtotal, discount, delivery);
        
        return {
            items: validatedItems,
            totals: {
                subtotal: subtotal,
                discount: discount,
                delivery: delivery,
                total: total
            },
            warnings: warnings
        };
    } catch (error) {
        console.error('[Cart Utils] Error parsing cart cookie:', error);
        return {
            items: [],
            totals: {
                subtotal: 0,
                discount: 0,
                delivery: 0,
                total: 0
            },
            warnings: []
        };
    }
}

module.exports = {
    parseAndValidateCartCookie
};

