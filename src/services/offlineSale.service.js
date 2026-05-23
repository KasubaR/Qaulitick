/**
 * Offline / in-store sales: transactional stock decrement + OfflineSale row.
 * Mirrors standard checkout + payment completion stock rules (order.controller + order.service).
 */

const crypto = require('crypto');
const { Op } = require('sequelize');
const { sequelize } = require('../config/mysql');
const OfflineSale = require('../models/OfflineSale.model');
const Product = require('../models/Product.model');
const Admin = require('../models/Admin.model');
const User = require('../models/User.model');
const LaybyPlan = require('../models/LaybyPlan.model');
const LaybyPayment = require('../models/LaybyPayment.model');
const laybyService = require('./layby.service');
const { PLAN_PERIOD_DAYS } = require('../config/layby');
const { getSellableUnitsForLine } = require('../utils/stock.utils');
const { getSellingUnitPrice } = require('../utils/price.utils');
const logger = require('../utils/logger').child({ module: 'offlineSale.service' });
const { roundMoney2 } = require('../utils/money');

function formatOfflineSaleNumber(saleId, soldAt) {
    const d = new Date(soldAt);
    const datePart =
        String(d.getDate()).padStart(2, '0') +
        String(d.getMonth() + 1).padStart(2, '0') +
        d.getFullYear();
    return `OFF-${datePart}-${String(saleId).padStart(6, '0')}`;
}

/**
 * @param {Array} itemsIn
 * @param {import('sequelize').Transaction} t
 */
async function validateAndNormalizeOfflineItems(itemsIn, t) {
    const normalizedLines = [];
    const productMap = new Map();

    for (const raw of itemsIn) {
        const productId = parseInt(String(raw.productId ?? raw.id), 10);
        if (Number.isNaN(productId) || productId < 1) {
            const err = new Error('Each item must have a valid productId');
            err.statusCode = 400;
            throw err;
        }

        const quantity = Math.max(1, parseInt(String(raw.quantity), 10) || 1);
        const selectedColor =
            raw.selectedColor != null && String(raw.selectedColor).trim() !== ''
                ? String(raw.selectedColor).trim()
                : null;

        const product = await Product.findByPk(productId, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!product) {
            const err = new Error(`Product ${productId} not found`);
            err.statusCode = 404;
            throw err;
        }
        productMap.set(productId, product);

        const productObj = product.toJSON();
        const sellable = getSellableUnitsForLine(productObj, selectedColor);
        if (sellable < quantity) {
            const err = new Error(
                `Insufficient stock for "${productObj.model || productObj.sku}". Available: ${sellable}, requested: ${quantity}`
            );
            err.statusCode = 409;
            throw err;
        }

        const serverUnit = getSellingUnitPrice(productObj);
        let unitPrice =
            raw.unitPrice != null && raw.unitPrice !== '' ? roundMoney2(raw.unitPrice) : serverUnit;
        if (unitPrice <= 0) {
            unitPrice = serverUnit;
        }

        const priceFloor = roundMoney2(serverUnit * 0.5);
        if (unitPrice < priceFloor) {
            logger.warn(
                {
                    productId,
                    serverUnit,
                    suppliedPrice: unitPrice,
                    floor: priceFloor
                },
                'Offline sale unit price is more than 50% below server price — clamping to floor'
            );
            unitPrice = priceFloor;
        } else if (unitPrice !== serverUnit) {
            logger.warn(
                { productId, serverUnit, suppliedPrice: unitPrice },
                'Offline sale unit price overridden by admin'
            );
        }

        const name = raw.name || productObj.model || `Product #${productId}`;
        const lineTotal = roundMoney2(unitPrice * quantity);

        normalizedLines.push({
            productId,
            name,
            quantity,
            unitPrice,
            lineTotal,
            selectedColor
        });
    }

    return { lines: normalizedLines, productMap };
}

/**
 * @param {Array} normalizedLines
 * @param {Map<number, object>} productMap - locked product instances from validateAndNormalizeOfflineItems
 * @param {import('sequelize').Transaction} t
 */
