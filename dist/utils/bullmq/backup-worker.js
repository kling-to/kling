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
export const BACKUP_QUEUE_NAME = 'backupQueue';
let backupQueue = null;
let backupWorker = null;
export function getBackupQueue() {
    if (!backupQueue) {
        backupQueue = new Queue(BACKUP_QUEUE_NAME, {
            connection: getRedisConnection(),
            defaultJobOptions: {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 60000,
                },
                removeOnComplete: {
                    age: 7 * 24 * 60 * 60,
                    count: 50,
                },
                removeOnFail: {
                    age: 30 * 24 * 60 * 60,
                },
            },
        });
    }
    return backupQueue;
}
function parseDatabaseUrl() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error('DATABASE_URL environment variable is not set');
    }
    const url = new URL(databaseUrl);
    const dbName = url.pathname.slice(1).split('?')[0];
    if (!dbName) {
        throw new Error('Could not extract database name from DATABASE_URL');
    }
    return { uri: databaseUrl, dbName };
}
async function countAllDocuments() {
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
            const count = await prisma[model].count();
            if (count > 0) {
                documentCount += count;
                collectionCount++;
            }
        }
        catch {
        }
    }
    return { collectionCount, documentCount };
}
async function processBackupJob(job) {
    console.log(`[BackupWorker] Starting backup job ${job.id}`);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.tar.gz`;
    const tempDir = path.join(os.tmpdir(), `kling-backup-${timestamp}`);
    const dumpDir = path.join(tempDir, 'dump');
    const archivePath = path.join(tempDir, filename);
    const { uri, dbName } = parseDatabaseUrl();
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
        await fs.mkdir(tempDir, { recursive: true });
        const counts = await countAllDocuments();
        console.log(`[BackupWorker] Database ${dbName}: ${counts.collectionCount} collections, ${counts.documentCount} documents`);
        console.log(`[BackupWorker] Running mongodump for database: ${dbName}`);
        const mongodumpCmd = `mongodump --uri="${uri}" --out="${dumpDir}"`;
        try {
            await execAsync(mongodumpCmd, { maxBuffer: 1024 * 1024 * 100 });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`mongodump failed: ${message}`);
        }
        console.log(`[BackupWorker] Creating archive: ${archivePath}`);
        await tar.create({
            gzip: true,
            file: archivePath,
            cwd: tempDir,
        }, ['dump']);
        const archiveStats = await fs.stat(archivePath);
        const sizeBytes = archiveStats.size;
        console.log(`[BackupWorker] Archive created: ${sizeBytes} bytes`);
        let s3Key;
        let s3Bucket;
        const settings = await prisma.settings.findFirst();
        if (await isS3Configured()) {
            console.log(`[BackupWorker] Uploading to S3...`);
            const uploadResult = await uploadBackupToS3(archivePath, filename);
            s3Key = uploadResult.key;
            s3Bucket = uploadResult.bucket;
            if (settings?.backupRetentionDays) {
                console.log(`[BackupWorker] Cleaning up old backups (retention: ${settings.backupRetentionDays} days)`);
                await deleteOldBackupsFromS3(settings.backupRetentionDays);
            }
        }
        else {
            console.log(`[BackupWorker] S3 not configured, backup saved locally only`);
        }
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
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await prisma.backup.update({
            where: { id: backup.id },
            data: {
                status: 'failed',
                errorMessage,
                completedAt: new Date(),
            },
        });
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
        catch {
        }
        throw error;
    }
}
export function startBackupWorker() {
    if (backupWorker) {
        return backupWorker;
    }
    backupWorker = new Worker(BACKUP_QUEUE_NAME, async (job) => {
        return await processBackupJob(job);
    }, {
        connection: getRedisConnection(),
        concurrency: 1,
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
function timeToCron(time) {
    const [hours, minutes] = time.split(':').map(Number);
    return `${minutes} ${hours} * * *`;
}
export async function scheduleBackupJob() {
    const settings = await prisma.settings.findFirst();
    if (!settings?.backupEnabled) {
        console.log('[BackupWorker] Backups are disabled, removing any existing schedule');
        await removeBackupSchedule();
        return;
    }
    const cronPattern = timeToCron(settings.backupScheduleTime);
    const queue = getBackupQueue();
    const repeatableJobs = await queue.getRepeatableJobs();
    const existingJob = repeatableJobs.find((job) => job.name === 'backup-scheduled' && job.pattern === cronPattern);
    if (existingJob) {
        console.log('[BackupWorker] Backup job already scheduled');
        return;
    }
    for (const job of repeatableJobs) {
        if (job.name === 'backup-scheduled') {
            await queue.removeRepeatableByKey(job.key);
        }
    }
    await queue.add('backup-scheduled', { triggeredBy: 'scheduled' }, {
        repeat: {
            pattern: cronPattern,
        },
        jobId: 'backup-scheduled',
    });
    console.log(`[BackupWorker] Scheduled backup job at ${settings.backupScheduleTime} (cron: ${cronPattern})`);
}
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
export async function triggerBackupNow(userId) {
    const queue = getBackupQueue();
    const job = await queue.add(`backup-immediate-${Date.now()}`, {
        triggeredBy: 'manual',
        userId,
    });
    console.log(`[BackupWorker] Triggered immediate backup, job: ${job.id}`);
    return job.id || '';
}
export function isBackupWorkerRunning() {
    return backupWorker !== null && backupWorker.isRunning();
}
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
