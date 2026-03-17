/**
 * Inventory Service
 *
 * Handles inventory-related business logic using Sequelize.
 */

const { Op, literal, fn, col } = require('sequelize');
const Product = require('../models/Product.model');

class InventoryService {
    DEFAULT_LOW_STOCK_THRESHOLD = 5;

    /**
     * Get overall inventory statistics
     */
    async getInventoryStats() {
        try {
            const products = await Product.findAll({
                attributes: ['stock', 'lowStockThreshold', 'price'],
                raw: true
            });

            return this._computeStats(products);
        } catch (error) {
            console.error('[Inventory Service] Error getting inventory stats:', error);
            throw error;
        }
    }

    /**
     * Get paginated list of products with filters
     */
    async getInventoryProducts(filters = {}, pagination = {}) {
        try {
            const {
                search,
                stockStatus,
                category,
                brand,
                sortBy = 'stock-asc'
            } = filters;

            const { page = 1, limit = 10 } = pagination;
            const offset = (page - 1) * limit;

            const where = {};

            if (search) {
                where[Op.or] = [
                    { model: { [Op.like]: `%${search.trim()}%` } },
                    { sku:   { [Op.like]: `%${search.trim()}%` } },
                    { brand: { [Op.like]: `%${search.trim()}%` } }
                ];
            }

            if (stockStatus === 'out-of-stock') {
                where.stock = 0;
            } else if (stockStatus === 'low-stock') {
                // stock > 0 AND stock <= lowStockThreshold
                where.stock = { [Op.gt]: 0 };
                where[Op.and] = [literal('`stock` <= `lowStockThreshold`')];
            } else if (stockStatus === 'in-stock') {
                // stock > lowStockThreshold
                where[Op.and] = [literal('`stock` > `lowStockThreshold`')];
            }

            if (category) where.gender = category;
            if (brand)    where.brand  = { [Op.like]: `%${brand}%` };

            const order = this._buildOrder(sortBy);

            const { count: totalCount, rows } = await Product.findAndCountAll({
                where,
                attributes: ['id', 'model', 'sku', 'brand', 'stock', 'lowStockThreshold', 'price', 'images', 'gender', 'status'],
                order,
                limit,
                offset,
                raw: true
            });

            const formattedProducts = rows.map(product => {
                const threshold = product.lowStockThreshold || this.DEFAULT_LOW_STOCK_THRESHOLD;
                const stockSt = this.calculateStockStatus(product.stock || 0, threshold);
                const images = typeof product.images === 'string' ? JSON.parse(product.images || '[]') : (product.images || []);
                return {
                    _id: String(product.id),
                    id: product.id,
                    model: product.model,
                    sku: product.sku,
                    brand: product.brand,
                    stock: product.stock || 0,
                    lowStockThreshold: threshold,
                    price: parseFloat(product.price) || 0,
                    totalValue: (product.stock || 0) * (parseFloat(product.price) || 0),
                    stockStatus: stockSt.status,
                    images,
                    gender: product.gender || '',
                    status: product.status || 'active'
                };
            });

            const allFiltered = await Product.findAll({
                where,
                attributes: ['stock', 'lowStockThreshold', 'price'],
                raw: true
            });
            const stats = this._computeStats(allFiltered);

            const totalPages = Math.max(1, Math.ceil(totalCount / limit));

            return {
                products: formattedProducts,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalCount,
                    limit,
                    hasNextPage: page < totalPages,
                    hasPreviousPage: page > 1
                },
                stats
            };
        } catch (error) {
            console.error('[Inventory Service] Error getting inventory products:', error);
            throw error;
        }
    }

    /**
     * Calculate stock status for a single product
     */
    calculateStockStatus(stock, threshold = this.DEFAULT_LOW_STOCK_THRESHOLD) {
        if (stock === 0) {
            return { status: 'out-of-stock', label: 'Out of Stock', class: 'out-of-stock' };
        } else if (stock > 0 && stock <= threshold) {
            return { status: 'low-stock', label: 'Low Stock', class: 'low-stock' };
        } else {
            return { status: 'in-stock', label: 'In Stock', class: 'in-stock' };
        }
    }

    /**
     * Get unique brands list
     */
    async getBrandsList() {
        try {
            const results = await Product.findAll({
                attributes: ['brand'],
                where: { brand: { [Op.ne]: '' } },
                group: ['brand'],
                raw: true
            });
            return results.map(r => r.brand).sort();
        } catch (error) {
            console.error('[Inventory Service] Error getting brands list:', error);
            throw error;
        }
    }

    // ── private helpers ───────────────────────────────────────────────────────

    _computeStats(products) {
        let totalProducts = 0, inStock = 0, lowStock = 0, outOfStock = 0, totalValue = 0;
        for (const p of products) {
            const stock = p.stock || 0;
            const threshold = p.lowStockThreshold || this.DEFAULT_LOW_STOCK_THRESHOLD;
            const price = parseFloat(p.price) || 0;
            totalProducts++;
            totalValue += stock * price;
            if (stock === 0)             outOfStock++;
            else if (stock <= threshold) lowStock++;
            else                         inStock++;
        }
        return { totalProducts, inStock, lowStock, outOfStock, totalValue };
    }

    _buildOrder(sortBy) {
        switch (sortBy) {
            case 'stock-asc':   return [['stock', 'ASC']];
            case 'stock-desc':  return [['stock', 'DESC']];
            case 'name-asc':    return [['model', 'ASC']];
            case 'name-desc':   return [['model', 'DESC']];
            case 'value-asc':   return [literal('`stock` * `price` ASC')];
            case 'value-desc':  return [literal('`stock` * `price` DESC')];
            default:            return [['stock', 'ASC']];
        }
    }
}

module.exports = new InventoryService();
