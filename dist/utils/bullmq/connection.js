/**
 * BullMQ Redis Connection Configuration
 *
 * Provides shared Redis connection for all BullMQ queues and workers.
 */
/**
 * Parse REDIS_URL into connection options
 */
function parseRedisUrl(url) {
    const parsed = new URL(url);
    return {
        host: parsed.hostname,
        port: parseInt(parsed.port || '6379', 10),
        password: parsed.password || undefined,
        username: parsed.username || undefined,
        db: parsed.pathname ? parseInt(parsed.pathname.slice(1), 10) || 0 : 0,
    };
}
/**
 * Get Redis connection options from environment
 */
export function getRedisConnection() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    return parseRedisUrl(redisUrl);
}
/**
 * Default job options for campaign queue
 */
export const defaultJobOptions = {
    attempts: 3,
    backoff: {
        type: 'exponential',
        delay: 1000, // Start with 1 second
    },
    removeOnComplete: {
        age: 24 * 60 * 60, // Keep completed jobs for 24 hours
        count: 1000, // Keep last 1000 completed jobs
    },
    removeOnFail: false, // Keep failed jobs for inspection
};
/**
 * Queue names
 */
export const QUEUE_NAMES = {
    CAMPAIGN: 'campaignQueue',
    CUSTOMER: 'customerQueue',
    DLQ: 'campaignDLQ',
    FLOW_ENROLLMENT: 'flowEnrollmentQueue',
    FLOW_STEP: 'flowStepQueue',
};
/**
 * Worker concurrency settings from environment
 */
export function getWorkerConcurrency() {
    return parseInt(process.env.BULLMQ_CONCURRENCY || '5', 10);
}
