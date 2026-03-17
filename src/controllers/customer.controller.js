/**
 * Customer Controller
 * 
 * Handles HTTP requests for customer management:
 * - Get paginated customers list with filters
 * - Get customer statistics
 * - Get customer details by email
 */

const customerService = require('../services/customer.service');

/**
 * Get paginated customers list with filters
 * GET /api/admin/customers
 * 
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 50, max: 100)
 * - search: Search query (name, email, phone)
 * - customerType: Filter by type (active, new, vip)
 * - startDate: Filter start date (ISO format)
 * - endDate: Filter end date (ISO format)
 * - sortBy: Sort option (newest, oldest, name-asc, name-desc, spent-desc, spent-asc, orders-desc, orders-asc)
 */
exports.getCustomers = async (req, res) => {
    try {
        // Parse query parameters
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 50), 100);
        const search = req.query.search?.trim() || '';
        const customerType = req.query.customerType || '';
        const startDate = req.query.startDate || '';
        const endDate = req.query.endDate || '';
        const sortBy = req.query.sortBy || 'newest';

        // Validate date formats
        if (startDate && isNaN(new Date(startDate).getTime())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid startDate format. Use ISO date format.'
            });
        }

        if (endDate && isNaN(new Date(endDate).getTime())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid endDate format. Use ISO date format.'
            });
        }

        // Validate customerType
        const validCustomerTypes = ['', 'active', 'new', 'vip'];
        if (!validCustomerTypes.includes(customerType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid customerType. Must be: active, new, or vip.'
            });
        }

        // Validate sortBy
        const validSortOptions = ['newest', 'oldest', 'name-asc', 'name-desc', 'spent-desc', 'spent-asc', 'orders-desc', 'orders-asc'];
        if (!validSortOptions.includes(sortBy)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid sortBy option.'
            });
        }

        // Build filters object
        const filters = {
            search: search || undefined,
            customerType: customerType || undefined,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            sortBy: sortBy
        };

        // Remove undefined values
        Object.keys(filters).forEach(key => {
            if (filters[key] === undefined) {
                delete filters[key];
            }
        });

        // Get customers and stats in parallel
        const [customersResult, stats] = await Promise.all([
            customerService.getCustomers(filters, { page, limit }),
            customerService.getCustomerStats()
        ]);

        res.json({
            success: true,
            data: customersResult.customers,
            pagination: customersResult.pagination,
            stats: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[Customer Controller] Error getting customers:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch customers'
        });
    }
};

/**
 * Get customer statistics
 * GET /api/admin/customers/stats
 */
exports.getCustomerStats = async (req, res) => {
    try {
        const stats = await customerService.getCustomerStats();

        res.json({
            success: true,
            data: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[Customer Controller] Error getting customer stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch customer statistics'
        });
    }
};

/**
 * Get customer details by email
 * GET /api/admin/customers/:email
 */
exports.getCustomerByEmail = async (req, res) => {
    try {
        const email = req.params.email;

        if (!email || email.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Email parameter is required'
            });
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email format'
            });
        }

        const customerData = await customerService.getCustomerByEmail(email);

        if (!customerData) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }

        res.json({
            success: true,
            data: customerData,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[Customer Controller] Error getting customer by email:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch customer details'
        });
    }
};

