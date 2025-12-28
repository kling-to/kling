/**
 * Revenue Attribution Engine
 *
 * Links MessageLogs to Orders based on:
 * - Customer matching (messageLog.customerId === order.customerId)
 * - Time window (order.purchasedAt within N days of messageLog.sentAt)
 * - Attribution model (last-touch, first-touch, linear)
 */
import prisma from './prisma';
/**
 * Get default attribution config from Settings
 */
export async function getAttributionConfig() {
    const settings = await prisma.settings.findFirst();
    return {
        windowDays: settings?.attributionWindowDays ?? 7,
        model: settings?.attributionModel ?? 'last_touch',
        includeFlows: true,
    };
}
/**
 * Calculate attributed revenue for a single campaign
 */
export async function calculateCampaignRevenue(campaignId, config, startDate, endDate) {
    const fullConfig = {
        ...(await getAttributionConfig()),
        ...config,
    };
    const windowDays = fullConfig.windowDays;
    // Only count messages that were at least sent (not pending/failed before send)
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
    // Group messages by customer for efficient order lookup
    const customerMessages = new Map();
    for (const message of messageLogs) {
        if (!message.sentAt)
            continue;
        const existing = customerMessages.get(message.customerId) || [];
        existing.push({ id: message.id, sentAt: message.sentAt });
        customerMessages.set(message.customerId, existing);
    }
    // Track attributed orders (orderId → amount) to avoid double-counting
    const attributedOrders = new Map();
    // For each customer, find orders within attribution window of any message
    for (const [customerId, messages] of customerMessages) {
        // Sort messages by sent time (ascending for first-touch, descending for last-touch)
        messages.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
        // Find the attribution window based on model
        let attributionStart;
        let attributionEnd;
        if (fullConfig.model === 'first_touch') {
            // First message sets the attribution window
            attributionStart = messages[0].sentAt;
            attributionEnd = new Date(attributionStart);
            attributionEnd.setDate(attributionEnd.getDate() + windowDays);
        }
        else {
            // last_touch or linear: use the earliest message start and latest message + window
            attributionStart = messages[0].sentAt;
            const latestMessage = messages[messages.length - 1];
            attributionEnd = new Date(latestMessage.sentAt);
            attributionEnd.setDate(attributionEnd.getDate() + windowDays);
        }
        // Find orders for this customer within the combined window
        const orders = await prisma.order.findMany({
            where: {
                customerId,
                purchasedAt: {
                    gte: attributionStart,
                    lte: attributionEnd,
                },
                status: { in: ['completed', 'pending'] }, // Exclude refunded/cancelled
            },
            select: {
                id: true,
                total: true,
                purchasedAt: true,
            },
        });
        // Attribute each order based on model
        for (const order of orders) {
            // Skip if already attributed (from another message to same customer)
            if (attributedOrders.has(order.id))
                continue;
            // Find messages that could have influenced this order (sent before purchase)
            const influencingMessages = messages.filter((m) => m.sentAt <= order.purchasedAt &&
                order.purchasedAt.getTime() - m.sentAt.getTime() <= windowDays * 24 * 60 * 60 * 1000);
            if (influencingMessages.length === 0)
                continue;
            if (fullConfig.model === 'last_touch') {
                // Last message before order gets 100% credit
                attributedOrders.set(order.id, order.total);
            }
            else if (fullConfig.model === 'first_touch') {
                // First message before order gets 100% credit
                attributedOrders.set(order.id, order.total);
            }
            else if (fullConfig.model === 'linear') {
                // Split credit across all influencing messages
                // For campaign-level tracking, we give full credit to the campaign
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
/**
 * Calculate revenue attribution for multiple campaigns (batch query)
 */
export async function calculateMultipleCampaignRevenue(campaignIds, config, startDate, endDate) {
    const results = new Map();
    // Process in parallel with concurrency limit
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
/**
 * Calculate revenue attribution for a flow based on enrollments
 * Uses enrollment date as the attribution start point
 */
export async function calculateFlowRevenue(flowId, config, startDate, endDate) {
    const fullConfig = {
        ...(await getAttributionConfig()),
        ...config,
    };
    const windowDays = fullConfig.windowDays;
    // Get all enrollments for this flow
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
    // For each enrollment, find orders within attribution window
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
/**
 * Get detailed attribution breakdown for CSV exports
 */
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
