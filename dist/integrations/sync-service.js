import prisma from '../utils/prisma';
import { createAuditLog, AuditActions } from '../utils/audit';
export async function upsertCustomerFromPlatform(input) {
    const existing = await prisma.customer.findFirst({
        where: { externalId: input.externalId },
    });
    if (existing) {
        const existingMetadata = existing.metadata || {};
        const updated = await prisma.customer.update({
            where: { id: existing.id },
            data: {
                email: input.email ?? existing.email,
                phone: input.phone ?? existing.phone,
                name: input.name ?? existing.name,
                firstName: input.firstName ?? existing.firstName,
                lastName: input.lastName ?? existing.lastName,
                metadata: input.metadata
                    ? JSON.parse(JSON.stringify({ ...existingMetadata, ...input.metadata }))
                    : existing.metadata,
                updatedAt: new Date(),
            },
        });
        return { id: updated.id, created: false };
    }
    const created = await prisma.customer.create({
        data: {
            externalId: input.externalId,
            email: input.email,
            phone: input.phone,
            name: input.name,
            firstName: input.firstName,
            lastName: input.lastName,
            metadata: input.metadata || {},
            createdAt: input.createdAt || new Date(),
        },
    });
    return { id: created.id, created: true };
}
export async function upsertOrderFromPlatform(input) {
    const customer = await prisma.customer.findFirst({
        where: { externalId: input.customerExternalId },
    });
    if (!customer) {
        throw new Error(`Customer not found for external ID: ${input.customerExternalId}`);
    }
    const existingOrder = await prisma.order.findFirst({
        where: {
            customerId: customer.id,
            purchasedAt: input.purchasedAt,
        },
        include: { items: true },
    });
    const mapStatus = (status) => {
        switch (status) {
            case 'pending':
                return 'pending';
            case 'completed':
                return 'completed';
            case 'refunded':
                return 'refunded';
            case 'partial_refund':
                return 'partial_refund';
            case 'cancelled':
                return 'cancelled';
            default:
                return 'completed';
        }
    };
    if (existingOrder) {
        const updated = await prisma.order.update({
            where: { id: existingOrder.id },
            data: {
                total: input.total,
                status: mapStatus(input.status),
                couponCode: input.couponCode,
            },
        });
        await updateCustomerStats(customer.id);
        return { id: updated.id, created: false };
    }
    const created = await prisma.order.create({
        data: {
            customerId: customer.id,
            total: input.total,
            status: mapStatus(input.status),
            couponCode: input.couponCode,
            purchasedAt: input.purchasedAt,
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
    });
    await updateCustomerStats(customer.id);
    return { id: created.id, created: true };
}
async function updateCustomerStats(customerId) {
    const stats = await prisma.order.aggregate({
        where: {
            customerId,
            status: { in: ['completed', 'partial_refund'] },
        },
        _count: { id: true },
        _sum: { total: true },
        _max: { purchasedAt: true },
    });
    await prisma.customer.update({
        where: { id: customerId },
        data: {
            totalOrders: stats._count.id || 0,
            totalSpent: stats._sum.total || 0,
            lastOrderAt: stats._max.purchasedAt,
        },
    });
}
export async function syncCustomersBatch(customers, integration, userId) {
    const errors = [];
    let created = 0;
    let updated = 0;
    for (const customer of customers) {
        try {
            const result = await upsertCustomerFromPlatform(customer);
            if (result.created) {
                created++;
            }
            else {
                updated++;
            }
        }
        catch (error) {
            errors.push({
                externalId: customer.externalId,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
    await createAuditLog({
        action: AuditActions.integration.syncCompleted,
        resourceType: 'integration',
        resourceId: integration.id,
        metadata: {
            platform: integration.platform,
            entityType: 'customers',
            created,
            updated,
            failed: errors.length,
        },
        context: { userId },
    });
    return {
        success: errors.length === 0,
        recordsProcessed: customers.length,
        recordsCreated: created,
        recordsUpdated: updated,
        recordsFailed: errors.length,
        errors,
    };
}
export async function syncOrdersBatch(orders, integration, userId) {
    const errors = [];
    let created = 0;
    let updated = 0;
    for (const order of orders) {
        try {
            const result = await upsertOrderFromPlatform(order);
            if (result.created) {
                created++;
            }
            else {
                updated++;
            }
        }
        catch (error) {
            errors.push({
                externalId: order.externalId,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
    await createAuditLog({
        action: AuditActions.integration.syncCompleted,
        resourceType: 'integration',
        resourceId: integration.id,
        metadata: {
            platform: integration.platform,
            entityType: 'orders',
            created,
            updated,
            failed: errors.length,
        },
        context: { userId },
    });
    return {
        success: errors.length === 0,
        recordsProcessed: orders.length,
        recordsCreated: created,
        recordsUpdated: updated,
        recordsFailed: errors.length,
        errors,
    };
}
export async function createSyncLog(integrationId, entityType, direction) {
    const log = await prisma.integrationSyncLog.create({
        data: {
            integrationId,
            entityType,
            direction,
            status: 'running',
            startedAt: new Date(),
        },
    });
    return log.id;
}
export async function completeSyncLog(logId, result) {
    const errorDetails = result.errors.length > 0
        ? result.errors.slice(0, 10).map((e) => ({
            externalId: e.externalId,
            error: e.error,
        }))
        : null;
    await prisma.integrationSyncLog.update({
        where: { id: logId },
        data: {
            status: result.success ? 'completed' : 'failed',
            recordsProcessed: result.recordsProcessed,
            recordsCreated: result.recordsCreated,
            recordsUpdated: result.recordsUpdated,
            recordsFailed: result.recordsFailed,
            completedAt: new Date(),
            errorMessage: result.errors.length > 0 ? `${result.errors.length} records failed` : null,
            errorDetails,
        },
    });
}
