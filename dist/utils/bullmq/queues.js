import { Queue, QueueEvents } from 'bullmq';
import { getRedisConnection, defaultJobOptions, QUEUE_NAMES } from './connection';
let campaignQueue = null;
let customerQueue = null;
let dlq = null;
let flowEnrollmentQueue = null;
let flowStepQueue = null;
let campaignQueueEvents = null;
let customerQueueEvents = null;
export function getCampaignQueue() {
    if (!campaignQueue) {
        campaignQueue = new Queue(QUEUE_NAMES.CAMPAIGN, {
            connection: getRedisConnection(),
            defaultJobOptions,
        });
    }
    return campaignQueue;
}
export function getCustomerQueue() {
    if (!customerQueue) {
        customerQueue = new Queue(QUEUE_NAMES.CUSTOMER, {
            connection: getRedisConnection(),
            defaultJobOptions: {
                ...defaultJobOptions,
                attempts: 5,
            },
        });
    }
    return customerQueue;
}
export function getDLQ() {
    if (!dlq) {
        dlq = new Queue(QUEUE_NAMES.DLQ, {
            connection: getRedisConnection(),
            defaultJobOptions: {
                removeOnComplete: false,
                removeOnFail: false,
            },
        });
    }
    return dlq;
}
export function getFlowEnrollmentQueue() {
    if (!flowEnrollmentQueue) {
        flowEnrollmentQueue = new Queue(QUEUE_NAMES.FLOW_ENROLLMENT, {
            connection: getRedisConnection(),
            defaultJobOptions,
        });
    }
    return flowEnrollmentQueue;
}
export function getFlowStepQueue() {
    if (!flowStepQueue) {
        flowStepQueue = new Queue(QUEUE_NAMES.FLOW_STEP, {
            connection: getRedisConnection(),
            defaultJobOptions: {
                ...defaultJobOptions,
                attempts: 5,
            },
        });
    }
    return flowStepQueue;
}
export function getCampaignQueueEvents() {
    if (!campaignQueueEvents) {
        campaignQueueEvents = new QueueEvents(QUEUE_NAMES.CAMPAIGN, {
            connection: getRedisConnection(),
        });
    }
    return campaignQueueEvents;
}
export function getCustomerQueueEvents() {
    if (!customerQueueEvents) {
        customerQueueEvents = new QueueEvents(QUEUE_NAMES.CUSTOMER, {
            connection: getRedisConnection(),
        });
    }
    return customerQueueEvents;
}
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
