import prisma from './prisma';
// Allowed fields for filtering to prevent injection
const ALLOWED_CUSTOMER_FIELDS = new Set([
    'email',
    'phone',
    'name',
    'optOut',
    'lastContactAt',
    'lastOrderAt',
    'totalOrders',
    'totalSpent',
    'createdAt',
    'updatedAt',
    'birthDate',
]);
// Allowed fields on Order model for relation filters
const ALLOWED_ORDER_TABLE_FIELDS = new Set(['total', 'purchasedAt']);
// Allowed fields on OrderItem model for relation filters
const ALLOWED_ORDER_ITEM_FIELDS = new Set(['sku', 'name', 'category', 'price', 'quantity']);
// Fields that can be used in orderBy expressions
const ALLOWED_ORDER_FIELDS = new Set([
    'createdAt',
    'updatedAt',
    'lastContactAt',
    'lastOrderAt',
    'totalOrders',
    'totalSpent',
    'name',
    'email',
]);
/**
 * Validate that a field name is allowed.
 */
function validateField(field) {
    return ALLOWED_CUSTOMER_FIELDS.has(field);
}
/**
 * Known DSL keys that are NOT field names (reserved for query structure).
 */
const RESERVED_DSL_KEYS = new Set([
    'filters',
    'and',
    'or',
    'not',
    'aggregation',
    'orderBy',
    'limit',
    'offset',
    'orders',
    'birthdayThisWeek',
    'birthdayThisMonth',
]);
/**
 * Convert shorthand format to filter conditions.
 * E.g., { "totalOrders": { "gte": 2 } } -> [{ field: "totalOrders", operator: "gte", value: 2 }]
 */
function convertShorthandToFilters(dsl) {
    const filters = [];
    for (const [key, value] of Object.entries(dsl)) {
        // Skip reserved DSL keys
        if (RESERVED_DSL_KEYS.has(key)) {
            continue;
        }
        // Skip if not a valid customer field
        if (!validateField(key)) {
            console.warn(`[QueryExecutor] Skipping unknown field in shorthand: ${key}`);
            continue;
        }
        // Handle different value formats
        if (value === null) {
            // { "field": null } -> isNull
            filters.push({ field: key, operator: 'isNull' });
        }
        else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            // { "field": { "gte": 2 } } -> operator format
            const operatorObj = value;
            for (const [op, opValue] of Object.entries(operatorObj)) {
                const operator = op;
                // Validate operator
                if ([
                    'eq',
                    'neq',
                    'gt',
                    'gte',
                    'lt',
                    'lte',
                    'contains',
                    'startsWith',
                    'endsWith',
                    'in',
                    'notIn',
                    'isNull',
                    'isNotNull',
                ].includes(operator)) {
                    filters.push({ field: key, operator, value: opValue });
                }
                else {
                    console.warn(`[QueryExecutor] Unknown operator in shorthand: ${op}`);
                }
            }
        }
        else {
            // { "field": value } -> equals
            filters.push({ field: key, operator: 'eq', value });
        }
    }
    return filters;
}
/**
 * Convert operator shorthand to Prisma format.
 * Generic helper used for both customer fields and relation fields.
 */
function operatorToPrisma(operator, value) {
    switch (operator) {
        case 'eq':
            return { equals: value };
        case 'neq':
            return { not: value };
        case 'gt':
            return { gt: value };
        case 'gte':
            return { gte: value };
        case 'lt':
            return { lt: value };
        case 'lte':
            return { lte: value };
        case 'contains':
            return { contains: String(value), mode: 'insensitive' };
        case 'startsWith':
            return { startsWith: String(value), mode: 'insensitive' };
        case 'endsWith':
            return { endsWith: String(value), mode: 'insensitive' };
        case 'in':
            return { in: Array.isArray(value) ? value : [value] };
        case 'notIn':
            return { notIn: Array.isArray(value) ? value : [value] };
        case 'isNull':
            return null; // Special case - handled by caller
        case 'isNotNull':
            return { not: null };
        default:
            return null;
    }
}
/**
 * Convert a single filter condition to Prisma where clause.
 */
function filterToPrisma(filter) {
    if (!validateField(filter.field)) {
        console.warn(`[QueryExecutor] Rejected invalid field: ${filter.field}`);
        return null;
    }
    const { field, operator, value } = filter;
    if (operator === 'isNull') {
        return { [field]: null };
    }
    const prismaOp = operatorToPrisma(operator, value);
    if (prismaOp === null) {
        console.warn(`[QueryExecutor] Unknown operator: ${operator}`);
        return null;
    }
    return { [field]: prismaOp };
}
// String fields in OrderItem that should use case-insensitive matching
const CASE_INSENSITIVE_ITEM_FIELDS = new Set(['sku', 'name', 'category']);
/**
 * Convert an item condition to Prisma OrderItemWhereInput
 */
