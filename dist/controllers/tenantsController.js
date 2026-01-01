import { z } from 'zod';
import prisma from '../utils/prisma';
const createTenantSchema = z.object({
    name: z.string().min(1),
    timezone: z.string().optional(),
    currency: z.string().optional(),
});
export const createTenant = async (req, res) => {
    try {
        // Validate request body
        const body = createTenantSchema.parse(req.body);
        // Get authenticated user
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const userId = req.user.sub;
        // Create tenant with user as owner
        const result = await prisma.$transaction(async (tx) => {
            const tenant = await tx.tenant.create({
                data: {
                    name: body.name,
                    ownerId: userId,
                },
            });
            // Create tenant membership with OWNER role
            await tx.tenantMember.create({
                data: {
                    userId,
                    tenantId: tenant.id,
                    role: 'OWNER',
                },
            });
            return tenant;
        });
        res.status(201).json(result);
    }
    catch (err) {
        console.error('Create tenant error:', err);
        if (err instanceof z.ZodError) {
            return res.status(400).json({
                error: 'Invalid data',
                issues: err.flatten(),
            });
        }
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({
            error: 'Failed to create tenant',
            details: errorMessage,
        });
    }
};
export const getTenant = async (req, res) => {
    try {
        const { tenantId } = req.params;
        // Fetch tenant from database
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
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
            return res.status(404).json({ error: 'Tenant not found' });
        }
        res.json(tenant);
    }
    catch (err) {
        console.error('Get tenant error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({
            error: 'Failed to fetch tenant',
            details: errorMessage,
        });
    }
};
