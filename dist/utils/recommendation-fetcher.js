/**
 * Recommendation Fetcher Utility
 *
 * Wrapper for the recommendation engine optimized for message sending.
 * Handles caching, error recovery, and format conversion for template rendering.
 */
import { getRecommendations, DEFAULT_CONFIG } from './recommendation-engine';
// In-memory short-term cache to avoid duplicate fetches in same batch
const shortTermCache = new Map();
const CACHE_TTL_MS = 30000; // 30 seconds
/**
 * Generate cache key for recommendations
 */
function getCacheKey(customerId, algorithm, config) {
    return `${customerId}:${algorithm}:${config.limit || 6}:${config.categoryFilter || ''}:${config.brandFilter || ''}`;
}
/**
 * Clean expired entries from short-term cache
 */
function cleanExpiredCache() {
    const now = Date.now();
    for (const [key, entry] of shortTermCache.entries()) {
        if (entry.expiresAt < now) {
            shortTermCache.delete(key);
        }
    }
}
/**
 * Fetch recommendations for a customer to include in a message.
 * Optimized for use during message sending with graceful error handling.
 *
 * @param customerId - The customer to get recommendations for
 * @param config - Configuration options
 * @returns Recommendations formatted for template rendering, or empty array on error
 */
export async function fetchRecommendationsForMessage(customerId, config = {}) {
    const algorithm = config.algorithm || 'personalized_mix';
    const cacheKey = getCacheKey(customerId, algorithm, config);
    // Check short-term cache
    const cached = shortTermCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
    }
    // Clean expired entries periodically
    if (shortTermCache.size > 100) {
        cleanExpiredCache();
    }
    try {
        // Build recommendation engine config
        const engineConfig = {
            limit: config.limit || DEFAULT_CONFIG.limit,
            excludePurchased: config.excludePurchased ?? DEFAULT_CONFIG.excludePurchased,
            categoryFilter: config.categoryFilter,
            brandFilter: config.brandFilter,
            fallbackToBestSellers: true, // Always fallback for messages
        };
        // Fetch recommendations
        const recommendations = await getRecommendations(customerId, algorithm, engineConfig);
        // Convert to template format (types are identical but keep separation for clarity)
        const items = recommendations.recommendations.map((rec) => ({
            sku: rec.sku,
            name: rec.name,
            category: rec.category,
            brand: rec.brand,
            price: rec.price,
            imageUrl: rec.imageUrl,
            url: rec.url,
            score: rec.score,
            reason: rec.reason,
        }));
        // Build block config
        const blockConfig = {
            columns: config.columns || 3,
            showPrice: config.showPrice ?? true,
            showReason: config.showReason ?? false,
            buttonText: config.buttonText || 'Shop Now',
            currency: config.currency || '$',
        };
        const result = {
            items,
            config: blockConfig,
            algorithm: recommendations.algorithm,
            confidence: recommendations.confidence,
        };
        // Cache the result
        shortTermCache.set(cacheKey, {
            result,
            expiresAt: Date.now() + CACHE_TTL_MS,
        });
        return result;
    }
    catch (error) {
        // Log error but don't fail the message
        console.error(`[recommendation-fetcher] Failed to fetch recommendations for customer ${customerId}:`, error instanceof Error ? error.message : error);
        // Return empty result - message will still send without recommendations
        return {
            items: [],
            config: {
                columns: config.columns || 3,
                showPrice: config.showPrice ?? true,
                showReason: config.showReason ?? false,
                buttonText: config.buttonText || 'Shop Now',
                currency: config.currency || '$',
            },
            algorithm,
            confidence: 0,
        };
    }
}
/**
 * Fetch best sellers (no customer required).
 * Useful for campaigns targeting new or anonymous customers.
 */
export async function fetchBestSellersForMessage(config = {}) {
    try {
        const engineConfig = {
            limit: config.limit || DEFAULT_CONFIG.limit,
            excludePurchased: false,
            categoryFilter: config.categoryFilter,
            brandFilter: config.brandFilter,
            fallbackToBestSellers: false,
        };
        const recommendations = await getRecommendations(null, 'best_sellers', engineConfig);
        const items = recommendations.recommendations.map((rec) => ({
            sku: rec.sku,
            name: rec.name,
            category: rec.category,
            brand: rec.brand,
            price: rec.price,
            imageUrl: rec.imageUrl,
            url: rec.url,
            score: rec.score,
            reason: rec.reason,
        }));
        const blockConfig = {
            columns: config.columns || 3,
            showPrice: config.showPrice ?? true,
            showReason: config.showReason ?? false,
            buttonText: config.buttonText || 'Shop Now',
            currency: config.currency || '$',
        };
        return {
            items,
            config: blockConfig,
            algorithm: 'best_sellers',
            confidence: recommendations.confidence,
        };
    }
    catch (error) {
        console.error('[recommendation-fetcher] Failed to fetch best sellers:', error);
        return {
            items: [],
            config: {
                columns: config.columns || 3,
                showPrice: config.showPrice ?? true,
                showReason: config.showReason ?? false,
                buttonText: config.buttonText || 'Shop Now',
                currency: config.currency || '$',
            },
            algorithm: 'best_sellers',
            confidence: 0,
        };
    }
}
/**
 * Check if a template contains recommendation placeholders.
 * Useful to determine if recommendations should be fetched.
 */
export function templateNeedsRecommendations(template) {
    // Check for {{recommendations}} block or any {{rec1_*}} placeholders
    return /\{\{\s*(recommendations|rec[1-6]_\w+)\s*\}\}/.test(template);
}
/**
 * Clear the short-term cache (for testing)
 */
export function clearRecommendationCache() {
    shortTermCache.clear();
}
