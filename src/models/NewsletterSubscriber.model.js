const { sequelize } = require('../config/mysql');
const { DataTypes } = require('sequelize');

const NewsletterSubscriber = sequelize.define('NewsletterSubscriber', {
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
    status: {
        type: DataTypes.ENUM('active', 'unsubscribed'),
        allowNull: false,
        defaultValue: 'active'
    },
    subscribedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    source: {
        type: DataTypes.STRING(50),
        allowNull: true,
        defaultValue: 'home'
    },
    unsubscribeToken: {
        type: DataTypes.STRING(64),
        allowNull: true,
        unique: true
    },
    unsubscribedAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'newsletter_subscribers',
    timestamps: true
});

module.exports = NewsletterSubscriber;
