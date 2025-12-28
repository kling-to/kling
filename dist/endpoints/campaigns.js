import { z } from 'zod';
import crypto from 'crypto';
import { createAuthRoleFactory } from '../factories';
import prisma from '../utils/prisma';
import { createAuditLog, AuditActions } from '../utils/audit';
import { objectIdSchema } from '../utils/validation';
import { createCampaignSchedule, updateCampaignSchedule, removeCampaignSchedule, removeScheduleByKey, pauseCampaignSchedule, resumeCampaignSchedule, triggerCampaignNow, getScheduleInfo, getScheduleInfoByKey, } from '../utils/bullmq';
import { parseNaturalLanguageToCampaignDSL, parseChannel, generateSubjectLines, } from '../utils/llm-parser';
import { executePreviewQuery, parseQueryDSL } from '../utils/query-executor';
import { executeAggregationQuery } from '../utils/query-aggregator';
import { executeCountOnlyQuery, validateQuery, containsAggregation, } from '../utils/query-executor-unified';
import { MAX_QUERY_CONDITIONS } from '../utils/query-complexity';
import { calculateCampaignRevenue, getCampaignAttributionBreakdown, } from '../utils/revenue-attribution';
import { generateDiscountCode, generateGiftCode, formatDiscountValue, formatGiftValue, } from '../utils/promotions';
import createHttpError from 'http-errors';
import { renderEmailContent, renderSmsContent, validateContentLimits, } from '../utils/template-renderer';
/**
 * Generate a unique idempotency key for campaigns
 */
function generateIdempotencyKey() {
    return `campaign-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}
/**
 * Generate a unique placeholder key for "once" campaigns
 * (MongoDB unique indexes don't support sparse mode properly with Prisma)
 */
function generateOnceJobKey() {
    return `once-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}
/**
 * Format campaign discount data with computed formattedValue
 */
function formatCampaignDiscount(discount) {
    if (!discount)
        return null;
    const type = discount.type;
    return {
        type,
        value: discount.value,
        code: discount.code,
        formattedValue: formatDiscountValue(type, discount.value),
        maxUsesTotal: discount.maxUsesTotal,
        maxUsesPerCustomer: discount.maxUsesPerCustomer,
        minOrderValue: discount.minOrderValue,
        stackable: discount.stackable,
    };
}
/**
 * Format campaign gift data with computed formattedValue
 */
function formatCampaignGift(gift) {
    if (!gift)
        return null;
    const type = gift.type;
    return {
        type,
        sku: gift.sku,
        value: gift.value,
        code: gift.code,
        formattedValue: formatGiftValue(type, gift.sku, gift.value),
        maxQuantityTotal: gift.maxQuantityTotal,
        maxQuantityPerCustomer: gift.maxQuantityPerCustomer,
    };
}
/**
 * Check if a query DSL contains an aggregation query
 */
function isAggregationQuery(dsl) {
    return (typeof dsl === 'object' &&
        dsl !== null &&
        'aggregation' in dsl &&
        typeof dsl.aggregation === 'object');
}
// Embedded discount schema for campaigns
const campaignDiscountSchema = z.object({
    type: z.enum(['percentage', 'fixed_amount', 'free_shipping']),
    value: z.number(),
    code: z.string().nullable(),
    formattedValue: z.string(),
    maxUsesTotal: z.number().nullable(),
    maxUsesPerCustomer: z.number().nullable(),
    minOrderValue: z.number().nullable(),
    stackable: z.boolean().nullable(),
});
// Embedded gift schema for campaigns
const campaignGiftSchema = z.object({
    type: z.enum(['free_sku', 'free_sample', 'redemption_code']),
    sku: z.string().nullable(),
    value: z.string().nullable(),
    code: z.string().nullable(),
    formattedValue: z.string(),
    maxQuantityTotal: z.number().nullable(),
    maxQuantityPerCustomer: z.number().nullable(),
});
// Email content schema (inline message content for email campaigns)
const emailContentSchema = z.object({
    subject: z.string(),
    preheader: z.string().nullable().optional(),
    body: z.string(),
    html: z.string().nullable().optional(),
    signature: z.string().nullable().optional(),
    // Product recommendations
    includeRecommendations: z.boolean().nullable().optional(),
    recommendationAlgorithm: z
        .enum([
        'best_sellers',
        'recently_viewed',
        'collaborative_filter',
        'copurchase',
        'content_based',
        'personalized_mix',
    ])
        .nullable()
        .optional(),
    recommendationLimit: z.number().min(1).max(12).nullable().optional(),
    excludePurchasedProducts: z.boolean().nullable().optional(),
});
// SMS content schema (inline message content for SMS campaigns)
const smsContentSchema = z.object({
    body: z.string(),
});
// WhatsApp content schema
const whatsappContentSchema = z.object({
    body: z.string(),
    mediaUrl: z.string().nullable().optional(),
    mediaType: z.string().nullable().optional(), // "image" | "video" | "document" | "audio"
    templateId: z.string().nullable().optional(),
});
// RCS content schema
const rcsContentSchema = z.object({
    body: z.string(),
    title: z.string().nullable().optional(),
    imageUrl: z.string().nullable().optional(),
    suggestions: z.array(z.string()).optional(),
    fallbackToSms: z.boolean().optional(),
});
// Push content schema
const pushContentSchema = z.object({
    title: z.string(),
    body: z.string(),
    imageUrl: z.string().nullable().optional(),
    deepLink: z.string().nullable().optional(),
    data: z.unknown().nullable().optional(), // JsonValue from Prisma
});
// Common schemas
const campaignSchema = z.object({
    id: z.string(),
    createdBy: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    cron: z.string().nullable(),
    startAt: z.date().nullable(),
    endAt: z.date().nullable(),
    timezone: z.string().nullable(),
    query: z.union([z.string(), z.record(z.string(), z.unknown())]),
    email: emailContentSchema.nullable(),
    sms: smsContentSchema.nullable(),
    whatsapp: whatsappContentSchema.nullable(),
    rcs: rcsContentSchema.nullable(),
    push: pushContentSchema.nullable(),
    channel: z.enum(['email', 'sms', 'whatsapp', 'rcs', 'push']),
    conditions: z.record(z.string(), z.unknown()).default({}),
    retrieval: z.record(z.string(), z.unknown()).nullable().optional(),
    status: z.string(),
    bullmqJobKey: z.string().nullable(),
    executionType: z.enum(['recurring', 'once']),
    executedOnce: z.boolean(),
    discount: campaignDiscountSchema.nullable(),
    gift: campaignGiftSchema.nullable(),
    // Send time optimization
    enableSendTimeOptimization: z.boolean(),
    defaultSendHour: z.number().nullable(),
    maxOptimizationWindow: z.number(),
    createdAt: z.date(),
    updatedAt: z.date(),
});
// Schedule info from BullMQ
const scheduleInfoSchema = z
    .object({
    jobKey: z.string(),
    cron: z.string(),
    timezone: z.string(),
    startAt: z.date(),
    endAt: z.date(),
    nextRun: z.date().nullable(),
})
    .nullable();
