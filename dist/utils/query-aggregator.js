/**
 * Query Aggregator
 *
 * Provides aggregation-based customer queries using MongoDB's aggregation pipeline.
 * Supports complex queries like "favorite category", "most purchased brand", etc.
 */
import prisma from './prisma';
/**
 * Get customers by their favorite (most purchased) category
 */
export async function getCustomersByFavoriteCategory(category, options = {}) {
    const { page = 1, pageSize = 100, excludeOptedOut = true } = options;
    const skip = (page - 1) * pageSize;
    const pipeline = [
        // Lookup order items
        {
            $lookup: {
                from: 'OrderItem',
                localField: '_id',
                foreignField: 'orderId',
                as: 'items',
            },
        },
        // Unwind items
        { $unwind: '$items' },
        // Group by customer and category to count
        {
            $group: {
                _id: { customerId: '$customerId', category: '$items.category' },
                count: { $sum: '$items.quantity' },
            },
        },
        // Sort by count descending to find favorite
        { $sort: { '_id.customerId': 1, count: -1 } },
        // Group by customer to get top category
        {
            $group: {
                _id: '$_id.customerId',
                favoriteCategory: { $first: '$_id.category' },
                maxCount: { $first: '$count' },
            },
        },
        // Filter by the requested category
        {
            $match: {
                favoriteCategory: { $regex: `^${escapeRegex(category)}$`, $options: 'i' },
            },
        },
    ];
    // First, count total matches
    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline: countPipeline,
        cursor: {},
    });
    const countData = countResult;
    const totalMatches = countData.cursor.firstBatch[0]?.total || 0;
    if (totalMatches === 0) {
        return { customers: [], total: 0, hasMore: false };
    }
    // Add pagination to pipeline (optimization: limit IDs extracted)
    const paginatedPipeline = [
        ...pipeline,
        { $sort: { _id: 1 } },
        { $skip: skip },
        { $limit: pageSize + 1 },
    ];
    const result = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline: paginatedPipeline,
        cursor: {},
    });
    // Extract customer IDs from aggregation result
    const aggResult = result;
    const customerIds = aggResult.cursor.firstBatch.map((r) => r._id.$oid || r._id.toString());
    if (customerIds.length === 0) {
        return { customers: [], total: totalMatches, hasMore: false };
    }
    // Fetch full customer data
    const whereClause = {
        id: { in: customerIds },
    };
    if (excludeOptedOut) {
        whereClause.optOut = false;
    }
    const customers = await prisma.customer.findMany({
        where: whereClause,
        select: {
            id: true,
            email: true,
            phone: true,
            name: true,
            optOut: true,
            lastContactAt: true,
            lastOrderAt: true,
            totalOrders: true,
            totalSpent: true,
        },
    });
    const hasMore = customerIds.length > pageSize;
    const finalCustomers = hasMore ? customers.slice(0, pageSize) : customers;
    return {
        customers: finalCustomers.map((c) => ({ ...c, computed: { favoriteCategory: category } })),
        total: totalMatches,
        hasMore,
    };
}
/**
 * Get customers by their favorite (most purchased) brand
 */
export async function getCustomersByFavoriteBrand(brand, options = {}) {
    const { page = 1, pageSize = 100, excludeOptedOut = true } = options;
    const skip = (page - 1) * pageSize;
    const pipeline = [
        {
            $lookup: {
                from: 'OrderItem',
                localField: '_id',
                foreignField: 'orderId',
                as: 'items',
            },
        },
        { $unwind: '$items' },
        { $match: { 'items.brand': { $ne: null } } },
        {
            $group: {
                _id: { customerId: '$customerId', brand: '$items.brand' },
                count: { $sum: '$items.quantity' },
            },
        },
        { $sort: { '_id.customerId': 1, count: -1 } },
        {
            $group: {
                _id: '$_id.customerId',
                favoriteBrand: { $first: '$_id.brand' },
                maxCount: { $first: '$count' },
            },
        },
        {
            $match: {
                favoriteBrand: { $regex: `^${escapeRegex(brand)}$`, $options: 'i' },
            },
        },
    ];
    const result = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline,
        cursor: {},
    });
    const aggResult = result;
    const customerIds = aggResult.cursor.firstBatch.map((r) => r._id.$oid || r._id.toString());
    if (customerIds.length === 0) {
        return { customers: [], total: 0, hasMore: false };
    }
    const whereClause = {
        id: { in: customerIds },
    };
    if (excludeOptedOut) {
        whereClause.optOut = false;
    }
    const [customers, total] = await Promise.all([
        prisma.customer.findMany({
            where: whereClause,
            skip,
            take: pageSize + 1,
            select: {
                id: true,
                email: true,
                phone: true,
                name: true,
                optOut: true,
                lastContactAt: true,
                lastOrderAt: true,
                totalOrders: true,
                totalSpent: true,
            },
        }),
        prisma.customer.count({ where: whereClause }),
    ]);
    const hasMore = customers.length > pageSize;
    if (hasMore)
        customers.pop();
    return {
        customers: customers.map((c) => ({ ...c, computed: { favoriteBrand: brand } })),
        total,
        hasMore,
    };
}
/**
 * Get customers who have purchased a specific category at least N times
 */
export async function getCustomersByCategoryPurchaseCount(category, minCount, options = {}) {
    const { page = 1, pageSize = 100, excludeOptedOut = true } = options;
    const skip = (page - 1) * pageSize;
    const pipeline = [
        {
            $lookup: {
                from: 'OrderItem',
                localField: '_id',
                foreignField: 'orderId',
                as: 'items',
            },
        },
        { $unwind: '$items' },
        {
            $match: {
                'items.category': { $regex: `^${escapeRegex(category)}$`, $options: 'i' },
            },
        },
        {
            $group: {
                _id: '$customerId',
                categoryCount: { $sum: '$items.quantity' },
            },
        },
        { $match: { categoryCount: { $gte: minCount } } },
    ];
    const result = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline,
        cursor: {},
    });
    const aggResult = result;
    const customerData = aggResult.cursor.firstBatch;
    const customerIds = customerData.map((r) => r._id.$oid || r._id.toString());
    if (customerIds.length === 0) {
        return { customers: [], total: 0, hasMore: false };
    }
    const whereClause = {
        id: { in: customerIds },
    };
    if (excludeOptedOut) {
        whereClause.optOut = false;
    }
    const [customers, total] = await Promise.all([
        prisma.customer.findMany({
            where: whereClause,
            skip,
            take: pageSize + 1,
            select: {
                id: true,
                email: true,
                phone: true,
                name: true,
                optOut: true,
                lastContactAt: true,
                lastOrderAt: true,
                totalOrders: true,
                totalSpent: true,
            },
        }),
        prisma.customer.count({ where: whereClause }),
    ]);
    const hasMore = customers.length > pageSize;
    if (hasMore)
        customers.pop();
    // Create lookup for category counts
    const countLookup = new Map(customerData.map((r) => [r._id.$oid || r._id.toString(), r.categoryCount]));
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { categoryCount: countLookup.get(c.id) || 0, category },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by average order value
 */
