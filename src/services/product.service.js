const { Op } = require('sequelize');
const { sequelize } = require('../config/mysql');
const Product = require('../models/Product.model');

/** Match text inside JSON columns (arrays/objects) by casting to string — plain LIKE on JSON path is unreliable. */
function jsonDocLike(column, term) {
    return sequelize.where(
        sequelize.fn('CAST', sequelize.col(column), sequelize.literal('CHAR(16384)')),
        { [Op.like]: term }
    );
}

/**
 * Product Service — Sequelize implementation
 */

class ProductService {

    async getAllProducts(filters = {}, options = {}) {
        try {
            const { sort = [['createdAt', 'DESC']], limit, skip = 0 } = options;
            const where = this._buildWhere(filters);
            const findOptions = { where, order: sort, offset: skip };
            if (limit) findOptions.limit = limit;
            return await Product.findAll(findOptions);
        } catch (error) {
            console.error('Error getting products:', error);
            throw error;
        }
    }

    async getProductById(id) {
        try {
            return await Product.findByPk(id);
        } catch (error) {
            console.error('Error getting product by ID:', error);
            throw error;
        }
    }

    async getProductsByIds(ids, options = {}) {
        try {
            const numericIds = ids.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
            if (numericIds.length === 0) return [];
            const findOpts = { where: { id: { [Op.in]: numericIds } } };
            if (options.attributes) findOpts.attributes = options.attributes;
            return await Product.findAll(findOpts);
        } catch (error) {
            console.error('Error getting products by IDs:', error);
            throw error;
        }
    }

    async getProductBySku(sku) {
        try {
            return await Product.findOne({ where: { sku: sku.toUpperCase() } });
        } catch (error) {
            console.error('Error getting product by SKU:', error);
            throw error;
        }
    }

    async createProduct(productData) {
        try {
            return await Product.create(productData);
        } catch (error) {
            console.error('Error creating product:', error);
            throw error;
        }
    }

    async updateProduct(id, updateData) {
        try {
            const product = await Product.findByPk(id);
            if (!product) return null;
            await product.update(updateData);
            return product;
        } catch (error) {
            console.error('Error updating product:', error);
            throw error;
        }
    }

    async deleteProduct(id) {
        try {
            const product = await Product.findByPk(id);
            if (!product) return null;
            await product.destroy();
            return product;
        } catch (error) {
            console.error('Error deleting product:', error);
            throw error;
        }
    }

    async searchProducts(searchQuery, options = {}) {
        try {
            const { limit = 20, skip = 0 } = options;
            const term = `%${searchQuery.trim()}%`;
            const textOr = [
                { model: { [Op.like]: term } },
                { brand: { [Op.like]: term } },
                { sku: { [Op.like]: term } },
                { description: { [Op.like]: term } },
                jsonDocLike('colors', term),
                jsonDocLike('strapOptions', term),
                jsonDocLike('images', term)
            ];
            return await Product.findAll({
                where: {
                    status: 'active',
                    [Op.or]: textOr
                },
                order: [['createdAt', 'DESC']],
                limit,
                offset: skip
            });
        } catch (error) {
            console.error('Error searching products:', error);
            throw error;
        }
    }

    async countSearchResults(searchQuery) {
        try {
            const term = `%${searchQuery.trim()}%`;
            const textOr = [
                { model: { [Op.like]: term } },
                { brand: { [Op.like]: term } },
                { sku: { [Op.like]: term } },
                { description: { [Op.like]: term } },
                jsonDocLike('colors', term),
                jsonDocLike('strapOptions', term),
                jsonDocLike('images', term)
            ];
            return await Product.count({
                where: {
                    status: 'active',
                    [Op.or]: textOr
                }
            });
        } catch (error) {
            console.error('Error counting search results:', error);
            throw error;
        }
    }

    async getProductsByBrand(brand) {
        try {
            return await Product.findByBrand(brand);
        } catch (error) {
            console.error('Error getting products by brand:', error);
            throw error;
        }
    }

    async getInStockProducts() {
        try {
            return await Product.findInStock();
        } catch (error) {
            console.error('Error getting in-stock products:', error);
            throw error;
        }
    }

