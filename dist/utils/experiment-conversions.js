import prisma from './prisma';
const eventToConversionMap = {
    purchase: 'order_placed',
    order_placed: 'order_placed',
    order_completed: 'order_placed',
    checkout_completed: 'order_placed',
    link_clicked: 'link_clicked',
    email_clicked: 'link_clicked',
    click: 'link_clicked',
    code_redeemed: 'code_redeemed',
    coupon_applied: 'code_redeemed',
    discount_applied: 'code_redeemed',
    promo_used: 'code_redeemed',
};
export function mapEventToConversion(eventType) {
    return eventToConversionMap[eventType.toLowerCase()] || null;
}
export async function checkAndRecordConversion(customerId, conversionType, conversionValue) {
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
        const windowDays = assignment.experiment?.conversionWindowDays || 7;
        const windowStart = new Date(assignment.assignedAt);
        const windowEnd = new Date(windowStart.getTime() + windowDays * 24 * 60 * 60 * 1000);
        const now = new Date();
        if (now > windowEnd) {
            console.log(`[ExperimentConversion] Assignment ${assignment.id} outside conversion window (${windowDays} days)`);
            continue;
        }
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
    if (assignment.experiment?.status !== 'running') {
        return false;
    }
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