function itemConditionToPrisma(condition) {
    const result = {};
    for (const [field, value] of Object.entries(condition)) {
        if (!ALLOWED_ORDER_ITEM_FIELDS.has(field)) {
            console.warn(`[QueryExecutor] Skipping unknown order item field: ${field}`);
            continue;
        }
        const isCaseInsensitive = CASE_INSENSITIVE_ITEM_FIELDS.has(field);
        if (typeof value === 'object' && value !== null) {
            // Operator format: { "category": { "eq": "shoes" } }
            const opObj = value;
            for (const [op, opValue] of Object.entries(opObj)) {
                const prismaOp = operatorToPrisma(op, opValue);
                if (prismaOp) {
                    // Add case-insensitive mode for string fields
                    if (isCaseInsensitive && typeof opValue === 'string') {
                        result[field] = { ...prismaOp, mode: 'insensitive' };
                    }
                    else {
                        result[field] = prismaOp;
                    }
                }
            }
        }
        else {
            // Direct value: { "category": "shoes" } -> equals (case-insensitive for strings)
            if (isCaseInsensitive && typeof value === 'string') {
                result[field] = { equals: value, mode: 'insensitive' };
            }
            else {
                result[field] = { equals: value };
            }
        }
    }
    return result;
}
/**
 * Convert an order condition to Prisma OrderWhereInput
 */
function orderConditionToPrisma(condition) {
    const result = {};
    for (const [field, value] of Object.entries(condition)) {
        if (field === 'items' && typeof value === 'object' && value !== null) {
            // Nested items filter
            const itemsFilter = value;
            if (itemsFilter.some) {
                result.items = { some: itemConditionToPrisma(itemsFilter.some) };
            }
            else if (itemsFilter.every) {
                result.items = { every: itemConditionToPrisma(itemsFilter.every) };
            }
            else if (itemsFilter.none) {
                result.items = { none: itemConditionToPrisma(itemsFilter.none) };
            }
            continue;
        }
        if (!ALLOWED_ORDER_TABLE_FIELDS.has(field)) {
            console.warn(`[QueryExecutor] Skipping unknown order field: ${field}`);
            continue;
        }
        if (typeof value === 'object' && value !== null) {
            // Operator format: { "total": { "gte": 200 } }
            const opObj = value;
            for (const [op, opValue] of Object.entries(opObj)) {
                const prismaOp = operatorToPrisma(op, opValue);
                if (prismaOp) {
                    result[field] = prismaOp;
                }
            }
        }
        else {
            // Direct value
            result[field] = { equals: value };
        }
    }
    return result;
}
/**
 * Convert order filter DSL to Prisma CustomerWhereInput for orders relation
 */
function orderFilterToPrisma(orderFilter) {
    if (orderFilter.some) {
        return { orders: { some: orderConditionToPrisma(orderFilter.some) } };
    }
    if (orderFilter.every) {
        return { orders: { every: orderConditionToPrisma(orderFilter.every) } };
    }
    if (orderFilter.none) {
        return { orders: { none: orderConditionToPrisma(orderFilter.none) } };
    }
    return null;
}
/**
 * Get date range for "this week" birthday matching.
 * Returns start and end dates for the current week (Sunday to Saturday).
 */
function getBirthdayThisWeekRange() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday
    // Start of week (Sunday)
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek);
    // Generate all 7 days of the week
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(startOfWeek);
        date.setDate(startOfWeek.getDate() + i);
        dates.push({
            month: date.getMonth() + 1, // 1-indexed
            day: date.getDate(),
        });
    }
    return { dates };
}
/**
 * Get current month for birthday matching.
 */
function getBirthdayThisMonthRange() {
    const now = new Date();
    return { month: now.getMonth() + 1 }; // 1-indexed
}
/**
 * Check if a birthDate falls within the current week (by month and day only).
 * This is used for post-query filtering since MongoDB/Prisma doesn't easily support
 * month+day extraction in WHERE clauses.
 */
export function isBirthdayThisWeek(birthDate) {
    if (!birthDate)
        return false;
    const { dates } = getBirthdayThisWeekRange();
    const birthMonth = birthDate.getMonth() + 1;
    const birthDay = birthDate.getDate();
    return dates.some((d) => d.month === birthMonth && d.day === birthDay);
}
/**
 * Check if a birthDate falls within the current month (by month only).
 */
export function isBirthdayThisMonth(birthDate) {
    if (!birthDate)
        return false;
    const { month } = getBirthdayThisMonthRange();
    const birthMonth = birthDate.getMonth() + 1;
    return birthMonth === month;
}
/**
 * Build a base filter for birthday queries.
 * Since we need to match month/day regardless of year, we just ensure birthDate is not null.
 * The actual month/day filtering happens in post-processing.
 */
