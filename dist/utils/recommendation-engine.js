import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export const DEFAULT_CONFIG = {
    limit: 6,
    lookbackDays: 90,
    excludePurchased: true,
    fallbackToBestSellers: true,
};
export async function getRecommendations(customerId, algorithm, config = {}) {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    const cached = await getCachedRecommendations(customerId, algorithm, mergedConfig.categoryFilter, mergedConfig.brandFilter);
    if (cached) {
        return cached;
    }
    let result;
    switch (algorithm) {
        case 'best_sellers':
            result = await getBestSellers(mergedConfig);
            break;
        case 'recently_viewed':
            if (!customerId)
                throw new Error('Customer ID required for recently_viewed algorithm');
            result = await getRecentlyViewed(customerId, mergedConfig);
            break;
        case 'collaborative_filter':
            if (!customerId)
                throw new Error('Customer ID required for collaborative_filter algorithm');
            result = await getCollaborativeFiltering(customerId, mergedConfig);
            break;
        case 'copurchase':
            if (!customerId)
                throw new Error('Customer ID required for copurchase algorithm');
            result = await getCopurchaseRecommendations(customerId, mergedConfig);
            break;
        case 'content_based':
            if (!customerId)
                throw new Error('Customer ID required for content_based algorithm');
            result = await getContentBased(customerId, mergedConfig);
            break;
        case 'personalized_mix':
            if (!customerId)
                throw new Error('Customer ID required for personalized_mix algorithm');
            result = await getPersonalizedMix(customerId, mergedConfig);
            break;
        default:
            result = await getBestSellers(mergedConfig);
    }
    if (result.recommendations.length < mergedConfig.limit &&
        mergedConfig.fallbackToBestSellers &&
        algorithm !== 'best_sellers') {
        const existing = new Set(result.recommendations.map((r) => r.sku));
        const fallback = await getBestSellers({
            ...mergedConfig,
            limit: mergedConfig.limit - result.recommendations.length,
        });
        for (const item of fallback.recommendations) {
            if (!existing.has(item.sku)) {
                result.recommendations.push({
                    ...item,
                    reason: 'Popular with other customers',
                });
            }
        }
        result.confidence = Math.min(result.confidence, 0.5);
    }
    await cacheRecommendations(result, mergedConfig);
    return result;
}
async function getBestSellers(config) {
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - config.lookbackDays);
    const bestSellers = await prisma.$runCommandRaw({
        aggregate: 'OrderItem',
        pipeline: [
            {
                $lookup: {
                    from: 'Order',
                    localField: 'orderId',
                    foreignField: '_id',
                    as: 'order',
                },
            },
            { $unwind: '$order' },
            {
                $match: {
                    'order.purchasedAt': { $gte: lookbackDate },
                    'order.status': { $in: ['completed', 'pending'] },
                },
            },
            {
                $group: {
                    _id: '$sku',
                    name: { $first: '$name' },
                    category: { $first: '$category' },
                    brand: { $first: '$brand' },
                    totalQuantity: { $sum: '$quantity' },
                    orderCount: { $sum: 1 },
                    avgPrice: { $avg: '$price' },
                    lastPurchased: { $max: '$order.purchasedAt' },
                },
            },
            {
                $addFields: {
                    recencyWeight: {
                        $divide: [
                            {
                                $subtract: ['$lastPurchased', { $toDate: lookbackDate.toISOString() }],
                            },
                            86400000 * config.lookbackDays,
                        ],
                    },
                },
            },
            {
                $addFields: {
                    score: {
                        $multiply: [
                            { $ln: { $add: ['$totalQuantity', 1] } },
                            { $add: [0.5, { $multiply: ['$recencyWeight', 0.5] }] },
                        ],
                    },
                },
            },
            { $sort: { score: -1 } },
            { $limit: config.limit * 2 },
        ],
        cursor: {},
    });
    const cursor = bestSellers;
    const items = cursor.cursor?.firstBatch || [];
    const recommendations = await enrichWithProductData(items.slice(0, config.limit), 'Top seller in the last ' + config.lookbackDays + ' days');
    const filtered = filterRecommendations(recommendations, config);
    return {
        customerId: null,
        algorithm: 'best_sellers',
        recommendations: filtered.slice(0, config.limit),
        confidence: filtered.length > 0 ? 0.8 : 0.2,
        generatedAt: new Date(),
        cached: false,
    };
}
async function getRecentlyViewed(customerId, config) {
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - config.lookbackDays);
    let purchasedSkus = new Set();
    if (config.excludePurchased) {
        purchasedSkus = await getCustomerPurchasedSkus(customerId);
    }
    const browseEvents = await prisma.browseEvent.findMany({
        where: {
            customerId,
            eventType: { in: ['viewed_product', 'added_to_cart'] },
            occurredAt: { gte: lookbackDate },
            sku: { not: null },
        },
        orderBy: { occurredAt: 'desc' },
        take: config.limit * 3,
        include: { product: true },
    });
    const seenSkus = new Set();
    const uniqueEvents = browseEvents.filter((event) => {
        if (!event.sku || seenSkus.has(event.sku))
            return false;
        if (config.excludePurchased && purchasedSkus.has(event.sku))
            return false;
        seenSkus.add(event.sku);
        return true;
    });
    const recommendations = uniqueEvents
        .slice(0, config.limit)
        .map((event, index) => ({
        sku: event.sku,
        name: event.product?.name || event.sku,
        category: event.product?.category || null,
        brand: event.product?.brand || null,
        price: event.product?.price || 0,
        imageUrl: event.product?.imageUrl || null,
        url: event.product?.url || null,
        score: 1 - index * 0.1,
        reason: event.eventType === 'added_to_cart' ? 'Left in your cart' : 'Recently viewed',
    }));
    const filtered = filterRecommendations(recommendations, config);
    return {
        customerId,
        algorithm: 'recently_viewed',
        recommendations: filtered.slice(0, config.limit),
        confidence: filtered.length > 0 ? 0.9 : 0.1,
        generatedAt: new Date(),
        cached: false,
    };
}
async function getCollaborativeFiltering(customerId, config) {
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - config.lookbackDays);
    const customerOrders = await prisma.order.findMany({
        where: {
            customerId,
            status: { in: ['completed', 'pending'] },
        },
        include: { items: true },
        orderBy: { purchasedAt: 'desc' },
        take: 20,
    });
    if (customerOrders.length === 0) {
        return {
            customerId,
            algorithm: 'collaborative_filter',
            recommendations: [],
            confidence: 0,
            generatedAt: new Date(),
            cached: false,
        };
    }
    const customerSkus = new Set();
    for (const order of customerOrders) {
        for (const item of order.items) {
            customerSkus.add(item.sku);
        }
    }
    const similarCustomerResult = await prisma.$runCommandRaw({
        aggregate: 'OrderItem',
        pipeline: [
            { $match: { sku: { $in: Array.from(customerSkus) } } },
            {
                $lookup: {
                    from: 'Order',
                    localField: 'orderId',
                    foreignField: '_id',
                    as: 'order',
                },
            },
            { $unwind: '$order' },
            {
                $match: {
                    'order.customerId': { $ne: { $oid: customerId } },
                    'order.purchasedAt': { $gte: lookbackDate },
                },
            },
            {
                $group: {
                    _id: '$order.customerId',
                    commonSkus: { $addToSet: '$sku' },
                    matchCount: { $sum: 1 },
                },
            },
            { $match: { matchCount: { $gte: 2 } } },
            { $sort: { matchCount: -1 } },
            { $limit: 50 },
        ],
        cursor: {},
    });
    const cursor = similarCustomerResult;
    const similarCustomers = cursor.cursor?.firstBatch?.map((c) => c._id.$oid || c._id) || [];
    if (similarCustomers.length === 0) {
        return {
            customerId,
            algorithm: 'collaborative_filter',
            recommendations: [],
            confidence: 0,
            generatedAt: new Date(),
            cached: false,
        };
    }
    const recommendedResult = await prisma.$runCommandRaw({
        aggregate: 'OrderItem',
        pipeline: [
            {
                $lookup: {
                    from: 'Order',
                    localField: 'orderId',
                    foreignField: '_id',
                    as: 'order',
                },
            },
            { $unwind: '$order' },
            {
                $match: {
                    'order.customerId': {
                        $in: similarCustomers.map((id) => ({ $oid: id })),
                    },
                    sku: { $nin: Array.from(customerSkus) },
                },
            },
            {
                $group: {
                    _id: '$sku',
                    name: { $first: '$name' },
                    category: { $first: '$category' },
                    brand: { $first: '$brand' },
                    avgPrice: { $avg: '$price' },
                    customerCount: { $addToSet: '$order.customerId' },
                },
            },
            {
                $addFields: {
                    score: { $size: '$customerCount' },
                },
            },
            { $sort: { score: -1 } },
            { $limit: config.limit * 2 },
        ],
        cursor: {},
    });
    const recommendedCursor = recommendedResult;
    const recommended = recommendedCursor.cursor?.firstBatch || [];
    const recommendations = await enrichWithProductData(recommended.slice(0, config.limit), 'Customers with similar tastes also bought this');
    const filtered = filterRecommendations(recommendations, config);
    return {
        customerId,
        algorithm: 'collaborative_filter',
        recommendations: filtered.slice(0, config.limit),
        confidence: filtered.length > 0 ? Math.min(similarCustomers.length / 20, 0.85) : 0.2,
        generatedAt: new Date(),
        cached: false,
    };
}
async function getCopurchaseRecommendations(customerId, config) {
    const recentOrders = await prisma.order.findMany({
        where: {
            customerId,
            status: { in: ['completed', 'pending'] },
        },
        include: { items: true },
        orderBy: { purchasedAt: 'desc' },
        take: 5,
    });
    if (recentOrders.length === 0) {
        return {
            customerId,
            algorithm: 'copurchase',
            recommendations: [],
            confidence: 0,
            generatedAt: new Date(),
            cached: false,
        };
    }
    const recentSkus = new Set();
    for (const order of recentOrders) {
        for (const item of order.items) {
            recentSkus.add(item.sku);
        }
    }
    const patterns = await prisma.copurchasePattern.findMany({
        where: {
            sourceSku: { in: Array.from(recentSkus) },
            copurchaseRate: { gte: 0.1 },
        },
        orderBy: [{ copurchaseRate: 'desc' }, { copurchaseCount: 'desc' }],
        take: config.limit * 2,
    });
    if (patterns.length === 0) {
        return {
            customerId,
            algorithm: 'copurchase',
            recommendations: [],
            confidence: 0,
            generatedAt: new Date(),
            cached: false,
        };
    }
    const recommendedSkus = [...new Set(patterns.map((p) => p.recommendedSku))];
    const products = await prisma.product.findMany({
        where: {
            sku: { in: recommendedSkus },
            isActive: true,
            excludeFromRecommendations: false,
        },
    });
    const productMap = new Map(products.map((p) => [p.sku, p]));
    const recommendations = patterns
        .filter((p) => productMap.has(p.recommendedSku))
        .slice(0, config.limit)
        .map((pattern) => {
        const product = productMap.get(pattern.recommendedSku);
        return {
            sku: pattern.recommendedSku,
            name: product.name,
            category: product.category,
            brand: product.brand,
            price: product.price,
            imageUrl: product.imageUrl,
            url: product.url,
            score: pattern.copurchaseRate,
            reason: 'Frequently bought together',
        };
    });
    let filtered = filterRecommendations(recommendations, config);
    if (config.excludePurchased) {
        const purchasedSkus = await getCustomerPurchasedSkus(customerId);
        filtered = filtered.filter((r) => !purchasedSkus.has(r.sku));
    }
    return {
        customerId,
        algorithm: 'copurchase',
        recommendations: filtered.slice(0, config.limit),
        confidence: filtered.length > 0 ? 0.75 : 0.1,
        generatedAt: new Date(),
        cached: false,
    };
}
async function getContentBased(customerId, config) {
    const customerOrders = await prisma.order.findMany({
        where: { customerId, status: { in: ['completed', 'pending'] } },
        include: { items: true },
        take: 50,
    });
    if (customerOrders.length === 0) {
        return {
            customerId,
            algorithm: 'content_based',
            recommendations: [],
            confidence: 0,
            generatedAt: new Date(),
            cached: false,
        };
    }
    const categoryCount = new Map();
    const brandCount = new Map();
    const purchasedSkus = new Set();
    for (const order of customerOrders) {
        for (const item of order.items) {
            purchasedSkus.add(item.sku);
            if (item.category) {
                categoryCount.set(item.category, (categoryCount.get(item.category) || 0) + item.quantity);
            }
            if (item.brand) {
                brandCount.set(item.brand, (brandCount.get(item.brand) || 0) + item.quantity);
            }
        }
    }
    const topCategories = [...categoryCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cat]) => cat);
    const topBrands = [...brandCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([brand]) => brand);
    const products = await prisma.product.findMany({
        where: {
            isActive: true,
            excludeFromRecommendations: false,
            sku: { notIn: config.excludePurchased ? Array.from(purchasedSkus) : [] },
            OR: [{ category: { in: topCategories } }, { brand: { in: topBrands } }],
        },
        orderBy: { price: 'desc' },
        take: config.limit * 2,
    });
    const recommendations = products
        .map((product) => {
        let score = 0;
        const reasons = [];
        if (product.category && topCategories.includes(product.category)) {
            score += 0.5 * (1 - topCategories.indexOf(product.category) / topCategories.length);
            reasons.push(`Based on your interest in ${product.category}`);
        }
        if (product.brand && topBrands.includes(product.brand)) {
            score += 0.5 * (1 - topBrands.indexOf(product.brand) / topBrands.length);
            reasons.push(`From ${product.brand}, a brand you like`);
        }
        return {
            sku: product.sku,
            name: product.name,
            category: product.category,
            brand: product.brand,
            price: product.price,
            imageUrl: product.imageUrl,
            url: product.url,
            score,
            reason: reasons[0] || 'Based on your preferences',
        };
    })
        .sort((a, b) => b.score - a.score)
        .slice(0, config.limit);
    const filtered = filterRecommendations(recommendations, config);
    return {
        customerId,
        algorithm: 'content_based',
        recommendations: filtered.slice(0, config.limit),
        confidence: filtered.length > 0 ? 0.7 : 0.2,
        generatedAt: new Date(),
        cached: false,
    };
}
async function getPersonalizedMix(customerId, config) {
    const [recentlyViewed, collaborative, copurchase, bestSellers] = await Promise.all([
        getRecentlyViewed(customerId, { ...config, limit: 2 }),
        getCollaborativeFiltering(customerId, { ...config, limit: 2 }),
        getCopurchaseRecommendations(customerId, { ...config, limit: 2 }),
        getBestSellers({ ...config, limit: 2 }),
    ]);
    const seenSkus = new Set();
    const mixed = [];
    const sources = [recentlyViewed, collaborative, copurchase, bestSellers];
    for (const source of sources) {
        for (const rec of source.recommendations) {
            if (!seenSkus.has(rec.sku)) {
                seenSkus.add(rec.sku);
                mixed.push(rec);
            }
        }
    }
    const sorted = mixed.sort((a, b) => b.score - a.score).slice(0, config.limit);
    const avgConfidence = sources.reduce((sum, s) => sum + s.confidence, 0) / sources.length;
    return {
        customerId,
        algorithm: 'personalized_mix',
        recommendations: sorted,
        confidence: avgConfidence,
        generatedAt: new Date(),
        cached: false,
    };
}
async function getCustomerPurchasedSkus(customerId) {
    const orders = await prisma.order.findMany({
        where: { customerId },
        include: { items: { select: { sku: true } } },
    });
    const skus = new Set();
    for (const order of orders) {
        for (const item of order.items) {
            skus.add(item.sku);
        }
    }
    return skus;
}
async function enrichWithProductData(items, defaultReason) {
    const skus = items.map((i) => i._id);
    const products = await prisma.product.findMany({
        where: { sku: { in: skus }, isActive: true },
    });
    const productMap = new Map(products.map((p) => [p.sku, p]));
    return items.map((item) => {
        const sku = item._id;
        const product = productMap.get(sku);
        return {
            sku,
            name: product?.name || item.name || sku,
            category: product?.category || item.category || null,
            brand: product?.brand || item.brand || null,
            price: product?.price || item.avgPrice || 0,
            imageUrl: product?.imageUrl || null,
            url: product?.url || null,
            score: item.score || 0,
            reason: defaultReason,
        };
    });
}
function filterRecommendations(recommendations, config) {
    return recommendations.filter((r) => {
        if (config.categoryFilter && r.category !== config.categoryFilter) {
            return false;
        }
        if (config.brandFilter && r.brand !== config.brandFilter) {
            return false;
        }
        return true;
    });
}
async function getCachedRecommendations(customerId, algorithm, categoryFilter, brandFilter) {
    const cached = await prisma.recommendationCache.findFirst({
        where: {
            customerId: customerId ?? null,
            algorithm,
            categoryFilter: categoryFilter ?? null,
            brandFilter: brandFilter ?? null,
            expiresAt: { gt: new Date() },
        },
    });
    if (!cached)
        return null;
    return {
        customerId,
        algorithm,
        recommendations: cached.recommendations,
        confidence: cached.confidence,
        generatedAt: cached.generatedAt,
        cached: true,
    };
}
async function cacheRecommendations(result, config) {
    if (!result.customerId && result.algorithm !== 'best_sellers')
        return;
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);
    try {
        const existing = await prisma.recommendationCache.findFirst({
            where: {
                customerId: result.customerId ?? null,
                algorithm: result.algorithm,
                categoryFilter: config.categoryFilter ?? null,
                brandFilter: config.brandFilter ?? null,
            },
        });
        const cacheData = {
            recommendations: result.recommendations,
            productCount: result.recommendations.length,
            confidence: result.confidence,
            generatedAt: result.generatedAt,
            expiresAt,
        };
        if (existing) {
            await prisma.recommendationCache.update({
                where: { id: existing.id },
                data: cacheData,
            });
        }
        else {
            await prisma.recommendationCache.create({
                data: {
                    customerId: result.customerId ?? null,
                    algorithm: result.algorithm,
                    categoryFilter: config.categoryFilter ?? null,
                    brandFilter: config.brandFilter ?? null,
                    ...cacheData,
                },
            });
        }
    }
    catch {
    }
}
export async function updateCopurchasePatterns() {
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - 90);
    const orders = await prisma.order.findMany({
        where: {
            purchasedAt: { gte: lookbackDate },
            status: { in: ['completed', 'pending'] },
        },
        include: {
            items: { select: { sku: true, quantity: true } },
        },
    });
    const patterns = new Map();
    const skuOrderCounts = new Map();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    for (const order of orders) {
        if (order.items.length < 2)
            continue;
        const skus = order.items.map((i) => i.sku);
        const isRecent = order.purchasedAt >= thirtyDaysAgo;
        for (const sku of skus) {
            skuOrderCounts.set(sku, (skuOrderCounts.get(sku) || 0) + 1);
        }
        for (let i = 0; i < skus.length; i++) {
            for (let j = i + 1; j < skus.length; j++) {
                const key = [skus[i], skus[j]].sort().join('|');
                const existing = patterns.get(key) || {
                    count: 0,
                    totalQuantity: 0,
                    recent: 0,
                };
                existing.count++;
                existing.totalQuantity += order.items[i].quantity + order.items[j].quantity;
                if (isRecent)
                    existing.recent++;
                patterns.set(key, existing);
            }
        }
    }
    let created = 0;
    let updated = 0;
    for (const [key, data] of patterns) {
        const [skuA, skuB] = key.split('|');
        const countA = skuOrderCounts.get(skuA) || 1;
        const countB = skuOrderCounts.get(skuB) || 1;
        const rateAtoB = data.count / countA;
        const rateBtoA = data.count / countB;
        for (const [source, recommended, rate] of [
            [skuA, skuB, rateAtoB],
            [skuB, skuA, rateBtoA],
        ]) {
            try {
                const result = await prisma.copurchasePattern.upsert({
                    where: {
                        sourceSku_recommendedSku: { sourceSku: source, recommendedSku: recommended },
                    },
                    update: {
                        copurchaseCount: data.count,
                        copurchaseRate: rate,
                        avgQuantity: data.totalQuantity / data.count / 2,
                        recentOrders: data.recent,
                        lastSeenAt: new Date(),
                    },
                    create: {
                        sourceSku: source,
                        recommendedSku: recommended,
                        copurchaseCount: data.count,
                        copurchaseRate: rate,
                        avgQuantity: data.totalQuantity / data.count / 2,
                        recentOrders: data.recent,
                        direction: 'bidirectional',
                    },
                });
                if (result.createdAt === result.updatedAt)
                    created++;
                else
                    updated++;
            }
            catch {
            }
        }
    }
    return { patternsCreated: created, patternsUpdated: updated };
}
export function generateRecommendationsHtml(recommendations, options = {}) {
    const { columns = 3, showPrice = true, showReason = false, buttonText = 'Shop Now' } = options;
    if (recommendations.length === 0) {
        return '';
    }
    const itemWidth = Math.floor(100 / columns);
    const itemsHtml = recommendations
        .map((rec) => `
    <td style="width: ${itemWidth}%; padding: 10px; text-align: center; vertical-align: top;">
      <a href="${rec.url || '#'}" style="text-decoration: none; color: inherit;">
        ${rec.imageUrl ? `<img src="${rec.imageUrl}" alt="${rec.name}" style="max-width: 100%; height: auto; margin-bottom: 10px;">` : ''}
        <div style="font-weight: 600; margin-bottom: 5px;">${rec.name}</div>
        ${showPrice ? `<div style="color: #666; margin-bottom: 5px;">$${rec.price.toFixed(2)}</div>` : ''}
        ${showReason ? `<div style="font-size: 12px; color: #888; margin-bottom: 10px;">${rec.reason}</div>` : ''}
        <div style="display: inline-block; background: #000; color: #fff; padding: 8px 16px; border-radius: 4px; font-size: 14px;">${buttonText}</div>
      </a>
    </td>
  `)
        .join('');
    const rows = [];
    for (let i = 0; i < recommendations.length; i += columns) {
        const rowItems = itemsHtml
            .split('</td>')
            .slice(i, i + columns)
            .map((item) => item + '</td>')
            .join('');
        rows.push(`<tr>${rowItems}</tr>`);
    }
    return `
    <table style="width: 100%; border-collapse: collapse;">
      ${rows.join('')}
    </table>
  `;
}
