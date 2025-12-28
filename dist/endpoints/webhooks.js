import { z } from 'zod';
import { publicFactory, publicWithRequestFactory } from '../factories';
import prisma from '../utils/prisma';
import { providerRegistry } from '../providers';
/**
 * Generic delivery webhook endpoint.
 * Handles callbacks from email/SMS providers about message status.
 */
export const deliveryWebhookEndpoint = publicWithRequestFactory.build({
    method: 'post',
    shortDescription: 'Delivery Webhook',
    description: 'Endpoint to receive delivery status webhooks from message providers.',
    tag: 'Webhooks',
    input: z.object({
        provider: z.string(),
    }),
    output: z.object({
        received: z.boolean(),
        processed: z.boolean(),
        error: z.string().optional(),
    }),
    handler: async ({ input, ctx }) => {
        const { provider: providerName } = input;
        // Get provider
        const provider = providerRegistry.get(providerName);
        if (!provider) {
            return {
                received: true,
                processed: false,
                error: `Unknown provider: ${providerName}`,
            };
        }
        // Get signature from headers
        const signature = ctx.request.headers['x-signature'] ||
            ctx.request.headers['x-webhook-signature'] ||
            '';
        // Get raw body (would need body-parser raw mode in production)
        const rawBody = JSON.stringify(ctx.request.body);
        // Verify signature
        if (signature && !provider.verifyWebhook(rawBody, signature)) {
            return {
                received: true,
                processed: false,
                error: 'Invalid signature',
            };
        }
        // Parse webhook event
        const event = provider.parseWebhook(ctx.request.body);
        if (!event) {
            return {
                received: true,
                processed: false,
                error: 'Could not parse webhook payload',
            };
        }
        // Find message log by provider message ID
        const messageLog = await prisma.messageLog.findFirst({
            where: { providerMessageId: event.providerMessageId },
        });
        if (!messageLog) {
            // Message not found - could be a test or old message
            return {
                received: true,
                processed: false,
                error: 'Message not found',
            };
        }
        // Update message log based on event type
        const updateData = {};
        switch (event.eventType) {
            case 'delivered':
                updateData.deliveryStatus = 'delivered';
                updateData.deliveredAt = event.timestamp;
                break;
            case 'bounced':
                updateData.deliveryStatus = 'bounced';
                updateData.errorMessage = 'Message bounced';
                // Add to suppression list
                if (messageLog.channel === 'email') {
                    const customer = await prisma.customer.findUnique({
                        where: { id: messageLog.customerId },
                    });
                    if (customer?.email) {
                        await prisma.suppressionEntry.upsert({
                            where: {
                                channel_value: {
                                    channel: 'email',
                                    value: customer.email.toLowerCase(),
                                },
                            },
                            create: {
                                channel: 'email',
                                value: customer.email.toLowerCase(),
                                reason: 'bounced',
                                source: 'provider_webhook',
                            },
                            update: {
                                reason: 'bounced',
                            },
                        });
                    }
                }
                break;
            case 'opened':
                updateData.deliveryStatus = 'opened';
                updateData.openedAt = event.timestamp;
                break;
            case 'clicked':
                updateData.deliveryStatus = 'clicked';
                updateData.clickedAt = event.timestamp;
                break;
            case 'unsubscribed':
                updateData.deliveryStatus = 'unsubscribed';
                // Update customer opt-out
                await prisma.customer.update({
                    where: { id: messageLog.customerId },
                    data: {
                        optOut: true,
                        optOutChannels: { push: messageLog.channel },
                    },
                });
                break;
            case 'complained': {
                updateData.deliveryStatus = 'complained';
                // Add to global suppression
                const complainCustomer = await prisma.customer.findUnique({
                    where: { id: messageLog.customerId },
                });
                if (complainCustomer?.email) {
                    await prisma.suppressionEntry.upsert({
                        where: {
                            channel_value: {
                                channel: 'email',
                                value: complainCustomer.email.toLowerCase(),
                            },
                        },
                        create: {
                            channel: 'email',
                            value: complainCustomer.email.toLowerCase(),
                            reason: 'complained',
                            source: 'provider_webhook',
                        },
                        update: {
                            reason: 'complained',
                        },
                    });
                }
                break;
            }
            case 'failed':
                updateData.deliveryStatus = 'failed';
                updateData.errorMessage = event.metadata?.error || 'Delivery failed';
                break;
        }
        // Update message log
        await prisma.messageLog.update({
            where: { id: messageLog.id },
            data: updateData,
        });
        return {
            received: true,
            processed: true,
        };
    },
});
/**
 * Order webhook endpoint.
 * Handles incoming order notifications from e-commerce platforms.
 */
