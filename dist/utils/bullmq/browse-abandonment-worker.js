/**
 * Browse Abandonment Detection Worker
 *
 * BullMQ worker that periodically checks for browse abandonment
 * (product views without add-to-cart or purchase).
 */
import { Worker, Queue } from 'bullmq';
import { getRedisConnection } from './connection';
import prisma from '../prisma';
import { enrollInMatchingFlows } from '../flow-matcher';
// Queue name
export const BROWSE_ABANDONMENT_QUEUE_NAME = 'browseAbandonmentQueue';
// Singleton instances
let browseAbandonmentQueue = null;
let browseAbandonmentWorker = null;
/**
 * Get or create the browse abandonment queue
 */
export function getBrowseAbandonmentQueue() {
    if (!browseAbandonmentQueue) {
        browseAbandonmentQueue = new Queue(BROWSE_ABANDONMENT_QUEUE_NAME, {
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
    return browseAbandonmentQueue;
}
/**
 * Detect browse abandonment and fire events
 */
async function detectBrowseAbandonment(timeoutMins) {
    const result = {
        checked: 0,
        abandoned: 0,
        flowsTriggered: 0,
    };
    // Calculate the cutoff time (events older than this are candidates for abandonment)
    const cutoffTime = new Date(Date.now() - timeoutMins * 60 * 1000);
    // Find the recent window - don't look at events older than 7 days
    const maxLookbackTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    // Step 1: Get all product_viewed events in the window that are old enough
    const viewEvents = await prisma.customerEvent.findMany({
        where: {
            eventType: 'product_viewed',
            createdAt: {
                gte: maxLookbackTime,
                lte: cutoffTime, // Only consider events older than timeout
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
    // Group by customer + productId, keeping only the most recent view per product
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
    // Step 2: For each customer-product pair, check if they:
    // a) Added the product to cart after viewing
    // b) Placed an order after viewing
    // c) Already have a browse_abandoned event for this view
    for (const [, viewEvent] of customerProductViews) {
        const customerId = viewEvent.customerId;
        const eventData = viewEvent.eventData;
        const productId = eventData?.productId;
        // Check for add_to_cart or cart_updated event after view
        const cartEventAfterView = await prisma.customerEvent.findFirst({
            where: {
                customerId,
                eventType: {
                    in: ['add_to_cart', 'cart_updated', 'checkout_started'],
                },
                createdAt: {
                    gte: viewEvent.createdAt,
                },
                // For now, any cart activity cancels browse abandonment
            },
            select: { id: true },
        });
        if (cartEventAfterView) {
            // Customer added something to cart, not abandoned
            continue;
        }
        // Check for order after view
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
            // Customer completed purchase, not abandoned
            continue;
        }
        // Check if we already fired a browse_abandoned event for this view
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
        // Check if the existing event is for the same product
        if (existingAbandonEvent) {
            const existingEventData = existingAbandonEvent.eventData;
            if (existingEventData?.originalViewEventId === viewEvent.id) {
                // Already processed this browse abandonment
                continue;
            }
        }
        // This is a new browse abandonment - fire the event
        console.log(`[BrowseAbandonmentWorker] Detected browse abandonment for customer ${customerId}, product ${productId}`);
        // Create the browse_abandoned event
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
                    // Copy product data from original event
                    ...(viewEvent.eventData || {}),
                },
            },
        });
        result.abandoned++;
        // Trigger flow enrollment
        const enrollment = await enrollInMatchingFlows(customerId, 'browse_abandoned', abandonmentEvent.eventData, abandonmentEvent.id);
        result.flowsTriggered += enrollment.flowsTriggered;
    }
    return result;
}
/**
 * Process browse abandonment job
 */
async function processBrowseAbandonmentJob(job) {
    console.log(`[BrowseAbandonmentWorker] Starting job ${job.id}`);
    // Get settings
    const settings = await prisma.settings.findFirst();
    const timeoutMins = job.data.timeoutMins || settings?.browseAbandonmentTimeoutMins || 120;
    const result = await detectBrowseAbandonment(timeoutMins);
    console.log(`[BrowseAbandonmentWorker] Job ${job.id} completed: checked ${result.checked}, abandoned ${result.abandoned}, flows triggered ${result.flowsTriggered}`);
    return result;
}
/**
 * Start the browse abandonment worker
 */
export function startBrowseAbandonmentWorker() {
    if (browseAbandonmentWorker) {
        return browseAbandonmentWorker;
    }
    browseAbandonmentWorker = new Worker(BROWSE_ABANDONMENT_QUEUE_NAME, async (job) => {
        return processBrowseAbandonmentJob(job);
    }, {
        connection: getRedisConnection(),
        concurrency: 1, // Only one job at a time
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
/**
 * Stop the browse abandonment worker
 */
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
/**
 * Schedule recurring browse abandonment detection
 * Uses diff-based approach to avoid duplicate registrations.
 */
export async function scheduleBrowseAbandonmentJob(cronPattern) {
    const queue = getBrowseAbandonmentQueue();
    // Check if schedule already exists with same pattern
    const repeatableJobs = await queue.getRepeatableJobs();
    const existingJob = repeatableJobs.find((job) => job.name === 'browse-abandonment-scheduled' && job.pattern === cronPattern);
    if (existingJob) {
        // Already scheduled with same pattern, nothing to do
        console.log(`[BrowseAbandonmentWorker] Schedule already exists with cron: ${cronPattern}`);
        return;
    }
    // Remove any existing schedules with different patterns
    for (const job of repeatableJobs) {
        if (job.name === 'browse-abandonment-scheduled') {
            await queue.removeRepeatableByKey(job.key);
            console.log(`[BrowseAbandonmentWorker] Removed old schedule: ${job.pattern}`);
        }
    }
    // Add new repeatable job
    await queue.add('browse-abandonment-scheduled', {}, {
        repeat: {
            pattern: cronPattern,
        },
        jobId: 'browse-abandonment-scheduled',
    });
    console.log(`[BrowseAbandonmentWorker] Scheduled job with cron: ${cronPattern}`);
}
/**
 * Remove the browse abandonment schedule
 */
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
/**
 * Trigger immediate browse abandonment detection
 */
export async function triggerBrowseAbandonmentNow(timeoutMins) {
    const queue = getBrowseAbandonmentQueue();
    const job = await queue.add(`browse-abandonment-immediate-${Date.now()}`, { timeoutMins });
    console.log(`[BrowseAbandonmentWorker] Triggered immediate detection, job: ${job.id}`);
    return job.id || '';
}
/**
 * Check if browse abandonment worker is running
 */
export function isBrowseAbandonmentWorkerRunning() {
    return browseAbandonmentWorker !== null && browseAbandonmentWorker.isRunning();
}
/**
 * Get schedule info for browse abandonment
 */
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
