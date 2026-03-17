const FeaturedProduct = require('../models/FeaturedProduct.model');
const Product = require('../models/Product.model');

function toId(id) { return typeof id === 'string' ? parseInt(id, 10) : id; }

/**
 * Featured Product Service
 * 
 * Handles all database operations for featured products
 */

class FeaturedProductService {

    /**
     * Get all featured products with optional filters
     * @param {Object} filters - Query filters
     * @param {Object} options - Query options (sort, limit, skip)
     * @returns {Promise<Array>}
     */
    async getAllFeaturedProducts(filters = {}, options = {}) {
        try {
            const {
                sort = { order: 1 }, // Default sort by order ascending
                limit = 0,
                skip = 0
            } = options;

            const query = FeaturedProduct.find(filters);
            if (sort) query.sort(sort);
            if (skip) query.skip(skip);
            if (limit) query.limit(limit);
            const featuredProducts = await query.exec();
            return featuredProducts;
        } catch (error) {
            console.error('[Featured Product Service] Error getting all featured products:', error);
            throw error;
        }
    }

    /**
     * Get active featured products sorted by order
     * @returns {Promise<Array>}
     */
    async getActiveFeaturedProducts() {
        try {
            const featuredProducts = await FeaturedProduct.findActive();
            return featuredProducts;
        } catch (error) {
            console.error('[Featured Product Service] Error getting active featured products:', error);
            throw error;
        }
    }

    /**
     * Get featured product by ID
     * @param {String} id - Featured product ID
     * @returns {Promise<Object|null>}
     */
    async getFeaturedProductById(id) {
        try {
            const featuredProduct = await FeaturedProduct.findById(id);
            return featuredProduct;
        } catch (error) {
            console.error('[Featured Product Service] Error getting featured product by ID:', error);
            throw error;
        }
    }

    /**
     * Get featured product by productId
     * @param {String} productId - Product ID
     * @returns {Promise<Object|null>}
     */
    async getFeaturedProductByProductId(productId) {
        try {
            const featuredProduct = await FeaturedProduct.findByProductId(productId);
            return featuredProduct;
        } catch (error) {
            console.error('[Featured Product Service] Error getting featured product by productId:', error);
            throw error;
        }
    }

    /**
     * Add a new featured product
     * @param {String} productId - Product ID to feature
     * @param {Number} order - Display order (optional, will auto-assign if not provided)
     * @returns {Promise<Object>}
     */
    async addFeaturedProduct(productId, order = null) {
        try {
            const productObjectId = toId(productId);
            const product = await Product.findById(productObjectId);
            if (!product) {
                throw new Error(`Product with ID ${productId} does not exist`);
            }

            // Validate product status (must be active)
            if (product.status !== 'active') {
                console.warn(`[Featured Product Service] Warning: Product ${productId} has status "${product.status}" (not active). Consider using active products only.`);
                throw new Error(`Product with ID ${productId} is not active (current status: ${product.status}). Only active products can be featured.`);
            }

            // Validate product has stock
            if (!product.stock || product.stock <= 0) {
                console.warn(`[Featured Product Service] Warning: Product ${productId} has no stock (stock: ${product.stock}). Consider using products with available stock.`);
                throw new Error(`Product with ID ${productId} has no stock available (stock: ${product.stock}). Only products with stock can be featured.`);
            }

            // Check if product is already featured
            const existing = await FeaturedProduct.findByProductId(productObjectId);
            if (existing) {
                throw new Error('Product is already featured');
            }

            // If order not provided, get max order and add 1
            if (order === null || order === undefined) {
                const maxOrder = await FeaturedProduct.getMaxOrder();
                order = maxOrder + 1;
            }

            // Validate order is positive
            if (order < 1) {
                throw new Error('Order must be at least 1');
            }

            const featuredProduct = new FeaturedProduct({
                productId: productObjectId,
                order: order,
                isActive: true
            });

            await featuredProduct.save();
            return featuredProduct;
        } catch (error) {
            console.error('[Featured Product Service] Error adding featured product:', error);
            throw error;
        }
    }

