import { z } from 'zod';
import { createAuthRoleFactory } from '../factories';
import prisma from '../utils/prisma';
import createHttpError from 'http-errors';
import { providerRegistry } from '../providers';
import { objectIdSchema } from '../utils/validation';
const messageLogSchema = z.object({
    id: z.string(),
    campaignId: z.string().nullable(),
    customerId: z.string(),
    channel: z.string(),
    recipient: z.string(),
    subject: z.string().nullable(),
    body: z.string(),
    providerName: z.string().nullable(),
    providerMessageId: z.string().nullable(),
    deliveryStatus: z.string(),
    sentAt: z.date().nullable(),
    deliveredAt: z.date().nullable(),
    openedAt: z.date().nullable(),
    clickedAt: z.date().nullable(),
    errorMessage: z.string().nullable(),
    retryCount: z.number(),
    isTest: z.boolean(),
    correlationId: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});
const messageFactory = createAuthRoleFactory('admin', 'manager', 'staff');
export const listMessageLogsEndpoint = messageFactory.build({
    method: 'get',
    shortDescription: 'List Message Logs',
    description: 'Returns a list of message logs with filtering options.',
    tag: 'Messages',
    input: z.object({
        page: z.coerce.number().min(1).default(1),
        pageSize: z.coerce.number().min(1).max(100).default(50),
        campaignId: z.string().optional(),
        customerId: z.string().optional(),
        channel: z.enum(['email', 'sms', 'whatsapp', 'rcs', 'push']).optional(),
        status: z.string().optional(),
        isTest: z.coerce.boolean().optional(),
    }),
    output: z.object({
        items: z.array(messageLogSchema),
        total: z.number(),
        page: z.number(),
        pageSize: z.number(),
        hasMore: z.boolean(),
    }),
    handler: async ({ input }) => {
        const { page, pageSize, campaignId, customerId, channel, status, isTest } = input;
        const skip = (page - 1) * pageSize;
        const where = {};
        if (campaignId)
            where.campaignId = campaignId;
        if (customerId)
            where.customerId = customerId;
        if (channel)
            where.channel = channel;
        if (status)
            where.deliveryStatus = status;
        if (isTest !== undefined)
            where.isTest = isTest;
        const [items, total] = await Promise.all([
            prisma.messageLog.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: { createdAt: 'desc' },
            }),
            prisma.messageLog.count({ where }),
        ]);
        return {
            items,
            total,
            page,
            pageSize,
            hasMore: skip + items.length < total,
        };
    },
});
export const getMessageLogEndpoint = messageFactory.build({
    method: 'get',
    shortDescription: 'Get Message Log',
    description: 'Returns details of a specific message log by ID.',
    tag: 'Messages',
    input: z.object({
        messageId: objectIdSchema,
    }),
    output: messageLogSchema.extend({
        customer: z
            .object({
            id: z.string(),
            email: z.string().nullable(),
            name: z.string().nullable(),
        })
            .nullable(),
        campaign: z
            .object({
            id: z.string(),
            name: z.string(),
        })
            .nullable(),
    }),
    handler: async ({ input }) => {
        const message = await prisma.messageLog.findUnique({
            where: {
                id: input.messageId,
            },
            include: {
                customer: {
                    select: { id: true, email: true, name: true },
                },
                campaign: {
                    select: { id: true, name: true },
                },
            },
        });
        if (!message) {
            throw createHttpError(404, 'Message not found');
        }
        return message;
    },
});
const retryFactory = createAuthRoleFactory('admin', 'manager');
export const retryMessageEndpoint = retryFactory.build({
    method: 'post',
    shortDescription: 'Retry Message',
    description: 'Retries sending a failed message.',
    tag: 'Messages',
    input: z.object({
        messageId: objectIdSchema,
    }),
    output: z.object({
        success: z.boolean(),
        newMessageId: z.string().optional(),
        error: z.string().optional(),
    }),
    handler: async ({ input }) => {
        const message = await prisma.messageLog.findUnique({
            where: {
                id: input.messageId,
            },
            include: {
                customer: true,
            },
        });
        if (!message) {
            throw createHttpError(404, 'Message not found');
        }
        if (!['failed', 'bounced'].includes(message.deliveryStatus)) {
            throw createHttpError(400, 'Can only retry failed or bounced messages');
        }
        const MAX_RETRIES = 3;
        if (message.retryCount >= MAX_RETRIES) {
            throw createHttpError(400, `Maximum retry limit (${MAX_RETRIES}) reached`);
        }
        const provider = providerRegistry.getForChannel(message.channel);
        if (!provider) {
            throw createHttpError(500, `No provider available for channel: ${message.channel}`);
        }
        const result = await provider.send({
            to: message.recipient,
            subject: message.subject || undefined,
            body: message.body,
            metadata: {
                customerId: message.customerId,
                campaignId: message.campaignId || undefined,
                isRetry: true,
                originalMessageId: message.id,
            },
        });
        if (result.success) {
            await prisma.messageLog.update({
                where: { id: message.id },
                data: {
                    retryCount: message.retryCount + 1,
                    deliveryStatus: 'sent',
                    providerMessageId: result.providerMessageId,
                    sentAt: new Date(),
                    errorMessage: null,
                },
            });
            return { success: true };
        }
        else {
            await prisma.messageLog.update({
                where: { id: message.id },
                data: {
                    retryCount: message.retryCount + 1,
                    errorMessage: result.error || 'Retry failed',
                },
            });
            return {
                success: false,
                error: result.error || 'Retry failed',
            };
        }
    },
});
