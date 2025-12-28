/**
 * Email Templates Endpoints
 *
 * CRUD operations for reusable email templates.
 */
import { z } from 'zod';
import createHttpError from 'http-errors';
import prisma from '../utils/prisma';
import { authFactory } from '../factories';
import { createAuditLog, extractAuditContext } from '../utils/audit';
import { renderEmailContent, buildTemplateData } from '../utils/template-renderer';
// ------------------------------------------------------
// SCHEMAS
// ------------------------------------------------------
const emailTemplateCategorySchema = z.enum([
    'transactional',
    'promotional',
    'lifecycle',
    'engagement',
    'notification',
    'newsletter',
    'custom',
]);
const emailTemplateInputSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional().nullable(),
    category: emailTemplateCategorySchema.optional().default('custom'),
    tags: z.array(z.string()).optional().default([]),
    subject: z.string().min(1).max(200),
    preheader: z.string().max(150).optional().nullable(),
    body: z.string().min(1),
    html: z.string().optional().nullable(),
    designJson: z.any().optional().nullable(), // Unlayer visual editor design JSON
    signature: z.string().max(500).optional().nullable(),
    isPublic: z.boolean().optional().default(true),
    thumbnailUrl: z.string().url().optional().nullable(),
});
const emailTemplateOutputSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    category: emailTemplateCategorySchema,
    tags: z.array(z.string()),
    subject: z.string(),
    preheader: z.string().nullable(),
    body: z.string(),
    html: z.string().nullable(),
    designJson: z.any().nullable(), // Unlayer visual editor design JSON
    signature: z.string().nullable(),
    isDefault: z.boolean(),
    isPublic: z.boolean(),
    thumbnailUrl: z.string().nullable(),
    version: z.number(),
    usageCount: z.number(),
    createdBy: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
