import { z } from 'zod';
import { createAuthRoleFactory, authFactory, publicFactory } from '../factories';
import prisma from '../utils/prisma';
import createHttpError from 'http-errors';
import { objectIdSchema } from '../utils/validation';
import { createAuditLog, extractAuditContext, AuditActions } from '../utils/audit';
import { checkAndRecordConversion, mapEventToConversion } from '../utils/experiment-conversions';
import { enrollInMatchingFlows } from '../utils/flow-matcher';
const managerFactory = createAuthRoleFactory('admin', 'manager', 'staff');
const customerSchema = z.object({
    id: z.string(),
    externalId: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    name: z.string().nullable(),
    optOut: z.boolean(),
    lastContactAt: z.string().nullable(),
    lastOrderAt: z.string().nullable(),
    totalOrders: z.number(),
    totalSpent: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export const listCustomersEndpoint = managerFactory.build({
    method: 'get',
    shortDescription: 'List Customers',
    description: 'Returns a paginated list of customers.',
    tag: 'Customers',
    input: z.object({
        page: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 1)),
        pageSize: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 20)),
        search: z.string().optional(),
        optedOut: z
            .string()
            .optional()
            .transform((v) => v === 'true'),
    }),
    output: z.object({
        items: z.array(customerSchema),
        total: z.number(),
        page: z.number(),
        pageSize: z.number(),
        hasMore: z.boolean(),
    }),
    handler: async ({ input }) => {
        const { page, pageSize, search, optedOut } = input;
        const skip = (page - 1) * pageSize;
        const where = {};
        if (optedOut !== undefined) {
            where.optOut = optedOut;
        }
        if (search) {
            where.OR = [
                { email: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } },
            ];
        }
        const [customers, total] = await Promise.all([
            prisma.customer.findMany({
                where,
                skip,
                take: pageSize + 1,
                orderBy: { createdAt: 'desc' },
            }),
            prisma.customer.count({ where }),
        ]);
        const hasMore = customers.length > pageSize;
        if (hasMore)
            customers.pop();
        return {
            items: customers.map((c) => ({
                id: c.id,
                externalId: c.externalId,
                email: c.email,
                phone: c.phone,
                name: c.name,
                optOut: c.optOut,
                lastContactAt: c.lastContactAt?.toISOString() ?? null,
                lastOrderAt: c.lastOrderAt?.toISOString() ?? null,
                totalOrders: c.totalOrders,
                totalSpent: c.totalSpent,
                createdAt: c.createdAt.toISOString(),
                updatedAt: c.updatedAt.toISOString(),
            })),
            total,
            page,
            pageSize,
            hasMore,
        };
    },
});
export const getCustomerEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'Get Customer',
    description: 'Returns details of a specific customer by ID.',
    tag: 'Customers',
    input: z.object({
        customerId: objectIdSchema,
    }),
    output: customerSchema.extend({
        orders: z.array(z.object({
            id: z.string(),
            total: z.number(),
            purchasedAt: z.string(),
            itemCount: z.number(),
        })),
        recentMessages: z.array(z.object({
            id: z.string(),
            channel: z.string(),
            sentAt: z.string(),
            deliveryStatus: z.string(),
        })),
    }),
    handler: async ({ input }) => {
        const customer = await prisma.customer.findUnique({
            where: { id: input.customerId },
            include: {
                orders: {
                    take: 10,
                    orderBy: { purchasedAt: 'desc' },
                    include: { _count: { select: { items: true } } },
                },
                messageLogs: {
                    take: 10,
                    orderBy: { sentAt: 'desc' },
                },
            },
        });
        if (!customer) {
            throw createHttpError(404, 'Customer not found');
        }
        return {
            id: customer.id,
            externalId: customer.externalId,
            email: customer.email,
            phone: customer.phone,
            name: customer.name,
            optOut: customer.optOut,
            lastContactAt: customer.lastContactAt?.toISOString() ?? null,
            lastOrderAt: customer.lastOrderAt?.toISOString() ?? null,
            totalOrders: customer.totalOrders,
            totalSpent: customer.totalSpent,
            createdAt: customer.createdAt.toISOString(),
            updatedAt: customer.updatedAt.toISOString(),
            orders: customer.orders.map((o) => ({
                id: o.id,
                total: o.total,
                purchasedAt: o.purchasedAt.toISOString(),
                itemCount: o._count.items,
            })),
            recentMessages: customer.messageLogs.map((m) => ({
                id: m.id,
                channel: m.channel,
                sentAt: m.sentAt?.toISOString() || m.createdAt.toISOString(),
                deliveryStatus: m.deliveryStatus,
            })),
        };
    },
});
export const upsertCustomerEndpoint = managerFactory.build({
    method: 'post',
    shortDescription: 'Create/Update Customer',
    description: 'Creates a new customer or updates an existing one by email or externalId.',
    tag: 'Customers',
    input: z.object({
        externalId: z.string().optional(),
        email: z.email().optional(),
        phone: z.string().optional(),
        name: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    }),
    output: z.object({
        id: z.string(),
        created: z.boolean(),
    }),
    handler: async ({ input, ctx }) => {
        const { externalId, email, phone, name, metadata } = input;
        if (!email && !externalId) {
            throw createHttpError(400, 'Either email or externalId is required');
        }
        let existingCustomer = null;
        if (externalId) {
            existingCustomer = await prisma.customer.findFirst({
                where: { externalId },
            });
        }
        if (!existingCustomer && email) {
            existingCustomer = await prisma.customer.findFirst({
                where: { email },
            });
        }
        let customer;
        let created = false;
        if (existingCustomer) {
            customer = await prisma.customer.update({
                where: { id: existingCustomer.id },
                data: {
                    ...(email && { email }),
                    ...(phone && { phone }),
                    ...(name && { name }),
                    ...(externalId && { externalId }),
                    ...(metadata && { metadata: JSON.parse(JSON.stringify(metadata)) }),
                },
            });
            const auditContext = extractAuditContext(ctx.request, ctx.user);
            const changedFields = [];
            if (email && email !== existingCustomer.email)
                changedFields.push('email');
            if (phone && phone !== existingCustomer.phone)
                changedFields.push('phone');
            if (name && name !== existingCustomer.name)
                changedFields.push('name');
            if (externalId && externalId !== existingCustomer.externalId)
                changedFields.push('externalId');
            if (metadata)
                changedFields.push('metadata');
            if (changedFields.length > 0) {
                await createAuditLog({
                    action: AuditActions.customer.updated,
                    resourceType: 'customer',
                    resourceId: customer.id,
                    metadata: {
                        name: customer.name,
                        email: customer.email,
                        changedFields,
                    },
                    context: auditContext,
                });
            }
        }
        else {
            customer = await prisma.customer.create({
                data: {
                    email,
                    phone,
                    name,
                    externalId,
                    metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
                },
            });
            created = true;
            const auditContext = extractAuditContext(ctx.request, ctx.user);
            await createAuditLog({
                action: AuditActions.customer.created,
                resourceType: 'customer',
                resourceId: customer.id,
                metadata: { name, email, phone, externalId },
                context: auditContext,
            });
        }
        return {
            id: customer.id,
            created,
        };
    },
});
export const updateOptOutEndpoint = authFactory.build({
    method: 'post',
    shortDescription: 'Update Opt-Out',
    description: 'Updates customer opt-out status for messaging.',
    tag: 'Customers',
    input: z.object({
        customerId: objectIdSchema,
        optOut: z.boolean(),
        channels: z.array(z.enum(['email', 'sms', 'whatsapp', 'rcs', 'push'])).optional(),
    }),
    output: z.object({
        success: z.boolean(),
    }),
    handler: async ({ input, ctx }) => {
        const customer = await prisma.customer.findUnique({
            where: { id: input.customerId },
        });
        if (!customer) {
            throw createHttpError(404, 'Customer not found');
        }
        await prisma.customer.update({
            where: { id: input.customerId },
            data: {
                optOut: input.optOut,
                ...(input.channels && { optOutChannels: input.channels }),
            },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: AuditActions.customer.optedOut,
            resourceType: 'customer',
            resourceId: input.customerId,
            metadata: {
                optOut: input.optOut,
                channels: input.channels,
            },
            context: auditContext,
        });
        return { success: true };
    },
});
export const ingestCustomerEventEndpoint = publicFactory.build({
    method: 'post',
    shortDescription: 'Ingest Customer Event',
    description: 'Ingests an event for a customer. Used for tracking orders, opens, clicks, etc.',
    tag: 'Customers',
    input: z.object({
        customerId: z.string().optional(),
        email: z.email().optional(),
        externalId: z.string().optional(),
        eventType: z.string(),
        eventData: z.record(z.string(), z.unknown()).optional(),
        occurredAt: z.string().datetime().optional(),
        idempotencyKey: z.string().optional(),
    }),
    output: z.object({
        success: z.boolean(),
        eventId: z.string().nullable(),
        customerId: z.string().nullable(),
    }),
    handler: async ({ input }) => {
        const { eventType, eventData, idempotencyKey } = input;
        const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
        if (idempotencyKey) {
            const existingEvent = await prisma.customerEvent.findUnique({
                where: { idempotencyKey },
            });
            if (existingEvent) {
                return {
                    success: true,
                    eventId: existingEvent.id,
                    customerId: existingEvent.customerId,
                };
            }
        }
        let customer = null;
        if (input.customerId) {
            customer = await prisma.customer.findUnique({
                where: { id: input.customerId },
            });
        }
        else if (input.email) {
            customer = await prisma.customer.findFirst({
                where: { email: input.email },
            });
        }
        else if (input.externalId) {
            customer = await prisma.customer.findFirst({
                where: { externalId: input.externalId },
            });
        }
        if (!customer && (input.email || input.externalId)) {
            customer = await prisma.customer.create({
                data: {
                    email: input.email,
                    externalId: input.externalId,
                },
            });
        }
        if (!customer) {
            throw createHttpError(400, 'Customer not found and cannot be created');
        }
        const event = await prisma.customerEvent.create({
            data: {
                customerId: customer.id,
                eventType,
                eventData: eventData ? JSON.parse(JSON.stringify(eventData)) : undefined,
                occurredAt,
                idempotencyKey,
                source: 'api',
            },
        });
        if (eventType === 'order_placed' && eventData) {
            const orderTotal = eventData.total || 0;
            await prisma.customer.update({
                where: { id: customer.id },
                data: {
                    lastOrderAt: occurredAt,
                    totalOrders: { increment: 1 },
                    totalSpent: { increment: orderTotal },
                },
            });
        }
        const conversionGoal = mapEventToConversion(eventType);
        if (conversionGoal) {
            const conversionValue = eventType === 'order_placed' && eventData ? eventData.total || 0 : undefined;
            const conversionResult = await checkAndRecordConversion(customer.id, conversionGoal, conversionValue);
            if (conversionResult.recorded) {
                console.log(`[EventIngest] Recorded conversion for customer ${customer.id}: ${conversionResult.experiments.length} experiment(s)`);
            }
        }
        enrollInMatchingFlows(customer.id, eventType, eventData || {}, event.id).catch((err) => {
            console.error('[EventIngest] Flow matching failed:', err);
        });
        return {
            success: true,
            eventId: event.id,
            customerId: customer.id,
        };
    },
});
export const listCustomerEventsEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'List Customer Events',
    description: 'Returns events for a specific customer.',
    tag: 'Customers',
    input: z.object({
        customerId: objectIdSchema,
        eventType: z.string().optional(),
        limit: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 50)),
    }),
    output: z.object({
        events: z.array(z.object({
            id: z.string(),
            eventType: z.string(),
            eventData: z.unknown(),
            occurredAt: z.string(),
            createdAt: z.string(),
        })),
    }),
    handler: async ({ input }) => {
        const customer = await prisma.customer.findUnique({
            where: { id: input.customerId },
        });
        if (!customer) {
            throw createHttpError(404, 'Customer not found');
        }
        const events = await prisma.customerEvent.findMany({
            where: {
                customerId: input.customerId,
                ...(input.eventType && { eventType: input.eventType }),
            },
            orderBy: { occurredAt: 'desc' },
            take: input.limit,
        });
        return {
            events: events.map((e) => ({
                id: e.id,
                eventType: e.eventType,
                eventData: e.eventData,
                occurredAt: e.occurredAt.toISOString(),
                createdAt: e.createdAt.toISOString(),
            })),
        };
    },
});
