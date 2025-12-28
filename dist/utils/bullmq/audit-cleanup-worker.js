/**
 * Audit Cleanup Worker
 *
 * BullMQ worker that periodically cleans up old audit logs
 * based on the configured retention period.
 *
 * Default schedule: Daily at 3:00 AM
 * Default retention: 7 days (configurable via settings)
 * Minimum retention: 1 day (hard limit)
 */
import { Worker, Queue } from 'bullmq';
import { getRedisConnection } from './connection';
import { cleanupAuditLogs, getAuditLogStats } from '../audit-cleanup';
// Audit cleanup queue name
export const AUDIT_CLEANUP_QUEUE_NAME = 'auditCleanupQueue';
// Singleton instances
let auditCleanupQueue = null;
let auditCleanupWorker = null;
/**
 * Get or create the audit cleanup queue
 */
export function getAuditCleanupQueue() {
    if (!auditCleanupQueue) {
        auditCleanupQueue = new Queue(AUDIT_CLEANUP_QUEUE_NAME, {
            connection: getRedisConnection(),
            defaultJobOptions: {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 60000, // 1 minute initial delay
                },
                removeOnComplete: {
                    age: 7 * 24 * 60 * 60, // Keep completed jobs for 7 days
                    count: 100,
                },
                removeOnFail: {
                    age: 30 * 24 * 60 * 60, // Keep failed jobs for 30 days
                },
            },
        });
    }
    return auditCleanupQueue;
}
/**
 * Process audit cleanup job
 */
async function processAuditCleanupJob(job) {
    console.log(`[AuditCleanupWorker] Starting job ${job.id}`);
    // Get stats before cleanup
    const statsBefore = await getAuditLogStats();
    console.log(`[AuditCleanupWorker] Stats before cleanup: ${statsBefore.totalCount} total logs, ${statsBefore.logsToDelete} to delete`);
    // Run cleanup
    const result = await cleanupAuditLogs();
    if (result.error) {
        throw new Error(result.error);
    }
    console.log(`[AuditCleanupWorker] Job ${job.id} completed: deleted ${result.deletedCount} logs older than ${result.retentionDays} days`);
    return {
        ...result,
        completedAt: new Date(),
    };
}
/**
 * Start the audit cleanup worker
 */
export function startAuditCleanupWorker() {
    if (auditCleanupWorker) {
        return auditCleanupWorker;
    }
    auditCleanupWorker = new Worker(AUDIT_CLEANUP_QUEUE_NAME, async (job) => {
        return await processAuditCleanupJob(job);
    }, {
        connection: getRedisConnection(),
        concurrency: 1, // Only one cleanup job at a time
    });
    auditCleanupWorker.on('completed', (job, result) => {
        console.log(`[AuditCleanupWorker] Job ${job.id} completed: deleted ${result.deletedCount} logs`);
    });
    auditCleanupWorker.on('failed', (job, err) => {
        console.error(`[AuditCleanupWorker] Job ${job?.id} failed:`, err.message);
    });
    console.log('[AuditCleanupWorker] Started');
    return auditCleanupWorker;
}
/**
 * Stop the audit cleanup worker
 */
export async function stopAuditCleanupWorker() {
    if (auditCleanupWorker) {
        await auditCleanupWorker.close();
        auditCleanupWorker = null;
    }
    if (auditCleanupQueue) {
        await auditCleanupQueue.close();
        auditCleanupQueue = null;
    }
    console.log('[AuditCleanupWorker] Stopped');
}
/**
 * Schedule recurring audit cleanup
 * Default: Daily at 3:00 AM
 * Uses diff-based approach to avoid duplicate registrations.
 */
export async function scheduleAuditCleanupJob(cronPattern = '0 3 * * *') {
    const queue = getAuditCleanupQueue();
    // Check if schedule already exists with same pattern
    const repeatableJobs = await queue.getRepeatableJobs();
    const existingJob = repeatableJobs.find((job) => job.name === 'audit-cleanup-scheduled' && job.pattern === cronPattern);
    if (existingJob) {
        // Already scheduled with same pattern, nothing to do
        console.log('[AuditCleanupWorker] Audit cleanup job already scheduled');
        return;
    }
    // Remove any existing audit cleanup schedules with different patterns
    for (const job of repeatableJobs) {
        if (job.name === 'audit-cleanup-scheduled') {
            await queue.removeRepeatableByKey(job.key);
        }
    }
    // Add new repeatable job
    await queue.add('audit-cleanup-scheduled', { triggeredBy: 'scheduled' }, {
        repeat: {
            pattern: cronPattern,
        },
        jobId: 'audit-cleanup-scheduled',
    });
    console.log(`[AuditCleanupWorker] Scheduled audit cleanup job with cron: ${cronPattern}`);
}
/**
 * Trigger immediate audit cleanup
 */
export async function triggerAuditCleanupNow() {
    const queue = getAuditCleanupQueue();
    const job = await queue.add(`audit-cleanup-immediate-${Date.now()}`, {
        triggeredBy: 'manual',
    });
    console.log(`[AuditCleanupWorker] Triggered immediate audit cleanup, job: ${job.id}`);
    return job.id || '';
}
/**
 * Check if audit cleanup worker is running
 */
export function isAuditCleanupWorkerRunning() {
    return auditCleanupWorker !== null && auditCleanupWorker.isRunning();
}
/**
 * Get the current scheduled cleanup info
 */
export async function getAuditCleanupScheduleInfo() {
    const queue = getAuditCleanupQueue();
    const repeatableJobs = await queue.getRepeatableJobs();
    const scheduledJob = repeatableJobs.find((job) => job.name === 'audit-cleanup-scheduled');
    if (!scheduledJob) {
        return {
            isScheduled: false,
            cronPattern: null,
            nextRun: null,
        };
    }
    return {
        isScheduled: true,
        cronPattern: scheduledJob.pattern || null,
        nextRun: scheduledJob.next ? new Date(scheduledJob.next) : null,
    };
}
