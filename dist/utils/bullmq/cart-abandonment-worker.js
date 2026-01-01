import { Worker, Queue } from 'bullmq';
import { getRedisConnection } from './connection';
import prisma from '../prisma';
import { enrollInMatchingFlows } from '../flow-matcher';
export const CART_ABANDONMENT_QUEUE_NAME = 'cartAbandonmentQueue';
let cartAbandonmentQueue = null;
let cartAbandonmentWorker = null;
export function getCartAbandonmentQueue() {
    if (!cartAbandonmentQueue) {
        cartAbandonmentQueue = new Queue(CART_ABANDONMENT_QUEUE_NAME, {
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
    return cartAbandonmentQueue;
}
async function detectAbandonedCarts(timeoutMins) {
    const result = {
        checked: 0,
        abandoned: 0,
        flowsTriggered: 0,
    };
    const cutoffTime = new Date(Date.now() - timeoutMins * 60 * 1000);
    const maxLookbackTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const cartEvents = await prisma.customerEvent.findMany({
        where: {
            eventType: {
                in: ['add_to_cart', 'cart_updated', 'checkout_started'],
            },
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
    const customerCartEvents = new Map();
    for (const event of cartEvents) {
        if (!customerCartEvents.has(event.customerId)) {
            customerCartEvents.set(event.customerId, event);
        }
    }
    result.checked = customerCartEvents.size;
    console.log(`[CartAbandonmentWorker] Checking ${result.checked} customers with cart activity`);
    for (const [customerId, cartEvent] of customerCartEvents) {
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
            continue;
        }
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
            continue;
        }
        console.log(`[CartAbandonmentWorker] Detected abandoned cart for customer ${customerId}`);
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
        const enrollment = await enrollInMatchingFlows(customerId, 'abandoned_cart', abandonmentEvent.eventData, abandonmentEvent.id);
        result.flowsTriggered += enrollment.flowsTriggered;
    }
    return result;
}
async function processCartAbandonmentJob(job) {
    console.log(`[CartAbandonmentWorker] Starting job ${job.id}`);
    const settings = await prisma.settings.findFirst();
    const timeoutMins = job.data.timeoutMins || settings?.cartAbandonmentTimeoutMins || 60;
    const result = await detectAbandonedCarts(timeoutMins);
    console.log(`[CartAbandonmentWorker] Job ${job.id} completed: checked ${result.checked}, abandoned ${result.abandoned}, flows triggered ${result.flowsTriggered}`);
    return result;
}
export function startCartAbandonmentWorker() {
    if (cartAbandonmentWorker) {
        return cartAbandonmentWorker;
    }
    cartAbandonmentWorker = new Worker(CART_ABANDONMENT_QUEUE_NAME, async (job) => {
        return processCartAbandonmentJob(job);
    }, {
        connection: getRedisConnection(),
        concurrency: 1,
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
export async function scheduleCartAbandonmentJob(cronPattern) {
    const queue = getCartAbandonmentQueue();
    const repeatableJobs = await queue.getRepeatableJobs();
    const existingJob = repeatableJobs.find((job) => job.name === 'cart-abandonment-scheduled' && job.pattern === cronPattern);
    if (existingJob) {
        console.log(`[CartAbandonmentWorker] Schedule already exists with cron: ${cronPattern}`);
        return;
    }
    for (const job of repeatableJobs) {
        if (job.name === 'cart-abandonment-scheduled') {
            await queue.removeRepeatableByKey(job.key);
            console.log(`[CartAbandonmentWorker] Removed old schedule: ${job.pattern}`);
        }
    }
    await queue.add('cart-abandonment-scheduled', {}, {
        repeat: {
            pattern: cronPattern,
        },
        jobId: 'cart-abandonment-scheduled',
    });
    console.log(`[CartAbandonmentWorker] Scheduled job with cron: ${cronPattern}`);
}
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
export async function triggerCartAbandonmentNow(timeoutMins) {
    const queue = getCartAbandonmentQueue();
    const job = await queue.add(`cart-abandonment-immediate-${Date.now()}`, { timeoutMins });
    console.log(`[CartAbandonmentWorker] Triggered immediate detection, job: ${job.id}`);
    return job.id || '';
}
export function isCartAbandonmentWorkerRunning() {
    return cartAbandonmentWorker !== null && cartAbandonmentWorker.isRunning();
}
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
