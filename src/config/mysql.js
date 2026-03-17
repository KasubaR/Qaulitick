require('dotenv').config();
const { Sequelize, Model } = require('sequelize');

// Compatibility: Sequelize instances get toObject() and _id like Mongoose
Model.prototype.toObject = function() {
    const plain = this.get ? this.get({ plain: true }) : this;
    if (plain && !plain._id && plain.id !== undefined) plain._id = plain.id;
    return plain;
};
Object.defineProperty(Model.prototype, '_id', {
    get() { return this.id; },
    enumerable: false
});

/**
 * MySQL / MariaDB configuration for cPanel phpMyAdmin
 * Set in .env: MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE, MYSQL_PORT (optional)
 */

const config = {
    host: process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || process.env.DB_PORT || '3306', 10),
    username: process.env.MYSQL_USER || process.env.DB_USER || 'root',
    password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || process.env.DB_NAME || 'qualitick_db',
    dialect: 'mysql',
    pool: {
        max: 10,
        min: 0,
        acquire: 30000,
        idle: 10000
    },
    define: {
        timestamps: true,
        underscored: false,
        freezeTableName: false
    },
    logging: process.env.NODE_ENV === 'development' ? console.log : false
};

const sequelize = new Sequelize(
    config.database,
    config.username,
    config.password,
    {
        host: config.host,
        port: config.port,
        dialect: config.dialect,
        pool: config.pool,
        define: config.define,
        logging: config.logging
    }
);

module.exports = { sequelize, config };
