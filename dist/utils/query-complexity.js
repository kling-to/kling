export const MAX_QUERY_CONDITIONS = 100;
export const WARN_NESTING_DEPTH = 5;
export function countConditions(dsl) {
    let count = 0;
    if (dsl.filters && Array.isArray(dsl.filters)) {
        count += dsl.filters.length;
    }
    if (dsl.aggregation) {
        count += 1;
    }
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
    if (dsl.birthdayThisWeek === true)
        count += 1;
    if (dsl.birthdayThisMonth === true)
        count += 1;
    if (dsl.orders && typeof dsl.orders === 'object') {
        count += 1;
    }
    if (dsl.and && Array.isArray(dsl.and)) {
        for (const subDsl of dsl.and) {
            count += countConditions(subDsl);
        }
    }
    if (dsl.or && Array.isArray(dsl.or)) {
        for (const subDsl of dsl.or) {
            count += countConditions(subDsl);
        }
    }
    if (dsl.not) {
        count += countConditions(dsl.not);
    }
    return count;
}
export function getMaxNestingDepth(dsl, currentDepth = 0) {
    let maxDepth = currentDepth;
    if (dsl.and && Array.isArray(dsl.and)) {
        for (const subDsl of dsl.and) {
            const subDepth = getMaxNestingDepth(subDsl, currentDepth + 1);
            maxDepth = Math.max(maxDepth, subDepth);
        }
    }
    if (dsl.or && Array.isArray(dsl.or)) {
        for (const subDsl of dsl.or) {
            const subDepth = getMaxNestingDepth(subDsl, currentDepth + 1);
            maxDepth = Math.max(maxDepth, subDepth);
        }
    }
    if (dsl.not) {
        const notDepth = getMaxNestingDepth(dsl.not, currentDepth + 1);
        maxDepth = Math.max(maxDepth, notDepth);
    }
    return maxDepth;
}
export function validateQueryComplexity(dsl) {
    const errors = [];
    const warnings = [];
    const conditionCount = countConditions(dsl);
    const nestingDepth = getMaxNestingDepth(dsl);
    if (conditionCount > MAX_QUERY_CONDITIONS) {
        errors.push(`Query too complex: ${conditionCount} conditions (max: ${MAX_QUERY_CONDITIONS}). ` +
            `Please simplify your query or break it into multiple campaigns.`);
    }
    if (conditionCount > MAX_QUERY_CONDITIONS * 0.8 && conditionCount <= MAX_QUERY_CONDITIONS) {
        warnings.push(`Query approaching complexity limit: ${conditionCount}/${MAX_QUERY_CONDITIONS} conditions. ` +
            `Consider simplifying for better performance.`);
    }
    if (conditionCount === 0) {
        errors.push('Query must have at least one condition');
    }
    if (nestingDepth > WARN_NESTING_DEPTH) {
        warnings.push(`Query has deep nesting (${nestingDepth} levels). ` +
            `Consider flattening for better maintainability and performance.`);
    }
    if (dsl.not && dsl.not.not) {
        warnings.push('Double negation detected (NOT NOT). Consider simplifying to a positive condition.');
    }
    if (dsl.and && Array.isArray(dsl.and) && dsl.and.length === 0) {
        errors.push('Empty AND condition array is not allowed');
    }
    if (dsl.or && Array.isArray(dsl.or) && dsl.or.length === 0) {
        errors.push('Empty OR condition array is not allowed');
    }
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
export function isQueryWithinLimits(dsl) {
    const conditionCount = countConditions(dsl);
    return conditionCount > 0 && conditionCount <= MAX_QUERY_CONDITIONS;
}
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
