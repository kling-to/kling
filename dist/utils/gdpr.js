/**
 * GDPR Data Pipeline Utilities
 *
 * Provides comprehensive data export and deletion capabilities
 * for GDPR "right to access" and "right to be forgotten" compliance.
 */
import prisma from './prisma';
import { createAuditLog, AuditActions } from './audit';
/**
 * Export all customer data (GDPR Article 15 - Right of Access)
 */
export async function exportCustomerData(customerId, options = {}) {
    const { includeOrders = true, includeEvents = true, includeMessages = true, includeConsentHistory = true, includeExperiments = true, includePromotions = true, } = options;
    // Get customer profile
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
    // Get orders
    if (includeOrders) {
        const orders = await prisma.order.findMany({
            where: { customerId },
            include: { items: true },
            orderBy: { purchasedAt: 'desc' },
        });
        result.orders = orders.map((order) => ({
            id: order.id,
            orderNumber: order.id, // Use ID as order number since schema doesn't have orderNumber
            status: order.status,
            totalAmount: order.total,
            currency: 'USD', // Default since schema doesn't have currency
            createdAt: order.purchasedAt.toISOString(),
            items: order.items.map((item) => ({
                productName: item.name,
                quantity: item.quantity,
                unitPrice: item.price,
            })),
        }));
    }
    // Get events
    if (includeEvents) {
        const events = await prisma.customerEvent.findMany({
            where: { customerId },
            orderBy: { occurredAt: 'desc' },
            take: 1000, // Limit to last 1000 events
        });
        result.events = events.map((event) => ({
            id: event.id,
            eventType: event.eventType,
            createdAt: event.occurredAt.toISOString(),
            metadata: event.eventData,
        }));
    }
    // Get message logs
    if (includeMessages) {
        const messages = await prisma.messageLog.findMany({
            where: { customerId },
            include: {
                campaign: {
                    select: { name: true },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: 500, // Limit to last 500 messages
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
    // Get consent history
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
    // Get experiment assignments
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
    // Get promotion usage (now linked via campaignId)
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
/**
 * Delete or anonymize customer data (GDPR Article 17 - Right to Erasure)
 */
export async function deleteCustomerData(customerId, requestedBy, options) {
    const { mode, retainOrders = true, retainMessageLogs = true } = options;
    // Verify customer exists
    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, email: true },
    });
    if (!customer) {
        throw new Error('Customer not found');
    }
    const deletionId = `deletion-${Date.now()}-${customerId}`;
    // Count records before deletion
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
            // Full deletion mode
            // Delete experiment assignments
            await tx.experimentAssignment.deleteMany({ where: { customerId } });
            // Delete discount redemptions
            await tx.discountRedemption.deleteMany({ where: { customerId } });
            // Delete gift grants
            await tx.giftGrant.deleteMany({ where: { customerId } });
            // Delete events
            await tx.customerEvent.deleteMany({ where: { customerId } });
            // Delete consent logs
            await tx.consentLog.deleteMany({ where: { customerId } });
            // Handle orders
            if (retainOrders) {
                // Anonymize orders but keep for financial records
                await tx.order.updateMany({
                    where: { customerId },
                    data: {
                        customerId: null, // Unlink from customer
                    },
                });
            }
            else {
                // Delete order items first
                const orderIds = await tx.order.findMany({
                    where: { customerId },
                    select: { id: true },
                });
                await tx.orderItem.deleteMany({
                    where: { orderId: { in: orderIds.map((o) => o.id) } },
                });
                await tx.order.deleteMany({ where: { customerId } });
            }
            // Handle message logs
            if (retainMessageLogs) {
                // Anonymize message logs
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
            // Delete customer
            await tx.customer.delete({ where: { id: customerId } });
        }
        else {
            // Anonymization mode - preserves record structure
            // Anonymize customer profile
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
            // Delete events (no need to anonymize)
            await tx.customerEvent.deleteMany({ where: { customerId } });
            // Anonymize message logs
            await tx.messageLog.updateMany({
                where: { customerId },
                data: {
                    body: '[REDACTED]',
                    recipient: '[REDACTED]',
                    subject: '[REDACTED]',
                },
            });
            // Consent logs kept for legal compliance but customer is marked deleted
            // Experiment assignments kept (anonymized customer)
            // Discount usages kept (anonymized customer)
            // Gift grants kept (anonymized customer)
        }
    });
    // Create audit log
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
/**
 * Generate a downloadable data export file content (JSON format)
 */
export function formatExportAsJSON(exportData) {
    return JSON.stringify(exportData, null, 2);
}
/**
 * Check if a customer has pending data requests
 */
export async function hasPendingDataRequests(customerId) {
    // Check audit logs for recent export/deletion requests
    const recentRequests = await prisma.auditLog.findFirst({
        where: {
            resourceId: customerId,
            resourceType: 'customer',
            action: {
                in: ['data_export_requested', 'data_deletion_requested'],
            },
            createdAt: {
                gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
            },
        },
    });
    return recentRequests !== null;
}
/**
 * Verify customer identity for GDPR requests (basic implementation)
 * In production, this should involve email verification or other identity checks
 */
export async function verifyCustomerIdentity(customerId, verificationData) {
    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { email: true, phone: true },
    });
    if (!customer) {
        return false;
    }
    // Verify at least one matching identifier
    if (verificationData.email && customer.email === verificationData.email) {
        return true;
    }
    if (verificationData.phone && customer.phone === verificationData.phone) {
        return true;
    }
    return false;
}