    /**
     * Remove a featured product by productId
     * @param {String} productId - Product ID to remove
     * @returns {Promise<Object|null>}
     */
    async removeFeaturedProduct(productId) {
        try {
            const productObjectId = toId(productId);
            const featuredProduct = await FeaturedProduct.findOne({ where: { productId: productObjectId } });
            if (featuredProduct) await featuredProduct.destroy();

            if (featuredProduct) await this.reorderFeaturedProducts();
            return featuredProduct;
        } catch (error) {
            console.error('[Featured Product Service] Error removing featured product:', error);
            throw error;
        }
    }

    /**
     * Update the order of a featured product
     * @param {String} productId - Product ID
     * @param {Number} newOrder - New order number
     * @returns {Promise<Object|null>}
     */
    async updateFeaturedProductOrder(productId, newOrder) {
        try {
            const productObjectId = toId(productId);
            if (newOrder < 1) throw new Error('Order must be at least 1');
            const featuredProduct = await FeaturedProduct.findOne({ where: { productId: productObjectId } });
            if (featuredProduct) {
                await featuredProduct.update({ order: newOrder });
                return await FeaturedProduct.findByPk(featuredProduct.id);
            }
            return null;
        } catch (error) {
            console.error('[Featured Product Service] Error updating featured product order:', error);
            throw error;
        }
    }

    /**
     * Bulk update featured products (set entire list)
     * @param {Array} productsArray - Array of { productId, order }
     * @returns {Promise<Array>}
     */
    async setFeaturedProducts(productsArray) {
        try {
            if (!Array.isArray(productsArray)) {
                throw new Error('productsArray must be an array');
            }

            // If empty array, just clear all featured products
            if (productsArray.length === 0) {
                await FeaturedProduct.deleteMany({});
                return [];
            }

            // Validate all productIds are provided and exist
            const validationErrors = [];
            const validatedProducts = [];

            for (let i = 0; i < productsArray.length; i++) {
                const product = productsArray[i];

                // Validate structure
                if (!product.productId) {
                    validationErrors.push(`Product at index ${i} is missing productId`);
                    continue;
                }

                if (!product.order || product.order < 1) {
                    validationErrors.push(`Product at index ${i} has invalid order (must be >= 1)`);
                    continue;
                }

                let productObjectId = toId(product.productId);
                if (Number.isNaN(productObjectId)) {
                    validationErrors.push(`Product at index ${i} has invalid productId format: ${product.productId}`);
                    continue;
                }

                // Validate product exists
                const productExists = await Product.findById(productObjectId);
                if (!productExists) {
                    validationErrors.push(`Product at index ${i} (ID: ${product.productId}) does not exist`);
                    continue;
                }

                // Validate product status (must be active)
                if (productExists.status !== 'active') {
                    const warning = `Product at index ${i} (ID: ${product.productId}) is not active (status: ${productExists.status})`;
                    console.warn(`[Featured Product Service] Warning: ${warning}. Only active products should be featured.`);
                    validationErrors.push(`${warning}. Only active products can be featured.`);
                    continue;
                }

                // Validate product has stock
                if (!productExists.stock || productExists.stock <= 0) {
                    const warning = `Product at index ${i} (ID: ${product.productId}) has no stock (stock: ${productExists.stock})`;
                    console.warn(`[Featured Product Service] Warning: ${warning}. Only products with stock should be featured.`);
                    validationErrors.push(`${warning}. Only products with stock can be featured.`);
                    continue;
                }

                validatedProducts.push({
                    productId: productObjectId,
                    order: product.order,
                    isActive: true
                });
            }

            // If there are validation errors, throw them
            if (validationErrors.length > 0) {
                throw new Error(`Validation failed: ${validationErrors.join('; ')}`);
            }

            // Check for duplicate productIds
            const productIds = validatedProducts.map(p => String(p.productId));
            const uniqueProductIds = new Set(productIds);
            if (productIds.length !== uniqueProductIds.size) {
                throw new Error('Duplicate productIds are not allowed');
            }

            await FeaturedProduct.destroy({ where: {} });
            const result = await FeaturedProduct.bulkCreate(validatedProducts);

            return result;
        } catch (error) {
            console.error('[Featured Product Service] Error setting featured products:', error);
            throw error;
        }
    }

