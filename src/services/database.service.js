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
            const shouldAlter = process.env.DB_SYNC_ALTER === 'true';
            try {
                // alter: true can repeatedly try to add indexes/constraints on every boot.
                // This eventually hits MySQL's "Too many keys" limit.
                await sequelize.sync({ alter: shouldAlter });
            } catch (syncError) {
                // If we still hit index/keys limits, fall back to a safe sync mode.
                const code = syncError?.original?.code || syncError?.parent?.code;
                if (code === 'ER_TOO_MANY_KEYS') {
                    console.warn('⚠️ Too many keys detected during sync; retrying with alter:false');
                    try {
                        await sequelize.sync({ alter: false });
                    } catch (syncError2) {
                        const code2 = syncError2?.original?.code || syncError2?.parent?.code;
                        if (code2 === 'ER_TOO_MANY_KEYS') {
                            // If the DB is already saturated with indexes, any further sync may fail.
                            // Proceed without syncing so the app can boot.
                            console.warn('⚠️ Sync still failed due to too many keys; continuing without sync');
                        } else {
                            throw syncError2;
                        }
                    }
                } else {
                    throw syncError;
                }
            }
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