export async function getCustomersByAvgOrderValue(operator, value, options = {}) {
    const { page = 1, pageSize = 100, excludeOptedOut = true } = options;
    const skip = (page - 1) * pageSize;
    const matchOp = {};
    matchOp[`$${operator}`] = value;
    const pipeline = [
        {
            $group: {
                _id: '$customerId',
                avgOrderValue: { $avg: '$total' },
                orderCount: { $sum: 1 },
            },
        },
        { $match: { avgOrderValue: matchOp, orderCount: { $gte: 1 } } },
    ];
    const result = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline,
        cursor: {},
    });
    const aggResult = result;
    const customerData = aggResult.cursor.firstBatch;
    const customerIds = customerData.map((r) => r._id.$oid || r._id.toString());
    if (customerIds.length === 0) {
        return { customers: [], total: 0, hasMore: false };
    }
    const whereClause = {
        id: { in: customerIds },
    };
    if (excludeOptedOut) {
        whereClause.optOut = false;
    }
    const [customers, total] = await Promise.all([
        prisma.customer.findMany({
            where: whereClause,
            skip,
            take: pageSize + 1,
            select: {
                id: true,
                email: true,
                phone: true,
                name: true,
                optOut: true,
                lastContactAt: true,
                lastOrderAt: true,
                totalOrders: true,
                totalSpent: true,
            },
        }),
        prisma.customer.count({ where: whereClause }),
    ]);
    const hasMore = customers.length > pageSize;
    if (hasMore)
        customers.pop();
    const avgLookup = new Map(customerData.map((r) => [r._id.$oid || r._id.toString(), r.avgOrderValue]));
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { avgOrderValue: avgLookup.get(c.id) || 0 },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers who last purchased from a specific category
 */
export async function getCustomersByLastPurchasedCategory(category, options = {}) {
    const { page = 1, pageSize = 100, excludeOptedOut = true } = options;
    const skip = (page - 1) * pageSize;
    const pipeline = [
        { $sort: { purchasedAt: -1 } },
        {
            $lookup: {
                from: 'OrderItem',
                localField: '_id',
                foreignField: 'orderId',
                as: 'items',
            },
        },
        { $unwind: '$items' },
        {
            $group: {
                _id: '$customerId',
                lastCategory: { $first: '$items.category' },
                lastPurchaseDate: { $first: '$purchasedAt' },
            },
        },
        {
            $match: {
                lastCategory: { $regex: `^${escapeRegex(category)}$`, $options: 'i' },
            },
        },
    ];
    const result = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline,
        cursor: {},
    });
    const aggResult = result;
    const customerIds = aggResult.cursor.firstBatch.map((r) => r._id.$oid || r._id.toString());
    if (customerIds.length === 0) {
        return { customers: [], total: 0, hasMore: false };
    }
    const whereClause = {
        id: { in: customerIds },
    };
    if (excludeOptedOut) {
        whereClause.optOut = false;
    }
    const [customers, total] = await Promise.all([
        prisma.customer.findMany({
            where: whereClause,
            skip,
            take: pageSize + 1,
            select: {
                id: true,
                email: true,
                phone: true,
                name: true,
                optOut: true,
                lastContactAt: true,
                lastOrderAt: true,
                totalOrders: true,
                totalSpent: true,
            },
        }),
        prisma.customer.count({ where: whereClause }),
    ]);
    const hasMore = customers.length > pageSize;
    if (hasMore)
        customers.pop();
    return {
        customers: customers.map((c) => ({ ...c, computed: { lastCategory: category } })),
        total,
        hasMore,
    };
}
/**
 * Escape special regex characters in a string
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Helper to fetch customers by IDs with standard options
 */
async function fetchCustomersByIds(customerIds, options = {}) {
    const { page = 1, pageSize = 100, excludeOptedOut = true } = options;
    const skip = (page - 1) * pageSize;
    if (customerIds.length === 0) {
        return { customers: [], total: 0, hasMore: false };
    }
    const whereClause = {
        id: { in: customerIds },
    };
    if (excludeOptedOut) {
        whereClause.optOut = false;
    }
    const [customers, total] = await Promise.all([
        prisma.customer.findMany({
            where: whereClause,
            skip,
            take: pageSize + 1,
            select: {
                id: true,
                email: true,
                phone: true,
                name: true,
                optOut: true,
                lastContactAt: true,
                lastOrderAt: true,
                totalOrders: true,
                totalSpent: true,
            },
        }),
        prisma.customer.count({ where: whereClause }),
    ]);
    const hasMore = customers.length > pageSize;
    if (hasMore)
        customers.pop();
    return { customers, total, hasMore };
}
/**
 * Get customers by total orders count
 */
export async function getCustomersByTotalOrders(operator, value, options = {}) {
    const { page = 1, pageSize = 100, excludeOptedOut = true } = options;
    const skip = (page - 1) * pageSize;
    const whereClause = {};
    if (excludeOptedOut) {
        whereClause.optOut = false;
    }
    // Map operator to Prisma format
    const prismaOp = {};
    if (operator === 'eq') {
        prismaOp.equals = value;
    }
    else {
        prismaOp[operator] = value;
    }
    whereClause.totalOrders = prismaOp;
    const [customers, total] = await Promise.all([
        prisma.customer.findMany({
            where: whereClause,
            skip,
            take: pageSize + 1,
            select: {
                id: true,
                email: true,
                phone: true,
                name: true,
                optOut: true,
                lastContactAt: true,
                lastOrderAt: true,
                totalOrders: true,
                totalSpent: true,
            },
        }),
        prisma.customer.count({ where: whereClause }),
    ]);
    const hasMore = customers.length > pageSize;
    if (hasMore)
        customers.pop();
    return {
        customers: customers.map((c) => ({ ...c, computed: { totalOrders: c.totalOrders } })),
        total,
        hasMore,
    };
}
/**
 * Get customers by total spend (lifetime value)
 */
export async function getCustomersByTotalSpend(operator, value, options = {}) {
    const { page = 1, pageSize = 100, excludeOptedOut = true } = options;
    const skip = (page - 1) * pageSize;
    const whereClause = {};
    if (excludeOptedOut) {
        whereClause.optOut = false;
    }
    const prismaOp = {};
    if (operator === 'eq') {
        prismaOp.equals = value;
    }
    else {
        prismaOp[operator] = value;
    }
    whereClause.totalSpent = prismaOp;
    const [customers, total] = await Promise.all([
        prisma.customer.findMany({
            where: whereClause,
            skip,
            take: pageSize + 1,
            select: {
                id: true,
                email: true,
                phone: true,
                name: true,
                optOut: true,
                lastContactAt: true,
                lastOrderAt: true,
                totalOrders: true,
                totalSpent: true,
            },
        }),
        prisma.customer.count({ where: whereClause }),
    ]);
    const hasMore = customers.length > pageSize;
    if (hasMore)
        customers.pop();
    return {
        customers: customers.map((c) => ({ ...c, computed: { totalSpent: c.totalSpent } })),
        total,
        hasMore,
    };
}
/**
 * Get customers by recency (days since last purchase)
 */
export async function getCustomersByRecencyDays(operator, days, options = {}) {
    const { page = 1, pageSize = 100, excludeOptedOut = true } = options;
    const skip = (page - 1) * pageSize;
    const now = new Date();
    const targetDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const whereClause = {
        lastOrderAt: { not: null },
    };
    if (excludeOptedOut) {
        whereClause.optOut = false;
    }
    // Invert operator for date comparison (more days ago = earlier date)
    // "recency >= 30 days" means "lastOrderAt <= 30 days ago"
    const dateOp = {};
    if (operator === 'gte') {
        dateOp.lte = targetDate;
    }
    else if (operator === 'lte') {
        dateOp.gte = targetDate;
    }
    else if (operator === 'gt') {
        dateOp.lt = targetDate;
    }
    else if (operator === 'lt') {
        dateOp.gt = targetDate;
    }
    whereClause.lastOrderAt = dateOp;
    const [customers, total] = await Promise.all([
        prisma.customer.findMany({
            where: whereClause,
            skip,
            take: pageSize + 1,
            select: {
                id: true,
                email: true,
                phone: true,
                name: true,
                optOut: true,
                lastContactAt: true,
                lastOrderAt: true,
                totalOrders: true,
                totalSpent: true,
            },
        }),
        prisma.customer.count({ where: whereClause }),
    ]);
    const hasMore = customers.length > pageSize;
    if (hasMore)
        customers.pop();
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: {
                recencyDays: c.lastOrderAt
                    ? Math.floor((now.getTime() - c.lastOrderAt.getTime()) / (24 * 60 * 60 * 1000))
                    : null,
            },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by average items per order
 */
export async function getCustomersByAvgItemsPerOrder(operator, value, options = {}) {
    const matchOp = {};
    matchOp[`$${operator}`] = value;
    const pipeline = [
        {
            $lookup: {
                from: 'OrderItem',
                localField: '_id',
                foreignField: 'orderId',
                as: 'items',
            },
        },
        {
            $group: {
                _id: '$customerId',
                totalItems: { $sum: { $size: '$items' } },
                orderCount: { $sum: 1 },
            },
        },
        {
            $project: {
                avgItemsPerOrder: { $divide: ['$totalItems', '$orderCount'] },
                orderCount: 1,
            },
        },
        { $match: { avgItemsPerOrder: matchOp, orderCount: { $gte: 1 } } },
    ];
    const result = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline,
        cursor: {},
    });
    const aggResult = result;
    const customerData = aggResult.cursor.firstBatch;
    const customerIds = customerData.map((r) => r._id.$oid || r._id.toString());
    const { customers, total, hasMore } = await fetchCustomersByIds(customerIds, options);
    const avgLookup = new Map(customerData.map((r) => [r._id.$oid || r._id.toString(), r.avgItemsPerOrder]));
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { avgItemsPerOrder: avgLookup.get(c.id) || 0 },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by average days between purchases
 */
