import prisma from './prisma';
import { createAuditLog, AuditActions } from './audit';
export async function exportCustomerData(customerId, options = {}) {
    const { includeOrders = true, includeEvents = true, includeMessages = true, includeConsentHistory = true, includeExperiments = true, includePromotions = true, } = options;
    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
    });
    if (!customer) {
        throw new Error('Customer not found');
    }
    const exportId = `export-${Date.now()}-${customerId}`;
    const result = {
        exportId,
        exportedAt: new Date().toISOString(),
        customerId: customer.id,
        profile: {
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            externalId: customer.externalId,
            createdAt: customer.createdAt.toISOString(),
            updatedAt: customer.updatedAt.toISOString(),
            optOut: customer.optOut,
            optOutChannels: customer.optOutChannels,
            metadata: customer.metadata,
        },
    };
    if (includeOrders) {
        const orders = await prisma.order.findMany({
            where: { customerId },
            include: { items: true },
            orderBy: { purchasedAt: 'desc' },
        });
        result.orders = orders.map((order) => ({
            id: order.id,
            orderNumber: order.id,
            status: order.status,
            totalAmount: order.total,
            currency: 'USD',
            createdAt: order.purchasedAt.toISOString(),
            items: order.items.map((item) => ({
                productName: item.name,
                quantity: item.quantity,
                unitPrice: item.price,
            })),
        }));
    }
    if (includeEvents) {
        const events = await prisma.customerEvent.findMany({
            where: { customerId },
            orderBy: { occurredAt: 'desc' },
            take: 1000,
        });
        result.events = events.map((event) => ({
            id: event.id,
            eventType: event.eventType,
            createdAt: event.occurredAt.toISOString(),
            metadata: event.eventData,
        }));
    }
    if (includeMessages) {
        const messages = await prisma.messageLog.findMany({
            where: { customerId },
            include: {
                campaign: {
                    select: { name: true },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: 500,
        });
        result.messages = messages.map((msg) => ({
            id: msg.id,
            channel: msg.channel,
            subject: msg.subject,
            sentAt: msg.sentAt?.toISOString() || null,
            deliveryStatus: msg.deliveryStatus,
            campaignName: msg.campaign?.name || undefined,
        }));
    }
    if (includeConsentHistory) {
        const consents = await prisma.consentLog.findMany({
            where: { customerId },
            orderBy: { createdAt: 'desc' },
        });
        result.consents = consents.map((consent) => ({
            id: consent.id,
            consentType: consent.consentType,
            granted: consent.granted,
            source: consent.source,
            createdAt: consent.createdAt.toISOString(),
        }));
    }
    if (includeExperiments) {
        const assignments = await prisma.experimentAssignment.findMany({
            where: { customerId },
            include: {
                experiment: {
                    select: { name: true },
                },
            },
            orderBy: { assignedAt: 'desc' },
        });
        result.experiments = assignments.map((assign) => ({
            experimentName: assign.experiment?.name || 'Unknown',
            cohort: assign.cohort,
            assignedAt: assign.assignedAt.toISOString(),
            convertedAt: assign.convertedAt?.toISOString() || null,
        }));
    }
    if (includePromotions) {
        const discountRedemptions = await prisma.discountRedemption.findMany({
            where: { customerId },
            orderBy: { redeemedAt: 'desc' },
        });
        const giftGrants = await prisma.giftGrant.findMany({
            where: { customerId },
            orderBy: { grantedAt: 'desc' },
        });
        result.promotions = {
            discountsUsed: discountRedemptions.map((usage) => ({
                code: usage.code || 'N/A',
                type: usage.discountType || 'unknown',
                usedAt: usage.redeemedAt.toISOString(),
            })),
            giftsReceived: giftGrants.map((grant) => ({
                code: grant.code || 'N/A',
                type: grant.giftType || 'unknown',
                receivedAt: grant.grantedAt.toISOString(),
            })),
        };
    }
    return result;
}
export async function deleteCustomerData(customerId, requestedBy, options) {
    const { mode, retainOrders = true, retainMessageLogs = true } = options;
    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, email: true },
    });
    if (!customer) {
        throw new Error('Customer not found');
    }
    const deletionId = `deletion-${Date.now()}-${customerId}`;
    const [ordersCount, eventsCount, messagesCount, consentsCount, experimentsCount, discountRedemptionsCount, giftGrantsCount,] = await Promise.all([
        prisma.order.count({ where: { customerId } }),
        prisma.customerEvent.count({ where: { customerId } }),
        prisma.messageLog.count({ where: { customerId } }),
        prisma.consentLog.count({ where: { customerId } }),
        prisma.experimentAssignment.count({ where: { customerId } }),
        prisma.discountRedemption.count({ where: { customerId } }),
        prisma.giftGrant.count({ where: { customerId } }),
    ]);
    await prisma.$transaction(async (tx) => {
        if (mode === 'delete') {
            await tx.experimentAssignment.deleteMany({ where: { customerId } });
            await tx.discountRedemption.deleteMany({ where: { customerId } });
            await tx.giftGrant.deleteMany({ where: { customerId } });
            await tx.customerEvent.deleteMany({ where: { customerId } });
            await tx.consentLog.deleteMany({ where: { customerId } });
            if (retainOrders) {
                await tx.order.updateMany({
                    where: { customerId },
                    data: {
                        customerId: null,
                    },
                });
            }
            else {
                const orderIds = await tx.order.findMany({
                    where: { customerId },
                    select: { id: true },
                });
                await tx.orderItem.deleteMany({
                    where: { orderId: { in: orderIds.map((o) => o.id) } },
                });
                await tx.order.deleteMany({ where: { customerId } });
            }
            if (retainMessageLogs) {
                await tx.messageLog.updateMany({
                    where: { customerId },
                    data: {
                        body: '[REDACTED]',
                        recipient: '[REDACTED]',
                        subject: '[REDACTED]',
                    },
                });
            }
            else {
                await tx.messageLog.deleteMany({ where: { customerId } });
            }
            await tx.customer.delete({ where: { id: customerId } });
        }
        else {
            await tx.customer.update({
                where: { id: customerId },
                data: {
                    email: `deleted-${customerId}@anonymized.local`,
                    phone: null,
                    name: 'DELETED USER',
                    externalId: null,
                    metadata: null,
                    optOut: true,
                    optOutChannels: ['email', 'sms'],
                },
            });
            await tx.customerEvent.deleteMany({ where: { customerId } });
            await tx.messageLog.updateMany({
                where: { customerId },
                data: {
                    body: '[REDACTED]',
                    recipient: '[REDACTED]',
                    subject: '[REDACTED]',
                },
            });
        }
    });
    await createAuditLog({
        action: AuditActions.data.deletionRequested,
        resourceType: 'customer',
        resourceId: customerId,
        metadata: {
            deletionId,
            requestedBy,
            mode,
            originalEmail: customer.email,
            recordsAffected: {
                orders: ordersCount,
                events: eventsCount,
                messages: messagesCount,
                consents: consentsCount,
                experiments: experimentsCount,
                discountUsages: discountRedemptionsCount,
                giftGrants: giftGrantsCount,
            },
        },
        context: {},
    });
    return {
        deletionId,
        customerId,
        mode,
        recordsAffected: {
            orders: ordersCount,
            events: eventsCount,
            messages: messagesCount,
            consents: consentsCount,
            experiments: experimentsCount,
            discountUsages: discountRedemptionsCount,
            giftGrants: giftGrantsCount,
        },
    };
}
export function formatExportAsJSON(exportData) {
    return JSON.stringify(exportData, null, 2);
}
export async function hasPendingDataRequests(customerId) {
    const recentRequests = await prisma.auditLog.findFirst({
        where: {
            resourceId: customerId,
            resourceType: 'customer',
            action: {
                in: ['data_export_requested', 'data_deletion_requested'],
            },
            createdAt: {
                gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
            },
        },
    });
    return recentRequests !== null;
}
export async function verifyCustomerIdentity(customerId, verificationData) {
    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { email: true, phone: true },
    });
    if (!customer) {
        return false;
    }
    if (verificationData.email && customer.email === verificationData.email) {
        return true;
    }
    if (verificationData.phone && customer.phone === verificationData.phone) {
        return true;
    }
    return false;
}
