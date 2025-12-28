/**
 * Internal API Endpoints
 *
 * These endpoints are used for cloud dashboard → installation communication.
 * They are authenticated via X-Internal-Key header matching the JWT secret.
 */
import { z } from 'zod';
import { internalFactory } from '../factories';
import prisma from '../utils/prisma';
import bcrypt from 'bcrypt';
import { createAuditLog, AuditActions } from '../utils/audit';
const BCRYPT_ROUNDS = 10;
/**
 * Update admin password endpoint
 *
 * Called by cloud dashboard when an installation's admin password is reset.
 * Updates the password for the user with the specified email.
 */
export const updateAdminPasswordEndpoint = internalFactory.build({
    method: 'post',
    shortDescription: 'Update Admin Password',
    description: 'Updates the password for an admin user. Internal API only.',
    tag: 'Internal',
    input: z.object({
        email: z.string().email(),
        newPassword: z.string().min(8),
    }),
    output: z.object({
        success: z.boolean(),
        message: z.string(),
    }),
    handler: async ({ input }) => {
        const { email, newPassword } = input;
        // Hash the password
        const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
        // Upsert - create user if doesn't exist, update password if does
        const user = await prisma.user.upsert({
            where: { email },
            create: {
                email,
                name: email.split('@')[0], // Default name from email
                passwordHash,
                role: 'ADMIN', // Cloud-provisioned users are admins
            },
            update: {
                passwordHash,
            },
        });
        // Create audit log
        await createAuditLog({
            action: AuditActions.settings.updated,
            resourceType: 'user',
            resourceId: user.id,
            metadata: {
                source: 'cloud_dashboard',
                action: 'password_sync',
            },
            context: {
            // No user ID since this is an internal API call from cloud dashboard
            },
        });
        return {
            success: true,
            message: 'Admin password synced successfully',
        };
    },
});
/**
 * Health check for internal API
 *
 * Simple endpoint to verify the installation is reachable and responsive.
 */
export const internalHealthEndpoint = internalFactory.build({
    method: 'get',
    shortDescription: 'Internal Health Check',
    description: 'Health check for internal API.',
    tag: 'Internal',
    input: z.object({}),
    output: z.object({
        status: z.literal('ok'),
        timestamp: z.string(),
    }),
    handler: async () => {
        return {
            status: 'ok',
            timestamp: new Date().toISOString(),
        };
    },
});
