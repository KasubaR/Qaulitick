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

const RESERVATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Release stock reservations for orders that never received payment.
 * Targets orders where paymentStatus = 'pending' and createdAt < now - 30 min.
 */
async function releaseExpiredReservations() {
    const cutoff = new Date(Date.now() - RESERVATION_TTL_MS);

    const expiredOrders = await Order.findAll({
        where: {
            paymentStatus: 'pending',
            createdAt: { [Op.lt]: cutoff }
        }
    });

    if (expiredOrders.length === 0) return;

    console.log(`[Scheduler] Releasing reservations for ${expiredOrders.length} expired order(s)...`);

    for (const order of expiredOrders) {
        try {
            const items = order.items || [];

            for (const item of items) {
                const qty = parseInt(item.quantity) || 1;
                const productId = parseInt(item.productId, 10);

                // Release product-level reservation
                await Product.update(
                    { reservedStock: sequelize.literal(`GREATEST(0, reservedStock - ${qty})`) },
                    { where: { id: productId, reservedStock: { [Op.gt]: 0 } } }
                );

                // Restore color-specific stock that was decremented at order creation
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
                notes: 'Order expired — payment not received within 10 minutes',
                updatedBy: 'system',
                updatedAt: new Date().toISOString(),
                source: 'expiry_cron'
            });
            order.history = history;
            await order.save();

            console.log(`[Scheduler] Expired order ${order.orderNumber} — reservation released`);
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

        // Release stale stock reservations every 5 minutes
        const expireReservationsInterval = setInterval(async () => {
            try {
                await releaseExpiredReservations();
            } catch (error) {
                console.error('[Scheduler] Error during reservation expiry:', error);
            }
        }, 5 * 60 * 1000); // 5 minutes

        this.intervals.push(cleanupDeletedInterval, cleanupInactiveInterval, expireReservationsInterval);

        // Run initial cleanup on startup (after 1 minute delay to let server fully start)
        setTimeout(async () => {
            try {
                console.log('[Scheduler] Running initial cleanup of deleted products...');
                const removedCount = await featuredProductService.cleanupDeletedProducts();
                if (removedCount > 0) {
                    console.log(`[Scheduler] Initial cleanup: Removed ${removedCount} featured product(s) that referenced deleted products`);
                }

                // Also release any reservations that expired while the server was down
                await releaseExpiredReservations();
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

