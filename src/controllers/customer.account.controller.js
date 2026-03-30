const { Order, LaybyPlan, LaybyPayment, Payment } = require('../models');
const userService = require('../services/user.service');
const productService = require('../services/product.service');
const { sanitizeObject, validatePhone } = require('../utils/validators');
const logger = require('../utils/logger').child({ module: 'CustomerAccountController' });

exports.renderDashboard = (req, res) => {
    const u = req.customerUser.toJSON();
    res.render('account/dashboard', {
        title: 'My account | Qualitick Collections',
        page: 'account',
        accountSection: 'dashboard',
        customer: u,
        emailVerified: !!u.emailVerifiedAt,
        message: typeof req.query.message === 'string' ? req.query.message : null
    });
};

exports.renderProfile = (req, res) => {
    const u = req.customerUser.toJSON();
    res.render('account/profile', {
        title: 'Profile | Qualitick Collections',
        page: 'account',
        accountSection: 'profile',
        customer: u,
        error: null,
        message: null,
        csrfToken: res.locals.csrfToken || ''
    });
};

exports.updateProfile = async (req, res) => {
    try {
        const body = sanitizeObject(req.body);
        const nameOk = body.name && typeof body.name === 'string' && body.name.trim().length >= 2;
        if (!nameOk) {
            return res.status(400).render('account/profile', {
                title: 'Profile | Qualitick Collections',
                page: 'account',
                accountSection: 'profile',
                customer: req.customerUser.toJSON(),
                error: 'Name must be at least 2 characters.',
                message: null,
                csrfToken: res.locals.csrfToken || ''
            });
        }
        if (body.phone && typeof body.phone === 'string' && body.phone.trim() && !validatePhone(body.phone)) {
            return res.status(400).render('account/profile', {
                title: 'Profile | Qualitick Collections',
                page: 'account',
                accountSection: 'profile',
                customer: req.customerUser.toJSON(),
                error: 'Please enter a valid Zambian phone number.',
                message: null,
                csrfToken: res.locals.csrfToken || ''
            });
        }

        await userService.updateProfile(req.customerUser.id, {
            name: body.name,
            phone: body.phone
        });
        const refreshed = await userService.findById(req.customerUser.id);
        req.customerUser = refreshed;

        res.render('account/profile', {
            title: 'Profile | Qualitick Collections',
            page: 'account',
            accountSection: 'profile',
            customer: refreshed.toJSON(),
            error: null,
            message: 'Profile updated.',
            csrfToken: res.locals.csrfToken || ''
        });
    } catch (error) {
        logger.error({ err: error }, 'updateProfile failed');
        res.status(500).render('account/profile', {
            title: 'Profile | Qualitick Collections',
            page: 'account',
            accountSection: 'profile',
            customer: req.customerUser.toJSON(),
            error: 'Could not update profile. Try again later.',
            message: null,
            csrfToken: res.locals.csrfToken || ''
        });
    }
};

exports.renderAddress = (req, res) => {
    const u = req.customerUser.toJSON();
    res.render('account/address', {
        title: 'Saved address | Qualitick Collections',
        page: 'account',
        accountSection: 'address',
        customer: u,
        error: null,
        message: null,
        csrfToken: res.locals.csrfToken || ''
    });
};

const VALID_PROVINCES = [
    'Central', 'Copperbelt', 'Eastern', 'Luapula',
    'Lusaka', 'Muchinga', 'Northern', 'North-Western', 'Southern', 'Western'
];

exports.updateAddress = async (req, res) => {
    const renderWith = (status, error, message) => {
        return res.status(status).render('account/address', {
            title: 'Saved address | Qualitick Collections',
            page: 'account',
            accountSection: 'address',
            customer: req.customerUser.toJSON(),
            error,
            message,
            csrfToken: res.locals.csrfToken || ''
        });
    };

    try {
        const body = sanitizeObject(req.body);
        const deliveryAddress = body.deliveryAddress ? String(body.deliveryAddress).trim() : '';
        const city = body.city ? String(body.city).trim() : '';
        const province = body.province ? String(body.province).trim() : '';

        if (deliveryAddress && deliveryAddress.length > 255) {
            return renderWith(400, 'Delivery address is too long.', null);
        }
        if (city && city.length > 100) {
            return renderWith(400, 'City name is too long.', null);
        }
        if (province && !VALID_PROVINCES.includes(province)) {
            return renderWith(400, 'Please select a valid province.', null);
        }

        await userService.updateAddress(req.customerUser.id, { deliveryAddress, city, province });
        const refreshed = await userService.findById(req.customerUser.id);
        req.customerUser = refreshed;

        return res.render('account/address', {
            title: 'Saved address | Qualitick Collections',
            page: 'account',
            accountSection: 'address',
            customer: refreshed.toJSON(),
            error: null,
            message: 'Address saved.',
            csrfToken: res.locals.csrfToken || ''
        });
    } catch (error) {
        logger.error({ err: error }, 'updateAddress failed');
        return renderWith(500, 'Could not save address. Try again later.', null);
    }
};

