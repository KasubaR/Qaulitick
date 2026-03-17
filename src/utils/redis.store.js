// Redis Store for Rate Limiting
// Provides Redis-backed storage with fallback to in-memory store

let redisClient = null;
let inMemoryStore = new Map();
let useRedis = false;
let redisConnected = false;

/**
 * Initialize Redis connection
 * @returns {Promise<boolean>} True if Redis is available, false otherwise
 */
async function initializeRedis() {
    // Check if Redis should be used
    const redisUrl = process.env.REDIS_URL;
    const redisHost = process.env.REDIS_HOST || 'localhost';
    const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
    const redisPassword = process.env.REDIS_PASSWORD;
    const useRedisEnv = process.env.USE_REDIS === 'true' || process.env.USE_REDIS === '1';
    
    // Only use Redis if explicitly enabled or if REDIS_URL is provided
    if (!useRedisEnv && !redisUrl) {
        console.log('[Redis Store] Redis not configured. Using in-memory store.');
        return false;
    }

    try {
        const redis = require('redis');
        
        // Create Redis client
        if (redisUrl) {
            redisClient = redis.createClient({
                url: redisUrl
            });
        } else {
            redisClient = redis.createClient({
                socket: {
                    host: redisHost,
                    port: redisPort
                },
                password: redisPassword || undefined
            });
        }

        // Set up error handlers
        redisClient.on('error', (err) => {
            console.error('[Redis Store] Redis error:', err.message);
            redisConnected = false;
            // Fallback to in-memory store on error
            useRedis = false;
        });

        redisClient.on('connect', () => {
            console.log('[Redis Store] Connecting to Redis...');
        });

        redisClient.on('ready', () => {
            console.log('[Redis Store] Redis client ready');
            redisConnected = true;
            useRedis = true;
        });

        redisClient.on('end', () => {
            console.log('[Redis Store] Redis connection ended');
            redisConnected = false;
            useRedis = false;
        });

        redisClient.on('reconnecting', () => {
            console.log('[Redis Store] Redis reconnecting...');
        });

        // Connect to Redis
        await redisClient.connect();
        
        // Test connection with a ping
        await redisClient.ping();
        
        console.log('[Redis Store] Redis connected successfully');
        return true;
    } catch (error) {
        console.warn('[Redis Store] Failed to connect to Redis:', error.message);
        console.warn('[Redis Store] Falling back to in-memory store');
        
        // Clean up failed connection
        if (redisClient) {
            try {
                await redisClient.quit();
            } catch (quitError) {
                // Ignore quit errors
            }
            redisClient = null;
        }
        
        return false;
    }
}

/**
 * Get rate limit data from store
 * @param {string} key - Rate limit key
 * @returns {Promise<Object|null>} Rate limit data or null
 */
async function get(key) {
    if (useRedis && redisConnected && redisClient) {
        try {
            const data = await redisClient.get(key);
            if (data) {
                return JSON.parse(data);
            }
            return null;
        } catch (error) {
            console.error('[Redis Store] Error getting key:', error.message);
            // Fallback to in-memory on error
            return inMemoryStore.get(key) || null;
        }
    }
    
    // Use in-memory store
    return inMemoryStore.get(key) || null;
}

/**
 * Set rate limit data in store
 * @param {string} key - Rate limit key
 * @param {Object} data - Rate limit data
 * @param {number} ttl - Time to live in milliseconds
 * @returns {Promise<boolean>} Success status
 */
async function set(key, data, ttl) {
    if (useRedis && redisConnected && redisClient) {
        try {
            const ttlSeconds = Math.ceil(ttl / 1000);
            await redisClient.setEx(key, ttlSeconds, JSON.stringify(data));
            return true;
        } catch (error) {
            console.error('[Redis Store] Error setting key:', error.message);
            // Fallback to in-memory on error
            inMemoryStore.set(key, data);
            return false;
        }
    }
    
    // Use in-memory store
    inMemoryStore.set(key, data);
    return true;
}

/**
 * Delete rate limit data from store
 * @param {string} key - Rate limit key
 * @returns {Promise<boolean>} Success status
 */
async function del(key) {
    if (useRedis && redisConnected && redisClient) {
        try {
            await redisClient.del(key);
            return true;
        } catch (error) {
            console.error('[Redis Store] Error deleting key:', error.message);
            // Fallback to in-memory on error
            inMemoryStore.delete(key);
            return false;
        }
    }
    
    // Use in-memory store
    inMemoryStore.delete(key);
    return true;
}

/**
 * Delete all keys matching a pattern
 * @param {string} pattern - Key pattern (supports wildcards)
 * @returns {Promise<number>} Number of keys deleted
 */
