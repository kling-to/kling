/**
 * Unified Query Executor
 *
 * Handles nested AND/OR/NOT queries that combine regular filters with aggregation queries.
 * This is the main entry point for executing complex campaign queries.
 */
import prisma from './prisma';
import { parseQueryDSL, executeQuery as executeBasicQuery, } from './query-executor';
import { executeAggregationQuery } from './query-aggregator';
import { validateQueryComplexity, countConditions, } from './query-complexity';
/**
 * Check if a DSL contains any aggregation queries (at any nesting level).
 */
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
/**
 * Execute an aggregation query and return matching customer IDs.
 */
async function executeAggregationForIds(aggregation, options) {
    const aggDsl = {
        aggregation: {
            type: aggregation.type,
            field: aggregation.field,
            operator: aggregation.operator,
            value: aggregation.value,
        },
    };
    // Fetch all matching customer IDs (paginate through all results)
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
        // Safety limit to prevent infinite loops
        if (page > 100)
            break;
    }
    return allIds;
}
/**
 * Apply boolean logic to sets of customer IDs.
 */
function combineIdSets(sets, logic) {
    if (sets.length === 0)
        return new Set();
    if (sets.length === 1)
        return sets[0];
    if (logic === 'and') {
        // Intersection: customer must be in ALL sets
        let result = new Set(sets[0]);
        for (let i = 1; i < sets.length; i++) {
            result = new Set([...result].filter((id) => sets[i].has(id)));
        }
        return result;
    }
    else {
        // Union: customer must be in ANY set
        const result = new Set();
        for (const set of sets) {
            for (const id of set) {
                result.add(id);
            }
        }
        return result;
    }
}
/**
 * Build a DSL that excludes aggregation conditions (for Prisma execution).
 */
