const { sequelize } = require('../config/mysql');
const { DataTypes } = require('sequelize');

const Order = sequelize.define('Order', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    orderNumber: { type: DataTypes.STRING(50), allowNull: false, unique: 'orders_order_number_unique' },
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
    customer: {
        type: DataTypes.JSON,
        allowNull: false,
        get() { const v = this.getDataValue('customer'); return typeof v === 'string' ? JSON.parse(v) : v; }
    },
    shipping: {
        type: DataTypes.JSON,
        allowNull: true,
        get() { const v = this.getDataValue('shipping'); return v && typeof v === 'string' ? JSON.parse(v) : v; }
    },
    paymentMethod: {
        type: DataTypes.ENUM('mobile_money', 'bank_transfer', 'card', 'cash_on_delivery'),
        allowNull: false
    },
    paymentStatus: {
        type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed', 'refunded'),
        defaultValue: 'pending'
    },
    transactionId: { type: DataTypes.STRING(100), allowNull: true },
    items: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
        get() { const v = this.getDataValue('items'); return typeof v === 'string' ? JSON.parse(v) : v; }
    },
    totals: {
        type: DataTypes.JSON,
        allowNull: false,
        get() { const v = this.getDataValue('totals'); return typeof v === 'string' ? JSON.parse(v) : v; }
    },
    coupon: {
        type: DataTypes.JSON,
        allowNull: true,
        get() { const v = this.getDataValue('coupon'); return v && typeof v === 'string' ? JSON.parse(v) : v; }
    },
    status: {
        type: DataTypes.ENUM('pending', 'payment_pending', 'paid', 'confirmed', 'processing', 'packed', 'shipped', 'delivered', 'cancelled', 'payment_failed', 'returned'),
        defaultValue: 'pending'
    },
    trackingNumber: { type: DataTypes.STRING(100), allowNull: true },
    courier: { type: DataTypes.STRING(200), allowNull: true },
    shippingNote: { type: DataTypes.TEXT, allowNull: true },
    notes: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: [],
        get() { const v = this.getDataValue('notes'); return typeof v === 'string' ? JSON.parse(v) : v; }
    },
    history: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: [],
        get() { const v = this.getDataValue('history'); return typeof v === 'string' ? JSON.parse(v) : v; }
    }
}, {
    tableName: 'orders',
    timestamps: true
});

Order.findByOrderNumber = function(orderNumber) {
    return this.findOne({ where: { orderNumber } });
};

Order.delete = async function(orderNumber) {
    const order = await this.findByOrderNumber(orderNumber);
    if (!order) return null;
    await order.destroy();
    return order;
};

Order.updateStatus = async function(orderNumber, status, notes, updatedBy = 'admin') {
    const order = await this.findByOrderNumber(orderNumber);
    if (!order) return null;

    const history = Array.isArray(order.history) ? [...order.history] : [];
    history.push({
        status,
        paymentStatus: order.paymentStatus,
        notes: notes || '',
        updatedBy,
        updatedAt: new Date()
    });

    order.status = status;
    order.history = history;
    await order.save();
    return order;
};

module.exports = Order;
