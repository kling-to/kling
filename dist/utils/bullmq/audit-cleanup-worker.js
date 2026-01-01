import { Worker, Queue } from 'bullmq';
import { getRedisConnection } from './connection';
import { cleanupAuditLogs, getAuditLogStats } from '../audit-cleanup';
export const AUDIT_CLEANUP_QUEUE_NAME = 'auditCleanupQueue';
let auditCleanupQueue = null;
let auditCleanupWorker = null;
export function getAuditCleanupQueue() {
    if (!auditCleanupQueue) {
        auditCleanupQueue = new Queue(AUDIT_CLEANUP_QUEUE_NAME, {
            connection: getRedisConnection(),
            defaultJobOptions: {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 60000,
                },
                removeOnComplete: {
                    age: 7 * 24 * 60 * 60,
                    count: 100,
                },
                removeOnFail: {
                    age: 30 * 24 * 60 * 60,
                },
            },
        });
    }
    return auditCleanupQueue;
}
async function processAuditCleanupJob(job) {
    console.log(`[AuditCleanupWorker] Starting job ${job.id}`);
    const statsBefore = await getAuditLogStats();
    console.log(`[AuditCleanupWorker] Stats before cleanup: ${statsBefore.totalCount} total logs, ${statsBefore.logsToDelete} to delete`);
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
export function startAuditCleanupWorker() {
    if (auditCleanupWorker) {
        return auditCleanupWorker;
    }
    auditCleanupWorker = new Worker(AUDIT_CLEANUP_QUEUE_NAME, async (job) => {
        return await processAuditCleanupJob(job);
    }, {
        connection: getRedisConnection(),
        concurrency: 1,
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
export async function scheduleAuditCleanupJob(cronPattern = '0 3 * * *') {
    const queue = getAuditCleanupQueue();
    const repeatableJobs = await queue.getRepeatableJobs();
    const existingJob = repeatableJobs.find((job) => job.name === 'audit-cleanup-scheduled' && job.pattern === cronPattern);
    if (existingJob) {
        console.log('[AuditCleanupWorker] Audit cleanup job already scheduled');
        return;
    }
    for (const job of repeatableJobs) {
        if (job.name === 'audit-cleanup-scheduled') {
            await queue.removeRepeatableByKey(job.key);
        }
    }
    await queue.add('audit-cleanup-scheduled', { triggeredBy: 'scheduled' }, {
        repeat: {
            pattern: cronPattern,
        },
        jobId: 'audit-cleanup-scheduled',
    });
    console.log(`[AuditCleanupWorker] Scheduled audit cleanup job with cron: ${cronPattern}`);
}
export async function triggerAuditCleanupNow() {
    const queue = getAuditCleanupQueue();
    const job = await queue.add(`audit-cleanup-immediate-${Date.now()}`, {
        triggeredBy: 'manual',
    });
    console.log(`[AuditCleanupWorker] Triggered immediate audit cleanup, job: ${job.id}`);
    return job.id || '';
}
export function isAuditCleanupWorkerRunning() {
    return auditCleanupWorker !== null && auditCleanupWorker.isRunning();
}
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
