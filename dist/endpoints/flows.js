import { z } from 'zod';
import { createAuthRoleFactory } from '../factories';
import prisma from '../utils/prisma';
import createHttpError from 'http-errors';
import { objectIdSchema } from '../utils/validation';
import { createAuditLog, extractAuditContext } from '../utils/audit';
import { getFlowTemplates, getFlowTemplateById } from '../utils/flow-templates';
import { parseNaturalLanguageToFlowDSL } from '../utils/llm-parser';
import { calculateFlowRevenue } from '../utils/revenue-attribution';
const managerFactory = createAuthRoleFactory('admin', 'manager');
const staffFactory = createAuthRoleFactory('admin', 'manager', 'staff');
const flowNodePositionSchema = z.object({
    x: z.number(),
    y: z.number(),
});
const flowNodeDataSchema = z.object({
    label: z.string(),
    config: z.record(z.string(), z.unknown()),
});
const flowNodeSchema = z.object({
    id: z.string(),
    type: z.enum([
        'trigger',
        'send_email',
        'send_sms',
        'send_whatsapp',
        'send_push',
        'send_rcs',
        'wait',
        'conditional_split',
        'exit_flow',
    ]),
    position: flowNodePositionSchema,
    data: flowNodeDataSchema,
});
const flowEdgeSchema = z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    sourceHandle: z.string().optional(),
    targetHandle: z.string().optional(),
    label: z.string().optional(),
    data: z
        .object({
        condition: z.string().optional(),
    })
        .optional(),
});
const flowDefinitionSchema = z.object({
    nodes: z.array(flowNodeSchema),
    edges: z.array(flowEdgeSchema),
    startNodeId: z.string(),
});
const flowTriggerTypeSchema = z.enum([
    'customer_joined_list',
    'abandoned_cart',
    'order_placed',
    'order_fulfilled',
    'subscription_started',
    'subscription_cancelled',
    'custom_event',
]);
const flowStatusSchema = z.enum(['active', 'paused', 'disabled', 'archived']);
const flowOutputSchema = z.object({
    id: z.string(),
    createdBy: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    triggerType: z.string(),
    triggerConfig: z.unknown().nullable(),
    definition: z.unknown(),
    status: z.string(),
    allowReenrollment: z.boolean(),
    reenrollmentWaitDays: z.number().nullable(),
    maxEnrollments: z.number().nullable(),
    originalPrompt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
function validateFlowDefinition(definition) {
    const { nodes, edges, startNodeId } = definition;
    const startNode = nodes.find((n) => n.id === startNodeId);
    if (!startNode) {
        throw createHttpError(400, 'startNodeId does not match any node');
    }
    for (const edge of edges) {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        const targetNode = nodes.find((n) => n.id === edge.target);
        if (!sourceNode) {
            throw createHttpError(400, `Edge ${edge.id} references invalid 'source' node: ${edge.source}`);
        }
        if (!targetNode) {
            throw createHttpError(400, `Edge ${edge.id} references invalid 'target' node: ${edge.target}`);
        }
    }
    for (const node of nodes) {
        const config = node.data?.config ?? {};
        switch (node.type) {
            case 'trigger':
                break;
            case 'send_email':
                if (!config.subject || !config.body) {
                    throw createHttpError(400, `Email node ${node.id} requires subject and body`);
                }
                break;
            case 'send_sms':
                if (!config.body) {
                    throw createHttpError(400, `SMS node ${node.id} requires body`);
                }
                break;
            case 'send_whatsapp':
                if (!config.body) {
                    throw createHttpError(400, `WhatsApp node ${node.id} requires body`);
                }
                break;
            case 'send_push':
                if (!config.body) {
                    throw createHttpError(400, `Push node ${node.id} requires body`);
                }
                break;
            case 'send_rcs':
                if (!config.body) {
                    throw createHttpError(400, `RCS node ${node.id} requires body`);
                }
                break;
            case 'wait':
                if (typeof config.delay !== 'number' || config.delay <= 0) {
                    throw createHttpError(400, `Wait node ${node.id} requires positive delay in seconds`);
                }
                break;
            case 'conditional_split':
                if (!Array.isArray(config.conditions) || config.conditions.length === 0) {
                    throw createHttpError(400, `Conditional split node ${node.id} requires conditions array`);
                }
                break;
            case 'exit_flow':
                break;
        }
    }
}
export const createFlowEndpoint = managerFactory.build({
    method: 'post',
    shortDescription: 'Create Flow',
    description: 'Creates a new event-driven flow automation.',
    tag: 'Flows',
    input: z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        triggerType: flowTriggerTypeSchema,
        triggerConfig: z.record(z.string(), z.unknown()).optional(),
        definition: flowDefinitionSchema,
        allowReenrollment: z.boolean().default(false),
        reenrollmentWaitDays: z.number().min(1).optional(),
        maxEnrollments: z.number().min(1).optional(),
    }),
    output: z.object({
        message: z.string(),
        flow: flowOutputSchema,
    }),
    handler: async ({ input, ctx }) => {
        const userId = ctx.user.sub;
        validateFlowDefinition(input.definition);
        const flow = await prisma.flow.create({
            data: {
                createdBy: userId,
                name: input.name,
                description: input.description || null,
                triggerType: input.triggerType,
                triggerConfig: input.triggerConfig ? JSON.parse(JSON.stringify(input.triggerConfig)) : null,
                definition: JSON.parse(JSON.stringify(input.definition)),
                status: 'paused',
                allowReenrollment: input.allowReenrollment,
                reenrollmentWaitDays: input.reenrollmentWaitDays || null,
                maxEnrollments: input.maxEnrollments || null,
            },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: 'flow_created',
            resourceType: 'flow',
            resourceId: flow.id,
            metadata: { name: flow.name, triggerType: flow.triggerType },
            context: auditContext,
        });
        return {
            message: 'Flow created successfully. Activate to start enrolling customers.',
            flow: {
                ...flow,
                triggerConfig: flow.triggerConfig,
                definition: flow.definition,
                createdAt: flow.createdAt.toISOString(),
                updatedAt: flow.updatedAt.toISOString(),
            },
        };
    },
});
export const listFlowsEndpoint = staffFactory.build({
    method: 'get',
    shortDescription: 'List Flows',
    description: 'Returns a list of all flows.',
    tag: 'Flows',
    input: z.object({
        status: flowStatusSchema.optional(),
        triggerType: flowTriggerTypeSchema.optional(),
    }),
    output: z.object({
        items: z.array(flowOutputSchema),
    }),
    handler: async ({ input }) => {
        const flows = await prisma.flow.findMany({
            where: {
                status: input.status ? input.status : { not: 'archived' },
                ...(input.triggerType && { triggerType: input.triggerType }),
            },
            orderBy: { createdAt: 'desc' },
        });
        return {
            items: flows.map((f) => ({
                ...f,
                triggerConfig: f.triggerConfig,
                definition: f.definition,
                createdAt: f.createdAt.toISOString(),
                updatedAt: f.updatedAt.toISOString(),
            })),
        };
    },
});
export const getFlowEndpoint = staffFactory.build({
    method: 'get',
    shortDescription: 'Get Flow',
    description: 'Returns details of a specific flow by ID.',
    tag: 'Flows',
    input: z.object({
        flowId: objectIdSchema,
    }),
    output: flowOutputSchema.extend({
        enrollmentCount: z.number(),
        activeEnrollmentCount: z.number(),
        completedEnrollmentCount: z.number(),
    }),
    handler: async ({ input }) => {
        const flow = await prisma.flow.findUnique({
            where: { id: input.flowId },
        });
        if (!flow) {
            throw createHttpError(404, 'Flow not found');
        }
        const [enrollmentCount, activeCount, completedCount] = await Promise.all([
            prisma.flowEnrollment.count({ where: { flowId: flow.id } }),
            prisma.flowEnrollment.count({ where: { flowId: flow.id, status: 'active' } }),
            prisma.flowEnrollment.count({ where: { flowId: flow.id, status: 'completed' } }),
        ]);
        return {
            ...flow,
            triggerConfig: flow.triggerConfig,
            definition: flow.definition,
            createdAt: flow.createdAt.toISOString(),
            updatedAt: flow.updatedAt.toISOString(),
            enrollmentCount,
            activeEnrollmentCount: activeCount,
            completedEnrollmentCount: completedCount,
        };
    },
});
export const updateFlowEndpoint = managerFactory.build({
    method: 'patch',
    shortDescription: 'Update Flow',
    description: 'Updates an existing flow definition.',
    tag: 'Flows',
    input: z.object({
        flowId: objectIdSchema,
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        definition: flowDefinitionSchema.optional(),
        allowReenrollment: z.boolean().optional(),
        reenrollmentWaitDays: z.number().min(1).nullable().optional(),
        maxEnrollments: z.number().min(1).nullable().optional(),
    }),
    output: z.object({
        flow: flowOutputSchema,
    }),
    handler: async ({ input, ctx }) => {
        const existingFlow = await prisma.flow.findUnique({
            where: { id: input.flowId },
        });
        if (!existingFlow) {
            throw createHttpError(404, 'Flow not found');
        }
        if (input.definition) {
            validateFlowDefinition(input.definition);
        }
        const flow = await prisma.flow.update({
            where: { id: input.flowId },
            data: {
                ...(input.name && { name: input.name }),
                ...(input.description !== undefined && { description: input.description }),
                ...(input.definition && { definition: JSON.parse(JSON.stringify(input.definition)) }),
                ...(input.allowReenrollment !== undefined && {
                    allowReenrollment: input.allowReenrollment,
                }),
                ...(input.reenrollmentWaitDays !== undefined && {
                    reenrollmentWaitDays: input.reenrollmentWaitDays,
                }),
                ...(input.maxEnrollments !== undefined && { maxEnrollments: input.maxEnrollments }),
            },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: 'flow_updated',
            resourceType: 'flow',
            resourceId: input.flowId,
            metadata: { name: flow.name },
            context: auditContext,
        });
        return {
            flow: {
                ...flow,
                triggerConfig: flow.triggerConfig,
                definition: flow.definition,
                createdAt: flow.createdAt.toISOString(),
                updatedAt: flow.updatedAt.toISOString(),
            },
        };
    },
});
export const pauseFlowEndpoint = managerFactory.build({
    method: 'post',
    shortDescription: 'Pause Flow',
    description: 'Pauses a flow, stopping new enrollments.',
    tag: 'Flows',
    input: z.object({
        flowId: objectIdSchema,
    }),
    output: z.object({
        success: z.boolean(),
        status: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const flow = await prisma.flow.findUnique({
            where: { id: input.flowId },
        });
        if (!flow) {
            throw createHttpError(404, 'Flow not found');
        }
        if (flow.status === 'archived') {
            throw createHttpError(400, 'Cannot pause an archived flow');
        }
        await prisma.flow.update({
            where: { id: input.flowId },
            data: { status: 'paused' },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: 'flow_paused',
            resourceType: 'flow',
            resourceId: input.flowId,
            metadata: {},
            context: auditContext,
        });
        return { success: true, status: 'paused' };
    },
});
export const resumeFlowEndpoint = managerFactory.build({
    method: 'post',
    shortDescription: 'Resume Flow',
    description: 'Resumes a paused flow, allowing new enrollments.',
    tag: 'Flows',
    input: z.object({
        flowId: objectIdSchema,
    }),
    output: z.object({
        success: z.boolean(),
        status: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const flow = await prisma.flow.findUnique({
            where: { id: input.flowId },
        });
        if (!flow) {
            throw createHttpError(404, 'Flow not found');
        }
        if (flow.status === 'archived') {
            throw createHttpError(400, 'Cannot resume an archived flow');
        }
        await prisma.flow.update({
            where: { id: input.flowId },
            data: { status: 'active' },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: 'flow_resumed',
            resourceType: 'flow',
            resourceId: input.flowId,
            metadata: {},
            context: auditContext,
        });
        return { success: true, status: 'active' };
    },
});
export const deleteFlowEndpoint = createAuthRoleFactory('admin').build({
    method: 'delete',
    shortDescription: 'Delete Flow',
    description: 'Archives a flow and exits all active enrollments.',
    tag: 'Flows',
    input: z.object({
        flowId: objectIdSchema,
    }),
    output: z.object({
        success: z.boolean(),
        exitedEnrollments: z.number(),
    }),
    handler: async ({ input, ctx }) => {
        const flow = await prisma.flow.findUnique({
            where: { id: input.flowId },
        });
        if (!flow) {
            throw createHttpError(404, 'Flow not found');
        }
        await prisma.flow.update({
            where: { id: input.flowId },
            data: { status: 'archived' },
        });
        const result = await prisma.flowEnrollment.updateMany({
            where: { flowId: input.flowId, status: 'active' },
            data: { status: 'exited', exitedAt: new Date() },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: 'flow_archived',
            resourceType: 'flow',
            resourceId: input.flowId,
            metadata: { exitedEnrollments: result.count },
            context: auditContext,
        });
        return { success: true, exitedEnrollments: result.count };
    },
});
export const getFlowEnrollmentsEndpoint = staffFactory.build({
    method: 'get',
    shortDescription: 'Get Flow Enrollments',
    description: 'Returns enrollments for a specific flow.',
    tag: 'Flows',
    input: z.object({
        flowId: objectIdSchema,
        status: z.enum(['active', 'completed', 'exited', 'failed', 'paused']).optional(),
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
            customerId: z.string(),
            customerEmail: z.string().nullable(),
            customerName: z.string().nullable(),
            status: z.string(),
            currentStepId: z.string().nullable(),
            enrolledAt: z.string(),
            completedAt: z.string().nullable(),
            stepsCompleted: z.number(),
            stepsFailed: z.number(),
        })),
        total: z.number(),
        page: z.number(),
        pageSize: z.number(),
        hasMore: z.boolean(),
    }),
    handler: async ({ input }) => {
        const { flowId, status, page, pageSize } = input;
        const skip = (page - 1) * pageSize;
        const where = {
            flowId,
            ...(status && { status }),
        };
        const [enrollments, total] = await Promise.all([
            prisma.flowEnrollment.findMany({
                where,
                include: {
                    customer: {
                        select: { email: true, name: true },
                    },
                },
                skip,
                take: pageSize + 1,
                orderBy: { enrolledAt: 'desc' },
            }),
            prisma.flowEnrollment.count({ where }),
        ]);
        const hasMore = enrollments.length > pageSize;
        if (hasMore)
            enrollments.pop();
        return {
            items: enrollments.map((e) => ({
                id: e.id,
                customerId: e.customerId,
                customerEmail: e.customer?.email || null,
                customerName: e.customer?.name || null,
                status: e.status,
                currentStepId: e.currentStepId,
                enrolledAt: e.enrolledAt.toISOString(),
                completedAt: e.completedAt?.toISOString() || null,
                stepsCompleted: e.stepsCompleted,
                stepsFailed: e.stepsFailed,
            })),
            total,
            page,
            pageSize,
            hasMore,
        };
    },
});
export const getFlowAnalyticsEndpoint = managerFactory.build({
    method: 'get',
    shortDescription: 'Get Flow Analytics',
    description: 'Returns analytics for a flow.',
    tag: 'Flows',
    input: z.object({
        flowId: objectIdSchema,
        period: z.enum(['7d', '14d', '30d', '90d']).default('30d'),
    }),
    output: z.object({
        metrics: z.object({
            totalEnrollments: z.number(),
            activeEnrollments: z.number(),
            completedEnrollments: z.number(),
            exitedEnrollments: z.number(),
            failedEnrollments: z.number(),
            completionRate: z.number(),
            avgStepsCompleted: z.number(),
            avgTimeToCompleteSeconds: z.number(),
        }),
    }),
    handler: async ({ input }) => {
        const { flowId, period } = input;
        const periodDays = { '7d': 7, '14d': 14, '30d': 30, '90d': 90 }[period];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - periodDays);
        const enrollments = await prisma.flowEnrollment.findMany({
            where: {
                flowId,
                enrolledAt: { gte: startDate },
            },
        });
        const totalEnrollments = enrollments.length;
        const activeEnrollments = enrollments.filter((e) => e.status === 'active').length;
        const completedEnrollments = enrollments.filter((e) => e.status === 'completed').length;
        const exitedEnrollments = enrollments.filter((e) => e.status === 'exited').length;
        const failedEnrollments = enrollments.filter((e) => e.status === 'failed').length;
        const completionRate = totalEnrollments > 0 ? completedEnrollments / totalEnrollments : 0;
        const avgStepsCompleted = totalEnrollments > 0
            ? enrollments.reduce((sum, e) => sum + e.stepsCompleted, 0) / totalEnrollments
            : 0;
        const completedWithTime = enrollments.filter((e) => e.status === 'completed' && e.completedAt);
        const avgTimeToCompleteSeconds = completedWithTime.length > 0
            ? completedWithTime.reduce((sum, e) => {
                const duration = e.completedAt.getTime() - e.enrolledAt.getTime();
                return sum + duration / 1000;
            }, 0) / completedWithTime.length
            : 0;
        return {
            metrics: {
                totalEnrollments,
                activeEnrollments,
                completedEnrollments,
                exitedEnrollments,
                failedEnrollments,
                completionRate,
                avgStepsCompleted,
                avgTimeToCompleteSeconds,
            },
        };
    },
});
const flowTemplateSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    category: z.enum(['acquisition', 'retention', 'engagement', 'reactivation']),
    triggerType: z.string(),
    triggerDescription: z.string(),
    estimatedDuration: z.string(),
    definition: z.unknown(),
    previewSteps: z.array(z.string()),
});
export const listFlowTemplatesEndpoint = staffFactory.build({
    method: 'get',
    shortDescription: 'List Flow Templates',
    description: 'Returns all available flow templates that can be used to create flows.',
    tag: 'Flows',
    input: z.object({
        category: z.enum(['acquisition', 'retention', 'engagement', 'reactivation']).optional(),
    }),
    output: z.object({
        items: z.array(flowTemplateSchema),
    }),
    handler: async ({ input }) => {
        let templates = getFlowTemplates();
        if (input.category) {
            templates = templates.filter((t) => t.category === input.category);
        }
        return {
            items: templates.map((t) => ({
                id: t.id,
                name: t.name,
                description: t.description,
                category: t.category,
                triggerType: t.triggerType,
                triggerDescription: t.triggerDescription,
                estimatedDuration: t.estimatedDuration,
                definition: t.definition,
                previewSteps: t.previewSteps,
            })),
        };
    },
});
export const getFlowTemplateEndpoint = staffFactory.build({
    method: 'get',
    shortDescription: 'Get Flow Template',
    description: 'Returns a specific flow template by ID.',
    tag: 'Flows',
    input: z.object({
        templateId: z.string(),
    }),
    output: flowTemplateSchema,
    handler: async ({ input }) => {
        const template = getFlowTemplateById(input.templateId);
        if (!template) {
            throw createHttpError(404, 'Flow template not found');
        }
        return {
            id: template.id,
            name: template.name,
            description: template.description,
            category: template.category,
            triggerType: template.triggerType,
            triggerDescription: template.triggerDescription,
            estimatedDuration: template.estimatedDuration,
            definition: template.definition,
            previewSteps: template.previewSteps,
        };
    },
});
export const createFlowFromTemplateEndpoint = managerFactory.build({
    method: 'post',
    shortDescription: 'Create Flow from Template',
    description: 'Creates a new flow based on a template.',
    tag: 'Flows',
    input: z.object({
        templateId: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
    }),
    output: z.object({
        message: z.string(),
        flow: flowOutputSchema,
    }),
    handler: async ({ input, ctx }) => {
        const userId = ctx.user.sub;
        const template = getFlowTemplateById(input.templateId);
        if (!template) {
            throw createHttpError(404, 'Flow template not found');
        }
        const flowName = input.name || `${template.name} (Copy)`;
        const flowDescription = input.description || template.description;
        const idempotencyKey = `template:${template.id}:${userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        const flow = await prisma.flow.create({
            data: {
                createdBy: userId,
                name: flowName,
                description: flowDescription,
                triggerType: template.triggerType,
                definition: JSON.parse(JSON.stringify(template.definition)),
                status: 'paused',
                allowReenrollment: false,
                idempotencyKey,
            },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: 'flow_created',
            resourceType: 'flow',
            resourceId: flow.id,
            metadata: {
                name: flow.name,
                triggerType: flow.triggerType,
                fromTemplate: template.id,
            },
            context: auditContext,
        });
        return {
            message: `Flow created from template "${template.name}". Activate to start enrolling customers.`,
            flow: {
                ...flow,
                triggerConfig: flow.triggerConfig,
                definition: flow.definition,
                createdAt: flow.createdAt.toISOString(),
                updatedAt: flow.updatedAt.toISOString(),
            },
        };
    },
});
export const parseFlowNLEndpoint = managerFactory.build({
    method: 'post',
    shortDescription: 'Parse Natural Language Flow',
    description: 'Parses a natural language description into a flow DSL without creating a flow.',
    tag: 'Flows',
    input: z.object({
        prompt: z.string().min(10).max(2000),
    }),
    output: z.object({
        success: z.boolean(),
        useTemplate: z.boolean().optional(),
        templateId: z.string().optional(),
        template: flowTemplateSchema.optional(),
        dsl: z.unknown().optional(),
        error: z.string().optional(),
        rejected: z.boolean().optional(),
        rejectionReason: z.string().optional(),
        rejectionCategory: z.string().optional(),
    }),
    handler: async ({ input }) => {
        const result = await parseNaturalLanguageToFlowDSL(input.prompt);
        if (!result.success) {
            return {
                success: false,
                error: result.error,
                rejected: result.rejected,
                rejectionReason: result.rejectionReason,
                rejectionCategory: result.rejectionCategory,
            };
        }
        if (result.useTemplate && result.templateId) {
            const template = getFlowTemplateById(result.templateId);
            return {
                success: true,
                useTemplate: true,
                templateId: result.templateId,
                template: template
                    ? {
                        id: template.id,
                        name: template.name,
                        description: template.description,
                        category: template.category,
                        triggerType: template.triggerType,
                        triggerDescription: template.triggerDescription,
                        estimatedDuration: template.estimatedDuration,
                        definition: template.definition,
                        previewSteps: template.previewSteps,
                    }
                    : undefined,
            };
        }
        return {
            success: true,
            useTemplate: false,
            dsl: result.dsl,
        };
    },
});
export const createFlowFromNLEndpoint = managerFactory.build({
    method: 'post',
    shortDescription: 'Create Flow from Natural Language',
    description: 'Creates a new flow from a natural language description. May recommend a template instead.',
    tag: 'Flows',
    input: z.object({
        prompt: z.string().min(10).max(2000),
        name: z.string().min(1).max(100).optional(),
    }),
    output: z.object({
        success: z.boolean(),
        message: z.string(),
        flow: flowOutputSchema.optional(),
        useTemplate: z.boolean().optional(),
        templateId: z.string().optional(),
        template: flowTemplateSchema.optional(),
        error: z.string().optional(),
        rejected: z.boolean().optional(),
        rejectionReason: z.string().optional(),
    }),
    handler: async ({ input, ctx }) => {
        const userId = ctx.user.sub;
        const result = await parseNaturalLanguageToFlowDSL(input.prompt);
        if (!result.success) {
            return {
                success: false,
                message: result.error || 'Failed to parse prompt',
                error: result.error,
                rejected: result.rejected,
                rejectionReason: result.rejectionReason,
            };
        }
        if (result.useTemplate && result.templateId) {
            const template = getFlowTemplateById(result.templateId);
            return {
                success: true,
                message: `We recommend using the "${template?.name || result.templateId}" template for this flow. Use the "Create Flow from Template" endpoint to create it.`,
                useTemplate: true,
                templateId: result.templateId,
                template: template
                    ? {
                        id: template.id,
                        name: template.name,
                        description: template.description,
                        category: template.category,
                        triggerType: template.triggerType,
                        triggerDescription: template.triggerDescription,
                        estimatedDuration: template.estimatedDuration,
                        definition: template.definition,
                        previewSteps: template.previewSteps,
                    }
                    : undefined,
            };
        }
        const dsl = result.dsl;
        const flow = await prisma.flow.create({
            data: {
                createdBy: userId,
                name: input.name || dsl.name,
                description: dsl.description,
                triggerType: dsl.triggerType,
                triggerConfig: dsl.triggerConfig ? JSON.parse(JSON.stringify(dsl.triggerConfig)) : null,
                definition: JSON.parse(JSON.stringify(dsl.definition)),
                status: 'paused',
                allowReenrollment: dsl.allowReenrollment,
                reenrollmentWaitDays: dsl.reenrollmentWaitDays,
                originalPrompt: input.prompt,
                parsedDsl: JSON.parse(JSON.stringify(dsl)),
            },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: 'flow_created',
            resourceType: 'flow',
            resourceId: flow.id,
            metadata: {
                name: flow.name,
                triggerType: flow.triggerType,
                fromNaturalLanguage: true,
            },
            context: auditContext,
        });
        return {
            success: true,
            message: 'Flow created from natural language. Activate to start enrolling customers.',
            flow: {
                ...flow,
                triggerConfig: flow.triggerConfig,
                definition: flow.definition,
                createdAt: flow.createdAt.toISOString(),
                updatedAt: flow.updatedAt.toISOString(),
            },
        };
    },
});
const attributionModelSchema = z.enum(['last_touch', 'first_touch', 'linear']);
export const getFlowRevenueEndpoint = staffFactory.build({
    method: 'get',
    shortDescription: 'Get Flow Revenue',
    description: 'Returns revenue attributed to a specific flow based on attribution settings.',
    tag: 'Flows',
    input: z.object({
        flowId: objectIdSchema,
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        attributionWindow: z.coerce
            .number()
            .refine((v) => v === 7 || v === 30)
            .optional(),
        attributionModel: attributionModelSchema.optional(),
    }),
    output: z.object({
        flowId: z.string(),
        flowName: z.string(),
        totalRevenue: z.number(),
        totalOrders: z.number(),
        averageOrderValue: z.number(),
        attributionWindow: z.string(),
        attributionModel: z.string(),
        conversionRate: z.number(),
        revenuePerEnrollment: z.number(),
        totalEnrollments: z.number(),
    }),
    handler: async ({ input }) => {
        const flow = await prisma.flow.findUnique({
            where: { id: input.flowId },
        });
        if (!flow) {
            throw createHttpError(404, 'Flow not found');
        }
        const totalEnrollments = await prisma.flowEnrollment.count({
            where: { flowId: input.flowId },
        });
        const config = {};
        if (input.attributionWindow)
            config.windowDays = input.attributionWindow;
        if (input.attributionModel)
            config.model = input.attributionModel;
        const startDate = input.startDate ? new Date(input.startDate) : undefined;
        const endDate = input.endDate ? new Date(input.endDate) : undefined;
        const revenue = await calculateFlowRevenue(input.flowId, config, startDate, endDate);
        const conversionRate = totalEnrollments > 0 ? revenue.totalOrders / totalEnrollments : 0;
        const revenuePerEnrollment = totalEnrollments > 0 ? revenue.totalRevenue / totalEnrollments : 0;
        return {
            flowId: input.flowId,
            flowName: flow.name,
            totalRevenue: revenue.totalRevenue,
            totalOrders: revenue.totalOrders,
            averageOrderValue: revenue.averageOrderValue,
            attributionWindow: revenue.attributionWindow,
            attributionModel: revenue.attributionModel,
            conversionRate,
            revenuePerEnrollment,
            totalEnrollments,
        };
    },
});