    /**
     * Get the highest order number
     * @returns {Promise<Number>}
     */
    async getMaxOrder() {
        try {
            const maxOrder = await FeaturedProduct.getMaxOrder();
            return maxOrder;
        } catch (error) {
            console.error('[Featured Product Service] Error getting max order:', error);
            throw error;
        }
    }

    /**
     * Auto-renumber all featured products sequentially
     * @returns {Promise<Array>}
     */
    async reorderFeaturedProducts() {
        try {
            const reorderedProducts = await FeaturedProduct.reorderAll();
            return reorderedProducts;
        } catch (error) {
            console.error('[Featured Product Service] Error reordering featured products:', error);
            throw error;
        }
    }

    /**
     * Validate that a product exists
     * @param {String} productId - Product ID to validate
     * @returns {Promise<Boolean>}
     */
    async validateProductExists(productId) {
        try {
            const productObjectId = toId(productId);
            const product = await Product.findById(productObjectId);
            return product !== null;
        } catch (error) {
            console.error('[Featured Product Service] Error validating product exists:', error);
            return false;
        }
    }

    /**
     * Clean up featured products that reference deleted products
     * @returns {Promise<Number>} - Number of products removed
     */
    async cleanupDeletedProducts() {
        try {
            const featuredProducts = await FeaturedProduct.find({ isActive: true });

            let removedCount = 0;

            for (const featuredProduct of featuredProducts) {
                const product = await Product.findById(featuredProduct.productId);
                if (!product) {
                    await FeaturedProduct.findByIdAndDelete(featuredProduct.id);
                    removedCount++;
                }
            }

            // Reorder remaining products after cleanup
            if (removedCount > 0) {
                await this.reorderFeaturedProducts();
            }

            return removedCount;
        } catch (error) {
            console.error('[Featured Product Service] Error cleaning up deleted products:', error);
            throw error;
        }
    }

    /**
     * Clean up featured products that are inactive or out of stock
     * @param {Boolean} autoRemove - If true, automatically remove inactive/out-of-stock products. If false, only log warnings.
     * @returns {Promise<Object>} - Object with removedCount and warnings array
     */
    async cleanupInactiveProducts(autoRemove = false) {
        try {
            const featuredProducts = await FeaturedProduct.find({ isActive: true });

            let removedCount = 0;
            const warnings = [];

            for (const featuredProduct of featuredProducts) {
                const product = await Product.findById(featuredProduct.productId);

                if (!product) {
                    // Product was deleted - remove it
                    if (autoRemove) {
                        await FeaturedProduct.findByIdAndDelete(featuredProduct.id);
                        removedCount++;
                    }
                    warnings.push(`Featured product references deleted product: ${featuredProduct.productId}`);
                    continue;
                }

                // Check if product is inactive
                if (product.status !== 'active') {
                    const warning = `Product ${product._id} (${product.brand} ${product.model}) has status "${product.status}" (not active)`;
                    warnings.push(warning);
                    console.warn(`[Featured Product Service] ${warning}`);

                    if (autoRemove) {
                        await FeaturedProduct.findByIdAndDelete(featuredProduct.id);
                        removedCount++;
                        console.log(`[Featured Product Service] Auto-removed inactive product: ${product._id}`);
                    }
                    continue;
                }

                // Check if product has no stock
                if (!product.stock || product.stock <= 0) {
                    const warning = `Product ${product._id} (${product.brand} ${product.model}) has no stock (stock: ${product.stock})`;
                    warnings.push(warning);
                    console.warn(`[Featured Product Service] ${warning}`);

                    if (autoRemove) {
                        await FeaturedProduct.findByIdAndDelete(featuredProduct.id);
                        removedCount++;
                        console.log(`[Featured Product Service] Auto-removed out-of-stock product: ${product._id}`);
                    }
                    continue;
                }
            }

            // Reorder remaining products after cleanup
            if (removedCount > 0) {
                await this.reorderFeaturedProducts();
            }

            return {
                removedCount,
                warnings,
                message: autoRemove
                    ? `Removed ${removedCount} inactive/out-of-stock featured products`
                    : `Found ${warnings.length} inactive/out-of-stock featured products (use autoRemove=true to remove them)`
            };
        } catch (error) {
            console.error('[Featured Product Service] Error cleaning up inactive products:', error);
            throw error;
        }
    }
}

// Export singleton instance
module.exports = new FeaturedProductService();