    async getProductsOnSale() {
        try {
            return await Product.findOnSale();
        } catch (error) {
            console.error('Error getting products on sale:', error);
            throw error;
        }
    }

    /**
     * Build Sequelize where clause from filter params
     */
    buildFilterQuery(filters) {
        const where = this._buildWhere(filters);
        const order = this._buildOrder(filters.sortBy);
        return { query: where, sortOptions: order };
    }

    async filterProducts(filters, options = {}) {
        try {
            const { query: where, sortOptions: order } = this.buildFilterQuery(filters);
            return await Product.findAll({
                where,
                order,
                offset: options.skip || 0,
                ...(options.limit ? { limit: options.limit } : {})
            });
        } catch (error) {
            console.error('Error filtering products:', error);
            throw error;
        }
    }

    async updateProductStock(id, quantity) {
        try {
            const product = await Product.findByPk(id);
            if (!product) throw new Error('Product not found');
            await product.updateStock(quantity);
            if (product.stock <= 0) {
                const flashSaleService = require('./flashSale.service');
                await flashSaleService.endSaleIfAllOutOfStock(id);
            }
            return product;
        } catch (error) {
            console.error('Error updating product stock:', error);
            throw error;
        }
    }

    async getProductCount(filters = {}) {
        try {
            const { query: where } = this.buildFilterQuery(filters);
            return await Product.count({ where });
        } catch (error) {
            console.error('Error getting product count:', error);
            throw error;
        }
    }