export async function getCustomersByAvgDaysBetweenPurchases(operator, days, options = {}) {
    const matchOp = {};
    matchOp[`$${operator}`] = days;
    const pipeline = [
        { $sort: { customerId: 1, purchasedAt: 1 } },
        {
            $group: {
                _id: '$customerId',
                purchaseDates: { $push: '$purchasedAt' },
                orderCount: { $sum: 1 },
            },
        },
        { $match: { orderCount: { $gte: 2 } } }, // Need at least 2 orders to calculate gap
        {
            $project: {
                orderCount: 1,
                firstDate: { $arrayElemAt: ['$purchaseDates', 0] },
                lastDate: { $arrayElemAt: ['$purchaseDates', -1] },
            },
        },
        {
            $project: {
                orderCount: 1,
                avgDaysBetween: {
                    $divide: [
                        { $subtract: ['$lastDate', '$firstDate'] },
                        { $multiply: [1000, 60, 60, 24, { $subtract: ['$orderCount', 1] }] },
                    ],
                },
            },
        },
        { $match: { avgDaysBetween: matchOp } },
    ];
    const result = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline,
        cursor: {},
    });
    const aggResult = result;
    const customerData = aggResult.cursor.firstBatch;
    const customerIds = customerData.map((r) => r._id.$oid || r._id.toString());
    const { customers, total, hasMore } = await fetchCustomersByIds(customerIds, options);
    const avgLookup = new Map(customerData.map((r) => [r._id.$oid || r._id.toString(), Math.round(r.avgDaysBetween)]));
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { avgDaysBetweenPurchases: avgLookup.get(c.id) || 0 },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by first purchase date
 */
export async function getCustomersByFirstPurchaseDate(operator, date, options = {}) {
    const targetDate = new Date(date);
    const matchOp = {};
    matchOp[`$${operator}`] = { $date: targetDate.toISOString() };
    const pipeline = [
        { $sort: { purchasedAt: 1 } },
        {
            $group: {
                _id: '$customerId',
                firstPurchaseDate: { $first: '$purchasedAt' },
            },
        },
        { $match: { firstPurchaseDate: matchOp } },
    ];
    const result = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline,
        cursor: {},
    });
    const aggResult = result;
    const customerData = aggResult.cursor.firstBatch;
    const customerIds = customerData.map((r) => r._id.$oid || r._id.toString());
    const { customers, total, hasMore } = await fetchCustomersByIds(customerIds, options);
    const dateLookup = new Map(customerData.map((r) => [
        r._id.$oid || r._id.toString(),
        r.firstPurchaseDate.$date || r.firstPurchaseDate,
    ]));
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { firstPurchaseDate: dateLookup.get(c.id) },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by last purchase date
 */
export async function getCustomersByLastPurchaseDate(operator, date, options = {}) {
    const { page = 1, pageSize = 100, excludeOptedOut = true } = options;
    const skip = (page - 1) * pageSize;
    const targetDate = new Date(date);
    const whereClause = {
        lastOrderAt: { not: null },
    };
    if (excludeOptedOut) {
        whereClause.optOut = false;
    }
    const dateOp = {};
    dateOp[operator] = targetDate;
    whereClause.lastOrderAt = dateOp;
    const [customers, total] = await Promise.all([
        prisma.customer.findMany({
            where: whereClause,
            skip,
            take: pageSize + 1,
            select: {
                id: true,
                email: true,
                phone: true,
                name: true,
                optOut: true,
                lastContactAt: true,
                lastOrderAt: true,
                totalOrders: true,
                totalSpent: true,
            },
        }),
        prisma.customer.count({ where: whereClause }),
    ]);
    const hasMore = customers.length > pageSize;
    if (hasMore)
        customers.pop();
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { lastPurchaseDate: c.lastOrderAt },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by distinct categories purchased count
 */
export async function getCustomersByDistinctCategoriesCount(operator, count, options = {}) {
    const matchOp = {};
    if (operator === 'eq') {
        matchOp.$eq = count;
    }
    else {
        matchOp[`$${operator}`] = count;
    }
    const pipeline = [
        {
            $lookup: {
                from: 'OrderItem',
                localField: '_id',
                foreignField: 'orderId',
                as: 'items',
            },
        },
        { $unwind: '$items' },
        {
            $group: {
                _id: '$customerId',
                categories: { $addToSet: '$items.category' },
            },
        },
        {
            $project: {
                distinctCategoriesCount: { $size: '$categories' },
            },
        },
        { $match: { distinctCategoriesCount: matchOp } },
    ];
    const result = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline,
        cursor: {},
    });
    const aggResult = result;
    const customerData = aggResult.cursor.firstBatch;
    const customerIds = customerData.map((r) => r._id.$oid || r._id.toString());
    const { customers, total, hasMore } = await fetchCustomersByIds(customerIds, options);
    const countLookup = new Map(customerData.map((r) => [r._id.$oid || r._id.toString(), r.distinctCategoriesCount]));
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { distinctCategoriesCount: countLookup.get(c.id) || 0 },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by lifetime value (alias for total_spend with additional computed fields)
 */
export async function getCustomersByLifetimeValue(operator, value, options = {}) {
    // Lifetime value uses totalSpent as the primary metric
    const result = await getCustomersByTotalSpend(operator, value, options);
    return {
        ...result,
        customers: result.customers.map((c) => ({
            ...c,
            computed: { lifetimeValue: c.totalSpent },
        })),
    };
}
/**
 * Get customers by churn risk score (based on recency and frequency)
 * Score: 0-100, higher = more likely to churn
 * Formula: (days_since_last_order / 90) * 50 + (1 - min(orders/10, 1)) * 50
 */
