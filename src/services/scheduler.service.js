/**
 * Scheduler Service
 * 
 * Handles scheduled tasks for the application
 * Currently handles cleanup of featured products
 */

const featuredProductService = require('./featuredProduct.service');

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

        // Cleanup inactive/out-of-stock products every 12 hours (warnings only, no auto-remove)
        const cleanupInactiveInterval = setInterval(async () => {
            try {
                console.log('[Scheduler] Running cleanup check for inactive/out-of-stock products...');
                const result = await featuredProductService.cleanupInactiveProducts(false); // Warnings only
                if (result.warnings && result.warnings.length > 0) {
                    console.warn(`[Scheduler] Found ${result.warnings.length} inactive/out-of-stock featured product(s):`);
                    result.warnings.slice(0, 5).forEach(warning => {
                        console.warn(`[Scheduler]   - ${warning}`);
                    });
                    if (result.warnings.length > 5) {
                        console.warn(`[Scheduler]   ... and ${result.warnings.length - 5} more`);
                    }
                } else {
                    console.log('[Scheduler] All featured products are active and in stock');
                }
            } catch (error) {
                console.error('[Scheduler] Error during cleanup check for inactive products:', error);
            }
        }, 12 * 60 * 60 * 1000); // 12 hours

        this.intervals.push(cleanupDeletedInterval, cleanupInactiveInterval);

        // Run initial cleanup on startup (after 1 minute delay to let server fully start)
        setTimeout(async () => {
            try {
                console.log('[Scheduler] Running initial cleanup of deleted products...');
                const removedCount = await featuredProductService.cleanupDeletedProducts();
                if (removedCount > 0) {
                    console.log(`[Scheduler] Initial cleanup: Removed ${removedCount} featured product(s) that referenced deleted products`);
                }
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

