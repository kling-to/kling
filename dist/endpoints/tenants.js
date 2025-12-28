import { z } from 'zod';
import { createAuthRoleFactory } from '../factories';
import prisma from '../utils/prisma';
import createHttpError from 'http-errors';
import { isValidTimezone, getCommonTimezones } from '../utils/quiet-hours';
// Create tenant endpoint (system_admin only)
export const createTenantEndpoint = createAuthRoleFactory('system_admin').build({
    method: 'post',
    shortDescription: 'Create Tenant',
    description: 'Creates a new tenant in the system.',
    tag: 'Tenants',
    input: z.object({
        name: z.string().min(1),
        timezone: z.string().optional(),
        currency: z.string().optional(),
    }),
    output: z.object({
        id: z.string(),
        name: z.string(),
        ownerId: z.string(),
        createdAt: z.date(),
        updatedAt: z.date(),
    }),
    handler: async ({ input, ctx }) => {
        const userId = ctx.user.sub;
        // Create tenant with user as owner
        const tenant = await prisma.$transaction(async (tx) => {
            const newTenant = await tx.tenant.create({
                data: {
                    name: input.name,
                    ownerId: userId,
                },
            });
            // Create tenant membership with OWNER role
            await tx.tenantMember.create({
                data: {
                    userId,
                    tenantId: newTenant.id,
                    role: 'OWNER',
                },
            });
            return newTenant;
        });
        return tenant;
    },
});
// Get tenant endpoint
export const getTenantEndpoint = createAuthRoleFactory('system_admin', 'tenant_admin').build({
    method: 'get',
    shortDescription: 'Get Tenant',
    description: 'Returns details of a specific tenant by ID.',
    tag: 'Tenants',
    input: z.object({
        tenantId: z.string(),
    }),
    output: z.object({
        id: z.string(),
        name: z.string(),
        ownerId: z.string(),
        createdAt: z.date(),
        updatedAt: z.date(),
        owner: z.object({
            id: z.string(),
            email: z.string(),
            name: z.string(),
        }),
        members: z.array(z.object({
            id: z.string(),
            userId: z.string(),
            tenantId: z.string(),
            role: z.enum(['OWNER', 'ADMIN', 'MANAGER', 'STAFF']),
            createdAt: z.date(),
            user: z.object({
                id: z.string(),
                email: z.string(),
                name: z.string(),
            }),
        })),
    }),
    handler: async ({ input }) => {
        // Fetch tenant from database
        const tenant = await prisma.tenant.findUnique({
            where: { id: input.tenantId },
            include: {
                owner: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                    },
                },
                members: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                email: true,
                                name: true,
                            },
                        },
                    },
                },
            },
        });
        if (!tenant) {
            throw createHttpError(404, 'Tenant not found');
        }
        return {
            ...tenant,
            owner: {
                ...tenant.owner,
                name: tenant.owner.name || '',
            },
            members: tenant.members.map((m) => ({
                ...m,
                user: {
                    ...m.user,
                    name: m.user.name || '',
                },
            })),
        };
    },
});
// Update tenant settings endpoint
export const updateTenantSettingsEndpoint = createAuthRoleFactory('tenant_admin', 'system_admin').build({
    method: 'patch',
    shortDescription: 'Update Tenant Settings',
    description: 'Updates tenant configuration including quiet hours, timezone, and fallback settings.',
    tag: 'Tenants',
    input: z.object({
        tenantId: z.string(),
        // General settings
        name: z.string().min(1).optional(),
        timezone: z.string().optional(),
        defaultMessageChannel: z.enum(['email', 'sms']).optional(),
        // Quota settings
        dailyMessageLimit: z.number().min(0).optional(),
        monthlyMessageLimit: z.number().min(0).optional(),
        // Quiet hours settings (DST-safe)
        quietHoursEnabled: z.boolean().optional(),
        quietHoursStart: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .optional()
            .nullable(),
        quietHoursEnd: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .optional()
            .nullable(),
        quietHoursDays: z.array(z.number().min(0).max(6)).optional(),
        // Fallback settings
        fallbackEnabled: z.boolean().optional(),
        fallbackOrder: z.array(z.enum(['email', 'sms'])).optional(),
        fallbackMaxAttempts: z.number().min(0).max(5).optional(),
    }),
    output: z.object({
        success: z.boolean(),
        tenant: z.object({
            id: z.string(),
            name: z.string(),
            timezone: z.string(),
            defaultMessageChannel: z.enum(['email', 'sms']),
            dailyMessageLimit: z.number(),
            monthlyMessageLimit: z.number(),
            quietHoursEnabled: z.boolean(),
            quietHoursStart: z.string().nullable(),
            quietHoursEnd: z.string().nullable(),
            quietHoursDays: z.array(z.number()),
            fallbackEnabled: z.boolean(),
            fallbackOrder: z.array(z.enum(['email', 'sms'])),
            fallbackMaxAttempts: z.number(),
        }),
    }),
    handler: async ({ input, ctx }) => {
        // Verify tenant exists and user has access
        const tenant = await prisma.tenant.findUnique({
            where: { id: input.tenantId },
        });
        if (!tenant) {
            throw createHttpError(404, 'Tenant not found');
        }
        // Check tenant access (unless system admin)
        if (ctx.user.role !== 'system_admin' && ctx.user.tenantId !== input.tenantId) {
            throw createHttpError(403, 'Access denied');
        }
        // Validate timezone if provided
        if (input.timezone && !isValidTimezone(input.timezone)) {
            throw createHttpError(400, `Invalid timezone: ${input.timezone}`);
        }
        // Validate quiet hours consistency
        if (input.quietHoursEnabled) {
            if (!input.quietHoursStart && !tenant.quietHoursStart) {
                throw createHttpError(400, 'quietHoursStart is required when quietHoursEnabled is true');
            }
            if (!input.quietHoursEnd && !tenant.quietHoursEnd) {
                throw createHttpError(400, 'quietHoursEnd is required when quietHoursEnabled is true');
            }
        }
        // Update tenant
        const updatedTenant = await prisma.tenant.update({
            where: { id: input.tenantId },
            data: {
                ...(input.name && { name: input.name }),
                ...(input.timezone && { timezone: input.timezone }),
                ...(input.defaultMessageChannel && { defaultMessageChannel: input.defaultMessageChannel }),
                ...(input.dailyMessageLimit !== undefined && {
                    dailyMessageLimit: input.dailyMessageLimit,
                }),
                ...(input.monthlyMessageLimit !== undefined && {
                    monthlyMessageLimit: input.monthlyMessageLimit,
                }),
                ...(input.quietHoursEnabled !== undefined && {
                    quietHoursEnabled: input.quietHoursEnabled,
                }),
                ...(input.quietHoursStart !== undefined && { quietHoursStart: input.quietHoursStart }),
                ...(input.quietHoursEnd !== undefined && { quietHoursEnd: input.quietHoursEnd }),
                ...(input.quietHoursDays && { quietHoursDays: input.quietHoursDays }),
                ...(input.fallbackEnabled !== undefined && { fallbackEnabled: input.fallbackEnabled }),
                ...(input.fallbackOrder && { fallbackOrder: input.fallbackOrder }),
                ...(input.fallbackMaxAttempts !== undefined && {
                    fallbackMaxAttempts: input.fallbackMaxAttempts,
                }),
            },
        });
        return {
            success: true,
            tenant: {
                id: updatedTenant.id,
                name: updatedTenant.name,
                timezone: updatedTenant.timezone,
                defaultMessageChannel: updatedTenant.defaultMessageChannel,
                dailyMessageLimit: updatedTenant.dailyMessageLimit,
                monthlyMessageLimit: updatedTenant.monthlyMessageLimit,
                quietHoursEnabled: updatedTenant.quietHoursEnabled,
                quietHoursStart: updatedTenant.quietHoursStart,
                quietHoursEnd: updatedTenant.quietHoursEnd,
                quietHoursDays: updatedTenant.quietHoursDays,
                fallbackEnabled: updatedTenant.fallbackEnabled,
                fallbackOrder: updatedTenant.fallbackOrder,
                fallbackMaxAttempts: updatedTenant.fallbackMaxAttempts,
            },
        };
    },
});
// Get tenant settings endpoint
export const getTenantSettingsEndpoint = createAuthRoleFactory('tenant_admin', 'tenant_user', 'system_admin').build({
    method: 'get',
    shortDescription: 'Get Tenant Settings',
    description: 'Returns tenant configuration settings.',
    tag: 'Tenants',
    input: z.object({
        tenantId: z.string(),
    }),
    output: z.object({
        id: z.string(),
        name: z.string(),
        timezone: z.string(),
        defaultMessageChannel: z.enum(['email', 'sms']),
        dailyMessageLimit: z.number(),
        monthlyMessageLimit: z.number(),
        quietHoursEnabled: z.boolean(),
        quietHoursStart: z.string().nullable(),
        quietHoursEnd: z.string().nullable(),
        quietHoursDays: z.array(z.number()),
        fallbackEnabled: z.boolean(),
        fallbackOrder: z.array(z.enum(['email', 'sms'])),
        fallbackMaxAttempts: z.number(),
        tokenBalance: z.number(),
    }),
    handler: async ({ input, ctx }) => {
        const tenant = await prisma.tenant.findUnique({
            where: { id: input.tenantId },
        });
        if (!tenant) {
            throw createHttpError(404, 'Tenant not found');
        }
        // Check tenant access (unless system admin)
        if (ctx.user.role !== 'system_admin' && ctx.user.tenantId !== input.tenantId) {
            throw createHttpError(403, 'Access denied');
        }
        return {
            id: tenant.id,
            name: tenant.name,
            timezone: tenant.timezone,
            defaultMessageChannel: tenant.defaultMessageChannel,
            dailyMessageLimit: tenant.dailyMessageLimit,
            monthlyMessageLimit: tenant.monthlyMessageLimit,
            quietHoursEnabled: tenant.quietHoursEnabled,
            quietHoursStart: tenant.quietHoursStart,
            quietHoursEnd: tenant.quietHoursEnd,
            quietHoursDays: tenant.quietHoursDays,
            fallbackEnabled: tenant.fallbackEnabled,
            fallbackOrder: tenant.fallbackOrder,
            fallbackMaxAttempts: tenant.fallbackMaxAttempts,
            tokenBalance: tenant.tokenBalance,
        };
    },
});
// Get available timezones endpoint
export const getTimezonesEndpoint = createAuthRoleFactory('tenant_admin', 'tenant_user', 'system_admin').build({
    method: 'get',
    shortDescription: 'Get Timezones',
    description: 'Returns a list of common timezones for selection.',
    tag: 'Tenants',
    input: z.object({}),
    output: z.object({
        timezones: z.array(z.string()),
    }),
    handler: async () => {
        return {
            timezones: getCommonTimezones(),
        };
    },
});
