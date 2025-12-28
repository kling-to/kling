/**
 * Redis Cache Utilities
 *
 * Provides caching functionality for frequently accessed data
 * to reduce database load.
 */
import Redis from 'ioredis';
import { logger } from './logger.js';
import { metrics } from './metrics.js';
// Singleton Redis client for caching
let redisClient = null;
/**
 * Get or create Redis client for caching
 */
export function getRedisClient() {
    if (!redisClient) {
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        redisClient = new Redis(redisUrl, {
            maxRetriesPerRequest: 3,
            enableReadyCheck: true,
            lazyConnect: true,
        });
        redisClient.on('error', (err) => {
            logger.error('Redis connection error', { component: 'Cache', error: err.message });
        });
        redisClient.on('connect', () => {
            logger.info('Redis connected', { component: 'Cache' });
        });
    }
    return redisClient;
}
/**
 * Cache key prefixes
 */
export const CACHE_KEYS = {
    SUPPRESSION_LIST: 'cache:suppression:',
    QUOTA_STATUS: 'cache:quota:',
    SETTINGS: 'cache:settings',
};
/**
 * Default TTLs in seconds
 */
export const CACHE_TTL = {
    SUPPRESSION_LIST: 120, // 2 minutes
    QUOTA_STATUS: 60, // 1 minute
    SETTINGS: 300, // 5 minutes
};
/**
 * Get cached value
 */
export async function getCache(key) {
    try {
        const redis = getRedisClient();
        const value = await redis.get(key);
        if (value) {
            const cacheKey = key.split(':')[1] || 'unknown';
            metrics.cacheHits.labels({ cache_key: cacheKey }).inc();
            logger.debug('Cache hit', { component: 'Cache', key });
            return JSON.parse(value);
        }
        const cacheKey = key.split(':')[1] || 'unknown';
        metrics.cacheMisses.labels({ cache_key: cacheKey }).inc();
        logger.debug('Cache miss', { component: 'Cache', key });
        return null;
    }
    catch (err) {
        logger.error('Cache get error', { component: 'Cache', key, error: err.message });
        return null;
    }
}
/**
 * Set cached value with TTL
 */
export async function setCache(key, value, ttlSeconds) {
    try {
        const redis = getRedisClient();
        await redis.setex(key, ttlSeconds, JSON.stringify(value));
        logger.debug('Cache set', { component: 'Cache', key, ttlSeconds });
    }
    catch (err) {
        logger.error('Cache set error', { component: 'Cache', key, error: err.message });
    }
}
/**
 * Delete cached value
 */
export async function deleteCache(key) {
    try {
        const redis = getRedisClient();
        await redis.del(key);
        logger.debug('Cache deleted', { component: 'Cache', key });
    }
    catch (err) {
        logger.error('Cache delete error', { component: 'Cache', key, error: err.message });
    }
}
/**
 * Delete cached values by pattern
 */
export async function deleteCachePattern(pattern) {
    try {
        const redis = getRedisClient();
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
            await redis.del(...keys);
            logger.debug('Cache pattern deleted', {
                component: 'Cache',
                pattern,
                keysDeleted: keys.length,
            });
        }
    }
    catch (err) {
        logger.error('Cache delete pattern error', {
            component: 'Cache',
            pattern,
            error: err.message,
        });
    }
}
/**
 * Close Redis connection (for graceful shutdown)
 */
export async function closeCache() {
    if (redisClient) {
        await redisClient.quit();
        redisClient = null;
    }
}
