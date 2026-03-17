const bcrypt = require('bcrypt');
const { sequelize } = require('../config/mysql');
const { DataTypes } = require('sequelize');

const Admin = sequelize.define('Admin', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        validate: { isEmail: true }
    },
    password: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    name: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    role: {
        type: DataTypes.ENUM('admin', 'superadmin'),
        defaultValue: 'admin'
    },
    lastLogin: {
        type: DataTypes.DATE,
        allowNull: true
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    tableName: 'admins',
    timestamps: true,
    hooks: {
        beforeCreate: async (admin) => {
            if (admin.password) {
                const salt = await bcrypt.genSalt(10);
                admin.password = await bcrypt.hash(admin.password, salt);
            }
        },
        beforeUpdate: async (admin) => {
            if (admin.changed('password')) {
                const salt = await bcrypt.genSalt(10);
                admin.password = await bcrypt.hash(admin.password, salt);
            }
        }
    },
    defaultScope: {
        attributes: { exclude: ['password'] }
    },
    scopes: {
        withPassword: { attributes: {} }
    }
});

Admin.prototype.comparePassword = async function(candidatePassword) {
    const admin = await Admin.scope('withPassword').findByPk(this.id);
    return bcrypt.compare(candidatePassword, admin.password);
};

Admin.prototype.updateLastLogin = async function() {
    this.lastLogin = new Date();
    await this.save();
};

module.exports = Admin;
