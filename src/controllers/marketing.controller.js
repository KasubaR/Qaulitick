// Marketing Controller
const flashSaleService = require('../services/flashSale.service');
const productService = require('../services/product.service');
const featuredProductService = require('../services/featuredProduct.service');
const { calculateFinalPrice, calculateSavings } = require('../utils/price.utils');

// Attach correct price fields to a normalised product plain object.
function withPrices(productObj) {
    const currentPrice   = Number(productObj.price) || 0;
    const storedOriginal = Number(productObj.originalPrice) || 0;
    const origPrice      = storedOriginal > currentPrice ? storedOriginal : currentPrice;
    const discount       = productObj.discount || 0;
    const savings        = origPrice > currentPrice
        ? Math.round(origPrice - currentPrice)
        : calculateSavings(origPrice, discount);
    return { ...productObj, price: currentPrice, originalPrice: origPrice, finalPrice: currentPrice, savings };
}

// Get Featured Products for Home Page
exports.getFeaturedProducts = async (req, res) => {
    try {
        // Get active featured products from database (sorted by order)
        const featuredProductDocs = await featuredProductService.getActiveFeaturedProducts();

        // Get full product details for each featured product
        const featuredProducts = await Promise.all(
            featuredProductDocs.map(async (featuredDoc) => {
                try {
                    const product = await productService.getProductById(featuredDoc.productId);

                    if (product) {
                        const productObj = product.toJSON();
                        return {
                            ...withPrices(productObj),
                            featuredOrder: featuredDoc.order
                        };
                    }

                    // Product not found - log and return null (will be filtered out)
                    console.warn(`[Marketing Controller] Featured product references non-existent product: ${featuredDoc.productId}`);
                    return null;
                } catch (error) {
                    console.error(`[Marketing Controller] Error fetching product ${featuredDoc.productId}:`, error);
                    return null;
                }
            })
        );

        // Filter out null values (deleted products) and sort by order
        const validFeaturedProducts = featuredProducts
            .filter(p => p !== null)
            .sort((a, b) => a.featuredOrder - b.featuredOrder);

        res.json({
            success: true,
            products: validFeaturedProducts
        });
    } catch (error) {
        console.error('[Marketing Controller] Error fetching featured products:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch featured products'
        });
    }
};

// Get Active Flash Sales for Home Page
exports.getActiveFlashSales = async (req, res) => {
    try {
        const activeSales = await flashSaleService.getActiveFlashSales();

        // Get full product details for flash sale products
        const flashSalesWithProducts = await Promise.all(
            activeSales.map(async (sale) => {
                const saleObj  = sale.toJSON();
                const saleDiscount = Number(saleObj.discount) || 0;

                // Safely parse productIds — JSON columns can arrive as a string on some MySQL drivers
                const rawIds = saleObj.productIds;
                const productIds = Array.isArray(rawIds)
                    ? rawIds
                    : (typeof rawIds === 'string' ? (() => { try { return JSON.parse(rawIds); } catch { return []; } })() : []);

                const products = await Promise.all(
                    productIds.map(async (productId) => {
                        try {
                            const product = await productService.getProductById(productId);
                            if (product) {
                                const productObj  = product.toJSON();
                                const currentPrice = Number(productObj.price) || 0;
                                return {
                                    ...productObj,
                                    // originalPrice = normal selling price (shown crossed-out)
                                    originalPrice:     currentPrice,
                                    flashSaleDiscount: saleDiscount,
                                    finalPrice:        calculateFinalPrice(currentPrice, saleDiscount),
                                    savings:           calculateSavings(currentPrice, saleDiscount),
                                    saleId:            saleObj.id
                                };
                            }
                            return null;
                        } catch (error) {
                            console.error(`[Marketing Controller] Error fetching product ${productId}:`, error);
                            return null;
                        }
                    })
                );

                return {
                    ...saleObj,
                    products: products.filter(p => p !== null)
                };
            })
        );

        res.json({
            success: true,
            flashSales: flashSalesWithProducts
        });
    } catch (error) {
        console.error('[Marketing Controller] Error fetching flash sales:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch flash sales'
        });
    }
};

// Admin: Get All Flash Sales
exports.getAllFlashSales = async (req, res) => {
    try {
        const sales = await flashSaleService.getAllFlashSales();
        const salesData = sales.map(sale => sale.toJSON());

        res.json({
            success: true,
            flashSales: salesData
        });
    } catch (error) {
        console.error('[Marketing Controller] Error fetching all flash sales:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch flash sales'
        });
    }
};

// Admin: Create Flash Sale
exports.createFlashSale = async (req, res) => {
    try {
        const saleData = req.body;
        const newSale = await flashSaleService.createFlashSale(saleData);
        const saleDataObj = newSale.toJSON();

        res.json({
            success: true,
            flashSale: saleDataObj,
            message: 'Flash sale created successfully'
        });
    } catch (error) {
        console.error('[Marketing Controller] Error creating flash sale:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create flash sale'
        });
    }
};

