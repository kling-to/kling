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
export function getRedisConnection() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    return parseRedisUrl(redisUrl);
}
export const defaultJobOptions = {
    attempts: 3,
    backoff: {
        type: 'exponential',
        delay: 1000,
    },
    removeOnComplete: {
        age: 24 * 60 * 60,
        count: 1000,
    },
    removeOnFail: false,
};
export const QUEUE_NAMES = {
    CAMPAIGN: 'campaignQueue',
    CUSTOMER: 'customerQueue',
    DLQ: 'campaignDLQ',
    FLOW_ENROLLMENT: 'flowEnrollmentQueue',
    FLOW_STEP: 'flowStepQueue',
};
export function getWorkerConcurrency() {
    return parseInt(process.env.BULLMQ_CONCURRENCY || '5', 10);
}