async function decrementStockForOfflineLines(normalizedLines, productMap, t) {
    for (const line of normalizedLines) {
        const { productId, quantity, selectedColor } = line;

        if (selectedColor) {
            const fresh = productMap.get(productId);
            const colorEntry = (fresh.colors || []).find((c) => c.name === selectedColor);
            const colorStock = colorEntry ? Number(colorEntry.stock) || 0 : 0;
            if (colorStock < quantity) {
                const err = new Error(
                    `Insufficient stock for color "${selectedColor}". Available: ${colorStock}, requested: ${quantity}`
                );
                err.statusCode = 409;
                throw err;
            }

            const updatedColors = (fresh.colors || []).map((c) =>
                c.name === selectedColor
                    ? { ...c, stock: Math.max(0, (c.stock || 0) - quantity) }
                    : c
            );
            await fresh.update({ colors: updatedColors }, { transaction: t });

            const [rows] = await Product.update(
                { stock: sequelize.literal(`stock - ${quantity}`) },
                {
                    where: {
                        id: productId,
                        stock: { [Op.gte]: quantity }
                    },
                    transaction: t
                }
            );
            if (rows === 0) {
                const err = new Error(`Insufficient top-level stock for product ${productId}`);
                err.statusCode = 409;
                throw err;
            }
        } else {
            const [rows] = await Product.update(
                { stock: sequelize.literal(`stock - ${quantity}`) },
                {
                    where: {
                        id: productId,
                        stock: { [Op.gte]: quantity }
                    },
                    transaction: t
                }
            );
            if (rows === 0) {
                const err = new Error(`Insufficient stock for product ${productId}`);
                err.statusCode = 409;
                throw err;
            }
        }
    }
}

function mapLinesToSaleItems(normalizedLines) {
    return normalizedLines.map((line) => ({
        productId: line.productId,
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
        ...(line.selectedColor ? { selectedColor: line.selectedColor } : {})
    }));
}

/**
 * @param {object} payload
 * @param {Array<{ productId: number|string, quantity?: number, unitPrice?: number, lineTotal?: number, selectedColor?: string|null, name?: string }>} payload.items
 * @param {{ subtotal?: number, total?: number }} [payload.totals]
 * @param {string|Date} [payload.soldAt]
 * @param {string} [payload.customerName]
 * @param {string} [payload.customerEmail]
 * @param {string} [payload.customerPhone]
 * @param {string} [payload.notes]
 * @param {object} admin - req.admin: { id, email, name? }
 */
async function createOfflineSale(payload, admin) {
    const itemsIn = Array.isArray(payload?.items) ? payload.items : [];
    if (itemsIn.length === 0) {
        const err = new Error('At least one line item is required');
        err.statusCode = 400;
        throw err;
    }

    const soldAt = payload.soldAt ? new Date(payload.soldAt) : new Date();
    if (Number.isNaN(soldAt.getTime())) {
        const err = new Error('Invalid soldAt date');
        err.statusCode = 400;
        throw err;
    }

    const adminId = admin && admin.id != null ? parseInt(String(admin.id), 10) : null;
    const adminEmail = admin && admin.email ? String(admin.email).trim() : null;

    return sequelize.transaction(async (t) => {
        const { lines: normalizedLines, productMap } = await validateAndNormalizeOfflineItems(itemsIn, t);

        const subtotal = roundMoney2(
            normalizedLines.reduce((sum, line) => sum + line.lineTotal, 0)
        );
        let total = subtotal;
        if (payload.totals && payload.totals.total != null) {
            total = roundMoney2(payload.totals.total);
        }
        if (Math.abs(total - subtotal) > 0.02) {
            const err = new Error('totals.total must match sum of line items');
            err.statusCode = 400;
            throw err;
        }

        await decrementStockForOfflineLines(normalizedLines, productMap, t);

        const tempSaleNumber = `TMP-OFF-${crypto.randomUUID()}`;

        const sale = await OfflineSale.create(
            {
                saleNumber: tempSaleNumber,
                soldAt,
                items: mapLinesToSaleItems(normalizedLines),
                totals: { subtotal, total },
                customerName: payload.customerName?.trim() || null,
                customerEmail: payload.customerEmail?.trim() || null,
                customerPhone: payload.customerPhone?.trim() || null,
                notes: payload.notes?.trim() || null,
                createdByAdminId: Number.isNaN(adminId) ? null : adminId,
                createdByAdminEmail: adminEmail
            },
            { transaction: t }
        );

        const saleNumber = formatOfflineSaleNumber(sale.id, soldAt);

        await sale.update({ saleNumber }, { transaction: t });

        logger.info(
            { saleId: sale.id, saleNumber, lineCount: normalizedLines.length, adminId },
            'Offline sale recorded'
        );

        return OfflineSale.findByPk(sale.id, {
            transaction: t,
            include: [{ model: Admin, as: 'createdByAdmin', required: false, attributes: ['id', 'email', 'name'] }]
        });
    });
}

