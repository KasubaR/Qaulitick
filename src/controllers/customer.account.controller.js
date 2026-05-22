const { Order, LaybyPlan, LaybyPayment, Payment, User } = require('../models');
const { Op } = require('sequelize');
const userService = require('../services/user.service');
const productService = require('../services/product.service');
const { sanitizeObject, validatePhone, validatePasswordStrength } = require('../utils/validators');
const { deleteAllSessionsForUser } = require('../services/session.service');
const { cookieName: sessionCookieName } = require('../config/session.constants');
const { enrichLaybyPlan } = require('../utils/laybyStatusPresenter');
const logger = require('../utils/logger').child({ module: 'CustomerAccountController' });

/** Max layby plans loaded per account/layby request (includes nested installments). */
const LAYBY_ACCOUNT_PLANS_PER_PAGE = 50;

exports.renderDashboard = async (req, res) => {
    const u = req.customerUser.toJSON();
    try {
        const [ordersCount, activeLaybyPlans, latestOrders, upcomingLaybyPayments] = await Promise.all([
            Order.count({ where: { userId: req.customerUser.id } }),
            LaybyPlan.count({ where: { userId: req.customerUser.id, status: 'active' } }),
            Order.findAll({
                where: { userId: req.customerUser.id },
                order: [['createdAt', 'DESC']],
                limit: 3,
                attributes: ['orderNumber', 'status', 'createdAt']
            }),
            LaybyPayment.findAll({
                include: [{
                    model: LaybyPlan,
                    as: 'laybyPlan',
                    required: true,
                    where: { userId: req.customerUser.id },
                    attributes: ['id']
                }],
                where: { status: { [Op.in]: ['pending', 'overdue'] } },
                order: [['dueAt', 'ASC']],
                limit: 3,
                attributes: ['id', 'sequence', 'status', 'dueAt', 'amount', 'createdAt']
            })
        ]);

        const activity = [
            ...latestOrders.map((o) => ({
                type: 'order',
                title: `Order ${o.orderNumber || '#' + o.id}`,
                subtitle: `Status: ${o.status || 'pending'}`,
                at: o.createdAt
            })),
            ...upcomingLaybyPayments.map((p) => ({
                type: 'layby',
                title: `Layby installment #${p.sequence}`,
                subtitle: p.dueAt
                    ? `Due ${new Date(p.dueAt).toLocaleDateString()}`
                    : `Amount ${Number(p.amount || 0).toFixed(2)} ${p.currency || 'ZMW'}`,
                at: p.dueAt || p.createdAt
            }))
        ].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)).slice(0, 6);

        const profileCompleteness = {
            hasName: !!(u.name && String(u.name).trim()),
            hasPhone: !!(u.phone && String(u.phone).trim()),
            hasAddress: !!(u.deliveryAddress && String(u.deliveryAddress).trim()),
            hasCity: !!(u.city && String(u.city).trim()),
            hasProvince: !!(u.province && String(u.province).trim())
        };
        const completeFields = Object.values(profileCompleteness).filter(Boolean).length;
        const completenessPercent = Math.round((completeFields / Object.keys(profileCompleteness).length) * 100);

        return res.render('account/dashboard', {
            title: 'My account | Qualitick Collections',
            page: 'account',
            accountSection: 'dashboard',
            customer: u,
            emailVerified: !!u.emailVerifiedAt,
            message: typeof req.query.message === 'string' ? req.query.message : null,
            securityMessage: typeof req.query.securityMessage === 'string' ? req.query.securityMessage : null,
            dashboardStats: {
                totalOrders: ordersCount,
                activeLaybyPlans,
                addressCompleted: !!(u.deliveryAddress && u.city && u.province),
                profileCompletionPercent: completenessPercent
            },
            recentActivity: activity,
            csrfToken: res.locals.csrfToken || ''
        });
    } catch (error) {
        logger.error({ err: error }, 'renderDashboard metrics failed');
        return res.render('account/dashboard', {
            title: 'My account | Qualitick Collections',
            page: 'account',
            accountSection: 'dashboard',
            customer: u,
            emailVerified: !!u.emailVerifiedAt,
            message: typeof req.query.message === 'string' ? req.query.message : null,
            securityMessage: typeof req.query.securityMessage === 'string' ? req.query.securityMessage : null,
            dashboardStats: {
                totalOrders: 0,
                activeLaybyPlans: 0,
                addressCompleted: !!(u.deliveryAddress && u.city && u.province),
                profileCompletionPercent: 0
            },
            recentActivity: [],
            csrfToken: res.locals.csrfToken || ''
        });
    }
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
        securityError: null,
        securityMessage: null,
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
            securityError: null,
            securityMessage: null,
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
                securityError: null,
                securityMessage: null,
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
            securityError: null,
            securityMessage: null,
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
            securityError: null,
            securityMessage: null,
            csrfToken: res.locals.csrfToken || ''
        });
    }
};

