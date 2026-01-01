import { Middleware, defaultEndpointsFactory } from 'express-zod-api';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import createHttpError from 'http-errors';
const getJwtSecret = () => process.env.JWT_SECRET || 'dev-secret';
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
export const publicFactory = defaultEndpointsFactory;
export const publicWithRequestFactory = defaultEndpointsFactory.addMiddleware(publicWithRequestMiddleware);
export const authFactory = defaultEndpointsFactory.addMiddleware(authMiddleware);
export const createAuthRoleFactory = (...roles) => defaultEndpointsFactory.addMiddleware(createRoleMiddleware(...roles));
