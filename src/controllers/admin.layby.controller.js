/**
 * Admin layby plans: list, detail API, status updates, offline installment confirmation.
 * Uses requireAdminAuth for HTML and authenticateAdmin for JSON API (see app.js).
 *
 * Future: gate destructive actions with req.admin.role === 'superadmin' if product requires it.
 */

const { Op } = require('sequelize');
const { LaybyPlan, LaybyPayment, Order, User, Payment } = require('../models');
const laybyService = require('../services/layby.service');
const { enrichLaybyPlan } = require('../utils/laybyStatusPresenter');
const logger = require('../utils/logger').child({ module: 'AdminLaybyController' });

/** Allowed admin PATCH status transitions (LaybyPlan.status). */
const LAYBY_PLAN_STATUS_TRANSITIONS = {
    active: ['completed', 'cancelled'],
    cancelled: [],
    completed: []
};

/**
 * Admin layby detail API: only fields rendered in views/admin/layby-detail + layby-detail.js.
 * Omits order.customer (PII), full line-item internals, and extra user columns.
 */
function sanitizeLaybyPlanDetailForAdmin(plan) {
    const j = plan.toJSON();
    if (j.order) {
        const o = j.order;
        const totals = o.totals && typeof o.totals === 'object' ? o.totals : {};
        const items = Array.isArray(o.items) ? o.items : [];
        j.order = {
            id: o.id,
            orderNumber: o.orderNumber,
            status: o.status,
            paymentStatus: o.paymentStatus,
            checkoutMode: o.checkoutMode,
            createdAt: o.createdAt,
            totals: {
                subtotal: totals.subtotal,
                discount: totals.discount,
                delivery: totals.delivery,
                total: totals.total
            },
            items: items.map((it) => ({
                name: it.name,
                quantity: it.quantity,
                price: it.price
            }))
        };
    }
    if (j.user) {
        j.user = {
            id: j.user.id,
            name: j.user.name,
            email: j.user.email
        };
    }
    return enrichLaybyPlan(j);
}

exports.renderLaybyListPage = (req, res) => {
    res.render('admin/layby', {
        title: 'Layby plans | Admin Panel',
        page: 'admin',
        activePage: 'layby',
        csrfToken: res.locals.csrfToken || ''
    });
};

exports.renderLaybyDetailPage = (req, res) => {
    const planId = parseInt(req.params.planId, 10);
    if (Number.isNaN(planId)) {
        return res.redirect('/admin/layby');
    }
    res.render('admin/layby-detail', {
        title: 'Layby plan detail | Admin Panel',
        page: 'admin',
        activePage: 'layby',
        planId,
        csrfToken: res.locals.csrfToken || ''
    });
};

exports.listPlans = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const offset = (page - 1) * limit;
        const status = req.query.status;
        // Cap length and escape LIKE metacharacters to prevent wildcard DoS
        const search = (req.query.search || '').trim().slice(0, 50).replace(/[%_\\]/g, '\\$&');

        const where = {};
        if (status && ['active', 'completed', 'cancelled'].includes(status)) {
            where.status = status;
        }

        const orderInclude = {
            model: Order,
            as: 'order',
            attributes: ['id', 'orderNumber', 'status', 'paymentStatus', 'checkoutMode'],
            required: true
        };
        if (search) {
            orderInclude.where = { orderNumber: { [Op.like]: `%${search}%` } };
        }

        const { count, rows } = await LaybyPlan.findAndCountAll({
            where,
            include: [
                orderInclude,
                { model: User, as: 'user', attributes: ['id', 'email', 'name'], required: false },
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
                }
            ],
            order: [['createdAt', 'DESC']],
            limit,
            offset,
            distinct: true,
            subQuery: false
        });

        res.json({
            success: true,
            plans: rows.map((p) => enrichLaybyPlan(p)),
            total: count,
            page,
            limit,
            totalPages: Math.max(1, Math.ceil(count / limit))
        });
    } catch (err) {
        logger.error({ err }, 'listPlans failed');
        res.status(500).json({ success: false, message: 'Failed to load layby plans' });
    }
};