export const orderWebhookEndpoint = publicFactory.build({
    method: 'post',
    shortDescription: 'Order Webhook',
    description: 'Endpoint to receive order notifications from e-commerce platforms.',
    tag: 'Webhooks',
    input: z.object({
        orderId: z.string(),
        customerId: z.string().optional(),
        customerEmail: z.email().optional(),
        customerExternalId: z.string().optional(),
        total: z.number(),
        items: z
            .array(z.object({
            sku: z.string(),
            name: z.string(),
            category: z.string().optional(),
            price: z.number(),
            quantity: z.number().default(1),
        }))
            .optional(),
        purchasedAt: z.string().datetime().optional(),
        idempotencyKey: z.string().optional(),
    }),
    output: z.object({
        success: z.boolean(),
        orderId: z.string().nullable(),
        customerId: z.string().nullable(),
    }),
    handler: async ({ input }) => {
        const { total, items, idempotencyKey } = input;
        const purchasedAt = input.purchasedAt ? new Date(input.purchasedAt) : new Date();
        // Check idempotency via external order ID
        if (idempotencyKey) {
            const existingOrder = await prisma.order.findFirst({
                where: {},
            });
            if (existingOrder) {
                return {
                    success: true,
                    orderId: existingOrder.id,
                    customerId: existingOrder.customerId,
                };
            }
        }
        // Find or create customer
        let customer = null;
        if (input.customerId) {
            customer = await prisma.customer.findUnique({
                where: { id: input.customerId },
            });
        }
        if (!customer && input.customerEmail) {
            customer = await prisma.customer.findUnique({
                where: { email: input.customerEmail },
            });
        }
        if (!customer && input.customerExternalId) {
            customer = await prisma.customer.findFirst({
                where: { externalId: input.customerExternalId },
            });
        }
        // Create customer if not found
        if (!customer) {
            if (!input.customerEmail && !input.customerExternalId) {
                return {
                    success: false,
                    orderId: null,
                    customerId: null,
                };
            }
            customer = await prisma.customer.create({
                data: {
                    email: input.customerEmail,
                    externalId: input.customerExternalId,
                },
            });
        }
        // Create order with items
        const order = await prisma.order.create({
            data: {
                customerId: customer.id,
                total,
                purchasedAt,
                items: items
                    ? {
                        create: items.map((item) => ({
                            sku: item.sku,
                            name: item.name,
                            category: item.category,
                            price: item.price,
                            quantity: item.quantity,
                        })),
                    }
                    : undefined,
            },
        });
        // Update customer stats
        await prisma.customer.update({
            where: { id: customer.id },
            data: {
                lastOrderAt: purchasedAt,
                totalOrders: { increment: 1 },
                totalSpent: { increment: total },
            },
        });
        // Create customer event
        await prisma.customerEvent.create({
            data: {
                customerId: customer.id,
                eventType: 'order_placed',
                eventData: {
                    orderId: order.id,
                    total,
                    itemCount: items?.length ?? 0,
                },
                occurredAt: purchasedAt,
                source: 'webhook',
                idempotencyKey,
            },
        });
        return {
            success: true,
            orderId: order.id,
            customerId: customer.id,
        };
    },
});
