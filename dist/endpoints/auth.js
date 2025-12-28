import { z } from 'zod';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { publicFactory, publicWithRequestFactory, authFactory } from '../factories';
import prisma from '../utils/prisma';
import createHttpError from 'http-errors';
import { createAuditLog, extractAuditContext, AuditActions } from '../utils/audit';
// Read secrets lazily to ensure dotenv has loaded
const getJwtSecret = () => process.env.JWT_SECRET || 'dev-secret';
const getJwtExpiresIn = () => process.env.JWT_EXPIRES_IN || '15m';
const getRefreshTokenExpiresIn = () => process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
const BCRYPT_ROUNDS = 10;
// Helper to get signup settings
async function getSignupSettings() {
    const settings = await prisma.settings.findFirst();
    return {
        signupMode: (settings?.signupMode ?? 'disabled'),
        allowedSignupDomains: settings?.allowedSignupDomains ?? [],
    };
}
// Helper to extract domain from email
function getEmailDomain(email) {
    return email.split('@')[1]?.toLowerCase() ?? '';
}
// Register endpoint
export const registerEndpoint = publicWithRequestFactory.build({
    method: 'post',
    shortDescription: 'User Registration',
    description: 'Registers a new user. First user becomes admin, subsequent users are staff. Signup may be restricted by admin settings.',
    tag: 'Auth',
    input: z.object({
        email: z.email(),
        password: z.string().min(8),
        name: z.string().min(1),
    }),
    output: z.object({
        accessToken: z.string(),
        refreshToken: z.string(),
        expiresIn: z.number(),
        user: z.object({
            id: z.string(),
            email: z.string(),
            name: z.string(),
            role: z.enum(['admin', 'manager', 'staff']),
        }),
    }),
    handler: async ({ input, ctx }) => {
        // Check if this is the first user (first user always allowed to register)
        const userCount = await prisma.user.count();
        const isFirstUser = userCount === 0;
        // Check signup restrictions (only for non-first users)
        if (!isFirstUser) {
            const { signupMode, allowedSignupDomains } = await getSignupSettings();
            if (signupMode === 'disabled') {
                throw createHttpError(403, 'Signup is currently disabled. Please contact an administrator.');
            }
            if (signupMode === 'domain_restricted') {
                const emailDomain = getEmailDomain(input.email);
                const isAllowed = allowedSignupDomains.some((domain) => domain.toLowerCase() === emailDomain);
                if (!isAllowed) {
                    throw createHttpError(403, 'Signup is restricted to specific email domains. Please contact an administrator.');
                }
            }
        }
        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email: input.email },
        });
        if (existingUser) {
            throw createHttpError(400, 'User with this email already exists');
        }
        // Hash password
        const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
        // Create user with appropriate role
        const user = await prisma.user.create({
            data: {
                email: input.email,
                passwordHash,
                name: input.name,
                role: isFirstUser ? 'ADMIN' : 'STAFF',
            },
        });
        // Audit log the registration
        const auditContext = extractAuditContext(ctx.request, {
            sub: user.id,
        });
        await createAuditLog({
            action: AuditActions.auth.register,
            resourceType: 'user',
            resourceId: user.id,
            metadata: {
                email: user.email,
                role: user.role,
                isFirstUser,
            },
            context: auditContext,
        });
        // Map database role to JWT role
        const jwtRole = user.role.toLowerCase();
        // Generate tokens
        const accessToken = jwt.sign({
            sub: user.id,
            role: jwtRole,
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
                role: jwtRole,
            },
        };
    },
});
// Login endpoint
export const loginEndpoint = publicWithRequestFactory.build({
    method: 'post',
    shortDescription: 'User Login',
    description: 'Authenticates a user and returns access and refresh tokens.',
    tag: 'Auth',
    input: z.object({
        email: z.email(),
        password: z.string().min(1),
    }),
    output: z.object({
        accessToken: z.string(),
        refreshToken: z.string(),
        expiresIn: z.number(),
        user: z.object({
            id: z.string(),
            email: z.string(),
            name: z.string(),
            role: z.enum(['admin', 'manager', 'staff']),
        }),
    }),
    handler: async ({ input, ctx }) => {
        // Find user by email
        const user = await prisma.user.findUnique({
            where: { email: input.email },
        });
        if (!user || !user.passwordHash) {
            throw createHttpError(401, 'Invalid email or password');
        }
        // Verify password
        const isValidPassword = await bcrypt.compare(input.password, user.passwordHash);
        if (!isValidPassword) {
            throw createHttpError(401, 'Invalid email or password');
        }
        // Map database role to JWT role
        const jwtRole = user.role.toLowerCase();
        // Generate tokens
        const accessToken = jwt.sign({
            sub: user.id,
            role: jwtRole,
        }, getJwtSecret(), { expiresIn: getJwtExpiresIn(), algorithm: 'HS256' });
        const refreshToken = jwt.sign({
            sub: user.id,
            type: 'refresh',
        }, getJwtSecret(), { expiresIn: getRefreshTokenExpiresIn(), algorithm: 'HS256' });
        // Audit log the login
        const auditContext = extractAuditContext(ctx.request, {
            sub: user.id,
        });
        await createAuditLog({
            action: AuditActions.auth.login,
            resourceType: 'user',
            resourceId: user.id,
            metadata: {
                email: user.email,
                role: user.role,
            },
            context: auditContext,
        });
        return {
            accessToken,
            refreshToken,
            expiresIn: 900,
            user: {
                id: user.id,
                email: user.email,
                name: user.name || '',
                role: jwtRole,
            },
        };
    },
});
// Refresh token endpoint
export const refreshEndpoint = publicFactory.build({
    method: 'post',
    shortDescription: 'Token Refresh',
    description: 'Refreshes the access token using a valid refresh token.',
    tag: 'Auth',
    input: z.object({
        refreshToken: z.string(),
    }),
    output: z.object({
        accessToken: z.string(),
        refreshToken: z.string(),
        expiresIn: z.number(),
    }),
    handler: async ({ input }) => {
        try {
            // Verify refresh token
            const decoded = jwt.verify(input.refreshToken, getJwtSecret(), {
                algorithms: ['HS256'],
            });
            // Check if it's a refresh token
            if (decoded.type !== 'refresh') {
                throw createHttpError(401, 'Invalid token type');
            }
            // Get user
            const user = await prisma.user.findUnique({
                where: { id: decoded.sub },
            });
            if (!user) {
                throw createHttpError(401, 'User not found');
            }
            // Map database role to JWT role
            const jwtRole = user.role.toLowerCase();
            // Generate new tokens
            const accessToken = jwt.sign({
                sub: user.id,
                role: jwtRole,
            }, getJwtSecret(), { expiresIn: getJwtExpiresIn(), algorithm: 'HS256' });
            const newRefreshToken = jwt.sign({
                sub: user.id,
                type: 'refresh',
            }, getJwtSecret(), { expiresIn: getRefreshTokenExpiresIn(), algorithm: 'HS256' });
            return {
                accessToken,
                refreshToken: newRefreshToken,
                expiresIn: 900,
            };
        }
        catch (err) {
            if (err &&
                typeof err === 'object' &&
                'name' in err &&
                (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')) {
                throw createHttpError(401, 'Invalid or expired refresh token');
            }
            throw err;
        }
    },
});
// Logout endpoint (returns 204)
export const logoutEndpoint = publicFactory.build({
    method: 'post',
    shortDescription: 'User Logout',
    description: 'Logs out the user. (No-op for stateless JWT)',
    tag: 'Auth',
    input: z.object({}),
    output: z.object({}),
    handler: async () => {
        // No-op for stateless JWT
        return {};
    },
});
// Password reset token expiry (1 hour)
const PASSWORD_RESET_EXPIRES_IN = '1h';
// Forgot password endpoint
export const forgotPasswordEndpoint = publicFactory.build({
    method: 'post',
    shortDescription: 'Forgot Password',
    description: 'Sends a password reset email to the user if the email exists.',
    tag: 'Auth',
    input: z.object({
        email: z.email(),
    }),
    output: z.object({
        success: z.boolean(),
        message: z.string(),
    }),
    handler: async ({ input }) => {
        // Always return success to prevent email enumeration
        const successResponse = {
            success: true,
            message: 'If an account with that email exists, a password reset link has been sent.',
        };
        // Find user by email
        const user = await prisma.user.findUnique({
            where: { email: input.email },
        });
        if (!user) {
            // Don't reveal that email doesn't exist
            return successResponse;
        }
        // Generate password reset token (JWT with short expiry)
        const resetToken = jwt.sign({
            sub: user.id,
            type: 'password_reset',
            email: user.email,
        }, getJwtSecret(), { expiresIn: PASSWORD_RESET_EXPIRES_IN, algorithm: 'HS256' });
        // Get app URL from environment
        const appUrl = process.env.APP_URL || 'http://localhost:5173';
        // Build reset URL
        const resetUrl = `${appUrl}/reset-password?token=${resetToken}`;
        // Send password reset email using the provider registry
        try {
            const { providerRegistry } = await import('../providers/registry');
            const emailProvider = providerRegistry.getForChannel('EMAIL');
            if (emailProvider) {
                await emailProvider.send({
                    to: user.email,
                    subject: 'Reset Your Password',
                    body: `Click the link below to reset your password. This link expires in 1 hour.\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
                    html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #0a0a0a;">Reset Your Password</h2>
              <p>Click the button below to reset your password. This link expires in 1 hour.</p>
              <p style="margin: 24px 0;">
                <a href="${resetUrl}" style="background-color: #0a0a0a; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                  Reset Password
                </a>
              </p>
              <p style="color: #666; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
              <p style="color: #999; font-size: 12px; margin-top: 32px;">
                Or copy this link: ${resetUrl}
              </p>
            </div>
          `,
                });
            }
        }
        catch (error) {
            console.error('Failed to send password reset email:', error);
            // Still return success to prevent email enumeration
        }
        return successResponse;
    },
});
// Reset password endpoint
export const resetPasswordEndpoint = publicFactory.build({
    method: 'post',
    shortDescription: 'Reset Password',
    description: 'Resets the user password using a valid reset token.',
    tag: 'Auth',
    input: z.object({
        token: z.string(),
        password: z.string().min(8, 'Password must be at least 8 characters'),
    }),
    output: z.object({
        success: z.boolean(),
        message: z.string(),
    }),
    handler: async ({ input }) => {
        try {
            // Verify the reset token
            const decoded = jwt.verify(input.token, getJwtSecret(), {
                algorithms: ['HS256'],
            });
            // Check if it's a password reset token
            if (decoded.type !== 'password_reset') {
                throw createHttpError(400, 'Invalid reset token');
            }
            // Find user
            const user = await prisma.user.findUnique({
                where: { id: decoded.sub },
            });
            if (!user) {
                throw createHttpError(400, 'Invalid reset token');
            }
            // Verify email matches (extra security)
            if (decoded.email !== user.email) {
                throw createHttpError(400, 'Invalid reset token');
            }
            // Hash new password
            const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
            // Update user password
            await prisma.user.update({
                where: { id: user.id },
                data: { passwordHash },
            });
            return {
                success: true,
                message: 'Password has been reset successfully. You can now log in with your new password.',
            };
        }
        catch (err) {
            if (err &&
                typeof err === 'object' &&
                'name' in err &&
                (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')) {
                throw createHttpError(400, 'Invalid or expired reset token. Please request a new password reset.');
            }
            throw err;
        }
    },
});
// Get current user endpoint
export const meEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'Get Current User',
    description: 'Returns information about the currently authenticated user.',
    tag: 'Auth',
    input: z.object({}),
    output: z.object({
        id: z.string(),
        role: z.enum(['admin', 'manager', 'staff']),
    }),
    handler: async ({ ctx }) => {
        const user = ctx.user;
        return {
            id: user.sub,
            role: user.role,
        };
    },
});
