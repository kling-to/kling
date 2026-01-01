import { z } from 'zod';
import { authFactory, publicWithRequestFactory, createAuthRoleFactory } from '../factories';
import prisma from '../utils/prisma';
import createHttpError from 'http-errors';
import { createAuditLog, extractAuditContext, AuditActions } from '../utils/audit';
import { exportCustomerData, deleteCustomerData, } from '../utils/gdpr';
import { objectIdSchema } from '../utils/validation';
import Papa from 'papaparse';
export const recordConsentEndpoint = publicWithRequestFactory.build({
    method: 'post',
    shortDescription: 'Record Consent',
    description: 'Records a consent grant or withdrawal for a customer.',
    tag: 'Consent',
    input: z.object({
        customerId: z.string().optional(),
        email: z.email().optional(),
        externalId: z.string().optional(),
        consentType: z.enum(['email_marketing', 'sms_marketing', 'data_processing']),
        granted: z.boolean(),
        source: z.string().default('api'),
    }),
    output: z.object({
        success: z.boolean(),
        consentId: z.string(),
        customerId: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const { consentType, granted, source } = input;
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
        if (!customer) {
            throw createHttpError(404, 'Customer not found');
        }
        const ipAddress = ctx.request?.ip || null;
        const consent = await prisma.consentLog.create({
            data: {
                customerId: customer.id,
                consentType,
                granted,
                source,
                ipAddress,
            },
        });
        if (!granted && ['email_marketing', 'sms_marketing'].includes(consentType)) {
            const channelMap = {
                email_marketing: 'email',
                sms_marketing: 'sms',
            };
            const channel = channelMap[consentType];
            const currentOptOutChannels = customer.optOutChannels || [];
            if (!currentOptOutChannels.includes(channel)) {
                await prisma.customer.update({
                    where: { id: customer.id },
                    data: {
                        optOutChannels: [...currentOptOutChannels, channel],
                    },
                });
            }
        }
        if (granted && ['email_marketing', 'sms_marketing'].includes(consentType)) {
            const channelMap = {
                email_marketing: 'email',
                sms_marketing: 'sms',
            };
            const channel = channelMap[consentType];
            const currentOptOutChannels = customer.optOutChannels || [];
            const updatedChannels = currentOptOutChannels.filter((c) => c !== channel);
            await prisma.customer.update({
                where: { id: customer.id },
                data: {
                    optOutChannels: updatedChannels,
                    optOut: updatedChannels.length === 0 ? false : customer.optOut,
                },
            });
        }
        const auditContext = extractAuditContext(ctx.request, {});
        await createAuditLog({
            action: granted ? AuditActions.consent.granted : AuditActions.consent.revoked,
            resourceType: 'consent',
            resourceId: consent.id,
            metadata: {
                customerId: customer.id,
                consentType,
                granted,
                source,
            },
            context: auditContext,
        });
        return {
            success: true,
            consentId: consent.id,
            customerId: customer.id,
        };
    },
});
export const getConsentHistoryEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'Get Consent History',
    description: 'Returns the consent history for a customer.',
    tag: 'Consent',
    input: z.object({
        customerId: objectIdSchema,
    }),
    output: z.object({
        customerId: z.string(),
        currentStatus: z.object({
            email_marketing: z.boolean().nullable(),
            sms_marketing: z.boolean().nullable(),
            data_processing: z.boolean().nullable(),
        }),
        history: z.array(z.object({
            id: z.string(),
            consentType: z.string(),
            granted: z.boolean(),
            source: z.string(),
            ipAddress: z.string().nullable(),
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
        const history = await prisma.consentLog.findMany({
            where: { customerId: input.customerId },
            orderBy: { createdAt: 'desc' },
        });
        const currentStatus = {
            email_marketing: null,
            sms_marketing: null,
            data_processing: null,
        };
        for (const log of history) {
            const type = log.consentType;
            if (currentStatus[type] === null) {
                currentStatus[type] = log.granted;
            }
        }
        return {
            customerId: input.customerId,
            currentStatus,
            history: history.map((h) => ({
                id: h.id,
                consentType: h.consentType,
                granted: h.granted,
                source: h.source,
                ipAddress: h.ipAddress,
                createdAt: h.createdAt.toISOString(),
            })),
        };
    },
});
const addSuppressionFactory = createAuthRoleFactory('admin', 'manager');
export const addSuppressionEndpoint = addSuppressionFactory.build({
    method: 'post',
    shortDescription: 'Add Suppression',
    description: 'Adds an entry to the suppression list.',
    tag: 'Consent',
    input: z.object({
        channel: z.enum(['email', 'sms', 'whatsapp', 'rcs', 'push']),
        value: z.string(),
        reason: z.string().optional(),
        expiresAt: z.string().datetime().optional(),
    }),
    output: z.object({
        success: z.boolean(),
        id: z.string(),
    }),
    handler: async ({ input }) => {
        const suppression = await prisma.suppressionEntry.upsert({
            where: {
                channel_value: {
                    channel: input.channel,
                    value: input.value.toLowerCase(),
                },
            },
            create: {
                channel: input.channel,
                value: input.value.toLowerCase(),
                reason: input.reason || 'manual',
                source: 'admin',
                expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            },
            update: {
                reason: input.reason || 'manual',
                expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            },
        });
        return {
            success: true,
            id: suppression.id,
        };
    },
});
const removeSuppressionFactory = createAuthRoleFactory('admin', 'manager');
export const removeSuppressionEndpoint = removeSuppressionFactory.build({
    method: 'post',
    shortDescription: 'Remove Suppression',
    description: 'Removes an entry from the suppression list.',
    tag: 'Consent',
    input: z.object({
        suppressionId: objectIdSchema,
    }),
    output: z.object({
        success: z.boolean(),
    }),
    handler: async ({ input }) => {
        const suppression = await prisma.suppressionEntry.findUnique({
            where: { id: input.suppressionId },
        });
        if (!suppression) {
            throw createHttpError(404, 'Suppression entry not found');
        }
        await prisma.suppressionEntry.delete({
            where: { id: input.suppressionId },
        });
        return { success: true };
    },
});
export const listSuppressionsEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'List Suppressions',
    description: 'Returns the suppression list.',
    tag: 'Consent',
    input: z.object({
        channel: z.enum(['email', 'sms', 'whatsapp', 'rcs', 'push']).optional(),
        page: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 1)),
        pageSize: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 50)),
    }),
    output: z.object({
        items: z.array(z.object({
            id: z.string(),
            channel: z.string(),
            value: z.string(),
            reason: z.string().nullable(),
            source: z.string().nullable(),
            createdAt: z.string(),
            expiresAt: z.string().nullable(),
        })),
        total: z.number(),
        page: z.number(),
        pageSize: z.number(),
        hasMore: z.boolean(),
    }),
    handler: async ({ input }) => {
        const { channel, page, pageSize } = input;
        const skip = (page - 1) * pageSize;
        const where = {};
        if (channel)
            where.channel = channel;
        const [items, total] = await Promise.all([
            prisma.suppressionEntry.findMany({
                where,
                skip,
                take: pageSize + 1,
                orderBy: { createdAt: 'desc' },
            }),
            prisma.suppressionEntry.count({ where }),
        ]);
        const hasMore = items.length > pageSize;
        if (hasMore)
            items.pop();
        return {
            items: items.map((s) => ({
                id: s.id,
                channel: s.channel,
                value: s.value,
                reason: s.reason,
                source: s.source,
                createdAt: s.createdAt.toISOString(),
                expiresAt: s.expiresAt?.toISOString() || null,
            })),
            total,
            page,
            pageSize,
            hasMore,
        };
    },
});
const requestDataExportFactory = createAuthRoleFactory('admin', 'manager');
export const requestDataExportEndpoint = requestDataExportFactory.build({
    method: 'post',
    shortDescription: 'Request Data Export',
    description: 'Generates a complete export of all data for a customer (GDPR Article 15).',
    tag: 'Consent',
    input: z.object({
        customerId: objectIdSchema,
        options: z
            .object({
            includeOrders: z.boolean().optional(),
            includeEvents: z.boolean().optional(),
            includeMessages: z.boolean().optional(),
            includeConsentHistory: z.boolean().optional(),
            includeExperiments: z.boolean().optional(),
            includePromotions: z.boolean().optional(),
        })
            .optional(),
    }),
    output: z.object({
        success: z.boolean(),
        exportId: z.string(),
        data: z.unknown(),
        format: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const customer = await prisma.customer.findUnique({
            where: { id: input.customerId },
        });
        if (!customer) {
            throw createHttpError(404, 'Customer not found');
        }
        const exportOptions = input.options || {};
        const exportData = await exportCustomerData(input.customerId, exportOptions);
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: AuditActions.data.exportRequested,
            resourceType: 'customer',
            resourceId: input.customerId,
            metadata: {
                requestedBy: ctx.user.sub,
                customerId: input.customerId,
                exportId: exportData.exportId,
                options: exportOptions,
            },
            context: auditContext,
        });
        return {
            success: true,
            exportId: exportData.exportId,
            data: exportData,
            format: 'json',
        };
    },
});
const requestDataDeletionFactory = createAuthRoleFactory('admin');
export const requestDataDeletionEndpoint = requestDataDeletionFactory.build({
    method: 'post',
    shortDescription: 'Request Data Deletion',
    description: 'Deletes or anonymizes all data for a customer (GDPR Article 17 - Right to Erasure).',
    tag: 'Consent',
    input: z.object({
        customerId: objectIdSchema,
        dryRun: z.boolean().default(true),
        mode: z.enum(['anonymize', 'delete']).default('anonymize'),
        options: z
            .object({
            retainOrders: z.boolean().optional(),
            retainMessageLogs: z.boolean().optional(),
        })
            .optional(),
    }),
    output: z.object({
        success: z.boolean(),
        dryRun: z.boolean(),
        deletionId: z.string().nullable(),
        mode: z.enum(['anonymize', 'delete']),
        preview: z.object({
            customerId: z.string(),
            ordersCount: z.number(),
            eventsCount: z.number(),
            messagesCount: z.number(),
            consentsCount: z.number(),
            experimentsCount: z.number(),
            discountUsagesCount: z.number(),
            giftGrantsCount: z.number(),
        }),
        message: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const customer = await prisma.customer.findUnique({
            where: { id: input.customerId },
        });
        if (!customer) {
            throw createHttpError(404, 'Customer not found');
        }
        const [ordersCount, eventsCount, messagesCount, consentsCount, experimentsCount, discountUsagesCount, giftGrantsCount,] = await Promise.all([
            prisma.order.count({ where: { customerId: input.customerId } }),
            prisma.customerEvent.count({ where: { customerId: input.customerId } }),
            prisma.messageLog.count({ where: { customerId: input.customerId } }),
            prisma.consentLog.count({ where: { customerId: input.customerId } }),
            prisma.experimentAssignment.count({ where: { customerId: input.customerId } }),
            prisma.discountRedemption.count({ where: { customerId: input.customerId } }),
            prisma.giftGrant.count({ where: { customerId: input.customerId } }),
        ]);
        const preview = {
            customerId: input.customerId,
            ordersCount,
            eventsCount,
            messagesCount,
            consentsCount,
            experimentsCount,
            discountUsagesCount,
            giftGrantsCount,
        };
        if (input.dryRun) {
            return {
                success: true,
                dryRun: true,
                deletionId: null,
                mode: input.mode,
                preview,
                message: `Dry run completed. No data was ${input.mode === 'delete' ? 'deleted' : 'anonymized'}. Set dryRun=false to perform actual ${input.mode}.`,
            };
        }
        const deletionOptions = {
            mode: input.mode,
            retainOrders: input.options?.retainOrders ?? true,
            retainMessageLogs: input.options?.retainMessageLogs ?? true,
        };
        const result = await deleteCustomerData(input.customerId, ctx.user.sub, deletionOptions);
        return {
            success: true,
            dryRun: false,
            deletionId: result.deletionId,
            mode: input.mode,
            preview,
            message: input.mode === 'delete'
                ? 'Customer data has been permanently deleted as requested.'
                : 'Customer data has been anonymized as requested. Aggregate records preserved.',
        };
    },
});
const VALID_REASONS = ['unsubscribed', 'bounced', 'spam', 'manual', 'other'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+[1-9]\d{1,14}$/;
function validateRow(row, rowIndex) {
    const errors = [];
    let channel = null;
    let value = null;
    const email = row.email?.trim().toLowerCase();
    const phone = row.phone?.trim();
    if (email && EMAIL_REGEX.test(email)) {
        channel = 'email';
        value = email;
    }
    else if (phone) {
        let normalizedPhone = phone.replace(/[\s\-()]/g, '');
        if (!normalizedPhone.startsWith('+')) {
            normalizedPhone = '+' + normalizedPhone;
        }
        if (PHONE_REGEX.test(normalizedPhone)) {
            channel = 'sms';
            value = normalizedPhone;
        }
        else {
            errors.push({
                row: rowIndex,
                column: 'phone',
                message: 'Invalid phone number format. Must be E.164 format (e.g., +15551234567)',
                value: phone,
            });
        }
    }
    else if (email) {
        errors.push({
            row: rowIndex,
            column: 'email',
            message: 'Invalid email format',
            value: email,
        });
    }
    if (!channel && errors.length === 0) {
        errors.push({
            row: rowIndex,
            column: 'email/phone',
            message: 'Either email or phone must be provided',
        });
    }
    let reason = 'manual';
    if (row.reason) {
        const normalizedReason = row.reason.trim().toLowerCase();
        if (VALID_REASONS.includes(normalizedReason)) {
            reason = normalizedReason;
        }
        else {
            const reasonMap = {
                unsubscribe: 'unsubscribed',
                unsub: 'unsubscribed',
                bounce: 'bounced',
                hard_bounce: 'bounced',
                soft_bounce: 'bounced',
                complaint: 'spam',
                spamreport: 'spam',
                spam_report: 'spam',
                marked_as_spam: 'spam',
            };
            reason = reasonMap[normalizedReason] || 'other';
        }
    }
    let suppressedAt = null;
    if (row.date) {
        const dateStr = row.date.trim();
        const parsedDate = new Date(dateStr);
        if (!isNaN(parsedDate.getTime())) {
            suppressedAt = parsedDate;
        }
        else {
            errors.push({
                row: rowIndex,
                column: 'date',
                message: 'Invalid date format. Use ISO 8601 format (e.g., 2024-01-15)',
                value: dateStr,
            });
        }
    }
    if (errors.length > 0 || !channel || !value) {
        return { valid: false, errors };
    }
    return {
        valid: true,
        errors: [],
        data: { channel, value, reason, suppressedAt },
    };
}
const importSuppressionsFactory = createAuthRoleFactory('admin', 'manager');
export const importSuppressionsEndpoint = importSuppressionsFactory.build({
    method: 'post',
    shortDescription: 'Import Suppressions',
    description: 'Imports suppression entries from a CSV file. Supports Klaviyo export format (email/phone, reason, date).',
    tag: 'Consent',
    input: z.object({
        content: z.string().describe('Base64-encoded CSV file content'),
        filename: z.string().describe('Original filename'),
    }),
    output: z.object({
        success: z.boolean(),
        importId: z.string(),
        stats: z.object({
            rowsTotal: z.number(),
            rowsProcessed: z.number(),
            rowsSkipped: z.number(),
            rowsInvalid: z.number(),
        }),
        validationErrors: z.array(z.object({
            row: z.number(),
            column: z.string(),
            message: z.string(),
            value: z.string().optional(),
        })),
    }),
    handler: async ({ input, ctx }) => {
        let csvContent;
        try {
            csvContent = Buffer.from(input.content, 'base64').toString('utf-8');
        }
        catch {
            throw createHttpError(400, 'Invalid base64-encoded content');
        }
        const parseResult = Papa.parse(csvContent, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (header) => header.trim().toLowerCase(),
        });
        if (parseResult.errors.length > 0 && parseResult.data.length === 0) {
            throw createHttpError(400, `CSV parsing error: ${parseResult.errors[0]?.message || 'Unknown error'}`);
        }
        const rows = parseResult.data;
        const stats = {
            rowsTotal: rows.length,
            rowsProcessed: 0,
            rowsSkipped: 0,
            rowsInvalid: 0,
        };
        const allErrors = [];
        const validEntries = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const result = validateRow(row, i + 2);
            if (result.valid && result.data) {
                validEntries.push(result.data);
            }
            else {
                stats.rowsInvalid++;
                allErrors.push(...result.errors);
            }
        }
        const limitedErrors = allErrors.slice(0, 100);
        const importHistory = await prisma.suppressionImportHistory.create({
            data: {
                importedBy: ctx.user.sub,
                filename: input.filename,
                fileSize: Buffer.from(input.content, 'base64').length,
                rowsTotal: stats.rowsTotal,
                rowsProcessed: 0,
                rowsSkipped: 0,
                rowsInvalid: stats.rowsInvalid,
                validationErrors: limitedErrors.length > 0 ? JSON.parse(JSON.stringify(limitedErrors)) : undefined,
            },
        });
        for (const entry of validEntries) {
            try {
                const existingEntry = await prisma.suppressionEntry.findUnique({
                    where: {
                        channel_value: {
                            channel: entry.channel,
                            value: entry.value,
                        },
                    },
                });
                if (existingEntry) {
                    stats.rowsSkipped++;
                }
                else {
                    await prisma.suppressionEntry.create({
                        data: {
                            channel: entry.channel,
                            value: entry.value,
                            reason: entry.reason,
                            source: 'import',
                            importId: importHistory.id,
                            createdAt: entry.suppressedAt || new Date(),
                        },
                    });
                    stats.rowsProcessed++;
                }
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('Unique constraint')) {
                    stats.rowsSkipped++;
                }
                else {
                    stats.rowsInvalid++;
                }
            }
        }
        await prisma.suppressionImportHistory.update({
            where: { id: importHistory.id },
            data: {
                rowsProcessed: stats.rowsProcessed,
                rowsSkipped: stats.rowsSkipped,
                rowsInvalid: stats.rowsInvalid,
            },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: AuditActions.suppression.import,
            resourceType: 'suppression_import',
            resourceId: importHistory.id,
            metadata: {
                filename: input.filename,
                stats,
                errorCount: allErrors.length,
            },
            context: auditContext,
        });
        return {
            success: true,
            importId: importHistory.id,
            stats,
            validationErrors: limitedErrors,
        };
    },
});
export const listImportHistoryEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'List Import History',
    description: 'Returns the history of suppression list imports.',
    tag: 'Consent',
    input: z.object({
        page: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 1)),
        pageSize: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 20)),
    }),
    output: z.object({
        items: z.array(z.object({
            id: z.string(),
            importedBy: z.string(),
            importedByName: z.string().nullable(),
            importedByEmail: z.string().nullable(),
            filename: z.string(),
            fileSize: z.number(),
            rowsTotal: z.number(),
            rowsProcessed: z.number(),
            rowsSkipped: z.number(),
            rowsInvalid: z.number(),
            importedAt: z.string(),
        })),
        total: z.number(),
        page: z.number(),
        pageSize: z.number(),
        hasMore: z.boolean(),
    }),
    handler: async ({ input }) => {
        const { page, pageSize } = input;
        const skip = (page - 1) * pageSize;
        const [imports, total] = await Promise.all([
            prisma.suppressionImportHistory.findMany({
                skip,
                take: pageSize + 1,
                orderBy: { importedAt: 'desc' },
            }),
            prisma.suppressionImportHistory.count(),
        ]);
        const hasMore = imports.length > pageSize;
        if (hasMore)
            imports.pop();
        const userIds = [...new Set(imports.map((i) => i.importedBy))];
        const users = await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true },
        });
        const userMap = new Map(users.map((u) => [u.id, u]));
        return {
            items: imports.map((i) => {
                const user = userMap.get(i.importedBy);
                return {
                    id: i.id,
                    importedBy: i.importedBy,
                    importedByName: user?.name || null,
                    importedByEmail: user?.email || null,
                    filename: i.filename,
                    fileSize: i.fileSize,
                    rowsTotal: i.rowsTotal,
                    rowsProcessed: i.rowsProcessed,
                    rowsSkipped: i.rowsSkipped,
                    rowsInvalid: i.rowsInvalid,
                    importedAt: i.importedAt.toISOString(),
                };
            }),
            total,
            page,
            pageSize,
            hasMore,
        };
    },
});
export const getImportDetailsEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'Get Import Details',
    description: 'Returns details of a suppression import including validation errors.',
    tag: 'Consent',
    input: z.object({
        importId: objectIdSchema,
    }),
    output: z.object({
        id: z.string(),
        importedBy: z.string(),
        importedByName: z.string().nullable(),
        importedByEmail: z.string().nullable(),
        filename: z.string(),
        fileSize: z.number(),
        rowsTotal: z.number(),
        rowsProcessed: z.number(),
        rowsSkipped: z.number(),
        rowsInvalid: z.number(),
        validationErrors: z.array(z.object({
            row: z.number(),
            column: z.string(),
            message: z.string(),
            value: z.string().optional(),
        })),
        importedAt: z.string(),
    }),
    handler: async ({ input }) => {
        const importRecord = await prisma.suppressionImportHistory.findUnique({
            where: { id: input.importId },
        });
        if (!importRecord) {
            throw createHttpError(404, 'Import not found');
        }
        const user = await prisma.user.findUnique({
            where: { id: importRecord.importedBy },
            select: { name: true, email: true },
        });
        return {
            id: importRecord.id,
            importedBy: importRecord.importedBy,
            importedByName: user?.name || null,
            importedByEmail: user?.email || null,
            filename: importRecord.filename,
            fileSize: importRecord.fileSize,
            rowsTotal: importRecord.rowsTotal,
            rowsProcessed: importRecord.rowsProcessed,
            rowsSkipped: importRecord.rowsSkipped,
            rowsInvalid: importRecord.rowsInvalid,
            validationErrors: importRecord.validationErrors || [],
            importedAt: importRecord.importedAt.toISOString(),
        };
    },
});
