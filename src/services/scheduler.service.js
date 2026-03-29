/**
 * Scheduler Service
 * 
 * Handles scheduled tasks for the application
 * Currently handles cleanup of featured products
 */

const featuredProductService = require('./featuredProduct.service');
const Order = require('../models/Order.model');
const Product = require('../models/Product.model');
const { sequelize } = require('../config/mysql');
const { Op } = require('sequelize');

const PENDING_TTL_MS     = 10 * 60 * 1000; // 10 minutes for pending orders
const PROCESSING_TTL_MS  = 30 * 60 * 1000; // 30 minutes for processing orders (gateway timeout)

/**
 * Mark stale unpaid orders expired and restore color-variant JSON stock (decremented at checkout).
 * Targets:
 *   - paymentStatus = 'pending'    older than PENDING_TTL_MS   (10 min)
 *   - paymentStatus = 'processing' older than PROCESSING_TTL_MS (30 min)
 */
async function expireStaleUnpaidOrders() {
    const pendingCutoff    = new Date(Date.now() - PENDING_TTL_MS);
    const processingCutoff = new Date(Date.now() - PROCESSING_TTL_MS);

    const expiredOrders = await Order.findAll({
        where: {
            [Op.or]: [
                { paymentStatus: 'pending',    createdAt: { [Op.lt]: pendingCutoff } },
                { paymentStatus: 'processing', createdAt: { [Op.lt]: processingCutoff } }
            ]
        }
    });

    if (expiredOrders.length === 0) return;

    console.log(`[Scheduler] Expiring ${expiredOrders.length} stale unpaid order(s)...`);

    for (const order of expiredOrders) {
        try {
            const items = order.items || [];
            const ttlLabel = order.paymentStatus === 'processing' ? '30 minutes' : '10 minutes';

            for (const item of items) {
                const qty = parseInt(item.quantity) || 1;
                const productId = parseInt(item.productId, 10);

                if (item.selectedColor) {
                    const product = await Product.findByPk(productId);
                    if (product) {
                        const updatedColors = (product.colors || []).map(c =>
                            c.name === item.selectedColor
                                ? { ...c, stock: (c.stock || 0) + qty }
                                : c
                        );
                        await product.update({ colors: updatedColors });
                    }
                }
            }

            order.status = 'cancelled';
            order.paymentStatus = 'expired';
            const history = Array.isArray(order.history) ? [...order.history] : [];
            history.push({
                status: 'cancelled',
                paymentStatus: 'expired',
                notes: `Order expired — payment not received within ${ttlLabel}`,
                updatedBy: 'system',
                updatedAt: new Date().toISOString(),
                source: 'expiry_cron'
            });
            order.history = history;
            await order.save();

            console.log(`[Scheduler] Expired order ${order.orderNumber} (was ${order.paymentStatus})`);
        } catch (err) {
            console.error(`[Scheduler] Error expiring order ${order.orderNumber}:`, err);
        }
    }
}

class SchedulerService {
    constructor() {
        this.intervals = [];
        this.isRunning = false;
    }

    /**
     * Start all scheduled tasks
     */
    start() {
        if (this.isRunning) {
            console.log('[Scheduler] Already running');
            return;
        }

        this.isRunning = true;
        console.log('[Scheduler] Starting scheduled tasks...');

        // Cleanup deleted products every 6 hours
        const cleanupDeletedInterval = setInterval(async () => {
            try {
                console.log('[Scheduler] Running cleanup of deleted products...');
                const removedCount = await featuredProductService.cleanupDeletedProducts();
                if (removedCount > 0) {
                    console.log(`[Scheduler] Cleaned up ${removedCount} featured product(s) that referenced deleted products`);
                } else {
                    console.log('[Scheduler] No deleted products found in featured products');
                }
            } catch (error) {
                console.error('[Scheduler] Error during cleanup of deleted products:', error);
            }
        }, 6 * 60 * 60 * 1000); // 6 hours

        // Cleanup inactive/out-of-stock products every 12 hours (auto-remove enabled)
        const cleanupInactiveInterval = setInterval(async () => {
            try {
                console.log('[Scheduler] Running cleanup for inactive/out-of-stock featured products...');
                const result = await featuredProductService.cleanupInactiveProducts(true);
                if (result.removedCount > 0) {
                    console.log(`[Scheduler] Removed ${result.removedCount} inactive/out-of-stock featured product(s)`);
                } else {
                    console.log('[Scheduler] All featured products are active and in stock');
                }
            } catch (error) {
                console.error('[Scheduler] Error during cleanup check for inactive products:', error);
            }
        }, 12 * 60 * 60 * 1000); // 12 hours

        // Expire stale unpaid orders every 2 minutes (restores color variant counts only)
        const expireStaleOrdersInterval = setInterval(async () => {
            try {
                await expireStaleUnpaidOrders();
            } catch (error) {
                console.error('[Scheduler] Error during stale order expiry:', error);
            }
        }, 2 * 60 * 1000); // 2 minutes

        this.intervals.push(cleanupDeletedInterval, cleanupInactiveInterval, expireStaleOrdersInterval);

        // Run initial cleanup on startup (after 1 minute delay to let server fully start)
        setTimeout(async () => {
            try {
                console.log('[Scheduler] Running initial cleanup of deleted products...');
                const removedCount = await featuredProductService.cleanupDeletedProducts();
                if (removedCount > 0) {
                    console.log(`[Scheduler] Initial cleanup: Removed ${removedCount} featured product(s) that referenced deleted products`);
                }

                await expireStaleUnpaidOrders();
            } catch (error) {
                console.error('[Scheduler] Error during initial cleanup:', error);
            }
        }, 60 * 1000); // 1 minute

        console.log('[Scheduler] Scheduled tasks started');
    }

    /**
     * Stop all scheduled tasks
     */
    stop() {
        if (!this.isRunning) {
            return;
        }

        this.intervals.forEach(interval => clearInterval(interval));
        this.intervals = [];
        this.isRunning = false;
        console.log('[Scheduler] Scheduled tasks stopped');
    }

    /**
     * Get scheduler status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            activeTasks: this.intervals.length
        };
    }
}

// Export singleton instance
module.exports = new SchedulerService();

