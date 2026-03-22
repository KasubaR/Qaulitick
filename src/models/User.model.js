const bcrypt = require('bcrypt');
const { sequelize } = require('../config/mysql');
const { DataTypes } = require('sequelize');

const User = sequelize.define('User', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    name: {
        type: DataTypes.STRING(150),
        allowNull: false
    },
    email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: 'users_email_unique',
        validate: { isEmail: true }
    },
    phone: {
        type: DataTypes.STRING(40),
        allowNull: false
    },
    passwordHash: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    emailVerifiedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    emailVerificationToken: {
        type: DataTypes.STRING(128),
        allowNull: true
    },
    emailVerificationExpires: {
        type: DataTypes.DATE,
        allowNull: true
    },
    deliveryAddress: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    city: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    province: {
        type: DataTypes.STRING(100),
        allowNull: true
    }
}, {
    tableName: 'users',
    timestamps: true,
    defaultScope: {
        attributes: { exclude: ['passwordHash'] }
    },
    scopes: {
        withPasswordHash: { attributes: {} }
    }
});

User.hashPassword = async function(plain) {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(plain, salt);
};

User.prototype.comparePassword = async function(candidatePassword) {
    if (!this.passwordHash) {
        throw new Error('comparePassword called on instance without passwordHash — use scope withPasswordHash');
    }
    return bcrypt.compare(candidatePassword, this.passwordHash);
};

module.exports = User;