exports.updatePassword = async (req, res) => {
    const renderWith = (status, securityError, securityMessage) => {
        return res.status(status).render('account/profile', {
            title: 'Profile | Qualitick Collections',
            page: 'account',
            accountSection: 'profile',
            customer: req.customerUser.toJSON(),
            error: null,
            message: null,
            securityError,
            securityMessage,
            csrfToken: res.locals.csrfToken || ''
        });
    };

    try {
        const body = sanitizeObject(req.body);
        const currentPassword = body.currentPassword ? String(body.currentPassword) : '';
        const newPassword = body.newPassword ? String(body.newPassword) : '';
        const confirmPassword = body.confirmPassword ? String(body.confirmPassword) : '';

        if (!currentPassword || !newPassword || !confirmPassword) {
            return renderWith(400, 'Fill in all password fields.', null);
        }
        if (!validatePasswordStrength(newPassword)) {
            return renderWith(400, 'New password must be at least 8 characters and include at least one letter and one number.', null);
        }
        if (newPassword !== confirmPassword) {
            return renderWith(400, 'New password and confirmation do not match.', null);
        }

        const loginUser = await User.scope('withPasswordHash').findByPk(req.customerUser.id);
        if (!loginUser) {
            return renderWith(404, 'Account not found.', null);
        }
        const isCurrentValid = await loginUser.comparePassword(currentPassword);
        if (!isCurrentValid) {
            return renderWith(400, 'Current password is incorrect.', null);
        }
        if (await loginUser.comparePassword(newPassword)) {
            return renderWith(400, 'Choose a new password that is different from your current password.', null);
        }

        const passwordHash = await User.hashPassword(newPassword);
        await loginUser.update({ passwordHash });

        return renderWith(200, null, 'Password updated successfully.');
    } catch (error) {
        logger.error({ err: error }, 'updatePassword failed');
        return renderWith(500, 'Could not update password. Try again later.', null);
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
            where: { userId: user.id, status: { [Op.in]: ['paid', 'confirmed', 'packed', 'shipped', 'delivered', 'payment_pending'] } },
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
            const products = await productService.getProductsByIds(productIds, { attributes: ['id', 'reviews'] });
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
    const userId = req.customerUser.id;
    const laybyPlansPerPage = LAYBY_ACCOUNT_PLANS_PER_PAGE;
    try {
        const plansTotal = await LaybyPlan.count({ where: { userId } });
        const totalPages = Math.max(1, Math.ceil(plansTotal / laybyPlansPerPage));
        let laybyPlansPage = Math.max(1, parseInt(req.query.page, 10) || 1);
        if (laybyPlansPage > totalPages) {
            laybyPlansPage = totalPages;
        }
        const offset = (laybyPlansPage - 1) * laybyPlansPerPage;

        const plans = await LaybyPlan.findAll({
            where: { userId },
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
                            attributes: ['id', 'status', 'paymentMethod', 'metadata', 'lencoReference', 'transactionId', 'createdAt', 'amount']
                        }
                    ]
                },
                { model: Order, as: 'order', attributes: ['id', 'orderNumber', 'status', 'paymentStatus', 'createdAt'] }
            ],
            order: [['createdAt', 'DESC']],
            limit: laybyPlansPerPage,
            offset
        });
        const cu = req.customerUser.toJSON();
        res.render('account/layby', {
            title: 'Layby plans | Qualitick Collections',
            page: 'account',
            accountSection: 'layby',
            plans: plans.map((p) => enrichLaybyPlan(p)),
            laybyPlansPage,
            laybyPlansTotal: plansTotal,
            laybyPlansPerPage,
            laybyPlansTotalPages: totalPages,
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
            laybyPlansPage: 1,
            laybyPlansTotal: 0,
            laybyPlansPerPage: LAYBY_ACCOUNT_PLANS_PER_PAGE,
            laybyPlansTotalPages: 1,
            csrfToken: res.locals.csrfToken || '',
            payCustomerInfo: { name: '', email: '', phone: '' },
            error: 'Could not load layby plans.'
        });
    }
};

exports.logoutAllDevices = async (req, res) => {
    try {
        const userId = req.session.userId;
        // Delete every session for this user (including the current one)
        await deleteAllSessionsForUser(userId);
        res.clearCookie(sessionCookieName, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            path: '/'
        });
        return res.redirect('/login?message=' + encodeURIComponent(
            'You have been signed out of all devices.'
        ));
    } catch (err) {
        logger.error({ err }, 'logoutAllDevices failed');
        return res.redirect('/account?message=' + encodeURIComponent('Could not sign out all devices. Try again.'));
    }
};

/**
 * Returns next pending installment metadata for POST /api/payments/process (layby).
 *
 * Ownership: plan is loaded with { id, userId: req.customerUser.id }; nextPayment is
 * scoped to plan.id, so the installment belongs to the customer’s plan.
 *
 * Concurrency: two parallel requests for the same plan can both receive the same
 * laybyPaymentId. Duplicate initiation is mitigated in payment.controller processPayment
 * (e.g. existing pending payment for orderNumber); that path is not a full DB-serialized
 * guard and can race (TOCTOU). No extra lock here by design — document if hardening.
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
            where: { laybyPlanId: plan.id, status: ['pending', 'overdue'] },
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
