/**
 * Setup Endpoints
 *
 * These endpoints handle first-time setup of the installation.
 * The setup flow allows the first user to create an admin account.
 */
import { z } from 'zod';
import { publicFactory } from '../factories';
import prisma from '../utils/prisma';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
const BCRYPT_ROUNDS = 10;
const getJwtSecret = () => process.env.JWT_SECRET || 'dev-secret';
const getJwtExpiresIn = () => process.env.JWT_EXPIRES_IN || '15m';
const getRefreshTokenExpiresIn = () => process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
/**
 * Check if setup is required
 *
 * Returns true if no users exist in the database (first-time setup needed)
 */
export const setupStatusEndpoint = publicFactory.build({
    method: 'get',
    shortDescription: 'Check Setup Status',
    description: 'Check if initial setup is required (no users exist)',
    tag: 'Setup',
    input: z.object({}),
    output: z.object({
        needsSetup: z.boolean(),
    }),
    handler: async () => {
        const userCount = await prisma.user.count();
        return {
            needsSetup: userCount === 0,
        };
    },
});
/**
 * Create the first admin user
 *
 * This endpoint only works when no users exist in the database.
 * It creates an admin user and returns JWT tokens for immediate login.
 */
export const createAdminEndpoint = publicFactory.build({
    method: 'post',
    shortDescription: 'Create Admin Account',
    description: 'Create the first admin account during initial setup',
    tag: 'Setup',
    input: z.object({
        email: z.string().email('Invalid email address'),
        password: z.string().min(8, 'Password must be at least 8 characters'),
        name: z.string().min(1).optional(),
    }),
    output: z.object({
        success: z.boolean(),
        accessToken: z.string().optional(),
        refreshToken: z.string().optional(),
        user: z
            .object({
            id: z.string(),
            email: z.string(),
            name: z.string().nullable(),
            role: z.string(),
        })
            .optional(),
        error: z.string().optional(),
    }),
    handler: async ({ input }) => {
        const { email, password, name } = input;
        // Use a transaction to prevent race conditions
        // Check user count and create atomically
        try {
            const result = await prisma.$transaction(async (tx) => {
                // Check if any users exist
                const userCount = await tx.user.count();
                if (userCount > 0) {
                    throw new Error('Setup has already been completed');
                }
                // Hash password
                const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
                // Create admin user
                const user = await tx.user.create({
                    data: {
                        email,
                        passwordHash,
                        name: name || email.split('@')[0],
                        role: 'ADMIN',
                    },
                });
                return user;
            });
            // Generate tokens (matching auth.ts format)
            const jwtRole = result.role.toLowerCase();
            const accessToken = jwt.sign({
                sub: result.id,
                role: jwtRole,
            }, getJwtSecret(), { expiresIn: getJwtExpiresIn(), algorithm: 'HS256' });
            const refreshToken = jwt.sign({
                sub: result.id,
                type: 'refresh',
            }, getJwtSecret(), { expiresIn: getRefreshTokenExpiresIn(), algorithm: 'HS256' });
            return {
                success: true,
                accessToken,
                refreshToken,
                user: {
                    id: result.id,
                    email: result.email,
                    name: result.name,
                    role: result.role,
                },
            };
        }
        catch (error) {
            if (error instanceof Error && error.message === 'Setup has already been completed') {
                return {
                    success: false,
                    error: 'Setup has already been completed. Please use the login page.',
                };
            }
            throw error;
        }
    },
});
