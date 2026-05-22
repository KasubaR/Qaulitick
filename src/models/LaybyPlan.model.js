const { sequelize } = require('../config/mysql');
const { DataTypes } = require('sequelize');

const LaybyPlan = sequelize.define('LaybyPlan', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    orderId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'orders', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    offlineSaleId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'offline_sales', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    },
    currency: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'ZMW'
    },
    orderTotal: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },
    depositPercent: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false
    },
    depositAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },
    balanceRemaining: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },
    installmentCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    /** Optional snapshot of per-installment amounts/dates (JSON array) */
    installmentSchedule: {
        type: DataTypes.JSON,
        allowNull: true
    },
    status: {
        type: DataTypes.ENUM('active', 'completed', 'cancelled'),
        allowNull: false,
        defaultValue: 'active'
    },
    nextDueAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'layby_plans',
    timestamps: true,
    indexes: [
        { fields: ['orderId'] },
        { fields: ['userId'] },
        { fields: ['offlineSaleId'] },
        { fields: ['status'] }
    ]
});

module.exports = LaybyPlan;