/**
 * Walk-in layby: stock decremented at POS, deposit confirmed immediately, balance tracked via layby admin UI.
 * @param {object} payload — same as createOfflineSale plus depositPercent, optional planPeriodDays
 * @param {object} admin
 */
async function createOfflineLaybySale(payload, admin) {
    const itemsIn = Array.isArray(payload?.items) ? payload.items : [];
    if (itemsIn.length === 0) {
        const err = new Error('At least one line item is required');
        err.statusCode = 400;
        throw err;
    }

    if (payload.depositPercent == null || payload.depositPercent === '') {
        const err = new Error('depositPercent is required for layby sales');
        err.statusCode = 400;
        throw err;
    }

    if (payload.userId == null || payload.userId === '') {
        const err = new Error('A registered customer account is required for layby sales');
        err.statusCode = 400;
        throw err;
    }
    const userId = parseInt(String(payload.userId), 10);
    if (Number.isNaN(userId) || userId < 1) {
        const err = new Error('Invalid customer account');
        err.statusCode = 400;
        throw err;
    }

    const soldAt = payload.soldAt ? new Date(payload.soldAt) : new Date();
    if (Number.isNaN(soldAt.getTime())) {
        const err = new Error('Invalid soldAt date');
        err.statusCode = 400;
        throw err;
    }

    const planPeriodDaysRaw = payload.planPeriodDays;
    const planPeriodDays =
        planPeriodDaysRaw != null && planPeriodDaysRaw !== ''
            ? Math.max(1, parseInt(String(planPeriodDaysRaw), 10) || PLAN_PERIOD_DAYS)
            : PLAN_PERIOD_DAYS;

    const adminId = admin && admin.id != null ? parseInt(String(admin.id), 10) : null;
    const adminEmail = admin && admin.email ? String(admin.email).trim() : null;
    const adminCtx = {
        adminId: Number.isNaN(adminId) ? null : adminId,
        adminEmail: adminEmail || null
    };

    return sequelize.transaction(async (t) => {
        const user = await User.findByPk(userId, { transaction: t, attributes: ['id', 'name', 'email', 'phone'] });
        if (!user) {
            const err = new Error('Customer account not found');
            err.statusCode = 404;
            throw err;
        }

        const { lines: normalizedLines, productMap } = await validateAndNormalizeOfflineItems(itemsIn, t);

        const subtotal = roundMoney2(
            normalizedLines.reduce((sum, line) => sum + line.lineTotal, 0)
        );
        let total = subtotal;
        if (payload.totals && payload.totals.total != null) {
            total = roundMoney2(payload.totals.total);
        }
        if (Math.abs(total - subtotal) > 0.02) {
            const err = new Error('totals.total must match sum of line items');
            err.statusCode = 400;
            throw err;
        }

        await decrementStockForOfflineLines(normalizedLines, productMap, t);

        const tempSaleNumber = `TMP-OFF-${crypto.randomUUID()}`;

        const sale = await OfflineSale.create(
            {
                saleNumber: tempSaleNumber,
                saleType: 'layby',
                soldAt,
                items: mapLinesToSaleItems(normalizedLines),
                totals: { subtotal, total },
                customerName: payload.customerName?.trim() || user.name || null,
                customerEmail: payload.customerEmail?.trim() || user.email || null,
                customerPhone: payload.customerPhone?.trim() || user.phone || null,
                notes: payload.notes?.trim() || null,
                createdByAdminId: Number.isNaN(adminId) ? null : adminId,
                createdByAdminEmail: adminEmail
            },
            { transaction: t }
        );

        const saleNumber = formatOfflineSaleNumber(sale.id, soldAt);
        await sale.update({ saleNumber }, { transaction: t });

        const { plan, depositInstallment } = await laybyService.createFlexibleLaybyPlanAndPayments({
            offlineSaleId: sale.id,
            userId,
            orderTotal: total,
            depositPercentInput: payload.depositPercent,
            planPeriodDays,
            transaction: t
        });

        if (!depositInstallment) {
            const err = new Error('Failed to create layby deposit installment');
            err.statusCode = 500;
            throw err;
        }

        const confirmResult = await laybyService.confirmInstallmentOfflineInTransaction(
            t,
            depositInstallment.id,
            adminCtx
        );

        if (confirmResult.error) {
            const err = new Error(
                confirmResult.error === 'OFFLINE_SALE_NOT_FOUND'
                    ? 'Offline sale missing during deposit confirmation'
                    : 'Failed to confirm layby deposit at point of sale'
            );
            err.statusCode = 500;
            err.laybyError = confirmResult.error;
            throw err;
        }

        logger.info(
            {
                saleId: sale.id,
                saleNumber,
                planId: plan.id,
                depositPercent: plan.depositPercent,
                adminId: adminCtx.adminId
            },
            'Offline layby sale recorded'
        );

        return OfflineSale.findByPk(sale.id, {
            transaction: t,
            include: [
                { model: Admin, as: 'createdByAdmin', required: false, attributes: ['id', 'email', 'name'] },
                {
                    model: LaybyPlan,
                    as: 'laybyPlan',
                    include: [{ model: LaybyPayment, as: 'laybyPayments' }]
                }
            ]
        });
    });
}

