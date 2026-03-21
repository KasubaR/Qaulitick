const { sequelize, config: mysqlConfig } = require('../config/mysql');

// Load all models so tables are registered
require('../models');

/**
 * Allow only unquoted MySQL identifier characters in dynamically composed raw SQL.
 * INFORMATION_SCHEMA / SHOW INDEX names are normally safe; this guards against surprises.
 * @param {string} name
 * @returns {string}
 */
function assertSafeMysqlIdentifier(name) {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_]+$/.test(name)) {
        throw new Error('Unsafe MySQL identifier');
    }
    return name;
}

class DatabaseService {
    constructor() {
        this.isConnected = false;
        this.connectionAttempts = 0;
        this.maxRetries = 3;
        this._connectingPromise = null;
    }

    /**
     * Drop duplicate indexes on a table, keeping only the first occurrence of each column set.
     * This is a one-time repair that runs before sync so alter:true never hits ER_TOO_MANY_KEYS.
     */
    async repairDuplicateIndexes() {
        try {
            const [tables] = await sequelize.query(
                `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`
            );

            for (const row of tables) {
                let table;
                try {
                    table = assertSafeMysqlIdentifier(row.TABLE_NAME);
                } catch {
                    console.warn('[DB] Skipping index repair: unexpected table name from INFORMATION_SCHEMA');
                    continue;
                }
                const [indexes] = await sequelize.query(`SHOW INDEX FROM \`${table}\``);

                // Pre-compute which Key_names cover multiple columns — SHOW INDEX returns
                // one row per column, so a composite index appears N times. These must NOT
                // be treated as duplicates in the first pass below.
                const keyRowCount = {};
                for (const idx of indexes) {
                    if (idx.Key_name === 'PRIMARY') continue;
                    keyRowCount[idx.Key_name] = (keyRowCount[idx.Key_name] || 0) + 1;
                }
                const multiColumnKeys = new Set(
                    Object.keys(keyRowCount).filter(k => keyRowCount[k] > 1)
                );

                // Detect truly duplicate index names (same name, same table — shouldn't
                // happen in MySQL but guard anyway). Skip composite indexes.
                const seen = new Set();
                const toDrop = [];

                for (const idx of indexes) {
                    const key = idx.Key_name;
                    if (key === 'PRIMARY') continue;
                    if (multiColumnKeys.has(key)) continue;
                    if (seen.has(key)) {
                        if (!toDrop.includes(key)) toDrop.push(key);
                    } else {
                        seen.add(key);
                    }
                }

                // Detect indexes on the same column with different names (email / email_2 pattern).
                const columnGroups = {};
                for (const idx of indexes) {
                    if (idx.Key_name === 'PRIMARY') continue;
                    if (multiColumnKeys.has(idx.Key_name)) continue; // skip composite indexes
                    const col = idx.Column_name;
                    if (!columnGroups[col]) columnGroups[col] = [];
                    columnGroups[col].push(idx.Key_name);
                }

                for (const [col, keys] of Object.entries(columnGroups)) {
                    if (keys.length > 1) {
                        // Keep the shortest/first name, drop the rest
                        const sorted = [...new Set(keys)].sort((a, b) => a.localeCompare(b));
                        for (const key of sorted.slice(1)) {
                            if (!toDrop.includes(key)) toDrop.push(key);
                        }
                    }
                }

                if (toDrop.length > 0) {
                    try {
                        const drops = toDrop
                            .map((k) => {
                                assertSafeMysqlIdentifier(k);
                                return `DROP INDEX \`${k}\``;
                            })
                            .join(', ');
                        await sequelize.query(`ALTER TABLE \`${table}\` ${drops}`);
                        console.log(`🔧 Repaired ${toDrop.length} duplicate index(es) on \`${table}\`: ${toDrop.join(', ')}`);
                    } catch (dropErr) {
                        console.warn(`[DB] Skipped index drop on \`${table}\`:`, dropErr.message);
                    }
                }
            }
        } catch (err) {
            // Non-fatal — log and continue so the app still boots
            console.warn('⚠️ repairDuplicateIndexes encountered an error (non-fatal):', err.message);
        }
    }

    async connect() {
        if (this.isConnected) {
            console.log('📊 Already connected to MySQL');
            return;
        }
        if (this._connectingPromise) {
            return this._connectingPromise;
        }
        this._connectingPromise = this._doConnect().finally(() => {
            this._connectingPromise = null;
        });
        return this._connectingPromise;
    }

    async _doConnect() {
        try {
            await sequelize.authenticate();

            const shouldAlter = process.env.DB_SYNC_ALTER === 'true';
            try {
                await sequelize.sync({ alter: shouldAlter });
            } catch (syncError) {
                const code = syncError?.original?.code || syncError?.parent?.code;
                if (code === 'ER_TOO_MANY_KEYS') {
                    console.warn('⚠️ Too many keys detected during sync; retrying with alter:false');
                    try {
                        await sequelize.sync({ alter: false });
                    } catch (syncError2) {
                        const code2 = syncError2?.original?.code || syncError2?.parent?.code;
                        if (code2 === 'ER_TOO_MANY_KEYS') {
                            console.warn('⚠️ Sync still failed due to too many keys; continuing without sync');
                        } else {
                            throw syncError2;
                        }
                    }
                } else {
                    throw syncError;
                }
            }

            // Repair any duplicate indexes that sync just created (happens on fresh tables
            // because Sequelize registers an index entry for each side of every bidirectional
            // association, producing duplicates like orderId / orderId_2).
            await this.repairDuplicateIndexes();
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