    async getPaginatedProducts(options = {}) {
        try {
            const { page = 1, limit = 12, filters = {}, sort = [['createdAt', 'DESC']] } = options;
            const offset = (page - 1) * limit;
            const where = this._buildWhere(filters);

            const { count: total, rows: products } = await Product.findAndCountAll({
                where,
                order: sort,
                limit,
                offset
            });

            return {
                products,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    pages: Math.ceil(total / limit)
                }
            };
        } catch (error) {
            console.error('Error getting paginated products:', error);
            throw error;
        }
    }

    async getBrands() {
        try {
            const results = await Product.findAll({
                attributes: ['brand'],
                where: { brand: { [Op.ne]: '' } },
                group: ['brand'],
                raw: true
            });
            return results.map(r => r.brand).sort();
        } catch (error) {
            console.error('Error getting brands:', error);
            throw error;
        }
    }

    async getStrapTypes() {
        try {
            const results = await Product.findAll({
                attributes: ['strapType'],
                where: { strapType: { [Op.ne]: '' } },
                group: ['strapType'],
                raw: true
            });
            return results.map(r => r.strapType).filter(Boolean).sort();
        } catch (error) {
            console.error('Error getting strap types:', error);
            throw error;
        }
    }

    async addReview(id, reviewData) {
        try {
            const product = await Product.findByPk(id);
            if (!product) throw new Error('Product not found');

            const reviews = Array.isArray(product.reviews) ? [...product.reviews] : [];
            const review = {
                id: Date.now(),
                name: reviewData.name,
                email: reviewData.email.toLowerCase().trim(),
                title: reviewData.title,
                comment: reviewData.comment,
                rating: parseInt(reviewData.rating),
                verified: reviewData.verified || false,
                orderNumber: reviewData.orderNumber || null,
                ipAddress: reviewData.ipAddress || null,
                createdAt: new Date()
            };

            reviews.push(review);

            const totalRating = reviews.reduce((sum, r) => sum + (r.rating || 0), 0);
            const newRating = reviews.length > 0 ? parseFloat((totalRating / reviews.length).toFixed(1)) : 0;

            await product.update({ reviews, rating: newRating });

            // Return a product-like object with the reviews array accessible
            product.reviews = reviews;
            return product;
        } catch (error) {
            console.error('Error adding review:', error);
            throw error;
        }
    }

    async bulkDeleteProducts(productIds) {
        try {
            const ids = productIds.map(id => parseInt(id)).filter(id => !isNaN(id));
            if (ids.length === 0) return { deletedCount: 0, deletedProducts: [] };

            const productsToDelete = await Product.findAll({ where: { id: { [Op.in]: ids } } });
            const deletedCount = await Product.destroy({ where: { id: { [Op.in]: ids } } });

            return { deletedCount, deletedProducts: productsToDelete };
        } catch (error) {
            console.error('Error bulk deleting products:', error);
            throw error;
        }
    }

    async getAllProductsForExport(filters = {}) {
        try {
            const where = this._buildWhere(filters);
            return await Product.findAll({ where, order: [['createdAt', 'DESC']], raw: true });
        } catch (error) {
            console.error('Error getting products for export:', error);
            throw error;
        }
    }

    async reorderProductImages(productId, imageOrder) {
        try {
            const product = await Product.findByPk(productId);
            if (!product) return null;
            await product.update({ images: imageOrder });
            return product;
        } catch (error) {
            console.error('Error reordering product images:', error);
            throw error;
        }
    }

    async setPrimaryImage(productId, imageUrl) {
        try {
            const product = await Product.findByPk(productId);
            if (!product) return null;

            const images = Array.isArray(product.images) ? [...product.images] : [];
            const idx = images.indexOf(imageUrl);
            if (idx === -1) throw new Error('Image not found in product images');

            images.splice(idx, 1);
            images.unshift(imageUrl);

            await product.update({ images });
            return product;
        } catch (error) {
            console.error('Error setting primary image:', error);
            throw error;
        }
    }

    async deleteProductImage(productId, imageUrl) {
        try {
            const product = await Product.findByPk(productId);
            if (!product) return null;

            const images = (Array.isArray(product.images) ? product.images : []).filter(img => img !== imageUrl);
            await product.update({ images });
            return product;
        } catch (error) {
            console.error('Error deleting product image:', error);
            throw error;
        }
    }

    // ── private helpers ───────────────────────────────────────────────────────

    _buildWhere(filters) {
        const where = {};

        if (filters.minPrice || filters.maxPrice) {
            where.price = {};
            if (filters.minPrice) where.price[Op.gte] = parseFloat(filters.minPrice);
            if (filters.maxPrice) where.price[Op.lte] = parseFloat(filters.maxPrice);
        }

        if (filters.brand) {
            const brands = filters.brand.split(',').map(b => b.trim()).filter(Boolean);
            if (brands.length === 1) {
                where.brand = { [Op.like]: `%${brands[0]}%` };
            } else if (brands.length > 1) {
                where[Op.or] = brands.map(b => ({ brand: { [Op.like]: `%${b}%` } }));
            }
        }
        if (filters.gender && filters.gender !== 'all') where.gender = filters.gender;
        if (filters.movement)                       where.movement = filters.movement;

        if (filters.strap) {
            const straps = filters.strap.split(',').map(s => s.trim()).filter(Boolean);
            if (straps.length === 1) {
                where.strapType = { [Op.like]: `%${straps[0]}%` };
            } else if (straps.length > 1) {
                const strapConditions = straps.map(s => ({ strapType: { [Op.like]: `%${s}%` } }));
                where[Op.or] = where[Op.or]
                    ? [...where[Op.or], ...strapConditions]
                    : strapConditions;
            }
        }

        if (filters.minRating) {
            where.rating = { [Op.gte]: parseFloat(filters.minRating) };
        }

        if (filters.lowStock === true || filters.lowStock === 'true') filters.lowStockOnly = true;

        if (filters.lowStockOnly === true || filters.lowStockOnly === 'true') {
            where.stock = { [Op.gt]: 0, [Op.lte]: 5 };
        } else if (filters.outOfStockOnly === true || filters.outOfStockOnly === 'true') {
            where.stock = 0;
        } else if (filters.inStockOnly === true || filters.inStockOnly === 'true') {
            where.stock = { [Op.gt]: 0 };
        }

        // Sequelize-style stock filters from export controller
        if (filters.stock) where.stock = filters.stock;

        if (filters.status !== undefined) where.status = filters.status;

        return where;
    }

    _buildOrder(sortBy) {
        switch (sortBy) {
            case 'price_asc':  return [['price', 'ASC']];
            case 'price_desc': return [['price', 'DESC']];
            case 'rating':     return [['rating', 'DESC']];
            case 'name':       return [['model', 'ASC']];
            case 'newest':
            default:           return [['createdAt', 'DESC']];
        }
    }
}

const productService = new ProductService();
module.exports = productService;
