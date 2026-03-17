/**
 * Inventory Controller
 * 
 * Handles HTTP requests for inventory management:
 * - Get paginated inventory products with filters
 * - Get inventory statistics
 * - Update product stock
 * - Get brands list
 * - Export inventory data
 */

const inventoryService = require('../services/inventory.service');
const productService = require('../services/product.service');
const Product = require('../models/Product.model');

/**
 * Get paginated inventory products with filters
 * GET /api/admin/inventory
 * 
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 10, max: 50)
 * - search: Search query (model, sku, brand)
 * - stockStatus: Filter by status (in-stock, low-stock, out-of-stock)
 * - category: Filter by category/gender (Men, Women, Unisex)
 * - brand: Filter by brand name
 * - sortBy: Sort option (stock-asc, stock-desc, name-asc, name-desc, value-asc, value-desc)
 */
exports.getInventoryProducts = async (req, res) => {
    try {
        // Parse query parameters
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 10), 50);
        const search = req.query.search?.trim() || '';
        const stockStatus = req.query.stockStatus || '';
        const category = req.query.category || '';
        const brand = req.query.brand || '';
        const sortBy = req.query.sortBy || 'stock-asc';

        // Validate stockStatus
        const validStockStatuses = ['', 'in-stock', 'low-stock', 'out-of-stock'];
        if (!validStockStatuses.includes(stockStatus)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid stockStatus. Must be: in-stock, low-stock, or out-of-stock.'
            });
        }

        // Validate category
        const validCategories = ['', 'Men', 'Women', 'Unisex', 'Accessories', 'Gift Picks'];
        if (category && !validCategories.includes(category)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid category. Must be: Men, Women, or Unisex.'
            });
        }

        // Validate sortBy
        const validSortOptions = ['stock-asc', 'stock-desc', 'name-asc', 'name-desc', 'value-asc', 'value-desc'];
        if (!validSortOptions.includes(sortBy)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid sortBy option.'
            });
        }

        // Build filters object
        const filters = {
            search: search || undefined,
            stockStatus: stockStatus || undefined,
            category: category || undefined,
            brand: brand || undefined,
            sortBy: sortBy
        };

        // Remove undefined values
        Object.keys(filters).forEach(key => {
            if (filters[key] === undefined) {
                delete filters[key];
            }
        });

        // Get inventory products
        const result = await inventoryService.getInventoryProducts(filters, { page, limit });

        res.json({
            success: true,
            data: {
                products: result.products,
                pagination: result.pagination,
                stats: result.stats
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[Inventory Controller] Error getting inventory products:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch inventory products'
        });
    }
};

/**
 * Get inventory statistics
 * GET /api/admin/inventory/stats
 */
exports.getInventoryStats = async (req, res) => {
    try {
        const stats = await inventoryService.getInventoryStats();

        res.json({
            success: true,
            data: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[Inventory Controller] Error getting inventory stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch inventory statistics'
        });
    }
};

/**
 * Update product stock
 * PUT /api/admin/inventory/stock/:productId
 * 
 * Body:
 * - adjustmentType: 'set' | 'add' | 'subtract'
 * - quantity: number (required)
 * - reason: string (optional)
 */
exports.updateStock = async (req, res) => {
    try {
        const { productId } = req.params;
        const { adjustmentType, quantity, reason } = req.body;

        // Validate productId
        if (!productId || productId.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Product ID is required'
            });
        }

        // Validate adjustmentType
        const validAdjustmentTypes = ['set', 'add', 'subtract'];
        if (!adjustmentType || !validAdjustmentTypes.includes(adjustmentType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid adjustmentType. Must be: set, add, or subtract.'
            });
        }

        // Validate quantity
        if (quantity === undefined || quantity === null) {
            return res.status(400).json({
                success: false,
                message: 'Quantity is required'
            });
        }

        const quantityNum = parseInt(quantity);
        if (isNaN(quantityNum) || quantityNum < 0) {
            return res.status(400).json({
                success: false,
                message: 'Quantity must be a non-negative number'
            });
        }

        // Get product
        const product = await Product.findByPk(productId);
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        // Store old stock
        const oldStock = product.stock || 0;
        let newStock;

        // Calculate new stock based on adjustment type
        if (adjustmentType === 'set') {
            // Set stock to specific value
            newStock = quantityNum;
        } else if (adjustmentType === 'add') {
            // Add quantity to current stock
            newStock = oldStock + quantityNum;
        } else if (adjustmentType === 'subtract') {
            // Subtract quantity from current stock (minimum 0)
            newStock = Math.max(0, oldStock - quantityNum);
        }

        // Update stock directly (not using productService.updateProductStock 
        // because it only supports add/subtract, not 'set' operation)
        product.stock = newStock;

        // Update status based on stock level
        if (newStock === 0) {
            // If stock reaches 0, set status to out_of_stock
            product.status = 'out_of_stock';
        } else if (product.status === 'out_of_stock' && newStock > 0) {
            // If stock was 0 and now has stock, reactivate product
            product.status = 'active';
        }

        // Save product to database
        await product.save();

        // Log stock adjustment reason if provided
        if (reason && reason.trim().length > 0) {
            console.log(`[Inventory Controller] Stock adjustment for product ${productId}: ${adjustmentType} ${quantityNum} (${oldStock} -> ${newStock}). Reason: ${reason.trim()}`);
        }

        // Check if stock is now low or out of stock and send notification (if enabled)
        const threshold = product.lowStockThreshold || 5;
        const isLowStock = newStock > 0 && newStock <= threshold;
        const isOutOfStock = newStock === 0;
        
        // Only send notification if stock became low/out (wasn't already low/out)
        const wasLowStock = oldStock > 0 && oldStock <= threshold;
        const wasOutOfStock = oldStock === 0;
        
        if ((isLowStock && !wasLowStock) || (isOutOfStock && !wasOutOfStock)) {
            try {
                const emailService = require('../services/email.service');
                const productObj = product.toObject ? product.toObject() : product;
                await emailService.sendLowStockNotificationToAdmin(productObj);
            } catch (emailError) {
                console.error('[Inventory Controller] Error sending low stock notification:', emailError);
                // Continue even if email fails - don't block stock update
            }
        }

        res.json({
            success: true,
            data: {
                product: {
                    _id: product.id,
                    model: product.model,
                    sku: product.sku,
                    stock: product.stock,
                    status: product.status
                },
                oldStock: oldStock,
                newStock: newStock,
                adjustmentType: adjustmentType,
                quantity: quantityNum
            },
            message: `Stock updated successfully from ${oldStock} to ${newStock}`
        });
    } catch (error) {
        console.error('[Inventory Controller] Error updating stock:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update stock'
        });
    }
};

