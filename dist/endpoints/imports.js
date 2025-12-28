/**
 * Import Endpoints
 *
 * API endpoints for importing data from Klaviyo and other platforms.
 * Supports CSV and JSON formats.
 */
import { z } from 'zod';
import { createAuthRoleFactory } from '../factories';
import prisma from '../utils/prisma';
import { parseKlaviyoProfileCSV, parseKlaviyoProfileAPI, parseKlaviyoEvents, validateImportData, translateSegmentDefinition, } from '../utils/klaviyo-import';
// Role factories
const managerFactory = createAuthRoleFactory('admin', 'manager');
const adminFactory = createAuthRoleFactory('admin');
// Common schemas
const importResultSchema = z.object({
    total: z.number(),
    imported: z.number(),
    skipped: z.number(),
    failed: z.number(),
    errors: z.array(z.object({
        row: z.number().optional(),
        id: z.string().optional(),
        field: z.string().optional(),
        message: z.string(),
    })),
    warnings: z.array(z.string()),
});
// -------------------------------------------------------------------
// POST /v1/imports/klaviyo/validate
// Validate import data before processing
// -------------------------------------------------------------------
export const validateImportEndpoint = managerFactory.build({
    method: 'post',
    shortDescription: 'Validate Import Data',
    description: 'Validate Klaviyo export data before importing',
    tag: 'Imports',
    input: z.object({
        type: z.enum(['profiles', 'lists', 'events']),
        data: z.union([
            z.string(),
            z.array(z.record(z.string(), z.unknown())),
            z.record(z.string(), z.unknown()),
        ]),
    }),
    output: z.object({
        valid: z.boolean(),
        format: z.enum(['csv', 'json', 'unknown']),
        recordCount: z.number(),
        errors: z.array(z.string()),
    }),
    handler: async ({ input }) => {
        const result = validateImportData(input.data, input.type);
        return result;
    },
});
// -------------------------------------------------------------------
// POST /v1/imports/klaviyo/profiles
// Import customer profiles from Klaviyo
// -------------------------------------------------------------------
export const importProfilesEndpoint = managerFactory.build({
    method: 'post',
    shortDescription: 'Import Klaviyo Profiles',
    description: 'Import customer profiles from Klaviyo CSV or API JSON export',
    tag: 'Imports',
    input: z.object({
        data: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
        updateExisting: z.boolean().default(true),
        skipInvalid: z.boolean().default(true),
    }),
    output: z.object({
        result: importResultSchema,
        importId: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        // Parse the data based on format
        let parseResult;
        if (typeof input.data === 'string') {
            // CSV format
            parseResult = parseKlaviyoProfileCSV(input.data);
        }
        else {
            // JSON format (Klaviyo API export)
            parseResult = parseKlaviyoProfileAPI(input.data);
        }
        // Import customers in batches
        const batchSize = 100;
        const importedIds = [];
        const result = { ...parseResult.result };
        for (let i = 0; i < parseResult.customers.length; i += batchSize) {
            const batch = parseResult.customers.slice(i, i + batchSize);
            for (const customerData of batch) {
                try {
                    // Find existing by email or phone
                    let existingCustomer = null;
                    if (customerData.email) {
                        existingCustomer = await prisma.customer.findUnique({
                            where: { email: customerData.email },
                        });
                    }
                    if (!existingCustomer && customerData.phone) {
                        existingCustomer = await prisma.customer.findFirst({
                            where: { phone: customerData.phone },
                        });
                    }
                    if (existingCustomer) {
                        if (input.updateExisting) {
                            // Update existing customer - merge metadata
                            const existingMetadata = existingCustomer.metadata || {};
                            const newMetadata = customerData.metadata || {};
                            const updated = await prisma.customer.update({
                                where: { id: existingCustomer.id },
                                data: {
                                    firstName: customerData.firstName || existingCustomer.firstName,
                                    lastName: customerData.lastName || existingCustomer.lastName,
                                    phone: customerData.phone || existingCustomer.phone,
                                    metadata: {
                                        ...existingMetadata,
                                        ...newMetadata,
                                        klaviyoImportedAt: new Date().toISOString(),
                                    },
                                },
                            });
                            importedIds.push(updated.id);
                        }
                        else {
                            result.skipped++;
                            result.warnings.push(`Skipped existing customer: ${customerData.email || customerData.phone}`);
                        }
                    }
                    else {
                        // Create new customer
                        // Only set externalId if it has a value (avoid unique constraint on null)
                        const createData = {
                            email: customerData.email,
                            phone: customerData.phone,
                            firstName: customerData.firstName,
                            lastName: customerData.lastName,
                            metadata: {
                                ...(customerData.metadata || {}),
                                klaviyoImportedAt: new Date().toISOString(),
                                importSource: 'klaviyo',
                            },
                        };
                        if (customerData.externalId) {
                            createData.externalId = customerData.externalId;
                        }
                        const created = await prisma.customer.create({ data: createData });
                        importedIds.push(created.id);
                    }
                }
                catch (error) {
                    result.failed++;
                    result.imported--;
                    result.errors.push({
                        id: customerData.email || customerData.phone,
                        message: error instanceof Error ? error.message : 'Database error',
                    });
                }
            }
        }
        // Create import history record
        const importHistory = await prisma.importHistory.create({
            data: {
                type: 'klaviyo_profiles',
                source: 'klaviyo',
                total: result.total,
                imported: importedIds.length,
                skipped: result.skipped,
                failed: result.failed,
                errors: result.errors,
                importedBy: ctx.user.sub,
            },
        });
        return {
            result: { ...result, imported: importedIds.length },
            importId: importHistory.id,
        };
    },
});
// -------------------------------------------------------------------
// POST /v1/imports/klaviyo/events
// Import event history from Klaviyo
// -------------------------------------------------------------------
export const importEventsEndpoint = adminFactory.build({
    method: 'post',
    shortDescription: 'Import Klaviyo Events',
    description: 'Import event history from Klaviyo API JSON export',
    tag: 'Imports',
    input: z.object({
        events: z.array(z.record(z.string(), z.unknown())),
        metricNameMap: z.record(z.string(), z.string()).default({}),
        emailToCustomerIdMap: z.record(z.string(), z.string()).optional(),
        skipDuplicates: z.boolean().default(true),
    }),
    output: z.object({
        result: importResultSchema,
        importId: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        // Parse events
        const { events, result } = parseKlaviyoEvents(input.events, input.metricNameMap);
        // Build email to customer ID mapping if provided
        const profileIdToCustomerId = new Map();
        if (input.emailToCustomerIdMap) {
            for (const [email, customerId] of Object.entries(input.emailToCustomerIdMap)) {
                profileIdToCustomerId.set(email, customerId);
            }
        }
        // Import events
        let importedCount = 0;
        for (const { profileId, event } of events) {
            try {
                // Try to find customer
                const customerId = profileIdToCustomerId.get(profileId);
                if (!customerId) {
                    // Skip if no mapping
                    result.skipped++;
                    result.imported--;
                    continue;
                }
                // Check for duplicate by eventData.klaviyoEventId
                if (input.skipDuplicates && event.data.klaviyoEventId) {
                    const existing = await prisma.customerEvent.findFirst({
                        where: {
                            customerId,
                            eventType: event.type,
                            idempotencyKey: `klaviyo_${event.data.klaviyoEventId}`,
                        },
                    });
                    if (existing) {
                        result.skipped++;
                        result.imported--;
                        continue;
                    }
                }
                // Create event
                await prisma.customerEvent.create({
                    data: {
                        customerId,
                        eventType: event.type,
                        eventData: event.data,
                        occurredAt: event.occurredAt || new Date(),
                        source: 'klaviyo_import',
                        idempotencyKey: event.data.klaviyoEventId
                            ? `klaviyo_${event.data.klaviyoEventId}`
                            : undefined,
                    },
                });
                importedCount++;
            }
            catch (error) {
                result.failed++;
                result.imported--;
                result.errors.push({
                    id: profileId,
                    message: error instanceof Error ? error.message : 'Database error',
                });
            }
        }
        // Create import history
        const importHistory = await prisma.importHistory.create({
            data: {
                type: 'klaviyo_events',
                source: 'klaviyo',
                total: result.total,
                imported: importedCount,
                skipped: result.skipped,
                failed: result.failed,
                errors: result.errors,
                importedBy: ctx.user.sub,
            },
        });
        return {
            result: { ...result, imported: importedCount },
            importId: importHistory.id,
        };
    },
});
// -------------------------------------------------------------------
// POST /v1/imports/klaviyo/segment
// Translate Klaviyo segment definition to Kling query DSL
// -------------------------------------------------------------------
export const translateSegmentEndpoint = managerFactory.build({
    method: 'post',
    shortDescription: 'Translate Klaviyo Segment',
    description: 'Convert a Klaviyo segment definition to Kling query DSL',
    tag: 'Imports',
    input: z.object({
        definition: z.object({
            condition_groups: z.array(z.object({
                conditions: z.array(z.object({
                    type: z.string(),
                    property: z.string().optional(),
                    operator: z.string(),
                    value: z.unknown(),
                    metric_id: z.string().optional(),
                    timeframe: z.string().optional(),
                })),
            })),
        }),
        metricNameMap: z.record(z.string(), z.string()).default({}),
    }),
    output: z.object({
        dsl: z.record(z.string(), z.unknown()),
        unsupported: z.array(z.string()),
        success: z.boolean(),
    }),
    handler: async ({ input }) => {
        const { dsl, unsupported } = translateSegmentDefinition(input.definition, input.metricNameMap);
        return {
            dsl,
            unsupported,
            success: unsupported.length === 0,
        };
    },
});
// -------------------------------------------------------------------
// GET /v1/imports/history
// Get import history
// -------------------------------------------------------------------
export const listImportHistoryEndpoint = managerFactory.build({
    method: 'get',
    shortDescription: 'List Import History',
    description: 'Get history of all imports',
    tag: 'Imports',
    input: z.object({
        type: z.enum(['klaviyo_profiles', 'klaviyo_lists', 'klaviyo_events', 'all']).default('all'),
        page: z.coerce.number().min(1).default(1),
        pageSize: z.coerce.number().min(1).max(100).default(20),
    }),
    output: z.object({
        imports: z.array(z.object({
            id: z.string(),
            type: z.string(),
            source: z.string(),
            total: z.number(),
            imported: z.number(),
            skipped: z.number(),
            failed: z.number(),
            importedBy: z.string(),
            createdAt: z.string(),
        })),
        total: z.number(),
        page: z.number(),
        pageSize: z.number(),
        hasMore: z.boolean(),
    }),
    handler: async ({ input }) => {
        const where = input.type === 'all' ? {} : { type: input.type };
        const [imports, total] = await Promise.all([
            prisma.importHistory.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (input.page - 1) * input.pageSize,
                take: input.pageSize,
            }),
            prisma.importHistory.count({ where }),
        ]);
        return {
            imports: imports.map((i) => ({
                id: i.id,
                type: i.type,
                source: i.source,
                total: i.total,
                imported: i.imported,
                skipped: i.skipped,
                failed: i.failed,
                importedBy: i.importedBy,
                createdAt: i.createdAt.toISOString(),
            })),
            total,
            page: input.page,
            pageSize: input.pageSize,
            hasMore: input.page * input.pageSize < total,
        };
    },
});
// -------------------------------------------------------------------
// GET /v1/imports/:importId
// Get import details
// -------------------------------------------------------------------
export const getImportDetailsEndpoint = managerFactory.build({
    method: 'get',
    shortDescription: 'Get Import Details',
    description: 'Get details of a specific import including errors',
    tag: 'Imports',
    input: z.object({
        importId: z.string(),
    }),
    output: z.object({
        id: z.string(),
        type: z.string(),
        source: z.string(),
        total: z.number(),
        imported: z.number(),
        skipped: z.number(),
        failed: z.number(),
        errors: z.array(z.record(z.string(), z.unknown())),
        importedBy: z.string(),
        createdAt: z.string(),
    }),
    handler: async ({ input }) => {
        const importRecord = await prisma.importHistory.findUnique({
            where: { id: input.importId },
        });
        if (!importRecord) {
            throw new Error('Import not found');
        }
        return {
            id: importRecord.id,
            type: importRecord.type,
            source: importRecord.source,
            total: importRecord.total,
            imported: importRecord.imported,
            skipped: importRecord.skipped,
            failed: importRecord.failed,
            errors: importRecord.errors || [],
            importedBy: importRecord.importedBy,
            createdAt: importRecord.createdAt.toISOString(),
        };
    },
});
