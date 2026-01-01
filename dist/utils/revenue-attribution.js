import prisma from './prisma';
export async function getAttributionConfig() {
    const settings = await prisma.settings.findFirst();
    return {
        windowDays: settings?.attributionWindowDays ?? 7,
        model: settings?.attributionModel ?? 'last_touch',
        includeFlows: true,
    };
}
export async function calculateCampaignRevenue(campaignId, config, startDate, endDate) {
    const fullConfig = {
        ...(await getAttributionConfig()),
        ...config,
    };
    const windowDays = fullConfig.windowDays;
    const validStatuses = ['sent', 'delivered', 'opened', 'clicked'];
    const messageLogs = await prisma.messageLog.findMany({
        where: {
            campaignId,
            sentAt: startDate && endDate ? { gte: startDate, lte: endDate } : { not: null },
            deliveryStatus: { in: validStatuses },
        },
        select: {
            id: true,
            customerId: true,
            sentAt: true,
        },
    });
    if (messageLogs.length === 0) {
        return {
            campaignId,
            totalRevenue: 0,
            totalOrders: 0,
            averageOrderValue: 0,
            attributionWindow: `${windowDays} days`,
            attributionModel: fullConfig.model,
        };
    }
    const customerMessages = new Map();
    for (const message of messageLogs) {
        if (!message.sentAt)
            continue;
        const existing = customerMessages.get(message.customerId) || [];
        existing.push({ id: message.id, sentAt: message.sentAt });
        customerMessages.set(message.customerId, existing);
    }
    const attributedOrders = new Map();
    for (const [customerId, messages] of customerMessages) {
        messages.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
        let attributionStart;
        let attributionEnd;
        if (fullConfig.model === 'first_touch') {
            attributionStart = messages[0].sentAt;
            attributionEnd = new Date(attributionStart);
            attributionEnd.setDate(attributionEnd.getDate() + windowDays);
        }
        else {
            attributionStart = messages[0].sentAt;
            const latestMessage = messages[messages.length - 1];
            attributionEnd = new Date(latestMessage.sentAt);
            attributionEnd.setDate(attributionEnd.getDate() + windowDays);
        }
        const orders = await prisma.order.findMany({
            where: {
                customerId,
                purchasedAt: {
                    gte: attributionStart,
                    lte: attributionEnd,
                },
                status: { in: ['completed', 'pending'] },
            },
            select: {
                id: true,
                total: true,
                purchasedAt: true,
            },
        });
        for (const order of orders) {
            if (attributedOrders.has(order.id))
                continue;
            const influencingMessages = messages.filter((m) => m.sentAt <= order.purchasedAt &&
                order.purchasedAt.getTime() - m.sentAt.getTime() <= windowDays * 24 * 60 * 60 * 1000);
            if (influencingMessages.length === 0)
                continue;
            if (fullConfig.model === 'last_touch') {
                attributedOrders.set(order.id, order.total);
            }
            else if (fullConfig.model === 'first_touch') {
                attributedOrders.set(order.id, order.total);
            }
            else if (fullConfig.model === 'linear') {
                attributedOrders.set(order.id, order.total);
            }
        }
    }
    const totalRevenue = Array.from(attributedOrders.values()).reduce((sum, val) => sum + val, 0);
    const totalOrders = attributedOrders.size;
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    return {
        campaignId,
        totalRevenue,
        totalOrders,
        averageOrderValue,
        attributionWindow: `${windowDays} days`,
        attributionModel: fullConfig.model,
    };
}
export async function calculateMultipleCampaignRevenue(campaignIds, config, startDate, endDate) {
    const results = new Map();
    const batchSize = 5;
    for (let i = 0; i < campaignIds.length; i += batchSize) {
        const batch = campaignIds.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map((campaignId) => calculateCampaignRevenue(campaignId, config, startDate, endDate)));
        for (const result of batchResults) {
            results.set(result.campaignId, result);
        }
    }
    return results;
}
export async function calculateFlowRevenue(flowId, config, startDate, endDate) {
    const fullConfig = {
        ...(await getAttributionConfig()),
        ...config,
    };
    const windowDays = fullConfig.windowDays;
    const enrollments = await prisma.flowEnrollment.findMany({
        where: {
            flowId,
            enrolledAt: startDate && endDate ? { gte: startDate, lte: endDate } : undefined,
        },
        select: {
            id: true,
            customerId: true,
            enrolledAt: true,
        },
    });
    if (enrollments.length === 0) {
        return {
            campaignId: flowId,
            totalRevenue: 0,
            totalOrders: 0,
            averageOrderValue: 0,
            attributionWindow: `${windowDays} days`,
            attributionModel: fullConfig.model,
        };
    }
    const attributedOrders = new Map();
    for (const enrollment of enrollments) {
        const windowEnd = new Date(enrollment.enrolledAt);
        windowEnd.setDate(windowEnd.getDate() + windowDays);
        const orders = await prisma.order.findMany({
            where: {
                customerId: enrollment.customerId,
                purchasedAt: {
                    gte: enrollment.enrolledAt,
                    lte: windowEnd,
                },
                status: { in: ['completed', 'pending'] },
            },
            select: {
                id: true,
                total: true,
            },
        });
        for (const order of orders) {
            if (!attributedOrders.has(order.id)) {
                attributedOrders.set(order.id, order.total);
            }
        }
    }
    const totalRevenue = Array.from(attributedOrders.values()).reduce((sum, val) => sum + val, 0);
    const totalOrders = attributedOrders.size;
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    return {
        campaignId: flowId,
        totalRevenue,
        totalOrders,
        averageOrderValue,
        attributionWindow: `${windowDays} days`,
        attributionModel: fullConfig.model,
    };
}
export async function getCampaignAttributionBreakdown(campaignId, config) {
    const fullConfig = {
        ...(await getAttributionConfig()),
        ...config,
    };
    const windowDays = fullConfig.windowDays;
    const messageLogs = await prisma.messageLog.findMany({
        where: {
            campaignId,
            sentAt: { not: null },
            deliveryStatus: { in: ['sent', 'delivered', 'opened', 'clicked'] },
        },
        select: {
            id: true,
            customerId: true,
            sentAt: true,
            customer: {
                select: { email: true },
            },
        },
    });
    const breakdown = [];
    for (const message of messageLogs) {
        if (!message.sentAt)
            continue;
        const windowEnd = new Date(message.sentAt);
        windowEnd.setDate(windowEnd.getDate() + windowDays);
        const orders = await prisma.order.findMany({
            where: {
                customerId: message.customerId,
                purchasedAt: {
                    gte: message.sentAt,
                    lte: windowEnd,
                },
                status: { in: ['completed', 'pending'] },
            },
            select: {
                id: true,
                total: true,
                purchasedAt: true,
            },
        });
        for (const order of orders) {
            const daysToConversion = Math.round((order.purchasedAt.getTime() - message.sentAt.getTime()) / (1000 * 60 * 60 * 24));
            breakdown.push({
                messageId: message.id,
                customerId: message.customerId,
                customerEmail: message.customer?.email || null,
                messageSentAt: message.sentAt,
                orderId: order.id,
                orderTotal: order.total,
                orderPlacedAt: order.purchasedAt,
                attributedAmount: order.total,
                attributionModel: fullConfig.model,
                daysToConversion,
            });
        }
    }
    return breakdown;
}