exports.renderOrders = async (req, res) => {
    try {
        const user = req.customerUser;
        const orders = await Order.findAll({
            where: { userId: user.id, status: 'paid' },
            order: [['createdAt', 'DESC']],
            limit: 100
        });

        const ordersJson = orders.map((o) => o.toJSON());

        // Collect unique product IDs across all order items
        const productIds = [...new Set(
            ordersJson.flatMap(o => (Array.isArray(o.items) ? o.items : []).map(i => i.productId).filter(Boolean))
        )];

        // Build a map of productId → the user's review (matched by email or userId)
        const reviewedMap = {};
        if (productIds.length > 0) {
            const products = await productService.getProductsByIds(productIds);
            for (const p of products) {
                const pObj = typeof p.toJSON === 'function' ? p.toJSON() : p;
                const reviews = Array.isArray(pObj.reviews) ? pObj.reviews : [];
                const userReview = reviews.find(r =>
                    (r.userId && String(r.userId) === String(user.id)) ||
                    (r.email && r.email.toLowerCase() === user.email.toLowerCase())
                );
                if (userReview) reviewedMap[String(pObj.id)] = userReview;
            }
        }

        res.render('account/orders', {
            title: 'Order history | Qualitick Collections',
            page: 'account',
            accountSection: 'orders',
            orders: ordersJson,
            reviewedMap
        });
    } catch (error) {
        logger.error({ err: error }, 'renderOrders failed');
        res.status(500).render('account/orders', {
            title: 'Order history | Qualitick Collections',
            page: 'account',
            accountSection: 'orders',
            orders: [],
            reviewedMap: {},
            error: 'Could not load orders.'
        });
    }
};

exports.renderLayby = async (req, res) => {
    try {
        const plans = await LaybyPlan.findAll({
            where: { userId: req.customerUser.id },
            include: [
                {
                    model: LaybyPayment,
                    as: 'laybyPayments',
                    separate: true,
                    order: [['sequence', 'ASC']],
                    include: [
                        {
                            model: Payment,
                            as: 'payment',
                            required: false,
                            attributes: ['id', 'status', 'lencoReference', 'transactionId', 'createdAt']
                        }
                    ]
                },
                { model: Order, as: 'order', attributes: ['id', 'orderNumber', 'status', 'paymentStatus', 'createdAt'] }
            ],
            order: [['createdAt', 'DESC']]
        });
        const cu = req.customerUser.toJSON();
        res.render('account/layby', {
            title: 'Layby plans | Qualitick Collections',
            page: 'account',
            accountSection: 'layby',
            plans: plans.map((p) => p.toJSON()),
            csrfToken: res.locals.csrfToken || '',
            payCustomerInfo: {
                name: cu.name || '',
                email: cu.email || '',
                phone: cu.phone || ''
            }
        });
    } catch (error) {
        logger.error({ err: error }, 'renderLayby failed');
        res.status(500).render('account/layby', {
            title: 'Layby plans | Qualitick Collections',
            page: 'account',
            accountSection: 'layby',
            plans: [],
            csrfToken: res.locals.csrfToken || '',
            payCustomerInfo: { name: '', email: '', phone: '' },
            error: 'Could not load layby plans.'
        });
    }
};

/**
 * Returns next pending installment metadata for future payment integration (Lenco).
 */
exports.startLaybyPayment = async (req, res) => {
    try {
        const planId = parseInt(req.params.id, 10);
        if (Number.isNaN(planId)) {
            return res.status(400).json({ success: false, message: 'Invalid plan id' });
        }

        const plan = await LaybyPlan.findOne({
            where: { id: planId, userId: req.customerUser.id },
            include: [{ model: Order, as: 'order', attributes: ['orderNumber'] }]
        });

        if (!plan) {
            return res.status(404).json({ success: false, message: 'Layby plan not found' });
        }
        if (plan.status !== 'active') {
            return res.status(400).json({ success: false, message: 'This layby plan is not active' });
        }

        const nextPayment = await LaybyPayment.findOne({
            where: { laybyPlanId: plan.id, status: 'pending' },
            order: [['sequence', 'ASC']]
        });

        if (!nextPayment) {
            return res.status(400).json({ success: false, message: 'No pending payment for this plan' });
        }

        const orderRow = plan.order;
        let sched = plan.installmentSchedule;
        if (typeof sched === 'string') {
            try {
                sched = JSON.parse(sched);
            } catch {
                sched = null;
            }
        }
        const flexible =
            sched &&
            typeof sched === 'object' &&
            sched.policy === 'flexible_within_period' &&
            nextPayment.sequence >= 2;

        return res.json({
            success: true,
            laybyPaymentId: nextPayment.id,
            orderNumber: orderRow ? orderRow.orderNumber : null,
            amount: Number(nextPayment.amount),
            balanceRemaining: Number(plan.balanceRemaining),
            currency: plan.currency,
            allowPartialPay: !!flexible
        });
    } catch (error) {
        logger.error({ err: error }, 'startLaybyPayment failed');
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};
