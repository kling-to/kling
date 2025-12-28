/**
 * Experiment Conversion Tracking
 *
 * Automatically records conversions for A/B test experiments based on
 * customer events that match the experiment's conversion goal.
 */
import prisma from './prisma';
/**
 * Map event types to conversion goals
 */
const eventToConversionMap = {
    // Order events
    purchase: 'order_placed',
    order_placed: 'order_placed',
    order_completed: 'order_placed',
    checkout_completed: 'order_placed',
    // Link click events
    link_clicked: 'link_clicked',
    email_clicked: 'link_clicked',
    click: 'link_clicked',
    // Code redemption events
    code_redeemed: 'code_redeemed',
    coupon_applied: 'code_redeemed',
    discount_applied: 'code_redeemed',
    promo_used: 'code_redeemed',
};
/**
 * Check if an event type maps to a conversion goal
 */
export function mapEventToConversion(eventType) {
    return eventToConversionMap[eventType.toLowerCase()] || null;
}
/**
 * Check if a customer has any pending experiment assignments and record conversion
 * if the event matches the experiment's conversion goal.
 *
 * @param customerId - The customer ID
 * @param conversionType - The type of conversion event
 * @param conversionValue - Optional monetary value of the conversion
 * @returns Object indicating if conversion was recorded and for which experiments
 */
export async function checkAndRecordConversion(customerId, conversionType, conversionValue) {
    // Find all experiment assignments for this customer where:
    // 1. The experiment is still running
    // 2. The customer hasn't already converted
    // 3. The experiment's conversion goal matches the event type
    // 4. The assignment is within the conversion window
    const assignments = await prisma.experimentAssignment.findMany({
        where: {
            customerId,
            converted: false,
            experiment: {
                status: 'running',
                conversionGoal: conversionType,
            },
        },
        include: {
            experiment: {
                select: {
                    id: true,
                    name: true,
                    conversionWindowDays: true,
                },
            },
        },
    });
    if (assignments.length === 0) {
        return { recorded: false, experiments: [] };
    }
    const convertedExperiments = [];
    for (const assignment of assignments) {
        // Check if within conversion window
        const windowDays = assignment.experiment?.conversionWindowDays || 7;
        const windowStart = new Date(assignment.assignedAt);
        const windowEnd = new Date(windowStart.getTime() + windowDays * 24 * 60 * 60 * 1000);
        const now = new Date();
        if (now > windowEnd) {
            // Outside conversion window, skip
            console.log(`[ExperimentConversion] Assignment ${assignment.id} outside conversion window (${windowDays} days)`);
            continue;
        }
        // Record the conversion
        await prisma.experimentAssignment.update({
            where: { id: assignment.id },
            data: {
                converted: true,
                convertedAt: now,
                conversionValue: conversionValue || null,
            },
        });
        console.log(`[ExperimentConversion] Recorded conversion for experiment ${assignment.experiment?.name} ` +
            `(${assignment.experimentId}), customer ${customerId}, cohort: ${assignment.cohort}`);
        convertedExperiments.push({
            experimentId: assignment.experimentId,
            experimentName: assignment.experiment?.name || 'Unknown',
            cohort: assignment.cohort,
        });
    }
    return {
        recorded: convertedExperiments.length > 0,
        experiments: convertedExperiments,
    };
}
/**
 * Record a conversion directly for a specific experiment assignment.
 * Used when you already know the experiment ID.
 *
 * @param experimentId - The experiment ID
 * @param customerId - The customer ID
 * @param conversionValue - Optional monetary value
 * @returns Whether conversion was recorded
 */
export async function recordConversionForExperiment(experimentId, customerId, conversionValue) {
    const assignment = await prisma.experimentAssignment.findFirst({
        where: {
            experimentId,
            customerId,
            converted: false,
        },
        include: {
            experiment: {
                select: {
                    status: true,
                    conversionWindowDays: true,
                },
            },
        },
    });
    if (!assignment) {
        return false;
    }
    // Check experiment is still running
    if (assignment.experiment?.status !== 'running') {
        return false;
    }
    // Check conversion window
    const windowDays = assignment.experiment?.conversionWindowDays || 7;
    const windowStart = new Date(assignment.assignedAt);
    const windowEnd = new Date(windowStart.getTime() + windowDays * 24 * 60 * 60 * 1000);
    const now = new Date();
    if (now > windowEnd) {
        return false;
    }
    await prisma.experimentAssignment.update({
        where: { id: assignment.id },
        data: {
            converted: true,
            convertedAt: now,
            conversionValue: conversionValue || null,
        },
    });
    return true;
}
