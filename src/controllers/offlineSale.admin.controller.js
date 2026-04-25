/**
 * Admin API: offline / in-store sales (JSON).
 */

const offlineSaleService = require('../services/offlineSale.service');
const logger = require('../utils/logger').child({ module: 'offlineSale.admin.controller' });

function httpStatusFromError(err) {
    if (err && err.statusCode >= 400 && err.statusCode < 600) return err.statusCode;
    return 500;
}

/**
 * POST /api/admin/offline-sales
 * Body: { items, totals?, soldAt?, customerName?, customerEmail?, customerPhone?, notes? }
 */
exports.createOfflineSale = async (req, res) => {
    try {
        if (!req.admin) {
            return res.status(401).json({ success: false, message: 'Admin authentication required' });
        }

        const sale = await offlineSaleService.createOfflineSale(req.body || {}, req.admin);

        res.status(201).json({
            success: true,
            sale: sale ? sale.toJSON() : null
        });
    } catch (err) {
        logger.error({ err }, 'createOfflineSale failed');
        const status = httpStatusFromError(err);
        res.status(status).json({
            success: false,
            message: err.message || 'Failed to create offline sale'
        });
    }
};

/**
 * GET /api/admin/offline-sales?page=1&limit=20&from=&to=
 * Dates: ISO strings or YYYY-MM-DD
 */
exports.listOfflineSales = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const from = req.query.from || null;
        const to = req.query.to || null;

        const result = await offlineSaleService.listOfflineSales({ page, limit, from, to });

        res.json({
            success: true,
            ...result
        });
    } catch (err) {
        logger.error({ err }, 'listOfflineSales failed');
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to list offline sales'
        });
    }
};
