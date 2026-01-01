import { Queue, Worker } from 'bullmq';
import prisma from '../prisma';
import { createAuditLog, AuditActions } from '../audit';
import { calculateAllPredictions, calculateCustomerPrediction, savePrediction, } from '../prediction-calculator';
const QUEUE_NAME = 'prediction-calculation';
let queue = null;
let worker = null;
export function getPredictionQueue() {
    if (!queue) {
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        const url = new URL(redisUrl);
        queue = new Queue(QUEUE_NAME, {
            connection: {
                host: url.hostname,
                port: parseInt(url.port) || 6379,
                password: url.password || undefined,
            },
        });
    }
    return queue;
}
const DEFAULT_PREDICTION_CRON = '0 2 * * *';
function isValidCron(cron) {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5)
        return false;
    const validChars = /^[\d,\-\*\/]+$/;
    return parts.every((part) => validChars.test(part));
}
export async function schedulePredictionJob(cron) {
    const q = getPredictionQueue();
    let validCron = cron;
    if (!isValidCron(cron)) {
        console.warn(`[PredictionWorker] Invalid cron expression "${cron}", using default: ${DEFAULT_PREDICTION_CRON}`);
        validCron = DEFAULT_PREDICTION_CRON;
    }
    const existingJobs = await q.getRepeatableJobs();
    for (const job of existingJobs) {
        if (job.name === 'daily-prediction') {
            await q.removeRepeatableByKey(job.key);
        }
    }
    try {
        await q.add('daily-prediction', { batchSize: 100 }, {
            repeat: {
                pattern: validCron,
            },
            removeOnComplete: { count: 10 },
            removeOnFail: { count: 50 },
        });
        console.log(`[PredictionWorker] Scheduled daily prediction job with cron: ${validCron}`);
    }
    catch (error) {
        console.error(`[PredictionWorker] Failed to schedule prediction job with cron "${validCron}":`, error);
        if (validCron !== DEFAULT_PREDICTION_CRON) {
            console.log(`[PredictionWorker] Retrying with default cron: ${DEFAULT_PREDICTION_CRON}`);
            await q.add('daily-prediction', { batchSize: 100 }, {
                repeat: {
                    pattern: DEFAULT_PREDICTION_CRON,
                },
                removeOnComplete: { count: 10 },
                removeOnFail: { count: 50 },
            });
            console.log(`[PredictionWorker] Scheduled with default cron: ${DEFAULT_PREDICTION_CRON}`);
        }
    }
}
export async function removePredictionSchedule() {
    const q = getPredictionQueue();
    const existingJobs = await q.getRepeatableJobs();
    for (const job of existingJobs) {
        if (job.name === 'daily-prediction') {
            await q.removeRepeatableByKey(job.key);
        }
    }
    console.log('[PredictionWorker] Removed prediction schedule');
}
export async function triggerPredictionCalculation(customerId) {
    const q = getPredictionQueue();
    const job = await q.add(customerId ? 'single-customer' : 'manual-trigger', { batchSize: 100, customerId }, {
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
    });
    return { jobId: job.id ?? 'unknown' };
}
async function processPredictionJob(job) {
    const startTime = Date.now();
    const { batchSize = 100, customerId } = job.data;
    console.log(`[PredictionWorker] Starting prediction calculation job ${job.id}`);
    const settings = await prisma.settings.findFirst();
    if (!settings?.predictionsEnabled) {
        console.log('[PredictionWorker] Predictions disabled, skipping');
        return {
            jobId: job.id ?? 'unknown',
            total: 0,
            calculated: 0,
            skipped: 0,
            failed: 0,
            duration: Date.now() - startTime,
        };
    }
    const config = {
        minOrders: settings.predictionMinOrders,
        minMessages: settings.predictionMinMessages,
        lookbackDays: settings.predictionLookbackDays,
        batchSize,
    };
    let result;
    if (customerId) {
        try {
            const prediction = await calculateCustomerPrediction(customerId, config);
            await savePrediction(prediction);
            result = {
                total: 1,
                calculated: 1,
                skipped: 0,
                failed: 0,
                duration: Date.now() - startTime,
            };
        }
        catch (error) {
            console.error(`[PredictionWorker] Failed to calculate for customer ${customerId}:`, error);
            result = {
                total: 1,
                calculated: 0,
                skipped: 0,
                failed: 1,
                duration: Date.now() - startTime,
            };
        }
    }
    else {
        result = await calculateAllPredictions(config);
    }
    await createAuditLog({
        action: AuditActions.settings.updated,
        resourceType: 'prediction',
        resourceId: job.id ?? 'batch',
        metadata: {
            jobName: job.name,
            total: result.total,
            calculated: result.calculated,
            skipped: result.skipped,
            failed: result.failed,
            durationMs: result.duration,
        },
        context: {},
    });
    console.log(`[PredictionWorker] Completed: ${result.calculated}/${result.total} calculated, ` +
        `${result.skipped} skipped, ${result.failed} failed in ${result.duration}ms`);
    return {
        jobId: job.id ?? 'unknown',
        ...result,
    };
}
export function startPredictionWorker() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const url = new URL(redisUrl);
    worker = new Worker(QUEUE_NAME, processPredictionJob, {
        connection: {
            host: url.hostname,
            port: parseInt(url.port) || 6379,
            password: url.password || undefined,
        },
        concurrency: 1,
    });
    worker.on('completed', (job) => {
        console.log(`[PredictionWorker] Job ${job.id} completed`);
    });
    worker.on('failed', (job, error) => {
        console.error(`[PredictionWorker] Job ${job?.id} failed:`, error);
    });
    worker.on('error', (error) => {
        console.error('[PredictionWorker] Worker error:', error);
    });
    console.log('[PredictionWorker] Worker started');
    return worker;
}
export async function stopPredictionWorker() {
    if (worker) {
        await worker.close();
        worker = null;
    }
    if (queue) {
        await queue.close();
        queue = null;
    }
    console.log('[PredictionWorker] Worker stopped');
}
export async function getPredictionJobStatus() {
    const q = getPredictionQueue();
    const repeatableJobs = await q.getRepeatableJobs();
    const scheduledJob = repeatableJobs.find((j) => j.name === 'daily-prediction');
    const counts = await q.getJobCounts();
    return {
        isScheduled: !!scheduledJob,
        cronPattern: scheduledJob?.pattern ?? null,
        nextRun: scheduledJob?.next ? new Date(scheduledJob.next) : null,
        activeJobs: counts.active ?? 0,
        waitingJobs: counts.waiting ?? 0,
        completedJobs: counts.completed ?? 0,
        failedJobs: counts.failed ?? 0,
    };
}
export async function initializePredictionWorker() {
    try {
        const settings = await prisma.settings.findFirst();
        startPredictionWorker();
        if (settings?.predictionsEnabled) {
            const cron = settings.predictionCalculationCron || DEFAULT_PREDICTION_CRON;
            await schedulePredictionJob(cron);
        }
        console.log('[PredictionWorker] Initialization complete');
    }
    catch (error) {
        console.error('[PredictionWorker] Failed to initialize prediction worker:', error);
        console.warn('[PredictionWorker] Prediction calculations will be unavailable until the issue is resolved');
    }
}
