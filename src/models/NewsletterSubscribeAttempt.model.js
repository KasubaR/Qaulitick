const { sequelize } = require('../config/mysql');
const { DataTypes } = require('sequelize');

/**
 * One row per normalized email; lastAttemptAt updated on each subscribe POST.
 * Used for per-email rate limiting (independent of newsletter_subscribers rows).
 */
const NewsletterSubscribeAttempt = sequelize.define('NewsletterSubscribeAttempt', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
        set(value) {
            const v = typeof value === 'string' ? value.trim().toLowerCase() : value;
            this.setDataValue('email', v);
        }
    },
    lastAttemptAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'newsletter_subscribe_attempts',
    timestamps: true
});

module.exports = NewsletterSubscribeAttempt;
