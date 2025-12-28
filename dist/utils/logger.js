import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import path from "path";
const isDevelopment = process.env.NODE_ENV === "development";
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? "debug" : "info");
// Custom format for development (colorized, pretty)
const developmentFormat = winston.format.combine(winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), winston.format.errors({ stack: true }), winston.format.colorize(), winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
        // Remove empty objects and service metadata
        const cleanMeta = Object.fromEntries(Object.entries(meta).filter(([key, v]) => v !== undefined && v !== null && key !== "service"));
        if (Object.keys(cleanMeta).length > 0) {
            log += ` ${JSON.stringify(cleanMeta)}`;
        }
    }
    return log;
}));
// Production format (JSON for log aggregation)
const productionFormat = winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json());
// Create transports
const transports = [
    // Console output
    new winston.transports.Console({
        format: isDevelopment ? developmentFormat : productionFormat,
    }),
];
// Add file rotation in production
if (!isDevelopment) {
    const logsDir = process.env.LOGS_DIR || path.join(process.cwd(), "logs");
    // Error logs
    transports.push(new DailyRotateFile({
        filename: path.join(logsDir, "error-%DATE%.log"),
        datePattern: "YYYY-MM-DD",
        level: "error",
        maxSize: "20m",
        maxFiles: "14d",
        zippedArchive: true,
    }));
    // Combined logs
    transports.push(new DailyRotateFile({
        filename: path.join(logsDir, "combined-%DATE%.log"),
        datePattern: "YYYY-MM-DD",
        maxSize: "20m",
        maxFiles: "14d",
        zippedArchive: true,
    }));
}
// Create logger instance
export const logger = winston.createLogger({
    level: logLevel,
    format: productionFormat, // Default format (overridden by transport)
    defaultMeta: { service: "kling-backend" },
    transports,
    exitOnError: false,
});
// Create child logger with additional context
export function createChildLogger(context) {
    return logger.child(context);
}
// Graceful shutdown
process.on("SIGTERM", () => {
    logger.info("SIGTERM received, closing logger");
    logger.end();
});
export default logger;
