import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import prisma from '../utils/prisma';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
const BCRYPT_ROUNDS = 10;
// Validation schemas
const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1),
    tenantName: z.string().min(1),
});
const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});
const refreshSchema = z.object({
    refreshToken: z.string(),
});
export const register = async (req, res) => {
    try {
        // Validate request body
        const body = registerSchema.parse(req.body);
        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email: body.email },
        });
        if (existingUser) {
            return res.status(400).json({ error: 'User with this email already exists' });
        }
        // Hash password
        const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
        // Create user and tenant in a transaction
        const result = await prisma.$transaction(async (tx) => {
            // Create user
            const user = await tx.user.create({
                data: {
                    email: body.email,
                    passwordHash,
                    name: body.name,
                },
            });
            // Create tenant with user as owner
            const tenant = await tx.tenant.create({
                data: {
                    name: body.tenantName,
                    ownerId: user.id,
                },
            });
            // Create tenant membership
            await tx.tenantMember.create({
                data: {
                    userId: user.id,
                    tenantId: tenant.id,
                    role: 'OWNER',
                },
            });
            return { user, tenant };
        });
        // Generate tokens
        const accessToken = jwt.sign({
            sub: result.user.id,
            role: 'tenant_admin',
            tenantId: result.tenant.id,
        }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' });
        const refreshToken = jwt.sign({
            sub: result.user.id,
            type: 'refresh',
        }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRES_IN, algorithm: 'HS256' });
        res.status(201).json({
            accessToken,
            refreshToken,
            expiresIn: 900,
            user: {
                id: result.user.id,
                email: result.user.email,
                name: result.user.name,
            },
            tenant: {
                id: result.tenant.id,
                name: result.tenant.name,
            },
        });
    }
    catch (err) {
        console.error('Registration error:', err);
        if (err instanceof z.ZodError) {
            return res.status(400).json({
                error: 'Invalid data',
                issues: err.flatten(),
            });
        }
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({
            error: 'Failed to register user',
            details: errorMessage,
        });
    }
};
export const login = async (req, res) => {
    try {
        // Validate request body
        const body = loginSchema.parse(req.body);
        // Find user by email
        const user = await prisma.user.findUnique({
            where: { email: body.email },
            include: {
                memberships: {
                    include: {
                        tenant: true,
                    },
                    take: 1,
                },
            },
        });
        if (!user || !user.passwordHash) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        // Verify password
        const isValidPassword = await bcrypt.compare(body.password, user.passwordHash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        // Get primary tenant (first membership)
        const primaryMembership = user.memberships[0];
        if (!primaryMembership) {
            return res.status(403).json({ error: 'User has no tenant memberships' });
        }
        // Generate tokens
        const accessToken = jwt.sign({
            sub: user.id,
            role: 'tenant_admin',
            tenantId: primaryMembership.tenantId,
        }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' });
        const refreshToken = jwt.sign({
            sub: user.id,
            type: 'refresh',
        }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRES_IN, algorithm: 'HS256' });
        res.status(200).json({
            accessToken,
            refreshToken,
            expiresIn: 900,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
            },
            tenant: {
                id: primaryMembership.tenant.id,
                name: primaryMembership.tenant.name,
            },
        });
    }
    catch (err) {
        console.error('Login error:', err);
        if (err instanceof z.ZodError) {
            return res.status(400).json({
                error: 'Invalid data',
                issues: err.flatten(),
            });
        }
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({
            error: 'Failed to login',
            details: errorMessage,
        });
    }
};
export const refresh = async (req, res) => {
    try {
        // Validate request body
        const body = refreshSchema.parse(req.body);
        // Verify refresh token
        const decoded = jwt.verify(body.refreshToken, JWT_SECRET, {
            algorithms: ['HS256'],
        });
        // Check if it's a refresh token
        if (decoded.type !== 'refresh') {
            return res.status(401).json({ error: 'Invalid token type' });
        }
        // Get user and their primary tenant
        const user = await prisma.user.findUnique({
            where: { id: decoded.sub },
            include: {
                memberships: {
                    include: {
                        tenant: true,
                    },
                    take: 1,
                },
            },
        });
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }
        const primaryMembership = user.memberships[0];
        if (!primaryMembership) {
            return res.status(403).json({ error: 'User has no tenant memberships' });
        }
        // Generate new tokens
        const accessToken = jwt.sign({
            sub: user.id,
            role: 'tenant_admin',
            tenantId: primaryMembership.tenantId,
        }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' });
        const newRefreshToken = jwt.sign({
            sub: user.id,
            type: 'refresh',
        }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRES_IN, algorithm: 'HS256' });
        res.status(200).json({
            accessToken,
            refreshToken: newRefreshToken,
            expiresIn: 900,
        });
    }
    catch (err) {
        console.error('Refresh token error:', err);
        if (err instanceof z.ZodError) {
            return res.status(400).json({
                error: 'Invalid data',
                issues: err.flatten(),
            });
        }
        if (err &&
            typeof err === 'object' &&
            'name' in err &&
            (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')) {
            return res.status(401).json({
                error: 'Invalid or expired refresh token',
            });
        }
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({
            error: 'Failed to refresh token',
            details: errorMessage,
        });
    }
};
export const me = async (req, res) => {
    if (!req.user)
        return res.status(401).send();
    // You would normally load additional info from DB
    res.json({ id: req.user.sub, role: req.user.role, tenantId: req.user.tenantId });
};
