import { Worker, Queue } from 'bullmq';
import { getRedisConnection } from './connection';
import prisma from '../prisma';
import { enrollInMatchingFlows } from '../flow-matcher';
export const BROWSE_ABANDONMENT_QUEUE_NAME = 'browseAbandonmentQueue';
let browseAbandonmentQueue = null;
let browseAbandonmentWorker = null;
export function getBrowseAbandonmentQueue() {
    if (!browseAbandonmentQueue) {
        browseAbandonmentQueue = new Queue(BROWSE_ABANDONMENT_QUEUE_NAME, {
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
    return browseAbandonmentQueue;
}
async function detectBrowseAbandonment(timeoutMins) {
    const result = {
        checked: 0,
        abandoned: 0,
        flowsTriggered: 0,
    };
    const cutoffTime = new Date(Date.now() - timeoutMins * 60 * 1000);
    const maxLookbackTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const viewEvents = await prisma.customerEvent.findMany({
        where: {
            eventType: 'product_viewed',
            createdAt: {
                gte: maxLookbackTime,
                lte: cutoffTime,
            },
        },
        select: {
            id: true,
            customerId: true,
            createdAt: true,
            eventData: true,
        },
        orderBy: {
            createdAt: 'desc',
        },
    });
    const customerProductViews = new Map();
    for (const event of viewEvents) {
        const eventData = event.eventData;
        const productId = eventData?.productId;
        if (!productId)
            continue;
        const key = `${event.customerId}_${productId}`;
        if (!customerProductViews.has(key)) {
            customerProductViews.set(key, event);
        }
    }
    result.checked = customerProductViews.size;
    console.log(`[BrowseAbandonmentWorker] Checking ${result.checked} product views`);
    for (const [, viewEvent] of customerProductViews) {
        const customerId = viewEvent.customerId;
        const eventData = viewEvent.eventData;
        const productId = eventData?.productId;
        const cartEventAfterView = await prisma.customerEvent.findFirst({
            where: {
                customerId,
                eventType: {
                    in: ['add_to_cart', 'cart_updated', 'checkout_started'],
                },
                createdAt: {
                    gte: viewEvent.createdAt,
                },
            },
            select: { id: true },
        });
        if (cartEventAfterView) {
            continue;
        }
        const orderAfterView = await prisma.order.findFirst({
            where: {
                customerId,
                purchasedAt: {
                    gte: viewEvent.createdAt,
                },
            },
            select: { id: true },
        });
        if (orderAfterView) {
            continue;
        }
        const existingAbandonEvent = await prisma.customerEvent.findFirst({
            where: {
                customerId,
                eventType: 'browse_abandoned',
                createdAt: {
                    gte: viewEvent.createdAt,
                },
            },
            select: { id: true, eventData: true },
        });
        if (existingAbandonEvent) {
            const existingEventData = existingAbandonEvent.eventData;
            if (existingEventData?.originalViewEventId === viewEvent.id) {
                continue;
            }
        }
        console.log(`[BrowseAbandonmentWorker] Detected browse abandonment for customer ${customerId}, product ${productId}`);
        const abandonmentEvent = await prisma.customerEvent.create({
            data: {
                customerId,
                eventType: 'browse_abandoned',
                eventData: {
                    source: 'internal_detection',
                    originalViewEventId: viewEvent.id,
                    productViewedAt: viewEvent.createdAt.toISOString(),
                    detectedAt: new Date().toISOString(),
                    timeoutMins,
                    ...(viewEvent.eventData || {}),
                },
            },
        });
        result.abandoned++;
        const enrollment = await enrollInMatchingFlows(customerId, 'browse_abandoned', abandonmentEvent.eventData, abandonmentEvent.id);
        result.flowsTriggered += enrollment.flowsTriggered;
    }
    return result;
}
async function processBrowseAbandonmentJob(job) {
    console.log(`[BrowseAbandonmentWorker] Starting job ${job.id}`);
    const settings = await prisma.settings.findFirst();
    const timeoutMins = job.data.timeoutMins || settings?.browseAbandonmentTimeoutMins || 120;
    const result = await detectBrowseAbandonment(timeoutMins);
    console.log(`[BrowseAbandonmentWorker] Job ${job.id} completed: checked ${result.checked}, abandoned ${result.abandoned}, flows triggered ${result.flowsTriggered}`);
    return result;
}
export function startBrowseAbandonmentWorker() {
    if (browseAbandonmentWorker) {
        return browseAbandonmentWorker;
    }
    browseAbandonmentWorker = new Worker(BROWSE_ABANDONMENT_QUEUE_NAME, async (job) => {
        return processBrowseAbandonmentJob(job);
    }, {
        connection: getRedisConnection(),
        concurrency: 1,
    });
    browseAbandonmentWorker.on('completed', (job, result) => {
        console.log(`[BrowseAbandonmentWorker] Job ${job.id} completed: ${result.abandoned} abandonments detected`);
    });
    browseAbandonmentWorker.on('failed', (job, err) => {
        console.error(`[BrowseAbandonmentWorker] Job ${job?.id} failed:`, err.message);
    });
    console.log('[BrowseAbandonmentWorker] Started');
    return browseAbandonmentWorker;
}
export async function stopBrowseAbandonmentWorker() {
    if (browseAbandonmentWorker) {
        await browseAbandonmentWorker.close();
        browseAbandonmentWorker = null;
    }
    if (browseAbandonmentQueue) {
        await browseAbandonmentQueue.close();
        browseAbandonmentQueue = null;
    }
    console.log('[BrowseAbandonmentWorker] Stopped');
}
export async function scheduleBrowseAbandonmentJob(cronPattern) {
    const queue = getBrowseAbandonmentQueue();
    const repeatableJobs = await queue.getRepeatableJobs();
    const existingJob = repeatableJobs.find((job) => job.name === 'browse-abandonment-scheduled' && job.pattern === cronPattern);
    if (existingJob) {
        console.log(`[BrowseAbandonmentWorker] Schedule already exists with cron: ${cronPattern}`);
        return;
    }
    for (const job of repeatableJobs) {
        if (job.name === 'browse-abandonment-scheduled') {
            await queue.removeRepeatableByKey(job.key);
            console.log(`[BrowseAbandonmentWorker] Removed old schedule: ${job.pattern}`);
        }
    }
    await queue.add('browse-abandonment-scheduled', {}, {
        repeat: {
            pattern: cronPattern,
        },
        jobId: 'browse-abandonment-scheduled',
    });
    console.log(`[BrowseAbandonmentWorker] Scheduled job with cron: ${cronPattern}`);
}
export async function removeBrowseAbandonmentSchedule() {
    const queue = getBrowseAbandonmentQueue();
    const repeatableJobs = await queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        if (job.name === 'browse-abandonment-scheduled') {
            await queue.removeRepeatableByKey(job.key);
            console.log(`[BrowseAbandonmentWorker] Removed schedule: ${job.pattern}`);
        }
    }
}
export async function triggerBrowseAbandonmentNow(timeoutMins) {
    const queue = getBrowseAbandonmentQueue();
    const job = await queue.add(`browse-abandonment-immediate-${Date.now()}`, { timeoutMins });
    console.log(`[BrowseAbandonmentWorker] Triggered immediate detection, job: ${job.id}`);
    return job.id || '';
}
export function isBrowseAbandonmentWorkerRunning() {
    return browseAbandonmentWorker !== null && browseAbandonmentWorker.isRunning();
}
export async function getBrowseAbandonmentScheduleInfo() {
    const settings = await prisma.settings.findFirst();
    const enabled = settings?.browseAbandonmentEnabled ?? false;
    if (!enabled) {
        return { enabled: false, cronPattern: null, nextRun: null };
    }
    const queue = getBrowseAbandonmentQueue();
    const repeatableJobs = await queue.getRepeatableJobs();
    const job = repeatableJobs.find((j) => j.name === 'browse-abandonment-scheduled');
    if (!job) {
        return { enabled: true, cronPattern: null, nextRun: null };
    }
    return {
        enabled: true,
        cronPattern: job.pattern || null,
        nextRun: job.next ? new Date(job.next) : null,
    };
}
