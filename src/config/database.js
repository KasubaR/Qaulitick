require('dotenv').config();
const databaseService = require('../services/database.service');

/**
 * Database configuration - MySQL/MariaDB for cPanel phpMyAdmin
 * Set in .env: MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 */

const config = {
    dbName: process.env.MYSQL_DATABASE || process.env.DB_NAME || 'qualitick_db'
};

async function connectDatabase() {
    await databaseService.connect();
}

module.exports = { config, connectDatabase };
