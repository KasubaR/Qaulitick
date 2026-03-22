/**
 * Dashboard Controller
 * 
 * Handles all dashboard-related API endpoints
 * Provides statistics, charts, and data for admin dashboard
 */

const dashboardService = require('../services/dashboard.service');
const Order = require('../models/Order.model');
const Product = require('../models/Product.model');
const { Op, fn, col, where, literal } = require('sequelize');

/**
 * Get all dashboard statistics (KPIs)
 * GET /api/admin/dashboard/stats?updatedSince=ISO_DATE
 */
exports.getDashboardStats = async (req, res) => {
    try {
        const updatedSince = req.query.updatedSince 
            ? new Date(req.query.updatedSince) 
            : null;
        
        // Validate date if provided
        if (updatedSince && isNaN(updatedSince.getTime())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid updatedSince date format'
            });
        }
        
        const stats = await dashboardService.getDashboardStats(updatedSince);
        
        res.json({
            success: true,
            data: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[Dashboard Controller] Error getting dashboard stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dashboard statistics'
        });
    }
};

/**
 * Get recent orders with pagination
 * GET /api/admin/dashboard/recent-orders?limit=10&page=1&updatedSince=ISO_DATE
 */
exports.getRecentOrders = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const page = parseInt(req.query.page) || 1;
        const updatedSince = req.query.updatedSince 
            ? new Date(req.query.updatedSince) 
            : null;
        
        // Validate limit (max 50 to prevent abuse)
        const validLimit = Math.min(Math.max(1, limit), 50);
        
        // Validate page (must be >= 1)
        const validPage = Math.max(1, page);
        
        // Validate date if provided
        if (updatedSince && isNaN(updatedSince.getTime())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid updatedSince date format'
            });
        }
        
        const result = await dashboardService.getRecentOrders(validLimit, validPage, updatedSince);
        
        res.json({
            success: true,
            data: result.orders,
            pagination: result.pagination,
            count: result.orders.length,
            timestamp: new Date().toISOString(),
            hasChanges: result.orders.length > 0
        });
    } catch (error) {
        console.error('[Dashboard Controller] Error getting recent orders:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch recent orders'
        });
    }
};

/**
 * Get order summary counts by status
 * GET /api/admin/dashboard/order-summary?updatedSince=ISO_DATE
 */
exports.getOrderSummary = async (req, res) => {
    try {
        const updatedSince = req.query.updatedSince 
            ? new Date(req.query.updatedSince) 
            : null;
        
        // Validate date if provided
        if (updatedSince && isNaN(updatedSince.getTime())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid updatedSince date format'
            });
        }
        
        const summary = await dashboardService.getOrderSummary(updatedSince);
        
        res.json({
            success: true,
            data: summary,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[Dashboard Controller] Error getting order summary:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch order summary'
        });
    }
};

/**
 * Get low stock products
 * GET /api/admin/dashboard/low-stock?limit=10&threshold=10
 */
exports.getLowStockProducts = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const threshold = parseInt(req.query.threshold) || 10;
        
        // Validate parameters
        const validLimit = Math.min(Math.max(1, limit), 50);
        const validThreshold = Math.min(Math.max(1, threshold), 100);
        
        const products = await dashboardService.getLowStockProducts(validLimit, validThreshold);
        
        res.json({
            success: true,
            data: products,
            count: products.length
        });
    } catch (error) {
        console.error('[Dashboard Controller] Error getting low stock products:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch low stock products'
        });
    }
};

/**
 * Get best selling products
 * GET /api/admin/dashboard/best-selling?limit=10
 */
exports.getBestSellingProducts = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        
        // Validate limit (max 50 to prevent abuse)
        const validLimit = Math.min(Math.max(1, limit), 50);
        
        const products = await dashboardService.getBestSellingProducts(validLimit);
        
        res.json({
            success: true,
            data: products,
            count: products.length
        });
    } catch (error) {
        console.error('[Dashboard Controller] Error getting best selling products:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch best selling products'
        });
    }
};

/**
 * Get top customers
 * GET /api/admin/dashboard/top-customers?limit=10
 */
exports.getTopCustomers = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        
        // Validate limit (max 50 to prevent abuse)
        const validLimit = Math.min(Math.max(1, limit), 50);
        
        const customers = await dashboardService.getTopCustomers(validLimit);
        
        res.json({
            success: true,
            data: customers,
            count: customers.length
        });
    } catch (error) {
        console.error('[Dashboard Controller] Error getting top customers:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch top customers'
        });
    }
};

