import { createConfig, Documentation } from 'express-zod-api';
import { z } from 'zod';
import { apiReference } from '@scalar/express-api-reference';
import helmet from 'helmet';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import routing from './routing';
import { correlationIdMiddleware } from './middlewares/correlation-id.js';
import { globalLimiter, authLimiter, campaignLimiter, nlParsingLimiter, eventIngestionLimiter, webhookLimiter, adminLimiter, } from './middlewares/rate-limit.js';
import { logger } from './utils/logger.js';
const commonConfig = {
    http: {
        listen: Number(process.env.PORT) || 3001,
    },
    cors: true,
    logger: {
        level: 'info',
        color: true,
    },
    startupLogo: false,
};
const config = createConfig({
    ...commonConfig,
    beforeRouting: ({ app }) => {
        // Security headers with Helmet
        app.use(helmet({
            contentSecurityPolicy: false, // Disable CSP for API
            crossOriginEmbedderPolicy: false,
        }));
        // Correlation ID for request tracing
        app.use(correlationIdMiddleware);
        // Global rate limit (100 requests per 15 min per IP)
        app.use('/v1', globalLimiter);
        // Stricter limits on auth routes
        app.use('/v1/auth/login', authLimiter);
        app.use('/v1/auth/register', authLimiter);
        // Campaign creation limits
        app.use('/v1/campaigns', (req, res, next) => {
            if (req.method === 'POST' && !req.path.includes('/from-natural-language')) {
                return campaignLimiter(req, res, next);
            }
            next();
        });
        // Natural language parsing limits
        app.use('/v1/campaigns/from-natural-language', nlParsingLimiter);
        // Event ingestion limits
        app.use('/v1/events/ingest', eventIngestionLimiter);
        // Webhook limits
        app.use('/v1/webhooks', webhookLimiter);
        // Admin operation limits (mutating operations only)
        app.use('/v1/admin', (req, res, next) => {
            if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) {
                return adminLimiter(req, res, next);
            }
            next();
        });
        // API documentation
        logger.info('Serving API documentation at /docs');
        app.use('/docs', apiReference({
            pageTitle: 'Kling API Documentation',
            content: new Documentation({
                config: commonConfig,
                routing,
                title: 'Kling API Documentation',
                version: '1.0.0',
                serverUrl: 'http://localhost:3001',
                hasHeadMethod: false,
            }).getSpecAsJson(),
        }));
        // Serve frontend static files in production
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const publicPath = path.join(__dirname, '..', 'public');
        // Serve static files
        app.use(express.static(publicPath));
        // SPA fallback - serve index.html for all non-API routes
        // Using '{*path}' syntax for Express 5's path-to-regexp
        app.get('/{*path}', (req, res, next) => {
            // Skip API routes and docs
            if (req.path.startsWith('/v1') || req.path.startsWith('/docs')) {
                return next();
            }
            res.sendFile(path.join(publicPath, 'index.html'), (err) => {
                if (err) {
                    // File doesn't exist (dev mode), continue to next handler
                    next();
                }
            });
        });
    },
});
export default config;
// User payload schema for authentication
// Roles: admin (full control), manager (campaigns/customers/templates), staff (read-only)
export const userPayloadSchema = z.object({
    sub: z.string(),
    role: z.enum(['admin', 'manager', 'staff']),
    scopes: z.array(z.string()).optional(),
});
