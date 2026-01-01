import prisma from './prisma';
export async function calculateCustomerPrediction(customerId, config) {
    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        include: {
            orders: {
                where: { status: 'completed' },
                orderBy: { purchasedAt: 'asc' },
                select: { total: true, purchasedAt: true },
            },
        },
    });
    if (!customer) {
        throw new Error(`Customer not found: ${customerId}`);
    }
    const lookbackDate = new Date(Date.now() - config.lookbackDays * 24 * 60 * 60 * 1000);
    const messageLogs = await prisma.messageLog.findMany({
        where: {
            customerId,
            sentAt: { gte: lookbackDate },
            isTest: false,
        },
        select: {
            channel: true,
            openedAt: true,
            clickedAt: true,
        },
    });
    const ltvResult = calculateLTV(customer.orders, config.minOrders);
    const churnResult = calculateChurnRisk(customer.orders, config.minOrders);
    const engagementResult = calculateEngagementScore(messageLogs, config.minMessages);
    const confidence = calculateConfidence(customer.orders.length, messageLogs.length, config.minOrders, config.minMessages);
    return {
        customerId,
        predictedLTV: ltvResult.predictedLTV,
        avgOrderValue: ltvResult.avgOrderValue,
        purchaseFrequency: ltvResult.purchaseFrequency,
        churnRiskScore: churnResult.churnRiskScore,
        daysSinceLastOrder: churnResult.daysSinceLastOrder,
        avgDaysBetween: churnResult.avgDaysBetween,
        expectedNextOrder: churnResult.expectedNextOrder,
        engagementScore: engagementResult.engagementScore,
        emailOpenRate: engagementResult.emailOpenRate,
        emailClickRate: engagementResult.emailClickRate,
        messagesSent: engagementResult.messagesSent,
        messagesEngaged: engagementResult.messagesEngaged,
        sampleSize: customer.orders.length + messageLogs.length,
        confidence,
        lastOrderAt: customer.lastOrderAt,
        totalOrders: customer.totalOrders,
        totalSpent: customer.totalSpent,
    };
}
function calculateLTV(orders, minOrders) {
    if (orders.length < minOrders) {
        return {
            predictedLTV: null,
            avgOrderValue: null,
            purchaseFrequency: null,
        };
    }
    const totalSpent = orders.reduce((sum, o) => sum + o.total, 0);
    const avgOrderValue = totalSpent / orders.length;
    const firstOrderDate = orders[0].purchasedAt;
    const lastOrderDate = orders[orders.length - 1].purchasedAt;
    const daysBetween = (lastOrderDate.getTime() - firstOrderDate.getTime()) / (1000 * 60 * 60 * 24);
    const monthsActive = Math.max(daysBetween / 30, 1);
    const purchaseFrequency = orders.length / monthsActive;
    const predictedLTV = avgOrderValue * purchaseFrequency * 12;
    return {
        predictedLTV: Math.round(predictedLTV * 100) / 100,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        purchaseFrequency: Math.round(purchaseFrequency * 100) / 100,
    };
}
function calculateChurnRisk(orders, minOrders) {
    if (orders.length < minOrders) {
        return {
            churnRiskScore: null,
            daysSinceLastOrder: null,
            avgDaysBetween: null,
            expectedNextOrder: null,
        };
    }
    let totalDaysBetween = 0;
    for (let i = 1; i < orders.length; i++) {
        const days = (orders[i].purchasedAt.getTime() - orders[i - 1].purchasedAt.getTime()) /
            (1000 * 60 * 60 * 24);
        totalDaysBetween += days;
    }
    const avgDaysBetween = orders.length > 1 ? totalDaysBetween / (orders.length - 1) : 30;
    const lastOrderDate = orders[orders.length - 1].purchasedAt;
    const daysSinceLastOrder = Math.floor((Date.now() - lastOrderDate.getTime()) / (1000 * 60 * 60 * 24));
    const churnRiskScore = Math.min(daysSinceLastOrder / (avgDaysBetween * 2), 1);
    const expectedNextOrder = new Date(lastOrderDate.getTime() + avgDaysBetween * 24 * 60 * 60 * 1000);
    return {
        churnRiskScore: Math.round(churnRiskScore * 100) / 100,
        daysSinceLastOrder,
        avgDaysBetween: Math.round(avgDaysBetween * 100) / 100,
        expectedNextOrder,
    };
}
function calculateEngagementScore(messages, minMessages) {
    const messagesSent = messages.length;
    if (messagesSent < minMessages) {
        return {
            engagementScore: null,
            emailOpenRate: null,
            emailClickRate: null,
            messagesSent,
            messagesEngaged: 0,
        };
    }
    const emailMessages = messages.filter((m) => m.channel === 'email');
    const emailOpens = messages.filter((m) => m.openedAt !== null).length;
    const emailClicks = messages.filter((m) => m.clickedAt !== null).length;
    const emailOpenRate = emailMessages.length > 0 ? emailOpens / emailMessages.length : 0;
    const emailClickRate = emailOpens > 0 ? emailClicks / emailOpens : 0;
    const messagesEngaged = emailOpens + emailClicks;
    const engagementScore = (messagesEngaged / messagesSent) * 100;
    return {
        engagementScore: Math.min(Math.round(engagementScore * 100) / 100, 100),
        emailOpenRate: Math.round(emailOpenRate * 100) / 100,
        emailClickRate: Math.round(emailClickRate * 100) / 100,
        messagesSent,
        messagesEngaged,
    };
}
function calculateConfidence(orderCount, messageCount, minOrders, minMessages) {
    let score = 0;
    if (orderCount >= 10) {
        score += 0.5;
    }
    else if (orderCount >= 5) {
        score += 0.35;
    }
    else if (orderCount >= minOrders) {
        score += 0.2;
    }
    if (messageCount >= 20) {
        score += 0.5;
    }
    else if (messageCount >= 10) {
        score += 0.35;
    }
    else if (messageCount >= minMessages) {
        score += 0.2;
    }
    return Math.round(score * 100) / 100;
}
export async function savePrediction(result) {
    await prisma.customerPrediction.upsert({
        where: { customerId: result.customerId },
        create: {
            customerId: result.customerId,
            predictedLTV: result.predictedLTV,
            avgOrderValue: result.avgOrderValue,
            purchaseFrequency: result.purchaseFrequency,
            churnRiskScore: result.churnRiskScore,
            daysSinceLastOrder: result.daysSinceLastOrder,
            avgDaysBetween: result.avgDaysBetween,
            expectedNextOrder: result.expectedNextOrder,
            engagementScore: result.engagementScore,
            emailOpenRate: result.emailOpenRate,
            emailClickRate: result.emailClickRate,
            messagesSent: result.messagesSent,
            messagesEngaged: result.messagesEngaged,
            sampleSize: result.sampleSize,
            confidence: result.confidence,
            lastOrderAt: result.lastOrderAt,
            totalOrders: result.totalOrders,
            totalSpent: result.totalSpent,
            calculatedAt: new Date(),
        },
        update: {
            predictedLTV: result.predictedLTV,
            avgOrderValue: result.avgOrderValue,
            purchaseFrequency: result.purchaseFrequency,
            churnRiskScore: result.churnRiskScore,
            daysSinceLastOrder: result.daysSinceLastOrder,
            avgDaysBetween: result.avgDaysBetween,
            expectedNextOrder: result.expectedNextOrder,
            engagementScore: result.engagementScore,
            emailOpenRate: result.emailOpenRate,
            emailClickRate: result.emailClickRate,
            messagesSent: result.messagesSent,
            messagesEngaged: result.messagesEngaged,
            sampleSize: result.sampleSize,
            confidence: result.confidence,
            lastOrderAt: result.lastOrderAt,
            totalOrders: result.totalOrders,
            totalSpent: result.totalSpent,
            calculatedAt: new Date(),
        },
    });
}
export async function calculateAllPredictions(config) {
    const startTime = Date.now();
    const total = await prisma.customer.count({
        where: { optOut: false },
    });
    let calculated = 0;
    let skipped = 0;
    let failed = 0;
    let cursor;
    while (true) {
        const customers = await prisma.customer.findMany({
            where: { optOut: false },
            take: config.batchSize,
            skip: cursor ? 1 : 0,
            cursor: cursor ? { id: cursor } : undefined,
            orderBy: { id: 'asc' },
            select: { id: true, totalOrders: true },
        });
        if (customers.length === 0)
            break;
        for (const customer of customers) {
            try {
                if (customer.totalOrders === 0) {
                    skipped++;
                    continue;
                }
                const result = await calculateCustomerPrediction(customer.id, config);
                await savePrediction(result);
                calculated++;
            }
            catch (error) {
                console.error(`Failed to calculate prediction for customer ${customer.id}:`, error);
                failed++;
            }
        }
        cursor = customers[customers.length - 1].id;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return {
        total,
        calculated,
        skipped,
        failed,
        duration: Date.now() - startTime,
    };
}
export async function getPredictionStats() {
    const settings = await prisma.settings.findFirst();
    const enabled = settings?.predictionsEnabled ?? false;
    const totalCustomers = await prisma.customer.count({ where: { optOut: false } });
    const customersWithPredictions = await prisma.customerPrediction.count();
    const latestPrediction = await prisma.customerPrediction.findFirst({
        orderBy: { calculatedAt: 'desc' },
        select: { calculatedAt: true },
    });
    const confidenceAgg = await prisma.customerPrediction.aggregate({
        _avg: { confidence: true },
    });
    const ltvAgg = await prisma.customerPrediction.aggregate({
        _min: { predictedLTV: true },
        _max: { predictedLTV: true },
        _avg: { predictedLTV: true },
    });
    const ltvCount = await prisma.customerPrediction.count({
        where: { predictedLTV: { not: null } },
    });
    const medianLTV = await prisma.customerPrediction.findFirst({
        where: { predictedLTV: { not: null } },
        orderBy: { predictedLTV: 'asc' },
        skip: Math.floor(ltvCount / 2),
        select: { predictedLTV: true },
    });
    const churnLow = await prisma.customerPrediction.count({
        where: { churnRiskScore: { lt: 0.3 } },
    });
    const churnMedium = await prisma.customerPrediction.count({
        where: { churnRiskScore: { gte: 0.3, lt: 0.6 } },
    });
    const churnHigh = await prisma.customerPrediction.count({
        where: { churnRiskScore: { gte: 0.6, lt: 0.9 } },
    });
    const churnCritical = await prisma.customerPrediction.count({
        where: { churnRiskScore: { gte: 0.9 } },
    });
    const engagementLow = await prisma.customerPrediction.count({
        where: { engagementScore: { lt: 33 } },
    });
    const engagementMedium = await prisma.customerPrediction.count({
        where: { engagementScore: { gte: 33, lt: 66 } },
    });
    const engagementHigh = await prisma.customerPrediction.count({
        where: { engagementScore: { gte: 66 } },
    });
    return {
        enabled,
        totalCustomers,
        customersWithPredictions,
        lastCalculatedAt: latestPrediction?.calculatedAt ?? null,
        averageConfidence: confidenceAgg._avg.confidence ?? 0,
        ltvDistribution: {
            min: ltvAgg._min.predictedLTV ?? 0,
            max: ltvAgg._max.predictedLTV ?? 0,
            average: ltvAgg._avg.predictedLTV ?? 0,
            median: medianLTV?.predictedLTV ?? 0,
        },
        churnDistribution: {
            low: churnLow,
            medium: churnMedium,
            high: churnHigh,
            critical: churnCritical,
        },
        engagementDistribution: {
            low: engagementLow,
            medium: engagementMedium,
            high: engagementHigh,
        },
    };
}
export async function getCustomerPrediction(customerId) {
    return prisma.customerPrediction.findUnique({
        where: { customerId },
    });
}
