import prisma from './prisma';
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
const ALLOWED_ORDER_TABLE_FIELDS = new Set(['total', 'purchasedAt']);
const ALLOWED_ORDER_ITEM_FIELDS = new Set(['sku', 'name', 'category', 'price', 'quantity']);
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
function validateField(field) {
    return ALLOWED_CUSTOMER_FIELDS.has(field);
}
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
function convertShorthandToFilters(dsl) {
    const filters = [];
    for (const [key, value] of Object.entries(dsl)) {
        if (RESERVED_DSL_KEYS.has(key)) {
            continue;
        }
        if (!validateField(key)) {
            console.warn(`[QueryExecutor] Skipping unknown field in shorthand: ${key}`);
            continue;
        }
        if (value === null) {
            filters.push({ field: key, operator: 'isNull' });
        }
        else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            const operatorObj = value;
            for (const [op, opValue] of Object.entries(operatorObj)) {
                const operator = op;
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
            filters.push({ field: key, operator: 'eq', value });
        }
    }
    return filters;
}
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
            return null;
        case 'isNotNull':
            return { not: null };
        default:
            return null;
    }
}
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
const CASE_INSENSITIVE_ITEM_FIELDS = new Set(['sku', 'name', 'category']);
function itemConditionToPrisma(condition) {
    const result = {};
    for (const [field, value] of Object.entries(condition)) {
        if (!ALLOWED_ORDER_ITEM_FIELDS.has(field)) {
            console.warn(`[QueryExecutor] Skipping unknown order item field: ${field}`);
            continue;
        }
        const isCaseInsensitive = CASE_INSENSITIVE_ITEM_FIELDS.has(field);
        if (typeof value === 'object' && value !== null) {
            const opObj = value;
            for (const [op, opValue] of Object.entries(opObj)) {
                const prismaOp = operatorToPrisma(op, opValue);
                if (prismaOp) {
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
function orderConditionToPrisma(condition) {
    const result = {};
    for (const [field, value] of Object.entries(condition)) {
        if (field === 'items' && typeof value === 'object' && value !== null) {
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
            const opObj = value;
            for (const [op, opValue] of Object.entries(opObj)) {
                const prismaOp = operatorToPrisma(op, opValue);
                if (prismaOp) {
                    result[field] = prismaOp;
                }
            }
        }
        else {
            result[field] = { equals: value };
        }
    }
    return result;
}
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
function getBirthdayThisWeekRange() {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek);
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(startOfWeek);
        date.setDate(startOfWeek.getDate() + i);
        dates.push({
            month: date.getMonth() + 1,
            day: date.getDate(),
        });
    }
    return { dates };
}
function getBirthdayThisMonthRange() {
    const now = new Date();
    return { month: now.getMonth() + 1 };
}
export function isBirthdayThisWeek(birthDate) {
    if (!birthDate)
        return false;
    const { dates } = getBirthdayThisWeekRange();
    const birthMonth = birthDate.getMonth() + 1;
    const birthDay = birthDate.getDate();
    return dates.some((d) => d.month === birthMonth && d.day === birthDay);
}
export function isBirthdayThisMonth(birthDate) {
    if (!birthDate)
        return false;
    const { month } = getBirthdayThisMonthRange();
    const birthMonth = birthDate.getMonth() + 1;
    return birthMonth === month;
}
function buildBirthdayBaseFilter() {
    return {
        birthDate: { not: null },
    };
}
async function executeBirthdayQuery(birthdayType, options = {}) {
    const { excludeOptedOut = true, page = 1, pageSize = 100 } = options;
    const skip = (page - 1) * pageSize;
    let dateMatchExpr;
    if (birthdayType === 'week') {
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
        const { month } = getBirthdayThisMonthRange();
        dateMatchExpr = { $eq: [{ $month: '$birthDate' }, month] };
    }
    const matchConditions = {
        birthDate: { $ne: null },
    };
    if (excludeOptedOut) {
        matchConditions.optOut = false;
    }
    const pipeline = [
        { $match: matchConditions },
        { $match: { $expr: dateMatchExpr } },
        { $sort: { createdAt: -1 } },
    ];
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
function dslToPrismaWhere(dsl) {
    const conditions = [];
    if (dsl.filters && dsl.filters.length > 0) {
        for (const filter of dsl.filters) {
            const prismaFilter = filterToPrisma(filter);
            if (prismaFilter) {
                conditions.push(prismaFilter);
            }
        }
    }
    const shorthandFilters = convertShorthandToFilters(dsl);
    if (shorthandFilters.length > 0) {
        for (const filter of shorthandFilters) {
            const prismaFilter = filterToPrisma(filter);
            if (prismaFilter) {
                conditions.push(prismaFilter);
            }
        }
    }
    if (dsl.orders && typeof dsl.orders === 'object') {
        const orderFilter = orderFilterToPrisma(dsl.orders);
        if (orderFilter) {
            conditions.push(orderFilter);
        }
    }
    if (dsl.birthdayThisWeek === true || dsl.birthdayThisMonth === true) {
        conditions.push(buildBirthdayBaseFilter());
    }
    if (dsl.and && dsl.and.length > 0) {
        const andConditions = dsl.and.map((subDsl) => dslToPrismaWhere(subDsl));
        conditions.push({ AND: andConditions });
    }
    if (dsl.or && dsl.or.length > 0) {
        const orConditions = dsl.or.map((subDsl) => dslToPrismaWhere(subDsl));
        conditions.push({ OR: orConditions });
    }
    if (dsl.not) {
        const notCondition = dslToPrismaWhere(dsl.not);
        if (Object.keys(notCondition).length > 0) {
            conditions.push({ NOT: notCondition });
        }
    }
    return conditions.length > 0 ? { AND: conditions } : {};
}
export function parseQueryDSL(input) {
    if (typeof input === 'string') {
        try {
            return JSON.parse(input);
        }
        catch {
            return {};
        }
    }
    return input;
}
export async function executeQuery(dsl, options = {}) {
    const { excludeOptedOut = true, maxResults = 10000, page = 1, pageSize = 100 } = options;
    const needsBirthdayWeekFilter = dsl.birthdayThisWeek === true;
    const needsBirthdayMonthFilter = dsl.birthdayThisMonth === true;
    const isOnlyBirthdayQuery = (needsBirthdayWeekFilter || needsBirthdayMonthFilter) &&
        (!dsl.filters || dsl.filters.length === 0) &&
        !dsl.and &&
        !dsl.or &&
        !dsl.orders;
    if (isOnlyBirthdayQuery) {
        const birthdayType = needsBirthdayWeekFilter ? 'week' : 'month';
        return executeBirthdayQuery(birthdayType, {
            excludeOptedOut,
            page,
            pageSize: Math.min(dsl.limit || pageSize, maxResults),
        });
    }
    const needsBirthdayFilter = needsBirthdayWeekFilter || needsBirthdayMonthFilter;
    const where = dslToPrismaWhere(dsl);
    if (excludeOptedOut) {
        if (!where.AND) {
            where.AND = [];
        }
        where.AND.push({ optOut: false });
    }
    const requestedTake = Math.min(dsl.limit || pageSize, maxResults);
    const take = needsBirthdayFilter ? Math.min(requestedTake * 10, maxResults) : requestedTake;
    const skip = dsl.offset ?? (page - 1) * pageSize;
    let orderBy = { createdAt: 'desc' };
    if (dsl.orderBy && ALLOWED_ORDER_FIELDS.has(dsl.orderBy.field)) {
        orderBy = { [dsl.orderBy.field]: dsl.orderBy.direction };
    }
    let [customers, total] = await Promise.all([
        prisma.customer.findMany({
            where,
            orderBy,
            take: take + 1,
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
                birthDate: true,
            },
        }),
        prisma.customer.count({ where }),
    ]);
    if (needsBirthdayWeekFilter) {
        customers = customers.filter((c) => isBirthdayThisWeek(c.birthDate));
        total = customers.length;
    }
    else if (needsBirthdayMonthFilter) {
        customers = customers.filter((c) => isBirthdayThisMonth(c.birthDate));
        total = customers.length;
    }
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
export async function executePreviewQuery(dsl, sampleSize = 10) {
    return executeQuery(dsl, {
        excludeOptedOut: false,
        maxResults: sampleSize,
        pageSize: sampleSize,
    });
}
export function validateQueryDSL(dsl) {
    const errors = [];
    if (dsl.filters) {
        for (const filter of dsl.filters) {
            if (!validateField(filter.field)) {
                errors.push(`Invalid field in filter: ${filter.field}`);
            }
        }
    }
    if (dsl.orderBy && !ALLOWED_ORDER_FIELDS.has(dsl.orderBy.field)) {
        errors.push(`Invalid orderBy field: ${dsl.orderBy.field}`);
    }
    if (dsl.limit !== undefined && (dsl.limit < 1 || dsl.limit > 10000)) {
        errors.push('Limit must be between 1 and 10000');
    }
    if (dsl.offset !== undefined && dsl.offset < 0) {
        errors.push('Offset must be non-negative');
    }
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