async function delPattern(pattern) {
    if (useRedis && redisConnected && redisClient) {
        try {
            const keys = await redisClient.keys(pattern);
            if (keys.length > 0) {
                await redisClient.del(keys);
            }
            return keys.length;
        } catch (error) {
            console.error('[Redis Store] Error deleting pattern:', error.message);
            // Fallback to in-memory
            let deleted = 0;
            for (const [key] of inMemoryStore.entries()) {
                if (key.includes(pattern.replace('*', ''))) {
                    inMemoryStore.delete(key);
                    deleted++;
                }
            }
            return deleted;
        }
    }
    
    // Use in-memory store
    let deleted = 0;
    for (const [key] of inMemoryStore.entries()) {
        if (key.includes(pattern.replace('*', ''))) {
            inMemoryStore.delete(key);
            deleted++;
        }
    }
    return deleted;
}

/**
 * Clear all rate limit data
 * @returns {Promise<boolean>} Success status
 */
async function clear() {
    if (useRedis && redisConnected && redisClient) {
        try {
            await redisClient.flushDb();
            return true;
        } catch (error) {
            console.error('[Redis Store] Error clearing store:', error.message);
            // Fallback to in-memory
            inMemoryStore.clear();
            return false;
        }
    }
    
    // Use in-memory store
    inMemoryStore.clear();
    return true;
}

/**
 * Get all keys matching a pattern
 * @param {string} pattern - Key pattern
 * @returns {Promise<Array<string>>} Array of keys
 */
async function keys(pattern) {
    if (useRedis && redisConnected && redisClient) {
        try {
            return await redisClient.keys(pattern);
        } catch (error) {
            console.error('[Redis Store] Error getting keys:', error.message);
            // Fallback to in-memory
            const result = [];
            for (const [key] of inMemoryStore.entries()) {
                if (key.includes(pattern.replace('*', ''))) {
                    result.push(key);
                }
            }
            return result;
        }
    }
    
    // Use in-memory store
    const result = [];
    for (const [key] of inMemoryStore.entries()) {
        if (key.includes(pattern.replace('*', ''))) {
            result.push(key);
        }
    }
    return result;
}

/**
 * Get store size (number of keys)
 * @returns {Promise<number>} Number of keys
 */
async function size() {
    if (useRedis && redisConnected && redisClient) {
        try {
            return await redisClient.dbSize();
        } catch (error) {
            console.error('[Redis Store] Error getting size:', error.message);
            // Fallback to in-memory
            return inMemoryStore.size;
        }
    }
    
    // Use in-memory store
    return inMemoryStore.size;
}

/**
 * Check if Redis is available and connected
 * @returns {boolean} True if Redis is connected
 */
function isRedisAvailable() {
    return useRedis && redisConnected && redisClient !== null;
}

/**
 * Close Redis connection
 * @returns {Promise<void>}
 */
async function close() {
    if (redisClient) {
        try {
            await redisClient.quit();
            console.log('[Redis Store] Redis connection closed');
        } catch (error) {
            console.error('[Redis Store] Error closing Redis connection:', error.message);
        }
        redisClient = null;
        redisConnected = false;
        useRedis = false;
    }
}

// Initialize Redis on module load (non-blocking)
if (process.env.NODE_ENV !== 'test') {
    initializeRedis().catch(err => {
        console.warn('[Redis Store] Failed to initialize Redis:', err.message);
    });
}

/**
 * Acquire a distributed lock (mutex) using SET with NX and EX options
 * @param {string} key - Lock key
 * @param {number} ttlSeconds - Lock expiration in seconds
 * @param {string} lockValue - Unique value to identify the lock holder (optional, defaults to timestamp)
 * @returns {Promise<boolean>} True if lock acquired, false otherwise
 */
async function acquireLock(key, ttlSeconds = 10, lockValue = null) {
    if (useRedis && redisConnected && redisClient) {
        try {
            const value = lockValue || `${Date.now()}-${Math.random()}`;
            // Use SET with NX (only if not exists) and EX (expiration)
            // Redis v4+ API: set(key, value, { NX: true, EX: seconds })
            const result = await redisClient.set(key, value, {
                NX: true, // Only set if key doesn't exist
                EX: ttlSeconds // Expiration in seconds
            });
            return result === 'OK';
        } catch (error) {
            console.error('[Redis Store] Error acquiring lock:', error.message);
            return false;
        }
    }
    
    // Fallback: simple in-memory lock (not distributed, only works within single process)
    if (!inMemoryStore.has(key)) {
        inMemoryStore.set(key, Date.now() + (ttlSeconds * 1000));
        return true;
    }
    
    // Check if lock expired
    const lockExpiry = inMemoryStore.get(key);
    if (Date.now() > lockExpiry) {
        inMemoryStore.set(key, Date.now() + (ttlSeconds * 1000));
        return true;
    }
    
    return false;
}

/**
 * Release a distributed lock
 * @param {string} key - Lock key
 * @returns {Promise<boolean>} Success status
 */
async function releaseLock(key) {
    return del(key);
}

module.exports = {
    initializeRedis,
    get,
    set,
    del,
    delPattern,
    clear,
    keys,
    size,
    isRedisAvailable,
    close,
    acquireLock,
    releaseLock
};

