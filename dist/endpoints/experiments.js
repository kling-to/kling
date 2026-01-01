import { z } from 'zod';
import { authFactory, createAuthRoleFactory } from '../factories';
import prisma from '../utils/prisma';
import createHttpError from 'http-errors';
import crypto from 'crypto';
import { objectIdSchema } from '../utils/validation';
import { createAuditLog, extractAuditContext } from '../utils/audit';
const adminFactory = createAuthRoleFactory('admin', 'manager');
const conversionGoalEnum = z.enum(['order_placed', 'link_clicked', 'code_redeemed']);
const experimentSchema = z.object({
    id: z.string(),
    campaignId: objectIdSchema,
    name: z.string(),
    description: z.string().nullable(),
    controlPercent: z.number(),
    treatmentPercent: z.number(),
    treatmentSubject: z.string().nullable(),
    treatmentBody: z.string().nullable(),
    treatmentHtml: z.string().nullable(),
    conversionGoal: z.string().nullable(),
    conversionWindowDays: z.number().nullable(),
    status: z.string(),
    startedAt: z.date().nullable(),
    endedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});
export const createExperimentEndpoint = adminFactory.build({
    method: 'post',
    shortDescription: 'Create Experiment',
    description: 'Creates a new A/B experiment for a campaign.',
    tag: 'Experiments',
    input: z.object({
        campaignId: objectIdSchema,
        name: z.string(),
        description: z.string().optional(),
        controlPercent: z.number().min(0).max(100).default(50),
        treatmentPercent: z.number().min(0).max(100).default(50),
        treatmentSubject: z.string().optional(),
        treatmentBody: z.string().optional(),
        treatmentHtml: z.string().optional(),
        conversionGoal: conversionGoalEnum.optional(),
        conversionWindowDays: z.number().min(1).max(90).default(7),
    }),
    output: experimentSchema,
    handler: async ({ input, ctx }) => {
        const campaign = await prisma.campaignDefinition.findUnique({
            where: { id: input.campaignId },
        });
        if (!campaign) {
            throw createHttpError(404, 'Campaign not found');
        }
        if (input.controlPercent + input.treatmentPercent !== 100) {
            throw createHttpError(400, 'Control and treatment percentages must add up to 100');
        }
        const hasTreatmentVariant = input.treatmentSubject || input.treatmentBody || input.treatmentHtml;
        if (!hasTreatmentVariant) {
            throw createHttpError(400, 'At least one treatment variant must be provided (treatmentSubject, treatmentBody, or treatmentHtml)');
        }
        const existingExperiment = await prisma.experiment.findFirst({
            where: {
                campaignId: input.campaignId,
                status: { in: ['running', 'draft'] },
            },
        });
        if (existingExperiment) {
            throw createHttpError(400, 'An active experiment already exists for this campaign');
        }
        const experiment = await prisma.experiment.create({
            data: {
                campaignId: input.campaignId,
                name: input.name,
                description: input.description,
                controlPercent: input.controlPercent,
                treatmentPercent: input.treatmentPercent,
                treatmentSubject: input.treatmentSubject,
                treatmentBody: input.treatmentBody,
                treatmentHtml: input.treatmentHtml,
                conversionGoal: input.conversionGoal,
                conversionWindowDays: input.conversionWindowDays,
                status: 'draft',
            },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: 'experiment_created',
            resourceType: 'experiment',
            resourceId: experiment.id,
            metadata: { name: experiment.name, campaignId: input.campaignId },
            context: auditContext,
        });
        return experiment;
    },
});
export const listExperimentsEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'List Experiments',
    description: 'Returns a list of A/B experiments.',
    tag: 'Experiments',
    input: z.object({
        page: z.coerce.number().min(1).default(1),
        pageSize: z.coerce.number().min(1).max(100).default(50),
        campaignId: z.string().optional(),
        status: z.string().optional(),
    }),
    output: z.object({
        items: z.array(experimentSchema.extend({
            campaign: z.object({ id: z.string(), name: z.string() }).nullable(),
            metrics: z
                .object({
                controlSent: z.number(),
                treatmentSent: z.number(),
                controlConversions: z.number(),
                treatmentConversions: z.number(),
            })
                .optional(),
        })),
        total: z.number(),
        page: z.number(),
        pageSize: z.number(),
        hasMore: z.boolean(),
    }),
    handler: async ({ input }) => {
        const { page, pageSize, campaignId, status } = input;
        const skip = (page - 1) * pageSize;
        const where = {};
        if (campaignId)
            where.campaignId = campaignId;
        if (status)
            where.status = status;
        const [experiments, total] = await Promise.all([
            prisma.experiment.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: { createdAt: 'desc' },
                include: {
                    campaign: { select: { id: true, name: true } },
                },
            }),
            prisma.experiment.count({ where }),
        ]);
        const itemsWithMetrics = await Promise.all(experiments.map(async (exp) => {
            const [controlSent, treatmentSent, controlConversions, treatmentConversions] = await Promise.all([
                prisma.experimentAssignment.count({
                    where: { experimentId: exp.id, cohort: 'control' },
                }),
                prisma.experimentAssignment.count({
                    where: { experimentId: exp.id, cohort: 'treatment' },
                }),
                prisma.experimentAssignment.count({
                    where: { experimentId: exp.id, cohort: 'control', converted: true },
                }),
                prisma.experimentAssignment.count({
                    where: { experimentId: exp.id, cohort: 'treatment', converted: true },
                }),
            ]);
            return {
                ...exp,
                metrics: { controlSent, treatmentSent, controlConversions, treatmentConversions },
            };
        }));
        return {
            items: itemsWithMetrics,
            total,
            page,
            pageSize,
            hasMore: skip + experiments.length < total,
        };
    },
});
export const getExperimentEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'Get Experiment',
    description: 'Returns details of a specific experiment with full metrics.',
    tag: 'Experiments',
    input: z.object({
        experimentId: objectIdSchema,
    }),
    output: experimentSchema.extend({
        campaign: z.object({ id: z.string(), name: z.string() }).nullable(),
        metrics: z.object({
            controlSent: z.number(),
            treatmentSent: z.number(),
            controlConversions: z.number(),
            treatmentConversions: z.number(),
            controlConversionRate: z.number(),
            treatmentConversionRate: z.number(),
            uplift: z.number().nullable(),
        }),
    }),
    handler: async ({ input }) => {
        const experiment = await prisma.experiment.findUnique({
            where: {
                id: input.experimentId,
            },
            include: {
                campaign: { select: { id: true, name: true } },
            },
        });
        if (!experiment) {
            throw createHttpError(404, 'Experiment not found');
        }
        const [controlSent, treatmentSent, controlConversions, treatmentConversions] = await Promise.all([
            prisma.experimentAssignment.count({
                where: { experimentId: experiment.id, cohort: 'control' },
            }),
            prisma.experimentAssignment.count({
                where: { experimentId: experiment.id, cohort: 'treatment' },
            }),
            prisma.experimentAssignment.count({
                where: { experimentId: experiment.id, cohort: 'control', converted: true },
            }),
            prisma.experimentAssignment.count({
                where: { experimentId: experiment.id, cohort: 'treatment', converted: true },
            }),
        ]);
        const controlConversionRate = controlSent > 0 ? controlConversions / controlSent : 0;
        const treatmentConversionRate = treatmentSent > 0 ? treatmentConversions / treatmentSent : 0;
        const uplift = controlConversionRate > 0
            ? ((treatmentConversionRate - controlConversionRate) / controlConversionRate) * 100
            : null;
        return {
            ...experiment,
            metrics: {
                controlSent,
                treatmentSent,
                controlConversions,
                treatmentConversions,
                controlConversionRate: Math.round(controlConversionRate * 10000) / 100,
                treatmentConversionRate: Math.round(treatmentConversionRate * 10000) / 100,
                uplift: uplift !== null ? Math.round(uplift * 100) / 100 : null,
            },
        };
    },
});
export const startExperimentEndpoint = adminFactory.build({
    method: 'post',
    shortDescription: 'Start Experiment',
    description: 'Starts a draft experiment.',
    tag: 'Experiments',
    input: z.object({
        experimentId: objectIdSchema,
    }),
    output: z.object({
        success: z.boolean(),
        status: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const experiment = await prisma.experiment.findUnique({
            where: {
                id: input.experimentId,
            },
        });
        if (!experiment) {
            throw createHttpError(404, 'Experiment not found');
        }
        if (experiment.status !== 'draft' && experiment.status !== 'paused') {
            throw createHttpError(400, 'Can only start draft or paused experiments');
        }
        await prisma.experiment.update({
            where: { id: experiment.id },
            data: {
                status: 'running',
                startedAt: experiment.startedAt || new Date(),
            },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: 'experiment_started',
            resourceType: 'experiment',
            resourceId: experiment.id,
            metadata: { name: experiment.name, campaignId: experiment.campaignId },
            context: auditContext,
        });
        return { success: true, status: 'running' };
    },
});
export const stopExperimentEndpoint = adminFactory.build({
    method: 'post',
    shortDescription: 'Stop Experiment',
    description: 'Stops a running experiment.',
    tag: 'Experiments',
    input: z.object({
        experimentId: objectIdSchema,
        action: z.enum(['pause', 'complete']).default('complete'),
    }),
    output: z.object({
        success: z.boolean(),
        status: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const experiment = await prisma.experiment.findUnique({
            where: {
                id: input.experimentId,
            },
        });
        if (!experiment) {
            throw createHttpError(404, 'Experiment not found');
        }
        if (experiment.status !== 'running') {
            throw createHttpError(400, 'Can only stop running experiments');
        }
        const newStatus = input.action === 'pause' ? 'paused' : 'completed';
        await prisma.experiment.update({
            where: { id: experiment.id },
            data: {
                status: newStatus,
                endedAt: input.action === 'complete' ? new Date() : undefined,
            },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: 'experiment_stopped',
            resourceType: 'experiment',
            resourceId: experiment.id,
            metadata: { name: experiment.name, action: input.action, newStatus },
            context: auditContext,
        });
        return { success: true, status: newStatus };
    },
});
export const assignCohortEndpoint = authFactory.build({
    method: 'post',
    shortDescription: 'Assign Cohort',
    description: 'Assigns a customer to an experiment cohort deterministically.',
    tag: 'Experiments',
    input: z.object({
        experimentId: objectIdSchema,
        customerId: objectIdSchema,
    }),
    output: z.object({
        cohort: z.enum(['control', 'treatment']),
        assignmentId: z.string(),
        isNew: z.boolean(),
    }),
    handler: async ({ input }) => {
        const experiment = await prisma.experiment.findFirst({
            where: {
                id: input.experimentId,
                status: 'running',
            },
        });
        if (!experiment) {
            throw createHttpError(404, 'Experiment not found or not running');
        }
        const existingAssignment = await prisma.experimentAssignment.findFirst({
            where: {
                experimentId: experiment.id,
                customerId: input.customerId,
            },
        });
        if (existingAssignment) {
            return {
                cohort: existingAssignment.cohort,
                assignmentId: existingAssignment.id,
                isNew: false,
            };
        }
        const hash = crypto
            .createHash('sha256')
            .update(`${experiment.id}:${input.customerId}`)
            .digest('hex');
        const hashValue = parseInt(hash.substring(0, 8), 16);
        const percentage = (hashValue / 0xffffffff) * 100;
        const cohort = percentage < experiment.controlPercent ? 'control' : 'treatment';
        const assignment = await prisma.experimentAssignment.create({
            data: {
                experimentId: experiment.id,
                customerId: input.customerId,
                cohort,
            },
        });
        return {
            cohort,
            assignmentId: assignment.id,
            isNew: true,
        };
    },
});
export const deleteExperimentEndpoint = adminFactory.build({
    method: 'delete',
    shortDescription: 'Delete Experiment',
    description: 'Deletes an experiment and all its assignments. Only draft or completed experiments can be deleted.',
    tag: 'Experiments',
    input: z.object({
        experimentId: objectIdSchema,
    }),
    output: z.object({
        success: z.boolean(),
        message: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const experiment = await prisma.experiment.findUnique({
            where: { id: input.experimentId },
        });
        if (!experiment) {
            throw createHttpError(404, 'Experiment not found');
        }
        if (experiment.status === 'running') {
            throw createHttpError(400, 'Cannot delete a running experiment. Stop it first.');
        }
        await prisma.experimentAssignment.deleteMany({
            where: { experimentId: input.experimentId },
        });
        await prisma.experiment.delete({
            where: { id: input.experimentId },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: 'experiment_deleted',
            resourceType: 'experiment',
            resourceId: input.experimentId,
            metadata: { name: experiment.name, campaignId: experiment.campaignId },
            context: auditContext,
        });
        return {
            success: true,
            message: 'Experiment and all assignments deleted successfully',
        };
    },
});
export const recordConversionEndpoint = authFactory.build({
    method: 'post',
    shortDescription: 'Record Conversion',
    description: 'Records a conversion for an experiment assignment.',
    tag: 'Experiments',
    input: z.object({
        experimentId: objectIdSchema,
        customerId: objectIdSchema,
        conversionValue: z.number().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    }),
    output: z.object({
        success: z.boolean(),
        assignmentId: z.string().nullable(),
    }),
    handler: async ({ input }) => {
        const assignment = await prisma.experimentAssignment.findFirst({
            where: {
                experimentId: input.experimentId,
                customerId: input.customerId,
            },
        });
        if (!assignment) {
            return { success: false, assignmentId: null };
        }
        await prisma.experimentAssignment.update({
            where: { id: assignment.id },
            data: {
                converted: true,
                convertedAt: new Date(),
                conversionValue: input.conversionValue,
            },
        });
        return { success: true, assignmentId: assignment.id };
    },
});
