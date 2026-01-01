import prisma from './prisma';
import { getFlowEnrollmentQueue } from './bullmq/queues';
const EVENT_TO_TRIGGER_MAP = {
    customer_joined_list: 'customer_joined_list',
    abandoned_cart: 'abandoned_cart',
    browse_abandoned: 'browse_abandonment',
    order_placed: 'order_placed',
    order_fulfilled: 'order_fulfilled',
    subscription_started: 'subscription_started',
    subscription_cancelled: 'subscription_cancelled',
    cart_abandoned: 'abandoned_cart',
    checkout_abandoned: 'abandoned_cart',
    product_abandoned: 'browse_abandonment',
    purchase: 'order_placed',
    order_created: 'order_placed',
    order_completed: 'order_placed',
    order_shipped: 'order_fulfilled',
    shipment_created: 'order_fulfilled',
    subscription_created: 'subscription_started',
    subscription_canceled: 'subscription_cancelled',
    list_subscribe: 'customer_joined_list',
    newsletter_signup: 'customer_joined_list',
};
export async function findMatchingFlows(eventType) {
    const triggerType = EVENT_TO_TRIGGER_MAP[eventType.toLowerCase()];
    if (!triggerType) {
        const customFlows = await prisma.flow.findMany({
            where: {
                triggerType: 'custom_event',
                status: 'active',
            },
            select: { id: true, triggerConfig: true },
        });
        const matchingCustomFlows = customFlows.filter((flow) => {
            const config = flow.triggerConfig;
            if (!config)
                return false;
            return config.eventType === eventType;
        });
        return matchingCustomFlows.map((f) => f.id);
    }
    const flows = await prisma.flow.findMany({
        where: {
            triggerType,
            status: 'active',
        },
        select: { id: true, triggerConfig: true },
    });
    return flows.map((f) => f.id);
}
export async function enrollInMatchingFlows(customerId, eventType, eventData, eventId) {
    const flowIds = await findMatchingFlows(eventType);
    if (flowIds.length === 0) {
        console.log(`[FlowMatcher] No flows match event type: ${eventType}`);
        return { flowsTriggered: 0, flowIds: [] };
    }
    console.log(`[FlowMatcher] Found ${flowIds.length} matching flows for event ${eventType}`);
    const enrollmentQueue = getFlowEnrollmentQueue();
    for (const flowId of flowIds) {
        const jobId = `enroll_${flowId}_${customerId}_${Date.now()}`;
        await enrollmentQueue.add(jobId, {
            flowId,
            customerId,
            triggerEventId: eventId,
            triggerData: eventData,
        });
        console.log(`[FlowMatcher] Enqueued enrollment job ${jobId}`);
    }
    return { flowsTriggered: flowIds.length, flowIds };
}
export function getSupportedTriggerEvents() {
    return Object.keys(EVENT_TO_TRIGGER_MAP);
}
export function canTriggerFlow(eventType) {
    return eventType.toLowerCase() in EVENT_TO_TRIGGER_MAP || true;
}
