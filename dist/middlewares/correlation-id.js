import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
export function correlationIdMiddleware(req, res, next) {
    const correlationId = req.headers['x-correlation-id'] ||
        req.headers['x-request-id'] ||
        randomUUID();
    req.correlationId = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);
    req.requestLogger = logger.child({
        correlationId,
        method: req.method,
        path: req.path,
        ip: req.ip || req.headers['x-forwarded-for'],
    });
    next();
}
