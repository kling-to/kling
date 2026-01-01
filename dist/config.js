import { createConfig, Documentation } from 'express-zod-api';
import { z } from 'zod';
import { apiReference } from '@scalar/express-api-reference';
import helmet from 'helmet';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import routing from './routing';
import { correlationIdMiddleware } from './middlewares/correlation-id.js';
import { globalLimiter, authLimiter, campaignLimiter, nlParsingLimiter, eventIngestionLimiter, webhookLimiter, adminLimiter, } from './middlewares/rate-limit.js';
import { logger } from './utils/logger.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
const { version } = packageJson;
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
        app.use(helmet({
            contentSecurityPolicy: false,
            crossOriginEmbedderPolicy: false,
        }));
        app.use(correlationIdMiddleware);
        app.use('/v1', globalLimiter);
        app.use('/v1/auth/login', authLimiter);
        app.use('/v1/auth/register', authLimiter);
        app.use('/v1/campaigns', (req, res, next) => {
            if (req.method === 'POST' && !req.path.includes('/from-natural-language')) {
                return campaignLimiter(req, res, next);
            }
            next();
        });
        app.use('/v1/campaigns/from-natural-language', nlParsingLimiter);
        app.use('/v1/events/ingest', eventIngestionLimiter);
        app.use('/v1/webhooks', webhookLimiter);
        app.use('/v1/admin', (req, res, next) => {
            if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) {
                return adminLimiter(req, res, next);
            }
            next();
        });
        logger.info('Serving API documentation at /docs');
        app.use('/docs', apiReference({
            pageTitle: 'Kling API Documentation',
            content: new Documentation({
                config: commonConfig,
                routing,
                title: 'Kling API - Self-hosted Marketing Automation for E-commerce',
                version,
                serverUrl: 'http://localhost:3001',
                hasHeadMethod: false,
            }).getSpecAsJson(),
        }));
        const publicPath = path.join(__dirname, '..', 'public');
        app.use(express.static(publicPath));
        app.get('/{*path}', (req, res, next) => {
            if (req.path.startsWith('/v1') || req.path.startsWith('/docs')) {
                return next();
            }
            res.sendFile(path.join(publicPath, 'index.html'), (err) => {
                if (err) {
                    next();
                }
            });
        });
    },
});
export default config;
export const userPayloadSchema = z.object({
    sub: z.string(),
    role: z.enum(['admin', 'manager', 'staff']),
    scopes: z.array(z.string()).optional(),
});
