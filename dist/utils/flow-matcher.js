/**
 * Flow Matcher Service
 *
 * Matches incoming customer events to active flows and triggers enrollments.
 */
import prisma from './prisma';
import { getFlowEnrollmentQueue } from './bullmq/queues';
/**
 * Map event types to flow trigger types
 */
const EVENT_TO_TRIGGER_MAP = {
    // Core event types
    customer_joined_list: 'customer_joined_list',
    abandoned_cart: 'abandoned_cart',
    browse_abandoned: 'browse_abandonment',
    order_placed: 'order_placed',
    order_fulfilled: 'order_fulfilled',
    subscription_started: 'subscription_started',
    subscription_cancelled: 'subscription_cancelled',
    // Alias mappings (common alternative event names)
    cart_abandoned: 'abandoned_cart',
    checkout_abandoned: 'abandoned_cart',
    product_abandoned: 'browse_abandonment', // Alias for browse abandonment
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
/**
 * Find all active flows that match a given event type
 */
export async function findMatchingFlows(eventType) {
    // Map event type to trigger type
    const triggerType = EVENT_TO_TRIGGER_MAP[eventType.toLowerCase()];
    if (!triggerType) {
        // Check if it's a custom_event trigger
        const customFlows = await prisma.flow.findMany({
            where: {
                triggerType: 'custom_event',
                status: 'active',
            },
            select: { id: true, triggerConfig: true },
        });
        // Filter custom flows by eventType in triggerConfig
        const matchingCustomFlows = customFlows.filter((flow) => {
            const config = flow.triggerConfig;
            if (!config)
                return false;
            return config.eventType === eventType;
        });
        return matchingCustomFlows.map((f) => f.id);
    }
    // Find all active flows for this trigger type
    const flows = await prisma.flow.findMany({
        where: {
            triggerType,
            status: 'active',
        },
        select: { id: true, triggerConfig: true },
    });
    // Future: filter by triggerConfig (e.g., specific list ID, product category)
    // For now, return all matching flows
    return flows.map((f) => f.id);
}
/**
 * Enroll a customer in all matching flows for an event
 *
 * This is the main entry point called from event ingestion.
 */
export async function enrollInMatchingFlows(customerId, eventType, eventData, eventId) {
    const flowIds = await findMatchingFlows(eventType);
    if (flowIds.length === 0) {
        console.log(`[FlowMatcher] No flows match event type: ${eventType}`);
        return { flowsTriggered: 0, flowIds: [] };
    }
    console.log(`[FlowMatcher] Found ${flowIds.length} matching flows for event ${eventType}`);
    // Enqueue enrollment jobs
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
/**
 * Get all supported event types for flow triggers
 */
export function getSupportedTriggerEvents() {
    return Object.keys(EVENT_TO_TRIGGER_MAP);
}
/**
 * Check if an event type can trigger flows
 */
export function canTriggerFlow(eventType) {
    return eventType.toLowerCase() in EVENT_TO_TRIGGER_MAP || true; // Always true for custom_event support
}