function stripAggregations(dsl) {
    const result = {};
    // Copy non-aggregation properties
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
    // Copy shorthand fields
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
    // Recursively strip from AND conditions
    if (dsl.and && Array.isArray(dsl.and)) {
        const strippedAnd = dsl.and
            .map((sub) => stripAggregations(sub))
            .filter((sub) => Object.keys(sub).length > 0 || sub.and || sub.or || sub.not);
        if (strippedAnd.length > 0) {
            result.and = strippedAnd;
        }
    }
    // Recursively strip from OR conditions
    if (dsl.or && Array.isArray(dsl.or)) {
        const strippedOr = dsl.or
            .map((sub) => stripAggregations(sub))
            .filter((sub) => Object.keys(sub).length > 0 || sub.and || sub.or || sub.not);
        if (strippedOr.length > 0) {
            result.or = strippedOr;
        }
    }
    // Recursively strip from NOT condition
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
/**
 * Execute a nested query with aggregations using a multi-pass approach:
 * 1. Extract and execute all aggregation queries to get customer IDs
 * 2. Apply boolean logic to combine aggregation results
 * 3. Execute remaining Prisma-compatible filters with ID constraints
 */
async function executeNestedWithAggregations(dsl, options) {
    const startTime = Date.now();
    // Step 1: Recursively resolve the query tree to get customer IDs
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
    // Step 2: If countOnly, just return the count
    if (options.countOnly) {
        return {
            customers: [],
            total: matchingIds.size,
            hasMore: false,
            executionTimeMs: Date.now() - startTime,
            conditionCount: countConditions(dsl),
        };
    }
    // Step 3: Fetch customer details for matching IDs
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
/**
 * Recursively resolve a query DSL to a set of matching customer IDs.
 */
async function resolveQueryToIds(dsl, options) {
    const results = [];
    // Handle aggregation condition
    if (dsl.aggregation) {
        const aggIds = await executeAggregationForIds(dsl.aggregation, options);
        results.push(aggIds);
    }
    // Handle regular filters (non-aggregation conditions)
    const strippedDsl = stripAggregations({
        filters: dsl.filters,
        orders: dsl.orders,
        birthdayThisWeek: dsl.birthdayThisWeek,
        birthdayThisMonth: dsl.birthdayThisMonth,
        // Copy shorthand fields
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
        // Execute basic query for IDs only
        const filterResult = await executeBasicQuery(strippedDsl, {
            excludeOptedOut: options.excludeOptedOut ?? true,
            maxResults: 100000,
            pageSize: 100000,
        });
        const filterIds = new Set(filterResult.customers.map((c) => c.id));
        results.push(filterIds);
    }
    // Handle AND conditions - all must match (intersection)
    if (dsl.and && Array.isArray(dsl.and) && dsl.and.length > 0) {
        const andSets = [];
        for (const subDsl of dsl.and) {
            const subIds = await resolveQueryToIds(subDsl, options);
            andSets.push(subIds);
        }
        const andResult = combineIdSets(andSets, 'and');
        results.push(andResult);
    }
    // Handle OR conditions - any must match (union)
    if (dsl.or && Array.isArray(dsl.or) && dsl.or.length > 0) {
        const orSets = [];
        for (const subDsl of dsl.or) {
            const subIds = await resolveQueryToIds(subDsl, options);
            orSets.push(subIds);
        }
        const orResult = combineIdSets(orSets, 'or');
        results.push(orResult);
    }
    // Handle NOT condition - exclude matching IDs
    let excludeIds = null;
    if (dsl.not) {
        excludeIds = await resolveQueryToIds(dsl.not, options);
    }
    // Combine all results with AND logic (all conditions at this level must match)
    let finalIds;
    if (results.length === 0) {
        // No conditions at this level - get all customers
        const allCustomers = await prisma.customer.findMany({
            where: options.excludeOptedOut !== false ? { optOut: false } : undefined,
            select: { id: true },
        });
        finalIds = new Set(allCustomers.map((c) => c.id));
    }
    else {
        finalIds = combineIdSets(results, 'and');
    }
    // Apply NOT exclusion
    if (excludeIds && excludeIds.size > 0) {
        finalIds = new Set([...finalIds].filter((id) => !excludeIds.has(id)));
    }
    return finalIds;
}
/**
 * Execute a unified query that supports nested AND/OR/NOT with aggregations.
 * This is the main entry point for executing campaign queries.
 */
export async function executeUnifiedQuery(dslInput, options = {}) {
    const startTime = Date.now();
    const dsl = typeof dslInput === 'string' ? parseQueryDSL(dslInput) : dslInput;
    // Validate complexity
    const validation = validateQueryComplexity(dsl);
    if (!validation.valid) {
        throw new Error(validation.errors.join('; '));
    }
    // Check if query contains aggregations
    if (containsAggregation(dsl)) {
        return executeNestedWithAggregations(dsl, options);
    }
    // No aggregations - use the basic query executor
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
/**
 * Execute a count-only query for preview purposes.
 * Optimized for speed - doesn't fetch full customer data.
 */
export async function executeCountOnlyQuery(dslInput, options = {}) {
    const startTime = Date.now();
    const dsl = typeof dslInput === 'string' ? parseQueryDSL(dslInput) : dslInput;
    // Validate complexity
    const validation = validateQueryComplexity(dsl);
    if (!validation.valid) {
        throw new Error(validation.errors.join('; '));
    }
    const conditionCount = countConditions(dsl);
    // Check if query contains aggregations
    if (containsAggregation(dsl)) {
        const result = await executeNestedWithAggregations(dsl, { ...options, countOnly: true });
        return {
            count: result.total,
            executionTimeMs: Date.now() - startTime,
            conditionCount,
        };
    }
    // No aggregations - use optimized count query
    // Build the where clause manually for count
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
/**
 * Validate a query without executing it.
 */
export function validateQuery(dslInput) {
    const dsl = typeof dslInput === 'string' ? parseQueryDSL(dslInput) : dslInput;
    return validateQueryComplexity(dsl);
}
