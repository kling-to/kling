import { z } from 'zod';
import { createAuthRoleFactory, publicFactory } from '../factories';
import prisma from '../utils/prisma';
import createHttpError from 'http-errors';
import { objectIdSchema } from '../utils/validation';
import { createAuditLog, extractAuditContext } from '../utils/audit';
import svgCaptcha from 'svg-captcha';
import { getFlowEnrollmentQueue } from '../utils/bullmq/queues';
const captchaStore = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of captchaStore.entries()) {
        if (value.expiresAt < now) {
            captchaStore.delete(key);
        }
    }
}, 60000);
const managerFactory = createAuthRoleFactory('admin', 'manager');
const staffFactory = createAuthRoleFactory('admin', 'manager', 'staff');
const adminFactory = createAuthRoleFactory('admin');
const formEntitySchema = z.object({
    type: z.string(),
    attributes: z.record(z.string(), z.unknown()),
    parentId: z.string().optional(),
});
const formBuilderSchema = z.object({
    entities: z.record(z.string(), formEntitySchema),
    root: z.array(z.string()),
});
const triggerRulesSchema = z.object({
    type: z.enum(['time_delay', 'scroll_depth', 'exit_intent', 'immediate', 'click']),
    value: z.number().optional(),
    selector: z.string().optional(),
});
const formStylingSchema = z.object({
    primaryColor: z.string().optional(),
    backgroundColor: z.string().optional(),
    textColor: z.string().optional(),
    buttonText: z.string().optional(),
    borderRadius: z.number().optional(),
    showCloseButton: z.boolean().optional(),
    overlayColor: z.string().optional(),
    overlayOpacity: z.number().optional(),
});
const formTypeSchema = z.enum(['popup', 'embedded', 'banner', 'flyout']);
const formStatusSchema = z.enum(['draft', 'active', 'paused', 'archived']);
const formOutputSchema = z.object({
    id: z.string(),
    createdBy: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    type: z.string(),
    status: z.string(),
    schema: z.unknown(),
    styling: z.unknown().nullable(),
    triggerRules: z.unknown().nullable(),
    displayOnUrls: z.array(z.string()),
    excludeUrls: z.array(z.string()),
    deviceTargeting: z.string(),
    displayFrequency: z.string(),
    successMessage: z.string().nullable(),
    successRedirect: z.string().nullable(),
    triggerFlowOnSubmit: z.boolean(),
    flowToTriggerId: z.string().nullable(),
    flowToTrigger: z
        .object({
        id: z.string(),
        name: z.string(),
    })
        .nullable()
        .optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    _count: z
        .object({
        submissions: z.number(),
    })
        .optional(),
    creator: z
        .object({
        id: z.string(),
        email: z.string(),
        name: z.string().nullable(),
    })
        .optional(),
});
const formSubmissionOutputSchema = z.object({
    id: z.string(),
    formId: z.string(),
    customerId: z.string().nullable(),
    data: z.unknown(),
    metadata: z.unknown().nullable(),
    submittedAt: z.string(),
});
function formatFormOutput(form) {
    return {
        ...form,
        createdAt: form.createdAt.toISOString(),
        updatedAt: form.updatedAt.toISOString(),
    };
}
function formatSubmissionOutput(submission) {
    return {
        ...submission,
        submittedAt: submission.submittedAt.toISOString(),
    };
}
const DEFAULT_FORM_SCHEMA = {
    entities: {},
    root: [],
};
export const listFormsEndpoint = staffFactory.build({
    tag: 'Forms',
    method: 'get',
    shortDescription: 'List Forms',
    description: 'Returns a paginated list of forms with optional status and type filters.',
    input: z.object({
        status: formStatusSchema.optional(),
        type: formTypeSchema.optional(),
        limit: z.coerce.number().min(1).max(100).default(50),
        offset: z.coerce.number().min(0).default(0),
    }),
    output: z.object({
        items: z.array(formOutputSchema),
        total: z.number(),
        limit: z.number(),
        offset: z.number(),
    }),
    handler: async ({ input }) => {
        const { status, type, limit, offset } = input;
        const where = {};
        if (status)
            where.status = status;
        if (type)
            where.type = type;
        const [forms, total] = await Promise.all([
            prisma.form.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: offset,
                include: {
                    _count: {
                        select: { submissions: true },
                    },
                },
            }),
            prisma.form.count({ where }),
        ]);
        return {
            items: forms.map(formatFormOutput),
            total,
            limit,
            offset,
        };
    },
});
export const getFormEndpoint = staffFactory.build({
    tag: 'Forms',
    method: 'get',
    shortDescription: 'Get Form',
    description: 'Returns form details including schema, styling, and submission count.',
    input: z.object({
        formId: objectIdSchema,
    }),
    output: z.object({
        form: formOutputSchema,
    }),
    handler: async ({ input }) => {
        const form = await prisma.form.findUnique({
            where: { id: input.formId },
            include: {
                _count: {
                    select: { submissions: true },
                },
                flowToTrigger: {
                    select: { id: true, name: true },
                },
                creator: {
                    select: { id: true, email: true, name: true },
                },
            },
        });
        if (!form) {
            throw createHttpError(404, 'Form not found');
        }
        return { form: formatFormOutput(form) };
    },
});
export const createFormEndpoint = managerFactory.build({
    tag: 'Forms',
    method: 'post',
    shortDescription: 'Create Form',
    description: 'Creates a new form with schema, styling, and trigger configuration.',
    input: z.object({
        name: z.string().min(1, 'Name is required'),
        description: z.string().optional(),
        type: formTypeSchema.default('popup'),
        schema: formBuilderSchema.optional(),
        styling: formStylingSchema.optional(),
        triggerRules: triggerRulesSchema.optional(),
        displayOnUrls: z.array(z.string()).optional(),
        excludeUrls: z.array(z.string()).optional(),
        deviceTargeting: z.enum(['all', 'desktop', 'mobile']).optional(),
        displayFrequency: z.enum(['once_per_session', 'once_per_day', 'always']).optional(),
        successMessage: z.string().optional(),
        successRedirect: z.string().url().optional(),
        triggerFlowOnSubmit: z.boolean().optional(),
        flowToTriggerId: objectIdSchema.optional(),
    }),
    output: z.object({
        message: z.string(),
        form: formOutputSchema,
    }),
    handler: async ({ input, ctx }) => {
        const schemaData = input.schema
            ? JSON.parse(JSON.stringify(input.schema))
            : DEFAULT_FORM_SCHEMA;
        const form = await prisma.form.create({
            data: {
                createdBy: ctx.user.sub,
                name: input.name,
                description: input.description,
                type: input.type,
                status: 'draft',
                schema: schemaData,
                styling: input.styling ? JSON.parse(JSON.stringify(input.styling)) : undefined,
                triggerRules: input.triggerRules
                    ? JSON.parse(JSON.stringify(input.triggerRules))
                    : undefined,
                displayOnUrls: input.displayOnUrls || [],
                excludeUrls: input.excludeUrls || [],
                deviceTargeting: input.deviceTargeting || 'all',
                displayFrequency: input.displayFrequency || 'once_per_session',
                successMessage: input.successMessage,
                successRedirect: input.successRedirect,
                triggerFlowOnSubmit: input.triggerFlowOnSubmit || false,
                flowToTriggerId: input.flowToTriggerId,
            },
            include: {
                _count: {
                    select: { submissions: true },
                },
            },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: 'form_created',
            resourceType: 'form',
            resourceId: form.id,
            metadata: { name: form.name, type: form.type },
            context: auditContext,
        });
        return {
            message: 'Form created successfully',
            form: formatFormOutput(form),
        };
    },
});
export const updateFormEndpoint = managerFactory.build({
    tag: 'Forms',
    method: 'patch',
    shortDescription: 'Update Form',
    description: 'Updates form properties. Only provided fields are modified.',
    input: z.object({
        formId: objectIdSchema,
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        type: formTypeSchema.optional(),
        schema: formBuilderSchema.optional(),
        styling: formStylingSchema.nullable().optional(),
        triggerRules: triggerRulesSchema.nullable().optional(),
        displayOnUrls: z.array(z.string()).optional(),
        excludeUrls: z.array(z.string()).optional(),
        deviceTargeting: z.enum(['all', 'desktop', 'mobile']).optional(),
        displayFrequency: z.enum(['once_per_session', 'once_per_day', 'always']).optional(),
        successMessage: z.string().nullable().optional(),
        successRedirect: z.string().url().nullable().optional(),
        triggerFlowOnSubmit: z.boolean().optional(),
        flowToTriggerId: objectIdSchema.nullable().optional(),
    }),
    output: z.object({
        message: z.string(),
        form: formOutputSchema,
    }),
    handler: async ({ input, ctx }) => {
        const { formId, ...updateData } = input;
        const existing = await prisma.form.findUnique({
            where: { id: formId },
        });
        if (!existing) {
            throw createHttpError(404, 'Form not found');
        }
        const cleanData = {};
        if (updateData.name !== undefined)
            cleanData.name = updateData.name;
        if (updateData.description !== undefined)
            cleanData.description = updateData.description;
        if (updateData.type !== undefined)
            cleanData.type = updateData.type;
        if (updateData.schema !== undefined) {
            cleanData.schema = JSON.parse(JSON.stringify(updateData.schema));
        }
        if (updateData.styling !== undefined) {
            cleanData.styling = updateData.styling
                ? JSON.parse(JSON.stringify(updateData.styling))
                : null;
        }
        if (updateData.triggerRules !== undefined) {
            cleanData.triggerRules = updateData.triggerRules
                ? JSON.parse(JSON.stringify(updateData.triggerRules))
                : null;
        }
        if (updateData.displayOnUrls !== undefined)
            cleanData.displayOnUrls = updateData.displayOnUrls;
        if (updateData.excludeUrls !== undefined)
            cleanData.excludeUrls = updateData.excludeUrls;
        if (updateData.deviceTargeting !== undefined)
            cleanData.deviceTargeting = updateData.deviceTargeting;
        if (updateData.displayFrequency !== undefined)
            cleanData.displayFrequency = updateData.displayFrequency;
        if (updateData.successMessage !== undefined)
            cleanData.successMessage = updateData.successMessage;
        if (updateData.successRedirect !== undefined)
            cleanData.successRedirect = updateData.successRedirect;
        if (updateData.triggerFlowOnSubmit !== undefined)
            cleanData.triggerFlowOnSubmit = updateData.triggerFlowOnSubmit;
        if (updateData.flowToTriggerId !== undefined) {
            cleanData.flowToTrigger = updateData.flowToTriggerId
                ? { connect: { id: updateData.flowToTriggerId } }
                : { disconnect: true };
        }
        const form = await prisma.form.update({
            where: { id: formId },
            data: cleanData,
            include: {
                _count: {
                    select: { submissions: true },
                },
            },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: 'form_updated',
            resourceType: 'form',
            resourceId: form.id,
            metadata: { changes: Object.keys(cleanData) },
            context: auditContext,
        });
        return {
            message: 'Form updated successfully',
            form: formatFormOutput(form),
        };
    },
});
export const deleteFormEndpoint = adminFactory.build({
    tag: 'Forms',
    method: 'delete',
    shortDescription: 'Delete Form',
    description: 'Archives a form (soft delete). Admin role required.',
    input: z.object({
        formId: objectIdSchema,
    }),
    output: z.object({
        message: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const existing = await prisma.form.findUnique({
            where: { id: input.formId },
        });
        if (!existing) {
            throw createHttpError(404, 'Form not found');
        }
        await prisma.form.update({
            where: { id: input.formId },
            data: { status: 'archived' },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: 'form_archived',
            resourceType: 'form',
            resourceId: input.formId,
            metadata: { name: existing.name },
            context: auditContext,
        });
        return { message: 'Form archived successfully' };
    },
});
export const pauseFormEndpoint = managerFactory.build({
    tag: 'Forms',
    method: 'post',
    shortDescription: 'Pause Form',
    description: 'Pauses an active form, stopping display until resumed.',
    input: z.object({
        formId: objectIdSchema,
    }),
    output: z.object({
        message: z.string(),
        form: formOutputSchema,
    }),
    handler: async ({ input, ctx }) => {
        const existing = await prisma.form.findUnique({
            where: { id: input.formId },
        });
        if (!existing) {
            throw createHttpError(404, 'Form not found');
        }
        if (existing.status !== 'active') {
            throw createHttpError(400, 'Only active forms can be paused');
        }
        const form = await prisma.form.update({
            where: { id: input.formId },
            data: { status: 'paused' },
            include: {
                _count: {
                    select: { submissions: true },
                },
            },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: 'form_paused',
            resourceType: 'form',
            resourceId: input.formId,
            metadata: { name: existing.name },
            context: auditContext,
        });
        return {
            message: 'Form paused',
            form: formatFormOutput(form),
        };
    },
});
export const resumeFormEndpoint = managerFactory.build({
    tag: 'Forms',
    method: 'post',
    shortDescription: 'Activate Form',
    description: 'Activates a draft or paused form for display.',
    input: z.object({
        formId: objectIdSchema,
    }),
    output: z.object({
        message: z.string(),
        form: formOutputSchema,
    }),
    handler: async ({ input, ctx }) => {
        const existing = await prisma.form.findUnique({
            where: { id: input.formId },
        });
        if (!existing) {
            throw createHttpError(404, 'Form not found');
        }
        if (existing.status === 'archived') {
            throw createHttpError(400, 'Archived forms cannot be activated');
        }
        const schema = existing.schema;
        if (!schema?.root?.length) {
            throw createHttpError(400, 'Form must have at least one field before activating');
        }
        const form = await prisma.form.update({
            where: { id: input.formId },
            data: { status: 'active' },
            include: {
                _count: {
                    select: { submissions: true },
                },
            },
        });
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: 'form_activated',
            resourceType: 'form',
            resourceId: input.formId,
            metadata: { name: existing.name },
            context: auditContext,
        });
        return {
            message: 'Form activated',
            form: formatFormOutput(form),
        };
    },
});
export const listFormSubmissionsEndpoint = staffFactory.build({
    tag: 'Forms',
    method: 'get',
    shortDescription: 'List Form Submissions',
    description: 'Returns paginated submissions for a form.',
    input: z.object({
        formId: objectIdSchema,
        limit: z.coerce.number().min(1).max(100).default(50),
        offset: z.coerce.number().min(0).default(0),
    }),
    output: z.object({
        items: z.array(formSubmissionOutputSchema),
        total: z.number(),
        limit: z.number(),
        offset: z.number(),
    }),
    handler: async ({ input }) => {
        const { formId, limit, offset } = input;
        const form = await prisma.form.findUnique({
            where: { id: formId },
        });
        if (!form) {
            throw createHttpError(404, 'Form not found');
        }
        const [submissions, total] = await Promise.all([
            prisma.formSubmission.findMany({
                where: { formId },
                orderBy: { submittedAt: 'desc' },
                take: limit,
                skip: offset,
            }),
            prisma.formSubmission.count({ where: { formId } }),
        ]);
        return {
            items: submissions.map(formatSubmissionOutput),
            total,
            limit,
            offset,
        };
    },
});
export const getFormAnalyticsEndpoint = staffFactory.build({
    tag: 'Forms',
    method: 'get',
    shortDescription: 'Get Form Analytics',
    description: 'Returns submission analytics and field fill rates for a form.',
    input: z.object({
        formId: objectIdSchema,
        days: z.coerce.number().min(1).max(90).default(30),
    }),
    output: z.object({
        formId: z.string(),
        totalSubmissions: z.number(),
        submissionsByDay: z.array(z.object({
            date: z.string(),
            count: z.number(),
        })),
        topFields: z.array(z.object({
            fieldId: z.string(),
            label: z.string(),
            fillRate: z.number(),
        })),
    }),
    handler: async ({ input }) => {
        const { formId, days } = input;
        const form = await prisma.form.findUnique({
            where: { id: formId },
        });
        if (!form) {
            throw createHttpError(404, 'Form not found');
        }
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const submissions = await prisma.formSubmission.findMany({
            where: {
                formId,
                submittedAt: { gte: startDate },
            },
            orderBy: { submittedAt: 'asc' },
        });
        const submissionsByDay = {};
        for (const sub of submissions) {
            const dateKey = sub.submittedAt.toISOString().split('T')[0];
            submissionsByDay[dateKey] = (submissionsByDay[dateKey] || 0) + 1;
        }
        const schema = form.schema;
        const fieldFillCounts = {};
        for (const [fieldId, entity] of Object.entries(schema.entities || {})) {
            const ent = entity;
            fieldFillCounts[fieldId] = {
                label: ent.attributes?.label || fieldId,
                filled: 0,
            };
        }
        for (const sub of submissions) {
            const data = sub.data;
            for (const fieldId of Object.keys(fieldFillCounts)) {
                if (data[fieldId] !== undefined && data[fieldId] !== '' && data[fieldId] !== null) {
                    fieldFillCounts[fieldId].filled++;
                }
            }
        }
        const topFields = Object.entries(fieldFillCounts)
            .map(([fieldId, { label, filled }]) => ({
            fieldId,
            label,
            fillRate: submissions.length > 0 ? filled / submissions.length : 0,
        }))
            .sort((a, b) => b.fillRate - a.fillRate);
        return {
            formId,
            totalSubmissions: submissions.length,
            submissionsByDay: Object.entries(submissionsByDay).map(([date, count]) => ({
                date,
                count,
            })),
            topFields,
        };
    },
});
export const getPublicFormConfigEndpoint = publicFactory.build({
    tag: 'Forms',
    method: 'get',
    shortDescription: 'Get Public Form Config',
    description: 'Public endpoint returning form config for the widget. No auth required.',
    input: z.object({
        formId: objectIdSchema,
    }),
    output: z.object({
        form: z.object({
            id: z.string(),
            name: z.string(),
            type: z.string(),
            schema: z.unknown(),
            styling: z.unknown().nullable(),
            triggerRules: z.unknown().nullable(),
            displayOnUrls: z.array(z.string()),
            excludeUrls: z.array(z.string()),
            deviceTargeting: z.string(),
            displayFrequency: z.string(),
            successMessage: z.string().nullable(),
            successRedirect: z.string().nullable(),
        }),
    }),
    handler: async ({ input }) => {
        const form = await prisma.form.findUnique({
            where: { id: input.formId },
            select: {
                id: true,
                name: true,
                type: true,
                status: true,
                schema: true,
                styling: true,
                triggerRules: true,
                displayOnUrls: true,
                excludeUrls: true,
                deviceTargeting: true,
                displayFrequency: true,
                successMessage: true,
                successRedirect: true,
            },
        });
        if (!form) {
            throw createHttpError(404, 'Form not found');
        }
        if (form.status !== 'active') {
            throw createHttpError(404, 'Form is not available');
        }
        return {
            form: {
                id: form.id,
                name: form.name,
                type: form.type,
                schema: form.schema,
                styling: form.styling,
                triggerRules: form.triggerRules,
                displayOnUrls: form.displayOnUrls,
                excludeUrls: form.excludeUrls,
                deviceTargeting: form.deviceTargeting,
                displayFrequency: form.displayFrequency,
                successMessage: form.successMessage,
                successRedirect: form.successRedirect,
            },
        };
    },
});
export const submitFormEndpoint = publicFactory.build({
    tag: 'Forms',
    method: 'post',
    shortDescription: 'Submit Form',
    description: 'Public endpoint to submit form data. Creates customer if email provided.',
    input: z.object({
        formId: objectIdSchema,
        data: z.record(z.string(), z.unknown()),
        captchaSessionId: z.string().optional(),
        captchaAnswer: z.string().optional(),
        metadata: z
            .object({
            pageUrl: z.string().optional(),
            referrer: z.string().optional(),
            userAgent: z.string().optional(),
        })
            .optional(),
    }),
    output: z.object({
        message: z.string(),
        submissionId: z.string(),
        customerId: z.string().nullable(),
    }),
    handler: async ({ input }) => {
        const form = await prisma.form.findUnique({
            where: { id: input.formId },
        });
        if (!form) {
            throw createHttpError(404, 'Form not found');
        }
        if (form.status !== 'active') {
            throw createHttpError(400, 'Form is not accepting submissions');
        }
        let customerId = null;
        const schema = form.schema;
        const hasCaptcha = Object.values(schema.entities || {}).some((entity) => entity.type === 'captchaField');
        if (hasCaptcha) {
            if (!input.captchaSessionId || !input.captchaAnswer) {
                throw createHttpError(400, 'Captcha verification is required');
            }
            const session = captchaStore.get(input.captchaSessionId);
            if (!session) {
                throw createHttpError(400, 'Captcha session expired or invalid. Please refresh and try again.');
            }
            if (session.expiresAt < Date.now()) {
                captchaStore.delete(input.captchaSessionId);
                throw createHttpError(400, 'Captcha has expired. Please refresh and try again.');
            }
            const isValid = session.text === input.captchaAnswer.toLowerCase().trim();
            if (!isValid) {
                throw createHttpError(400, 'Incorrect captcha answer. Please try again.');
            }
            captchaStore.delete(input.captchaSessionId);
        }
        for (const [fieldId, entity] of Object.entries(schema.entities || {})) {
            const ent = entity;
            if (ent.type === 'emailField' && input.data[fieldId]) {
                const email = String(input.data[fieldId]).toLowerCase().trim();
                let customer = await prisma.customer.findUnique({
                    where: { email },
                });
                if (!customer) {
                    let name;
                    for (const [fId, e] of Object.entries(schema.entities || {})) {
                        const ent2 = e;
                        if (ent2.type === 'textField' &&
                            ent2.attributes?.label?.toLowerCase().includes('name') &&
                            input.data[fId]) {
                            name = String(input.data[fId]);
                            break;
                        }
                    }
                    customer = await prisma.customer.create({
                        data: {
                            email,
                            name,
                        },
                    });
                }
                customerId = customer.id;
                break;
            }
        }
        const submission = await prisma.formSubmission.create({
            data: {
                formId: input.formId,
                customerId,
                data: JSON.parse(JSON.stringify(input.data)),
                metadata: input.metadata ? JSON.parse(JSON.stringify(input.metadata)) : null,
            },
        });
        await createAuditLog({
            action: 'form_submission_received',
            resourceType: 'form',
            resourceId: input.formId,
            metadata: {
                submissionId: submission.id,
                customerId,
                pageUrl: input.metadata?.pageUrl,
            },
            context: {
                ipAddress: input.metadata?.userAgent ? undefined : undefined,
                userAgent: input.metadata?.userAgent,
            },
        });
        if (form.triggerFlowOnSubmit && form.flowToTriggerId && customerId) {
            try {
                const flowEnrollmentQueue = getFlowEnrollmentQueue();
                await flowEnrollmentQueue.add(`form_${submission.id}`, {
                    flowId: form.flowToTriggerId,
                    customerId,
                    triggerEventId: submission.id,
                    triggerData: {
                        type: 'form_submitted',
                        formId: form.id,
                        formName: form.name,
                        submissionId: submission.id,
                        submittedData: input.data,
                        pageUrl: input.metadata?.pageUrl,
                    },
                });
            }
            catch (err) {
                console.error('[FormSubmit] Failed to enqueue flow enrollment:', err);
            }
        }
        return {
            message: form.successMessage || 'Form submitted successfully',
            submissionId: submission.id,
            customerId,
        };
    },
});
export const generateCaptchaEndpoint = publicFactory.build({
    tag: 'Forms',
    method: 'post',
    shortDescription: 'Generate Captcha',
    description: 'Generates a captcha challenge (text or math). Expires in 5 minutes.',
    input: z.object({
        formId: objectIdSchema,
        type: z.enum(['text', 'math']).default('text'),
    }),
    output: z.object({
        sessionId: z.string(),
        svg: z.string(),
        expiresIn: z.number(),
    }),
    handler: async ({ input }) => {
        const form = await prisma.form.findUnique({
            where: { id: input.formId },
            select: { id: true, status: true, schema: true },
        });
        if (!form) {
            throw createHttpError(404, 'Form not found');
        }
        if (form.status !== 'active') {
            throw createHttpError(400, 'Form is not active');
        }
        const schema = form.schema;
        const hasCaptcha = Object.values(schema.entities || {}).some((entity) => entity.type === 'captchaField');
        if (!hasCaptcha) {
            throw createHttpError(400, 'This form does not have a captcha field');
        }
        let captcha;
        if (input.type === 'math') {
            captcha = svgCaptcha.createMathExpr({
                mathMin: 1,
                mathMax: 20,
                mathOperator: '+-',
                noise: 2,
                color: true,
                background: '#f0f0f0',
                width: 150,
                height: 50,
            });
        }
        else {
            captcha = svgCaptcha.create({
                size: 6,
                noise: 3,
                color: true,
                background: '#f0f0f0',
                width: 150,
                height: 50,
                charPreset: 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789',
            });
        }
        const sessionId = crypto.randomUUID();
        const expiresIn = 300;
        const expiresAt = Date.now() + expiresIn * 1000;
        captchaStore.set(sessionId, {
            text: captcha.text.toLowerCase(),
            expiresAt,
        });
        return {
            sessionId,
            svg: captcha.data,
            expiresIn,
        };
    },
});
export const validateCaptchaEndpoint = publicFactory.build({
    tag: 'Forms',
    method: 'post',
    shortDescription: 'Validate Captcha',
    description: 'Validates a captcha answer. Session consumed on success.',
    input: z.object({
        sessionId: z.string(),
        answer: z.string(),
    }),
    output: z.object({
        valid: z.boolean(),
        message: z.string(),
    }),
    handler: async ({ input }) => {
        const session = captchaStore.get(input.sessionId);
        if (!session) {
            return {
                valid: false,
                message: 'Captcha session expired or invalid',
            };
        }
        if (session.expiresAt < Date.now()) {
            captchaStore.delete(input.sessionId);
            return {
                valid: false,
                message: 'Captcha has expired',
            };
        }
        const isValid = session.text === input.answer.toLowerCase().trim();
        if (isValid) {
            captchaStore.delete(input.sessionId);
        }
        return {
            valid: isValid,
            message: isValid ? 'Captcha verified successfully' : 'Incorrect captcha answer',
        };
    },
});
export const exportFormSubmissionsEndpoint = managerFactory.build({
    tag: 'Forms',
    method: 'get',
    shortDescription: 'Export Submissions',
    description: 'Export form submissions as CSV or JSON.',
    input: z.object({
        formId: objectIdSchema,
        format: z.enum(['csv', 'json']).default('csv'),
    }),
    output: z.object({
        filename: z.string(),
        contentType: z.string(),
        data: z.string(),
        recordCount: z.number(),
    }),
    handler: async ({ input }) => {
        const form = await prisma.form.findUnique({
            where: { id: input.formId },
        });
        if (!form) {
            throw createHttpError(404, 'Form not found');
        }
        const submissions = await prisma.formSubmission.findMany({
            where: { formId: input.formId },
            include: {
                customer: {
                    select: { id: true, email: true, name: true, phone: true },
                },
            },
            orderBy: { submittedAt: 'desc' },
        });
        const timestamp = new Date().toISOString().split('T')[0];
        const safeName = form.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
        const schema = form.schema;
        const fieldIds = Object.keys(schema?.entities || {});
        const fieldLabels = {};
        for (const [fieldId, entity] of Object.entries(schema?.entities || {})) {
            const ent = entity;
            fieldLabels[fieldId] = ent.attributes?.label || fieldId;
        }
        if (input.format === 'json') {
            const jsonData = submissions.map((sub) => {
                const data = sub.data;
                const metadata = sub.metadata;
                return {
                    submissionId: sub.id,
                    submittedAt: sub.submittedAt.toISOString(),
                    customerId: sub.customerId || '',
                    customerEmail: sub.customer?.email || '',
                    customerName: sub.customer?.name || '',
                    customerPhone: sub.customer?.phone || '',
                    pageUrl: metadata?.pageUrl || '',
                    referrer: metadata?.referrer || '',
                    ...data,
                };
            });
            return {
                filename: `${safeName}_submissions_${timestamp}.json`,
                contentType: 'application/json',
                data: JSON.stringify(jsonData, null, 2),
                recordCount: submissions.length,
            };
        }
        const baseHeaders = [
            'Submission ID',
            'Submitted At',
            'Customer ID',
            'Customer Email',
            'Customer Name',
            'Customer Phone',
            'Page URL',
            'Referrer',
        ];
        const fieldHeaders = fieldIds.map((id) => fieldLabels[id] || id);
        const headers = [...baseHeaders, ...fieldHeaders];
        const rows = submissions.map((sub) => {
            const data = sub.data;
            const metadata = sub.metadata;
            const baseRow = [
                sub.id,
                sub.submittedAt.toISOString(),
                sub.customerId || '',
                sub.customer?.email || '',
                sub.customer?.name || '',
                sub.customer?.phone || '',
                String(metadata?.pageUrl || ''),
                String(metadata?.referrer || ''),
            ];
            const fieldValues = fieldIds.map((id) => {
                const value = data[id];
                if (value === null || value === undefined)
                    return '';
                if (typeof value === 'boolean')
                    return value ? 'Yes' : 'No';
                if (Array.isArray(value))
                    return value.join('; ');
                return String(value);
            });
            return [...baseRow, ...fieldValues];
        });
        const escapeCSV = (value) => {
            if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        };
        const csvLines = [
            headers.map(escapeCSV).join(','),
            ...rows.map((row) => row.map(escapeCSV).join(',')),
        ];
        return {
            filename: `${safeName}_submissions_${timestamp}.csv`,
            contentType: 'text/csv',
            data: csvLines.join('\n'),
            recordCount: submissions.length,
        };
    },
});
