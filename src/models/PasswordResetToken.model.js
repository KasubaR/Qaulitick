const { sequelize } = require('../config/mysql');
const { DataTypes } = require('sequelize');

const PasswordResetToken = sequelize.define('PasswordResetToken', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    tokenHash: {
        type: DataTypes.STRING(128),
        allowNull: false
    },
    expiresAt: {
        type: DataTypes.DATE,
        allowNull: false
    },
    usedAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'password_reset_tokens',
    timestamps: true,
    updatedAt: false
});

module.exports = PasswordResetToken;