/**
 * @param {object} opts
 * @param {number} [opts.page]
 * @param {number} [opts.limit]
 * @param {Date|string} [opts.from]
 * @param {Date|string} [opts.to]
 */
async function listOfflineSales(opts = {}) {
    const page = Math.max(1, parseInt(String(opts.page || 1), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(opts.limit || 20), 10) || 20));
    const offset = (page - 1) * limit;

    const where = {};
    if (opts.from || opts.to) {
        where.soldAt = {};
        if (opts.from) {
            const f = new Date(opts.from);
            if (!Number.isNaN(f.getTime())) where.soldAt[Op.gte] = f;
        }
        if (opts.to) {
            const t = new Date(opts.to);
            if (!Number.isNaN(t.getTime())) where.soldAt[Op.lte] = t;
        }
    }

    const { count, rows } = await OfflineSale.findAndCountAll({
        where,
        order: [['soldAt', 'DESC']],
        limit,
        offset,
        include: [
            { model: Admin, as: 'createdByAdmin', required: false, attributes: ['id', 'email', 'name'] },
            {
                model: LaybyPlan,
                as: 'laybyPlan',
                required: false,
                attributes: ['id', 'status', 'balanceRemaining', 'depositPercent', 'depositAmount']
            }
        ]
    });

    return {
        sales: rows.map((r) => r.toJSON()),
        total: count,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(count / limit))
    };
}

/**
 * Sum of offline sale totals in a date range (for dashboard KPIs).
 * @param {Date|string} [from]
 * @param {Date|string} [to]
 * @returns {Promise<{ total: number, count: number }>}
 */
async function getOfflineSaleTotalsInRange(from, to) {
    const conditions = [];
    const replacements = {};

    if (from) {
        const f = new Date(from);
        if (!Number.isNaN(f.getTime())) {
            conditions.push('sold_at >= :from');
            replacements.from = f;
        }
    }
    if (to) {
        const t = new Date(to);
        if (!Number.isNaN(t.getTime())) {
            conditions.push('sold_at <= :to');
            replacements.to = t;
        }
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [result] = await sequelize.query(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(CAST(COALESCE(
                    JSON_UNQUOTE(JSON_EXTRACT(totals, '$.total')),
                    JSON_UNQUOTE(JSON_EXTRACT(totals, '$.subtotal')),
                    '0'
                ) AS DECIMAL(12,2))), 0) AS total
         FROM offline_sales
         ${whereClause}`,
        { replacements, type: sequelize.QueryTypes.SELECT }
    );

    return {
        total: roundMoney2(Number(result.total) || 0),
        count: parseInt(result.count, 10) || 0
    };
}

module.exports = {
    createOfflineSale,
    createOfflineLaybySale,
    listOfflineSales,
    getOfflineSaleTotalsInRange
};
