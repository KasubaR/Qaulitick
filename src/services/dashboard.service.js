/**
 * Dashboard Service
 *
 * Handles all dashboard-related data aggregation and statistics
 * Aggregates data from Orders, Products, and Payments
 */

const { Op, QueryTypes } = require('sequelize');
const { sequelize } = require('../config/mysql');
const Order = require('../models/Order.model');
const Product = require('../models/Product.model');
const Payment = require('../models/Payment.model');
const User = require('../models/User.model');

class DashboardService {
    /**
     * Get all dashboard statistics (KPIs)
     * @param {Date} updatedSince - Optional date to check for changes since (for efficient polling)
     * @returns {Promise<Object>} Dashboard stats with percentage changes
     */
    async getDashboardStats(updatedSince = null) {
        try {
            const [
                totalOrders,
                totalProducts,
                lowStockCount,
                revenueResult,
                laybyResult
            ] = await Promise.all([
                Order.count({
                    where: {
                        status: { [Op.ne]: 'cancelled' }
                    }
                }),
                Product.count({
                    where: { status: 'active' }
                }),
                Product.count({
                    where: {
                        stock: { [Op.gt]: 0, [Op.lte]: 10 },
                        status: 'active'
                    }
                }),
                sequelize.query(`
                    SELECT
                        COALESCE(SUM(JSON_EXTRACT(totals, '$.total')), 0) AS revenue
                    FROM orders
                    WHERE status IN ('paid', 'confirmed', 'processing', 'packed', 'shipped', 'delivered')
                      AND paymentStatus = 'completed'
                `, { type: QueryTypes.SELECT }),
                sequelize.query(`
                    SELECT COALESCE(SUM(amount), 0) AS laybyRevenue
                    FROM layby_payments
                    WHERE status = 'paid'
                `, { type: QueryTypes.SELECT })
            ]);

            const orderRevenue = Number(revenueResult[0]?.revenue) || 0;
            const laybyRevenue = Number(laybyResult[0]?.laybyRevenue) || 0;
            const currentRevenueValue = orderRevenue + laybyRevenue;
            const previousRevenueValue = 0;

            // Unique customer emails from:
            //   - Standard orders with paymentStatus = 'completed'
            //   - Layby orders with at least one installment paid (balanceRemaining < orderTotal)
            // UNION dedupes the same email appearing in both branches.
            const [{ total }] = await sequelize.query(`
                SELECT COUNT(*) AS total FROM (
                    SELECT LOWER(JSON_UNQUOTE(JSON_EXTRACT(o.customer, '$.email'))) AS email
                    FROM orders o
                    WHERE o.status NOT IN ('cancelled', 'payment_failed')
                      AND JSON_UNQUOTE(JSON_EXTRACT(o.customer, '$.email')) IS NOT NULL
                      AND TRIM(JSON_UNQUOTE(JSON_EXTRACT(o.customer, '$.email'))) != ''
                      AND (
                          (o.checkoutMode != 'layby' AND o.paymentStatus = 'completed')
                          OR
                          (o.checkoutMode = 'layby' AND EXISTS (
                              SELECT 1 FROM layby_plans lp
                              WHERE lp.orderId = o.id
                                AND lp.balanceRemaining < lp.orderTotal
                          ))
                      )
                    UNION
                    SELECT LOWER(u.email) AS email
                    FROM orders o
                    INNER JOIN users u ON u.id = o.userId
                    WHERE o.status NOT IN ('cancelled', 'payment_failed')
                      AND u.email IS NOT NULL
                      AND TRIM(u.email) != ''
                      AND (
                          (o.checkoutMode != 'layby' AND o.paymentStatus = 'completed')
                          OR
                          (o.checkoutMode = 'layby' AND EXISTS (
                              SELECT 1 FROM layby_plans lp
                              WHERE lp.orderId = o.id
                                AND lp.balanceRemaining < lp.orderTotal
                          ))
                      )
                ) AS unique_customers
            `, { type: QueryTypes.SELECT });

            const currentCustomersCount = Number(total) || 0;
            const previousCustomersCount = 0;

            const salesChange = this.calculatePercentageChange(currentRevenueValue, previousRevenueValue);
            const revenueChange = salesChange;
            const customersChange = this.calculatePercentageChange(currentCustomersCount, previousCustomersCount);
            const ordersChange = this.calculatePercentageChange(totalOrders, 0);

            return {
                totalSales: currentRevenueValue,
                totalOrders: totalOrders,
                totalCustomers: currentCustomersCount,
                totalProducts: totalProducts,
                totalRevenue: currentRevenueValue,
                lowStockCount: lowStockCount,
                salesChange: salesChange,
                ordersChange: ordersChange,
                customersChange: customersChange,
                revenueChange: revenueChange,
                productsChange: 0
            };
        } catch (error) {
            console.error('[Dashboard Service] Error getting dashboard stats:', error);
            throw error;
        }
    }

