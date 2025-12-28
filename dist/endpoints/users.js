import { z } from 'zod';
import { createAuthRoleFactory, authFactory } from '../factories';
import prisma from '../utils/prisma';
import createHttpError from 'http-errors';
import { createAuditLog, AuditActions } from '../utils/audit';
import { objectIdSchema } from '../utils/validation';
// List users endpoint (owner and admin only)
export const listUsersEndpoint = createAuthRoleFactory('admin').build({
    method: 'get',
    shortDescription: 'List Users',
    description: 'Returns a paginated list of users in the system.',
    tag: 'Users',
    input: z.object({
        page: z.string().optional().default('1'),
        limit: z.string().optional().default('20'),
        search: z.string().optional(),
    }),
    output: z.object({
        users: z.array(z.object({
            id: z.string(),
            email: z.string(),
            name: z.string(),
            role: z.enum(['ADMIN', 'MANAGER', 'STAFF']),
            createdAt: z.date(),
            updatedAt: z.date(),
        })),
        pagination: z.object({
            page: z.number(),
            limit: z.number(),
            total: z.number(),
            totalPages: z.number(),
        }),
    }),
    handler: async ({ input }) => {
        const page = parseInt(input.page);
        const limit = Math.min(parseInt(input.limit), 100); // Max 100 per page
        const skip = (page - 1) * limit;
        // Build where clause for search
        const where = {};
        if (input.search) {
            where.OR = [
                { email: { contains: input.search, mode: 'insensitive' } },
                { name: { contains: input.search, mode: 'insensitive' } },
            ];
        }
        // Fetch users with pagination
        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                select: {
                    id: true,
                    email: true,
                    name: true,
                    role: true,
                    createdAt: true,
                    updatedAt: true,
                },
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            prisma.user.count({ where }),
        ]);
        return {
            users: users.map((u) => ({
                ...u,
                name: u.name || '',
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
// Get user endpoint
export const getUserEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'Get User',
    description: 'Returns details of a specific user by ID.',
    tag: 'Users',
    input: z.object({
        userId: objectIdSchema,
    }),
    output: z.object({
        id: z.string(),
        email: z.string(),
        name: z.string(),
        role: z.enum(['OWNER', 'ADMIN', 'MANAGER', 'STAFF']),
        createdAt: z.date(),
        updatedAt: z.date(),
    }),
    handler: async ({ input }) => {
        // Fetch user from database
        const user = await prisma.user.findUnique({
            where: { id: input.userId },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        if (!user) {
            throw createHttpError(404, 'User not found');
        }
        return {
            ...user,
            name: user.name || '',
        };
    },
});
// Update user role endpoint (admin only)
export const updateUserRoleEndpoint = createAuthRoleFactory('admin').build({
    method: 'patch',
    shortDescription: 'Update User Role',
    description: "Updates a user's role. Admins cannot demote themselves.",
    tag: 'Users',
    input: z.object({
        userId: objectIdSchema,
        role: z.enum(['ADMIN', 'MANAGER', 'STAFF']),
    }),
    output: z.object({
        success: z.boolean(),
        message: z.string(),
        user: z.object({
            id: z.string(),
            email: z.string(),
            name: z.string(),
            role: z.enum(['ADMIN', 'MANAGER', 'STAFF']),
        }),
    }),
    handler: async ({ input, ctx }) => {
        const { userId, role } = input;
        // Prevent admin from demoting themselves
        if (userId === ctx.user.sub) {
            throw createHttpError(400, 'You cannot change your own role');
        }
        // Check user exists
        const existingUser = await prisma.user.findUnique({
            where: { id: userId },
        });
        if (!existingUser) {
            throw createHttpError(404, 'User not found');
        }
        // Update user role
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: { role },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
            },
        });
        // Create audit log
        await createAuditLog({
            action: AuditActions.member.roleChanged,
            resourceType: 'user',
            resourceId: userId,
            metadata: {
                previousRole: existingUser.role,
                newRole: role,
                targetUserEmail: existingUser.email,
            },
            context: { userId: ctx.user.sub },
        });
        return {
            success: true,
            message: `User role updated to ${role}`,
            user: {
                ...updatedUser,
                name: updatedUser.name || '',
            },
        };
    },
});
// Delete user endpoint (admin only)
export const deleteUserEndpoint = createAuthRoleFactory('admin').build({
    method: 'delete',
    shortDescription: 'Delete User',
    description: 'Removes a user from the system. Admins cannot delete themselves.',
    tag: 'Users',
    input: z.object({
        userId: objectIdSchema,
    }),
    output: z.object({
        success: z.boolean(),
        message: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const { userId } = input;
        // Prevent admin from deleting themselves
        if (userId === ctx.user.sub) {
            throw createHttpError(400, 'You cannot delete your own account');
        }
        // Check user exists
        const existingUser = await prisma.user.findUnique({
            where: { id: userId },
        });
        if (!existingUser) {
            throw createHttpError(404, 'User not found');
        }
        // Count remaining admins
        const adminCount = await prisma.user.count({
            where: { role: 'ADMIN' },
        });
        // Prevent deleting the last admin
        if (existingUser.role === 'ADMIN' && adminCount <= 1) {
            throw createHttpError(400, 'Cannot delete the last admin user');
        }
        // Delete user
        await prisma.user.delete({
            where: { id: userId },
        });
        // Create audit log
        await createAuditLog({
            action: AuditActions.member.removed,
            resourceType: 'user',
            resourceId: userId,
            metadata: {
                deletedUserEmail: existingUser.email,
                deletedUserRole: existingUser.role,
            },
            context: { userId: ctx.user.sub },
        });
        return {
            success: true,
            message: 'User deleted successfully',
        };
    },
});