// ------------------------------------------------------
// LIST TEMPLATES
// ------------------------------------------------------
export const listEmailTemplatesEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'List Email Templates',
    description: 'Returns all available email templates with optional filtering.',
    tag: 'Email Templates',
    input: z.object({
        category: emailTemplateCategorySchema.optional(),
        search: z.string().optional(),
        includeDefaults: z.boolean().optional().default(true),
        limit: z.coerce.number().min(1).max(100).optional().default(50),
        offset: z.coerce.number().min(0).optional().default(0),
    }),
    output: z.object({
        items: z.array(emailTemplateOutputSchema),
        total: z.number(),
    }),
    handler: async ({ input, ctx }) => {
        const userId = ctx.user.sub;
        const { category, search, includeDefaults, limit, offset } = input;
        const where = {
            OR: [{ createdBy: userId }, { isPublic: true }],
        };
        if (category) {
            where.category = category;
        }
        if (!includeDefaults) {
            where.isDefault = false;
        }
        if (search) {
            where.AND = [
                {
                    OR: [
                        { name: { contains: search, mode: 'insensitive' } },
                        { description: { contains: search, mode: 'insensitive' } },
                        { tags: { hasSome: [search.toLowerCase()] } },
                    ],
                },
            ];
        }
        const [items, total] = await Promise.all([
            prisma.emailTemplate.findMany({
                where,
                orderBy: [{ isDefault: 'desc' }, { usageCount: 'desc' }, { updatedAt: 'desc' }],
                take: limit,
                skip: offset,
            }),
            prisma.emailTemplate.count({ where }),
        ]);
        return {
            items: items.map((t) => ({
                ...t,
                createdAt: t.createdAt.toISOString(),
                updatedAt: t.updatedAt.toISOString(),
            })),
            total,
        };
    },
});
// ------------------------------------------------------
// GET TEMPLATE BY ID
// ------------------------------------------------------
export const getEmailTemplateEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'Get Email Template',
    description: 'Returns a single email template by ID.',
    tag: 'Email Templates',
    input: z.object({
        templateId: z.string(),
    }),
    output: emailTemplateOutputSchema,
    handler: async ({ input, ctx }) => {
        const userId = ctx.user.sub;
        const template = await prisma.emailTemplate.findFirst({
            where: {
                id: input.templateId,
                OR: [{ createdBy: userId }, { isPublic: true }],
            },
        });
        if (!template) {
            throw createHttpError(404, 'Email template not found');
        }
        return {
            ...template,
            createdAt: template.createdAt.toISOString(),
            updatedAt: template.updatedAt.toISOString(),
        };
    },
});
// ------------------------------------------------------
// CREATE TEMPLATE
// ------------------------------------------------------
export const createEmailTemplateEndpoint = authFactory.build({
    method: 'post',
    shortDescription: 'Create Email Template',
    description: 'Creates a new reusable email template.',
    tag: 'Email Templates',
    input: emailTemplateInputSchema,
    output: z.object({
        message: z.string(),
        template: emailTemplateOutputSchema,
    }),
    handler: async ({ input, ctx }) => {
        const userId = ctx.user.sub;
        const template = await prisma.emailTemplate.create({
            data: {
                name: input.name,
                description: input.description,
                category: input.category,
                tags: input.tags,
                subject: input.subject,
                preheader: input.preheader,
                body: input.body,
                html: input.html,
                designJson: input.designJson || null,
                signature: input.signature,
                isPublic: input.isPublic,
                thumbnailUrl: input.thumbnailUrl,
                createdBy: userId,
            },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: 'email_template_created',
            resourceType: 'email_template',
            resourceId: template.id,
            metadata: { name: template.name, category: template.category },
            context: auditContext,
        });
        return {
            message: 'Email template created successfully',
            template: {
                ...template,
                createdAt: template.createdAt.toISOString(),
                updatedAt: template.updatedAt.toISOString(),
            },
        };
    },
});
// ------------------------------------------------------
// UPDATE TEMPLATE
// ------------------------------------------------------
export const updateEmailTemplateEndpoint = authFactory.build({
    method: 'patch',
    shortDescription: 'Update Email Template',
    description: 'Updates an existing email template.',
    tag: 'Email Templates',
    input: z.object({
        templateId: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional().nullable(),
        category: emailTemplateCategorySchema.optional(),
        tags: z.array(z.string()).optional(),
        subject: z.string().min(1).max(200).optional(),
        preheader: z.string().max(150).optional().nullable(),
        body: z.string().min(1).optional(),
        html: z.string().optional().nullable(),
        designJson: z.any().optional().nullable(),
        signature: z.string().max(500).optional().nullable(),
        isPublic: z.boolean().optional(),
        thumbnailUrl: z.string().url().optional().nullable(),
    }),
    output: z.object({
        message: z.string(),
        template: emailTemplateOutputSchema,
    }),
    handler: async ({ input, ctx }) => {
        const userId = ctx.user.sub;
        const { templateId, ...updateData } = input;
        // Check ownership (can't edit others' templates unless you're admin)
        const existing = await prisma.emailTemplate.findFirst({
            where: { id: templateId },
        });
        if (!existing) {
            throw createHttpError(404, 'Email template not found');
        }
        if (existing.createdBy !== userId && !existing.isDefault) {
            throw createHttpError(403, 'You can only edit your own templates');
        }
        // System default templates can only be edited by admins
        if (existing.isDefault && !['OWNER', 'ADMIN'].includes(ctx.user.role || '')) {
            throw createHttpError(403, 'Only admins can edit default templates');
        }
        const template = await prisma.emailTemplate.update({
            where: { id: templateId },
            data: {
                ...updateData,
                category: updateData.category,
                version: { increment: 1 },
            },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: 'email_template_updated',
            resourceType: 'email_template',
            resourceId: template.id,
            metadata: { name: template.name, version: template.version },
            context: auditContext,
        });
        return {
            message: 'Email template updated successfully',
            template: {
                ...template,
                createdAt: template.createdAt.toISOString(),
                updatedAt: template.updatedAt.toISOString(),
            },
        };
    },
});
// ------------------------------------------------------
// DELETE TEMPLATE
// ------------------------------------------------------
export const deleteEmailTemplateEndpoint = authFactory.build({
    method: 'delete',
    shortDescription: 'Delete Email Template',
    description: 'Deletes an email template.',
    tag: 'Email Templates',
    input: z.object({
        templateId: z.string(),
    }),
    output: z.object({
        message: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const userId = ctx.user.sub;
        const existing = await prisma.emailTemplate.findFirst({
            where: { id: input.templateId },
        });
        if (!existing) {
            throw createHttpError(404, 'Email template not found');
        }
        if (existing.createdBy !== userId) {
            throw createHttpError(403, 'You can only delete your own templates');
        }
        if (existing.isDefault) {
            throw createHttpError(403, 'Cannot delete default templates');
        }
        await prisma.emailTemplate.delete({
            where: { id: input.templateId },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: 'email_template_deleted',
            resourceType: 'email_template',
            resourceId: input.templateId,
            metadata: { name: existing.name },
            context: auditContext,
        });
        return { message: 'Email template deleted successfully' };
    },
});
// ------------------------------------------------------
// DUPLICATE TEMPLATE
// ------------------------------------------------------
export const duplicateEmailTemplateEndpoint = authFactory.build({
    method: 'post',
    shortDescription: 'Duplicate Email Template',
    description: 'Creates a copy of an existing email template.',
    tag: 'Email Templates',
    input: z.object({
        templateId: z.string(),
        name: z.string().min(1).max(100).optional(),
    }),
    output: z.object({
        message: z.string(),
        template: emailTemplateOutputSchema,
    }),
    handler: async ({ input, ctx }) => {
        const userId = ctx.user.sub;
        const existing = await prisma.emailTemplate.findFirst({
            where: {
                id: input.templateId,
                OR: [{ createdBy: userId }, { isPublic: true }],
            },
        });
        if (!existing) {
            throw createHttpError(404, 'Email template not found');
        }
        const template = await prisma.emailTemplate.create({
            data: {
                name: input.name || `${existing.name} (Copy)`,
                description: existing.description,
                category: existing.category,
                tags: existing.tags,
                subject: existing.subject,
                preheader: existing.preheader,
                body: existing.body,
                html: existing.html,
                designJson: existing.designJson,
                signature: existing.signature,
                isPublic: false, // Copies are private by default
                createdBy: userId,
            },
        });
        // Increment usage count on the original
        await prisma.emailTemplate.update({
            where: { id: input.templateId },
            data: { usageCount: { increment: 1 } },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: 'email_template_duplicated',
            resourceType: 'email_template',
            resourceId: template.id,
            metadata: { name: template.name, sourceTemplateId: input.templateId },
            context: auditContext,
        });
        return {
            message: 'Email template duplicated successfully',
            template: {
                ...template,
                createdAt: template.createdAt.toISOString(),
                updatedAt: template.updatedAt.toISOString(),
            },
        };
    },
});
// ------------------------------------------------------
// PREVIEW TEMPLATE
// ------------------------------------------------------
export const previewEmailTemplateEndpoint = authFactory.build({
    method: 'post',
    shortDescription: 'Preview Email Template',
    description: 'Renders a template with sample data for preview.',
    tag: 'Email Templates',
    input: z.object({
        templateId: z.string().optional(),
        // Or provide inline content
        subject: z.string().optional(),
        preheader: z.string().optional(),
        body: z.string().optional(),
        html: z.string().optional(),
        signature: z.string().optional(),
        // Sample data
        sampleData: z
            .object({
            name: z.string().optional(),
            email: z.string().optional(),
            firstName: z.string().optional(),
            lastName: z.string().optional(),
            code: z.string().optional(),
            discount: z.string().optional(),
            productName: z.string().optional(),
            productUrl: z.string().optional(),
            price: z.string().optional(),
            category: z.string().optional(),
            brand: z.string().optional(),
        })
            .optional(),
    }),
    output: z.object({
        subject: z.string(),
        preheader: z.string().nullable(),
        body: z.string(),
        html: z.string().nullable(),
        signature: z.string().nullable(),
    }),
    handler: async ({ input, ctx }) => {
        const userId = ctx.user.sub;
        let content = {
            subject: input.subject || '',
            preheader: input.preheader || null,
            body: input.body || '',
            html: input.html || null,
            signature: input.signature || null,
        };
        // If templateId provided, fetch template content
        if (input.templateId) {
            const template = await prisma.emailTemplate.findFirst({
                where: {
                    id: input.templateId,
                    OR: [{ createdBy: userId }, { isPublic: true }],
                },
            });
            if (!template) {
                throw createHttpError(404, 'Email template not found');
            }
            content = {
                subject: template.subject,
                preheader: template.preheader,
                body: template.body,
                html: template.html,
                signature: template.signature,
            };
        }
        // Build sample data
        const sampleCustomer = {
            name: input.sampleData?.name || 'John Doe',
            email: input.sampleData?.email || 'john@example.com',
            firstName: input.sampleData?.firstName || 'John',
            lastName: input.sampleData?.lastName || 'Doe',
        };
        const samplePromo = {
            code: input.sampleData?.code || 'SAVE20',
            discount: input.sampleData?.discount || '20%',
        };
        const sampleProduct = {
            productName: input.sampleData?.productName || 'Premium Widget',
            productUrl: input.sampleData?.productUrl || 'https://example.com/product',
            price: input.sampleData?.price || '$99.00',
            currency: 'USD',
            category: input.sampleData?.category || 'Electronics',
            brand: input.sampleData?.brand || 'WidgetCo',
        };
        const templateData = buildTemplateData(sampleCustomer, samplePromo, sampleProduct);
        const rendered = renderEmailContent(content, templateData);
        // Render signature separately (not part of renderEmailContent return type)
        let renderedSignature = null;
        if (content.signature) {
            renderedSignature = Object.entries(templateData).reduce((text, [key, value]) => text.replace(new RegExp(`{{${key}}}`, 'gi'), value || ''), content.signature);
        }
        return {
            subject: rendered.subject,
            preheader: rendered.preheader || null,
            body: rendered.body,
            html: rendered.html || null,
            signature: renderedSignature,
        };
    },
});
// ------------------------------------------------------
// LIST TEMPLATE CATEGORIES
// ------------------------------------------------------
export const listEmailTemplateCategoriesEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'List Email Template Categories',
    description: 'Returns all available email template categories with counts.',
    tag: 'Email Templates',
    input: z.object({}),
    output: z.object({
        categories: z.array(z.object({
            value: emailTemplateCategorySchema,
            label: z.string(),
            description: z.string(),
            count: z.number(),
        })),
    }),
    handler: async ({ ctx }) => {
        const userId = ctx.user.sub;
        const categoryCounts = await prisma.emailTemplate.groupBy({
            by: ['category'],
            where: {
                OR: [{ createdBy: userId }, { isPublic: true }],
            },
            _count: true,
        });
        const countMap = new Map(categoryCounts.map((c) => [c.category, c._count]));
        const categories = [
            {
                value: 'transactional',
                label: 'Transactional',
                description: 'Order confirmations, receipts, shipping updates',
                count: countMap.get('transactional') || 0,
            },
            {
                value: 'promotional',
                label: 'Promotional',
                description: 'Sales, discounts, new products',
                count: countMap.get('promotional') || 0,
            },
            {
                value: 'lifecycle',
                label: 'Lifecycle',
                description: 'Welcome, win-back, birthday emails',
                count: countMap.get('lifecycle') || 0,
            },
            {
                value: 'engagement',
                label: 'Engagement',
                description: 'Reviews, surveys, feedback requests',
                count: countMap.get('engagement') || 0,
            },
            {
                value: 'notification',
                label: 'Notification',
                description: 'Alerts, reminders, updates',
                count: countMap.get('notification') || 0,
            },
            {
                value: 'newsletter',
                label: 'Newsletter',
                description: 'Regular content updates',
                count: countMap.get('newsletter') || 0,
            },
            {
                value: 'custom',
                label: 'Custom',
                description: 'User-created templates',
                count: countMap.get('custom') || 0,
            },
        ];
        return { categories };
    },
});
