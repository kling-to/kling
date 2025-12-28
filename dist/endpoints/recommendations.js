/**
 * Product Recommendations Endpoints
 *
 * API endpoints for getting personalized product recommendations.
 * This is a COMPETITIVE ADVANTAGE over Klaviyo (which has no recommendations API).
 */
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { authFactory, createAuthRoleFactory } from '../factories';
import { objectIdSchema } from '../utils/validation';
import { getRecommendations, updateCopurchasePatterns, generateRecommendationsHtml, DEFAULT_CONFIG, } from '../utils/recommendation-engine';
const prisma = new PrismaClient();
// Role factories
const staffFactory = createAuthRoleFactory('admin', 'manager', 'staff');
const managerFactory = createAuthRoleFactory('admin', 'manager');
const adminFactory = createAuthRoleFactory('admin');
// Common schemas
const algorithmSchema = z.enum([
    'best_sellers',
    'recently_viewed',
    'collaborative_filter',
    'copurchase',
    'content_based',
    'personalized_mix',
]);
const recommendationItemSchema = z.object({
    sku: z.string(),
    name: z.string(),
    category: z.string().nullable(),
    brand: z.string().nullable(),
    price: z.number(),
    imageUrl: z.string().nullable(),
    url: z.string().nullable(),
    score: z.number(),
    reason: z.string(),
});
// -------------------------------------------------------------------
// GET /v1/recommendations/:customerId
// Get product recommendations for a specific customer
// -------------------------------------------------------------------
export const getCustomerRecommendationsEndpoint = staffFactory.build({
    method: 'get',
    shortDescription: 'Get Customer Recommendations',
    description: 'Get personalized product recommendations for a customer using various algorithms',
    tag: 'Recommendations',
    input: z.object({
        customerId: objectIdSchema,
        algorithm: algorithmSchema.default('personalized_mix'),
        limit: z.coerce.number().min(1).max(20).default(6),
        excludePurchased: z.coerce.boolean().default(true),
        categoryFilter: z.string().optional(),
        brandFilter: z.string().optional(),
        fallback: z.coerce.boolean().default(true),
    }),
    output: z.object({
        customerId: z.string(),
        algorithm: algorithmSchema,
        recommendations: z.array(recommendationItemSchema),
        confidence: z.number(),
        generatedAt: z.string(),
        cached: z.boolean(),
    }),
    handler: async ({ input }) => {
        // Verify customer exists
        const customer = await prisma.customer.findUnique({
            where: { id: input.customerId },
        });
        if (!customer) {
            throw new Error('Customer not found');
        }
        const result = await getRecommendations(input.customerId, input.algorithm, {
            limit: input.limit,
            lookbackDays: DEFAULT_CONFIG.lookbackDays,
            excludePurchased: input.excludePurchased,
            categoryFilter: input.categoryFilter,
            brandFilter: input.brandFilter,
            fallbackToBestSellers: input.fallback,
        });
        return {
            customerId: input.customerId,
            algorithm: result.algorithm,
            recommendations: result.recommendations,
            confidence: result.confidence,
            generatedAt: result.generatedAt.toISOString(),
            cached: result.cached,
        };
    },
});
// -------------------------------------------------------------------
// GET /v1/recommendations/best-sellers
// Get global best sellers (no customer required)
// -------------------------------------------------------------------
export const getBestSellersEndpoint = staffFactory.build({
    method: 'get',
    shortDescription: 'Get Best Sellers',
    description: 'Get top selling products globally (recency-weighted)',
    tag: 'Recommendations',
    input: z.object({
        limit: z.coerce.number().min(1).max(50).default(10),
        categoryFilter: z.string().optional(),
        brandFilter: z.string().optional(),
        lookbackDays: z.coerce.number().min(7).max(365).default(90),
    }),
    output: z.object({
        algorithm: z.literal('best_sellers'),
        recommendations: z.array(recommendationItemSchema),
        confidence: z.number(),
        generatedAt: z.string(),
    }),
    handler: async ({ input }) => {
        const result = await getRecommendations(null, // Null customer ID for global recommendations
        'best_sellers', {
            limit: input.limit,
            lookbackDays: input.lookbackDays,
            excludePurchased: false,
            categoryFilter: input.categoryFilter,
            brandFilter: input.brandFilter,
            fallbackToBestSellers: false,
        });
        return {
            algorithm: 'best_sellers',
            recommendations: result.recommendations,
            confidence: result.confidence,
            generatedAt: result.generatedAt.toISOString(),
        };
    },
});
// -------------------------------------------------------------------
// POST /v1/recommendations/:customerId/html
// Generate HTML recommendations block for emails
// -------------------------------------------------------------------
export const generateRecommendationsHtmlEndpoint = staffFactory.build({
    method: 'post',
    shortDescription: 'Generate Recommendations HTML',
    description: 'Generate HTML block with product recommendations for email templates',
    tag: 'Recommendations',
    input: z.object({
        customerId: objectIdSchema,
        algorithm: algorithmSchema.default('personalized_mix'),
        limit: z.coerce.number().min(1).max(12).default(6),
        columns: z.coerce.number().min(1).max(4).default(3),
        showPrice: z.boolean().default(true),
        showReason: z.boolean().default(false),
        buttonText: z.string().default('Shop Now'),
        excludePurchased: z.boolean().default(true),
        categoryFilter: z.string().optional(),
        brandFilter: z.string().optional(),
    }),
    output: z.object({
        html: z.string(),
        recommendationCount: z.number(),
        algorithm: algorithmSchema,
        confidence: z.number(),
    }),
    handler: async ({ input }) => {
        const result = await getRecommendations(input.customerId, input.algorithm, {
            limit: input.limit,
            lookbackDays: DEFAULT_CONFIG.lookbackDays,
            excludePurchased: input.excludePurchased,
            categoryFilter: input.categoryFilter,
            brandFilter: input.brandFilter,
            fallbackToBestSellers: true,
        });
        const html = generateRecommendationsHtml(result.recommendations, {
            columns: input.columns,
            showPrice: input.showPrice,
            showReason: input.showReason,
            buttonText: input.buttonText,
        });
        return {
            html,
            recommendationCount: result.recommendations.length,
            algorithm: result.algorithm,
            confidence: result.confidence,
        };
    },
});
// -------------------------------------------------------------------
// POST /v1/recommendations/track-click
// Track when a customer clicks a recommendation
// -------------------------------------------------------------------
export const trackRecommendationClickEndpoint = authFactory.build({
    method: 'post',
    shortDescription: 'Track Recommendation Click',
    description: 'Track when a customer clicks on a recommended product',
    tag: 'Recommendations',
    input: z.object({
        customerId: objectIdSchema,
        algorithm: algorithmSchema,
        recommendedSku: z.string(),
        position: z.number().min(1),
        context: z.enum(['email', 'campaign', 'flow', 'api']),
        campaignId: objectIdSchema.optional(),
        flowId: objectIdSchema.optional(),
        messageLogId: objectIdSchema.optional(),
    }),
    output: z.object({
        success: z.boolean(),
        clickId: z.string(),
    }),
    handler: async ({ input }) => {
        const click = await prisma.recommendationClick.create({
            data: {
                customerId: input.customerId,
                algorithm: input.algorithm,
                recommendedSku: input.recommendedSku,
                position: input.position,
                context: input.context,
                campaignId: input.campaignId,
                flowId: input.flowId,
                messageLogId: input.messageLogId,
                clicked: true,
                clickedAt: new Date(),
            },
        });
        return {
            success: true,
            clickId: click.id,
        };
    },
});
// -------------------------------------------------------------------
// POST /v1/recommendations/track-purchase
// Track when a clicked recommendation leads to purchase
// -------------------------------------------------------------------
export const trackRecommendationPurchaseEndpoint = authFactory.build({
    method: 'post',
    shortDescription: 'Track Recommendation Purchase',
    description: 'Track when a recommended product is purchased',
    tag: 'Recommendations',
    input: z.object({
        clickId: objectIdSchema,
        purchaseValue: z.number().min(0),
    }),
    output: z.object({
        success: z.boolean(),
    }),
    handler: async ({ input }) => {
        await prisma.recommendationClick.update({
            where: { id: input.clickId },
            data: {
                purchased: true,
                purchasedAt: new Date(),
                purchaseValue: input.purchaseValue,
            },
        });
        return { success: true };
    },
});
// -------------------------------------------------------------------
// POST /v1/recommendations/rebuild-patterns
// Rebuild copurchase patterns from order data (admin only)
// -------------------------------------------------------------------
export const rebuildCopurchasePatternsEndpoint = adminFactory.build({
    method: 'post',
    shortDescription: 'Rebuild Copurchase Patterns',
    description: "Rebuild 'frequently bought together' patterns from order data",
    tag: 'Recommendations',
    input: z.object({}),
    output: z.object({
        success: z.boolean(),
        patternsCreated: z.number(),
        patternsUpdated: z.number(),
    }),
    handler: async () => {
        const result = await updateCopurchasePatterns();
        return {
            success: true,
            patternsCreated: result.patternsCreated,
            patternsUpdated: result.patternsUpdated,
        };
    },
});
// -------------------------------------------------------------------
// GET /v1/recommendations/analytics
// Get recommendation performance analytics
// -------------------------------------------------------------------
export const getRecommendationAnalyticsEndpoint = managerFactory.build({
    method: 'get',
    shortDescription: 'Get Recommendation Analytics',
    description: 'Get performance metrics for product recommendations',
    tag: 'Recommendations',
    input: z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        algorithm: algorithmSchema.optional(),
    }),
    output: z.object({
        totalClicks: z.number(),
        totalPurchases: z.number(),
        purchaseRate: z.number(),
        totalRevenue: z.number(),
        avgPosition: z.number(),
        byAlgorithm: z.array(z.object({
            algorithm: z.string(),
            clicks: z.number(),
            purchases: z.number(),
            purchaseRate: z.number(),
            revenue: z.number(),
        })),
        topProducts: z.array(z.object({
            sku: z.string(),
            clicks: z.number(),
            purchases: z.number(),
            revenue: z.number(),
        })),
    }),
    handler: async ({ input }) => {
        const dateFilter = {};
        if (input.startDate) {
            dateFilter.clickedAt = { ...dateFilter.clickedAt, gte: new Date(input.startDate) };
        }
        if (input.endDate) {
            dateFilter.clickedAt = { ...dateFilter.clickedAt, lte: new Date(input.endDate) };
        }
        const algorithmFilter = {};
        if (input.algorithm) {
            algorithmFilter.algorithm = input.algorithm;
        }
        // Get overall stats
        const clicks = await prisma.recommendationClick.findMany({
            where: { ...dateFilter, ...algorithmFilter },
        });
        const totalClicks = clicks.length;
        const purchases = clicks.filter((c) => c.purchased);
        const totalPurchases = purchases.length;
        const totalRevenue = purchases.reduce((sum, p) => sum + (p.purchaseValue || 0), 0);
        const purchaseRate = totalClicks > 0 ? totalPurchases / totalClicks : 0;
        const avgPosition = totalClicks > 0 ? clicks.reduce((sum, c) => sum + c.position, 0) / totalClicks : 0;
        // Group by algorithm
        const byAlgorithmMap = new Map();
        for (const click of clicks) {
            const key = click.algorithm;
            const existing = byAlgorithmMap.get(key) || {
                clicks: 0,
                purchases: 0,
                revenue: 0,
            };
            existing.clicks++;
            if (click.purchased) {
                existing.purchases++;
                existing.revenue += click.purchaseValue || 0;
            }
            byAlgorithmMap.set(key, existing);
        }
        const byAlgorithm = Array.from(byAlgorithmMap.entries()).map(([algorithm, data]) => ({
            algorithm,
            clicks: data.clicks,
            purchases: data.purchases,
            purchaseRate: data.clicks > 0 ? data.purchases / data.clicks : 0,
            revenue: data.revenue,
        }));
        // Top products
        const byProductMap = new Map();
        for (const click of clicks) {
            const key = click.recommendedSku;
            const existing = byProductMap.get(key) || {
                clicks: 0,
                purchases: 0,
                revenue: 0,
            };
            existing.clicks++;
            if (click.purchased) {
                existing.purchases++;
                existing.revenue += click.purchaseValue || 0;
            }
            byProductMap.set(key, existing);
        }
        const topProducts = Array.from(byProductMap.entries())
            .map(([sku, data]) => ({
            sku,
            clicks: data.clicks,
            purchases: data.purchases,
            revenue: data.revenue,
        }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 10);
        return {
            totalClicks,
            totalPurchases,
            purchaseRate,
            totalRevenue,
            avgPosition,
            byAlgorithm,
            topProducts,
        };
    },
});
// -------------------------------------------------------------------
// Products CRUD (for product catalog management)
// -------------------------------------------------------------------
// List products
export const listProductsEndpoint = staffFactory.build({
    method: 'get',
    shortDescription: 'List Products',
    description: 'List products in the catalog with filtering and pagination',
    tag: 'Products',
    input: z.object({
        page: z.coerce.number().min(1).default(1),
        pageSize: z.coerce.number().min(1).max(100).default(20),
        search: z.string().optional(),
        category: z.string().optional(),
        brand: z.string().optional(),
        isActive: z.coerce.boolean().optional(),
        inStock: z.coerce.boolean().optional(),
    }),
    output: z.object({
        products: z.array(z.object({
            id: z.string(),
            sku: z.string(),
            name: z.string(),
            category: z.string().nullable(),
            brand: z.string().nullable(),
            price: z.number(),
            salePrice: z.number().nullable(),
            imageUrl: z.string().nullable(),
            inventory: z.number(),
            inStock: z.boolean(),
            isActive: z.boolean(),
            isNewArrival: z.boolean(),
            isOnSale: z.boolean(),
            createdAt: z.string(),
        })),
        total: z.number(),
        page: z.number(),
        pageSize: z.number(),
        hasMore: z.boolean(),
    }),
    handler: async ({ input }) => {
        const where = {};
        if (input.search) {
            where.OR = [
                { name: { contains: input.search, mode: 'insensitive' } },
                { sku: { contains: input.search, mode: 'insensitive' } },
            ];
        }
        if (input.category)
            where.category = input.category;
        if (input.brand)
            where.brand = input.brand;
        if (input.isActive !== undefined)
            where.isActive = input.isActive;
        if (input.inStock !== undefined)
            where.inStock = input.inStock;
        const [products, total] = await Promise.all([
            prisma.product.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (input.page - 1) * input.pageSize,
                take: input.pageSize,
            }),
            prisma.product.count({ where }),
        ]);
        return {
            products: products.map((p) => ({
                id: p.id,
                sku: p.sku,
                name: p.name,
                category: p.category,
                brand: p.brand,
                price: p.price,
                salePrice: p.salePrice,
                imageUrl: p.imageUrl,
                inventory: p.inventory,
                inStock: p.inStock,
                isActive: p.isActive,
                isNewArrival: p.isNewArrival,
                isOnSale: p.isOnSale,
                createdAt: p.createdAt.toISOString(),
            })),
            total,
            page: input.page,
            pageSize: input.pageSize,
            hasMore: input.page * input.pageSize < total,
        };
    },
});
// Upsert product
export const upsertProductEndpoint = managerFactory.build({
    method: 'post',
    shortDescription: 'Create or Update Product',
    description: 'Create a new product or update existing by SKU',
    tag: 'Products',
    input: z.object({
        sku: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
        category: z.string().optional(),
        subcategory: z.string().optional(),
        brand: z.string().optional(),
        tags: z.array(z.string()).optional(),
        price: z.number().min(0),
        salePrice: z.number().min(0).optional(),
        currency: z.string().default('USD'),
        imageUrl: z.string().url().optional(),
        thumbnailUrl: z.string().url().optional(),
        imageUrls: z.array(z.string().url()).optional(),
        inventory: z.number().int().min(0).optional(),
        inStock: z.boolean().optional(),
        isActive: z.boolean().default(true),
        isNewArrival: z.boolean().default(false),
        isOnSale: z.boolean().default(false),
        excludeFromRecommendations: z.boolean().default(false),
        externalId: z.string().optional(),
        platform: z.string().optional(),
        url: z.string().url().optional(),
    }),
    output: z.object({
        product: z.object({
            id: z.string(),
            sku: z.string(),
            name: z.string(),
            createdAt: z.string(),
            updatedAt: z.string(),
        }),
        created: z.boolean(),
    }),
    handler: async ({ input }) => {
        const existing = await prisma.product.findUnique({
            where: { sku: input.sku },
        });
        const product = await prisma.product.upsert({
            where: { sku: input.sku },
            update: {
                name: input.name,
                description: input.description,
                category: input.category,
                subcategory: input.subcategory,
                brand: input.brand,
                tags: input.tags || [],
                price: input.price,
                salePrice: input.salePrice,
                currency: input.currency,
                imageUrl: input.imageUrl,
                thumbnailUrl: input.thumbnailUrl,
                imageUrls: input.imageUrls || [],
                inventory: input.inventory ?? 0,
                inStock: input.inStock ?? (input.inventory ? input.inventory > 0 : true),
                isActive: input.isActive,
                isNewArrival: input.isNewArrival,
                isOnSale: input.isOnSale,
                excludeFromRecommendations: input.excludeFromRecommendations,
                externalId: input.externalId,
                platform: input.platform,
                url: input.url,
            },
            create: {
                sku: input.sku,
                name: input.name,
                description: input.description,
                category: input.category,
                subcategory: input.subcategory,
                brand: input.brand,
                tags: input.tags || [],
                price: input.price,
                salePrice: input.salePrice,
                currency: input.currency,
                imageUrl: input.imageUrl,
                thumbnailUrl: input.thumbnailUrl,
                imageUrls: input.imageUrls || [],
                inventory: input.inventory ?? 0,
                inStock: input.inStock ?? (input.inventory ? input.inventory > 0 : true),
                isActive: input.isActive,
                isNewArrival: input.isNewArrival,
                isOnSale: input.isOnSale,
                excludeFromRecommendations: input.excludeFromRecommendations,
                externalId: input.externalId,
                platform: input.platform,
                url: input.url,
            },
        });
        return {
            product: {
                id: product.id,
                sku: product.sku,
                name: product.name,
                createdAt: product.createdAt.toISOString(),
                updatedAt: product.updatedAt.toISOString(),
            },
            created: !existing,
        };
    },
});
// Delete product
export const deleteProductEndpoint = adminFactory.build({
    method: 'delete',
    shortDescription: 'Delete Product',
    description: 'Delete a product from the catalog',
    tag: 'Products',
    input: z.object({
        sku: z.string(),
    }),
    output: z.object({
        success: z.boolean(),
    }),
    handler: async ({ input }) => {
        await prisma.product.delete({
            where: { sku: input.sku },
        });
        return { success: true };
    },
});
// -------------------------------------------------------------------
// Browse Events (for tracking customer behavior)
// -------------------------------------------------------------------
export const trackBrowseEventEndpoint = authFactory.build({
    method: 'post',
    shortDescription: 'Track Browse Event',
    description: 'Track customer browse behavior (product views, add to cart, etc.)',
    tag: 'Recommendations',
    input: z.object({
        customerId: objectIdSchema,
        sku: z.string().optional(),
        productId: objectIdSchema.optional(),
        eventType: z.enum([
            'viewed_product',
            'added_to_cart',
            'removed_from_cart',
            'added_to_wishlist',
            'searched',
            'category_viewed',
        ]),
        eventData: z.record(z.string(), z.unknown()).optional(),
        sessionId: z.string().optional(),
        pageUrl: z.string().optional(),
        referrer: z.string().optional(),
        deviceType: z.enum(['desktop', 'mobile', 'tablet']).optional(),
    }),
    output: z.object({
        success: z.boolean(),
        eventId: z.string(),
    }),
    handler: async ({ input }) => {
        // Look up product ID if SKU provided
        let productId = input.productId;
        if (input.sku && !productId) {
            const product = await prisma.product.findUnique({
                where: { sku: input.sku },
                select: { id: true },
            });
            productId = product?.id;
        }
        const event = await prisma.browseEvent.create({
            data: {
                customerId: input.customerId,
                productId: productId ?? null,
                sku: input.sku,
                eventType: input.eventType,
                eventData: input.eventData,
                sessionId: input.sessionId,
                pageUrl: input.pageUrl,
                referrer: input.referrer,
                deviceType: input.deviceType,
            },
        });
        return {
            success: true,
            eventId: event.id,
        };
    },
});
// Get unique categories (for filtering)
export const getProductCategoriesEndpoint = staffFactory.build({
    method: 'get',
    shortDescription: 'Get Product Categories',
    description: 'Get list of unique product categories',
    tag: 'Products',
    input: z.object({}),
    output: z.object({
        categories: z.array(z.string()),
    }),
    handler: async () => {
        const products = await prisma.product.findMany({
            where: { isActive: true, category: { not: null } },
            select: { category: true },
            distinct: ['category'],
        });
        const categories = products
            .map((p) => p.category)
            .filter((c) => c !== null)
            .sort();
        return { categories };
    },
});
// Get unique brands (for filtering)
export const getProductBrandsEndpoint = staffFactory.build({
    method: 'get',
    shortDescription: 'Get Product Brands',
    description: 'Get list of unique product brands',
    tag: 'Products',
    input: z.object({}),
    output: z.object({
        brands: z.array(z.string()),
    }),
    handler: async () => {
        const products = await prisma.product.findMany({
            where: { isActive: true, brand: { not: null } },
            select: { brand: true },
            distinct: ['brand'],
        });
        const brands = products
            .map((p) => p.brand)
            .filter((b) => b !== null)
            .sort();
        return { brands };
    },
});
