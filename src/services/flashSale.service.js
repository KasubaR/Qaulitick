const FlashSale = require('../models/FlashSale.model');
const { Op } = require('sequelize');

function toId(id) { return typeof id === 'string' ? parseInt(id, 10) : id; }

/**
 * Flash Sale Service
 * 
 * Handles all database operations for flash sales
 */

class FlashSaleService {
    
    /**
     * Get all flash sales with optional filters
     * @param {Object} filters - Query filters
     * @param {Object} options - Query options (sort, limit, skip)
     * @returns {Promise<Array>}
     */
    async getAllFlashSales(filters = {}, options = {}) {
        try {
            const {
                sort = { createdAt: -1 },
                limit = 0,
                skip = 0
            } = options;

            const query = FlashSale.find(filters);
            if (sort) query.sort(sort);
            if (skip) query.skip(skip);
            if (limit) query.limit(limit);
            const flashSales = await query.exec();
            return flashSales;
        } catch (error) {
            console.error('[Flash Sale Service] Error getting all flash sales:', error);
            throw error;
        }
    }

    /**
     * Get active flash sales (currently running)
     * @returns {Promise<Array>}
     */
    async getActiveFlashSales() {
        try {
            const now = new Date();
            const flashSales = await FlashSale.findAll({
                where: {
                    status: 'active',
                    startDate: { [Op.lte]: now },
                    endDate: { [Op.gte]: now },
                    showBanner: true
                },
                order: [['createdAt', 'DESC']]
            });
            
            return flashSales;
        } catch (error) {
            console.error('[Flash Sale Service] Error getting active flash sales:', error);
            throw error;
        }
    }

    /**
     * Get flash sale by ID
     * @param {String} id - Flash sale ID
     * @returns {Promise<Object|null>}
     */
    async getFlashSaleById(id) {
        try {
            const flashSale = await FlashSale.findById(id);
            return flashSale;
        } catch (error) {
            console.error('[Flash Sale Service] Error getting flash sale by ID:', error);
            throw error;
        }
    }

    /**
     * Create a new flash sale
     * @param {Object} saleData - Flash sale data
     * @returns {Promise<Object>}
     */
    async createFlashSale(saleData) {
        try {
            if (saleData.productIds && Array.isArray(saleData.productIds)) {
                saleData.productIds = saleData.productIds.map(id => toId(id));
            }
            if (!saleData.status) saleData.status = 'active';
            const flashSale = await FlashSale.create(saleData);
            return flashSale;
        } catch (error) {
            console.error('[Flash Sale Service] Error creating flash sale:', error);
            throw error;
        }
    }

    /**
     * Update a flash sale
     * @param {String} id - Flash sale ID
     * @param {Object} updateData - Data to update
     * @returns {Promise<Object|null>}
     */
    async updateFlashSale(id, updateData) {
        try {
            if (updateData.productIds && Array.isArray(updateData.productIds)) {
                updateData.productIds = updateData.productIds.map(pid => toId(pid));
            }
            const flashSale = await FlashSale.findByIdAndUpdate(id, updateData, { new: true });
            
            return flashSale;
        } catch (error) {
            console.error('[Flash Sale Service] Error updating flash sale:', error);
            throw error;
        }
    }

    /**
     * Delete a flash sale
     * @param {String} id - Flash sale ID
     * @returns {Promise<Object|null>}
     */
    async deleteFlashSale(id) {
        try {
            const flashSale = await FlashSale.findByIdAndDelete(id);
            return flashSale;
        } catch (error) {
            console.error('[Flash Sale Service] Error deleting flash sale:', error);
            throw error;
        }
    }

    /**
     * Get flash sales by status
     * @param {String} status - Status to filter by
     * @returns {Promise<Array>}
     */
    async getFlashSalesByStatus(status) {
        try {
            const flashSales = await FlashSale.findAll({
                where: { status },
                order: [['createdAt', 'DESC']]
            });
            return flashSales;
        } catch (error) {
            console.error('[Flash Sale Service] Error getting flash sales by status:', error);
            throw error;
        }
    }
}

// Export singleton instance
module.exports = new FlashSaleService();

