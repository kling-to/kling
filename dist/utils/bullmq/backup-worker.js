/**
 * Database Backup Worker
 *
 * BullMQ worker that performs scheduled database backups using mongodump.
 * Uploads completed backups to S3 and manages retention policies.
 *
 * Default schedule: Daily at configured time (default 2:00 AM)
 * Retention: Configurable via settings (default 7 days)
 */
import { Worker, Queue } from 'bullmq';
import { getRedisConnection } from './connection';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import * as tar from 'tar';
import prisma from '../prisma';
import { uploadBackupToS3, deleteOldBackupsFromS3, isS3Configured } from '../s3-client';
const execAsync = promisify(exec);
// Queue name
export const BACKUP_QUEUE_NAME = 'backupQueue';
// Singleton instances
let backupQueue = null;
let backupWorker = null;
/**
 * Get or create the backup queue
 */
export function getBackupQueue() {
    if (!backupQueue) {
        backupQueue = new Queue(BACKUP_QUEUE_NAME, {
            connection: getRedisConnection(),
            defaultJobOptions: {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 60000, // 1 minute initial delay
                },
                removeOnComplete: {
                    age: 7 * 24 * 60 * 60, // Keep completed jobs for 7 days
                    count: 50,
                },
                removeOnFail: {
                    age: 30 * 24 * 60 * 60, // Keep failed jobs for 30 days
                },
            },
        });
    }
    return backupQueue;
}
/**
 * Parse DATABASE_URL to get connection details for mongodump
 */
function parseDatabaseUrl() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error('DATABASE_URL environment variable is not set');
    }
    // Extract database name from URL
    // Format: mongodb://user:pass@host:port/dbname?options
    // or mongodb+srv://user:pass@host/dbname?options
    const url = new URL(databaseUrl);
    const dbName = url.pathname.slice(1).split('?')[0]; // Remove leading / and query params
    if (!dbName) {
        throw new Error('Could not extract database name from DATABASE_URL');
    }
    return { uri: databaseUrl, dbName };
}
/**
 * Count documents in all collections
 */
async function countAllDocuments() {
    // Get all model names from Prisma
    const models = [
        'user',
        'customer',
        'order',
        'orderItem',
        'campaignDefinition',
        'messageLog',
        'auditLog',
        'consentLog',
        'customerEvent',
        'backup',
        'settings',
        'invitation',
        'flow',
        'flowEnrollment',
        'form',
        'formSubmission',
        'product',
        'browseEvent',
        'experiment',
        'experimentAssignment',
        'emailTemplate',
    ];
    let documentCount = 0;
    let collectionCount = 0;
    for (const model of models) {
        try {
            // @ts-expect-error - Dynamic model access
            const count = await prisma[model].count();
            if (count > 0) {
                documentCount += count;
                collectionCount++;
            }
        }
        catch {
            // Model might not exist or be empty, continue
        }
    }
    return { collectionCount, documentCount };
}
/**
 * Process database backup job
 */
