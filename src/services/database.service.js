const { sequelize, config: mysqlConfig } = require('../config/mysql');

// Load all models so tables are registered
require('../models');

class DatabaseService {
    constructor() {
        this.isConnected = false;
        this.connectionAttempts = 0;
        this.maxRetries = 3;
    }

    async connect() {
        if (this.isConnected) {
            console.log('📊 Already connected to MySQL');
            return;
        }

        try {
            await sequelize.authenticate();
            await sequelize.sync({ alter: true }); // alter: true adds missing columns to existing tables
            this.isConnected = true;
            this.connectionAttempts = 0;
            console.log('✅ Connected to MySQL successfully');
            console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
            this.setupEventListeners();
        } catch (error) {
            this.connectionAttempts++;
            console.error('❌ MySQL connection error:', error.message);
            if (this.connectionAttempts < this.maxRetries) {
                console.log(`🔄 Retrying... (${this.connectionAttempts + 1}/${this.maxRetries})`);
                await this.delay(5000);
                return this.connect();
            }
            throw error;
        }
    }

    async disconnect() {
        if (!this.isConnected) return;
        try {
            await sequelize.close();
            this.isConnected = false;
            console.log('👋 Disconnected from MySQL');
        } catch (error) {
            console.error('❌ Error disconnecting from MySQL:', error.message);
            throw error;
        }
    }

    isHealthy() {
        return this.isConnected;
    }

    getStatus() {
        return this.isConnected ? 'connected' : 'disconnected';
    }

    setupEventListeners() {
        process.on('SIGINT', async () => {
            await this.disconnect();
            process.exit(0);
        });
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async getStats() {
        try {
            const [results] = await sequelize.query(
                "SELECT table_name AS 'table', table_rows AS 'rows' FROM information_schema.tables WHERE table_schema = ?",
                { replacements: [mysqlConfig.database] }
            );
            return { database: mysqlConfig.database, tables: results };
        } catch (error) {
            console.error('❌ Error getting database stats:', error.message);
            return null;
        }
    }
}

const databaseService = new DatabaseService();
module.exports = databaseService;
