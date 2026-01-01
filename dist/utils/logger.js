import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
const isDevelopment = process.env.NODE_ENV === 'development';
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');
const developmentFormat = winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston.format.errors({ stack: true }), winston.format.colorize(), winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
        const cleanMeta = Object.fromEntries(Object.entries(meta).filter(([key, v]) => v !== undefined && v !== null && key !== 'service'));
        if (Object.keys(cleanMeta).length > 0) {
            log += ` ${JSON.stringify(cleanMeta)}`;
        }
    }
    return log;
}));
const productionFormat = winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json());
const transports = [
    new winston.transports.Console({
        format: isDevelopment ? developmentFormat : productionFormat,
    }),
];
if (!isDevelopment) {
    const logsDir = process.env.LOGS_DIR || path.join(process.cwd(), 'logs');
    transports.push(new DailyRotateFile({
        filename: path.join(logsDir, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '20m',
        maxFiles: '14d',
        zippedArchive: true,
    }));
    transports.push(new DailyRotateFile({
        filename: path.join(logsDir, 'combined-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '14d',
        zippedArchive: true,
    }));
}
export const logger = winston.createLogger({
    level: logLevel,
    format: productionFormat,
    defaultMeta: { service: 'kling-backend' },
    transports,
    exitOnError: false,
});
export function createChildLogger(context) {
    return logger.child(context);
}
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, closing logger');
    logger.end();
});
export default logger;