/**
 * Get list of unique brands
 * GET /api/admin/inventory/brands
 */
exports.getBrands = async (req, res) => {
    try {
        const brands = await inventoryService.getBrandsList();

        res.json({
            success: true,
            data: brands,
            count: brands.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[Inventory Controller] Error getting brands:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch brands'
        });
    }
};

/**
 * Export inventory data
 * GET /api/admin/inventory/export
 * 
 * Query params:
 * - format: 'csv' | 'json' (default: 'csv')
 * - Same filters as GET /api/admin/inventory
 */
exports.exportInventory = async (req, res) => {
    try {
        const format = (req.query.format || 'csv').toLowerCase();
        const {
            search,
            stockStatus,
            category,
            brand,
            sortBy = 'stock-asc'
        } = req.query;

        // Validate format
        if (format !== 'csv' && format !== 'json') {
            return res.status(400).json({
                success: false,
                message: 'Invalid format. Must be: csv or json.'
            });
        }

        // Build filters object (same as getInventoryProducts)
        const filters = {
            search: search?.trim() || undefined,
            stockStatus: stockStatus || undefined,
            category: category || undefined,
            brand: brand || undefined,
            sortBy: sortBy || 'stock-asc'
        };

        // Remove undefined values
        Object.keys(filters).forEach(key => {
            if (filters[key] === undefined) {
                delete filters[key];
            }
        });

        // Get all products (no pagination limit for export, max 10,000)
        const result = await inventoryService.getInventoryProducts(filters, { page: 1, limit: 10000 });
        const products = result.products;
        const stats = result.stats;

        if (products.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No products to export'
            });
        }

        const exportDate = new Date().toISOString().split('T')[0];

        if (format === 'json') {
            // Export as JSON
            const exportData = {
                exportDate: exportDate,
                exportTime: new Date().toISOString(),
                statistics: {
                    totalProducts: stats.totalProducts || products.length,
                    inStock: stats.inStock || 0,
                    lowStock: stats.lowStock || 0,
                    outOfStock: stats.outOfStock || 0,
                    totalValue: stats.totalValue || 0,
                    exportedCount: products.length
                },
                filters: filters,
                products: products.map(product => ({
                    model: product.model,
                    sku: product.sku,
                    brand: product.brand,
                    stock: product.stock,
                    lowStockThreshold: product.lowStockThreshold,
                    price: product.price,
                    totalValue: product.totalValue,
                    stockStatus: product.stockStatus,
                    gender: product.gender,
                    status: product.status,
                    imageUrl: product.images && product.images[0] ? product.images[0] : ''
                }))
            };

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="inventory_export_${exportDate}.json"`);
            res.json(exportData);
        } else {
            // Export as CSV
            const escapeCsvCell = (cell) => {
                const cellStr = String(cell || '');
                if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
                    return `"${cellStr.replace(/"/g, '""')}"`;
                }
                return cellStr;
            };

            // Statistics section
            const statsRows = [
                ['Export Date', exportDate],
                ['Total Products', stats.totalProducts || products.length],
                ['In Stock', stats.inStock || 0],
                ['Low Stock', stats.lowStock || 0],
                ['Out of Stock', stats.outOfStock || 0],
                ['Total Inventory Value', stats.totalValue || 0],
                ['Exported Count', products.length],
                [], // Empty row separator
                ['Product Data'], // Section header
                [] // Empty row separator
            ];

            // Headers (order matches specification)
            const headers = [
                'Image URL',
                'Model',
                'SKU',
                'Brand',
                'Stock',
                'Low Stock Threshold',
                'Stock Status',
                'Unit Price',
                'Total Value',
                'Category'
            ];

            // Product rows (order matches headers)
            const productRows = products.map(product => [
                (product.images && product.images[0]) ? product.images[0] : '',
                product.model || '',
                product.sku || '',
                product.brand || '',
                product.stock || 0,
                product.lowStockThreshold || 5,
                product.stockStatus || '',
                product.price || 0,
                product.totalValue || 0,
                product.gender || ''
            ]);

            // Combine all rows
            const csvContent = [
                ...statsRows.map(row => row.map(escapeCsvCell).join(',')),
                headers.map(escapeCsvCell).join(','),
                ...productRows.map(row => row.map(escapeCsvCell).join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="inventory_export_${exportDate}.csv"`);
            res.send(csvContent);
        }
    } catch (error) {
        console.error('[Inventory Controller] Error exporting inventory:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export inventory data'
        });
    }
};

module.exports = exports;