export async function getCustomersByChurnRiskScore(operator, score, options = {}) {
    const { page = 1, pageSize = 100, excludeOptedOut = true } = options;
    const skip = (page - 1) * pageSize;
    // Map operator to MongoDB operator
    const mongoOperator = {
        gte: '$gte',
        lte: '$lte',
        gt: '$gt',
        lt: '$lt',
    }[operator];
    // Build match conditions
    const matchConditions = {
        totalOrders: { $gte: 1 },
    };
    if (excludeOptedOut) {
        matchConditions.optOut = false;
    }
    // Use MongoDB aggregation pipeline to calculate churn risk score in database
    const pipeline = [
        // Match customers with orders
        { $match: matchConditions },
        // Calculate days since last order using $$NOW for current date
        {
            $addFields: {
                daysSinceLastOrder: {
                    $cond: {
                        if: { $or: [{ $eq: ['$lastOrderAt', null] }, { $not: ['$lastOrderAt'] }] },
                        then: 365,
                        else: {
                            $divide: [{ $subtract: ['$$NOW', '$lastOrderAt'] }, 1000 * 60 * 60 * 24],
                        },
                    },
                },
            },
        },
        // Calculate recency score (capped at 90 days = 50 points)
        {
            $addFields: {
                recencyScore: {
                    $multiply: [{ $min: [{ $divide: ['$daysSinceLastOrder', 90] }, 1] }, 50],
                },
            },
        },
        // Calculate frequency score (fewer orders = higher risk, capped at 10 orders = 0 points)
        {
            $addFields: {
                frequencyScore: {
                    $multiply: [{ $subtract: [1, { $min: [{ $divide: ['$totalOrders', 10] }, 1] }] }, 50],
                },
            },
        },
        // Calculate final churn risk score
        {
            $addFields: {
                churnRiskScore: {
                    $round: [{ $add: ['$recencyScore', '$frequencyScore'] }, 0],
                },
            },
        },
        // Filter by score
        { $match: { churnRiskScore: { [mongoOperator]: score } } },
        // Sort for consistent pagination
        { $sort: { churnRiskScore: -1, _id: 1 } },
    ];
    // First, count total matches with a separate aggregation
    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await prisma.$runCommandRaw({
        aggregate: 'Customer',
        pipeline: countPipeline,
        cursor: {},
    });
    const countData = countResult;
    const total = countData.cursor.firstBatch[0]?.total || 0;
    if (total === 0) {
        return { customers: [], total: 0, hasMore: false };
    }
    // Add pagination to main pipeline
    const paginatedPipeline = [
        ...pipeline,
        { $skip: skip },
        { $limit: pageSize + 1 },
        // Project only needed fields
        {
            $project: {
                _id: 1,
                email: 1,
                phone: 1,
                name: 1,
                optOut: 1,
                lastContactAt: 1,
                lastOrderAt: 1,
                totalOrders: 1,
                totalSpent: 1,
                churnRiskScore: 1,
            },
        },
    ];
    const result = await prisma.$runCommandRaw({
        aggregate: 'Customer',
        pipeline: paginatedPipeline,
        cursor: {},
    });
    const aggResult = result;
    const customers = aggResult.cursor.firstBatch;
    const hasMore = customers.length > pageSize;
    if (hasMore)
        customers.pop();
    return {
        customers: customers.map((c) => ({
            id: c._id.$oid || c._id.toString(),
            email: c.email,
            phone: c.phone,
            name: c.name,
            optOut: c.optOut,
            lastContactAt: c.lastContactAt ? new Date(c.lastContactAt.$date) : null,
            lastOrderAt: c.lastOrderAt ? new Date(c.lastOrderAt.$date) : null,
            totalOrders: c.totalOrders,
            totalSpent: c.totalSpent,
            computed: { churnRiskScore: c.churnRiskScore },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by purchase frequency (orders per month)
 */
export async function getCustomersByPurchaseFrequency(operator, ordersPerMonth, options = {}) {
    const pipeline = [
        { $sort: { customerId: 1, purchasedAt: 1 } },
        {
            $group: {
                _id: '$customerId',
                firstOrder: { $first: '$purchasedAt' },
                lastOrder: { $last: '$purchasedAt' },
                orderCount: { $sum: 1 },
            },
        },
        { $match: { orderCount: { $gte: 1 } } },
        {
            $project: {
                orderCount: 1,
                monthsActive: {
                    $max: [
                        1,
                        {
                            $divide: [
                                { $subtract: ['$lastOrder', '$firstOrder'] },
                                { $multiply: [1000, 60, 60, 24, 30] }, // ms per month (approx)
                            ],
                        },
                    ],
                },
            },
        },
        {
            $project: {
                purchaseFrequency: { $divide: ['$orderCount', '$monthsActive'] },
            },
        },
    ];
    const matchOp = {};
    matchOp[`$${operator}`] = ordersPerMonth;
    pipeline.push({ $match: { purchaseFrequency: matchOp } });
    const result = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline,
        cursor: {},
    });
    const aggResult = result;
    const customerData = aggResult.cursor.firstBatch;
    const customerIds = customerData.map((r) => r._id.$oid || r._id.toString());
    const { customers, total, hasMore } = await fetchCustomersByIds(customerIds, options);
    const freqLookup = new Map(customerData.map((r) => [
        r._id.$oid || r._id.toString(),
        Math.round(r.purchaseFrequency * 100) / 100,
    ]));
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { purchaseFrequency: freqLookup.get(c.id) || 0 },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by top SKU (most purchased SKU)
 */
export async function getCustomersByTopSku(sku, options = {}) {
    const pipeline = [
        {
            $lookup: {
                from: 'OrderItem',
                localField: '_id',
                foreignField: 'orderId',
                as: 'items',
            },
        },
        { $unwind: '$items' },
        {
            $group: {
                _id: { customerId: '$customerId', sku: '$items.sku' },
                count: { $sum: '$items.quantity' },
            },
        },
        { $sort: { '_id.customerId': 1, count: -1 } },
        {
            $group: {
                _id: '$_id.customerId',
                topSku: { $first: '$_id.sku' },
                maxCount: { $first: '$count' },
            },
        },
        {
            $match: {
                topSku: { $regex: `^${escapeRegex(sku)}$`, $options: 'i' },
            },
        },
    ];
    const result = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline,
        cursor: {},
    });
    const aggResult = result;
    const customerIds = aggResult.cursor.firstBatch.map((r) => r._id.$oid || r._id.toString());
    const { customers, total, hasMore } = await fetchCustomersByIds(customerIds, options);
    return {
        customers: customers.map((c) => ({ ...c, computed: { topSku: sku } })),
        total,
        hasMore,
    };
}
/**
 * Get customers by brand purchase count (number of times purchased from a brand)
 */
export async function getCustomersByBrandCount(brand, minCount, options = {}) {
    const pipeline = [
        {
            $lookup: {
                from: 'OrderItem',
                localField: '_id',
                foreignField: 'orderId',
                as: 'items',
            },
        },
        { $unwind: '$items' },
        {
            $match: {
                'items.brand': { $regex: `^${escapeRegex(brand)}$`, $options: 'i' },
            },
        },
        {
            $group: {
                _id: '$customerId',
                brandCount: { $sum: '$items.quantity' },
            },
        },
        { $match: { brandCount: { $gte: minCount } } },
    ];
    const result = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline,
        cursor: {},
    });
    const aggResult = result;
    const customerData = aggResult.cursor.firstBatch;
    const customerIds = customerData.map((r) => r._id.$oid || r._id.toString());
    const { customers, total, hasMore } = await fetchCustomersByIds(customerIds, options);
    const countLookup = new Map(customerData.map((r) => [r._id.$oid || r._id.toString(), r.brandCount]));
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { brandCount: countLookup.get(c.id) || 0, brand },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by median order value
 * Calculates the median of all order totals for each customer
 */
export async function getCustomersByMedianOrderValue(operator, value, options = {}) {
    // Get all orders grouped by customer
    const pipeline = [
        { $sort: { customerId: 1, total: 1 } },
        {
            $group: {
                _id: '$customerId',
                orderTotals: { $push: '$total' },
                orderCount: { $sum: 1 },
            },
        },
        { $match: { orderCount: { $gte: 1 } } },
    ];
    const result = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline,
        cursor: {},
    });
    const aggResult = result;
    // Calculate median for each customer in JS (MongoDB aggregation for median is complex)
    const customersWithMedian = aggResult.cursor.firstBatch
        .map((r) => {
        const totals = r.orderTotals.sort((a, b) => a - b);
        const mid = Math.floor(totals.length / 2);
        const median = totals.length % 2 === 0 ? (totals[mid - 1] + totals[mid]) / 2 : totals[mid];
        return {
            customerId: r._id.$oid || r._id.toString(),
            medianOrderValue: median,
        };
    })
        .filter((c) => {
        switch (operator) {
            case 'gte':
                return c.medianOrderValue >= value;
            case 'lte':
                return c.medianOrderValue <= value;
            case 'gt':
                return c.medianOrderValue > value;
            case 'lt':
                return c.medianOrderValue < value;
            default:
                return false;
        }
    });
    const customerIds = customersWithMedian.map((c) => c.customerId);
    const { customers, total, hasMore } = await fetchCustomersByIds(customerIds, options);
    const medianLookup = new Map(customersWithMedian.map((c) => [c.customerId, c.medianOrderValue]));
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { medianOrderValue: medianLookup.get(c.id) || 0 },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by their most active hour of the day
 * Returns customers who most frequently purchase during the specified hour (0-23)
 */