function buildBirthdayBaseFilter() {
    return {
        birthDate: { not: null },
    };
}
/**
 * Execute birthday query using MongoDB aggregation with $expr.
 * This is optimized to filter by month/day directly in the database.
 */
async function executeBirthdayQuery(birthdayType, options = {}) {
    const { excludeOptedOut = true, page = 1, pageSize = 100 } = options;
    const skip = (page - 1) * pageSize;
    // Build match conditions for month/day
    let dateMatchExpr;
    if (birthdayType === 'week') {
        // Get all month/day pairs for this week
        const { dates } = getBirthdayThisWeekRange();
        const orConditions = dates.map((d) => ({
            $and: [
                { $eq: [{ $month: '$birthDate' }, d.month] },
                { $eq: [{ $dayOfMonth: '$birthDate' }, d.day] },
            ],
        }));
        dateMatchExpr = { $or: orConditions };
    }
    else {
        // Just match current month
        const { month } = getBirthdayThisMonthRange();
        dateMatchExpr = { $eq: [{ $month: '$birthDate' }, month] };
    }
    // Build base match conditions
    const matchConditions = {
        birthDate: { $ne: null },
    };
    if (excludeOptedOut) {
        matchConditions.optOut = false;
    }
    // Build aggregation pipeline
    const pipeline = [
        { $match: matchConditions },
        { $match: { $expr: dateMatchExpr } },
        { $sort: { createdAt: -1 } },
    ];
    // Count total matches
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
    // Fetch paginated results
    const paginatedPipeline = [
        ...pipeline,
        { $skip: skip },
        { $limit: pageSize + 1 },
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
                metadata: 1,
                birthDate: 1,
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
            id: c._id.$oid || String(c._id),
            email: c.email,
            phone: c.phone,
            name: c.name,
            optOut: c.optOut,
            lastContactAt: c.lastContactAt ? new Date(c.lastContactAt.$date) : null,
            lastOrderAt: c.lastOrderAt ? new Date(c.lastOrderAt.$date) : null,
            totalOrders: c.totalOrders,
            totalSpent: c.totalSpent,
            metadata: c.metadata,
            birthDate: c.birthDate ? new Date(c.birthDate.$date) : null,
        })),
        total,
        hasMore,
    };
}
/**
 * Convert DSL query to Prisma where clause.
 * Supports both structured format (filters array) and shorthand format (field: { operator: value }).
 * Also supports relation filters for orders and order items.
 */
function dslToPrismaWhere(dsl) {
    const conditions = [];
    // Process direct filters (structured format)
    if (dsl.filters && dsl.filters.length > 0) {
        for (const filter of dsl.filters) {
            const prismaFilter = filterToPrisma(filter);
            if (prismaFilter) {
                conditions.push(prismaFilter);
            }
        }
    }
    // Process shorthand format (LLM-generated, e.g., { totalOrders: { gte: 2 } })
    const shorthandFilters = convertShorthandToFilters(dsl);
    if (shorthandFilters.length > 0) {
        for (const filter of shorthandFilters) {
            const prismaFilter = filterToPrisma(filter);
            if (prismaFilter) {
                conditions.push(prismaFilter);
            }
        }
    }
    // Process orders relation filter (for order/item-based queries)
    if (dsl.orders && typeof dsl.orders === 'object') {
        const orderFilter = orderFilterToPrisma(dsl.orders);
        if (orderFilter) {
            conditions.push(orderFilter);
        }
    }
    // Process birthday filters (requires post-filtering, but add base filter to ensure birthDate exists)
    if (dsl.birthdayThisWeek === true || dsl.birthdayThisMonth === true) {
        conditions.push(buildBirthdayBaseFilter());
    }
    // Process AND conditions
    if (dsl.and && dsl.and.length > 0) {
        const andConditions = dsl.and.map((subDsl) => dslToPrismaWhere(subDsl));
        conditions.push({ AND: andConditions });
    }
    // Process OR conditions
    if (dsl.or && dsl.or.length > 0) {
        const orConditions = dsl.or.map((subDsl) => dslToPrismaWhere(subDsl));
        conditions.push({ OR: orConditions });
    }
    // Process NOT condition
    if (dsl.not) {
        const notCondition = dslToPrismaWhere(dsl.not);
        if (Object.keys(notCondition).length > 0) {
            conditions.push({ NOT: notCondition });
        }
    }
    return conditions.length > 0 ? { AND: conditions } : {};
}
/**
 * Parse a JSON string or object into CampaignQueryDSL.
 */
export function parseQueryDSL(input) {
    if (typeof input === 'string') {
        try {
            return JSON.parse(input);
        }
        catch {
            // If not valid JSON, treat as empty query (return all customers)
            return {};
        }
    }
    return input;
}
/**
 * Execute a campaign query against customers.
 *
 * @param dsl The query DSL
 * @param options Additional options
 * @returns Query results with customers
 */
