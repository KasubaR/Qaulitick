const { sequelize } = require('../config/mysql');
const { DataTypes } = require('sequelize');

/**
 * In-store / manual sales recorded outside the website checkout flow.
 * Stock is decremented in offlineSale.service when a row is created.
 *
 * items: [{ productId, name, quantity, unitPrice, lineTotal, selectedColor? }]
 * totals: { subtotal, total } — room for discount fields later
 */
const OfflineSale = sequelize.define('OfflineSale', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    saleNumber: {
        type: DataTypes.STRING(40),
        allowNull: false,
        unique: true,
        comment: 'Human-readable ref e.g. OFF-20260415-00001'
    },
    soldAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    items: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
        get() {
            const v = this.getDataValue('items');
            if (typeof v === 'string') {
                try {
                    return JSON.parse(v);
                } catch {
                    return [];
                }
            }
            return Array.isArray(v) ? v : [];
        }
    },
    totals: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {},
        get() {
            const v = this.getDataValue('totals');
            if (typeof v === 'string') {
                try {
                    return JSON.parse(v);
                } catch {
                    return {};
                }
            }
            return v && typeof v === 'object' ? v : {};
        }
    },
    currency: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'ZMW'
    },
    customerName: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    customerEmail: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    customerPhone: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    createdByAdminId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'admins', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    },
    /** Snapshot at insert time for audit if admin row is removed or for quick display */
    createdByAdminEmail: {
        type: DataTypes.STRING(255),
        allowNull: true
    }
}, {
    tableName: 'offline_sales',
    timestamps: true,
    indexes: [
        { fields: ['soldAt'] },
        { fields: ['createdByAdminId'] }
    ]
});

module.exports = OfflineSale;
