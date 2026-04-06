// Cart Controller
// Handles cart operations with stock validation

const productService = require('../services/product.service');
const { getSellingUnitPrice } = require('../utils/price.utils');
const { getStockStatus, getSellableUnitsForLine } = require('../utils/stock.utils');

// Verify productService is loaded correctly
if (!productService || typeof productService.getProductById !== 'function') {
    console.error('[Cart Controller] ERROR: productService is not properly loaded!');
    console.error('[Cart Controller] productService:', productService);
}

/**
 * Add item to cart with stock validation
 */
exports.addToCart = async (req, res) => {
    try {
        const { productId, quantity = 1, color } = req.body;

        if (!productId) {
            return res.status(400).json({
                success: false,
                message: 'Product ID is required'
            });
        }

        // Verify productService is available
        if (!productService || typeof productService.getProductById !== 'function') {
            console.error('[Cart Controller] productService is undefined or missing getProductById method');
            return res.status(500).json({
                success: false,
                message: 'Server configuration error'
            });
        }

        // Get product from database
        const product = await productService.getProductById(productId);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        const productObj = product.toJSON();
        const requestedQuantity = Math.max(1, parseInt(quantity) || 1);

        // Sellable = product stock ∩ color variant cap when applicable
        const availableStock = getSellableUnitsForLine(productObj, color || null);

        // Validate stock availability
        if (availableStock < requestedQuantity) {
            return res.status(400).json({
                success: false,
                message: `Only ${availableStock} item${availableStock !== 1 ? 's' : ''} available`,
                availableStock: availableStock,
                requestedQuantity: requestedQuantity
            });
        }

        // Selling price is stored on the product row; discount is badge-only (not applied again)
        const finalPrice = getSellingUnitPrice(productObj);
        const originalPrice = Number(productObj.originalPrice) > finalPrice ? Number(productObj.originalPrice) : finalPrice;
        const discount = productObj.discount || 0;

        // Return cart item data (client will store in localStorage)
        res.json({
            success: true,
            cartItem: {
                id: String(productObj.id),
                productId: String(productObj.id),
                name: productObj.model,
                brand: productObj.brand,
                price: finalPrice,
                originalPrice: originalPrice,
                discount: discount,
                quantity: requestedQuantity,
                image: productObj.images && productObj.images[0] ? productObj.images[0] : null,
                stock: availableStock,
                shippingPrice: parseFloat(productObj.shippingPrice) || 0,
                timestamp: new Date().toISOString()
            },
            message: 'Item added to cart successfully'
        });
    } catch (error) {
        console.error('[Cart Controller] Error adding to cart:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add item to cart'
        });
    }
};

/**
 * Update cart item quantity with stock validation
 */
exports.updateCartItem = async (req, res) => {
    try {
        const { productId, quantity, color } = req.body;

        if (!productId || quantity === undefined) {
            return res.status(400).json({
                success: false,
                message: 'Product ID and quantity are required'
            });
        }

        const requestedQuantity = Math.max(1, parseInt(quantity) || 1);

        // Get product from database
        const product = await productService.getProductById(productId);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        const productObj = product.toJSON();

        const availableStock = getSellableUnitsForLine(productObj, color || null);

        // Validate stock availability
        if (availableStock < requestedQuantity) {
            return res.status(400).json({
                success: false,
                message: `Only ${availableStock} item${availableStock !== 1 ? 's' : ''} available`,
                availableStock: availableStock,
                requestedQuantity: requestedQuantity
            });
        }

        res.json({
            success: true,
            availableStock: availableStock,
            quantity: requestedQuantity,
            message: 'Cart item updated successfully'
        });
    } catch (error) {
        console.error('[Cart Controller] Error updating cart item:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update cart item'
        });
    }
};

/**
 * Remove item from cart
 */