/**
 * Get chart data (sales or revenue)
 * GET /api/admin/dashboard/charts/:type?period=daily
 * @param {String} type - 'sales' or 'revenue'
 */
exports.getChartData = async (req, res) => {
    try {
        const { type } = req.params;
        const period = req.query.period || (type === 'revenue' ? 'monthly' : 'daily');
        
        console.log(`[Dashboard Controller] Chart request - Type: ${type}, Period: ${period}`);
        
        // Validate type
        if (type !== 'sales' && type !== 'revenue') {
            return res.status(400).json({
                success: false,
                message: 'Invalid chart type. Must be "sales" or "revenue"'
            });
        }
        
        // Validate period
        const validPeriods = ['daily', 'weekly', 'monthly'];
        if (!validPeriods.includes(period)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid period. Must be "daily", "weekly", or "monthly"'
            });
        }
        
        let chartData;
        if (type === 'sales') {
            chartData = await dashboardService.getSalesChartData(period);
        } else {
            chartData = await dashboardService.getRevenueChartData(period);
        }
        
        res.json({
            success: true,
            data: chartData,
            type: type,
            period: period
        });
    } catch (error) {
        console.error('[Dashboard Controller] Error getting chart data:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch chart data'
        });
    }
};

/**
 * Search dashboard data (orders, products, customers)
 * GET /api/admin/dashboard/search?q=query
 */
exports.searchDashboard = async (req, res) => {
    try {
        const query = req.query.q;
        
        if (!query || query.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Search query is required'
            });
        }
        
        // Sanitize search query
        const searchTerm = query.trim().substring(0, 100); // Limit length
        const like = `%${searchTerm}%`;

        const jsonLike = (field) => where(
            fn('JSON_UNQUOTE', fn('JSON_EXTRACT', col('customer'), literal(`'$.${field}'`))),
            { [Op.like]: like }
        );

        // Search orders, products, and customers in parallel
        const [orders, products, customers] = await Promise.all([
            // Search orders by order number, customer name, email, or phone
            Order.findAll({
                where: {
                    [Op.or]: [
                        { orderNumber: { [Op.like]: like } },
                        jsonLike('name'),
                        jsonLike('email'),
                        jsonLike('phone')
                    ]
                },
                attributes: ['orderNumber', 'customer', 'createdAt', 'totals', 'status'],
                order: [['createdAt', 'DESC']],
                limit: 10
            }),

            // Search products by model, brand, or SKU
            Product.findAll({
                where: {
                    [Op.or]: [
                        { model: { [Op.like]: like } },
                        { brand: { [Op.like]: like } },
                        { sku: { [Op.like]: like } }
                    ],
                    status: 'active'
                },
                attributes: ['model', 'brand', 'sku', 'price', 'stock', 'images'],
                limit: 10
            }),

            // Search customers by grouping orders on customer email
            Order.findAll({
                where: {
                    [Op.or]: [
                        jsonLike('name'),
                        jsonLike('email'),
                        jsonLike('phone')
                    ]
                },
                attributes: [
                    'customer',
                    [fn('COUNT', col('id')), 'orderCount'],
                    [fn('SUM', literal("JSON_EXTRACT(totals, '$.total')")), 'totalSpent']
                ],
                group: [literal("JSON_EXTRACT(customer, '$.email')")],
                limit: 10
            })
        ]);
        
        // Format results
        const results = {
            orders: orders.map(order => ({
                type: 'order',
                orderNumber: order.orderNumber,
                customerName: order.customer.name,
                customerEmail: order.customer.email,
                date: order.createdAt,
                amount: order.totals.total,
                status: order.status
            })),
            products: products.map(product => ({
                type: 'product',
                model: product.model,
                brand: product.brand,
                sku: product.sku,
                price: product.price,
                stock: product.stock,
                image: product.images && product.images[0] ? product.images[0] : null
            })),
            customers: customers.map(row => ({
                type: 'customer',
                name: row.customer.name,
                email: row.customer.email,
                phone: row.customer.phone,
                orders: row.dataValues.orderCount,
                totalSpent: row.dataValues.totalSpent
            }))
        };
        
        res.json({
            success: true,
            data: results,
            query: searchTerm,
            counts: {
                orders: results.orders.length,
                products: results.products.length,
                customers: results.customers.length
            }
        });
    } catch (error) {
        console.error('[Dashboard Controller] Error searching dashboard:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to perform search'
        });
    }
};

module.exports = exports;

