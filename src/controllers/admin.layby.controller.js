/**
 * Admin layby plans: list, detail API, status updates, offline installment confirmation.
 * Uses requireAdminAuth for HTML and authenticateAdmin for JSON API (see app.js).
 *
 * Future: gate destructive actions with req.admin.role === 'superadmin' if product requires it.
 */

const { Op } = require('sequelize');
const { LaybyPlan, LaybyPayment, Order, User, Payment, OfflineSale } = require('../models');
const laybyService = require('../services/layby.service');
const { enrichLaybyPlan } = require('../utils/laybyStatusPresenter');
const laybyExportService = require('../services/laybyExport.service');
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
                price: it.price,
                selectedColor: it.selectedColor || null,
                variant: it.variant || null
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
    if (j.offlineSale) {
        const s = j.offlineSale;
        const totals = s.totals && typeof s.totals === 'object' ? s.totals : {};
        const items = Array.isArray(s.items) ? s.items : [];
        j.offlineSale = {
            id: s.id,
            saleNumber: s.saleNumber,
            saleType: s.saleType,
            soldAt: s.soldAt,
            customerName: s.customerName,
            customerEmail: s.customerEmail,
            customerPhone: s.customerPhone,
            totals: {
                subtotal: totals.subtotal,
                total: totals.total
            },
            items: items.map((it) => ({
                name: it.name,
                quantity: it.quantity,
                price: it.unitPrice != null ? it.unitPrice : it.price,
                selectedColor: it.selectedColor || null,
                variant: it.variant || null
            }))
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

/**
 * Builds the shared Sequelize `where` clause for layby plan listing/export from query params.
 */
function buildLaybyPlansWhere(query) {
    const status = query.status;
    // Cap length and escape LIKE metacharacters to prevent wildcard DoS
    const search = (query.search || '').trim().slice(0, 50).replace(/[%_\\]/g, '\\$&');

    const where = {};
    if (status && ['active', 'completed', 'cancelled'].includes(status)) {
        where.status = status;
    }

    if (search) {
        const like = `%${search}%`;
        where[Op.or] = [
            { '$order.orderNumber$': { [Op.like]: like } },
            { '$offlineSale.saleNumber$': { [Op.like]: like } },
            { '$offlineSale.customerName$': { [Op.like]: like } }
        ];
    }

    return where;
}

exports.listPlans = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const offset = (page - 1) * limit;
        const where = buildLaybyPlansWhere(req.query);

        const count = await LaybyPlan.count({
            where,
            include: [
                { model: Order, as: 'order', attributes: [], required: false },
                { model: OfflineSale, as: 'offlineSale', attributes: [], required: false },
                { model: User, as: 'user', attributes: [], required: false }
            ],
            distinct: true,
            col: 'id'
        });

        const rows = await LaybyPlan.findAll({
            where,
            include: [
                {
                    model: Order,
                    as: 'order',
                    attributes: ['id', 'orderNumber', 'status', 'paymentStatus', 'checkoutMode'],
                    required: false
                },
                {
                    model: OfflineSale,
                    as: 'offlineSale',
                    attributes: ['id', 'saleNumber', 'saleType', 'customerName', 'customerEmail', 'soldAt'],
                    required: false
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
                            attributes: ['id', 'status', 'paymentMethod', 'metadata', 'lencoReference', 'transactionId', 'createdAt', 'amount']
                        }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']],
            limit,
            offset,
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

const LAYBY_EXPORT_CONTENT_TYPES = {
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

exports.exportPlans = async (req, res) => {
    try {
        const format = String(req.query.format || '').toLowerCase();
        if (!['pdf', 'xlsx', 'docx'].includes(format)) {
            return res.status(400).json({ success: false, message: 'Invalid format. Must be: pdf, xlsx, or docx.' });
        }

        const where = buildLaybyPlansWhere(req.query);

        const rows = await LaybyPlan.findAll({
            where,
            include: [
                {
                    model: Order,
                    as: 'order',
                    attributes: ['id', 'orderNumber', 'status', 'paymentStatus', 'checkoutMode'],
                    required: false
                },
                {
                    model: OfflineSale,
                    as: 'offlineSale',
                    attributes: ['id', 'saleNumber', 'saleType', 'customerName', 'customerEmail', 'soldAt'],
                    required: false
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
                            attributes: ['id', 'status', 'paymentMethod', 'metadata', 'lencoReference', 'transactionId', 'createdAt', 'amount']
                        }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']],
            limit: laybyExportService.MAX_EXPORT_ROWS,
            subQuery: false
        });

        if (!rows.length) {
            return res.status(400).json({ success: false, message: 'No layby plans to export' });
        }

        const exportRows = laybyExportService.buildExportRows(rows.map((p) => enrichLaybyPlan(p)));
        const exportDate = new Date().toISOString().split('T')[0];

        let buffer;
        if (format === 'pdf') {
            buffer = await laybyExportService.generateLaybyPDF(exportRows);
        } else if (format === 'xlsx') {
            buffer = await laybyExportService.generateLaybyXLSX(exportRows);
        } else {
            buffer = await laybyExportService.generateLaybyDOCX(exportRows);
        }

        if (rows.length === laybyExportService.MAX_EXPORT_ROWS) {
            res.setHeader('X-Export-Truncated', 'true');
        }

        res.setHeader('Content-Type', LAYBY_EXPORT_CONTENT_TYPES[format]);
        res.setHeader('Content-Disposition', `attachment; filename="layby_plans_${exportDate}.${format}"`);
        res.send(buffer);
    } catch (err) {
        logger.error({ err }, 'exportPlans failed');
        const statusCode = err.statusCode || 500;
        const message = err.isOperational ? err.message : 'Failed to export layby plans';
        res.status(statusCode).json({ success: false, message });
    }
};

exports.getPlan = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ success: false, message: 'Invalid plan id' });
        }

        // Both queries share a transaction so the plan snapshot and payment history
        // are read-consistent. Note: `separate: true` sub-queries (laybyPayments)
        // do not inherit the transaction — accepted limitation since LaybyPayment
        // rows are structural and rarely change mid-request.
        const { plan, paymentHistory } = await LaybyPlan.sequelize.transaction(
            { isolationLevel: 'REPEATABLE READ' },
            async (t) => {
                const fetchedPlan = await LaybyPlan.findByPk(id, {
                    transaction: t,
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
                            ],
                            required: false
                        },
                        {
                            model: OfflineSale,
                            as: 'offlineSale',
                            attributes: [
                                'id',
                                'saleNumber',
                                'saleType',
                                'soldAt',
                                'items',
                                'totals',
                                'customerName',
                                'customerEmail',
                                'customerPhone'
                            ],
                            required: false
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

                if (!fetchedPlan) return { plan: null };

                const installmentIds = (fetchedPlan.laybyPayments || []).map((lp) => lp.id).filter(Boolean);
                const history = installmentIds.length
                    ? await Payment.findAll({
                          where: { laybyPaymentId: { [Op.in]: installmentIds } },
                          attributes: [
                              'id', 'amount', 'currency', 'status', 'paymentMethod',
                              'lencoProvider', 'lencoReference', 'transactionId',
                              'completedAt', 'createdAt', 'laybyPaymentId', 'metadata'
                          ],
                          order: [['createdAt', 'DESC']],
                          transaction: t
                      })
                    : [];

                return { plan: fetchedPlan, paymentHistory: history };
            }
        );

        if (!plan) {
            return res.status(404).json({ success: false, message: 'Plan not found' });
        }

        res.json({
            success: true,
            plan: sanitizeLaybyPlanDetailForAdmin(plan),
            paymentHistory: paymentHistory.map((p) => p.toJSON())
        });
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
            const preCheck = await LaybyPlan.findByPk(id, { attributes: ['id', 'status'] });
            if (!preCheck) {
                return res.status(404).json({ success: false, message: 'Plan not found' });
            }
            if (!LAYBY_PLAN_STATUS_TRANSITIONS[preCheck.status]?.includes('cancelled')) {
                return res.status(400).json({ success: false, message: `Cannot transition from ${preCheck.status} to cancelled` });
            }

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
        if (out.error === 'OFFLINE_SALE_NOT_FOUND') {
            return res.status(400).json({ success: false, message: 'Offline sale missing for this plan' });
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
            orderNumber: out.order
                ? out.order.orderNumber
                : out.offlineSale
                  ? out.offlineSale.saleNumber
                  : null
        });
    } catch (err) {
        logger.error({ err }, 'confirmInstallmentOffline failed');
        res.status(500).json({ success: false, message: 'Failed to confirm installment' });
    }
};