exports.removeFromCart = async (req, res) => {
    try {
        const { itemId } = req.params;
        
        res.json({
            success: true,
            message: 'Item removed from cart'
        });
    } catch (error) {
        console.error('[Cart Controller] Error removing from cart:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to remove item from cart'
        });
    }
};

/**
 * Validate cart items and return authoritative prices and totals
 * SECURITY: This endpoint re-fetches all prices from database to prevent manipulation
 * POST /api/cart/validate
 */
exports.validateCart = async (req, res) => {
    try {
        const { items } = req.body;
        
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Cart items are required'
            });
        }
        
        const { calculateSubtotal, calculateTotal } = require('../utils/price.utils');
        
        const validatedItems = [];
        const errors = [];
        const warnings = [];
        
        // Validate each cart item against database
        for (const item of items) {
            const productId = item.id || item.productId;
            if (!productId) {
                errors.push({
                    itemId: item.id,
                    message: 'Product ID is required'
                });
                continue;
            }
            
            try {
                const product = await productService.getProductById(productId);
                
                if (!product) {
                    errors.push({
                        itemId: item.id,
                        productId: productId,
                        message: `Product "${item.name || productId}" not found`
                    });
                    continue;
                }
                
                const productObj = product.toJSON();
                let requestedQuantity = Math.max(1, parseInt(item.quantity) || 1);
                const itemColor = item.variant?.color || item.color || null;
                const availableStock = getSellableUnitsForLine(productObj, itemColor);

                if (availableStock < requestedQuantity) {
                    warnings.push({
                        itemId: item.id,
                        productId: String(productObj.id),
                        message: `Only ${availableStock} item${availableStock !== 1 ? 's' : ''} available for "${productObj.model}"${itemColor ? ` (${itemColor})` : ''}`,
                        availableStock: availableStock,
                        requestedQuantity: requestedQuantity
                    });
                    // Use available stock instead
                    requestedQuantity = availableStock;
                }

                // CRITICAL: Recalculate price from database (ignore client-provided price)
                const authoritativePrice = getSellingUnitPrice(productObj);
                const originalPrice = Number(productObj.originalPrice) > authoritativePrice ? Number(productObj.originalPrice) : authoritativePrice;
                const discount = productObj.discount || 0;

                // Warn if client price doesn't match server price
                const clientPrice = parseFloat(item.price) || 0;
                if (Math.abs(clientPrice - authoritativePrice) > 0.01) {
                    console.warn(`[Cart Controller] Price mismatch for product ${productId}: client=${clientPrice}, server=${authoritativePrice}`);
                    warnings.push({
                        itemId: item.id,
                        productId: String(productObj.id),
                        message: `Price updated for "${productObj.model}"`,
                        oldPrice: clientPrice,
                        newPrice: authoritativePrice
                    });
                }

                validatedItems.push({
                    id: String(productObj.id),
                    productId: String(productObj.id),
                    name: productObj.model || item.name,
                    brand: productObj.brand,
                    price: authoritativePrice,
                    originalPrice: originalPrice,
                    discount: discount,
                    quantity: requestedQuantity,
                    image: item.image || (productObj.images && productObj.images[0]) || null,
                    stock: availableStock,
                    stockStatus: getStockStatus(availableStock, productObj.lowStockThreshold),
                    sku: productObj.sku || null,
                    variant: item.variant || null,
                    shippingPrice: parseFloat(productObj.shippingPrice) || 0
                });
            } catch (itemError) {
                console.error(`[Cart Controller] Error validating item ${productId}:`, itemError);
                errors.push({
                    itemId: item.id,
                    productId: productId,
                    message: `Error validating product: ${itemError.message}`
                });
            }
        }
        
        // If any critical errors, reject validation
        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Cart validation failed',
                errors: errors,
                warnings: warnings
            });
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
        const couponDiscount = parseFloat(req.body.couponDiscount) || 0;
        const total = calculateTotal(subtotal, couponDiscount, delivery);
        
        res.json({
            success: true,
            items: validatedItems,
            totals: {
                subtotal: subtotal,
                discount: couponDiscount,
                delivery: delivery,
                total: total
            },
            warnings: warnings.length > 0 ? warnings : undefined
        });
    } catch (error) {
        console.error('[Cart Controller] Error validating cart:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to validate cart',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get cart items with current stock validation
 * 
 * SECURITY: Size limits prevent DoS attacks via large JSON payloads
 * NOTE: This endpoint accepts items via query parameter (GET) for backward compatibility.
 * For large carts or new implementations, use POST /api/cart/validate instead.
 * 
 * @param {string} req.query.items - JSON string of cart items (max 10KB, max 100 items)
 */
exports.getCartItems = async (req, res) => {
    try {
        const { items } = req.query; // JSON string of cart items
        
        if (!items) {
            return res.json({
                success: true,
                items: [],
                warnings: []
            });
        }
        
        // SECURITY: Prevent DoS by limiting JSON payload size
        // Maximum 10KB for query parameter (reasonable for cart items)
        const MAX_ITEMS_JSON_SIZE = 10000; // 10KB
        if (items.length > MAX_ITEMS_JSON_SIZE) {
            return res.status(400).json({
                success: false,
                message: 'Cart items payload too large. Maximum size is 10KB. Please use POST /api/cart/validate for large carts.'
            });
        }
        
        // Parse JSON with error handling
        let cartItems;
        try {
            cartItems = JSON.parse(items);
        } catch (parseError) {
            return res.status(400).json({
                success: false,
                message: 'Invalid JSON format in cart items parameter',
                error: process.env.NODE_ENV === 'development' ? parseError.message : undefined
            });
        }
        
        // Validate parsed data is an array
        if (!Array.isArray(cartItems)) {
            return res.status(400).json({
                success: false,
                message: 'Cart items must be an array'
            });
        }
        
        // Limit array size to prevent DoS (reasonable limit: 100 items)
        const MAX_CART_ITEMS = 100;
        if (cartItems.length > MAX_CART_ITEMS) {
            return res.status(400).json({
                success: false,
                message: `Cart contains too many items (${cartItems.length}). Maximum allowed is ${MAX_CART_ITEMS}. Please use POST /api/cart/validate for large carts.`
            });
        }
        const warnings = [];
        const validatedItems = [];
        
        // Validate each cart item against current stock
        for (const item of cartItems) {
            const productId = item.id || item.productId;
            if (!productId) {
                warnings.push({
                    itemId: item.id,
                    message: `Product "${item.name}" has invalid ID`
                });
                continue;
            }
            
            const product = await productService.getProductById(productId);
            
            if (!product) {
                warnings.push({
                    itemId: item.id,
                    message: `Product "${item.name}" no longer exists`
                });
                continue;
            }
            
            const productObj = product.toJSON();
            const requestedQuantity = item.quantity || 1;
            const itemColor = item.variant?.color || item.color || null;
            const sellable = getSellableUnitsForLine(productObj, itemColor);
            
            if (sellable < requestedQuantity) {
                warnings.push({
                    itemId: item.id,
                    productId: String(productObj.id),
                    message: `Only ${sellable} item${sellable !== 1 ? 's' : ''} available for "${productObj.model}"`,
                    availableStock: sellable,
                    requestedQuantity: requestedQuantity
                });
                
                item.quantity = sellable;
            }
            
            // Recalculate price
            const originalPrice = productObj.price || 0;
            const discount = productObj.discount || 0;
            item.price = getSellingUnitPrice(productObj);
            item.originalPrice = originalPrice;
            item.stock = sellable;
            item.stockStatus = getStockStatus(sellable, productObj.lowStockThreshold);

            validatedItems.push(item);
        }
        
        res.json({
            success: true,
            items: validatedItems,
            warnings: warnings
        });
    } catch (error) {
        console.error('[Cart Controller] Error getting cart items:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to validate cart items'
        });
    }
};

