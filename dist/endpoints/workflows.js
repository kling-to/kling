import { z } from 'zod';
import { createAuthRoleFactory, createAuthRoleTenantFactory } from '../factories';
import prisma from '../utils/prisma';
import { addWorkflowSchedule, updateWorkflowSchedule, removeWorkflowSchedule, pauseWorkflowSchedule, resumeWorkflowSchedule, triggerWorkflowNow, } from '../utils/bullmq';
import { parseNaturalLanguageToWorkflowDSL, parseChannel } from '../utils/llm-parser';
import { executePreviewQuery, parseQueryDSL } from '../utils/query-executor';
import { executeAggregationQuery } from '../utils/query-aggregator';
import createHttpError from 'http-errors';
/**
 * Check if a query DSL contains an aggregation query
 */
function isAggregationQuery(dsl) {
    return (typeof dsl === 'object' &&
        dsl !== null &&
        'aggregation' in dsl &&
        typeof dsl.aggregation === 'object');
}
// Common schemas
const workflowSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    createdBy: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    cron: z.string(),
    startAt: z.date(),
    endAt: z.date(),
    query: z.union([z.string(), z.record(z.string(), z.unknown())]),
    messageTemplate: z.string(),
    channel: z.enum(['email', 'sms', 'push']),
    conditions: z.record(z.string(), z.unknown()).default({}),
    retrieval: z.record(z.string(), z.unknown()).nullable().optional(),
    status: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
});
// Create workflow endpoint (with tenant isolation)
export const createWorkflowEndpoint = createAuthRoleTenantFactory(['tenant_admin', 'tenant_user'], 'tenantId').build({
    method: 'post',
    shortDescription: 'Create Workflow',
    description: 'Creates a new workflow definition and schedules it.',
    tag: 'Workflows',
    input: z.object({
        tenantId: z.string(),
        name: z.string(),
        description: z.string().optional(),
        cron: z.string(),
        startAt: z.string().datetime(),
        endAt: z.string().datetime(),
        query: z.union([z.string(), z.object({})]),
        messageTemplate: z.string(),
        channel: z.enum(['email', 'sms', 'push']),
        conditions: z.record(z.string(), z.unknown()).optional(),
        retrieval: z.record(z.string(), z.unknown()).optional(),
        discountId: z.string().optional(),
        giftId: z.string().optional(),
    }),
    output: z.object({
        message: z.string(),
        workflow: workflowSchema,
    }),
    handler: async ({ input, ctx }) => {
        const userId = ctx.user.sub;
        // Create database record
        const workflow = await prisma.workflowDefinition.create({
            data: {
                tenantId: input.tenantId,
                createdBy: userId,
                name: input.name,
                description: input.description,
                cron: input.cron,
                startAt: new Date(input.startAt),
                endAt: new Date(input.endAt),
                query: typeof input.query === 'string' ? input.query : JSON.stringify(input.query),
                messageTemplate: input.messageTemplate,
                channel: input.channel,
                conditions: input.conditions ? JSON.parse(JSON.stringify(input.conditions)) : {},
                retrieval: input.retrieval ? JSON.parse(JSON.stringify(input.retrieval)) : null,
                status: 'active',
                discountId: input.discountId,
                giftId: input.giftId,
            },
        });
        // Create BullMQ schedule
        const tenant = await prisma.tenant.findUnique({
            where: { id: input.tenantId },
            select: { timezone: true },
        });
        await addWorkflowSchedule(workflow.id, workflow.cron, workflow.startAt, workflow.endAt, tenant?.timezone);
        return {
            message: 'Workflow created and scheduled.',
            workflow: {
                ...workflow,
                conditions: workflow.conditions || {},
                retrieval: workflow.retrieval || null,
            },
        };
    },
});
// List workflows endpoint (with tenant isolation)
export const listWorkflowsEndpoint = createAuthRoleTenantFactory(['tenant_admin', 'tenant_user'], 'tenantId').build({
    method: 'get',
    shortDescription: 'List Workflows',
    description: 'Returns a list of workflows for the specified tenant.',
    tag: 'Workflows',
    input: z.object({
        tenantId: z.string(),
    }),
    output: z.object({
        items: z.array(workflowSchema.extend({
            creator: z.object({
                id: z.string(),
                email: z.string(),
                name: z.string(),
            }),
        })),
    }),
    handler: async ({ input }) => {
        const workflows = await prisma.workflowDefinition.findMany({
            where: {
                tenantId: input.tenantId,
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
            items: workflows.map((w) => ({
                ...w,
                conditions: w.conditions || {},
                retrieval: w.retrieval || null,
                creator: {
                    ...w.creator,
                    name: w.creator.name || '',
                },
            })),
        };
    },
});
// Get workflow endpoint
export const getWorkflowEndpoint = createAuthRoleFactory('tenant_admin', 'tenant_user').build({
    method: 'get',
    shortDescription: 'Get Workflow',
    description: 'Returns details of a specific workflow by ID.',
    tag: 'Workflows',
    input: z.object({
        workflowId: z.string(),
    }),
    output: workflowSchema.extend({
        creator: z.object({
            id: z.string(),
            email: z.string(),
            name: z.string(),
        }),
        tenant: z.object({
            id: z.string(),
            name: z.string(),
        }),
    }),
    handler: async ({ input }) => {
        const workflow = await prisma.workflowDefinition.findUnique({
            where: { id: input.workflowId },
            include: {
                creator: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                    },
                },
                tenant: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });
        if (!workflow) {
            throw createHttpError(404, 'Workflow not found');
        }
        return {
            ...workflow,
            conditions: workflow.conditions || {},
            retrieval: workflow.retrieval || null,
            creator: {
                ...workflow.creator,
                name: workflow.creator.name || '',
            },
            tenant: workflow.tenant,
        };
    },
});
// Update workflow endpoint
export const updateWorkflowEndpoint = createAuthRoleFactory('tenant_admin', 'tenant_user').build({
    method: 'patch',
    shortDescription: 'Update Workflow',
    description: 'Updates an existing workflow definition.',
    tag: 'Workflows',
    input: z.object({
        workflowId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        cron: z.string().optional(),
        startAt: z.string().datetime().optional(),
        endAt: z.string().datetime().optional(),
        query: z.union([z.string(), z.object({})]).optional(),
        messageTemplate: z.string().optional(),
        channel: z.enum(['email', 'sms', 'push']).optional(),
        conditions: z.record(z.string(), z.unknown()).optional(),
        retrieval: z.record(z.string(), z.unknown()).optional(),
        status: z.enum(['active', 'paused', 'disabled']).optional(),
        discountId: z.string().nullable().optional(),
        giftId: z.string().nullable().optional(),
    }),
    output: workflowSchema,
    handler: async ({ input }) => {
        // Fetch existing workflow
        const existingWorkflow = await prisma.workflowDefinition.findUnique({
            where: { id: input.workflowId },
        });
        if (!existingWorkflow) {
            throw createHttpError(404, 'Workflow not found');
        }
        // Update workflow in database
        const updatedWorkflow = await prisma.workflowDefinition.update({
            where: { id: input.workflowId },
            data: {
                ...(input.name && { name: input.name }),
                ...(input.description && { description: input.description }),
                ...(input.cron && { cron: input.cron }),
                ...(input.startAt && { startAt: new Date(input.startAt) }),
                ...(input.endAt && { endAt: new Date(input.endAt) }),
                ...(input.query && {
                    query: typeof input.query === 'string' ? input.query : JSON.stringify(input.query),
                }),
                ...(input.messageTemplate && { messageTemplate: input.messageTemplate }),
                ...(input.channel && { channel: input.channel }),
                ...(input.conditions && { conditions: JSON.parse(JSON.stringify(input.conditions)) }),
                ...(input.retrieval !== undefined && {
                    retrieval: input.retrieval ? JSON.parse(JSON.stringify(input.retrieval)) : null,
                }),
                ...(input.status && { status: input.status }),
                ...(input.discountId !== undefined && { discountId: input.discountId }),
                ...(input.giftId !== undefined && { giftId: input.giftId }),
            },
        });
        // Update BullMQ schedule if timing changed
        if (input.cron || input.startAt || input.endAt) {
            const tenant = await prisma.tenant.findUnique({
                where: { id: updatedWorkflow.tenantId },
                select: { timezone: true },
            });
            await updateWorkflowSchedule(updatedWorkflow.id, updatedWorkflow.cron, updatedWorkflow.startAt, updatedWorkflow.endAt, tenant?.timezone);
        }
        return {
            ...updatedWorkflow,
            conditions: updatedWorkflow.conditions || {},
            retrieval: updatedWorkflow.retrieval || null,
        };
    },
});
// Delete workflow endpoint
export const deleteWorkflowEndpoint = createAuthRoleFactory('tenant_admin').build({
    method: 'delete',
    shortDescription: 'Delete Workflow',
    description: 'Deletes (archives) a workflow definition and removes its schedule.',
    tag: 'Workflows',
    input: z.object({
        workflowId: z.string(),
    }),
    output: z.object({}),
    handler: async ({ input }) => {
        try {
            // Soft delete by setting status to archived
            await prisma.workflowDefinition.update({
                where: { id: input.workflowId },
                data: { status: 'archived' },
            });
        }
        catch (err) {
            if (err && typeof err === 'object' && 'code' in err && err.code === 'P2025') {
                throw createHttpError(404, 'Workflow not found');
            }
            throw err;
        }
        // Delete the BullMQ schedule
        try {
            await removeWorkflowSchedule(input.workflowId);
        }
        catch (bullmqErr) {
            console.error('Failed to delete BullMQ schedule:', bullmqErr);
            // Don't fail the request if BullMQ deletion fails
        }
        return {};
    },
});
// Pause workflow endpoint (Journey 4)
export const pauseWorkflowEndpoint = createAuthRoleFactory('tenant_admin').build({
    method: 'post',
    shortDescription: 'Pause Workflow',
    description: 'Pauses a workflow, stopping scheduled executions until resumed.',
    tag: 'Workflows',
    input: z.object({
        workflowId: z.string(),
    }),
    output: z.object({
        success: z.boolean(),
        status: z.string(),
    }),
    handler: async ({ input }) => {
        // Check workflow exists and is active
        const workflow = await prisma.workflowDefinition.findUnique({
            where: { id: input.workflowId },
        });
        if (!workflow) {
            throw createHttpError(404, 'Workflow not found');
        }
        if (workflow.status === 'paused') {
            return { success: true, status: 'paused' };
        }
        if (workflow.status !== 'active') {
            throw createHttpError(400, `Cannot pause workflow with status: ${workflow.status}`);
        }
        // Pause the BullMQ schedule
        try {
            await pauseWorkflowSchedule(input.workflowId);
        }
        catch (bullmqErr) {
            console.error('Failed to pause BullMQ schedule:', bullmqErr);
            throw createHttpError(500, 'Failed to pause workflow schedule');
        }
        // Update DB status
        await prisma.workflowDefinition.update({
            where: { id: input.workflowId },
            data: { status: 'paused' },
        });
        return { success: true, status: 'paused' };
    },
});
// Resume workflow endpoint (Journey 4)
export const resumeWorkflowEndpoint = createAuthRoleFactory('tenant_admin').build({
    method: 'post',
    shortDescription: 'Resume Workflow',
    description: 'Resumes a paused workflow, restarting scheduled executions.',
    tag: 'Workflows',
    input: z.object({
        workflowId: z.string(),
    }),
    output: z.object({
        success: z.boolean(),
        status: z.string(),
    }),
    handler: async ({ input }) => {
        // Check workflow exists and is paused
        const workflow = await prisma.workflowDefinition.findUnique({
            where: { id: input.workflowId },
        });
        if (!workflow) {
            throw createHttpError(404, 'Workflow not found');
        }
        if (workflow.status === 'active') {
            return { success: true, status: 'active' };
        }
        if (workflow.status !== 'paused') {
            throw createHttpError(400, `Cannot resume workflow with status: ${workflow.status}`);
        }
        // Resume the BullMQ schedule
        try {
            await resumeWorkflowSchedule(input.workflowId);
        }
        catch (bullmqErr) {
            console.error('Failed to resume BullMQ schedule:', bullmqErr);
            throw createHttpError(500, 'Failed to resume workflow schedule');
        }
        // Update DB status
        await prisma.workflowDefinition.update({
            where: { id: input.workflowId },
            data: { status: 'active' },
        });
        return { success: true, status: 'active' };
    },
});
// Preview workflow endpoint
export const previewWorkflowEndpoint = createAuthRoleFactory('tenant_admin', 'tenant_user').build({
    method: 'post',
    shortDescription: 'Preview Workflow',
    description: 'Generates a preview of customers matching the workflow query.',
    tag: 'Workflows',
    input: z.object({
        workflowId: z.string(),
    }),
    output: z.object({
        workflow: z.object({
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
        // Fetch workflow
        const workflow = await prisma.workflowDefinition.findUnique({
            where: { id: input.workflowId },
        });
        if (!workflow) {
            throw createHttpError(404, 'Workflow not found');
        }
        // Execute query to get preview of customers (supports both standard and aggregation queries)
        let customers = [];
        try {
            const queryString = typeof workflow.query === 'string' ? workflow.query : JSON.stringify(workflow.query);
            const dsl = parseQueryDSL(queryString);
            // Check if this is an aggregation query
            if (isAggregationQuery(dsl)) {
                const result = await executeAggregationQuery(workflow.tenantId, dsl, {
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
                // Standard query execution
                const result = await executePreviewQuery(workflow.tenantId, dsl, 10);
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
            workflow: {
                id: workflow.id,
                name: workflow.name,
                query: workflow.query,
            },
            preview: {
                count: customers.length,
                customers,
            },
        };
    },
});
// Test workflow endpoint
export const testWorkflowEndpoint = createAuthRoleFactory('tenant_admin', 'tenant_user').build({
    method: 'post',
    shortDescription: 'Test Workflow',
    description: 'Starts a single immediate execution of the specified workflow.',
    tag: 'Workflows',
    input: z.object({
        workflowId: z.string(),
    }),
    output: z.object({
        id: z.string(),
        workflowId: z.string(),
        status: z.string(),
        runId: z.string(),
    }),
    handler: async ({ input }) => {
        // Fetch workflow
        const workflow = await prisma.workflowDefinition.findUnique({
            where: { id: input.workflowId },
        });
        if (!workflow) {
            throw createHttpError(404, 'Workflow not found');
        }
        // Trigger an immediate test execution via BullMQ
        const jobId = await triggerWorkflowNow(input.workflowId, true);
        return {
            id: `test-${input.workflowId}-${Date.now()}`,
            workflowId: workflow.id,
            status: 'running',
            runId: jobId,
        };
    },
});
// Create workflow from natural language (Journey 3 - LLM DSL parsing)
export const createWorkflowFromNLEndpoint = createAuthRoleTenantFactory(['tenant_admin', 'tenant_user'], 'tenantId').build({
    method: 'post',
    shortDescription: 'Create Workflow from Natural Language',
    description: 'Creates a new workflow from a natural language description using LLM to parse into DSL.',
    tag: 'Workflows',
    input: z.object({
        tenantId: z.string(),
        prompt: z.string().min(10).max(1000),
    }),
    output: z.object({
        message: z.string(),
        workflow: workflowSchema.optional(),
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
        // Get tenant timezone
        const tenant = await prisma.tenant.findUnique({
            where: { id: input.tenantId },
            select: { timezone: true },
        });
        // Parse natural language to DSL using LLM
        const parseResult = await parseNaturalLanguageToWorkflowDSL(input.prompt, tenant?.timezone || 'UTC');
        if (!parseResult.success || !parseResult.dsl) {
            // Check if this was an explicit rejection
            if (parseResult.rejected) {
                return {
                    message: 'Workflow request was rejected',
                    originalPrompt: input.prompt,
                    rejected: true,
                    rejectionReason: parseResult.rejectionReason,
                    rejectionCategory: parseResult.rejectionCategory,
                };
            }
            return {
                message: 'Failed to parse workflow from natural language',
                originalPrompt: input.prompt,
                error: parseResult.error,
            };
        }
        const dsl = parseResult.dsl;
        // Create database record with original prompt stored for audit
        const workflow = await prisma.workflowDefinition.create({
            data: {
                tenantId: input.tenantId,
                createdBy: userId,
                name: dsl.name,
                description: dsl.description || null,
                cron: dsl.cron,
                startAt: new Date(dsl.startAt),
                endAt: new Date(dsl.endAt),
                query: JSON.stringify(dsl.query),
                messageTemplate: dsl.messageTemplate,
                channel: parseChannel(dsl.channel),
                conditions: dsl.conditions ? JSON.parse(JSON.stringify(dsl.conditions)) : {},
                originalPrompt: input.prompt,
                parsedDsl: JSON.parse(JSON.stringify(dsl)),
                status: 'active',
            },
        });
        // Create BullMQ schedule
        await addWorkflowSchedule(workflow.id, workflow.cron, workflow.startAt, workflow.endAt, tenant?.timezone);
        return {
            message: 'Workflow created from natural language and scheduled.',
            workflow: {
                ...workflow,
                conditions: workflow.conditions || {},
                retrieval: workflow.retrieval || null,
            },
            parsedDsl: dsl,
            originalPrompt: input.prompt,
        };
    },
});
// Parse natural language to DSL preview (without creating workflow)
export const parseWorkflowNLEndpoint = createAuthRoleFactory('tenant_admin', 'tenant_user').build({
    method: 'post',
    shortDescription: 'Parse Workflow from Natural Language',
    description: 'Parses a natural language description into workflow DSL without creating it.',
    tag: 'Workflows',
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
        const parseResult = await parseNaturalLanguageToWorkflowDSL(input.prompt, input.timezone || 'UTC');
        if (!parseResult.success || !parseResult.dsl) {
            // Check if this was an explicit rejection
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
