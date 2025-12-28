/**
 * Message Templates Endpoints
 *
 * CRUD operations for reusable message templates
 */
import { z } from 'zod';
import { authFactory, createAuthRoleFactory } from '../factories';
import prisma from '../utils/prisma';
import createHttpError from 'http-errors';
import { objectIdSchema } from '../utils/validation';
import { renderEmailContent, renderSmsContent, buildTemplateData, } from '../utils/template-renderer';
// Factory for template management (admin and manager can create/edit)
const templateFactory = createAuthRoleFactory('admin', 'manager');
// Email content input schema (for creating/updating)
const emailContentInputSchema = z.object({
    subject: z.string().min(1),
    preheader: z.string().optional(),
    body: z.string().min(1),
    html: z.string().optional(),
    signature: z.string().optional(),
});
// Email content output schema (from Prisma - uses null instead of undefined)
const emailContentOutputSchema = z.object({
    subject: z.string(),
    preheader: z.string().nullable(),
    body: z.string(),
    html: z.string().nullable(),
    signature: z.string().nullable(),
});
// SMS content input schema
const smsContentInputSchema = z.object({
    body: z.string().min(1).max(1600), // Allow up to 10 SMS segments
});
// SMS content output schema
const smsContentOutputSchema = z.object({
    body: z.string(),
});
// Base template schema for output
const templateSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    channel: z.enum(['email', 'sms']),
    email: emailContentOutputSchema.nullable(),
    sms: smsContentOutputSchema.nullable(),
    tags: z.array(z.string()),
    isActive: z.boolean(),
    createdBy: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
});
// ------------------------------------------------------
// List Templates
// ------------------------------------------------------
export const listTemplatesEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'List Templates',
    description: 'Returns a paginated list of message templates.',
    tag: 'Templates',
    input: z.object({
        channel: z.enum(['email', 'sms']).optional(),
        search: z.string().optional(),
        tags: z.string().optional(), // Comma-separated tags
        isActive: z
            .string()
            .optional()
            .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
        page: z.string().optional().default('1'),
        limit: z.string().optional().default('20'),
    }),
    output: z.object({
        templates: z.array(templateSchema),
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
        if (input.channel) {
            where.channel = input.channel;
        }
        if (input.isActive !== undefined) {
            where.isActive = input.isActive;
        }
        if (input.tags) {
            const tagList = input.tags.split(',').map((t) => t.trim());
            where.tags = { hasSome: tagList };
        }
        if (input.search) {
            where.OR = [
                { name: { contains: input.search, mode: 'insensitive' } },
                { description: { contains: input.search, mode: 'insensitive' } },
            ];
        }
        const [templates, total] = await Promise.all([
            prisma.messageTemplate.findMany({
                where,
                skip,
                take: limit,
                orderBy: { updatedAt: 'desc' },
            }),
            prisma.messageTemplate.count({ where }),
        ]);
        return {
            templates: templates.map((t) => ({
                id: t.id,
                name: t.name,
                description: t.description,
                channel: t.channel,
                email: t.email,
                sms: t.sms,
                tags: t.tags,
                isActive: t.isActive,
                createdBy: t.createdBy,
                createdAt: t.createdAt,
                updatedAt: t.updatedAt,
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
// ------------------------------------------------------
// Create Template
// ------------------------------------------------------
export const createTemplateEndpoint = templateFactory.build({
    method: 'post',
    shortDescription: 'Create Template',
    description: 'Creates a new message template.',
    tag: 'Templates',
    input: z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        channel: z.enum(['email', 'sms']),
        email: emailContentInputSchema.optional(),
        sms: smsContentInputSchema.optional(),
        tags: z.array(z.string()).optional().default([]),
    }),
    output: z.object({
        success: z.boolean(),
        template: templateSchema,
    }),
    handler: async ({ input, ctx }) => {
        // Validate channel-specific content
        if (input.channel === 'email' && !input.email) {
            throw createHttpError(400, 'Email content is required for email templates');
        }
        if (input.channel === 'sms' && !input.sms) {
            throw createHttpError(400, 'SMS content is required for SMS templates');
        }
        const template = await prisma.messageTemplate.create({
            data: {
                name: input.name,
                description: input.description,
                channel: input.channel,
                email: input.email,
                sms: input.sms,
                tags: input.tags,
                createdBy: ctx.user.sub,
            },
        });
        return {
            success: true,
            template: {
                id: template.id,
                name: template.name,
                description: template.description,
                channel: template.channel,
                email: template.email,
                sms: template.sms,
                tags: template.tags,
                isActive: template.isActive,
                createdBy: template.createdBy,
                createdAt: template.createdAt,
                updatedAt: template.updatedAt,
            },
        };
    },
});
// ------------------------------------------------------
// Get Template
// ------------------------------------------------------
export const getTemplateEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'Get Template',
    description: 'Returns details of a specific message template.',
    tag: 'Templates',
    input: z.object({
        templateId: objectIdSchema,
    }),
    output: templateSchema,
    handler: async ({ input }) => {
        const template = await prisma.messageTemplate.findUnique({
            where: { id: input.templateId },
        });
        if (!template) {
            throw createHttpError(404, 'Template not found');
        }
        return {
            id: template.id,
            name: template.name,
            description: template.description,
            channel: template.channel,
            email: template.email,
            sms: template.sms,
            tags: template.tags,
            isActive: template.isActive,
            createdBy: template.createdBy,
            createdAt: template.createdAt,
            updatedAt: template.updatedAt,
        };
    },
});
// ------------------------------------------------------
// Update Template
// ------------------------------------------------------
export const updateTemplateEndpoint = templateFactory.build({
    method: 'patch',
    shortDescription: 'Update Template',
    description: 'Updates an existing message template.',
    tag: 'Templates',
    input: z.object({
        templateId: objectIdSchema,
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        email: emailContentInputSchema.optional(),
        sms: smsContentInputSchema.optional(),
        tags: z.array(z.string()).optional(),
        isActive: z.boolean().optional(),
    }),
    output: z.object({
        success: z.boolean(),
        template: templateSchema,
    }),
    handler: async ({ input }) => {
        const { templateId, ...updateData } = input;
        const existing = await prisma.messageTemplate.findUnique({
            where: { id: templateId },
        });
        if (!existing) {
            throw createHttpError(404, 'Template not found');
        }
        // Validate channel-specific content
        if (existing.channel === 'email' && updateData.sms) {
            throw createHttpError(400, 'Cannot add SMS content to an email template');
        }
        if (existing.channel === 'sms' && updateData.email) {
            throw createHttpError(400, 'Cannot add email content to an SMS template');
        }
        const template = await prisma.messageTemplate.update({
            where: { id: templateId },
            data: updateData,
        });
        return {
            success: true,
            template: {
                id: template.id,
                name: template.name,
                description: template.description,
                channel: template.channel,
                email: template.email,
                sms: template.sms,
                tags: template.tags,
                isActive: template.isActive,
                createdBy: template.createdBy,
                createdAt: template.createdAt,
                updatedAt: template.updatedAt,
            },
        };
    },
});
// ------------------------------------------------------
// Delete Template
// ------------------------------------------------------
export const deleteTemplateEndpoint = templateFactory.build({
    method: 'delete',
    shortDescription: 'Delete Template',
    description: 'Deletes a message template (soft delete by setting isActive=false).',
    tag: 'Templates',
    input: z.object({
        templateId: objectIdSchema,
        hard: z.boolean().optional().default(false), // True for permanent delete
    }),
    output: z.object({
        success: z.boolean(),
        message: z.string(),
    }),
    handler: async ({ input }) => {
        const template = await prisma.messageTemplate.findUnique({
            where: { id: input.templateId },
        });
        if (!template) {
            throw createHttpError(404, 'Template not found');
        }
        if (input.hard) {
            await prisma.messageTemplate.delete({
                where: { id: input.templateId },
            });
            return {
                success: true,
                message: 'Template permanently deleted',
            };
        }
        else {
            await prisma.messageTemplate.update({
                where: { id: input.templateId },
                data: { isActive: false },
            });
            return {
                success: true,
                message: 'Template archived',
            };
        }
    },
});
// ------------------------------------------------------
// Preview Template
// ------------------------------------------------------
export const previewTemplateEndpoint = authFactory.build({
    method: 'post',
    shortDescription: 'Preview Template',
    description: 'Renders a template with sample data for preview.',
    tag: 'Templates',
    input: z.object({
        templateId: objectIdSchema,
        sampleData: z
            .object({
            name: z.string().optional(),
            email: z.string().optional(),
            phone: z.string().optional(),
            firstName: z.string().optional(),
            lastName: z.string().optional(),
            code: z.string().optional(),
            discount: z.string().optional(),
            gift: z.string().optional(),
        })
            .optional(),
    }),
    output: z.object({
        channel: z.enum(['email', 'sms']),
        rendered: z.union([
            z.object({
                subject: z.string(),
                preheader: z.string().optional(),
                body: z.string(),
                html: z.string().optional(),
            }),
            z.object({
                body: z.string(),
            }),
        ]),
    }),
    handler: async ({ input }) => {
        const template = await prisma.messageTemplate.findUnique({
            where: { id: input.templateId },
        });
        if (!template) {
            throw createHttpError(404, 'Template not found');
        }
        // Build template data with sample values
        const sampleCustomer = {
            name: input.sampleData?.name || 'Jane Doe',
            email: input.sampleData?.email || 'jane@example.com',
            phone: input.sampleData?.phone || '+15551234567',
            firstName: input.sampleData?.firstName || 'Jane',
            lastName: input.sampleData?.lastName || 'Doe',
        };
        const samplePromo = {
            code: input.sampleData?.code || 'SAMPLE20',
            formattedValue: input.sampleData?.discount || input.sampleData?.gift || '20% off',
            type: input.sampleData?.gift ? 'gift' : 'discount',
        };
        const templateData = buildTemplateData(sampleCustomer, samplePromo);
        if (template.channel === 'email' && template.email) {
            const rendered = renderEmailContent(template.email, templateData);
            return {
                channel: 'email',
                rendered,
            };
        }
        else if (template.channel === 'sms' && template.sms) {
            const rendered = renderSmsContent(template.sms, templateData);
            return {
                channel: 'sms',
                rendered,
            };
        }
        else {
            throw createHttpError(400, 'Template has no content for its channel');
        }
    },
});
// ------------------------------------------------------
// Duplicate Template
// ------------------------------------------------------
export const duplicateTemplateEndpoint = templateFactory.build({
    method: 'post',
    shortDescription: 'Duplicate Template',
    description: 'Creates a copy of an existing template.',
    tag: 'Templates',
    input: z.object({
        templateId: objectIdSchema,
        name: z.string().min(1).max(100).optional(), // New name, defaults to "Copy of ..."
    }),
    output: z.object({
        success: z.boolean(),
        template: templateSchema,
    }),
    handler: async ({ input, ctx }) => {
        const source = await prisma.messageTemplate.findUnique({
            where: { id: input.templateId },
        });
        if (!source) {
            throw createHttpError(404, 'Template not found');
        }
        const template = await prisma.messageTemplate.create({
            data: {
                name: input.name || `Copy of ${source.name}`,
                description: source.description,
                channel: source.channel,
                email: source.email,
                sms: source.sms,
                tags: source.tags,
                createdBy: ctx.user.sub,
            },
        });
        return {
            success: true,
            template: {
                id: template.id,
                name: template.name,
                description: template.description,
                channel: template.channel,
                email: template.email,
                sms: template.sms,
                tags: template.tags,
                isActive: template.isActive,
                createdBy: template.createdBy,
                createdAt: template.createdAt,
                updatedAt: template.updatedAt,
            },
        };
    },
});
