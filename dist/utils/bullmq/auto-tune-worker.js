/**
 * Auto-tune Worker
 *
 * BullMQ worker that periodically evaluates campaign performance
 * and automatically pauses low-performing campaigns.
 */
import { Worker, Queue } from 'bullmq';
import { getRedisConnection } from './connection';
import { autoTuneAllCampaigns, DEFAULT_AUTO_TUNE_CONFIG } from '../auto-tune';
// Auto-tune queue name
export const AUTO_TUNE_QUEUE_NAME = 'autoTuneQueue';
// Singleton instances
let autoTuneQueue = null;
let autoTuneWorker = null;
/**
 * Get or create the auto-tune queue
 */
export function getAutoTuneQueue() {
    if (!autoTuneQueue) {
        autoTuneQueue = new Queue(AUTO_TUNE_QUEUE_NAME, {
            connection: getRedisConnection(),
            defaultJobOptions: {
                attempts: 1,
                removeOnComplete: {
                    age: 24 * 60 * 60, // Keep for 24 hours
                    count: 100,
                },
                removeOnFail: false,
            },
        });
    }
    return autoTuneQueue;
}
/**
 * Process auto-tune job
 */
async function processAutoTuneJob(job) {
    console.log(`[AutoTuneWorker] Starting job ${job.id}`);
    const config = {
        ...DEFAULT_AUTO_TUNE_CONFIG,
        ...job.data.config,
    };
    const result = await autoTuneAllCampaigns(config);
    console.log(`[AutoTuneWorker] Job ${job.id} completed: evaluated ${result.evaluated}, paused ${result.paused}`);
}
/**
 * Start the auto-tune worker
 */
export function startAutoTuneWorker() {
    if (autoTuneWorker) {
        return autoTuneWorker;
    }
    autoTuneWorker = new Worker(AUTO_TUNE_QUEUE_NAME, async (job) => {
        await processAutoTuneJob(job);
    }, {
        connection: getRedisConnection(),
        concurrency: 1, // Only one auto-tune job at a time
    });
    autoTuneWorker.on('completed', (job) => {
        console.log(`[AutoTuneWorker] Job ${job.id} completed successfully`);
    });
    autoTuneWorker.on('failed', (job, err) => {
        console.error(`[AutoTuneWorker] Job ${job?.id} failed:`, err.message);
    });
    console.log('[AutoTuneWorker] Started');
    return autoTuneWorker;
}
/**
 * Stop the auto-tune worker
 */
export async function stopAutoTuneWorker() {
    if (autoTuneWorker) {
        await autoTuneWorker.close();
        autoTuneWorker = null;
    }
    if (autoTuneQueue) {
        await autoTuneQueue.close();
        autoTuneQueue = null;
    }
    console.log('[AutoTuneWorker] Stopped');
}
/**
 * Schedule recurring auto-tune evaluation
 * Runs every 6 hours by default. Uses diff-based approach to avoid duplicate registrations.
 */
export async function scheduleAutoTuneJob(cronPattern = '0 */6 * * *') {
    const queue = getAutoTuneQueue();
    // Check if schedule already exists with same pattern
    const repeatableJobs = await queue.getRepeatableJobs();
    const existingJob = repeatableJobs.find((job) => job.name === 'auto-tune-scheduled' && job.pattern === cronPattern);
    if (existingJob) {
        // Already scheduled with same pattern, nothing to do
        return;
    }
    // Remove any existing auto-tune schedules with different patterns
    for (const job of repeatableJobs) {
        if (job.name === 'auto-tune-scheduled') {
            await queue.removeRepeatableByKey(job.key);
        }
    }
    // Add new repeatable job
    await queue.add('auto-tune-scheduled', {}, {
        repeat: {
            pattern: cronPattern,
        },
        jobId: 'auto-tune-scheduled',
    });
    console.log(`[AutoTuneWorker] Scheduled auto-tune job with cron: ${cronPattern}`);
}
/**
 * Trigger immediate auto-tune evaluation
 */
export async function triggerAutoTuneNow(config) {
    const queue = getAutoTuneQueue();
    const job = await queue.add(`auto-tune-immediate-${Date.now()}`, { config });
    console.log(`[AutoTuneWorker] Triggered immediate auto-tune evaluation, job: ${job.id}`);
    return job.id || '';
}
/**
 * Check if auto-tune worker is running
 */
export function isAutoTuneWorkerRunning() {
    return autoTuneWorker !== null && autoTuneWorker.isRunning();
}
