import { z } from 'zod';
import { authFactory, createAuthRoleFactory } from '../factories';
import prisma from '../utils/prisma';
import createHttpError from 'http-errors';
import { createAuditLog, AuditActions } from '../utils/audit';
import { objectIdSchema } from '../utils/validation';
// List orders endpoint
export const listOrdersEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'List Orders',
    description: 'Returns a paginated list of orders with customer info.',
    tag: 'Orders',
    input: z.object({
        page: z.string().optional().default('1'),
        limit: z.string().optional().default('20'),
        customerId: z.string().optional(),
        status: z.enum(['pending', 'completed', 'refunded', 'partial_refund', 'cancelled']).optional(),
        search: z.string().optional(),
    }),
    output: z.object({
        orders: z.array(z.object({
            id: z.string(),
            customerId: z.string(),
            customer: z
                .object({
                id: z.string(),
                email: z.string().nullable(),
                name: z.string().nullable(),
            })
                .nullable(),
            total: z.number(),
            status: z.enum(['pending', 'completed', 'refunded', 'partial_refund', 'cancelled']),
            couponCode: z.string().nullable(),
            itemCount: z.number(),
            purchasedAt: z.date(),
            createdAt: z.date(),
        })),
        pagination: z.object({
            page: z.number(),
            limit: z.number(),
            total: z.number(),
            totalPages: z.number(),
        }),
    }),
    handler: async ({ input }) => {
        const page = parseInt(input.page);
        const limit = Math.min(parseInt(input.limit), 100);
        const skip = (page - 1) * limit;
        // Build where clause
        const where = {};
        if (input.customerId) {
            where.customerId = input.customerId;
        }
        if (input.status) {
            where.status = input.status;
        }
        if (input.search) {
            where.customer = {
                OR: [
                    { email: { contains: input.search, mode: 'insensitive' } },
                    { name: { contains: input.search, mode: 'insensitive' } },
                ],
            };
        }
        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where,
                include: {
                    customer: {
                        select: {
                            id: true,
                            email: true,
                            name: true,
                        },
                    },
                    _count: {
                        select: { items: true },
                    },
                },
                skip,
                take: limit,
                orderBy: { purchasedAt: 'desc' },
            }),
            prisma.order.count({ where }),
        ]);
        return {
            orders: orders.map((order) => ({
                id: order.id,
                customerId: order.customerId,
                customer: order.customer,
                total: order.total,
                status: order.status,
                couponCode: order.couponCode,
                itemCount: order._count.items,
                purchasedAt: order.purchasedAt,
                createdAt: order.purchasedAt, // Use purchasedAt as createdAt since Order doesn't have createdAt
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    },
});
// Get single order endpoint
export const getOrderEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'Get Order',
    description: 'Returns details of a specific order including all items.',
    tag: 'Orders',
    input: z.object({
        orderId: objectIdSchema,
    }),
    output: z.object({
        id: z.string(),
        customerId: z.string(),
        customer: z
            .object({
            id: z.string(),
            email: z.string().nullable(),
            name: z.string().nullable(),
        })
            .nullable(),
        total: z.number(),
        status: z.enum(['pending', 'completed', 'refunded', 'partial_refund', 'cancelled']),
        couponCode: z.string().nullable(),
        purchasedAt: z.date(),
        items: z.array(z.object({
            id: z.string(),
            sku: z.string(),
            name: z.string(),
            category: z.string().nullable(),
            brand: z.string().nullable(),
            price: z.number(),
            quantity: z.number(),
            originalPrice: z.number().nullable(),
            discount: z.number().nullable(),
        })),
    }),
    handler: async ({ input }) => {
        const order = await prisma.order.findUnique({
            where: { id: input.orderId },
            include: {
                customer: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                    },
                },
                items: {
                    select: {
                        id: true,
                        sku: true,
                        name: true,
                        category: true,
                        brand: true,
                        price: true,
                        quantity: true,
                        originalPrice: true,
                        discount: true,
                    },
                },
            },
        });
        if (!order) {
            throw createHttpError(404, 'Order not found');
        }
        return {
            id: order.id,
            customerId: order.customerId,
            customer: order.customer,
            total: order.total,
            status: order.status,
            couponCode: order.couponCode,
            purchasedAt: order.purchasedAt,
            items: order.items,
        };
    },
});
// Create order endpoint (authenticated, for manual entry)
export const createOrderEndpoint = createAuthRoleFactory('admin', 'manager').build({
    method: 'post',
    shortDescription: 'Create Order',
    description: 'Creates a new order for a customer. Used for manual order entry.',
    tag: 'Orders',
    input: z.object({
        customerId: z.string(),
        total: z.number().min(0),
        status: z
            .enum(['pending', 'completed', 'refunded', 'partial_refund', 'cancelled'])
            .optional()
            .default('completed'),
        couponCode: z.string().optional(),
        purchasedAt: z.string().datetime().optional(),
        items: z
            .array(z.object({
            sku: z.string(),
            name: z.string(),
            category: z.string().optional(),
            brand: z.string().optional(),
            price: z.number().min(0),
            quantity: z.number().int().min(1).default(1),
            originalPrice: z.number().optional(),
            discount: z.number().optional(),
        }))
            .min(1),
    }),
    output: z.object({
        success: z.boolean(),
        message: z.string(),
        order: z.object({
            id: z.string(),
            customerId: z.string(),
            total: z.number(),
            status: z.string(),
            itemCount: z.number(),
        }),
    }),
    handler: async ({ input, ctx }) => {
        const purchasedAt = input.purchasedAt ? new Date(input.purchasedAt) : new Date();
        // Verify customer exists
        const customer = await prisma.customer.findUnique({
            where: { id: input.customerId },
        });
        if (!customer) {
            throw createHttpError(404, 'Customer not found');
        }
        // Create order with items
        const order = await prisma.order.create({
            data: {
                customerId: input.customerId,
                total: input.total,
                status: input.status,
                couponCode: input.couponCode,
                purchasedAt,
                items: {
                    create: input.items.map((item) => ({
                        sku: item.sku,
                        name: item.name,
                        category: item.category,
                        brand: item.brand,
                        price: item.price,
                        quantity: item.quantity,
                        originalPrice: item.originalPrice,
                        discount: item.discount,
                    })),
                },
            },
            include: {
                _count: {
                    select: { items: true },
                },
            },
        });
        // Update customer stats
        await prisma.customer.update({
            where: { id: input.customerId },
            data: {
                lastOrderAt: purchasedAt,
                totalOrders: { increment: 1 },
                totalSpent: { increment: input.total },
            },
        });
        // Create customer event
        await prisma.customerEvent.create({
            data: {
                customerId: input.customerId,
                eventType: 'order_placed',
                eventData: {
                    orderId: order.id,
                    total: input.total,
                    itemCount: input.items.length,
                    source: 'manual',
                },
                occurredAt: purchasedAt,
                source: 'api',
            },
        });
        // Audit log
        await createAuditLog({
            action: AuditActions.order.created,
            resourceType: 'order',
            resourceId: order.id,
            metadata: {
                customerId: input.customerId,
                total: input.total,
                itemCount: input.items.length,
            },
            context: { userId: ctx.user.sub },
        });
        return {
            success: true,
            message: 'Order created successfully',
            order: {
                id: order.id,
                customerId: order.customerId,
                total: order.total,
                status: order.status,
                itemCount: order._count.items,
            },
        };
    },
});
// Update order status endpoint
export const updateOrderStatusEndpoint = createAuthRoleFactory('admin', 'manager').build({
    method: 'patch',
    shortDescription: 'Update Order Status',
    description: 'Updates the status of an order (e.g., for refunds).',
    tag: 'Orders',
    input: z.object({
        orderId: objectIdSchema,
        status: z.enum(['pending', 'completed', 'refunded', 'partial_refund', 'cancelled']),
    }),
    output: z.object({
        success: z.boolean(),
        message: z.string(),
        order: z.object({
            id: z.string(),
            status: z.string(),
        }),
    }),
    handler: async ({ input, ctx }) => {
        const order = await prisma.order.findUnique({
            where: { id: input.orderId },
        });
        if (!order) {
            throw createHttpError(404, 'Order not found');
        }
        const previousStatus = order.status;
        const updatedOrder = await prisma.order.update({
            where: { id: input.orderId },
            data: { status: input.status },
        });
        // If refunded, adjust customer stats
        if ((input.status === 'refunded' || input.status === 'cancelled') &&
            previousStatus === 'completed') {
            await prisma.customer.update({
                where: { id: order.customerId },
                data: {
                    totalOrders: { decrement: 1 },
                    totalSpent: { decrement: order.total },
                },
            });
        }
        // Audit log
        await createAuditLog({
            action: AuditActions.order.statusChanged,
            resourceType: 'order',
            resourceId: input.orderId,
            metadata: {
                previousStatus,
                newStatus: input.status,
            },
            context: { userId: ctx.user.sub },
        });
        return {
            success: true,
            message: `Order status updated to ${input.status}`,
            order: {
                id: updatedOrder.id,
                status: updatedOrder.status,
            },
        };
    },
});
// Delete order endpoint
export const deleteOrderEndpoint = createAuthRoleFactory('admin').build({
    method: 'delete',
    shortDescription: 'Delete Order',
    description: 'Deletes an order and its items. Customer stats are adjusted accordingly.',
    tag: 'Orders',
    input: z.object({
        orderId: objectIdSchema,
    }),
    output: z.object({
        success: z.boolean(),
        message: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const order = await prisma.order.findUnique({
            where: { id: input.orderId },
            include: {
                _count: {
                    select: { items: true },
                },
            },
        });
        if (!order) {
            throw createHttpError(404, 'Order not found');
        }
        // Delete order items first
        await prisma.orderItem.deleteMany({
            where: { orderId: input.orderId },
        });
        // Delete the order
        await prisma.order.delete({
            where: { id: input.orderId },
        });
        // Adjust customer stats if order was completed
        if (order.status === 'completed') {
            await prisma.customer.update({
                where: { id: order.customerId },
                data: {
                    totalOrders: { decrement: 1 },
                    totalSpent: { decrement: order.total },
                },
            });
        }
        // Audit log
        await createAuditLog({
            action: AuditActions.order.deleted,
            resourceType: 'order',
            resourceId: input.orderId,
            metadata: {
                customerId: order.customerId,
                total: order.total,
                itemCount: order._count.items,
            },
            context: { userId: ctx.user.sub },
        });
        return {
            success: true,
            message: 'Order deleted successfully',
        };
    },
});
