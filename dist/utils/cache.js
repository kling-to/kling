import Redis from 'ioredis';
import { logger } from './logger.js';
import { metrics } from './metrics.js';
let redisClient = null;
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
export const CACHE_KEYS = {
    SUPPRESSION_LIST: 'cache:suppression:',
    QUOTA_STATUS: 'cache:quota:',
    SETTINGS: 'cache:settings',
};
export const CACHE_TTL = {
    SUPPRESSION_LIST: 120,
    QUOTA_STATUS: 60,
    SETTINGS: 300,
};
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
export async function closeCache() {
    if (redisClient) {
        await redisClient.quit();
        redisClient = null;
    }
}