async function processBackupJob(job) {
    console.log(`[BackupWorker] Starting backup job ${job.id}`);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.tar.gz`;
    const tempDir = path.join(os.tmpdir(), `kling-backup-${timestamp}`);
    const dumpDir = path.join(tempDir, 'dump');
    const archivePath = path.join(tempDir, filename);
    // Get database info
    const { uri, dbName } = parseDatabaseUrl();
    // Create backup record
    const backup = await prisma.backup.create({
        data: {
            filename,
            status: 'in_progress',
            type: job.data.triggeredBy,
            databaseName: dbName,
            triggeredBy: job.data.userId || 'system',
        },
    });
    try {
        // Create temp directory
        await fs.mkdir(tempDir, { recursive: true });
        // Count documents before backup
        const counts = await countAllDocuments();
        console.log(`[BackupWorker] Database ${dbName}: ${counts.collectionCount} collections, ${counts.documentCount} documents`);
        // Run mongodump
        console.log(`[BackupWorker] Running mongodump for database: ${dbName}`);
        const mongodumpCmd = `mongodump --uri="${uri}" --out="${dumpDir}"`;
        try {
            await execAsync(mongodumpCmd, { maxBuffer: 1024 * 1024 * 100 }); // 100MB buffer
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`mongodump failed: ${message}`);
        }
        // Create tar.gz archive
        console.log(`[BackupWorker] Creating archive: ${archivePath}`);
        await tar.create({
            gzip: true,
            file: archivePath,
            cwd: tempDir,
        }, ['dump']);
        // Get archive size
        const archiveStats = await fs.stat(archivePath);
        const sizeBytes = archiveStats.size;
        console.log(`[BackupWorker] Archive created: ${sizeBytes} bytes`);
        // Upload to S3 if configured
        let s3Key;
        let s3Bucket;
        const settings = await prisma.settings.findFirst();
        if (await isS3Configured()) {
            console.log(`[BackupWorker] Uploading to S3...`);
            const uploadResult = await uploadBackupToS3(archivePath, filename);
            s3Key = uploadResult.key;
            s3Bucket = uploadResult.bucket;
            // Run retention cleanup
            if (settings?.backupRetentionDays) {
                console.log(`[BackupWorker] Cleaning up old backups (retention: ${settings.backupRetentionDays} days)`);
                await deleteOldBackupsFromS3(settings.backupRetentionDays);
            }
        }
        else {
            console.log(`[BackupWorker] S3 not configured, backup saved locally only`);
        }
        // Update backup record with success
        await prisma.backup.update({
            where: { id: backup.id },
            data: {
                status: 'completed',
                sizeBytes,
                s3Key,
                s3Bucket,
                collectionCount: counts.collectionCount,
                documentCount: counts.documentCount,
                completedAt: new Date(),
            },
        });
        // Clean up old backup records from database (keep last 100)
        const oldBackups = await prisma.backup.findMany({
            where: { status: 'completed' },
            orderBy: { createdAt: 'desc' },
            skip: 100,
            select: { id: true },
        });
        if (oldBackups.length > 0) {
            await prisma.backup.deleteMany({
                where: { id: { in: oldBackups.map((b) => b.id) } },
            });
            console.log(`[BackupWorker] Cleaned up ${oldBackups.length} old backup records`);
        }
        // Cleanup temp files
        await fs.rm(tempDir, { recursive: true, force: true });
        console.log(`[BackupWorker] Backup completed: ${filename}`);
        return {
            backupId: backup.id,
            filename,
            sizeBytes,
            s3Key,
            collectionCount: counts.collectionCount,
            documentCount: counts.documentCount,
            completedAt: new Date(),
        };
    }
    catch (error) {
        // Update backup record with failure
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await prisma.backup.update({
            where: { id: backup.id },
            data: {
                status: 'failed',
                errorMessage,
                completedAt: new Date(),
            },
        });
        // Cleanup temp files
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
        catch {
            // Ignore cleanup errors
        }
        throw error;
    }
}
/**
 * Start the backup worker
 */
export function startBackupWorker() {
    if (backupWorker) {
        return backupWorker;
    }
    backupWorker = new Worker(BACKUP_QUEUE_NAME, async (job) => {
        return await processBackupJob(job);
    }, {
        connection: getRedisConnection(),
        concurrency: 1, // Only one backup at a time
    });
    backupWorker.on('completed', (job, result) => {
        console.log(`[BackupWorker] Job ${job.id} completed: ${result.filename} (${result.sizeBytes} bytes)`);
    });
    backupWorker.on('failed', (job, err) => {
        console.error(`[BackupWorker] Job ${job?.id} failed:`, err.message);
    });
    console.log('[BackupWorker] Started');
    return backupWorker;
}
/**
 * Stop the backup worker
 */
export async function stopBackupWorker() {
    if (backupWorker) {
        await backupWorker.close();
        backupWorker = null;
    }
    if (backupQueue) {
        await backupQueue.close();
        backupQueue = null;
    }
    console.log('[BackupWorker] Stopped');
}
/**
 * Convert HH:MM time to cron pattern
 */
function timeToCron(time) {
    const [hours, minutes] = time.split(':').map(Number);
    return `${minutes} ${hours} * * *`;
}
/**
 * Schedule recurring backup based on settings
 */
export async function scheduleBackupJob() {
    const settings = await prisma.settings.findFirst();
    if (!settings?.backupEnabled) {
        console.log('[BackupWorker] Backups are disabled, removing any existing schedule');
        await removeBackupSchedule();
        return;
    }
    const cronPattern = timeToCron(settings.backupScheduleTime);
    const queue = getBackupQueue();
    // Check if schedule already exists with same pattern
    const repeatableJobs = await queue.getRepeatableJobs();
    const existingJob = repeatableJobs.find((job) => job.name === 'backup-scheduled' && job.pattern === cronPattern);
    if (existingJob) {
        console.log('[BackupWorker] Backup job already scheduled');
        return;
    }
    // Remove any existing backup schedules with different patterns
    for (const job of repeatableJobs) {
        if (job.name === 'backup-scheduled') {
            await queue.removeRepeatableByKey(job.key);
        }
    }
    // Add new repeatable job
    await queue.add('backup-scheduled', { triggeredBy: 'scheduled' }, {
        repeat: {
            pattern: cronPattern,
        },
        jobId: 'backup-scheduled',
    });
    console.log(`[BackupWorker] Scheduled backup job at ${settings.backupScheduleTime} (cron: ${cronPattern})`);
}
/**
 * Remove backup schedule
 */
export async function removeBackupSchedule() {
    const queue = getBackupQueue();
    const repeatableJobs = await queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        if (job.name === 'backup-scheduled') {
            await queue.removeRepeatableByKey(job.key);
            console.log('[BackupWorker] Removed backup schedule');
        }
    }
}
/**
 * Trigger immediate backup
 */
export async function triggerBackupNow(userId) {
    const queue = getBackupQueue();
    const job = await queue.add(`backup-immediate-${Date.now()}`, {
        triggeredBy: 'manual',
        userId,
    });
    console.log(`[BackupWorker] Triggered immediate backup, job: ${job.id}`);
    return job.id || '';
}
/**
 * Check if backup worker is running
 */
export function isBackupWorkerRunning() {
    return backupWorker !== null && backupWorker.isRunning();
}
/**
 * Get the current backup schedule info
 */
export async function getBackupScheduleInfo() {
    const queue = getBackupQueue();
    const repeatableJobs = await queue.getRepeatableJobs();
    const scheduledJob = repeatableJobs.find((job) => job.name === 'backup-scheduled');
    if (!scheduledJob) {
        return {
            isScheduled: false,
            cronPattern: null,
            nextRun: null,
        };
    }
    return {
        isScheduled: true,
        cronPattern: scheduledJob.pattern || null,
        nextRun: scheduledJob.next ? new Date(scheduledJob.next) : null,
    };
}
