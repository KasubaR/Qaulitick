const { sequelize } = require('../config/mysql');
const { DataTypes } = require('sequelize');

const ContactSubmission = sequelize.define('ContactSubmission', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    name: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: { isEmail: true }
    },
    phone: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    subject: {
        type: DataTypes.ENUM('product-inquiry', 'order-support', 'shipping', 'returns', 'business', 'other'),
        allowNull: false
    },
    message: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('new', 'replied', 'archived'),
        defaultValue: 'new'
    }
}, {
    tableName: 'contact_submissions',
    timestamps: true
});

module.exports = ContactSubmission;