export async function getCustomersByMostActiveHour(hour, // 0-23
options = {}) {
    const pipeline = [
        {
            $group: {
                _id: {
                    customerId: '$customerId',
                    hour: { $hour: '$purchasedAt' },
                },
                count: { $sum: 1 },
            },
        },
        { $sort: { '_id.customerId': 1, count: -1 } },
        {
            $group: {
                _id: '$_id.customerId',
                mostActiveHour: { $first: '$_id.hour' },
                maxCount: { $first: '$count' },
            },
        },
        { $match: { mostActiveHour: hour } },
    ];
    const result = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline,
        cursor: {},
    });
    const aggResult = result;
    const customerIds = aggResult.cursor.firstBatch.map((r) => r._id.$oid || r._id.toString());
    const { customers, total, hasMore } = await fetchCustomersByIds(customerIds, options);
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { mostActiveHour: hour },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by their most active day of the week
 * Returns customers who most frequently purchase on the specified day (1=Sunday, 7=Saturday)
 */
export async function getCustomersByMostActiveDay(dayOfWeek, // 1=Sunday, 2=Monday, ..., 7=Saturday
options = {}) {
    const pipeline = [
        {
            $group: {
                _id: {
                    customerId: '$customerId',
                    dayOfWeek: { $dayOfWeek: '$purchasedAt' },
                },
                count: { $sum: 1 },
            },
        },
        { $sort: { '_id.customerId': 1, count: -1 } },
        {
            $group: {
                _id: '$_id.customerId',
                mostActiveDay: { $first: '$_id.dayOfWeek' },
                maxCount: { $first: '$count' },
            },
        },
        { $match: { mostActiveDay: dayOfWeek } },
    ];
    const result = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline,
        cursor: {},
    });
    const aggResult = result;
    const customerIds = aggResult.cursor.firstBatch.map((r) => r._id.$oid || r._id.toString());
    const { customers, total, hasMore } = await fetchCustomersByIds(customerIds, options);
    const dayNames = [
        '',
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
    ];
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { mostActiveDay: dayOfWeek, mostActiveDayName: dayNames[dayOfWeek] },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by coupon usage rate
 * Percentage of orders where a coupon was used
 */
export async function getCustomersByCouponUsageRate(operator, rate, // 0-100 percentage
options = {}) {
    const pipeline = [
        {
            $group: {
                _id: '$customerId',
                totalOrders: { $sum: 1 },
                couponOrders: {
                    $sum: {
                        $cond: [{ $and: [{ $ne: ['$couponCode', null] }, { $ne: ['$couponCode', ''] }] }, 1, 0],
                    },
                },
            },
        },
        { $match: { totalOrders: { $gte: 1 } } },
        {
            $project: {
                totalOrders: 1,
                couponOrders: 1,
                couponUsageRate: {
                    $multiply: [{ $divide: ['$couponOrders', '$totalOrders'] }, 100],
                },
            },
        },
    ];
    const matchOp = {};
    matchOp[`$${operator}`] = rate;
    pipeline.push({ $match: { couponUsageRate: matchOp } });
    const result = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline,
        cursor: {},
    });
    const aggResult = result;
    const customerData = aggResult.cursor.firstBatch;
    const customerIds = customerData.map((r) => r._id.$oid || r._id.toString());
    const { customers, total, hasMore } = await fetchCustomersByIds(customerIds, options);
    const rateLookup = new Map(customerData.map((r) => [
        r._id.$oid || r._id.toString(),
        Math.round(r.couponUsageRate * 100) / 100,
    ]));
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { couponUsageRate: rateLookup.get(c.id) || 0 },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by refund rate
 * Percentage of orders that were refunded
 */
export async function getCustomersByRefundRate(operator, rate, // 0-100 percentage
options = {}) {
    const pipeline = [
        {
            $group: {
                _id: '$customerId',
                totalOrders: { $sum: 1 },
                refundedOrders: {
                    $sum: {
                        $cond: [{ $in: ['$status', ['refunded', 'partial_refund']] }, 1, 0],
                    },
                },
            },
        },
        { $match: { totalOrders: { $gte: 1 } } },
        {
            $project: {
                totalOrders: 1,
                refundedOrders: 1,
                refundRate: {
                    $multiply: [{ $divide: ['$refundedOrders', '$totalOrders'] }, 100],
                },
            },
        },
    ];
    const matchOp = {};
    matchOp[`$${operator}`] = rate;
    pipeline.push({ $match: { refundRate: matchOp } });
    const result = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline,
        cursor: {},
    });
    const aggResult = result;
    const customerData = aggResult.cursor.firstBatch;
    const customerIds = customerData.map((r) => r._id.$oid || r._id.toString());
    const { customers, total, hasMore } = await fetchCustomersByIds(customerIds, options);
    const rateLookup = new Map(customerData.map((r) => [r._id.$oid || r._id.toString(), Math.round(r.refundRate * 100) / 100]));
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { refundRate: rateLookup.get(c.id) || 0 },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by return/refund count
 * Number of refunded orders
 */
export async function getCustomersByReturnCount(operator, count, options = {}) {
    const matchOp = {};
    if (operator === 'eq') {
        matchOp.$eq = count;
    }
    else {
        matchOp[`$${operator}`] = count;
    }
    const pipeline = [
        { $match: { status: { $in: ['refunded', 'partial_refund'] } } },
        {
            $group: {
                _id: '$customerId',
                returnCount: { $sum: 1 },
            },
        },
        { $match: { returnCount: matchOp } },
    ];
    const result = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline,
        cursor: {},
    });
    const aggResult = result;
    const customerData = aggResult.cursor.firstBatch;
    const customerIds = customerData.map((r) => r._id.$oid || r._id.toString());
    const { customers, total, hasMore } = await fetchCustomersByIds(customerIds, options);
    const countLookup = new Map(customerData.map((r) => [r._id.$oid || r._id.toString(), r.returnCount]));
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { returnCount: countLookup.get(c.id) || 0 },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by abandoned cart count
 * Uses CustomerEvent with eventType = 'cart_abandoned'
 */
