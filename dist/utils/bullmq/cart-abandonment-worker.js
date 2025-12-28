/**
 * Cart Abandonment Detection Worker
 *
 * BullMQ worker that periodically checks for abandoned carts
 * and fires abandoned_cart events for matching customers.
 */
import { Worker, Queue } from 'bullmq';
import { getRedisConnection } from './connection';
import prisma from '../prisma';
import { enrollInMatchingFlows } from '../flow-matcher';
// Queue name
export const CART_ABANDONMENT_QUEUE_NAME = 'cartAbandonmentQueue';
// Singleton instances
let cartAbandonmentQueue = null;
let cartAbandonmentWorker = null;
/**
 * Get or create the cart abandonment queue
 */
export function getCartAbandonmentQueue() {
    if (!cartAbandonmentQueue) {
        cartAbandonmentQueue = new Queue(CART_ABANDONMENT_QUEUE_NAME, {
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
    return cartAbandonmentQueue;
}
/**
 * Detect abandoned carts and fire events
 */
async function detectAbandonedCarts(timeoutMins) {
    const result = {
        checked: 0,
        abandoned: 0,
        flowsTriggered: 0,
    };
    // Calculate the cutoff time (events older than this are candidates for abandonment)
    const cutoffTime = new Date(Date.now() - timeoutMins * 60 * 1000);
    // Find the recent window - don't look at events older than 7 days
    const maxLookbackTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    // Find customers with add_to_cart events within the window
    // who haven't placed an order since their last cart activity
    // and haven't already been flagged for abandonment
    // Step 1: Get all add_to_cart events in the window that are old enough
    const cartEvents = await prisma.customerEvent.findMany({
        where: {
            eventType: {
                in: ['add_to_cart', 'cart_updated', 'checkout_started'],
            },
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
    // Group by customer, keeping only the most recent cart event
    const customerCartEvents = new Map();
    for (const event of cartEvents) {
        if (!customerCartEvents.has(event.customerId)) {
            customerCartEvents.set(event.customerId, event);
        }
    }
    result.checked = customerCartEvents.size;
    console.log(`[CartAbandonmentWorker] Checking ${result.checked} customers with cart activity`);
    // Step 2: For each customer, check if they:
    // a) Placed an order after their cart event
    // b) Already have an abandoned_cart event after their cart event
    for (const [customerId, cartEvent] of customerCartEvents) {
        // Check for order after cart event
        const orderAfterCart = await prisma.order.findFirst({
            where: {
                customerId,
                purchasedAt: {
                    gte: cartEvent.createdAt,
                },
            },
            select: { id: true },
        });
        if (orderAfterCart) {
            // Customer completed purchase, not abandoned
            continue;
        }
        // Check if we already fired an abandoned_cart event for this cart session
        const existingAbandonEvent = await prisma.customerEvent.findFirst({
            where: {
                customerId,
                eventType: 'abandoned_cart',
                createdAt: {
                    gte: cartEvent.createdAt,
                },
            },
            select: { id: true },
        });
        if (existingAbandonEvent) {
            // Already processed this cart abandonment
            continue;
        }
        // This is a new abandonment - fire the event
        console.log(`[CartAbandonmentWorker] Detected abandoned cart for customer ${customerId}`);
        // Create the abandoned_cart event
        const abandonmentEvent = await prisma.customerEvent.create({
            data: {
                customerId,
                eventType: 'abandoned_cart',
                eventData: {
                    source: 'internal_detection',
                    originalCartEventId: cartEvent.id,
                    cartCreatedAt: cartEvent.createdAt.toISOString(),
                    detectedAt: new Date().toISOString(),
                    timeoutMins,
                    ...(cartEvent.eventData || {}),
                },
            },
        });
        result.abandoned++;
        // Trigger flow enrollment
        const enrollment = await enrollInMatchingFlows(customerId, 'abandoned_cart', abandonmentEvent.eventData, abandonmentEvent.id);
        result.flowsTriggered += enrollment.flowsTriggered;
    }
    return result;
}
/**
 * Process cart abandonment job
 */
async function processCartAbandonmentJob(job) {
    console.log(`[CartAbandonmentWorker] Starting job ${job.id}`);
    // Get settings
    const settings = await prisma.settings.findFirst();
    const timeoutMins = job.data.timeoutMins || settings?.cartAbandonmentTimeoutMins || 60;
    const result = await detectAbandonedCarts(timeoutMins);
    console.log(`[CartAbandonmentWorker] Job ${job.id} completed: checked ${result.checked}, abandoned ${result.abandoned}, flows triggered ${result.flowsTriggered}`);
    return result;
}
/**
 * Start the cart abandonment worker
 */
export function startCartAbandonmentWorker() {
    if (cartAbandonmentWorker) {
        return cartAbandonmentWorker;
    }
    cartAbandonmentWorker = new Worker(CART_ABANDONMENT_QUEUE_NAME, async (job) => {
        return processCartAbandonmentJob(job);
    }, {
        connection: getRedisConnection(),
        concurrency: 1, // Only one job at a time
    });
    cartAbandonmentWorker.on('completed', (job, result) => {
        console.log(`[CartAbandonmentWorker] Job ${job.id} completed: ${result.abandoned} abandonments detected`);
    });
    cartAbandonmentWorker.on('failed', (job, err) => {
        console.error(`[CartAbandonmentWorker] Job ${job?.id} failed:`, err.message);
    });
    console.log('[CartAbandonmentWorker] Started');
    return cartAbandonmentWorker;
}
/**
 * Stop the cart abandonment worker
 */
export async function stopCartAbandonmentWorker() {
    if (cartAbandonmentWorker) {
        await cartAbandonmentWorker.close();
        cartAbandonmentWorker = null;
    }
    if (cartAbandonmentQueue) {
        await cartAbandonmentQueue.close();
        cartAbandonmentQueue = null;
    }
    console.log('[CartAbandonmentWorker] Stopped');
}
/**
 * Schedule recurring cart abandonment detection
 * Uses diff-based approach to avoid duplicate registrations.
 */
export async function scheduleCartAbandonmentJob(cronPattern) {
    const queue = getCartAbandonmentQueue();
    // Check if schedule already exists with same pattern
    const repeatableJobs = await queue.getRepeatableJobs();
    const existingJob = repeatableJobs.find((job) => job.name === 'cart-abandonment-scheduled' && job.pattern === cronPattern);
    if (existingJob) {
        // Already scheduled with same pattern, nothing to do
        console.log(`[CartAbandonmentWorker] Schedule already exists with cron: ${cronPattern}`);
        return;
    }
    // Remove any existing schedules with different patterns
    for (const job of repeatableJobs) {
        if (job.name === 'cart-abandonment-scheduled') {
            await queue.removeRepeatableByKey(job.key);
            console.log(`[CartAbandonmentWorker] Removed old schedule: ${job.pattern}`);
        }
    }
    // Add new repeatable job
    await queue.add('cart-abandonment-scheduled', {}, {
        repeat: {
            pattern: cronPattern,
        },
        jobId: 'cart-abandonment-scheduled',
    });
    console.log(`[CartAbandonmentWorker] Scheduled job with cron: ${cronPattern}`);
}
/**
 * Remove the cart abandonment schedule
 */
export async function removeCartAbandonmentSchedule() {
    const queue = getCartAbandonmentQueue();
    const repeatableJobs = await queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        if (job.name === 'cart-abandonment-scheduled') {
            await queue.removeRepeatableByKey(job.key);
            console.log(`[CartAbandonmentWorker] Removed schedule: ${job.pattern}`);
        }
    }
}
/**
 * Trigger immediate cart abandonment detection
 */
export async function triggerCartAbandonmentNow(timeoutMins) {
    const queue = getCartAbandonmentQueue();
    const job = await queue.add(`cart-abandonment-immediate-${Date.now()}`, { timeoutMins });
    console.log(`[CartAbandonmentWorker] Triggered immediate detection, job: ${job.id}`);
    return job.id || '';
}
/**
 * Check if cart abandonment worker is running
 */
export function isCartAbandonmentWorkerRunning() {
    return cartAbandonmentWorker !== null && cartAbandonmentWorker.isRunning();
}
/**
 * Get schedule info for cart abandonment
 */
export async function getCartAbandonmentScheduleInfo() {
    const settings = await prisma.settings.findFirst();
    const enabled = settings?.cartAbandonmentEnabled ?? false;
    if (!enabled) {
        return { enabled: false, cronPattern: null, nextRun: null };
    }
    const queue = getCartAbandonmentQueue();
    const repeatableJobs = await queue.getRepeatableJobs();
    const job = repeatableJobs.find((j) => j.name === 'cart-abandonment-scheduled');
    if (!job) {
        return { enabled: true, cronPattern: null, nextRun: null };
    }
    return {
        enabled: true,
        cronPattern: job.pattern || null,
        nextRun: job.next ? new Date(job.next) : null,
    };
}
