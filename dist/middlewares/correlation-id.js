import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
/**
 * Correlation ID middleware
 * Adds X-Correlation-ID header to all requests for distributed tracing
 */
export function correlationIdMiddleware(req, res, next) {
    // Get correlation ID from header or generate new one
    const correlationId = req.headers['x-correlation-id'] ||
        req.headers['x-request-id'] ||
        randomUUID();
    // Attach to request
    req.correlationId = correlationId;
    // Add to response headers
    res.setHeader('X-Correlation-ID', correlationId);
    // Create request-scoped logger
    req.requestLogger = logger.child({
        correlationId,
        method: req.method,
        path: req.path,
        ip: req.ip || req.headers['x-forwarded-for'],
    });
    next();
}
