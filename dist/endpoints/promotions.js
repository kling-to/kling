/**
 * Promotion Endpoints (Discounts & Gifts)
 *
 * Handles creation, management, and application of discounts and gifts.
 */
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import createHttpError from 'http-errors';
import { createAuthRoleFactory } from '../factories.js';
import { parseNaturalLanguageToPromotionDSL, parseDiscountType, parseGiftType, parseChannel, } from '../utils/promotion-parser.js';
import { createDiscount, createGift, checkDiscountEligibility, applyDiscount, reserveGift, confirmGiftGrant, redeemGift, getDiscountByCode, getGiftGrantByCode, updatePromotionStatus, formatDiscountValue, } from '../utils/promotions.js';
import { executeQuery } from '../utils/query-executor.js';
const prisma = new PrismaClient();
// Role-based factories
const adminManagerFactory = createAuthRoleFactory('admin', 'manager');
const allRolesFactory = createAuthRoleFactory('admin', 'manager', 'staff');
const adminOnlyFactory = createAuthRoleFactory('admin');
// =============================================================================
// CREATE PROMOTION FROM NATURAL LANGUAGE
// =============================================================================
export const createPromotionFromNLEndpoint = adminManagerFactory.build({
    method: 'post',
    shortDescription: 'Create Promotion from NL',
    description: 'Creates a discount or gift from a natural language prompt. Returns the created promotion and parsed DSL.',
    tag: 'Promotions',
    input: z.object({
        prompt: z.string().min(10).max(2000),
    }),
    output: z.object({
        message: z.string(),
        promotionType: z.enum(['discount', 'gift']),
        promotion: z.object({
            id: z.string(),
            name: z.string(),
            type: z.string(),
            status: z.string(),
        }),
        parsedDsl: z.unknown(),
        originalPrompt: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const { prompt } = input;
        const userId = ctx.user.sub;
        // Get timezone from settings
        const settings = await prisma.settings.findFirst();
        const timezone = settings?.timezone || 'America/New_York';
        // Parse the prompt
        const parseResult = await parseNaturalLanguageToPromotionDSL(prompt, timezone);
        if (!parseResult.success) {
            if (parseResult.rejected) {
                throw createHttpError(400, `Prompt rejected: ${parseResult.rejectionReason} (category: ${parseResult.rejectionCategory})`);
            }
            throw createHttpError(400, parseResult.error || 'Failed to parse prompt');
        }
        const dsl = parseResult.dsl;
        // Create the promotion based on action type
        if (dsl.action.type === 'discount') {
            const discount = await createDiscount({
                createdBy: userId,
                name: dsl.name,
                description: dsl.description || undefined,
                code: dsl.action.code || undefined,
                type: parseDiscountType(dsl.action.discountType || 'percentage'),
                value: dsl.action.discountValue || 0.1,
                query: JSON.stringify(dsl.query),
                startAt: new Date(dsl.schedule.startAt),
                endAt: new Date(dsl.schedule.endAt),
                cron: dsl.schedule.cron || undefined,
                maxUsesTotal: dsl.constraints?.maxUsesTotal || undefined,
                maxUsesPerCustomer: dsl.constraints?.maxUsesPerCustomer || 1,
                minOrderValue: dsl.constraints?.minOrderValue || undefined,
                stackable: dsl.constraints?.stackable || false,
                messageTemplate: dsl.messageTemplate,
                channel: parseChannel(dsl.channel),
                originalPrompt: prompt,
                parsedDsl: dsl,
            });
            return {
                message: 'Discount created from natural language.',
                promotionType: 'discount',
                promotion: {
                    id: discount.id,
                    name: discount.name,
                    type: discount.type,
                    status: discount.status,
                },
                parsedDsl: dsl,
                originalPrompt: prompt,
            };
        }
        else {
            // Gift
            const gift = await createGift({
                createdBy: userId,
                name: dsl.name,
                description: dsl.description || undefined,
                type: parseGiftType(dsl.action.giftType || 'redemption_code'),
                sku: dsl.action.sku || undefined,
                value: dsl.action.giftValue || undefined,
                code: dsl.action.code || undefined,
                query: JSON.stringify(dsl.query),
                startAt: new Date(dsl.schedule.startAt),
                endAt: new Date(dsl.schedule.endAt),
                cron: dsl.schedule.cron || undefined,
                maxQuantityTotal: dsl.constraints?.maxUsesTotal || undefined,
                maxQuantityPerCustomer: dsl.constraints?.maxUsesPerCustomer || 1,
                messageTemplate: dsl.messageTemplate,
                channel: parseChannel(dsl.channel),
                originalPrompt: prompt,
                parsedDsl: dsl,
            });
            return {
                message: 'Gift created from natural language.',
                promotionType: 'gift',
                promotion: {
                    id: gift.id,
                    name: gift.name,
                    type: gift.type,
                    status: gift.status,
                },
                parsedDsl: dsl,
                originalPrompt: prompt,
            };
        }
    },
});
// =============================================================================
// CREATE DISCOUNT DIRECTLY
// =============================================================================
export const createDiscountEndpoint = adminManagerFactory.build({
    method: 'post',
    shortDescription: 'Create Discount',
    description: 'Creates a new discount directly (without NL parsing).',
    tag: 'Promotions',
    input: z.object({
        name: z.string(),
        description: z.string().optional(),
        code: z.string().optional(),
        type: z.enum(['percentage', 'fixed_amount', 'free_shipping']),
        value: z.number(),
        startAt: z.string().datetime(),
        endAt: z.string().datetime(),
        maxUsesTotal: z.number().optional(),
        maxUsesPerCustomer: z.number().optional(),
        minOrderValue: z.number().optional(),
        stackable: z.boolean().optional(),
        messageTemplate: z.string().optional(),
        channel: z.enum(['email', 'sms']).optional(),
    }),
    output: z.object({
        id: z.string(),
        name: z.string(),
        code: z.string().nullable(),
        type: z.string(),
        value: z.number(),
        status: z.string(),
        startAt: z.string(),
        endAt: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const discount = await createDiscount({
            createdBy: ctx.user.sub,
            name: input.name,
            description: input.description,
            code: input.code,
            type: parseDiscountType(input.type),
            value: input.value,
            startAt: new Date(input.startAt),
            endAt: new Date(input.endAt),
            maxUsesTotal: input.maxUsesTotal,
            maxUsesPerCustomer: input.maxUsesPerCustomer,
            minOrderValue: input.minOrderValue,
            stackable: input.stackable,
            messageTemplate: input.messageTemplate,
            channel: input.channel,
        });
        return {
            id: discount.id,
            name: discount.name,
            code: discount.code,
            type: discount.type,
            value: discount.value,
            status: discount.status,
            startAt: discount.startAt.toISOString(),
            endAt: discount.endAt.toISOString(),
        };
    },
});
// =============================================================================
// LIST DISCOUNTS
// =============================================================================
export const listDiscountsEndpoint = allRolesFactory.build({
    method: 'get',
    shortDescription: 'List Discounts',
    description: 'List all discounts with optional status filter.',
    tag: 'Promotions',
    input: z.object({
        status: z.enum(['draft', 'active', 'paused', 'expired', 'cancelled']).optional(),
        limit: z.coerce.number().min(1).max(100).default(20),
        offset: z.coerce.number().min(0).default(0),
    }),
    output: z.object({
        discounts: z.array(z.object({
            id: z.string(),
            name: z.string(),
            code: z.string().nullable(),
            type: z.string(),
            value: z.number(),
            status: z.string(),
            startAt: z.string(),
            endAt: z.string(),
            totalRedemptions: z.number(),
            totalValue: z.number(),
            createdAt: z.string(),
        })),
        total: z.number(),
    }),
    handler: async ({ input }) => {
        const { status, limit, offset } = input;
        const where = {
            ...(status && { status }),
        };
        const [discounts, total] = await Promise.all([
            prisma.discount.findMany({
                where,
                take: limit,
                skip: offset,
                orderBy: { createdAt: 'desc' },
            }),
            prisma.discount.count({ where }),
        ]);
        return {
            discounts: discounts.map((d) => ({
                id: d.id,
                name: d.name,
                code: d.code,
                type: d.type,
                value: d.value,
                status: d.status,
                startAt: d.startAt.toISOString(),
                endAt: d.endAt.toISOString(),
                totalRedemptions: d.totalRedemptions,
                totalValue: d.totalValue,
                createdAt: d.createdAt.toISOString(),
            })),
            total,
        };
    },
});
// =============================================================================
// CREATE GIFT DIRECTLY
// =============================================================================
export const createGiftEndpoint = adminManagerFactory.build({
    method: 'post',
    shortDescription: 'Create Gift',
    description: 'Creates a new gift directly (without NL parsing).',
    tag: 'Promotions',
    input: z.object({
        name: z.string(),
        description: z.string().optional(),
        type: z.enum(['free_sku', 'free_sample', 'redemption_code']),
        sku: z.string().optional(),
        value: z.number().optional(),
        code: z.string().optional(),
        startAt: z.string().datetime(),
        endAt: z.string().datetime(),
        maxQuantityTotal: z.number().optional(),
        maxQuantityPerCustomer: z.number().optional(),
        messageTemplate: z.string().optional(),
        channel: z.enum(['email', 'sms']).optional(),
    }),
    output: z.object({
        id: z.string(),
        name: z.string(),
        code: z.string().nullable(),
        type: z.string(),
        sku: z.string().nullable(),
        value: z.number().nullable(),
        status: z.string(),
        startAt: z.string(),
        endAt: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const gift = await createGift({
            createdBy: ctx.user.sub,
            name: input.name,
            description: input.description,
            type: parseGiftType(input.type),
            sku: input.sku,
            value: input.value,
            code: input.code,
            startAt: new Date(input.startAt),
            endAt: new Date(input.endAt),
            maxQuantityTotal: input.maxQuantityTotal,
            maxQuantityPerCustomer: input.maxQuantityPerCustomer,
            messageTemplate: input.messageTemplate,
            channel: input.channel,
        });
        return {
            id: gift.id,
            name: gift.name,
            code: gift.code,
            type: gift.type,
            sku: gift.sku,
            value: gift.value,
            status: gift.status,
            startAt: gift.startAt.toISOString(),
            endAt: gift.endAt.toISOString(),
        };
    },
});
// =============================================================================
// LIST GIFTS
// =============================================================================
export const listGiftsEndpoint = allRolesFactory.build({
    method: 'get',
    shortDescription: 'List Gifts',
    description: 'List all gifts with optional status filter.',
    tag: 'Promotions',
    input: z.object({
        status: z.enum(['draft', 'active', 'paused', 'expired', 'cancelled']).optional(),
        limit: z.coerce.number().min(1).max(100).default(20),
        offset: z.coerce.number().min(0).default(0),
    }),
    output: z.object({
        gifts: z.array(z.object({
            id: z.string(),
            name: z.string(),
            type: z.string(),
            sku: z.string().nullable(),
            value: z.number().nullable(),
            status: z.string(),
            startAt: z.string(),
            endAt: z.string(),
            grantedQuantity: z.number(),
            maxQuantityTotal: z.number().nullable(),
            createdAt: z.string(),
        })),
        total: z.number(),
    }),
    handler: async ({ input }) => {
        const { status, limit, offset } = input;
        const where = {
            ...(status && { status }),
        };
        const [gifts, total] = await Promise.all([
            prisma.gift.findMany({
                where,
                take: limit,
                skip: offset,
                orderBy: { createdAt: 'desc' },
            }),
            prisma.gift.count({ where }),
        ]);
        return {
            gifts: gifts.map((g) => ({
                id: g.id,
                name: g.name,
                type: g.type,
                sku: g.sku,
                value: g.value,
                status: g.status,
                startAt: g.startAt.toISOString(),
                endAt: g.endAt.toISOString(),
                grantedQuantity: g.grantedQuantity,
                maxQuantityTotal: g.maxQuantityTotal,
                createdAt: g.createdAt.toISOString(),
            })),
            total,
        };
    },
});
// =============================================================================
// GET DISCOUNT
// =============================================================================
export const getDiscountEndpoint = allRolesFactory.build({
    method: 'get',
    shortDescription: 'Get Discount',
    description: 'Get a specific discount by ID.',
    tag: 'Promotions',
    input: z.object({
        discountId: z.string(),
    }),
    output: z.object({
        discount: z.object({
            id: z.string(),
            name: z.string(),
            description: z.string().nullable(),
            code: z.string().nullable(),
            type: z.string(),
            value: z.number(),
            formattedValue: z.string(),
            query: z.string().nullable(),
            status: z.string(),
            startAt: z.string(),
            endAt: z.string(),
            cron: z.string().nullable(),
            maxUsesTotal: z.number().nullable(),
            maxUsesPerCustomer: z.number(),
            minOrderValue: z.number().nullable(),
            stackable: z.boolean(),
            totalRedemptions: z.number(),
            totalValue: z.number(),
            messageTemplate: z.string().nullable(),
            channel: z.string().nullable(),
            originalPrompt: z.string().nullable(),
            createdAt: z.string(),
        }),
    }),
    handler: async ({ input }) => {
        const discount = await prisma.discount.findUnique({
            where: { id: input.discountId },
        });
        if (!discount) {
            throw createHttpError(404, 'Discount not found');
        }
        return {
            discount: {
                id: discount.id,
                name: discount.name,
                description: discount.description,
                code: discount.code,
                type: discount.type,
                value: discount.value,
                formattedValue: formatDiscountValue(discount.type, discount.value),
                query: discount.query,
                status: discount.status,
                startAt: discount.startAt.toISOString(),
                endAt: discount.endAt.toISOString(),
                cron: discount.cron,
                maxUsesTotal: discount.maxUsesTotal,
                maxUsesPerCustomer: discount.maxUsesPerCustomer,
                minOrderValue: discount.minOrderValue,
                stackable: discount.stackable,
                totalRedemptions: discount.totalRedemptions,
                totalValue: discount.totalValue,
                messageTemplate: discount.messageTemplate,
                channel: discount.channel,
                originalPrompt: discount.originalPrompt,
                createdAt: discount.createdAt.toISOString(),
            },
        };
    },
});
// =============================================================================
// UPDATE DISCOUNT
// =============================================================================
export const updateDiscountEndpoint = adminManagerFactory.build({
    method: 'patch',
    shortDescription: 'Update Discount',
    description: 'Update an existing discount.',
    tag: 'Promotions',
    input: z.object({
        discountId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        code: z.string().optional(),
        type: z.enum(['percentage', 'fixed_amount', 'free_shipping']).optional(),
        value: z.number().optional(),
        startAt: z.string().datetime().optional(),
        endAt: z.string().datetime().optional(),
        maxUsesTotal: z.number().nullable().optional(),
        maxUsesPerCustomer: z.number().optional(),
        minOrderValue: z.number().nullable().optional(),
        stackable: z.boolean().optional(),
        messageTemplate: z.string().nullable().optional(),
        channel: z.enum(['email', 'sms']).nullable().optional(),
    }),
    output: z.object({
        success: z.boolean(),
        message: z.string(),
        discount: z.object({
            id: z.string(),
            name: z.string(),
            status: z.string(),
        }),
    }),
    handler: async ({ input }) => {
        const { discountId, ...updateData } = input;
        const existing = await prisma.discount.findUnique({
            where: { id: discountId },
        });
        if (!existing) {
            throw createHttpError(404, 'Discount not found');
        }
        // Build update object
        const data = {};
        if (updateData.name !== undefined)
            data.name = updateData.name;
        if (updateData.description !== undefined)
            data.description = updateData.description;
        if (updateData.code !== undefined)
            data.code = updateData.code;
        if (updateData.type !== undefined)
            data.type = parseDiscountType(updateData.type);
        if (updateData.value !== undefined)
            data.value = updateData.value;
        if (updateData.startAt !== undefined)
            data.startAt = new Date(updateData.startAt);
        if (updateData.endAt !== undefined)
            data.endAt = new Date(updateData.endAt);
        if (updateData.maxUsesTotal !== undefined)
            data.maxUsesTotal = updateData.maxUsesTotal;
        if (updateData.maxUsesPerCustomer !== undefined)
            data.maxUsesPerCustomer = updateData.maxUsesPerCustomer;
        if (updateData.minOrderValue !== undefined)
            data.minOrderValue = updateData.minOrderValue;
        if (updateData.stackable !== undefined)
            data.stackable = updateData.stackable;
        if (updateData.messageTemplate !== undefined)
            data.messageTemplate = updateData.messageTemplate;
        if (updateData.channel !== undefined)
            data.channel = updateData.channel;
        const updated = await prisma.discount.update({
            where: { id: discountId },
            data,
        });
        return {
            success: true,
            message: 'Discount updated successfully',
            discount: {
                id: updated.id,
                name: updated.name,
                status: updated.status,
            },
        };
    },
});
// =============================================================================
// DELETE DISCOUNT
// =============================================================================
export const deleteDiscountEndpoint = adminOnlyFactory.build({
    method: 'delete',
    shortDescription: 'Delete Discount',
    description: 'Delete a discount. Only draft or cancelled discounts can be deleted.',
    tag: 'Promotions',
    input: z.object({
        discountId: z.string(),
    }),
    output: z.object({
        success: z.boolean(),
        message: z.string(),
    }),
    handler: async ({ input }) => {
        const discount = await prisma.discount.findUnique({
            where: { id: input.discountId },
        });
        if (!discount) {
            throw createHttpError(404, 'Discount not found');
        }
        if (discount.status === 'active') {
            throw createHttpError(400, 'Cannot delete an active discount. Pause or cancel it first.');
        }
        // Check if there are redemptions
        if (discount.totalRedemptions > 0 && discount.status !== 'cancelled') {
            throw createHttpError(400, 'Cannot delete a discount with redemptions. Cancel it instead.');
        }
        await prisma.discount.delete({
            where: { id: input.discountId },
        });
        return {
            success: true,
            message: 'Discount deleted successfully',
        };
    },
});
// =============================================================================
// PREVIEW DISCOUNT ELIGIBILITY
// =============================================================================
export const previewDiscountEndpoint = allRolesFactory.build({
    method: 'post',
    shortDescription: 'Preview Discount',
    description: 'Preview which customers would be eligible for a discount.',
    tag: 'Promotions',
    input: z.object({
        discountId: z.string(),
        limit: z.number().min(1).max(100).default(10),
    }),
    output: z.object({
        discount: z.object({
            id: z.string(),
            name: z.string(),
            formattedValue: z.string(),
        }),
        eligibleCustomers: z.array(z.object({
            id: z.string(),
            name: z.string().nullable(),
            email: z.string().nullable(),
        })),
        count: z.number(),
    }),
    handler: async ({ input }) => {
        const discount = await prisma.discount.findUnique({
            where: { id: input.discountId },
        });
        if (!discount) {
            throw createHttpError(404, 'Discount not found');
        }
        // Execute query to find eligible customers
        let customers = [];
        let count = 0;
        if (discount.query) {
            const query = JSON.parse(discount.query);
            const result = await executeQuery(query, {
                maxResults: input.limit,
                pageSize: input.limit,
            });
            customers = result.customers.map((c) => ({
                id: c.id,
                name: c.name,
                email: c.email,
            }));
            count = result.total;
        }
        return {
            discount: {
                id: discount.id,
                name: discount.name,
                formattedValue: formatDiscountValue(discount.type, discount.value),
            },
            eligibleCustomers: customers,
            count,
        };
    },
});
// =============================================================================
// VALIDATE DISCOUNT CODE
// =============================================================================
export const validateDiscountCodeEndpoint = allRolesFactory.build({
    method: 'post',
    shortDescription: 'Validate Discount Code',
    description: 'Check if a discount code is valid for a customer and order.',
    tag: 'Promotions',
    input: z.object({
        code: z.string(),
        customerId: z.string(),
        orderValue: z.number().optional(),
    }),
    output: z.object({
        valid: z.boolean(),
        discount: z
            .object({
            id: z.string(),
            name: z.string(),
            type: z.string(),
            value: z.number(),
            formattedValue: z.string(),
        })
            .nullable(),
        reason: z.string().nullable(),
    }),
    handler: async ({ input }) => {
        const { code, customerId, orderValue } = input;
        const discount = await getDiscountByCode(code);
        if (!discount) {
            return { valid: false, discount: null, reason: 'Invalid discount code' };
        }
        const eligibility = await checkDiscountEligibility(discount.id, customerId, orderValue);
        if (!eligibility.eligible) {
            return {
                valid: false,
                discount: {
                    id: discount.id,
                    name: discount.name,
                    type: discount.type,
                    value: discount.value,
                    formattedValue: formatDiscountValue(discount.type, discount.value),
                },
                reason: eligibility.reason || null,
            };
        }
        return {
            valid: true,
            discount: {
                id: discount.id,
                name: discount.name,
                type: discount.type,
                value: discount.value,
                formattedValue: formatDiscountValue(discount.type, discount.value),
            },
            reason: null,
        };
    },
});
// =============================================================================
// APPLY DISCOUNT
// =============================================================================
export const applyDiscountEndpoint = adminManagerFactory.build({
    method: 'post',
    shortDescription: 'Apply Discount',
    description: 'Apply a discount to an order.',
    tag: 'Promotions',
    input: z.object({
        discountId: z.string(),
        customerId: z.string(),
        orderId: z.string(),
        orderValue: z.number(),
    }),
    output: z.object({
        success: z.boolean(),
        discountValue: z.number().nullable(),
        error: z.string().nullable(),
    }),
    handler: async ({ input }) => {
        const result = await applyDiscount(input.discountId, input.customerId, input.orderId, input.orderValue);
        return {
            success: result.success,
            discountValue: result.discountValue || null,
            error: result.error || null,
        };
    },
});
// =============================================================================
// UPDATE PROMOTION STATUS
// =============================================================================
export const updatePromotionStatusEndpoint = adminOnlyFactory.build({
    method: 'post',
    shortDescription: 'Update Promotion Status',
    description: 'Update the status of a discount or gift (pause, resume, cancel).',
    tag: 'Promotions',
    input: z.object({
        promotionType: z.enum(['discount', 'gift']),
        promotionId: z.string(),
        status: z.enum(['draft', 'active', 'paused', 'expired', 'cancelled']),
    }),
    output: z.object({
        success: z.boolean(),
        message: z.string(),
    }),
    handler: async ({ input }) => {
        const { promotionType, promotionId, status } = input;
        // Verify promotion exists
        if (promotionType === 'discount') {
            const discount = await prisma.discount.findUnique({
                where: { id: promotionId },
            });
            if (!discount) {
                throw createHttpError(404, 'Discount not found');
            }
        }
        else {
            const gift = await prisma.gift.findUnique({
                where: { id: promotionId },
            });
            if (!gift) {
                throw createHttpError(404, 'Gift not found');
            }
        }
        await updatePromotionStatus(promotionType, promotionId, status);
        return {
            success: true,
            message: `${promotionType} status updated to ${status}`,
        };
    },
});
// =============================================================================
// RESERVE GIFT
// =============================================================================
export const reserveGiftEndpoint = adminManagerFactory.build({
    method: 'post',
    shortDescription: 'Reserve Gift',
    description: 'Reserve a gift for a customer before checkout.',
    tag: 'Promotions',
    input: z.object({
        giftId: z.string(),
        customerId: z.string(),
    }),
    output: z.object({
        success: z.boolean(),
        grantId: z.string().nullable(),
        code: z.string().nullable(),
        error: z.string().nullable(),
    }),
    handler: async ({ input }) => {
        const result = await reserveGift(input.giftId, input.customerId);
        return {
            success: result.success,
            grantId: result.grantId || null,
            code: result.code || null,
            error: result.error || null,
        };
    },
});
// =============================================================================
// CONFIRM GIFT
// =============================================================================
export const confirmGiftEndpoint = adminManagerFactory.build({
    method: 'post',
    shortDescription: 'Confirm Gift',
    description: 'Confirm a gift grant after successful checkout.',
    tag: 'Promotions',
    input: z.object({
        grantId: z.string(),
        orderId: z.string().optional(),
    }),
    output: z.object({
        success: z.boolean(),
        error: z.string().nullable(),
    }),
    handler: async ({ input }) => {
        const result = await confirmGiftGrant(input.grantId, input.orderId);
        return {
            success: result.success,
            error: result.error || null,
        };
    },
});
// =============================================================================
// REDEEM GIFT
// =============================================================================
export const redeemGiftEndpoint = adminManagerFactory.build({
    method: 'post',
    shortDescription: 'Redeem Gift',
    description: 'Redeem a gift code.',
    tag: 'Promotions',
    input: z.object({
        code: z.string(),
        orderId: z.string().optional(),
    }),
    output: z.object({
        success: z.boolean(),
        gift: z
            .object({
            id: z.string(),
            name: z.string(),
            type: z.string(),
            sku: z.string().nullable(),
            value: z.number().nullable(),
        })
            .nullable(),
        error: z.string().nullable(),
    }),
    handler: async ({ input }) => {
        const grant = await getGiftGrantByCode(input.code);
        if (!grant || !grant.gift) {
            return { success: false, gift: null, error: 'Invalid gift code' };
        }
        const result = await redeemGift(grant.id, input.orderId);
        if (!result.success) {
            return { success: false, gift: null, error: result.error || 'Failed to redeem gift' };
        }
        return {
            success: true,
            gift: {
                id: grant.gift.id,
                name: grant.gift.name,
                type: grant.gift.type,
                sku: grant.gift.sku,
                value: grant.gift.value,
            },
            error: null,
        };
    },
});
// =============================================================================
// GET GIFT
// =============================================================================
export const getGiftEndpoint = allRolesFactory.build({
    method: 'get',
    shortDescription: 'Get Gift',
    description: 'Get a specific gift by ID.',
    tag: 'Promotions',
    input: z.object({
        giftId: z.string(),
    }),
    output: z.object({
        gift: z.object({
            id: z.string(),
            name: z.string(),
            description: z.string().nullable(),
            type: z.string(),
            sku: z.string().nullable(),
            value: z.number().nullable(),
            code: z.string().nullable(),
            query: z.string().nullable(),
            status: z.string(),
            startAt: z.string(),
            endAt: z.string(),
            cron: z.string().nullable(),
            maxQuantityTotal: z.number().nullable(),
            maxQuantityPerCustomer: z.number(),
            grantedQuantity: z.number(),
            messageTemplate: z.string().nullable(),
            channel: z.string().nullable(),
            originalPrompt: z.string().nullable(),
            createdAt: z.string(),
        }),
    }),
    handler: async ({ input }) => {
        const gift = await prisma.gift.findUnique({
            where: { id: input.giftId },
        });
        if (!gift) {
            throw createHttpError(404, 'Gift not found');
        }
        return {
            gift: {
                id: gift.id,
                name: gift.name,
                description: gift.description,
                type: gift.type,
                sku: gift.sku,
                value: gift.value,
                code: gift.code,
                query: gift.query,
                status: gift.status,
                startAt: gift.startAt.toISOString(),
                endAt: gift.endAt.toISOString(),
                cron: gift.cron,
                maxQuantityTotal: gift.maxQuantityTotal,
                maxQuantityPerCustomer: gift.maxQuantityPerCustomer,
                grantedQuantity: gift.grantedQuantity,
                messageTemplate: gift.messageTemplate,
                channel: gift.channel,
                originalPrompt: gift.originalPrompt,
                createdAt: gift.createdAt.toISOString(),
            },
        };
    },
});
// =============================================================================
// UPDATE GIFT
// =============================================================================
export const updateGiftEndpoint = adminManagerFactory.build({
    method: 'patch',
    shortDescription: 'Update Gift',
    description: 'Update an existing gift.',
    tag: 'Promotions',
    input: z.object({
        giftId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        type: z.enum(['free_sku', 'free_sample', 'redemption_code']).optional(),
        sku: z.string().nullable().optional(),
        value: z.number().nullable().optional(),
        code: z.string().nullable().optional(),
        startAt: z.string().datetime().optional(),
        endAt: z.string().datetime().optional(),
        maxQuantityTotal: z.number().nullable().optional(),
        maxQuantityPerCustomer: z.number().optional(),
        messageTemplate: z.string().nullable().optional(),
        channel: z.enum(['email', 'sms']).nullable().optional(),
    }),
    output: z.object({
        success: z.boolean(),
        message: z.string(),
        gift: z.object({
            id: z.string(),
            name: z.string(),
            status: z.string(),
        }),
    }),
    handler: async ({ input }) => {
        const { giftId, ...updateData } = input;
        const existing = await prisma.gift.findUnique({
            where: { id: giftId },
        });
        if (!existing) {
            throw createHttpError(404, 'Gift not found');
        }
        // Build update object
        const data = {};
        if (updateData.name !== undefined)
            data.name = updateData.name;
        if (updateData.description !== undefined)
            data.description = updateData.description;
        if (updateData.type !== undefined)
            data.type = parseGiftType(updateData.type);
        if (updateData.sku !== undefined)
            data.sku = updateData.sku;
        if (updateData.value !== undefined)
            data.value = updateData.value;
        if (updateData.code !== undefined)
            data.code = updateData.code;
        if (updateData.startAt !== undefined)
            data.startAt = new Date(updateData.startAt);
        if (updateData.endAt !== undefined)
            data.endAt = new Date(updateData.endAt);
        if (updateData.maxQuantityTotal !== undefined)
            data.maxQuantityTotal = updateData.maxQuantityTotal;
        if (updateData.maxQuantityPerCustomer !== undefined)
            data.maxQuantityPerCustomer = updateData.maxQuantityPerCustomer;
        if (updateData.messageTemplate !== undefined)
            data.messageTemplate = updateData.messageTemplate;
        if (updateData.channel !== undefined)
            data.channel = updateData.channel;
        const updated = await prisma.gift.update({
            where: { id: giftId },
            data,
        });
        return {
            success: true,
            message: 'Gift updated successfully',
            gift: {
                id: updated.id,
                name: updated.name,
                status: updated.status,
            },
        };
    },
});
// =============================================================================
// DELETE GIFT
// =============================================================================
export const deleteGiftEndpoint = adminOnlyFactory.build({
    method: 'delete',
    shortDescription: 'Delete Gift',
    description: 'Delete a gift. Only draft or cancelled gifts can be deleted.',
    tag: 'Promotions',
    input: z.object({
        giftId: z.string(),
    }),
    output: z.object({
        success: z.boolean(),
        message: z.string(),
    }),
    handler: async ({ input }) => {
        const gift = await prisma.gift.findUnique({
            where: { id: input.giftId },
        });
        if (!gift) {
            throw createHttpError(404, 'Gift not found');
        }
        if (gift.status === 'active') {
            throw createHttpError(400, 'Cannot delete an active gift. Pause or cancel it first.');
        }
        // Check if there are grants
        if (gift.grantedQuantity > 0 && gift.status !== 'cancelled') {
            throw createHttpError(400, 'Cannot delete a gift with grants. Cancel it instead.');
        }
        // Delete associated grants first
        await prisma.giftGrant.deleteMany({
            where: { giftId: input.giftId },
        });
        await prisma.gift.delete({
            where: { id: input.giftId },
        });
        return {
            success: true,
            message: 'Gift deleted successfully',
        };
    },
});
