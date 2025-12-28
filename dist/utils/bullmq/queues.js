/**
 * BullMQ Queue Definitions
 *
 * Defines the campaign queue and dead-letter queue for job processing.
 */
import { Queue, QueueEvents } from 'bullmq';
import { getRedisConnection, defaultJobOptions, QUEUE_NAMES } from './connection';
// Singleton queue instances
let campaignQueue = null;
let customerQueue = null;
let dlq = null;
let flowEnrollmentQueue = null;
let flowStepQueue = null;
let campaignQueueEvents = null;
let customerQueueEvents = null;
/**
 * Get or create the campaign queue
 */
export function getCampaignQueue() {
    if (!campaignQueue) {
        campaignQueue = new Queue(QUEUE_NAMES.CAMPAIGN, {
            connection: getRedisConnection(),
            defaultJobOptions,
        });
    }
    return campaignQueue;
}
/**
 * Get or create the customer queue
 */
export function getCustomerQueue() {
    if (!customerQueue) {
        customerQueue = new Queue(QUEUE_NAMES.CUSTOMER, {
            connection: getRedisConnection(),
            defaultJobOptions: {
                ...defaultJobOptions,
                attempts: 5, // More retries for customer messages
            },
        });
    }
    return customerQueue;
}
/**
 * Get or create the dead-letter queue
 */
export function getDLQ() {
    if (!dlq) {
        dlq = new Queue(QUEUE_NAMES.DLQ, {
            connection: getRedisConnection(),
            defaultJobOptions: {
                removeOnComplete: false, // Keep DLQ jobs for manual review
                removeOnFail: false,
            },
        });
    }
    return dlq;
}
/**
 * Get or create the flow enrollment queue
 */
export function getFlowEnrollmentQueue() {
    if (!flowEnrollmentQueue) {
        flowEnrollmentQueue = new Queue(QUEUE_NAMES.FLOW_ENROLLMENT, {
            connection: getRedisConnection(),
            defaultJobOptions,
        });
    }
    return flowEnrollmentQueue;
}
/**
 * Get or create the flow step queue
 */
export function getFlowStepQueue() {
    if (!flowStepQueue) {
        flowStepQueue = new Queue(QUEUE_NAMES.FLOW_STEP, {
            connection: getRedisConnection(),
            defaultJobOptions: {
                ...defaultJobOptions,
                attempts: 5, // More retries for flow steps
            },
        });
    }
    return flowStepQueue;
}
/**
 * Get campaign queue events for monitoring
 */
export function getCampaignQueueEvents() {
    if (!campaignQueueEvents) {
        campaignQueueEvents = new QueueEvents(QUEUE_NAMES.CAMPAIGN, {
            connection: getRedisConnection(),
        });
    }
    return campaignQueueEvents;
}
/**
 * Get customer queue events for monitoring
 */
export function getCustomerQueueEvents() {
    if (!customerQueueEvents) {
        customerQueueEvents = new QueueEvents(QUEUE_NAMES.CUSTOMER, {
            connection: getRedisConnection(),
        });
    }
    return customerQueueEvents;
}
/**
 * Close all queue connections gracefully
 */
export async function closeAllQueues() {
    const closePromises = [];
    if (campaignQueueEvents) {
        closePromises.push(campaignQueueEvents.close());
        campaignQueueEvents = null;
    }
    if (customerQueueEvents) {
        closePromises.push(customerQueueEvents.close());
        customerQueueEvents = null;
    }
    if (campaignQueue) {
        closePromises.push(campaignQueue.close());
        campaignQueue = null;
    }
    if (customerQueue) {
        closePromises.push(customerQueue.close());
        customerQueue = null;
    }
    if (dlq) {
        closePromises.push(dlq.close());
        dlq = null;
    }
    if (flowEnrollmentQueue) {
        closePromises.push(flowEnrollmentQueue.close());
        flowEnrollmentQueue = null;
    }
    if (flowStepQueue) {
        closePromises.push(flowStepQueue.close());
        flowStepQueue = null;
    }
    await Promise.all(closePromises);
}
/**
 * Get queue metrics for observability
 */
export async function getQueueMetrics() {
    const [campaignCounts, customerCounts, dlqCounts, flowEnrollmentCounts, flowStepCounts] = await Promise.all([
        getCampaignQueue().getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
        getCustomerQueue().getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
        getDLQ().getJobCounts('waiting'),
        getFlowEnrollmentQueue().getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
        getFlowStepQueue().getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
    ]);
    return {
        campaign: {
            waiting: campaignCounts.waiting || 0,
            active: campaignCounts.active || 0,
            completed: campaignCounts.completed || 0,
            failed: campaignCounts.failed || 0,
            delayed: campaignCounts.delayed || 0,
        },
        customer: {
            waiting: customerCounts.waiting || 0,
            active: customerCounts.active || 0,
            completed: customerCounts.completed || 0,
            failed: customerCounts.failed || 0,
            delayed: customerCounts.delayed || 0,
        },
        dlq: {
            waiting: dlqCounts.waiting || 0,
        },
        flowEnrollment: {
            waiting: flowEnrollmentCounts.waiting || 0,
            active: flowEnrollmentCounts.active || 0,
            completed: flowEnrollmentCounts.completed || 0,
            failed: flowEnrollmentCounts.failed || 0,
            delayed: flowEnrollmentCounts.delayed || 0,
        },
        flowStep: {
            waiting: flowStepCounts.waiting || 0,
            active: flowStepCounts.active || 0,
            completed: flowStepCounts.completed || 0,
            failed: flowStepCounts.failed || 0,
            delayed: flowStepCounts.delayed || 0,
        },
    };
}
