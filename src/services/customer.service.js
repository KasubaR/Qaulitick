/**
 * Customer Service — Sequelize implementation
 *
 * Customers are derived from the orders table (grouped by customer.email JSON field).
 */

const { Op, literal } = require('sequelize');
const Order = require('../models/Order.model');
const Payment = require('../models/Payment.model');

class CustomerService {

    async getCustomers(filters = {}, pagination = {}) {
        try {
            const { search, customerType, startDate, endDate, sortBy = 'newest' } = filters;
            const { page = 1, limit = 50 } = pagination;

            // Fetch all non-cancelled orders and aggregate in JS
            // (customer + totals are JSON columns — SQL GROUP BY on JSON is cumbersome)
            const orders = await Order.findAll({
                where: { status: { [Op.ne]: 'cancelled' } },
                attributes: ['customer', 'totals', 'createdAt'],
                raw: true
            });

            // Aggregate by customer email
            const customerMap = this._aggregateOrders(orders);
            let customers = Object.values(customerMap);

            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

            // Assign status
            customers = customers.map(c => ({
                ...c,
                status: c.totalSpent >= 10000 ? 'vip'
                      : c.firstOrderDate >= thirtyDaysAgo ? 'new'
                      : 'active'
            }));

            // Search filter
            if (search) {
                const term = search.trim().toLowerCase();
                customers = customers.filter(c =>
                    (c.name  || '').toLowerCase().includes(term) ||
                    (c.email || '').toLowerCase().includes(term) ||
                    (c.phone || '').toLowerCase().includes(term)
                );
            }

            // Customer type filter
            if (customerType === 'vip')    customers = customers.filter(c => c.status === 'vip');
            if (customerType === 'new')    customers = customers.filter(c => c.status === 'new');
            if (customerType === 'active') customers = customers.filter(c => c.status === 'active');

            // Date range filter (by firstOrderDate)
            if (startDate) customers = customers.filter(c => c.firstOrderDate >= new Date(startDate));
            if (endDate)   customers = customers.filter(c => c.firstOrderDate <= new Date(endDate));

            // Sort
            customers = this._sort(customers, sortBy);

            const totalCount = customers.length;
            const totalPages = Math.max(1, Math.ceil(totalCount / limit));
            const offset = (page - 1) * limit;
            const paginated = customers.slice(offset, offset + limit);

            return {
                customers: paginated,
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
            console.error('[Customer Service] Error getting customers:', error);
            throw error;
        }
    }

    async getCustomerStats() {
        try {
            const orders = await Order.findAll({
                where: { status: { [Op.ne]: 'cancelled' } },
                attributes: ['customer', 'totals', 'createdAt'],
                raw: true
            });

            const customerMap = this._aggregateOrders(orders);
            const customers = Object.values(customerMap);

            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            let totalRevenue = 0;
            let newCustomers = 0;

            for (const c of customers) {
                totalRevenue += c.totalSpent;
                if (c.firstOrderDate >= thirtyDaysAgo) newCustomers++;
            }

            return {
                totalCustomers: customers.length,
                activeCustomers: customers.length,
                newCustomers,
                totalRevenue
            };
        } catch (error) {
            console.error('[Customer Service] Error getting customer stats:', error);
            throw error;
        }
    }

    async getCustomerByEmail(email) {
        try {
            const normalizedEmail = email.toLowerCase().trim();

            const allOrders = await Order.findAll({
                where: { status: { [Op.ne]: 'cancelled' } },
                attributes: ['customer', 'totals', 'createdAt'],
                raw: true
            });

            const customerMap = this._aggregateOrders(allOrders);
            const customerData = customerMap[normalizedEmail];
            if (!customerData) return null;

            // Get full order records for this customer
            const orders = await Order.findAll({
                order: [['createdAt', 'DESC']],
                raw: true
            });

            const customerOrders = orders
                .filter(o => {
                    const c = typeof o.customer === 'string' ? JSON.parse(o.customer) : (o.customer || {});
                    return (c.email || '').toLowerCase() === normalizedEmail;
                })
                .map(o => {
                    const totals = typeof o.totals === 'string' ? JSON.parse(o.totals) : (o.totals || {});
                    const items  = typeof o.items  === 'string' ? JSON.parse(o.items)  : (o.items  || []);
                    return {
                        orderNumber: o.orderNumber,
                        createdAt:   o.createdAt,
                        updatedAt:   o.updatedAt,
                        total:       totals.total || 0,
                        status:      o.status,
                        itemCount:   items.length
                    };
                });

            // Get payments for this customer
            const payments = await Payment.findAll({
                order: [['createdAt', 'DESC']],
                raw: true
            });

            const customerPayments = payments
                .filter(p => {
                    const ci = typeof p.customerInfo === 'string' ? JSON.parse(p.customerInfo) : (p.customerInfo || {});
                    return (ci.email || '').toLowerCase() === normalizedEmail;
                })
                .map(p => ({
                    orderNumber:        p.orderNumber,
                    createdAt:          p.createdAt,
                    amount:             p.amount,
                    currency:           p.currency,
                    paymentMethod:      p.paymentMethod,
                    status:             p.status,
                    lencoTransactionId: p.lencoTransactionId
                }));

            return {
                customer: customerData,
                orders:   customerOrders,
                payments: customerPayments
            };
        } catch (error) {
            console.error('[Customer Service] Error getting customer by email:', error);
            throw error;
        }
    }

    async searchCustomers(query, limit = 10) {
        try {
            if (!query || query.trim().length === 0) return [];

            const orders = await Order.findAll({
                where: { status: { [Op.ne]: 'cancelled' } },
                attributes: ['customer', 'totals', 'createdAt'],
                raw: true
            });

            const customerMap = this._aggregateOrders(orders);
            const term = query.trim().toLowerCase();

            return Object.values(customerMap)
                .filter(c =>
                    (c.name  || '').toLowerCase().includes(term) ||
                    (c.email || '').toLowerCase().includes(term) ||
                    (c.phone || '').toLowerCase().includes(term)
                )
                .slice(0, limit)
                .map(c => ({
                    email:       c.email,
                    name:        c.name,
                    phone:       c.phone,
                    totalOrders: c.totalOrders,
                    totalSpent:  c.totalSpent
                }));
        } catch (error) {
            console.error('[Customer Service] Error searching customers:', error);
            throw error;
        }
    }

    // ── private helpers ───────────────────────────────────────────────────────

    _aggregateOrders(orders) {
        const map = {};
        for (const o of orders) {
            const customer = typeof o.customer === 'string' ? JSON.parse(o.customer) : (o.customer || {});
            const totals   = typeof o.totals   === 'string' ? JSON.parse(o.totals)   : (o.totals   || {});
            const email    = (customer.email || '').toLowerCase();
            if (!email) continue;

            const orderDate = new Date(o.createdAt);
            if (!map[email]) {
                map[email] = {
                    email,
                    name:           customer.name  || '',
                    phone:          customer.phone || '',
                    totalOrders:    0,
                    totalSpent:     0,
                    firstOrderDate: orderDate,
                    lastOrderDate:  orderDate
                };
            }

            const entry = map[email];
            entry.totalOrders++;
            entry.totalSpent += totals.total || 0;
            if (orderDate < entry.firstOrderDate) entry.firstOrderDate = orderDate;
            if (orderDate > entry.lastOrderDate)  entry.lastOrderDate  = orderDate;
            entry.averageOrderValue = entry.totalSpent / entry.totalOrders;
        }
        return map;
    }

    _sort(customers, sortBy) {
        const fns = {
            'newest':      (a, b) => b.lastOrderDate  - a.lastOrderDate,
            'oldest':      (a, b) => a.firstOrderDate - b.firstOrderDate,
            'name-asc':    (a, b) => (a.name || '').localeCompare(b.name || ''),
            'name-desc':   (a, b) => (b.name || '').localeCompare(a.name || ''),
            'spent-desc':  (a, b) => b.totalSpent  - a.totalSpent,
            'spent-asc':   (a, b) => a.totalSpent  - b.totalSpent,
            'orders-desc': (a, b) => b.totalOrders - a.totalOrders,
            'orders-asc':  (a, b) => a.totalOrders - b.totalOrders
        };
        return customers.sort(fns[sortBy] || fns['newest']);
    }
}

module.exports = new CustomerService();
