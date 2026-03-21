const { sequelize } = require('../config/mysql');
const { DataTypes } = require('sequelize');

const Order = sequelize.define('Order', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    orderNumber: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    },
    checkoutMode: {
        type: DataTypes.ENUM('standard', 'layby'),
        allowNull: false,
        defaultValue: 'standard'
    },
    customer: { type: DataTypes.JSON, allowNull: false },
    shipping: { type: DataTypes.JSON, allowNull: true },
    paymentMethod: {
        type: DataTypes.ENUM('mobile_money', 'bank_transfer', 'card', 'cash_on_delivery'),
        allowNull: false
    },
    paymentStatus: {
        type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed', 'refunded'),
        defaultValue: 'pending'
    },
    transactionId: { type: DataTypes.STRING(100), allowNull: true },
    items: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    totals: { type: DataTypes.JSON, allowNull: false },
    coupon: { type: DataTypes.JSON, allowNull: true },
    status: {
        type: DataTypes.ENUM('pending', 'payment_pending', 'paid', 'confirmed', 'processing', 'packed', 'shipped', 'delivered', 'cancelled', 'payment_failed', 'returned'),
        defaultValue: 'pending'
    },
    trackingNumber: { type: DataTypes.STRING(100), allowNull: true },
    courier: { type: DataTypes.STRING(100), allowNull: true },
    notes: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
    history: { type: DataTypes.JSON, allowNull: true, defaultValue: [] }
}, {
    tableName: 'orders',
    timestamps: true
});

Order.findByOrderNumber = function(orderNumber) {
    return this.findOne({ where: { orderNumber } });
};

module.exports = Order;
