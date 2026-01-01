import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { getRedisClient } from '../utils/cache.js';
import { logger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
function skipRateLimit(req) {
    const user = req.user;
    if (user?.role === 'admin') {
        return true;
    }
    const apiKey = req.headers['x-internal-api-key'];
    if (apiKey && process.env.INTERNAL_API_KEY && apiKey === process.env.INTERNAL_API_KEY) {
        return true;
    }
    return false;
}
function createRateLimiter(options) {
    const redis = getRedisClient();
    const rateLimitOptions = {
        windowMs: options.windowMs,
        max: options.max,
        standardHeaders: true,
        legacyHeaders: false,
        store: new RedisStore({
            sendCommand: (...args) => redis.call(...args),
            prefix: `rl:${options.prefix}:`,
        }),
        skipSuccessfulRequests: options.skipSuccessfulRequests || false,
        skip: skipRateLimit,
        handler: (req, res) => {
            logger.warn('Rate limit exceeded', {
                component: 'RateLimiter',
                limiter: options.prefix,
                path: req.path,
                limit: options.max,
                windowMs: options.windowMs,
            });
            metrics.rateLimitHits.labels({ limiter: options.prefix }).inc();
            res.status(429).json({
                status: 'error',
                error: {
                    message: options.message || 'Too many requests, please try again later',
                },
            });
        },
    };
    if (options.keyGenerator && !options.useDefaultKeyGenerator) {
        rateLimitOptions.keyGenerator = options.keyGenerator;
    }
    return rateLimit(rateLimitOptions);
}
export const globalLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 100,
    prefix: 'global',
    useDefaultKeyGenerator: true,
    message: 'Too many requests from this IP, please try again later',
});
export const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    prefix: 'auth',
    skipSuccessfulRequests: true,
    useDefaultKeyGenerator: true,
    message: 'Too many login attempts, please try again in 15 minutes',
});
export const campaignLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 20,
    prefix: 'campaigns',
    keyGenerator: (req) => {
        return req.user?.sub || 'anonymous';
    },
    message: 'Campaign creation rate limit exceeded (20 per hour)',
});
export const nlParsingLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 10,
    prefix: 'nl-parsing',
    keyGenerator: (req) => {
        return req.user?.sub || 'anonymous';
    },
    message: 'Natural language parsing rate limit exceeded (10 per hour)',
});
export const eventIngestionLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 1000,
    prefix: 'events',
    keyGenerator: (req) => {
        return req.integrationId || 'anonymous';
    },
    message: 'Event ingestion rate limit exceeded (1000 per minute)',
});
export const webhookLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 100,
    prefix: 'webhook',
    useDefaultKeyGenerator: true,
    message: 'Webhook rate limit exceeded (100 per minute)',
});
export const adminLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 30,
    prefix: 'admin',
    keyGenerator: (req) => {
        return req.user?.sub || 'anonymous';
    },
    message: 'Admin operation rate limit exceeded (30 per hour)',
});
