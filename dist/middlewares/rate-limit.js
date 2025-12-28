import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { getRedisClient } from '../utils/cache.js';
import { logger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
/**
 * Skip rate limit for admin users or internal services
 */
function skipRateLimit(req) {
    // Skip for admin users
    const user = req.user;
    if (user?.role === 'admin') {
        return true;
    }
    // Skip for internal API keys (if configured)
    const apiKey = req.headers['x-internal-api-key'];
    if (apiKey && process.env.INTERNAL_API_KEY && apiKey === process.env.INTERNAL_API_KEY) {
        return true;
    }
    return false;
}
/**
 * Create rate limiter with Redis store
 */
function createRateLimiter(options) {
    const redis = getRedisClient();
    const rateLimitOptions = {
        windowMs: options.windowMs,
        max: options.max,
        standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
        legacyHeaders: false, // Disable `X-RateLimit-*` headers
        // Redis store for distributed rate limiting
        store: new RedisStore({
            // @ts-expect-error - RedisStore types are not compatible with ioredis
            sendCommand: (...args) => redis.call(...args),
            prefix: `rl:${options.prefix}:`,
        }),
        // Skip successful requests (useful for login endpoints)
        skipSuccessfulRequests: options.skipSuccessfulRequests || false,
        // Skip for admins
        skip: skipRateLimit,
        // Handler for rate limit exceeded
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
    // Only add custom keyGenerator if provided (for user-based limits)
    // IP-based limits should use the default keyGenerator which handles IPv6 properly
    if (options.keyGenerator && !options.useDefaultKeyGenerator) {
        rateLimitOptions.keyGenerator = options.keyGenerator;
    }
    return rateLimit(rateLimitOptions);
}
/**
 * Global rate limiter: 100 requests per 15 minutes per IP
 * Uses default key generator for proper IPv6 handling
 */
export const globalLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    prefix: 'global',
    useDefaultKeyGenerator: true,
    message: 'Too many requests from this IP, please try again later',
});
/**
 * Auth rate limiter: 5 login attempts per 15 minutes per IP
 * Only counts failed attempts
 * Uses default key generator for proper IPv6 handling
 */
export const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    prefix: 'auth',
    skipSuccessfulRequests: true, // Only count failed login attempts
    useDefaultKeyGenerator: true,
    message: 'Too many login attempts, please try again in 15 minutes',
});
/**
 * Campaign creation rate limiter: 20 per hour per user
 * Uses user ID for rate limiting (not IP)
 */
export const campaignLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20,
    prefix: 'campaigns',
    keyGenerator: (req) => {
        // Use authenticated user ID - this endpoint requires auth
        return req.user?.sub || 'anonymous';
    },
    message: 'Campaign creation rate limit exceeded (20 per hour)',
});
/**
 * Natural language parsing rate limiter: 10 per hour per user
 * Protects against OpenAI API quota exhaustion
 * Uses user ID for rate limiting (not IP)
 */
export const nlParsingLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    prefix: 'nl-parsing',
    keyGenerator: (req) => {
        // Use authenticated user ID - this endpoint requires auth
        return req.user?.sub || 'anonymous';
    },
    message: 'Natural language parsing rate limit exceeded (10 per hour)',
});
/**
 * Event ingestion rate limiter: 1000 events per minute per integration
 * For /v1/events/ingest endpoint
 * Uses integration ID for rate limiting (not IP)
 */
export const eventIngestionLimiter = createRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 1000,
    prefix: 'events',
    keyGenerator: (req) => {
        // Use integration ID from auth context or API key
        return req.integrationId || 'anonymous';
    },
    message: 'Event ingestion rate limit exceeded (1000 per minute)',
});
/**
 * Webhook rate limiter: 100 per minute per IP
 * For external webhook endpoints
 * Uses default key generator for proper IPv6 handling
 */
export const webhookLimiter = createRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 100,
    prefix: 'webhook',
    useDefaultKeyGenerator: true,
    message: 'Webhook rate limit exceeded (100 per minute)',
});
/**
 * Admin operations limiter: 30 per hour per user
 * For sensitive admin actions
 * Uses user ID for rate limiting (not IP)
 */
export const adminLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 30,
    prefix: 'admin',
    keyGenerator: (req) => {
        // Use authenticated user ID - admin endpoints require auth
        return req.user?.sub || 'anonymous';
    },
    message: 'Admin operation rate limit exceeded (30 per hour)',
});