// Input schema for discount configuration
const discountInputSchema = z.object({
    type: z.enum(['percentage', 'fixed_amount', 'free_shipping']),
    value: z.number(),
    code: z.string().optional(), // Auto-generated if not provided
    maxUsesTotal: z.number().optional(),
    maxUsesPerCustomer: z.number().optional(),
    minOrderValue: z.number().optional(),
    stackable: z.boolean().optional(),
});
// Input schema for gift configuration
const giftInputSchema = z.object({
    type: z.enum(['free_sku', 'free_sample', 'redemption_code']),
    sku: z.string().optional(),
    value: z.string().optional(),
    code: z.string().optional(), // Auto-generated if not provided
    maxQuantityTotal: z.number().optional(),
    maxQuantityPerCustomer: z.number().optional(),
});
// Input schema for email content
const emailContentInputSchema = z.object({
    subject: z.string().min(1, 'Subject is required'),
    preheader: z.string().optional(),
    body: z.string().min(1, 'Body is required'),
    html: z.string().optional(),
    signature: z.string().optional(),
    // Product recommendations
    includeRecommendations: z.boolean().optional(),
    recommendationAlgorithm: z
        .enum([
        'best_sellers',
        'recently_viewed',
        'collaborative_filter',
        'copurchase',
        'content_based',
        'personalized_mix',
    ])
        .optional(),
    recommendationLimit: z.number().min(1).max(12).optional(),
    excludePurchasedProducts: z.boolean().optional(),
});
// Input schema for SMS content
const smsContentInputSchema = z.object({
    body: z.string().min(1, 'Body is required'),
});
export const createCampaignEndpoint = createAuthRoleFactory('admin', 'manager').build({
    method: 'post',
    shortDescription: 'Create Campaign',
    description: 'Creates a new campaign definition and schedules it.',
    tag: 'Campaigns',
    input: z.object({
        name: z.string(),
        description: z.string().optional(),
        executionType: z.enum(['recurring', 'once']).default('recurring'),
        cron: z.string().optional(), // Required for recurring, optional for once
        startAt: z.string().datetime().optional(), // Optional for once campaigns
        endAt: z.string().datetime().optional(), // Optional for once campaigns
        query: z.union([z.string(), z.record(z.string(), z.unknown())]),
        email: emailContentInputSchema.optional(),
        sms: smsContentInputSchema.optional(),
        channel: z.enum(['email', 'sms', 'whatsapp', 'rcs', 'push']),
        conditions: z.record(z.string(), z.unknown()).optional(),
        retrieval: z.record(z.string(), z.unknown()).optional(),
        discount: discountInputSchema.optional(),
        gift: giftInputSchema.optional(),
        // Send time optimization
        enableSendTimeOptimization: z.boolean().optional().default(false),
        defaultSendHour: z.number().min(0).max(23).optional(),
        maxOptimizationWindow: z.number().min(1).max(48).optional().default(24),
    }),
    output: z.object({
        message: z.string(),
        campaign: campaignSchema,
        schedule: scheduleInfoSchema,
    }),
    handler: async ({ input, ctx }) => {
        const userId = ctx.user.sub;
        const isRecurring = input.executionType === 'recurring';
        // Validate schedule fields for recurring campaigns
        if (isRecurring) {
            if (!input.cron) {
                throw createHttpError(400, 'Cron schedule is required for recurring campaigns');
            }
            if (!input.startAt || !input.endAt) {
                throw createHttpError(400, 'Start and end dates are required for recurring campaigns');
            }
        }
        const startAt = input.startAt ? new Date(input.startAt) : null;
        const endAt = input.endAt ? new Date(input.endAt) : null;
        // Validate message content based on channel
        if (input.channel === 'email') {
            if (!input.email) {
                throw createHttpError(400, 'Email content is required for email campaigns');
            }
        }
        else if (input.channel === 'sms') {
            if (!input.sms) {
                throw createHttpError(400, 'SMS content is required for SMS campaigns');
            }
        }
        const settings = await prisma.settings.findFirst();
        const timezone = settings?.timezone || 'UTC';
        // Process discount - auto-generate code if not provided
        let discountData = null;
        if (input.discount) {
            discountData = {
                type: input.discount.type,
                value: input.discount.value,
                code: input.discount.code || generateDiscountCode(),
                maxUsesTotal: input.discount.maxUsesTotal ?? null,
                maxUsesPerCustomer: input.discount.maxUsesPerCustomer ?? 1,
                minOrderValue: input.discount.minOrderValue ?? null,
                stackable: input.discount.stackable ?? false,
            };
        }
        // Process gift - auto-generate code if not provided
        let giftData = null;
        if (input.gift) {
            giftData = {
                type: input.gift.type,
                sku: input.gift.sku ?? null,
                value: input.gift.value ?? null,
                code: input.gift.code || generateGiftCode(),
                maxQuantityTotal: input.gift.maxQuantityTotal ?? null,
                maxQuantityPerCustomer: input.gift.maxQuantityPerCustomer ?? 1,
            };
        }
        const campaign = await prisma.campaignDefinition.create({
            data: {
                createdBy: userId,
                name: input.name,
                description: input.description,
                query: typeof input.query === 'string' ? input.query : JSON.stringify(input.query),
                email: input.email
                    ? {
                        subject: input.email.subject,
                        preheader: input.email.preheader || null,
                        body: input.email.body,
                        html: input.email.html || null,
                        signature: input.email.signature || null,
                        // Product recommendations
                        includeRecommendations: input.email.includeRecommendations || null,
                        recommendationAlgorithm: input.email.recommendationAlgorithm || null,
                        recommendationLimit: input.email.recommendationLimit || null,
                        excludePurchasedProducts: input.email.excludePurchasedProducts || null,
                    }
                    : null,
                sms: input.sms ? { body: input.sms.body } : null,
                channel: input.channel,
                conditions: input.conditions ? JSON.parse(JSON.stringify(input.conditions)) : {},
                retrieval: input.retrieval ? JSON.parse(JSON.stringify(input.retrieval)) : null,
                status: 'paused',
                bullmqJobKey: isRecurring ? null : generateOnceJobKey(),
                executionType: input.executionType,
                executedOnce: false,
                discount: discountData,
                gift: giftData,
                cron: input.cron || null,
                startAt,
                endAt,
                timezone,
                idempotencyKey: generateIdempotencyKey(),
                // Send time optimization
                enableSendTimeOptimization: input.enableSendTimeOptimization ?? false,
                defaultSendHour: input.defaultSendHour ?? null,
                maxOptimizationWindow: input.maxOptimizationWindow ?? 24,
            },
        });
        // Only create schedule for recurring campaigns
        let scheduleInfo = null;
        if (isRecurring && input.cron && startAt && endAt) {
            try {
                scheduleInfo = await createCampaignSchedule(campaign.id, input.cron, startAt, endAt, timezone);
            }
            catch (err) {
                await prisma.campaignDefinition.delete({ where: { id: campaign.id } });
                throw createHttpError(500, `Failed to create schedule: ${err}`);
            }
        }
        const updatedCampaign = await prisma.campaignDefinition.update({
            where: { id: campaign.id },
            data: {
                // Only update bullmqJobKey if we have a new one from scheduling
                ...(scheduleInfo ? { bullmqJobKey: scheduleInfo.jobKey } : {}),
                status: 'active',
            },
        });
        // Audit log campaign creation
        await createAuditLog({
            action: AuditActions.campaign.created,
            resourceType: 'campaign',
            resourceId: updatedCampaign.id,
            metadata: {
                name: updatedCampaign.name,
                channel: updatedCampaign.channel,
                executionType: updatedCampaign.executionType,
                hasDiscount: !!updatedCampaign.discount,
                hasGift: !!updatedCampaign.gift,
            },
            context: { userId },
        });
        return {
            message: isRecurring ? 'Campaign created and scheduled.' : 'Campaign created (run once).',
            campaign: {
                ...updatedCampaign,
                executionType: updatedCampaign.executionType,
                conditions: updatedCampaign.conditions || {},
                retrieval: updatedCampaign.retrieval || null,
                discount: formatCampaignDiscount(updatedCampaign.discount),
                gift: formatCampaignGift(updatedCampaign.gift),
            },
            schedule: scheduleInfo,
        };
    },
});
export const listCampaignsEndpoint = createAuthRoleFactory('admin', 'manager', 'staff').build({
    method: 'get',
    shortDescription: 'List Campaigns',
    description: 'Returns a list of all campaigns.',
    tag: 'Campaigns',
    input: z.object({}),
    output: z.object({
        items: z.array(campaignSchema.extend({
            creator: z.object({
                id: z.string(),
                email: z.string(),
                name: z.string(),
            }),
        })),
    }),
    handler: async () => {
        const campaigns = await prisma.campaignDefinition.findMany({
            where: {
                status: { not: 'archived' },
            },
            include: {
                creator: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        return {
            items: campaigns.map((c) => ({
                ...c,
                executionType: c.executionType,
                conditions: c.conditions || {},
                retrieval: c.retrieval || null,
                discount: formatCampaignDiscount(c.discount),
                gift: formatCampaignGift(c.gift),
                creator: {
                    ...c.creator,
                    name: c.creator.name || '',
                },
            })),
        };
    },
});
export const getCampaignEndpoint = createAuthRoleFactory('admin', 'manager', 'staff').build({
    method: 'get',
    shortDescription: 'Get Campaign',
    description: 'Returns details of a specific campaign by ID, including live schedule info from BullMQ.',
    tag: 'Campaigns',
    input: z.object({
        campaignId: objectIdSchema,
    }),
    output: campaignSchema.extend({
        creator: z.object({
            id: z.string(),
            email: z.string(),
            name: z.string(),
        }),
        schedule: scheduleInfoSchema,
    }),
    handler: async ({ input }) => {
        const campaign = await prisma.campaignDefinition.findUnique({
            where: { id: input.campaignId },
            include: {
                creator: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                    },
                },
            },
        });
        if (!campaign) {
            throw createHttpError(404, 'Campaign not found');
        }
        let schedule = null;
        if (campaign.bullmqJobKey) {
            schedule = await getScheduleInfoByKey(campaign.bullmqJobKey);
        }
        else if (campaign.executionType === 'recurring') {
            schedule = await getScheduleInfo(campaign.id);
        }
        return {
            ...campaign,
            executionType: campaign.executionType,
            conditions: campaign.conditions || {},
            retrieval: campaign.retrieval || null,
            discount: formatCampaignDiscount(campaign.discount),
            gift: formatCampaignGift(campaign.gift),
            creator: {
                ...campaign.creator,
                name: campaign.creator.name || '',
            },
            schedule,
        };
    },
});
export const updateCampaignEndpoint = createAuthRoleFactory('admin', 'manager').build({
    method: 'patch',
    shortDescription: 'Update Campaign',
    description: 'Updates an existing campaign definition.',
    tag: 'Campaigns',
    input: z.object({
        campaignId: objectIdSchema,
        name: z.string().optional(),
        description: z.string().optional(),
        executionType: z.enum(['recurring', 'once']).optional(),
        cron: z.string().nullable().optional(),
        startAt: z.string().datetime().nullable().optional(),
        endAt: z.string().datetime().nullable().optional(),
        query: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
        email: emailContentInputSchema.nullable().optional(),
        sms: smsContentInputSchema.nullable().optional(),
        channel: z.enum(['email', 'sms', 'whatsapp', 'rcs', 'push']).optional(),
        conditions: z.record(z.string(), z.unknown()).optional(),
        retrieval: z.record(z.string(), z.unknown()).optional(),
        status: z.enum(['active', 'paused', 'disabled']).optional(),
        discount: discountInputSchema.nullable().optional(),
        gift: giftInputSchema.nullable().optional(),
        // Send time optimization
        enableSendTimeOptimization: z.boolean().optional(),
        defaultSendHour: z.number().min(0).max(23).nullable().optional(),
        maxOptimizationWindow: z.number().min(1).max(48).optional(),
    }),
    output: z.object({
        campaign: campaignSchema,
        schedule: scheduleInfoSchema,
    }),
    handler: async ({ input, ctx }) => {
        const existingCampaign = await prisma.campaignDefinition.findUnique({
            where: { id: input.campaignId },
        });
        if (!existingCampaign) {
            throw createHttpError(404, 'Campaign not found');
        }
        const scheduleChanged = input.cron !== undefined || input.startAt !== undefined || input.endAt !== undefined;
        const executionType = input.executionType || existingCampaign.executionType;
        const isRecurring = executionType === 'recurring';
        // Validate message content if channel is being changed
        if (input.channel && input.channel !== existingCampaign.channel) {
            // If changing to email channel, must have email content
            if (input.channel === 'email' && !input.email && !existingCampaign.email) {
                throw createHttpError(400, 'Email content is required when switching to email channel');
            }
            // If changing to SMS channel, must have SMS content
            if (input.channel === 'sms' && !input.sms && !existingCampaign.sms) {
                throw createHttpError(400, 'SMS content is required when switching to SMS channel');
            }
        }
        // Process discount update - undefined means no change, null means remove
        let discountData = undefined;
        if (input.discount !== undefined) {
            discountData = input.discount
                ? processDiscountInput(input.discount, existingCampaign.discount)
                : null;
        }
        // Process gift update - undefined means no change, null means remove
        let giftData = undefined;
        if (input.gift !== undefined) {
            giftData = input.gift
                ? processGiftInput(input.gift, existingCampaign.gift)
                : null;
        }
        // Process email content update - undefined means no change, null means remove
        let emailData = undefined;
        if (input.email !== undefined) {
            emailData = input.email
                ? {
                    subject: input.email.subject,
                    preheader: input.email.preheader || null,
                    body: input.email.body,
                    html: input.email.html || null,
                    signature: input.email.signature || null,
                    // Product recommendations
                    includeRecommendations: input.email.includeRecommendations || null,
                    recommendationAlgorithm: input.email.recommendationAlgorithm || null,
                    recommendationLimit: input.email.recommendationLimit || null,
                    excludePurchasedProducts: input.email.excludePurchasedProducts || null,
                }
                : null;
        }
        // Process SMS content update - undefined means no change, null means remove
        let smsData = undefined;
        if (input.sms !== undefined) {
            smsData = input.sms ? { body: input.sms.body } : null;
        }
        const updatedCampaign = await prisma.campaignDefinition.update({
            where: { id: input.campaignId },
            data: {
                ...(input.name && { name: input.name }),
                ...(input.description !== undefined && { description: input.description }),
                ...(input.executionType && { executionType: input.executionType }),
                ...(input.cron !== undefined && { cron: input.cron }),
                ...(input.startAt !== undefined && {
                    startAt: input.startAt ? new Date(input.startAt) : null,
                }),
                ...(input.endAt !== undefined && { endAt: input.endAt ? new Date(input.endAt) : null }),
                ...(input.query && {
                    query: typeof input.query === 'string' ? input.query : JSON.stringify(input.query),
                }),
                ...(emailData !== undefined && { email: emailData }),
                ...(smsData !== undefined && { sms: smsData }),
                ...(input.channel && { channel: input.channel }),
                ...(input.conditions && { conditions: JSON.parse(JSON.stringify(input.conditions)) }),
                ...(input.retrieval !== undefined && {
                    retrieval: input.retrieval ? JSON.parse(JSON.stringify(input.retrieval)) : null,
                }),
                ...(input.status && { status: input.status }),
                ...(discountData !== undefined && { discount: discountData }),
                ...(giftData !== undefined && { gift: giftData }),
                // Send time optimization
                ...(input.enableSendTimeOptimization !== undefined && {
                    enableSendTimeOptimization: input.enableSendTimeOptimization,
                }),
                ...(input.defaultSendHour !== undefined && { defaultSendHour: input.defaultSendHour }),
                ...(input.maxOptimizationWindow !== undefined && {
                    maxOptimizationWindow: input.maxOptimizationWindow,
                }),
            },
        });
        let schedule = null;
        if (isRecurring && scheduleChanged && updatedCampaign.status === 'active') {
            const settings = await prisma.settings.findFirst();
            const timezone = settings?.timezone || updatedCampaign.timezone || 'UTC';
            const cron = updatedCampaign.cron || existingCampaign.cron;
            const startAt = updatedCampaign.startAt || existingCampaign.startAt;
            const endAt = updatedCampaign.endAt || existingCampaign.endAt;
            if (cron && startAt && endAt) {
                const scheduleInfo = await updateCampaignSchedule(updatedCampaign.id, existingCampaign.bullmqJobKey, cron, startAt, endAt, timezone);
                await prisma.campaignDefinition.update({
                    where: { id: input.campaignId },
                    data: {
                        bullmqJobKey: scheduleInfo.jobKey,
                        cron,
                        startAt,
                        endAt,
                        timezone,
                    },
                });
                schedule = scheduleInfo;
            }
        }
        else if (updatedCampaign.bullmqJobKey) {
            schedule = await getScheduleInfoByKey(updatedCampaign.bullmqJobKey);
        }
        // Audit log campaign update
        const changedFields = [];
        if (input.name)
            changedFields.push('name');
        if (input.description !== undefined)
            changedFields.push('description');
        if (input.channel)
            changedFields.push('channel');
        if (input.query)
            changedFields.push('query');
        if (input.email !== undefined)
            changedFields.push('email');
        if (input.sms !== undefined)
            changedFields.push('sms');
        if (input.status)
            changedFields.push('status');
        if (input.discount !== undefined)
            changedFields.push('discount');
        if (input.gift !== undefined)
            changedFields.push('gift');
        if (scheduleChanged)
            changedFields.push('schedule');
        await createAuditLog({
            action: AuditActions.campaign.updated,
            resourceType: 'campaign',
            resourceId: input.campaignId,
            metadata: {
                name: updatedCampaign.name,
                changedFields,
                channel: updatedCampaign.channel,
            },
            context: { userId: ctx.user.sub },
        });
        return {
            campaign: {
                ...updatedCampaign,
                executionType: updatedCampaign.executionType,
                conditions: updatedCampaign.conditions || {},
                retrieval: updatedCampaign.retrieval || null,
                discount: formatCampaignDiscount(updatedCampaign.discount),
                gift: formatCampaignGift(updatedCampaign.gift),
            },
            schedule,
        };
    },
});
// Helper function to process discount input, preserving existing code if not changed
function processDiscountInput(input, existing) {
    return {
        type: input.type,
        value: input.value,
        code: input.code || existing?.code || generateDiscountCode(),
        maxUsesTotal: input.maxUsesTotal ?? null,
        maxUsesPerCustomer: input.maxUsesPerCustomer ?? 1,
        minOrderValue: input.minOrderValue ?? null,
        stackable: input.stackable ?? false,
    };
}
// Helper function to process gift input, preserving existing code if not changed
function processGiftInput(input, existing) {
    return {
        type: input.type,
        sku: input.sku ?? null,
        value: input.value ?? null,
        code: input.code || existing?.code || generateGiftCode(),
        maxQuantityTotal: input.maxQuantityTotal ?? null,
        maxQuantityPerCustomer: input.maxQuantityPerCustomer ?? 1,
    };
}
export const deleteCampaignEndpoint = createAuthRoleFactory('admin').build({
    method: 'delete',
    shortDescription: 'Delete Campaign',
    description: 'Deletes (archives) a campaign definition and removes its schedule.',
    tag: 'Campaigns',
    input: z.object({
        campaignId: objectIdSchema,
    }),
    output: z.object({}),
    handler: async ({ input, ctx }) => {
        const campaign = await prisma.campaignDefinition.findUnique({
            where: { id: input.campaignId },
            select: { bullmqJobKey: true, name: true, channel: true },
        });
        if (!campaign) {
            throw createHttpError(404, 'Campaign not found');
        }
        try {
            if (campaign.bullmqJobKey) {
                await removeScheduleByKey(campaign.bullmqJobKey);
            }
            else {
                await removeCampaignSchedule(input.campaignId);
            }
        }
        catch (bullmqErr) {
            console.error('Failed to delete BullMQ schedule:', bullmqErr);
        }
        await prisma.campaignDefinition.update({
            where: { id: input.campaignId },
            data: {
                status: 'archived',
                bullmqJobKey: null,
            },
        });
        // Audit log campaign archive
        await createAuditLog({
            action: AuditActions.campaign.archived,
            resourceType: 'campaign',
            resourceId: input.campaignId,
            metadata: {
                name: campaign.name,
                channel: campaign.channel,
            },
            context: { userId: ctx.user.sub },
        });
        return {};
    },
});
export const pauseCampaignEndpoint = createAuthRoleFactory('admin', 'manager').build({
    method: 'post',
    shortDescription: 'Pause Campaign',
    description: 'Pauses a campaign, stopping scheduled executions until resumed.',
    tag: 'Campaigns',
    input: z.object({
        campaignId: objectIdSchema,
    }),
    output: z.object({
        success: z.boolean(),
        status: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const campaign = await prisma.campaignDefinition.findUnique({
            where: { id: input.campaignId },
        });
        if (!campaign) {
            throw createHttpError(404, 'Campaign not found');
        }
        if (campaign.status === 'paused') {
            return { success: true, status: 'paused' };
        }
        if (campaign.status !== 'active') {
            throw createHttpError(400, `Cannot pause campaign with status: ${campaign.status}`);
        }
        try {
            await pauseCampaignSchedule(input.campaignId, campaign.bullmqJobKey);
        }
        catch (bullmqErr) {
            console.error('Failed to pause BullMQ schedule:', bullmqErr);
            throw createHttpError(500, 'Failed to pause campaign schedule');
        }
        await prisma.campaignDefinition.update({
            where: { id: input.campaignId },
            data: { status: 'paused' },
        });
        // Audit log campaign pause
        await createAuditLog({
            action: AuditActions.campaign.paused,
            resourceType: 'campaign',
            resourceId: input.campaignId,
            metadata: {
                name: campaign.name,
                reason: 'manual',
            },
            context: { userId: ctx.user.sub },
        });
        return { success: true, status: 'paused' };
    },
});
export const resumeCampaignEndpoint = createAuthRoleFactory('admin', 'manager').build({
    method: 'post',
    shortDescription: 'Resume Campaign',
    description: 'Resumes a paused campaign, restarting scheduled executions.',
    tag: 'Campaigns',
    input: z.object({
        campaignId: objectIdSchema,
    }),
    output: z.object({
        success: z.boolean(),
        status: z.string(),
        schedule: scheduleInfoSchema,
    }),
    handler: async ({ input, ctx }) => {
        const campaign = await prisma.campaignDefinition.findUnique({
            where: { id: input.campaignId },
        });
        if (!campaign) {
            throw createHttpError(404, 'Campaign not found');
        }
        if (campaign.status === 'active') {
            const schedule = campaign.bullmqJobKey
                ? await getScheduleInfoByKey(campaign.bullmqJobKey)
                : null;
            return { success: true, status: 'active', schedule };
        }
        if (campaign.status !== 'paused') {
            throw createHttpError(400, `Cannot resume campaign with status: ${campaign.status}`);
        }
        // For "once" campaigns, just set status to active (no schedule needed)
        if (campaign.executionType === 'once') {
            await prisma.campaignDefinition.update({
                where: { id: input.campaignId },
                data: { status: 'active' },
            });
            // Audit log campaign resume
            await createAuditLog({
                action: AuditActions.campaign.resumed,
                resourceType: 'campaign',
                resourceId: input.campaignId,
                metadata: {
                    name: campaign.name,
                    executionType: 'once',
                },
                context: { userId: ctx.user.sub },
            });
            return { success: true, status: 'active', schedule: null };
        }
        // For recurring campaigns, schedule is required
        if (!campaign.cron || !campaign.startAt || !campaign.endAt) {
            throw createHttpError(400, 'Campaign is missing schedule information');
        }
        const settings = await prisma.settings.findFirst();
        const timezone = settings?.timezone || campaign.timezone || 'UTC';
        let scheduleInfo;
        try {
            scheduleInfo = await resumeCampaignSchedule(campaign.id, campaign.cron, campaign.startAt, campaign.endAt, timezone);
        }
        catch (bullmqErr) {
            console.error('Failed to resume BullMQ schedule:', bullmqErr);
            throw createHttpError(500, `Failed to resume campaign schedule. ${bullmqErr}`);
        }
        await prisma.campaignDefinition.update({
            where: { id: input.campaignId },
            data: {
                status: 'active',
                bullmqJobKey: scheduleInfo.jobKey,
            },
        });
        // Audit log campaign resume
        await createAuditLog({
            action: AuditActions.campaign.resumed,
            resourceType: 'campaign',
            resourceId: input.campaignId,
            metadata: {
                name: campaign.name,
                executionType: 'recurring',
            },
            context: { userId: ctx.user.sub },
        });
        return { success: true, status: 'active', schedule: scheduleInfo };
    },
});
export const previewCampaignEndpoint = createAuthRoleFactory('admin', 'manager', 'staff').build({
    method: 'post',
    shortDescription: 'Preview Campaign',
    description: 'Generates a preview of customers matching the campaign query.',
    tag: 'Campaigns',
    input: z.object({
        campaignId: objectIdSchema,
    }),
    output: z.object({
        campaign: z.object({
            id: z.string(),
            name: z.string(),
            query: z.union([z.string(), z.record(z.string(), z.unknown())]),
        }),
        preview: z.object({
            count: z.number(),
            customers: z.array(z.object({
                id: z.string(),
                email: z.string().nullable(),
                phone: z.string().nullable(),
                name: z.string().nullable(),
            })),
        }),
    }),
    handler: async ({ input }) => {
        const campaign = await prisma.campaignDefinition.findUnique({
            where: { id: input.campaignId },
        });
        if (!campaign) {
            throw createHttpError(404, 'Campaign not found');
        }
        let customers = [];
        try {
            const queryString = typeof campaign.query === 'string' ? campaign.query : JSON.stringify(campaign.query);
            const dsl = parseQueryDSL(queryString);
            if (isAggregationQuery(dsl)) {
                const result = await executeAggregationQuery(dsl, {
                    pageSize: 10,
                    excludeOptedOut: true,
                });
                customers = result.customers.map((c) => ({
                    id: c.id,
                    email: c.email,
                    phone: c.phone,
                    name: c.name,
                }));
            }
            else {
                const result = await executePreviewQuery(dsl, 10);
                customers = result.customers.map((c) => ({
                    id: c.id,
                    email: c.email,
                    phone: c.phone,
                    name: c.name,
                }));
            }
        }
        catch (parseErr) {
            console.error('Query parsing error:', parseErr);
            customers = [];
        }
        return {
            campaign: {
                id: campaign.id,
                name: campaign.name,
                query: campaign.query,
            },
            preview: {
                count: customers.length,
                customers,
            },
        };
    },
});
export const testCampaignEndpoint = createAuthRoleFactory('admin', 'manager').build({
    method: 'post',
    shortDescription: 'Test Campaign',
    description: 'Starts a single immediate execution of the specified campaign.',
    tag: 'Campaigns',
    input: z.object({
        campaignId: objectIdSchema,
    }),
    output: z.object({
        id: z.string(),
        campaignId: objectIdSchema,
        status: z.string(),
        runId: z.string(),
    }),
    handler: async ({ input }) => {
        const campaign = await prisma.campaignDefinition.findUnique({
            where: { id: input.campaignId },
        });
        if (!campaign) {
            throw createHttpError(404, 'Campaign not found');
        }
        const jobId = await triggerCampaignNow(input.campaignId, true);
        return {
            id: `test-${input.campaignId}-${Date.now()}`,
            campaignId: campaign.id,
            status: 'running',
            runId: jobId,
        };
    },
});
/**
 * Generate AI subject line suggestions for a campaign
 */
export const generateSubjectLinesEndpoint = createAuthRoleFactory('admin', 'manager').build({
    method: 'post',
    shortDescription: 'Generate Subject Lines',
    description: 'Uses AI to generate 5 subject line variations with different tones for an email campaign.',
    tag: 'Campaigns',
    input: z.object({
        campaignId: objectIdSchema,
    }),
    output: z.object({
        suggestions: z.array(z.object({
            subject: z.string(),
            tone: z.enum(['urgent', 'friendly', 'curiosity', 'professional', 'playful', 'exclusive']),
            reasoning: z.string(),
        })),
        error: z.string().optional(),
    }),
    handler: async ({ input }) => {
        const campaign = await prisma.campaignDefinition.findUnique({
            where: { id: input.campaignId },
        });
        if (!campaign) {
            throw createHttpError(404, 'Campaign not found');
        }
        if (campaign.channel !== 'email') {
            throw createHttpError(400, 'Subject line generation is only available for email campaigns');
        }
        // Get email content
        const email = campaign.email;
        if (!email || !email.body) {
            throw createHttpError(400, 'Campaign must have email content to generate subject lines');
        }
        // Get discount and gift info if present
        const discount = campaign.discount;
        const gift = campaign.gift;
        // Generate suggestions
        const result = await generateSubjectLines(campaign.name, campaign.description, email.body, discount, gift);
        if (!result.success || !result.suggestions) {
            return {
                suggestions: [],
                error: result.error || 'Failed to generate subject lines',
            };
        }
        return {
            suggestions: result.suggestions,
        };
    },
});
export const createCampaignFromNLEndpoint = createAuthRoleFactory('admin', 'manager').build({
    method: 'post',
    shortDescription: 'Create Campaign from Natural Language',
    description: 'Creates a new campaign from a natural language description using LLM to parse into DSL.',
    tag: 'Campaigns',
    input: z.object({
        prompt: z.string().min(10).max(1000),
    }),
    output: z.object({
        message: z.string(),
        campaign: campaignSchema.optional(),
        schedule: scheduleInfoSchema.optional(),
        parsedDsl: z.record(z.string(), z.unknown()).optional(),
        originalPrompt: z.string(),
        error: z.string().optional(),
        rejected: z.boolean().optional(),
        rejectionReason: z.string().optional(),
        rejectionCategory: z
            .enum(['gibberish', 'unrelated', 'unsafe', 'impossible', 'malicious', 'ambiguous'])
            .optional(),
    }),
    handler: async ({ input, ctx }) => {
        const userId = ctx.user.sub;
        const settings = await prisma.settings.findFirst();
        const timezone = settings?.timezone || 'UTC';
        const parseResult = await parseNaturalLanguageToCampaignDSL(input.prompt, timezone);
        if (!parseResult.success || !parseResult.dsl) {
            if (parseResult.rejected) {
                return {
                    message: 'Campaign request was rejected',
                    originalPrompt: input.prompt,
                    rejected: true,
                    rejectionReason: parseResult.rejectionReason,
                    rejectionCategory: parseResult.rejectionCategory,
                };
            }
            return {
                message: 'Failed to parse campaign from natural language',
                originalPrompt: input.prompt,
                error: parseResult.error,
            };
        }
        const dsl = parseResult.dsl;
        const startAt = new Date(dsl.startAt);
        const endAt = new Date(dsl.endAt);
        const executionType = dsl.executionType || 'recurring';
        const isRecurring = executionType === 'recurring';
        // Convert the messageTemplate from DSL to channel-specific content
        const channel = parseChannel(dsl.channel);
        const emailContent = channel === 'email'
            ? {
                subject: `Campaign: ${dsl.name}`,
                preheader: null,
                body: dsl.messageTemplate,
                html: null,
                signature: null,
                // Product recommendations from DSL
                includeRecommendations: dsl.includeRecommendations || null,
                recommendationAlgorithm: dsl.recommendationAlgorithm || null,
                recommendationLimit: dsl.recommendationLimit || null,
                excludePurchasedProducts: dsl.excludePurchasedProducts || null,
            }
            : null;
        const smsContent = channel === 'sms'
            ? {
                body: dsl.messageTemplate,
            }
            : null;
        // Process discount from DSL
        let discountData = null;
        if (dsl.discount) {
            discountData = {
                type: dsl.discount.type,
                value: dsl.discount.value,
                code: dsl.discount.code || generateDiscountCode(),
                maxUsesTotal: null,
                maxUsesPerCustomer: 1,
                minOrderValue: null,
                stackable: false,
            };
        }
        // Process gift from DSL
        let giftData = null;
        if (dsl.gift) {
            giftData = {
                type: dsl.gift.type,
                sku: dsl.gift.sku ?? null,
                value: dsl.gift.value ?? null,
                code: generateGiftCode(),
                maxQuantityTotal: null,
                maxQuantityPerCustomer: 1,
            };
        }
        // Campaign is created paused - no BullMQ schedule created yet
        // Schedule will be created when user resumes the campaign
        const campaign = await prisma.campaignDefinition.create({
            data: {
                createdBy: userId,
                name: dsl.name,
                description: dsl.description || null,
                query: JSON.stringify(dsl.query),
                email: emailContent,
                sms: smsContent,
                channel,
                conditions: dsl.conditions ? JSON.parse(JSON.stringify(dsl.conditions)) : {},
                originalPrompt: input.prompt,
                parsedDsl: JSON.parse(JSON.stringify(dsl)),
                status: 'paused',
                bullmqJobKey: isRecurring ? null : generateOnceJobKey(), // No schedule for paused recurring campaigns
                cron: dsl.cron,
                startAt,
                endAt,
                timezone,
                idempotencyKey: generateIdempotencyKey(),
                executionType,
                discount: discountData,
                gift: giftData,
            },
        });
        const message = isRecurring
            ? 'Campaign created from natural language (paused). Resume to start scheduled execution.'
            : 'Campaign created from natural language (paused). Resume to execute.';
        return {
            message,
            campaign: {
                ...campaign,
                executionType: campaign.executionType,
                conditions: campaign.conditions || {},
                retrieval: campaign.retrieval || null,
                discount: formatCampaignDiscount(campaign.discount),
                gift: formatCampaignGift(campaign.gift),
            },
            schedule: null, // No schedule created - campaign is paused
            parsedDsl: dsl,
            originalPrompt: input.prompt,
        };
    },
});
export const parseCampaignNLEndpoint = createAuthRoleFactory('admin', 'manager', 'staff').build({
    method: 'post',
    shortDescription: 'Parse Campaign from Natural Language',
    description: 'Parses a natural language description into campaign DSL without creating it.',
    tag: 'Campaigns',
    input: z.object({
        prompt: z.string().min(10).max(1000),
        timezone: z.string().optional(),
    }),
    output: z.object({
        success: z.boolean(),
        dsl: z.record(z.string(), z.unknown()).optional(),
        error: z.string().optional(),
        originalPrompt: z.string(),
        rejected: z.boolean().optional(),
        rejectionReason: z.string().optional(),
        rejectionCategory: z
            .enum(['gibberish', 'unrelated', 'unsafe', 'impossible', 'malicious', 'ambiguous'])
            .optional(),
    }),
    handler: async ({ input }) => {
        const parseResult = await parseNaturalLanguageToCampaignDSL(input.prompt, input.timezone || 'UTC');
        if (!parseResult.success || !parseResult.dsl) {
            if (parseResult.rejected) {
                return {
                    success: false,
                    originalPrompt: input.prompt,
                    rejected: true,
                    rejectionReason: parseResult.rejectionReason,
                    rejectionCategory: parseResult.rejectionCategory,
                };
            }
            return {
                success: false,
                error: parseResult.error,
                originalPrompt: input.prompt,
            };
        }
        return {
            success: true,
            dsl: parseResult.dsl,
            originalPrompt: input.prompt,
        };
    },
});
/**
 * Campaign Statistics endpoint - comprehensive analytics data
 */
export const getCampaignStatsEndpoint = createAuthRoleFactory('admin', 'manager').build({
    method: 'get',
    shortDescription: 'Get Campaign Statistics',
    description: 'Returns comprehensive statistics for a campaign including metrics, time-series data for charts, revenue attribution, and recent activity.',
    tag: 'Campaigns',
    input: z.object({
        campaignId: objectIdSchema,
        period: z.enum(['7d', '14d', '30d', '90d']).default('30d'),
    }),
    output: z.object({
        campaignId: objectIdSchema,
        campaignName: z.string(),
        channel: z.string(),
        // Aggregate metrics
        metrics: z.object({
            totalSent: z.number(),
            totalDelivered: z.number(),
            totalOpened: z.number(),
            totalClicked: z.number(),
            totalBounced: z.number(),
            totalFailed: z.number(),
            totalComplained: z.number(),
            totalUnsubscribed: z.number(),
            deliveryRate: z.number(),
            openRate: z.number(),
            clickRate: z.number(),
            bounceRate: z.number(),
            complaintRate: z.number(),
            clickToOpenRate: z.number(),
        }),
        // Revenue attribution
        revenue: z.object({
            totalRevenue: z.number(),
            totalOrders: z.number(),
            averageOrderValue: z.number(),
            attributionWindow: z.string(),
            attributionModel: z.string(),
        }),
        // Time-series data for charts
        timeSeries: z.object({
            period: z.string(),
            startDate: z.string(),
            endDate: z.string(),
            data: z.array(z.object({
                date: z.string(),
                sent: z.number(),
                delivered: z.number(),
                opened: z.number(),
                clicked: z.number(),
                bounced: z.number(),
                failed: z.number(),
            })),
        }),
        // Hourly distribution for best send time analysis
        hourlyDistribution: z.array(z.object({
            hour: z.number(),
            sent: z.number(),
            openRate: z.number(),
            clickRate: z.number(),
        })),
        // Recent activity
        recentActivity: z.array(z.object({
            id: z.string(),
            customerId: z.string(),
            customerEmail: z.string().nullable(),
            customerName: z.string().nullable(),
            status: z.string(),
            sentAt: z.date().nullable(),
            deliveredAt: z.date().nullable(),
            openedAt: z.date().nullable(),
            clickedAt: z.date().nullable(),
        })),
        // Execution history for recurring campaigns
        executions: z.array(z.object({
            id: z.string(),
            startedAt: z.date(),
            completedAt: z.date().nullable(),
            status: z.string(),
            customersTargeted: z.number(),
            messagesSent: z.number(),
        })),
    }),
    handler: async ({ input }) => {
        const campaign = await prisma.campaignDefinition.findUnique({
            where: { id: input.campaignId },
        });
        if (!campaign) {
            throw createHttpError(404, 'Campaign not found');
        }
        // Calculate date range based on period
        const periodDays = {
            '7d': 7,
            '14d': 14,
            '30d': 30,
            '90d': 90,
        }[input.period];
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - periodDays);
        // Get all message logs for this campaign within period
        const messageLogs = await prisma.messageLog.findMany({
            where: {
                campaignId: input.campaignId,
                createdAt: { gte: startDate, lte: endDate },
            },
            include: {
                customer: {
                    select: { id: true, email: true, name: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        // Calculate aggregate metrics
        const totalSent = messageLogs.length;
        const totalDelivered = messageLogs.filter((m) => m.deliveryStatus === 'delivered' ||
            m.deliveryStatus === 'opened' ||
            m.deliveryStatus === 'clicked').length;
        const totalOpened = messageLogs.filter((m) => m.deliveryStatus === 'opened' || m.deliveryStatus === 'clicked').length;
        const totalClicked = messageLogs.filter((m) => m.deliveryStatus === 'clicked').length;
        const totalBounced = messageLogs.filter((m) => m.deliveryStatus === 'bounced').length;
        const totalFailed = messageLogs.filter((m) => m.deliveryStatus === 'failed').length;
        const totalComplained = messageLogs.filter((m) => m.deliveryStatus === 'complained').length;
        const totalUnsubscribed = messageLogs.filter((m) => m.deliveryStatus === 'unsubscribed').length;
        const deliveryRate = totalSent > 0 ? totalDelivered / totalSent : 0;
        const openRate = totalDelivered > 0 ? totalOpened / totalDelivered : 0;
        const clickRate = totalDelivered > 0 ? totalClicked / totalDelivered : 0;
        const bounceRate = totalSent > 0 ? totalBounced / totalSent : 0;
        const complaintRate = totalDelivered > 0 ? totalComplained / totalDelivered : 0;
        const clickToOpenRate = totalOpened > 0 ? totalClicked / totalOpened : 0;
        // Build time-series data (daily aggregation)
        const timeSeriesMap = new Map();
        // Initialize all days in the period
        for (let i = 0; i < periodDays; i++) {
            const date = new Date(startDate);
            date.setDate(date.getDate() + i);
            const dateKey = date.toISOString().split('T')[0];
            timeSeriesMap.set(dateKey, {
                sent: 0,
                delivered: 0,
                opened: 0,
                clicked: 0,
                bounced: 0,
                failed: 0,
            });
        }
        // Populate time-series data from message logs
        for (const log of messageLogs) {
            const dateKey = log.createdAt.toISOString().split('T')[0];
            const dayData = timeSeriesMap.get(dateKey);
            if (dayData) {
                dayData.sent++;
                if (log.deliveryStatus === 'delivered' ||
                    log.deliveryStatus === 'opened' ||
                    log.deliveryStatus === 'clicked') {
                    dayData.delivered++;
                }
                if (log.deliveryStatus === 'opened' || log.deliveryStatus === 'clicked') {
                    dayData.opened++;
                }
                if (log.deliveryStatus === 'clicked') {
                    dayData.clicked++;
                }
                if (log.deliveryStatus === 'bounced') {
                    dayData.bounced++;
                }
                if (log.deliveryStatus === 'failed') {
                    dayData.failed++;
                }
            }
        }
        const timeSeriesData = Array.from(timeSeriesMap.entries())
            .map(([date, data]) => ({ date, ...data }))
            .sort((a, b) => a.date.localeCompare(b.date));
        // Build hourly distribution for optimal send time analysis
        const hourlyMap = new Map();
        for (let h = 0; h < 24; h++) {
            hourlyMap.set(h, { sent: 0, opened: 0, clicked: 0 });
        }
        for (const log of messageLogs) {
            if (log.sentAt) {
                const hour = log.sentAt.getUTCHours();
                const hourData = hourlyMap.get(hour);
                hourData.sent++;
                if (log.deliveryStatus === 'opened' || log.deliveryStatus === 'clicked') {
                    hourData.opened++;
                }
                if (log.deliveryStatus === 'clicked') {
                    hourData.clicked++;
                }
            }
        }
        const hourlyDistribution = Array.from(hourlyMap.entries()).map(([hour, data]) => ({
            hour,
            sent: data.sent,
            openRate: data.sent > 0 ? data.opened / data.sent : 0,
            clickRate: data.sent > 0 ? data.clicked / data.sent : 0,
        }));
        // Get recent activity (last 20 messages)
        const recentActivity = messageLogs.slice(0, 20).map((log) => ({
            id: log.id,
            customerId: log.customerId,
            customerEmail: log.customer?.email || null,
            customerName: log.customer?.name || null,
            status: log.deliveryStatus,
            sentAt: log.sentAt,
            deliveredAt: log.deliveredAt,
            openedAt: log.openedAt,
            clickedAt: log.clickedAt,
        }));
        // Get campaign executions
        const executions = await prisma.campaignExecution.findMany({
            where: { campaignId: input.campaignId },
            orderBy: { startedAt: 'desc' },
            take: 10,
        });
        // Calculate revenue attribution
        const revenueData = await calculateCampaignRevenue(input.campaignId, undefined, startDate, endDate);
        return {
            campaignId: campaign.id,
            campaignName: campaign.name,
            channel: campaign.channel,
            metrics: {
                totalSent,
                totalDelivered,
                totalOpened,
                totalClicked,
                totalBounced,
                totalFailed,
                totalComplained,
                totalUnsubscribed,
                deliveryRate,
                openRate,
                clickRate,
                bounceRate,
                complaintRate,
                clickToOpenRate,
            },
            revenue: {
                totalRevenue: revenueData.totalRevenue,
                totalOrders: revenueData.totalOrders,
                averageOrderValue: revenueData.averageOrderValue,
                attributionWindow: revenueData.attributionWindow,
                attributionModel: revenueData.attributionModel,
            },
            timeSeries: {
                period: input.period,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                data: timeSeriesData,
            },
            hourlyDistribution,
            recentActivity,
            executions: executions.map((e) => ({
                id: e.id,
                startedAt: e.startedAt,
                completedAt: e.completedAt,
                status: e.status,
                customersTargeted: e.customersMatched || 0,
                messagesSent: e.messagesSent || 0,
            })),
        };
    },
});
/**
 * Export campaign data as CSV
 */
export const exportCampaignDataEndpoint = createAuthRoleFactory('admin', 'manager').build({
    method: 'get',
    shortDescription: 'Export Campaign Data',
    description: 'Exports all message logs for a campaign as CSV data.',
    tag: 'Campaigns',
    input: z.object({
        campaignId: objectIdSchema,
        format: z.enum(['csv', 'json']).default('csv'),
    }),
    output: z.object({
        filename: z.string(),
        contentType: z.string(),
        data: z.string(),
        recordCount: z.number(),
    }),
    handler: async ({ input }) => {
        const campaign = await prisma.campaignDefinition.findUnique({
            where: { id: input.campaignId },
        });
        if (!campaign) {
            throw createHttpError(404, 'Campaign not found');
        }
        const messageLogs = await prisma.messageLog.findMany({
            where: { campaignId: input.campaignId },
            include: {
                customer: {
                    select: { id: true, email: true, name: true, phone: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        const timestamp = new Date().toISOString().split('T')[0];
        const safeName = campaign.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
        if (input.format === 'json') {
            const jsonData = messageLogs.map((log) => ({
                messageId: log.id,
                customerId: log.customerId,
                customerEmail: log.customer?.email || '',
                customerName: log.customer?.name || '',
                customerPhone: log.customer?.phone || '',
                channel: log.channel,
                recipient: log.recipient,
                subject: log.subject || '',
                status: log.deliveryStatus,
                sentAt: log.sentAt?.toISOString() || '',
                deliveredAt: log.deliveredAt?.toISOString() || '',
                openedAt: log.openedAt?.toISOString() || '',
                clickedAt: log.clickedAt?.toISOString() || '',
                createdAt: log.createdAt.toISOString(),
                isTest: log.isTest,
            }));
            return {
                filename: `${safeName}_export_${timestamp}.json`,
                contentType: 'application/json',
                data: JSON.stringify(jsonData, null, 2),
                recordCount: messageLogs.length,
            };
        }
        // CSV format
        const headers = [
            'Message ID',
            'Customer ID',
            'Customer Email',
            'Customer Name',
            'Customer Phone',
            'Channel',
            'Recipient',
            'Subject',
            'Status',
            'Sent At',
            'Delivered At',
            'Opened At',
            'Clicked At',
            'Created At',
            'Is Test',
        ];
        const csvRows = [headers.join(',')];
        for (const log of messageLogs) {
            const row = [
                log.id,
                log.customerId,
                log.customer?.email || '',
                log.customer?.name || '',
                log.customer?.phone || '',
                log.channel,
                log.recipient,
                (log.subject || '').replace(/"/g, '""'),
                log.deliveryStatus,
                log.sentAt?.toISOString() || '',
                log.deliveredAt?.toISOString() || '',
                log.openedAt?.toISOString() || '',
                log.clickedAt?.toISOString() || '',
                log.createdAt.toISOString(),
                log.isTest ? 'true' : 'false',
            ].map((field) => {
                const str = String(field);
                return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
            });
            csvRows.push(row.join(','));
        }
        return {
            filename: `${safeName}_export_${timestamp}.csv`,
            contentType: 'text/csv',
            data: csvRows.join('\n'),
            recordCount: messageLogs.length,
        };
    },
});
export const previewCampaignMessageEndpoint = createAuthRoleFactory('admin', 'manager', 'staff').build({
    method: 'post',
    shortDescription: 'Preview Campaign Message',
    description: 'Renders the campaign message content with sample data for preview.',
    tag: 'Campaigns',
    input: z.object({
        campaignId: objectIdSchema,
        sampleData: z
            .object({
            name: z.string().optional(),
            email: z.string().optional(),
            phone: z.string().optional(),
            firstName: z.string().optional(),
            lastName: z.string().optional(),
            code: z.string().optional(),
            discount: z.string().optional(),
            gift: z.string().optional(),
        })
            .optional(),
    }),
    output: z.object({
        email: z
            .object({
            subject: z.string(),
            preheader: z.string().optional(),
            body: z.string(),
            html: z.string().optional(),
        })
            .nullable(),
        sms: z
            .object({
            body: z.string(),
        })
            .nullable(),
        warnings: z.array(z.string()),
    }),
    handler: async ({ input }) => {
        const campaign = await prisma.campaignDefinition.findUnique({
            where: { id: input.campaignId },
        });
        if (!campaign) {
            throw createHttpError(404, 'Campaign not found');
        }
        // Build sample data with defaults
        const sampleData = {
            name: input.sampleData?.name || 'John Doe',
            email: input.sampleData?.email || 'john.doe@example.com',
            phone: input.sampleData?.phone || '+1234567890',
            firstName: input.sampleData?.firstName || 'John',
            lastName: input.sampleData?.lastName || 'Doe',
            code: input.sampleData?.code || 'SAMPLE20',
            discount: input.sampleData?.discount || '20% off',
            gift: input.sampleData?.gift || 'Free sample kit',
            promo_code: input.sampleData?.code || 'SAMPLE20',
        };
        const warnings = [];
        let emailResult = null;
        let smsResult = null;
        // Render email content if available
        if (campaign.email) {
            const emailContent = campaign.email;
            const rendered = renderEmailContent(emailContent, sampleData);
            emailResult = {
                subject: rendered.subject,
                preheader: rendered.preheader,
                body: rendered.body,
                html: rendered.html,
            };
            warnings.push(...validateContentLimits('email', rendered));
        }
        // Render SMS content if available
        if (campaign.sms) {
            const smsContent = campaign.sms;
            const rendered = renderSmsContent(smsContent, sampleData);
            smsResult = {
                body: rendered.body,
            };
            warnings.push(...validateContentLimits('sms', rendered));
        }
        return {
            email: emailResult,
            sms: smsResult,
            warnings,
        };
    },
});
/**
 * Preview Query Endpoint
 *
 * Returns real-time customer count for a query DSL without executing the full query.
 * Supports nested AND/OR/NOT logic with aggregations.
 * Rate limited to prevent abuse.
 */
export const previewQueryEndpoint = createAuthRoleFactory('admin', 'manager', 'staff').build({
    method: 'post',
    shortDescription: 'Preview Query',
    description: 'Get real-time customer count for a query DSL. Supports nested AND/OR/NOT with aggregations.',
    tag: 'Campaigns',
    input: z.object({
        query: z.union([z.string(), z.record(z.string(), z.unknown())]),
    }),
    output: z.object({
        count: z.number(),
        executionTimeMs: z.number(),
        conditionCount: z.number(),
        maxConditions: z.number(),
        hasAggregations: z.boolean(),
        errors: z.array(z.string()),
        warnings: z.array(z.string()),
    }),
    handler: async ({ input }) => {
        const dsl = typeof input.query === 'string' ? parseQueryDSL(input.query) : input.query;
        // Validate query
        const validation = validateQuery(dsl);
        if (!validation.valid) {
            return {
                count: 0,
                executionTimeMs: 0,
                conditionCount: validation.conditionCount,
                maxConditions: MAX_QUERY_CONDITIONS,
                hasAggregations: containsAggregation(dsl),
                errors: validation.errors,
                warnings: validation.warnings,
            };
        }
        try {
            const result = await executeCountOnlyQuery(dsl, {
                excludeOptedOut: true,
            });
            return {
                count: result.count,
                executionTimeMs: result.executionTimeMs,
                conditionCount: result.conditionCount,
                maxConditions: MAX_QUERY_CONDITIONS,
                hasAggregations: containsAggregation(dsl),
                errors: [],
                warnings: validation.warnings,
            };
        }
        catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Query execution failed';
            return {
                count: 0,
                executionTimeMs: 0,
                conditionCount: validation.conditionCount,
                maxConditions: MAX_QUERY_CONDITIONS,
                hasAggregations: containsAggregation(dsl),
                errors: [errorMessage],
                warnings: validation.warnings,
            };
        }
    },
});
// ============================================================
// REVENUE ATTRIBUTION ENDPOINTS
// ============================================================
const attributionModelSchema = z.enum(['last_touch', 'first_touch', 'linear']);
/**
 * Get revenue attributed to a campaign
 */
export const getCampaignRevenueEndpoint = createAuthRoleFactory('admin', 'manager', 'staff').build({
    method: 'get',
    shortDescription: 'Get Campaign Revenue',
    description: 'Returns revenue attributed to a specific campaign based on attribution settings.',
    tag: 'Campaigns',
    input: z.object({
        campaignId: objectIdSchema,
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        attributionWindow: z.coerce
            .number()
            .refine((v) => v === 7 || v === 30)
            .optional(),
        attributionModel: attributionModelSchema.optional(),
    }),
    output: z.object({
        campaignId: z.string(),
        campaignName: z.string(),
        totalRevenue: z.number(),
        totalOrders: z.number(),
        averageOrderValue: z.number(),
        attributionWindow: z.string(),
        attributionModel: z.string(),
        conversionRate: z.number(),
        revenuePerMessage: z.number(),
        messagesSent: z.number(),
    }),
    handler: async ({ input }) => {
        const campaign = await prisma.campaignDefinition.findUnique({
            where: { id: input.campaignId },
        });
        if (!campaign) {
            throw createHttpError(404, 'Campaign not found');
        }
        // Count messages sent
        const messagesSent = await prisma.messageLog.count({
            where: {
                campaignId: input.campaignId,
                deliveryStatus: { in: ['sent', 'delivered', 'opened', 'clicked'] },
            },
        });
        // Calculate revenue with optional overrides
        const config = {};
        if (input.attributionWindow)
            config.windowDays = input.attributionWindow;
        if (input.attributionModel)
            config.model = input.attributionModel;
        const startDate = input.startDate ? new Date(input.startDate) : undefined;
        const endDate = input.endDate ? new Date(input.endDate) : undefined;
        const revenue = await calculateCampaignRevenue(input.campaignId, config, startDate, endDate);
        const conversionRate = messagesSent > 0 ? revenue.totalOrders / messagesSent : 0;
        const revenuePerMessage = messagesSent > 0 ? revenue.totalRevenue / messagesSent : 0;
        return {
            campaignId: input.campaignId,
            campaignName: campaign.name,
            totalRevenue: revenue.totalRevenue,
            totalOrders: revenue.totalOrders,
            averageOrderValue: revenue.averageOrderValue,
            attributionWindow: revenue.attributionWindow,
            attributionModel: revenue.attributionModel,
            conversionRate,
            revenuePerMessage,
            messagesSent,
        };
    },
});
/**
 * Get detailed revenue breakdown for a campaign (for CSV export)
 */
export const getCampaignRevenueBreakdownEndpoint = createAuthRoleFactory('admin', 'manager').build({
    method: 'get',
    shortDescription: 'Get Campaign Revenue Breakdown',
    description: 'Returns detailed message-to-order attribution breakdown for export.',
    tag: 'Campaigns',
    input: z.object({
        campaignId: objectIdSchema,
        attributionWindow: z.coerce
            .number()
            .refine((v) => v === 7 || v === 30)
            .optional(),
        attributionModel: attributionModelSchema.optional(),
        limit: z.coerce.number().min(1).max(1000).default(100),
        offset: z.coerce.number().min(0).default(0),
    }),
    output: z.object({
        campaignId: z.string(),
        campaignName: z.string(),
        totalRecords: z.number(),
        attributionWindow: z.string(),
        attributionModel: z.string(),
        breakdown: z.array(z.object({
            messageId: z.string(),
            customerId: z.string(),
            customerEmail: z.string().nullable(),
            messageSentAt: z.string(),
            orderId: z.string(),
            orderTotal: z.number(),
            orderPlacedAt: z.string(),
            attributedAmount: z.number(),
            attributionModel: z.string(),
            daysToConversion: z.number(),
        })),
    }),
    handler: async ({ input }) => {
        const campaign = await prisma.campaignDefinition.findUnique({
            where: { id: input.campaignId },
        });
        if (!campaign) {
            throw createHttpError(404, 'Campaign not found');
        }
        const config = {};
        if (input.attributionWindow)
            config.windowDays = input.attributionWindow;
        if (input.attributionModel)
            config.model = input.attributionModel;
        const allBreakdown = await getCampaignAttributionBreakdown(input.campaignId, config);
        // Apply pagination
        const paginatedBreakdown = allBreakdown.slice(input.offset, input.offset + input.limit);
        // Get settings for attribution info
        const settings = await prisma.settings.findFirst();
        const windowDays = input.attributionWindow || settings?.attributionWindowDays || 7;
        const model = input.attributionModel || settings?.attributionModel || 'last_touch';
        return {
            campaignId: input.campaignId,
            campaignName: campaign.name,
            totalRecords: allBreakdown.length,
            attributionWindow: `${windowDays} days`,
            attributionModel: model,
            breakdown: paginatedBreakdown.map((item) => ({
                messageId: item.messageId,
                customerId: item.customerId,
                customerEmail: item.customerEmail,
                messageSentAt: item.messageSentAt.toISOString(),
                orderId: item.orderId,
                orderTotal: item.orderTotal,
                orderPlacedAt: item.orderPlacedAt.toISOString(),
                attributedAmount: item.attributedAmount,
                attributionModel: item.attributionModel,
                daysToConversion: item.daysToConversion,
            })),
        };
    },
});
