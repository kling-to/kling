import prisma from './prisma';
import { parseQueryDSL, executeQuery as executeBasicQuery, } from './query-executor';
import { executeAggregationQuery } from './query-aggregator';
import { validateQueryComplexity, countConditions, } from './query-complexity';
export function containsAggregation(dsl) {
    if (dsl.aggregation) {
        return true;
    }
    if (dsl.and && Array.isArray(dsl.and)) {
        for (const subDsl of dsl.and) {
            if (containsAggregation(subDsl))
                return true;
        }
    }
    if (dsl.or && Array.isArray(dsl.or)) {
        for (const subDsl of dsl.or) {
            if (containsAggregation(subDsl))
                return true;
        }
    }
    if (dsl.not && containsAggregation(dsl.not)) {
        return true;
    }
    return false;
}
function extractAggregations(dsl, path = []) {
    const result = [];
    if (dsl.aggregation) {
        result.push({ aggregation: dsl.aggregation, path: [...path] });
    }
    if (dsl.and && Array.isArray(dsl.and)) {
        dsl.and.forEach((subDsl, index) => {
            result.push(...extractAggregations(subDsl, [...path, { type: 'and', index }]));
        });
    }
    if (dsl.or && Array.isArray(dsl.or)) {
        dsl.or.forEach((subDsl, index) => {
            result.push(...extractAggregations(subDsl, [...path, { type: 'or', index }]));
        });
    }
    if (dsl.not) {
        result.push(...extractAggregations(dsl.not, [...path, { type: 'not' }]));
    }
    return result;
}
async function executeAggregationForIds(aggregation, options) {
    const aggDsl = {
        aggregation: {
            type: aggregation.type,
            field: aggregation.field,
            operator: aggregation.operator,
            value: aggregation.value,
        },
    };
    const allIds = new Set();
    let page = 1;
    const pageSize = 1000;
    let hasMore = true;
    while (hasMore) {
        const result = await executeAggregationQuery(aggDsl, {
            page,
            pageSize,
            excludeOptedOut: options.excludeOptedOut ?? true,
        });
        for (const customer of result.customers) {
            allIds.add(customer.id);
        }
        hasMore = result.hasMore;
        page++;
        if (page > 100)
            break;
    }
    return allIds;
}
function combineIdSets(sets, logic) {
    if (sets.length === 0)
        return new Set();
    if (sets.length === 1)
        return sets[0];
    if (logic === 'and') {
        let result = new Set(sets[0]);
        for (let i = 1; i < sets.length; i++) {
            result = new Set([...result].filter((id) => sets[i].has(id)));
        }
        return result;
    }
    else {
        const result = new Set();
        for (const set of sets) {
            for (const id of set) {
                result.add(id);
            }
        }
        return result;
    }
}
function stripAggregations(dsl) {
    const result = {};
    if (dsl.filters)
        result.filters = dsl.filters;
    if (dsl.orderBy)
        result.orderBy = dsl.orderBy;
    if (dsl.limit)
        result.limit = dsl.limit;
    if (dsl.offset)
        result.offset = dsl.offset;
    if (dsl.birthdayThisWeek)
        result.birthdayThisWeek = dsl.birthdayThisWeek;
    if (dsl.birthdayThisMonth)
        result.birthdayThisMonth = dsl.birthdayThisMonth;
    if (dsl.orders)
        result.orders = dsl.orders;
    const reservedKeys = new Set([
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
    for (const [key, value] of Object.entries(dsl)) {
        if (!reservedKeys.has(key)) {
            result[key] = value;
        }
    }
    if (dsl.and && Array.isArray(dsl.and)) {
        const strippedAnd = dsl.and
            .map((sub) => stripAggregations(sub))
            .filter((sub) => Object.keys(sub).length > 0 || sub.and || sub.or || sub.not);
        if (strippedAnd.length > 0) {
            result.and = strippedAnd;
        }
    }
    if (dsl.or && Array.isArray(dsl.or)) {
        const strippedOr = dsl.or
            .map((sub) => stripAggregations(sub))
            .filter((sub) => Object.keys(sub).length > 0 || sub.and || sub.or || sub.not);
        if (strippedOr.length > 0) {
            result.or = strippedOr;
        }
    }
    if (dsl.not) {
        const strippedNot = stripAggregations(dsl.not);
        if (Object.keys(strippedNot).length > 0 ||
            strippedNot.and ||
            strippedNot.or ||
            strippedNot.not) {
            result.not = strippedNot;
        }
    }
    return result;
}
async function executeNestedWithAggregations(dsl, options) {
    const startTime = Date.now();
    const matchingIds = await resolveQueryToIds(dsl, options);
    if (matchingIds.size === 0) {
        return {
            customers: [],
            total: 0,
            hasMore: false,
            executionTimeMs: Date.now() - startTime,
            conditionCount: countConditions(dsl),
        };
    }
    if (options.countOnly) {
        return {
            customers: [],
            total: matchingIds.size,
            hasMore: false,
            executionTimeMs: Date.now() - startTime,
            conditionCount: countConditions(dsl),
        };
    }
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 100;
    const skip = (page - 1) * pageSize;
    const idArray = [...matchingIds];
    const paginatedIds = idArray.slice(skip, skip + pageSize + 1);
    const whereClause = {
        id: { in: paginatedIds },
    };
    if (options.excludeOptedOut !== false) {
        whereClause.optOut = false;
    }
    const customers = await prisma.customer.findMany({
        where: whereClause,
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
            metadata: true,
            birthDate: true,
        },
    });
    const hasMore = customers.length > pageSize;
    if (hasMore)
        customers.pop();
    return {
        customers,
        total: matchingIds.size,
        hasMore,
        executionTimeMs: Date.now() - startTime,
        conditionCount: countConditions(dsl),
    };
}
async function resolveQueryToIds(dsl, options) {
    const results = [];
    if (dsl.aggregation) {
        const aggIds = await executeAggregationForIds(dsl.aggregation, options);
        results.push(aggIds);
    }
    const strippedDsl = stripAggregations({
        filters: dsl.filters,
        orders: dsl.orders,
        birthdayThisWeek: dsl.birthdayThisWeek,
        birthdayThisMonth: dsl.birthdayThisMonth,
        ...Object.fromEntries(Object.entries(dsl).filter(([key]) => ![
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
        ].includes(key))),
    });
    const hasFilters = (strippedDsl.filters && strippedDsl.filters.length > 0) ||
        strippedDsl.birthdayThisWeek ||
        strippedDsl.birthdayThisMonth ||
        strippedDsl.orders ||
        Object.keys(strippedDsl).some((key) => ![
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
        ].includes(key));
    if (hasFilters) {
        const filterResult = await executeBasicQuery(strippedDsl, {
            excludeOptedOut: options.excludeOptedOut ?? true,
            maxResults: 100000,
            pageSize: 100000,
        });
        const filterIds = new Set(filterResult.customers.map((c) => c.id));
        results.push(filterIds);
    }
    if (dsl.and && Array.isArray(dsl.and) && dsl.and.length > 0) {
        const andSets = [];
        for (const subDsl of dsl.and) {
            const subIds = await resolveQueryToIds(subDsl, options);
            andSets.push(subIds);
        }
        const andResult = combineIdSets(andSets, 'and');
        results.push(andResult);
    }
    if (dsl.or && Array.isArray(dsl.or) && dsl.or.length > 0) {
        const orSets = [];
        for (const subDsl of dsl.or) {
            const subIds = await resolveQueryToIds(subDsl, options);
            orSets.push(subIds);
        }
        const orResult = combineIdSets(orSets, 'or');
        results.push(orResult);
    }
    let excludeIds = null;
    if (dsl.not) {
        excludeIds = await resolveQueryToIds(dsl.not, options);
    }
    let finalIds;
    if (results.length === 0) {
        const allCustomers = await prisma.customer.findMany({
            where: options.excludeOptedOut !== false ? { optOut: false } : undefined,
            select: { id: true },
        });
        finalIds = new Set(allCustomers.map((c) => c.id));
    }
    else {
        finalIds = combineIdSets(results, 'and');
    }
    if (excludeIds && excludeIds.size > 0) {
        finalIds = new Set([...finalIds].filter((id) => !excludeIds.has(id)));
    }
    return finalIds;
}
export async function executeUnifiedQuery(dslInput, options = {}) {
    const startTime = Date.now();
    const dsl = typeof dslInput === 'string' ? parseQueryDSL(dslInput) : dslInput;
    const validation = validateQueryComplexity(dsl);
    if (!validation.valid) {
        throw new Error(validation.errors.join('; '));
    }
    if (containsAggregation(dsl)) {
        return executeNestedWithAggregations(dsl, options);
    }
    const result = await executeBasicQuery(dsl, {
        excludeOptedOut: options.excludeOptedOut ?? true,
        maxResults: options.maxResults ?? 10000,
        page: options.page ?? 1,
        pageSize: options.pageSize ?? 100,
    });
    return {
        ...result,
        executionTimeMs: Date.now() - startTime,
        conditionCount: countConditions(dsl),
    };
}
export async function executeCountOnlyQuery(dslInput, options = {}) {
    const startTime = Date.now();
    const dsl = typeof dslInput === 'string' ? parseQueryDSL(dslInput) : dslInput;
    const validation = validateQueryComplexity(dsl);
    if (!validation.valid) {
        throw new Error(validation.errors.join('; '));
    }
    const conditionCount = countConditions(dsl);
    if (containsAggregation(dsl)) {
        const result = await executeNestedWithAggregations(dsl, { ...options, countOnly: true });
        return {
            count: result.total,
            executionTimeMs: Date.now() - startTime,
            conditionCount,
        };
    }
    const result = await executeBasicQuery(dsl, {
        excludeOptedOut: options.excludeOptedOut ?? true,
        maxResults: 1,
        pageSize: 1,
    });
    return {
        count: result.total,
        executionTimeMs: Date.now() - startTime,
        conditionCount,
    };
}
export function validateQuery(dslInput) {
    const dsl = typeof dslInput === 'string' ? parseQueryDSL(dslInput) : dslInput;
    return validateQueryComplexity(dsl);
}