// Admin: Update Flash Sale
exports.updateFlashSale = async (req, res) => {
    try {
        const { id } = req.params;
        const saleData = req.body;
        const updatedSale = await flashSaleService.updateFlashSale(id, saleData);

        if (updatedSale) {
            const saleDataObj = updatedSale.toJSON();
            res.json({
                success: true,
                flashSale: saleDataObj,
                message: 'Flash sale updated successfully'
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Flash sale not found'
            });
        }
    } catch (error) {
        console.error('[Marketing Controller] Error updating flash sale:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update flash sale'
        });
    }
};

// Admin: Delete Flash Sale
exports.deleteFlashSale = async (req, res) => {
    try {
        const { id } = req.params;
        const deletedSale = await flashSaleService.deleteFlashSale(id);

        if (deletedSale) {
            res.json({
                success: true,
                message: 'Flash sale deleted successfully'
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Flash sale not found'
            });
        }
    } catch (error) {
        console.error('[Marketing Controller] Error deleting flash sale:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to delete flash sale'
        });
    }
};

// Admin: Update Featured Products
exports.updateFeaturedProducts = async (req, res) => {
    try {
        const { products } = req.body; // Array of { productId, order }

        // Validate input
        if (!Array.isArray(products)) {
            return res.status(400).json({
                success: false,
                message: 'Products must be an array'
            });
        }

        if (products.length === 0) {
            // Allow clearing all featured products
            await featuredProductService.setFeaturedProducts([]);
            return res.json({
                success: true,
                message: 'Featured products cleared successfully'
            });
        }

        // Fetch all candidate products in one query instead of one per item
        const candidateIds = products.map(p => parseInt(String(p.productId), 10));
        const fetched = await productService.getProductsByIds(candidateIds);
        const productMap = Object.fromEntries(fetched.map(p => [p.id, p]));

        const validationErrors = [];
        const validatedProducts = [];

        for (let i = 0; i < products.length; i++) {
            const product = products[i];

            if (!product.productId) {
                validationErrors.push(`Product at index ${i} is missing productId`);
                continue;
            }

            if (!product.order || product.order < 1) {
                validationErrors.push(`Product at index ${i} has invalid order (must be >= 1)`);
                continue;
            }

            const productIdNum = parseInt(String(product.productId), 10);
            if (Number.isNaN(productIdNum) || productIdNum < 1) {
                validationErrors.push(`Product at index ${i} has invalid productId format: ${product.productId}`);
                continue;
            }

            const productDetails = productMap[productIdNum];
            if (!productDetails) {
                validationErrors.push(`Product at index ${i} (ID: ${product.productId}) does not exist in the database`);
                continue;
            }

            if (productDetails.status !== 'active') {
                validationErrors.push(`Product at index ${i} (ID: ${product.productId}) is not active (status: ${productDetails.status}). Only active products can be featured.`);
                continue;
            }

            if (!productDetails.stock || productDetails.stock <= 0) {
                validationErrors.push(`Product at index ${i} (ID: ${product.productId}) has no stock (stock: ${productDetails.stock}). Only products with stock can be featured.`);
                continue;
            }

            validatedProducts.push({
                productId: product.productId,
                order: product.order
            });
        }

        // If there are validation errors, return them
        if (validationErrors.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validationErrors
            });
        }

        // Check for duplicate productIds
        const productIds = validatedProducts.map(p => String(p.productId));
        const uniqueProductIds = new Set(productIds);
        if (productIds.length !== uniqueProductIds.size) {
            return res.status(400).json({
                success: false,
                message: 'Duplicate productIds are not allowed'
            });
        }

        // Save to database
        await featuredProductService.setFeaturedProducts(validatedProducts);

        res.json({
            success: true,
            message: 'Featured products updated successfully',
            count: validatedProducts.length
        });
    } catch (error) {
        console.error('[Marketing Controller] Error updating featured products:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update featured products'
        });
    }
};

// Admin: Cleanup deleted products from featured products
exports.cleanupDeletedProducts = async (req, res) => {
    try {
        const removedCount = await featuredProductService.cleanupDeletedProducts();

        res.json({
            success: true,
            message: `Cleaned up ${removedCount} featured product(s) that referenced deleted products`,
            removedCount: removedCount
        });
    } catch (error) {
        console.error('[Marketing Controller] Error cleaning up deleted products:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to cleanup deleted products'
        });
    }
};

// Admin: Cleanup inactive/out-of-stock products from featured products
exports.cleanupInactiveProducts = async (req, res) => {
    try {
        const { autoRemove = false } = req.body; // Default to false (warnings only)
        const result = await featuredProductService.cleanupInactiveProducts(autoRemove);

        res.json({
            success: true,
            message: result.message,
            removedCount: result.removedCount,
            warnings: result.warnings
        });
    } catch (error) {
        console.error('[Marketing Controller] Error cleaning up inactive products:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to cleanup inactive products'
        });
    }
};