export async function getCustomersByAbandonedCartCount(operator, count, options = {}) {
    const matchOp = {};
    if (operator === 'eq') {
        matchOp.$eq = count;
    }
    else {
        matchOp[`$${operator}`] = count;
    }
    const pipeline = [
        { $match: { eventType: 'cart_abandoned' } },
        {
            $group: {
                _id: '$customerId',
                abandonedCartCount: { $sum: 1 },
            },
        },
        { $match: { abandonedCartCount: matchOp } },
    ];
    const result = await prisma.$runCommandRaw({
        aggregate: 'CustomerEvent',
        pipeline,
        cursor: {},
    });
    const aggResult = result;
    const customerData = aggResult.cursor.firstBatch;
    const customerIds = customerData.map((r) => r._id.$oid || r._id.toString());
    const { customers, total, hasMore } = await fetchCustomersByIds(customerIds, options);
    const countLookup = new Map(customerData.map((r) => [r._id.$oid || r._id.toString(), r.abandonedCartCount]));
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { abandonedCartCount: countLookup.get(c.id) || 0 },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers who are cross-sell candidates
 * Finds customers who bought from category A but not category B
 */
export async function getCustomersByCrossSellCandidates(boughtCategory, notBoughtCategory, options = {}) {
    // First, find customers who bought from the target category
    const boughtPipeline = [
        {
            $lookup: {
                from: 'OrderItem',
                localField: '_id',
                foreignField: 'orderId',
                as: 'items',
            },
        },
        { $unwind: '$items' },
        {
            $match: {
                'items.category': { $regex: `^${escapeRegex(boughtCategory)}$`, $options: 'i' },
            },
        },
        {
            $group: {
                _id: '$customerId',
            },
        },
    ];
    const boughtResult = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline: boughtPipeline,
        cursor: {},
    });
    const boughtCustomers = new Set(boughtResult.cursor.firstBatch.map((r) => r._id.$oid || r._id.toString()));
    if (boughtCustomers.size === 0) {
        return { customers: [], total: 0, hasMore: false };
    }
    // Find customers who bought from the "not bought" category
    const notBoughtPipeline = [
        {
            $lookup: {
                from: 'OrderItem',
                localField: '_id',
                foreignField: 'orderId',
                as: 'items',
            },
        },
        { $unwind: '$items' },
        {
            $match: {
                'items.category': { $regex: `^${escapeRegex(notBoughtCategory)}$`, $options: 'i' },
            },
        },
        {
            $group: {
                _id: '$customerId',
            },
        },
    ];
    const notBoughtResult = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline: notBoughtPipeline,
        cursor: {},
    });
    const alreadyBoughtTarget = new Set(notBoughtResult.cursor.firstBatch.map((r) => r._id.$oid || r._id.toString()));
    // Cross-sell candidates: bought category A but NOT category B
    const crossSellCandidates = [...boughtCustomers].filter((id) => !alreadyBoughtTarget.has(id));
    const { customers, total, hasMore } = await fetchCustomersByIds(crossSellCandidates, options);
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { boughtCategory, notBoughtCategory, isCrossSellCandidate: true },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by upsell conversion rate
 * Based on experiment assignments where customer was in treatment group
 */
