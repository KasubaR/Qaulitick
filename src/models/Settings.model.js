const { sequelize } = require('../config/mysql');
const { DataTypes } = require('sequelize');

const Settings = sequelize.define('Settings', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    notifications: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: () => ({
            email: {
                notifyNewOrders: true,
                notifyLowStock: true,
                notifyPayments: true,
                notifyContactSubmissions: true,
                notificationEmail: 'Peterkinpin98@gmail.com'
            },
            inApp: { showOrderBadges: true, showStockAlerts: true }
        })
    },
    general: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: () => ({
            siteName: 'Qualitick Collections',
            siteUrl: '',
            adminEmail: '',
            timezone: 'Africa/Lusaka',
            currency: 'ZMW',
            language: 'en'
        })
    },
    store: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: () => ({
            storeName: 'Qualitick Collections',
            storeAddress: '',
            storePhone: '',
            storeEmail: '',
            businessHours: '',
            taxId: ''
        })
    },
    payment: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: () => ({
            lencoApiBaseUrl: '',
            lencoApiSecretKey: '',
            lencoPublicKey: '',
            lencoWebhookSecret: '',
            lencoWebhookUrl: '',
            lencoEnvironment: 'production'
        })
    },
    email: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: () => ({
            emailHost: '',
            emailPort: 587,
            emailSecure: true,
            emailUser: '',
            emailPassword: '',
            emailFrom: '',
            emailFromName: 'Qualitick Collections'
        })
    },
    security: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: () => ({
            sessionTimeout: 30,
            maxLoginAttempts: 5,
            requireStrongPassword: true,
            enable2FA: false,
            enableCSP: true,
            enableRateLimiting: true
        })
    }
}, {
    tableName: 'settings',
    timestamps: true
});

Settings.getDefaultSettings = function() {
    return {
        notifications: {
            email: {
                notifyNewOrders: true,
                notifyLowStock: true,
                notifyPayments: true,
                notifyContactSubmissions: true,
                notificationEmail: 'Peterkinpin98@gmail.com'
            },
            inApp: { showOrderBadges: true, showStockAlerts: true }
        },
        general: {
            siteName: 'Qualitick Collections',
            siteUrl: '',
            adminEmail: '',
            timezone: 'Africa/Lusaka',
            currency: 'ZMW',
            language: 'en'
        },
        store: {
            storeName: 'Qualitick Collections',
            storeAddress: '',
            storePhone: '',
            storeEmail: '',
            businessHours: '',
            taxId: ''
        },
        payment: {
            lencoApiBaseUrl: '',
            lencoApiSecretKey: '',
            lencoPublicKey: '',
            lencoWebhookSecret: '',
            lencoWebhookUrl: '',
            lencoEnvironment: 'production'
        },
        email: {
            emailHost: '',
            emailPort: 587,
            emailSecure: true,
            emailUser: '',
            emailPassword: '',
            emailFrom: '',
            emailFromName: 'Qualitick Collections'
        },
        security: {
            sessionTimeout: 30,
            maxLoginAttempts: 5,
            requireStrongPassword: true,
            enable2FA: false,
            enableCSP: true,
            enableRateLimiting: true
        }
    };
};

Settings.getSettings = async function() {
    let settings = await this.findOne();
    const defaults = this.getDefaultSettings();
    if (!settings) {
        settings = await this.create(defaults);
        console.log('[Settings Model] Created default settings');
    } else {
        let needsUpdate = false;
        for (const key of Object.keys(defaults)) {
            if (!settings[key] || (typeof settings[key] === 'object' && Object.keys(settings[key]).length === 0)) {
                settings[key] = defaults[key];
                needsUpdate = true;
            }
        }
        if (needsUpdate) await settings.save();
    }
    return settings;
};

Settings.prototype.updateSettings = async function(category, data) {
    const valid = ['general', 'store', 'payment', 'email', 'security', 'notifications'];
    if (!valid.includes(category)) throw new Error(`Invalid settings category: ${category}`);
    const current = this[category] || {};
    this[category] = { ...current, ...data };
    await this.save();
    return this;
};

Settings.prototype.getNotificationEmail = function() {
    return this.notifications?.email?.notificationEmail || 'Peterkinpin98@gmail.com';
};

Settings.prototype.shouldSendNotification = function(type) {
    const map = { newOrder: 'notifyNewOrders', lowStock: 'notifyLowStock', payment: 'notifyPayments', contactSubmission: 'notifyContactSubmissions' };
    const key = map[type];
    return key ? this.notifications?.email?.[key] !== false : false;
};

module.exports = Settings;
