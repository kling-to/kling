/**
 * Query Complexity Validator
 *
 * Validates query complexity to prevent performance issues with deeply nested
 * or overly complex queries. Enforces a maximum of 100 conditions (Klaviyo parity).
 */
/** Maximum allowed conditions in a query (Klaviyo parity) */
export const MAX_QUERY_CONDITIONS = 100;
/** Maximum recommended nesting depth before warning */
export const WARN_NESTING_DEPTH = 5;
/**
 * Count the total number of conditions in a query DSL.
 * Each filter condition, aggregation, and shorthand field counts as one condition.
 */
export function countConditions(dsl) {
    let count = 0;
    // Count explicit filter conditions
    if (dsl.filters && Array.isArray(dsl.filters)) {
        count += dsl.filters.length;
    }
    // Count aggregation as a single condition
    if (dsl.aggregation) {
        count += 1;
    }
    // Count shorthand format fields (e.g., { totalOrders: { gte: 5 } })
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
    for (const key of Object.keys(dsl)) {
        if (!reservedKeys.has(key) && dsl[key] !== undefined) {
            count += 1;
        }
    }
    // Count birthday conditions
    if (dsl.birthdayThisWeek === true)
        count += 1;
    if (dsl.birthdayThisMonth === true)
        count += 1;
    // Count order relation conditions (simplified - counts as 1 condition)
    if (dsl.orders && typeof dsl.orders === 'object') {
        count += 1;
    }
    // Recursively count AND conditions
    if (dsl.and && Array.isArray(dsl.and)) {
        for (const subDsl of dsl.and) {
            count += countConditions(subDsl);
        }
    }
    // Recursively count OR conditions
    if (dsl.or && Array.isArray(dsl.or)) {
        for (const subDsl of dsl.or) {
            count += countConditions(subDsl);
        }
    }
    // Recursively count NOT condition
    if (dsl.not) {
        count += countConditions(dsl.not);
    }
    return count;
}
/**
 * Calculate the maximum nesting depth of a query DSL.
 */
export function getMaxNestingDepth(dsl, currentDepth = 0) {
    let maxDepth = currentDepth;
    // Check AND nesting
    if (dsl.and && Array.isArray(dsl.and)) {
        for (const subDsl of dsl.and) {
            const subDepth = getMaxNestingDepth(subDsl, currentDepth + 1);
            maxDepth = Math.max(maxDepth, subDepth);
        }
    }
    // Check OR nesting
    if (dsl.or && Array.isArray(dsl.or)) {
        for (const subDsl of dsl.or) {
            const subDepth = getMaxNestingDepth(subDsl, currentDepth + 1);
            maxDepth = Math.max(maxDepth, subDepth);
        }
    }
    // Check NOT nesting
    if (dsl.not) {
        const notDepth = getMaxNestingDepth(dsl.not, currentDepth + 1);
        maxDepth = Math.max(maxDepth, notDepth);
    }
    return maxDepth;
}
/**
 * Validate query complexity.
 * Returns errors for conditions that make the query invalid,
 * and warnings for conditions that may cause performance issues.
 */
export function validateQueryComplexity(dsl) {
    const errors = [];
    const warnings = [];
    const conditionCount = countConditions(dsl);
    const nestingDepth = getMaxNestingDepth(dsl);
    // Check condition count limit
    if (conditionCount > MAX_QUERY_CONDITIONS) {
        errors.push(`Query too complex: ${conditionCount} conditions (max: ${MAX_QUERY_CONDITIONS}). ` +
            `Please simplify your query or break it into multiple campaigns.`);
    }
    // Warn if approaching limit
    if (conditionCount > MAX_QUERY_CONDITIONS * 0.8 && conditionCount <= MAX_QUERY_CONDITIONS) {
        warnings.push(`Query approaching complexity limit: ${conditionCount}/${MAX_QUERY_CONDITIONS} conditions. ` +
            `Consider simplifying for better performance.`);
    }
    // Check for empty query
    if (conditionCount === 0) {
        errors.push('Query must have at least one condition');
    }
    // Warn about deep nesting
    if (nestingDepth > WARN_NESTING_DEPTH) {
        warnings.push(`Query has deep nesting (${nestingDepth} levels). ` +
            `Consider flattening for better maintainability and performance.`);
    }
    // Check for double negation (NOT NOT)
    if (dsl.not && dsl.not.not) {
        warnings.push('Double negation detected (NOT NOT). Consider simplifying to a positive condition.');
    }
    // Check for empty AND/OR arrays
    if (dsl.and && Array.isArray(dsl.and) && dsl.and.length === 0) {
        errors.push('Empty AND condition array is not allowed');
    }
    if (dsl.or && Array.isArray(dsl.or) && dsl.or.length === 0) {
        errors.push('Empty OR condition array is not allowed');
    }
    // Check for single-element OR (should be AND or no wrapper)
    if (dsl.or && Array.isArray(dsl.or) && dsl.or.length === 1) {
        warnings.push('OR with single condition is unnecessary - consider removing the OR wrapper');
    }
    return {
        valid: errors.length === 0,
        errors,
        warnings,
        conditionCount,
        nestingDepth,
    };
}
/**
 * Quick check if query is within complexity limits.
 */
export function isQueryWithinLimits(dsl) {
    const conditionCount = countConditions(dsl);
    return conditionCount > 0 && conditionCount <= MAX_QUERY_CONDITIONS;
}
/**
 * Get a human-readable summary of query complexity.
 */
export function getComplexitySummary(dsl) {
    const conditionCount = countConditions(dsl);
    const nestingDepth = getMaxNestingDepth(dsl);
    const parts = [];
    parts.push(`${conditionCount} condition${conditionCount !== 1 ? 's' : ''}`);
    if (nestingDepth > 0) {
        parts.push(`${nestingDepth} level${nestingDepth !== 1 ? 's' : ''} deep`);
    }
    if (conditionCount > MAX_QUERY_CONDITIONS * 0.8) {
        parts.push('(high complexity)');
    }
    else if (nestingDepth > WARN_NESTING_DEPTH) {
        parts.push('(deep nesting)');
    }
    return parts.join(', ');
}
