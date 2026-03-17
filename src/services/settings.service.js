const Settings = require('../models/Settings.model');

/**
 * Settings Service
 * 
 * Handles business logic for admin settings management
 */

class SettingsService {
    /**
     * Get all settings (creates default if none exist)
     * @returns {Promise<Object>} Settings document
     */
    async getSettings() {
        try {
            const settings = await Settings.getSettings();
            return settings;
        } catch (error) {
            console.error('[Settings Service] Error getting settings:', error);
            throw error;
        }
    }

    /**
     * Update settings by category
     * @param {String} category - Settings category (general, store, payment, email, security, notifications)
     * @param {Object} data - Data to update
     * @returns {Promise<Object>} Updated settings document
     */
    async updateSettings(category, data) {
        try {
            // Get current settings (or create default)
            const settings = await this.getSettings();
            
            // Update settings using instance method
            await settings.updateSettings(category, data);
            
            return settings;
        } catch (error) {
            console.error(`[Settings Service] Error updating ${category} settings:`, error);
            throw error;
        }
    }

    /**
     * Get only notification settings
     * @returns {Promise<Object>} Notification settings object
     */
    async getNotificationSettings() {
        try {
            const settings = await this.getSettings();
            return {
                email: {
                    notifyNewOrders: settings.notifications?.email?.notifyNewOrders ?? true,
                    notifyLowStock: settings.notifications?.email?.notifyLowStock ?? true,
                    notifyPayments: settings.notifications?.email?.notifyPayments ?? true,
                    notifyContactSubmissions: settings.notifications?.email?.notifyContactSubmissions ?? true,
                    notificationEmail: settings.notifications?.email?.notificationEmail || 'Peterkinpin98@gmail.com'
                },
                inApp: {
                    showOrderBadges: settings.notifications?.inApp?.showOrderBadges ?? true,
                    showStockAlerts: settings.notifications?.inApp?.showStockAlerts ?? true
                }
            };
        } catch (error) {
            console.error('[Settings Service] Error getting notification settings:', error);
            throw error;
        }
    }

    /**
     * Update notification settings
     * @param {Object} data - Notification settings data
     * @returns {Promise<Object>} Updated settings document
     */
    async updateNotificationSettings(data) {
        try {
            // Ensure notificationEmail has default value if not provided
            const notificationData = {
                ...data,
                email: {
                    ...data.email,
                    notificationEmail: data.email?.notificationEmail || 'Peterkinpin98@gmail.com'
                }
            };
            
            return await this.updateSettings('notifications', notificationData);
        } catch (error) {
            console.error('[Settings Service] Error updating notification settings:', error);
            throw error;
        }
    }

    /**
     * Get the notification email address (used by email service)
     * @returns {Promise<String>} Notification email address
     */
    async getNotificationEmail() {
        try {
            const settings = await this.getSettings();
            return settings.getNotificationEmail();
        } catch (error) {
            console.error('[Settings Service] Error getting notification email:', error);
            // Return default email if error occurs
            return 'Peterkinpin98@gmail.com';
        }
    }

    /**
     * Check if a notification type is enabled
     * @param {String} type - Notification type (newOrder, lowStock, payment, contactSubmission)
     * @returns {Promise<Boolean>} True if notification is enabled
     */
    async shouldSendNotification(type) {
        try {
            const settings = await this.getSettings();
            return settings.shouldSendNotification(type);
        } catch (error) {
            console.error(`[Settings Service] Error checking notification ${type}:`, error);
            // Default to true if error occurs (fail open)
            return true;
        }
    }

    /**
     * Get settings by category
     * @param {String} category - Settings category
     * @returns {Promise<Object>} Category settings
     */
    async getSettingsByCategory(category) {
        try {
            const settings = await this.getSettings();
            const validCategories = ['general', 'store', 'payment', 'email', 'security', 'notifications'];
            
            if (!validCategories.includes(category)) {
                throw new Error(`Invalid settings category: ${category}`);
            }
            
            return settings[category] || {};
        } catch (error) {
            console.error(`[Settings Service] Error getting ${category} settings:`, error);
            throw error;
        }
    }
}

// Create singleton instance
const settingsService = new SettingsService();

module.exports = settingsService;

