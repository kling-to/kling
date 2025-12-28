import { z } from 'zod';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createAuthRoleFactory, publicFactory, publicWithRequestFactory } from '../factories';
import prisma from '../utils/prisma';
import createHttpError from 'http-errors';
import { createAuditLog, extractAuditContext, AuditActions } from '../utils/audit';
import { objectIdSchema } from '../utils/validation';
// Read secrets lazily to ensure dotenv has loaded
const getJwtSecret = () => process.env.JWT_SECRET || 'dev-secret';
const getJwtExpiresIn = () => process.env.JWT_EXPIRES_IN || '15m';
const getRefreshTokenExpiresIn = () => process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
const BCRYPT_ROUNDS = 10;
const INVITE_EXPIRY_DAYS = 7;
// Factory for admin operations
const inviteFactory = createAuthRoleFactory('admin');
/**
 * Create an invitation.
 */
export const createInvitationEndpoint = inviteFactory.build({
    method: 'post',
    shortDescription: 'Create Invitation',
    description: 'Invites a user to join with a specified role.',
    tag: 'Invitations',
    input: z.object({
        email: z.email(),
        role: z.enum(['ADMIN', 'MANAGER', 'STAFF']).default('STAFF'),
    }),
    output: z.object({
        id: z.string(),
        email: z.string(),
        role: z.string(),
        token: z.string(),
        expiresAt: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email: input.email },
        });
        if (existingUser) {
            throw createHttpError(400, 'User already exists with this email');
        }
        // Check for existing pending invitation
        const existingInvite = await prisma.invitation.findFirst({
            where: {
                email: input.email,
                status: 'pending',
                expiresAt: { gt: new Date() },
            },
        });
        if (existingInvite) {
            throw createHttpError(400, 'An active invitation already exists for this email');
        }
        // Generate secure token
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);
        // Create invitation
        const invitation = await prisma.invitation.create({
            data: {
                email: input.email,
                role: input.role,
                token,
                expiresAt,
                invitedBy: ctx.user.sub,
                status: 'pending',
            },
        });
        // Audit log
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: AuditActions.member.invited,
            resourceType: 'invitation',
            resourceId: invitation.id,
            metadata: {
                email: input.email,
                role: input.role,
            },
            context: auditContext,
        });
        // TODO: Send invitation email with token
        console.log(`[Invitation] Token for ${input.email}: ${token}`);
        return {
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            token: invitation.token,
            expiresAt: invitation.expiresAt.toISOString(),
        };
    },
});
/**
 * List all invitations.
 */
export const listInvitationsEndpoint = inviteFactory.build({
    method: 'get',
    shortDescription: 'List Invitations',
    description: 'Lists all invitations.',
    tag: 'Invitations',
    input: z.object({}),
    output: z.object({
        invitations: z.array(z.object({
            id: z.string(),
            email: z.string(),
            role: z.string(),
            status: z.string(),
            expiresAt: z.string(),
            createdAt: z.string(),
        })),
    }),
    handler: async () => {
        const invitations = await prisma.invitation.findMany({
            orderBy: { createdAt: 'desc' },
        });
        return {
            invitations: invitations.map((inv) => ({
                id: inv.id,
                email: inv.email,
                role: inv.role,
                status: inv.status,
                expiresAt: inv.expiresAt.toISOString(),
                createdAt: inv.createdAt.toISOString(),
            })),
        };
    },
});
/**
 * Revoke a pending invitation.
 */
export const revokeInvitationEndpoint = inviteFactory.build({
    method: 'delete',
    shortDescription: 'Revoke Invitation',
    description: 'Revokes a pending invitation.',
    tag: 'Invitations',
    input: z.object({
        invitationId: objectIdSchema,
    }),
    output: z.object({
        success: z.boolean(),
    }),
    handler: async ({ input, ctx }) => {
        const invitation = await prisma.invitation.findFirst({
            where: {
                id: input.invitationId,
                status: 'pending',
            },
        });
        if (!invitation) {
            throw createHttpError(404, 'Invitation not found or already processed');
        }
        await prisma.invitation.update({
            where: { id: invitation.id },
            data: { status: 'revoked' },
        });
        // Audit log
        const auditContext = extractAuditContext(ctx.request, ctx.user);
        await createAuditLog({
            action: AuditActions.member.removed,
            resourceType: 'invitation',
            resourceId: invitation.id,
            metadata: {
                email: invitation.email,
                action: 'revoked',
            },
            context: auditContext,
        });
        return { success: true };
    },
});
/**
 * Accept an invitation.
 * Creates user account with the invited role.
 */