    /**
     * Get recent orders with pagination
     * @param {Number} limit - Maximum number of orders to return per page
     * @param {Number} page - Page number (1-based)
     * @param {Date} updatedSince - Only return orders updated/created after this date (optional)
     * @returns {Promise<Object>} Object with orders array, pagination info, and total count
     */
    async getRecentOrders(limit = 10, page = 1, updatedSince = null) {
        try {
            const where = {
                status: { [Op.ne]: 'cancelled' }
            };

            if (updatedSince) {
                where[Op.or] = [
                    { createdAt: { [Op.gte]: updatedSince } },
                    { updatedAt: { [Op.gte]: updatedSince } }
                ];
            }

            const offset = (page - 1) * limit;

            const [totalCount, orders] = await Promise.all([
                Order.count({ where }),
                Order.findAll({
                    where,
                    order: [['createdAt', 'DESC']],
                    limit,
                    offset,
                    raw: true
                })
            ]);

            const totalPages = Math.max(1, Math.ceil(totalCount / limit));

            return {
                orders: orders.map(order => {
                    const customer = typeof order.customer === 'string' ? JSON.parse(order.customer) : (order.customer || {});
                    const totals = typeof order.totals === 'string' ? JSON.parse(order.totals) : (order.totals || {});
                    return {
                        orderNumber: order.orderNumber,
                        customerName: customer.name,
                        customerEmail: customer.email,
                        date: order.createdAt,
                        updatedAt: order.updatedAt,
                        amount: totals.total,
                        status: order.status
                    };
                }),
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalCount,
                    limit,
                    hasNextPage: page < totalPages,
                    hasPreviousPage: page > 1
                }
            };
        } catch (error) {
            console.error('[Dashboard Service] Error getting recent orders:', error);
            throw error;
        }
    }

    /**
     * Get order summary counts by status
     * @param {Date} updatedSince - Only count orders updated/created after this date (optional)
     * @returns {Promise<Object>} Order counts by status
     */
    async getOrderSummary(updatedSince = null) {
        try {
            const where = {};

            if (updatedSince) {
                where[Op.or] = [
                    { createdAt: { [Op.gte]: updatedSince } },
                    { updatedAt: { [Op.gte]: updatedSince } }
                ];
            }

            const orders = await Order.findAll({
                attributes: ['status'],
                where,
                raw: true
            });

            const statusMap = {
                'pending': 'new',
                'payment_pending': 'new',
                'paid': 'new',
                'confirmed': 'processing',
                'processing': 'processing',
                'packed': 'processing',
                'shipped': 'processing',
                'delivered': 'delivered',
                'cancelled': 'cancelled',
                'payment_failed': 'cancelled',
                'returned': 'cancelled'
            };

            const result = { new: 0, processing: 0, delivered: 0, cancelled: 0 };

            orders.forEach(order => {
                const category = statusMap[order.status] || 'processing';
                result[category] = (result[category] || 0) + 1;
            });

            return result;
        } catch (error) {
            console.error('[Dashboard Service] Error getting order summary:', error);
            throw error;
        }
    }

    /**
     * Get layby overview stats for dashboard
     * @returns {Promise<Object>} { active, overdue, completed, outstandingBalance }
     */
    async getLaybyOverview() {
        const LaybyPlan = require('../models/LaybyPlan.model');
        const now = new Date();

        const [active, overdue, completed, outstandingRows] = await Promise.all([
            LaybyPlan.count({ where: { status: 'active' } }),
            LaybyPlan.count({ where: { status: 'active', nextDueAt: { [Op.lt]: now } } }),
            LaybyPlan.count({ where: { status: 'completed' } }),
            LaybyPlan.findAll({
                attributes: ['balanceRemaining'],
                where: { status: 'active' },
                raw: true
            })
        ]);

        const outstandingBalance = outstandingRows.reduce(
            (sum, r) => sum + parseFloat(r.balanceRemaining || 0), 0
        );

        return { active, overdue, completed, outstandingBalance };
    }

    /**
     * Get low stock products
     * @param {Number} limit - Maximum number of products to return
     * @param {Number} threshold - Stock threshold (default: 10)
     * @returns {Promise<Array>} Array of low stock products
     */
    async getLowStockProducts(limit = 10, threshold = 10) {
        try {
            const products = await Product.findAll({
                where: {
                    stock: { [Op.gt]: 0, [Op.lte]: threshold },
                    status: 'active'
                },
                order: [['stock', 'ASC']],
                limit,
                attributes: ['model', 'brand', 'sku', 'stock', 'status'],
                raw: true
            });

            return products.map(product => ({
                model: product.model,
                brand: product.brand,
                sku: product.sku,
                stock: product.stock,
                status: product.status
            }));
        } catch (error) {
            console.error('[Dashboard Service] Error getting low stock products:', error);
            throw error;
        }
    }

    /**
     * Get best selling products
     * @param {Number} limit - Maximum number of products to return
     * @returns {Promise<Array>} Array of best selling products
     */
    async getBestSellingProducts(limit = 10) {
        try {
            const validStatuses = ['paid', 'confirmed', 'processing', 'packed', 'shipped', 'delivered'];
            const orders = await Order.findAll({
                where: { status: { [Op.in]: validStatuses } },
                attributes: ['items'],
                raw: true
            });

            // Aggregate product sales from JSON items field
            const salesMap = {};
            for (const order of orders) {
                const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
                for (const item of items) {
                    const pid = String(item.productId || item.id || '');
                    if (!pid) continue;
                    if (!salesMap[pid]) {
                        salesMap[pid] = { productId: pid, totalQuantity: 0, totalRevenue: 0, productName: item.name || '' };
                    }
                    salesMap[pid].totalQuantity += item.quantity || 0;
                    salesMap[pid].totalRevenue += (item.price || 0) * (item.quantity || 0);
                    if (!salesMap[pid].productName) salesMap[pid].productName = item.name || '';
                }
            }

            const sorted = Object.values(salesMap)
                .sort((a, b) => b.totalQuantity - a.totalQuantity)
                .slice(0, limit);

            const productIds = sorted.map(s => s.productId);
            const products = await Product.findAll({
                where: { id: { [Op.in]: productIds } },
                attributes: ['id', 'model', 'brand', 'sku', 'images'],
                raw: true
            });

            const productMap = {};
            products.forEach(p => { productMap[String(p.id)] = p; });

            return sorted.map(sale => {
                const product = productMap[sale.productId] || {};
                const images = typeof product.images === 'string' ? JSON.parse(product.images || '[]') : (product.images || []);
                return {
                    productId: sale.productId,
                    name: sale.productName || product.model || 'Unknown Product',
                    model: product.model,
                    brand: product.brand,
                    sku: product.sku,
                    image: images[0] || null,
                    sales: sale.totalQuantity,
                    revenue: sale.totalRevenue
                };
            });
        } catch (error) {
            console.error('[Dashboard Service] Error getting best selling products:', error);
            throw error;
        }
    }

    /**
     * Get top customers by total spent
     * @param {Number} limit - Maximum number of customers to return
     * @returns {Promise<Array>} Array of top customers
     */
    async getTopCustomers(limit = 10) {
        try {
            const validStatuses = ['paid', 'confirmed', 'processing', 'packed', 'shipped', 'delivered'];
            const orders = await Order.findAll({
                where: { status: { [Op.in]: validStatuses } },
                attributes: ['customer', 'totals'],
                raw: true
            });

            const customerMap = {};
            for (const order of orders) {
                const customer = typeof order.customer === 'string' ? JSON.parse(order.customer) : (order.customer || {});
                const totals = typeof order.totals === 'string' ? JSON.parse(order.totals) : (order.totals || {});
                const email = customer.email || '';
                if (!email) continue;
                if (!customerMap[email]) {
                    customerMap[email] = { name: customer.name, email, phone: customer.phone, orderCount: 0, totalSpent: 0 };
                }
                customerMap[email].orderCount += 1;
                customerMap[email].totalSpent += totals.total || 0;
            }

            return Object.values(customerMap)
                .sort((a, b) => b.totalSpent - a.totalSpent)
                .slice(0, limit)
                .map(c => ({ name: c.name, email: c.email, phone: c.phone, orders: c.orderCount, totalSpent: c.totalSpent }));
        } catch (error) {
            console.error('[Dashboard Service] Error getting top customers:', error);
            throw error;
        }
    }

    /**
     * Get sales chart data for a specific period
     * @param {String} period - 'daily' | 'weekly' | 'monthly'
     * @returns {Promise<Object>} Chart data with labels and data arrays
     */
    async getSalesChartData(period = 'daily') {
        try {
            const now = new Date();
            let startDate, dateFormat, groupKey;

            switch (period) {
                case 'monthly':
                    startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
                    groupKey = order => {
                        const d = new Date(order.createdAt);
                        return `${d.getFullYear()}-${d.getMonth()}`;
                    };
                    dateFormat = key => {
                        const [year, month] = key.split('-').map(Number);
                        return new Date(year, month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                    };
                    break;
                case 'weekly':
                case 'daily':
                default:
                    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    groupKey = order => {
                        const d = new Date(order.createdAt);
                        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
                    };
                    dateFormat = key => {
                        const [year, month, day] = key.split('-').map(Number);
                        return new Date(year, month, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                    };
                    break;
            }

            const orders = await Order.findAll({
                where: {
                    createdAt: { [Op.gte]: startDate },
                    status: { [Op.ne]: 'cancelled' }
                },
                attributes: ['createdAt'],
                raw: true
            });

            const grouped = {};
            orders.forEach(order => {
                const key = groupKey(order);
                grouped[key] = (grouped[key] || 0) + 1;
            });

            const sortedKeys = Object.keys(grouped).sort();
            const labels = sortedKeys.map(dateFormat);
            const data = sortedKeys.map(k => grouped[k]);

            return {
                labels: labels.length > 0 ? labels : this.getDefaultLabels(period),
                data: data.length > 0 ? data : this.getDefaultData(period)
            };
        } catch (error) {
            console.error('[Dashboard Service] Error getting sales chart data:', error);
            throw error;
        }
    }

    /**
     * Get revenue chart data for a specific period
     * @param {String} period - 'daily' | 'weekly' | 'monthly'
     * @returns {Promise<Object>} Chart data with labels and data arrays
     */
    async getRevenueChartData(period = 'monthly') {
        try {
            const now = new Date();
            let startDate, dateFormat, groupKey;
            const validStatuses = ['paid', 'confirmed', 'processing', 'packed', 'shipped', 'delivered'];

            switch (period) {
                case 'monthly':
                    startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
                    groupKey = order => {
                        const d = new Date(order.createdAt);
                        return `${d.getFullYear()}-${d.getMonth()}`;
                    };
                    dateFormat = key => {
                        const [year, month] = key.split('-').map(Number);
                        return new Date(year, month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                    };
                    break;
                case 'weekly':
                case 'daily':
                default:
                    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    groupKey = order => {
                        const d = new Date(order.createdAt);
                        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
                    };
                    dateFormat = key => {
                        const [year, month, day] = key.split('-').map(Number);
                        return new Date(year, month, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                    };
                    break;
            }

            const orders = await Order.findAll({
                where: {
                    createdAt: { [Op.gte]: startDate },
                    status: { [Op.in]: validStatuses }
                },
                attributes: ['createdAt', 'totals'],
                raw: true
            });

            const grouped = {};
            orders.forEach(order => {
                const key = groupKey(order);
                const totals = typeof order.totals === 'string' ? JSON.parse(order.totals) : (order.totals || {});
                grouped[key] = (grouped[key] || 0) + (totals.total || 0);
            });

            const sortedKeys = Object.keys(grouped).sort();
            const labels = sortedKeys.map(dateFormat);
            const data = sortedKeys.map(k => grouped[k]);

            return {
                labels: labels.length > 0 ? labels : this.getDefaultLabels(period),
                data: data.length > 0 ? data : this.getDefaultData(period)
            };
        } catch (error) {
            console.error('[Dashboard Service] Error getting revenue chart data:', error);
            throw error;
        }
    }

    /**
     * Calculate percentage change between two values
     */
    calculatePercentageChange(current, previous) {
        if (previous === 0) {
            return current > 0 ? 100 : 0;
        }
        const change = ((current - previous) / previous) * 100;
        return Math.round(change * 10) / 10;
    }

    getDefaultLabels(period) {
        switch (period) {
            case 'monthly':
                return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
            case 'weekly':
            case 'daily':
            default:
                return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        }
    }

    getDefaultData(period) {
        switch (period) {
            case 'monthly':
                return [0, 0, 0, 0, 0, 0];
            case 'weekly':
            case 'daily':
            default:
                return [0, 0, 0, 0, 0, 0, 0];
        }
    }
}

const dashboardService = new DashboardService();

module.exports = dashboardService;