export async function getCustomersByUpsellConversionRate(operator, rate, // 0-100 percentage
options = {}) {
    // Get experiment assignments
    const pipeline = [
        {
            $lookup: {
                from: 'Experiment',
                localField: 'experimentId',
                foreignField: '_id',
                as: 'experiment',
            },
        },
        { $unwind: '$experiment' },
        { $match: { cohort: 'treatment' } },
        {
            $group: {
                _id: '$customerId',
                totalAssignments: { $sum: 1 },
                conversions: { $sum: { $cond: ['$converted', 1, 0] } },
            },
        },
        { $match: { totalAssignments: { $gte: 1 } } },
        {
            $project: {
                totalAssignments: 1,
                conversions: 1,
                conversionRate: {
                    $multiply: [{ $divide: ['$conversions', '$totalAssignments'] }, 100],
                },
            },
        },
    ];
    const matchOp = {};
    matchOp[`$${operator}`] = rate;
    pipeline.push({ $match: { conversionRate: matchOp } });
    const result = await prisma.$runCommandRaw({
        aggregate: 'ExperimentAssignment',
        pipeline,
        cursor: {},
    });
    const aggResult = result;
    const customerData = aggResult.cursor.firstBatch;
    const customerIds = customerData.map((r) => r._id.$oid || r._id.toString());
    const { customers, total, hasMore } = await fetchCustomersByIds(customerIds, options);
    const rateLookup = new Map(customerData.map((r) => [
        r._id.$oid || r._id.toString(),
        Math.round(r.conversionRate * 100) / 100,
    ]));
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { upsellConversionRate: rateLookup.get(c.id) || 0 },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by repeat purchase rate
 * Percentage of customers who made more than one purchase
 */
export async function getCustomersByRepeatPurchaseRate(operator, minOrders, // Minimum orders to be considered "repeat"
options = {}) {
    // This returns customers who have made >= minOrders purchases (i.e., repeat customers)
    const { page = 1, pageSize = 100, excludeOptedOut = true } = options;
    const skip = (page - 1) * pageSize;
    const whereClause = {
        totalOrders: { gte: minOrders },
    };
    if (excludeOptedOut) {
        whereClause.optOut = false;
    }
    const [customers, total] = await Promise.all([
        prisma.customer.findMany({
            where: whereClause,
            skip,
            take: pageSize + 1,
            select: {
                id: true,
                email: true,
                phone: true,
                name: true,
                optOut: true,
                lastContactAt: true,
                lastOrderAt: true,
                totalOrders: true,
                totalSpent: true,
            },
        }),
        prisma.customer.count({ where: whereClause }),
    ]);
    const hasMore = customers.length > pageSize;
    if (hasMore)
        customers.pop();
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { isRepeatCustomer: true, totalOrders: c.totalOrders },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by retention (cohort-based)
 * Finds customers from a specific cohort (by first purchase date) who are still active
 */
export async function getCustomersByRetentionRate(cohortStartDate, // e.g., "2024-01-01"
cohortEndDate, // e.g., "2024-01-31"
retentionDays, // Days after cohort to check for activity
options = {}) {
    const cohortStart = new Date(cohortStartDate);
    const cohortEnd = new Date(cohortEndDate);
    const retentionCutoff = new Date(cohortEnd.getTime() + retentionDays * 24 * 60 * 60 * 1000);
    // Find customers whose first purchase was in the cohort period
    const cohortPipeline = [
        { $sort: { purchasedAt: 1 } },
        {
            $group: {
                _id: '$customerId',
                firstPurchase: { $first: '$purchasedAt' },
                lastPurchase: { $last: '$purchasedAt' },
                orderCount: { $sum: 1 },
            },
        },
        {
            $match: {
                firstPurchase: {
                    $gte: { $date: cohortStart.toISOString() },
                    $lte: { $date: cohortEnd.toISOString() },
                },
            },
        },
    ];
    const result = await prisma.$runCommandRaw({
        aggregate: 'Order',
        pipeline: cohortPipeline,
        cursor: {},
    });
    const aggResult = result;
    // Filter for retained customers (had activity after retention period)
    const retainedCustomers = aggResult.cursor.firstBatch.filter((r) => {
        const lastPurchaseDate = typeof r.lastPurchase === 'object' && '$date' in r.lastPurchase
            ? new Date(r.lastPurchase.$date)
            : new Date(r.lastPurchase);
        return lastPurchaseDate >= retentionCutoff && r.orderCount >= 2;
    });
    const customerIds = retainedCustomers.map((r) => r._id.$oid || r._id.toString());
    const { customers, total, hasMore } = await fetchCustomersByIds(customerIds, options);
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: {
                isRetained: true,
                cohortStart: cohortStartDate,
                cohortEnd: cohortEndDate,
                retentionDays,
            },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by preferred contact channel
 */
export async function getCustomersByPreferredContactChannel(channel, options = {}) {
    const { page = 1, pageSize = 100, excludeOptedOut = true } = options;
    const skip = (page - 1) * pageSize;
    const whereClause = {
        preferredChannel: channel,
    };
    if (excludeOptedOut) {
        whereClause.optOut = false;
    }
    const [customers, total] = await Promise.all([
        prisma.customer.findMany({
            where: whereClause,
            skip,
            take: pageSize + 1,
            select: {
                id: true,
                email: true,
                phone: true,
                name: true,
                optOut: true,
                lastContactAt: true,
                lastOrderAt: true,
                totalOrders: true,
                totalSpent: true,
                preferredChannel: true,
            },
        }),
        prisma.customer.count({ where: whereClause }),
    ]);
    const hasMore = customers.length > pageSize;
    if (hasMore)
        customers.pop();
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { preferredChannel: channel },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by predicted lifetime value (from CustomerPrediction model)
 */
export async function getCustomersByPredictedLTV(operator, value, options = {}) {
    const { page = 1, pageSize = 100, excludeOptedOut = true } = options;
    const skip = (page - 1) * pageSize;
    // Build the where clause for CustomerPrediction
    const predictionWhere = {
        predictedLTV: { not: null },
    };
    const opMap = {};
    opMap[operator] = value;
    predictionWhere.predictedLTV = opMap;
    // First, get customer IDs from predictions that match the criteria
    const predictions = await prisma.customerPrediction.findMany({
        where: predictionWhere,
        select: {
            customerId: true,
            predictedLTV: true,
        },
    });
    const customerIds = predictions.map((p) => p.customerId);
    if (customerIds.length === 0) {
        return { customers: [], total: 0, hasMore: false };
    }
    // Build customer where clause
    const customerWhere = {
        id: { in: customerIds },
    };
    if (excludeOptedOut) {
        customerWhere.optOut = false;
    }
    const [customers, total] = await Promise.all([
        prisma.customer.findMany({
            where: customerWhere,
            skip,
            take: pageSize + 1,
            select: {
                id: true,
                email: true,
                phone: true,
                name: true,
                optOut: true,
                lastContactAt: true,
                lastOrderAt: true,
                totalOrders: true,
                totalSpent: true,
            },
        }),
        prisma.customer.count({ where: customerWhere }),
    ]);
    const hasMore = customers.length > pageSize;
    if (hasMore)
        customers.pop();
    // Create lookup for predicted LTV values
    const ltvLookup = new Map(predictions.map((p) => [p.customerId, p.predictedLTV]));
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { predictedLTV: ltvLookup.get(c.id) || 0 },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by engagement score (from CustomerPrediction model)
 */
export async function getCustomersByEngagementScore(operator, value, options = {}) {
    const { page = 1, pageSize = 100, excludeOptedOut = true } = options;
    const skip = (page - 1) * pageSize;
    // Build the where clause for CustomerPrediction
    const predictionWhere = {
        engagementScore: { not: null },
    };
    const opMap = {};
    opMap[operator] = value;
    predictionWhere.engagementScore = opMap;
    // First, get customer IDs from predictions that match the criteria
    const predictions = await prisma.customerPrediction.findMany({
        where: predictionWhere,
        select: {
            customerId: true,
            engagementScore: true,
        },
    });
    const customerIds = predictions.map((p) => p.customerId);
    if (customerIds.length === 0) {
        return { customers: [], total: 0, hasMore: false };
    }
    // Build customer where clause
    const customerWhere = {
        id: { in: customerIds },
    };
    if (excludeOptedOut) {
        customerWhere.optOut = false;
    }
    const [customers, total] = await Promise.all([
        prisma.customer.findMany({
            where: customerWhere,
            skip,
            take: pageSize + 1,
            select: {
                id: true,
                email: true,
                phone: true,
                name: true,
                optOut: true,
                lastContactAt: true,
                lastOrderAt: true,
                totalOrders: true,
                totalSpent: true,
            },
        }),
        prisma.customer.count({ where: customerWhere }),
    ]);
    const hasMore = customers.length > pageSize;
    if (hasMore)
        customers.pop();
    // Create lookup for engagement score values
    const scoreLookup = new Map(predictions.map((p) => [p.customerId, p.engagementScore]));
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { engagementScore: scoreLookup.get(c.id) || 0 },
        })),
        total,
        hasMore,
    };
}
/**
 * Get customers by predicted churn risk (from CustomerPrediction model)
 */
export async function getCustomersByPredictedChurnRisk(operator, value, options = {}) {
    const { page = 1, pageSize = 100, excludeOptedOut = true } = options;
    const skip = (page - 1) * pageSize;
    // Build the where clause for CustomerPrediction
    const predictionWhere = {
        churnRiskScore: { not: null },
    };
    const opMap = {};
    opMap[operator] = value;
    predictionWhere.churnRiskScore = opMap;
    // First, get customer IDs from predictions that match the criteria
    const predictions = await prisma.customerPrediction.findMany({
        where: predictionWhere,
        select: {
            customerId: true,
            churnRiskScore: true,
        },
    });
    const customerIds = predictions.map((p) => p.customerId);
    if (customerIds.length === 0) {
        return { customers: [], total: 0, hasMore: false };
    }
    // Build customer where clause
    const customerWhere = {
        id: { in: customerIds },
    };
    if (excludeOptedOut) {
        customerWhere.optOut = false;
    }
    const [customers, total] = await Promise.all([
        prisma.customer.findMany({
            where: customerWhere,
            skip,
            take: pageSize + 1,
            select: {
                id: true,
                email: true,
                phone: true,
                name: true,
                optOut: true,
                lastContactAt: true,
                lastOrderAt: true,
                totalOrders: true,
                totalSpent: true,
            },
        }),
        prisma.customer.count({ where: customerWhere }),
    ]);
    const hasMore = customers.length > pageSize;
    if (hasMore)
        customers.pop();
    // Create lookup for churn risk values
    const riskLookup = new Map(predictions.map((p) => [p.customerId, p.churnRiskScore]));
    return {
        customers: customers.map((c) => ({
            ...c,
            computed: { churnRiskPredicted: riskLookup.get(c.id) || 0 },
        })),
        total,
        hasMore,
    };
}
/**
 * Execute an aggregation query based on DSL
 */
export async function executeAggregationQuery(dsl, options = {}) {
    const { aggregation } = dsl;
    switch (aggregation.type) {
        case 'favorite_category':
            if (!aggregation.field)
                throw new Error('favorite_category requires field (category name)');
            return getCustomersByFavoriteCategory(aggregation.field, options);
        case 'favorite_brand':
            if (!aggregation.field)
                throw new Error('favorite_brand requires field (brand name)');
            return getCustomersByFavoriteBrand(aggregation.field, options);
        case 'category_count':
            if (!aggregation.field)
                throw new Error('category_count requires field (category name)');
            if (typeof aggregation.value !== 'number')
                throw new Error('category_count requires numeric value');
            return getCustomersByCategoryPurchaseCount(aggregation.field, aggregation.value, options);
        case 'avg_order_value':
            if (!aggregation.operator)
                throw new Error('avg_order_value requires operator');
            if (typeof aggregation.value !== 'number')
                throw new Error('avg_order_value requires numeric value');
            return getCustomersByAvgOrderValue(aggregation.operator, aggregation.value, options);
        case 'last_category':
            if (!aggregation.field)
                throw new Error('last_category requires field (category name)');
            return getCustomersByLastPurchasedCategory(aggregation.field, options);
        case 'total_orders':
            if (!aggregation.operator)
                throw new Error('total_orders requires operator');
            if (typeof aggregation.value !== 'number')
                throw new Error('total_orders requires numeric value');
            return getCustomersByTotalOrders(aggregation.operator, aggregation.value, options);
        case 'total_spend':
            if (!aggregation.operator)
                throw new Error('total_spend requires operator');
            if (typeof aggregation.value !== 'number')
                throw new Error('total_spend requires numeric value');
            return getCustomersByTotalSpend(aggregation.operator, aggregation.value, options);
        case 'lifetime_value':
            if (!aggregation.operator)
                throw new Error('lifetime_value requires operator');
            if (typeof aggregation.value !== 'number')
                throw new Error('lifetime_value requires numeric value');
            return getCustomersByLifetimeValue(aggregation.operator, aggregation.value, options);
        case 'recency_days':
            if (!aggregation.operator)
                throw new Error('recency_days requires operator');
            if (typeof aggregation.value !== 'number')
                throw new Error('recency_days requires numeric value');
            return getCustomersByRecencyDays(aggregation.operator, aggregation.value, options);
        case 'churn_risk_score':
            if (!aggregation.operator)
                throw new Error('churn_risk_score requires operator');
            if (typeof aggregation.value !== 'number')
                throw new Error('churn_risk_score requires numeric value');
            return getCustomersByChurnRiskScore(aggregation.operator, aggregation.value, options);
        case 'purchase_frequency':
            if (!aggregation.operator)
                throw new Error('purchase_frequency requires operator');
            if (typeof aggregation.value !== 'number')
                throw new Error('purchase_frequency requires numeric value');
            return getCustomersByPurchaseFrequency(aggregation.operator, aggregation.value, options);
        case 'avg_items_per_order':
            if (!aggregation.operator)
                throw new Error('avg_items_per_order requires operator');
            if (typeof aggregation.value !== 'number')
                throw new Error('avg_items_per_order requires numeric value');
            return getCustomersByAvgItemsPerOrder(aggregation.operator, aggregation.value, options);
        case 'avg_days_between_purchases':
            if (!aggregation.operator)
                throw new Error('avg_days_between_purchases requires operator');
            if (typeof aggregation.value !== 'number')
                throw new Error('avg_days_between_purchases requires numeric value');
            return getCustomersByAvgDaysBetweenPurchases(aggregation.operator, aggregation.value, options);
        case 'first_purchase_date':
            if (!aggregation.operator)
                throw new Error('first_purchase_date requires operator');
            if (!aggregation.field)
                throw new Error('first_purchase_date requires field (date string)');
            return getCustomersByFirstPurchaseDate(aggregation.operator, aggregation.field, options);
        case 'last_purchase_date':
            if (!aggregation.operator)
                throw new Error('last_purchase_date requires operator');
            if (!aggregation.field)
                throw new Error('last_purchase_date requires field (date string)');
            return getCustomersByLastPurchaseDate(aggregation.operator, aggregation.field, options);
        case 'distinct_categories_count':
            if (!aggregation.operator)
                throw new Error('distinct_categories_count requires operator');
            if (typeof aggregation.value !== 'number')
                throw new Error('distinct_categories_count requires numeric value');
            return getCustomersByDistinctCategoriesCount(aggregation.operator, aggregation.value, options);
        case 'top_sku':
            if (!aggregation.field)
                throw new Error('top_sku requires field (SKU)');
            return getCustomersByTopSku(aggregation.field, options);
        case 'brand_count':
            if (!aggregation.field)
                throw new Error('brand_count requires field (brand name)');
            if (typeof aggregation.value !== 'number')
                throw new Error('brand_count requires numeric value');
            return getCustomersByBrandCount(aggregation.field, aggregation.value, options);
        case 'median_order_value':
            if (!aggregation.operator)
                throw new Error('median_order_value requires operator');
            if (typeof aggregation.value !== 'number')
                throw new Error('median_order_value requires numeric value');
            return getCustomersByMedianOrderValue(aggregation.operator, aggregation.value, options);
        case 'most_active_hour':
            if (typeof aggregation.value !== 'number')
                throw new Error('most_active_hour requires numeric value (0-23)');
            return getCustomersByMostActiveHour(aggregation.value, options);
        case 'most_active_day':
            if (typeof aggregation.value !== 'number')
                throw new Error('most_active_day requires numeric value (1=Sunday, 7=Saturday)');
            return getCustomersByMostActiveDay(aggregation.value, options);
        case 'coupon_usage_rate':
            if (!aggregation.operator)
                throw new Error('coupon_usage_rate requires operator');
            if (typeof aggregation.value !== 'number')
                throw new Error('coupon_usage_rate requires numeric value (0-100)');
            return getCustomersByCouponUsageRate(aggregation.operator, aggregation.value, options);
        case 'refund_rate':
            if (!aggregation.operator)
                throw new Error('refund_rate requires operator');
            if (typeof aggregation.value !== 'number')
                throw new Error('refund_rate requires numeric value (0-100)');
            return getCustomersByRefundRate(aggregation.operator, aggregation.value, options);
        case 'return_count':
            if (!aggregation.operator)
                throw new Error('return_count requires operator');
            if (typeof aggregation.value !== 'number')
                throw new Error('return_count requires numeric value');
            return getCustomersByReturnCount(aggregation.operator, aggregation.value, options);
        case 'abandoned_cart_count':
            if (!aggregation.operator)
                throw new Error('abandoned_cart_count requires operator');
            if (typeof aggregation.value !== 'number')
                throw new Error('abandoned_cart_count requires numeric value');
            return getCustomersByAbandonedCartCount(aggregation.operator, aggregation.value, options);
        case 'cross_sell_candidates':
            if (!aggregation.field)
                throw new Error('cross_sell_candidates requires field (bought category)');
            if (typeof aggregation.value !== 'string')
                throw new Error('cross_sell_candidates requires value (not bought category)');
            return getCustomersByCrossSellCandidates(aggregation.field, aggregation.value, options);
        case 'upsell_conversion_rate':
            if (!aggregation.operator)
                throw new Error('upsell_conversion_rate requires operator');
            if (typeof aggregation.value !== 'number')
                throw new Error('upsell_conversion_rate requires numeric value (0-100)');
            return getCustomersByUpsellConversionRate(aggregation.operator, aggregation.value, options);
        case 'repeat_purchase_rate':
            if (!aggregation.operator)
                throw new Error('repeat_purchase_rate requires operator');
            if (typeof aggregation.value !== 'number')
                throw new Error('repeat_purchase_rate requires numeric value (min orders)');
            return getCustomersByRepeatPurchaseRate(aggregation.operator, aggregation.value, options);
        case 'retention_rate': {
            // For retention_rate, field contains "cohortStart,cohortEnd,retentionDays"
            if (!aggregation.field)
                throw new Error('retention_rate requires field (cohortStart,cohortEnd,retentionDays)');
            const [cohortStart, cohortEnd, retentionDaysStr] = aggregation.field.split(',');
            if (!cohortStart || !cohortEnd || !retentionDaysStr)
                throw new Error('retention_rate field must be "cohortStart,cohortEnd,retentionDays"');
            return getCustomersByRetentionRate(cohortStart.trim(), cohortEnd.trim(), parseInt(retentionDaysStr.trim(), 10), options);
        }
        case 'preferred_contact_channel':
            if (!aggregation.field)
                throw new Error('preferred_contact_channel requires field (email|sms)');
            if (!['email', 'sms'].includes(aggregation.field))
                throw new Error('preferred_contact_channel field must be email or sms');
            return getCustomersByPreferredContactChannel(aggregation.field, options);
        case 'predicted_ltv':
            if (!aggregation.operator)
                throw new Error('predicted_ltv requires operator');
            if (typeof aggregation.value !== 'number')
                throw new Error('predicted_ltv requires numeric value');
            return getCustomersByPredictedLTV(aggregation.operator, aggregation.value, options);
        case 'engagement_score':
            if (!aggregation.operator)
                throw new Error('engagement_score requires operator');
            if (typeof aggregation.value !== 'number')
                throw new Error('engagement_score requires numeric value (0-100)');
            return getCustomersByEngagementScore(aggregation.operator, aggregation.value, options);
        case 'churn_risk_predicted':
            if (!aggregation.operator)
                throw new Error('churn_risk_predicted requires operator');
            if (typeof aggregation.value !== 'number')
                throw new Error('churn_risk_predicted requires numeric value (0-1)');
            return getCustomersByPredictedChurnRisk(aggregation.operator, aggregation.value, options);
        default:
            throw new Error(`Unsupported aggregation type: ${aggregation.type}`);
    }
}
