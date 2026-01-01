import { Worker, Queue } from 'bullmq';
import { getRedisConnection } from './connection';
import { autoTuneAllCampaigns, DEFAULT_AUTO_TUNE_CONFIG } from '../auto-tune';
export const AUTO_TUNE_QUEUE_NAME = 'autoTuneQueue';
let autoTuneQueue = null;
let autoTuneWorker = null;
export function getAutoTuneQueue() {
    if (!autoTuneQueue) {
        autoTuneQueue = new Queue(AUTO_TUNE_QUEUE_NAME, {
            connection: getRedisConnection(),
            defaultJobOptions: {
                attempts: 1,
                removeOnComplete: {
                    age: 24 * 60 * 60,
                    count: 100,
                },
                removeOnFail: false,
            },
        });
    }
    return autoTuneQueue;
}
async function processAutoTuneJob(job) {
    console.log(`[AutoTuneWorker] Starting job ${job.id}`);
    const config = {
        ...DEFAULT_AUTO_TUNE_CONFIG,
        ...job.data.config,
    };
    const result = await autoTuneAllCampaigns(config);
    console.log(`[AutoTuneWorker] Job ${job.id} completed: evaluated ${result.evaluated}, paused ${result.paused}`);
}
export function startAutoTuneWorker() {
    if (autoTuneWorker) {
        return autoTuneWorker;
    }
    autoTuneWorker = new Worker(AUTO_TUNE_QUEUE_NAME, async (job) => {
        await processAutoTuneJob(job);
    }, {
        connection: getRedisConnection(),
        concurrency: 1,
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
export async function scheduleAutoTuneJob(cronPattern = '0 */6 * * *') {
    const queue = getAutoTuneQueue();
    const repeatableJobs = await queue.getRepeatableJobs();
    const existingJob = repeatableJobs.find((job) => job.name === 'auto-tune-scheduled' && job.pattern === cronPattern);
    if (existingJob) {
        return;
    }
    for (const job of repeatableJobs) {
        if (job.name === 'auto-tune-scheduled') {
            await queue.removeRepeatableByKey(job.key);
        }
    }
    await queue.add('auto-tune-scheduled', {}, {
        repeat: {
            pattern: cronPattern,
        },
        jobId: 'auto-tune-scheduled',
    });
    console.log(`[AutoTuneWorker] Scheduled auto-tune job with cron: ${cronPattern}`);
}
export async function triggerAutoTuneNow(config) {
    const queue = getAutoTuneQueue();
    const job = await queue.add(`auto-tune-immediate-${Date.now()}`, { config });
    console.log(`[AutoTuneWorker] Triggered immediate auto-tune evaluation, job: ${job.id}`);
    return job.id || '';
}
export function isAutoTuneWorkerRunning() {
    return autoTuneWorker !== null && autoTuneWorker.isRunning();
}
