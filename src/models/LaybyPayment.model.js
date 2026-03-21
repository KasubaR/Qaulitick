const { sequelize } = require('../config/mysql');
const { DataTypes } = require('sequelize');

const LaybyPayment = sequelize.define('LaybyPayment', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    laybyPlanId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'layby_plans', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    sequence: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: '1 = deposit, 2..n = installments'
    },
    dueAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('pending', 'paid', 'overdue', 'waived'),
        allowNull: false,
        defaultValue: 'pending'
    },
    paidAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    paymentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'payments', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    },
    adminConfirmedAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'layby_payments',
    timestamps: true,
    indexes: [
        { unique: true, fields: ['laybyPlanId', 'sequence'] }
    ]
});

module.exports = LaybyPayment;