exports.getPlan = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ success: false, message: 'Invalid plan id' });
        }

        const plan = await LaybyPlan.findByPk(id, {
            include: [
                {
                    model: Order,
                    as: 'order',
                    attributes: [
                        'id',
                        'orderNumber',
                        'status',
                        'paymentStatus',
                        'checkoutMode',
                        'items',
                        'totals',
                        'createdAt'
                    ]
                },
                { model: User, as: 'user', attributes: ['id', 'email', 'name'], required: false },
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
                            attributes: ['id', 'status', 'paymentMethod', 'metadata', 'lencoReference', 'transactionId', 'createdAt', 'amount', 'completedAt']
                        }
                    ]
                }
            ]
        });

        if (!plan) {
            return res.status(404).json({ success: false, message: 'Plan not found' });
        }

        res.json({ success: true, plan: sanitizeLaybyPlanDetailForAdmin(plan) });
    } catch (err) {
        logger.error({ err }, 'getPlan failed');
        res.status(500).json({ success: false, message: 'Failed to load plan' });
    }
};

exports.updatePlanStatus = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ success: false, message: 'Invalid plan id' });
        }

        const { status } = req.body || {};
        if (!['active', 'completed', 'cancelled'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        if (status === 'cancelled') {
            const actor = req.admin?.email || (req.admin?.id ? `admin:${req.admin.id}` : 'admin');
            const cancelled = await laybyService.cancelLaybyPlan(id, {
                actor,
                source: 'layby_admin_cancel',
                reason: `Layby plan cancelled by ${actor}`
            });
            if (cancelled.error === 'NOT_FOUND') {
                return res.status(404).json({ success: false, message: 'Plan not found' });
            }
            if (cancelled.error === 'PLAN_COMPLETED') {
                return res.status(400).json({ success: false, message: 'Completed plans cannot be cancelled' });
            }
            if (cancelled.error) {
                return res.status(400).json({ success: false, message: 'Could not cancel layby plan' });
            }
            return res.json({ success: true, plan: cancelled.plan.toJSON() });
        }

        const result = await LaybyPlan.sequelize.transaction(async (t) => {
            const plan = await LaybyPlan.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
            if (!plan) {
                return { http: 404, message: 'Plan not found' };
            }

            const cur = plan.status;

            if (!LAYBY_PLAN_STATUS_TRANSITIONS[cur]?.includes(status)) {
                return { http: 400, message: `Cannot transition from ${cur} to ${status}` };
            }

            if (status === 'completed') {
                if (parseFloat(plan.balanceRemaining) > 0.001) {
                    return { http: 400, message: 'Cannot mark completed while balance remains' };
                }
            }

            await plan.update({ status }, { transaction: t });
            return { plan };
        });

        if (result.http) {
            return res.status(result.http).json({ success: false, message: result.message });
        }

        res.json({ success: true, plan: result.plan.toJSON() });
    } catch (err) {
        logger.error({ err }, 'updatePlanStatus failed');
        res.status(500).json({ success: false, message: 'Failed to update plan status' });
    }
};

exports.confirmInstallmentOffline = async (req, res) => {
    try {
        const installmentId = parseInt(req.params.installmentId, 10);
        if (Number.isNaN(installmentId)) {
            return res.status(400).json({ success: false, message: 'Invalid installment id' });
        }

        if (!req.admin) {
            return res.status(401).json({ success: false, message: 'Admin not authenticated' });
        }
        const adminId = req.admin.id ?? req.admin._id;
        const out = await laybyService.confirmInstallmentOffline(installmentId, {
            adminId,
            adminEmail: req.admin.email
        });

        if (out.error === 'NOT_FOUND') {
            return res.status(404).json({ success: false, message: 'Installment not found' });
        }
        if (out.error === 'INVALID_ID') {
            return res.status(400).json({ success: false, message: 'Invalid installment id' });
        }
        if (out.error === 'NOT_PENDING') {
            return res.status(400).json({ success: false, message: 'Only pending or overdue installments can be confirmed' });
        }
        if (out.error === 'PLAN_NOT_ACTIVE') {
            return res.status(400).json({ success: false, message: 'Plan must be active to confirm payments' });
        }
        if (out.error === 'ORDER_NOT_FOUND') {
            return res.status(400).json({ success: false, message: 'Order missing for this plan' });
        }
        if (out.error === 'TRANSACTION_FAILED') {
            return res.status(500).json({ success: false, message: 'Could not confirm installment' });
        }

        if (out.alreadyApplied) {
            return res.json({ success: true, alreadyApplied: true, message: 'Installment was already marked paid' });
        }

        res.json({
            success: true,
            fullyPaid: out.fullyPaid,
            plan: out.plan ? out.plan.toJSON() : null,
            orderNumber: out.order ? out.order.orderNumber : null
        });
    } catch (err) {
        logger.error({ err }, 'confirmInstallmentOffline failed');
        res.status(500).json({ success: false, message: 'Failed to confirm installment' });
    }
};
