// Cache Middleware for API responses
// Implements in-memory caching with TTL (Time To Live)

const cache = new Map();
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

// Generate cache key from request
function generateCacheKey(req) {
    const { url, query } = req;
    const queryString = new URLSearchParams(query).toString();
    return `${url}?${queryString}`;
}

// Cache middleware
function cacheMiddleware(ttl = DEFAULT_TTL) {
    return (req, res, next) => {
        // Only cache GET requests
        if (req.method !== 'GET') {
            return next();
        }

        const cacheKey = generateCacheKey(req);
        const cached = cache.get(cacheKey);

        if (cached && cached.expires > Date.now()) {
            // Set cache headers
            res.set({
                'X-Cache': 'HIT',
                'Cache-Control': 'public, max-age=300', // 5 minutes
                'ETag': cached.etag
            });
            
            // Check if client has cached version
            const clientEtag = req.headers['if-none-match'];
            if (clientEtag === cached.etag) {
                return res.status(304).end(); // Not Modified
            }

            return res.json(cached.data);
        }

        // Store original json method
        const originalJson = res.json.bind(res);

        // Override json method to cache response
        res.json = function(data) {
            const etag = `"${Date.now()}-${Math.random()}"`;
            
            // Cache the response
            cache.set(cacheKey, {
                data: data,
                expires: Date.now() + ttl,
                etag: etag
            });

            // Set cache headers
            res.set({
                'X-Cache': 'MISS',
                'Cache-Control': 'public, max-age=300',
                'ETag': etag
            });

            return originalJson(data);
        };

        next();
    };
}

// Clear cache for specific pattern
function clearCache(pattern) {
    const keysToDelete = [];
    for (const key of cache.keys()) {
        if (key.includes(pattern)) {
            keysToDelete.push(key);
        }
    }
    keysToDelete.forEach(key => cache.delete(key));
}

// Clear all cache
function clearAllCache() {
    cache.clear();
}

// Clean expired cache entries (run periodically)
function cleanExpiredCache() {
    const now = Date.now();
    for (const [key, value] of cache.entries()) {
        if (value.expires <= now) {
            cache.delete(key);
        }
    }
}

// Run cleanup every minute
setInterval(cleanExpiredCache, 60 * 1000);

module.exports = {
    cacheMiddleware,
    clearCache,
    clearAllCache
};

