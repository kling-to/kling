/**
 * Audit Log Cleanup Utility
 *
 * Deletes audit logs older than the configured retention period.
 * Default retention: 7 days (1 week)
 * Minimum retention: 1 day (hard limit enforced in settings)
 */
import prisma from './prisma';
/**
 * Get the audit log retention period from settings
 * Returns the number of days to retain audit logs (minimum 1 day)
 */
export async function getAuditLogRetentionDays() {
    const settings = await prisma.settings.findFirst();
    const days = settings?.auditLogRetentionDays ?? 7; // Default to 7 days
    return Math.max(1, days); // Enforce minimum of 1 day
}
/**
 * Calculate the cutoff date for audit log cleanup
 * Logs older than this date will be deleted
 */
export function calculateCutoffDate(retentionDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    cutoff.setHours(0, 0, 0, 0); // Start of day for clean cutoff
    return cutoff;
}
/**
 * Delete audit logs older than the retention period
 * Returns the number of deleted records
 */
export async function cleanupAuditLogs() {
    try {
        const retentionDays = await getAuditLogRetentionDays();
        const cutoffDate = calculateCutoffDate(retentionDays);
        const result = await prisma.auditLog.deleteMany({
            where: {
                createdAt: {
                    lt: cutoffDate,
                },
            },
        });
        console.log(`[AuditCleanup] Deleted ${result.count} audit logs older than ${retentionDays} days (cutoff: ${cutoffDate.toISOString()})`);
        return {
            deletedCount: result.count,
            retentionDays,
            cutoffDate,
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[AuditCleanup] Failed to cleanup audit logs: ${errorMessage}`);
        return {
            deletedCount: 0,
            retentionDays: 7,
            cutoffDate: new Date(),
            error: errorMessage,
        };
    }
}
/**
 * Get stats about audit logs for monitoring
 */
export async function getAuditLogStats() {
    const retentionDays = await getAuditLogRetentionDays();
    const cutoffDate = calculateCutoffDate(retentionDays);
    const [totalCount, logsToDelete, oldestLog, newestLog] = await Promise.all([
        prisma.auditLog.count(),
        prisma.auditLog.count({
            where: {
                createdAt: {
                    lt: cutoffDate,
                },
            },
        }),
        prisma.auditLog.findFirst({
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
        }),
        prisma.auditLog.findFirst({
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
        }),
    ]);
    return {
        totalCount,
        oldestLog: oldestLog?.createdAt ?? null,
        newestLog: newestLog?.createdAt ?? null,
        retentionDays,
        logsToDelete,
    };
}
