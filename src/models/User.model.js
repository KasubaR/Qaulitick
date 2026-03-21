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
        unique: true,
        validate: { isEmail: true }
    },
    phone: {
        type: DataTypes.STRING(40),
        allowNull: true
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
    const row = await User.scope('withPasswordHash').findByPk(this.id);
    if (!row) return false;
    return bcrypt.compare(candidatePassword, row.passwordHash);
};

module.exports = User;
