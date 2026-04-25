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
const { getSellableUnitsForLine } = require('../utils/stock.utils');
const { getSellingUnitPrice } = require('../utils/price.utils');
const logger = require('../utils/logger').child({ module: 'offlineSale.service' });

function roundMoney2(x) {
    return Math.round(Number(x) * 100) / 100;
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
        const normalizedLines = [];

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
                raw.unitPrice != null && raw.unitPrice !== ''
                    ? roundMoney2(raw.unitPrice)
                    : serverUnit;
            if (unitPrice <= 0) {
                unitPrice = serverUnit;
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

        for (const line of normalizedLines) {
            const { productId, quantity, selectedColor } = line;

            if (selectedColor) {
                const fresh = await Product.findByPk(productId, { transaction: t, lock: t.LOCK.UPDATE });
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

        const tempSaleNumber = `TMP-OFF-${crypto.randomUUID()}`;

        const sale = await OfflineSale.create(
            {
                saleNumber: tempSaleNumber,
                soldAt,
                items: normalizedLines.map((line) => ({
                    productId: line.productId,
                    name: line.name,
                    quantity: line.quantity,
                    unitPrice: line.unitPrice,
                    lineTotal: line.lineTotal,
                    ...(line.selectedColor ? { selectedColor: line.selectedColor } : {})
                })),
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

        const d = new Date(soldAt);
        const datePart =
            String(d.getDate()).padStart(2, '0') +
            String(d.getMonth() + 1).padStart(2, '0') +
            d.getFullYear();
        const saleNumber = `OFF-${datePart}-${String(sale.id).padStart(6, '0')}`;

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
        include: [{ model: Admin, as: 'createdByAdmin', required: false, attributes: ['id', 'email', 'name'] }]
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
    const where = {};
    if (from || to) {
        where.soldAt = {};
        if (from) {
            const f = new Date(from);
            if (!Number.isNaN(f.getTime())) where.soldAt[Op.gte] = f;
        }
        if (to) {
            const t = new Date(to);
            if (!Number.isNaN(t.getTime())) where.soldAt[Op.lte] = t;
        }
    }

    const rows = await OfflineSale.findAll({
        where,
        attributes: ['totals'],
        raw: true
    });

    let total = 0;
    for (const row of rows) {
        const t = row.totals;
        const obj = typeof t === 'string' ? JSON.parse(t || '{}') : t || {};
        total += roundMoney2(obj.total ?? obj.subtotal ?? 0);
    }

    return { total: roundMoney2(total), count: rows.length };
}

module.exports = {
    createOfflineSale,
    listOfflineSales,
    getOfflineSaleTotalsInRange
};
