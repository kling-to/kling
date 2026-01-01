import { z } from 'zod';
import prisma from '../utils/prisma';
const listUsersQuerySchema = z.object({
    page: z.string().optional().default('1'),
    limit: z.string().optional().default('20'),
    search: z.string().optional(),
});
export const listUsers = async (req, res) => {
    try {
        // Validate query params
        const query = listUsersQuerySchema.parse(req.query);
        const page = parseInt(query.page);
        const limit = Math.min(parseInt(query.limit), 100); // Max 100 per page
        const skip = (page - 1) * limit;
        // Build where clause for search
        const where = {};
        if (query.search) {
            where.OR = [
                { email: { contains: query.search, mode: 'insensitive' } },
                { name: { contains: query.search, mode: 'insensitive' } },
            ];
        }
        // If tenant context is available, filter by tenant
        if (req.tenantId) {
            where.memberships = {
                some: {
                    tenantId: req.tenantId,
                },
            };
        }
        // Fetch users with pagination
        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                select: {
                    id: true,
                    email: true,
                    name: true,
                    createdAt: true,
                    updatedAt: true,
                    memberships: {
                        where: req.tenantId ? { tenantId: req.tenantId } : undefined,
                        select: {
                            role: true,
                            tenantId: true,
                        },
                    },
                },
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            prisma.user.count({ where }),
        ]);
        res.json({
            users,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    }
    catch (err) {
        console.error('List users error:', err);
        if (err instanceof z.ZodError) {
            return res.status(400).json({
                error: 'Invalid query parameters',
                issues: err.flatten(),
            });
        }
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({
            error: 'Failed to list users',
            details: errorMessage,
        });
    }
};
export const getUser = async (req, res) => {
    try {
        const { userId } = req.params;
        // Fetch user from database
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true,
                createdAt: true,
                updatedAt: true,
                memberships: {
                    include: {
                        tenant: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                },
            },
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    }
    catch (err) {
        console.error('Get user error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({
            error: 'Failed to fetch user',
            details: errorMessage,
        });
    }
};
