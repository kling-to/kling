import { Middleware, defaultEndpointsFactory } from 'express-zod-api';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import createHttpError from 'http-errors';
// Read JWT_SECRET lazily to ensure dotenv has loaded
const getJwtSecret = () => process.env.JWT_SECRET || 'dev-secret';
// Authentication middleware - exposes user and request in context
export const authMiddleware = new Middleware({
    input: z.object({}),
    handler: async ({ request }) => {
        const auth = request.headers.authorization;
        if (!auth || !auth.startsWith('Bearer ')) {
            throw createHttpError(401, 'Missing authorization header');
        }
        const token = auth.slice('Bearer '.length).trim();
        try {
            const payload = jwt.verify(token, getJwtSecret(), {
                algorithms: ['HS256'],
            });
            if (!payload || !payload.sub || !payload.role) {
                throw createHttpError(401, 'Invalid token payload');
            }
            return {
                user: payload,
                request: {
                    headers: request.headers,
                    ip: request.ip,
                    body: request.body,
                },
            };
        }
        catch {
            throw createHttpError(401, 'Invalid or expired token');
        }
    },
});
// Role-based access control middleware factory
// Roles hierarchy: admin > manager > staff
export const createRoleMiddleware = (...allowed) => new Middleware({
    input: z.object({}),
    handler: async ({ request }) => {
        const auth = request.headers.authorization;
        if (!auth || !auth.startsWith('Bearer ')) {
            throw createHttpError(401, 'Missing authorization header');
        }
        const token = auth.slice('Bearer '.length).trim();
        try {
            const payload = jwt.verify(token, getJwtSecret(), {
                algorithms: ['HS256'],
            });
            if (!payload || !payload.sub || !payload.role) {
                throw createHttpError(401, 'Invalid token payload');
            }
            if (allowed.includes(payload.role)) {
                return {
                    user: payload,
                    request: {
                        headers: request.headers,
                        ip: request.ip,
                        body: request.body,
                    },
                };
            }
            throw createHttpError(403, 'Forbidden: insufficient role');
        }
        catch (err) {
            if (err instanceof Error && err.message.includes('Forbidden')) {
                throw err;
            }
            throw createHttpError(401, 'Invalid or expired token');
        }
    },
});
// Public middleware that exposes request in context
export const publicWithRequestMiddleware = new Middleware({
    input: z.object({}),
    handler: async ({ request }) => {
        return {
            request: {
                headers: request.headers,
                ip: request.ip,
                body: request.body,
            },
        };
    },
});
// Base factory (no authentication)
export const publicFactory = defaultEndpointsFactory;
// Public factory with request access
export const publicWithRequestFactory = defaultEndpointsFactory.addMiddleware(publicWithRequestMiddleware);
// Authenticated factory
export const authFactory = defaultEndpointsFactory.addMiddleware(authMiddleware);
// Factory with role requirement
export const createAuthRoleFactory = (...roles) => defaultEndpointsFactory.addMiddleware(createRoleMiddleware(...roles));
