import { getRecommendations, DEFAULT_CONFIG } from './recommendation-engine';
const shortTermCache = new Map();
const CACHE_TTL_MS = 30000;
function getCacheKey(customerId, algorithm, config) {
    return `${customerId}:${algorithm}:${config.limit || 6}:${config.categoryFilter || ''}:${config.brandFilter || ''}`;
}
function cleanExpiredCache() {
    const now = Date.now();
    for (const [key, entry] of shortTermCache.entries()) {
        if (entry.expiresAt < now) {
            shortTermCache.delete(key);
        }
    }
}
export async function fetchRecommendationsForMessage(customerId, config = {}) {
    const algorithm = config.algorithm || 'personalized_mix';
    const cacheKey = getCacheKey(customerId, algorithm, config);
    const cached = shortTermCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
    }
    if (shortTermCache.size > 100) {
        cleanExpiredCache();
    }
    try {
        const engineConfig = {
            limit: config.limit || DEFAULT_CONFIG.limit,
            excludePurchased: config.excludePurchased ?? DEFAULT_CONFIG.excludePurchased,
            categoryFilter: config.categoryFilter,
            brandFilter: config.brandFilter,
            fallbackToBestSellers: true,
        };
        const recommendations = await getRecommendations(customerId, algorithm, engineConfig);
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
        const result = {
            items,
            config: blockConfig,
            algorithm: recommendations.algorithm,
            confidence: recommendations.confidence,
        };
        shortTermCache.set(cacheKey, {
            result,
            expiresAt: Date.now() + CACHE_TTL_MS,
        });
        return result;
    }
    catch (error) {
        console.error(`[recommendation-fetcher] Failed to fetch recommendations for customer ${customerId}:`, error instanceof Error ? error.message : error);
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
export function templateNeedsRecommendations(template) {
    return /\{\{\s*(recommendations|rec[1-6]_\w+)\s*\}\}/.test(template);
}
export function clearRecommendationCache() {
    shortTermCache.clear();
}