export async function executeQuery(dsl, options = {}) {
    const { excludeOptedOut = true, maxResults = 10000, page = 1, pageSize = 100 } = options;
    // Check if we need birthday filtering - use optimized MongoDB aggregation
    const needsBirthdayWeekFilter = dsl.birthdayThisWeek === true;
    const needsBirthdayMonthFilter = dsl.birthdayThisMonth === true;
    // If only birthday filter is present, use optimized birthday query
    const isOnlyBirthdayQuery = (needsBirthdayWeekFilter || needsBirthdayMonthFilter) &&
        (!dsl.filters || dsl.filters.length === 0) &&
        !dsl.and &&
        !dsl.or &&
        !dsl.orders;
    if (isOnlyBirthdayQuery) {
        // Use optimized MongoDB aggregation for birthday queries
        const birthdayType = needsBirthdayWeekFilter ? 'week' : 'month';
        return executeBirthdayQuery(birthdayType, {
            excludeOptedOut,
            page,
            pageSize: Math.min(dsl.limit || pageSize, maxResults),
        });
    }
    // For combined queries with birthday, still use post-filtering
    const needsBirthdayFilter = needsBirthdayWeekFilter || needsBirthdayMonthFilter;
    // Build where clause
    const where = dslToPrismaWhere(dsl);
    // Add opt-out filter if requested
    if (excludeOptedOut) {
        if (!where.AND) {
            where.AND = [];
        }
        where.AND.push({ optOut: false });
    }
    // Calculate pagination (fetch more if we need to post-filter)
    const requestedTake = Math.min(dsl.limit || pageSize, maxResults);
    // If birthday filtering is needed, fetch more to account for post-filtering
    const take = needsBirthdayFilter ? Math.min(requestedTake * 10, maxResults) : requestedTake;
    const skip = dsl.offset ?? (page - 1) * pageSize;
    // Build orderBy
    let orderBy = { createdAt: 'desc' };
    if (dsl.orderBy && ALLOWED_ORDER_FIELDS.has(dsl.orderBy.field)) {
        orderBy = { [dsl.orderBy.field]: dsl.orderBy.direction };
    }
    // Execute query
    let [customers, total] = await Promise.all([
        prisma.customer.findMany({
            where,
            orderBy,
            take: take + 1, // Fetch one extra to check if there's more
            skip,
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
                metadata: true,
                birthDate: true, // Include birthDate for birthday filtering
            },
        }),
        prisma.customer.count({ where }),
    ]);
    // Apply birthday post-filtering if needed
    if (needsBirthdayWeekFilter) {
        customers = customers.filter((c) => isBirthdayThisWeek(c.birthDate));
        // Recalculate total for birthday queries (approximate - full count would require separate query)
        total = customers.length;
    }
    else if (needsBirthdayMonthFilter) {
        customers = customers.filter((c) => isBirthdayThisMonth(c.birthDate));
        total = customers.length;
    }
    // Check if there are more results
    const hasMore = customers.length > requestedTake;
    if (hasMore) {
        customers = customers.slice(0, requestedTake);
    }
    return {
        customers,
        total,
        hasMore,
    };
}
/**
 * Execute a preview query (limited results, for UI display).
 */
export async function executePreviewQuery(dsl, sampleSize = 10) {
    return executeQuery(dsl, {
        excludeOptedOut: false, // Show all for preview
        maxResults: sampleSize,
        pageSize: sampleSize,
    });
}
/**
 * Validate a DSL query without executing it.
 * Returns any validation errors found.
 */
export function validateQueryDSL(dsl) {
    const errors = [];
    // Validate filters
    if (dsl.filters) {
        for (const filter of dsl.filters) {
            if (!validateField(filter.field)) {
                errors.push(`Invalid field in filter: ${filter.field}`);
            }
        }
    }
    // Validate orderBy
    if (dsl.orderBy && !ALLOWED_ORDER_FIELDS.has(dsl.orderBy.field)) {
        errors.push(`Invalid orderBy field: ${dsl.orderBy.field}`);
    }
    // Validate limit
    if (dsl.limit !== undefined && (dsl.limit < 1 || dsl.limit > 10000)) {
        errors.push('Limit must be between 1 and 10000');
    }
    // Validate offset
    if (dsl.offset !== undefined && dsl.offset < 0) {
        errors.push('Offset must be non-negative');
    }
    // Recursively validate AND/OR/NOT
    if (dsl.and) {
        for (const subDsl of dsl.and) {
            errors.push(...validateQueryDSL(subDsl));
        }
    }
    if (dsl.or) {
        for (const subDsl of dsl.or) {
            errors.push(...validateQueryDSL(subDsl));
        }
    }
    if (dsl.not) {
        errors.push(...validateQueryDSL(dsl.not));
    }
    return errors;
}