export const acceptInvitationEndpoint = publicWithRequestFactory.build({
    method: 'post',
    shortDescription: 'Accept Invitation',
    description: 'Accepts an invitation. Creates user account with assigned role.',
    tag: 'Invitations',
    input: z.object({
        token: z.string(),
        name: z.string().min(1),
        password: z.string().min(8),
    }),
    output: z.object({
        accessToken: z.string(),
        refreshToken: z.string(),
        expiresIn: z.number(),
        user: z.object({
            id: z.string(),
            email: z.string(),
            name: z.string(),
            role: z.string(),
        }),
    }),
    handler: async ({ input, ctx }) => {
        // Find invitation by token
        const invitation = await prisma.invitation.findFirst({
            where: {
                token: input.token,
                status: 'pending',
                expiresAt: { gt: new Date() },
            },
        });
        if (!invitation) {
            throw createHttpError(400, 'Invalid or expired invitation');
        }
        // Check if user already exists (shouldn't happen, but safety check)
        const existingUser = await prisma.user.findUnique({
            where: { email: invitation.email },
        });
        if (existingUser) {
            throw createHttpError(400, 'User already exists with this email');
        }
        // Create user with the invited role
        const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
        const user = await prisma.$transaction(async (tx) => {
            // Create user with role from invitation
            const newUser = await tx.user.create({
                data: {
                    email: invitation.email,
                    name: input.name,
                    passwordHash,
                    role: invitation.role,
                },
            });
            // Update invitation status
            await tx.invitation.update({
                where: { id: invitation.id },
                data: {
                    status: 'accepted',
                    acceptedBy: newUser.id,
                    acceptedAt: new Date(),
                },
            });
            return newUser;
        });
        // Audit log
        const auditContext = extractAuditContext(ctx.request, {
            sub: user.id,
        });
        await createAuditLog({
            action: AuditActions.member.joined,
            resourceType: 'user',
            resourceId: user.id,
            metadata: {
                email: user.email,
                role: invitation.role,
                invitationId: invitation.id,
            },
            context: auditContext,
        });
        // Generate tokens with the user's role
        const accessToken = jwt.sign({
            sub: user.id,
            role: user.role,
        }, getJwtSecret(), { expiresIn: getJwtExpiresIn(), algorithm: 'HS256' });
        const refreshToken = jwt.sign({
            sub: user.id,
            type: 'refresh',
        }, getJwtSecret(), { expiresIn: getRefreshTokenExpiresIn(), algorithm: 'HS256' });
        return {
            accessToken,
            refreshToken,
            expiresIn: 900,
            user: {
                id: user.id,
                email: user.email,
                name: user.name || '',
                role: user.role,
            },
        };
    },
});
/**
 * Validate an invitation token.
 */
export const validateInvitationEndpoint = publicFactory.build({
    method: 'get',
    shortDescription: 'Validate Invitation',
    description: 'Validates an invitation token and returns invitation details.',
    tag: 'Invitations',
    input: z.object({
        token: z.string(),
    }),
    output: z.object({
        valid: z.boolean(),
        email: z.string().optional(),
        role: z.string().optional(),
        expiresAt: z.string().optional(),
        userExists: z.boolean().optional(),
    }),
    handler: async ({ input }) => {
        const invitation = await prisma.invitation.findFirst({
            where: {
                token: input.token,
                status: 'pending',
                expiresAt: { gt: new Date() },
            },
        });
        if (!invitation) {
            return { valid: false };
        }
        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email: invitation.email },
        });
        return {
            valid: true,
            email: invitation.email,
            role: invitation.role,
            expiresAt: invitation.expiresAt.toISOString(),
            userExists: !!existingUser,
        };
    },
});
