const { sequelize } = require('../config/mysql');
const { DataTypes } = require('sequelize');

const Faq = sequelize.define('Faq', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    question: { type: DataTypes.STRING(500), allowNull: false },
    answer: { type: DataTypes.TEXT, allowNull: false },
    category: { type: DataTypes.STRING(100), allowNull: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    isPublished: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, {
    tableName: 'faqs',
    timestamps: true
});

module.exports = Faq;
