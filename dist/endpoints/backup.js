/**
 * Database Backup Endpoints
 *
 * Admin-only endpoints for managing database backups.
 */
import { z } from 'zod';
import createHttpError from 'http-errors';
import { createAuthRoleFactory } from '../factories';
import prisma from '../utils/prisma';
import { objectIdSchema } from '../utils/validation';
import { triggerBackupNow, getBackupScheduleInfo, isBackupWorkerRunning, } from '../utils/bullmq/backup-worker';
import { listBackupsFromS3, getBackupDownloadUrl, testS3Connection, downloadBackupFromS3, isS3Configured, deleteBackupFromS3, } from '../utils/s3-client';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import * as tar from 'tar';
const execAsync = promisify(exec);
const adminFactory = createAuthRoleFactory('admin');
// Backup schema for responses
const backupSchema = z.object({
    id: z.string(),
    filename: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed', 'failed']),
    type: z.enum(['scheduled', 'manual']),
    sizeBytes: z.number().nullable(),
    s3Key: z.string().nullable(),
    s3Bucket: z.string().nullable(),
    startedAt: z.date(),
    completedAt: z.date().nullable(),
    databaseName: z.string(),
    collectionCount: z.number().nullable(),
    documentCount: z.number().nullable(),
    errorMessage: z.string().nullable(),
    triggeredBy: z.string(),
    createdAt: z.date(),
});
// Get backup status and schedule info
export const getBackupStatusEndpoint = adminFactory.build({
    method: 'get',
    shortDescription: 'Backup Status',
    description: 'Returns the current backup worker status and schedule.',
    tag: 'Backup',
    input: z.object({}),
    output: z.object({
        workerRunning: z.boolean(),
        schedule: z.object({
            isScheduled: z.boolean(),
            cronPattern: z.string().nullable(),
            nextRun: z.date().nullable(),
        }),
        settings: z.object({
            enabled: z.boolean(),
            scheduleTime: z.string(),
            retentionDays: z.number(),
            s3Configured: z.boolean(),
        }),
    }),
    handler: async () => {
        const settings = await prisma.settings.findFirst();
        const scheduleInfo = await getBackupScheduleInfo();
        const s3Configured = await isS3Configured();
        return {
            workerRunning: isBackupWorkerRunning(),
            schedule: scheduleInfo,
            settings: {
                enabled: settings?.backupEnabled ?? false,
                scheduleTime: settings?.backupScheduleTime ?? '02:00',
                retentionDays: settings?.backupRetentionDays ?? 7,
                s3Configured,
            },
        };
    },
});
// List backups from database
export const listBackupsEndpoint = adminFactory.build({
    method: 'get',
    shortDescription: 'List Backups',
    description: 'Returns a list of all backups from the database.',
    tag: 'Backup',
    input: z.object({
        page: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 1)),
        pageSize: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 20)),
        status: z.enum(['pending', 'in_progress', 'completed', 'failed']).optional(),
    }),
    output: z.object({
        items: z.array(backupSchema),
        total: z.number(),
        page: z.number(),
        pageSize: z.number(),
        hasMore: z.boolean(),
    }),
    handler: async ({ input }) => {
        const { page, pageSize, status } = input;
        const skip = (page - 1) * pageSize;
        const where = status ? { status } : {};
        const [items, total] = await Promise.all([
            prisma.backup.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: pageSize,
            }),
            prisma.backup.count({ where }),
        ]);
        return {
            items: items.map((backup) => ({
                ...backup,
                status: backup.status,
                type: backup.type,
            })),
            total,
            page,
            pageSize,
            hasMore: skip + items.length < total,
        };
    },
});
// Trigger manual backup
export const triggerBackupEndpoint = adminFactory.build({
    method: 'post',
    shortDescription: 'Trigger Backup',
    description: 'Triggers an immediate database backup.',
    tag: 'Backup',
    input: z.object({}),
    output: z.object({
        success: z.boolean(),
        backupId: z.string(),
        message: z.string(),
    }),
    handler: async ({ ctx }) => {
        const backupId = await triggerBackupNow(ctx.user.sub);
        return {
            success: true,
            backupId,
            message: 'Backup job started. Check backup list for status.',
        };
    },
});
// Get backup download URL
export const getBackupDownloadEndpoint = adminFactory.build({
    method: 'get',
    shortDescription: 'Download Backup',
    description: 'Returns a presigned URL for downloading a backup from S3.',
    tag: 'Backup',
    input: z.object({
        backupId: objectIdSchema,
    }),
    output: z.object({
        downloadUrl: z.string(),
        expiresIn: z.number(),
    }),
    handler: async ({ input }) => {
        const backup = await prisma.backup.findUnique({
            where: { id: input.backupId },
        });
        if (!backup) {
            throw createHttpError(404, 'Backup not found');
        }
        if (!backup.s3Key) {
            throw createHttpError(400, 'Backup is not stored in S3');
        }
        const expiresIn = 3600; // 1 hour
        const downloadUrl = await getBackupDownloadUrl(backup.s3Key, expiresIn);
        return {
            downloadUrl,
            expiresIn,
        };
    },
});
// List S3 backups
export const listS3BackupsEndpoint = adminFactory.build({
    method: 'get',
    shortDescription: 'List S3 Backups',
    description: 'Lists all backups available in S3 bucket.',
    tag: 'Backup',
    input: z.object({}),
    output: z.object({
        backups: z.array(z.object({
            key: z.string(),
            filename: z.string(),
            size: z.number(),
            lastModified: z.date(),
        })),
    }),
    handler: async () => {
        const configured = await isS3Configured();
        if (!configured) {
            return { backups: [] };
        }
        const backups = await listBackupsFromS3();
        return { backups };
    },
});
// Test S3 connection
export const testS3ConnectionEndpoint = adminFactory.build({
    method: 'post',
    shortDescription: 'Test S3 Connection',
    description: 'Tests the S3 connection with current settings.',
    tag: 'Backup',
    input: z.object({}),
    output: z.object({
        success: z.boolean(),
        error: z.string().optional(),
    }),
    handler: async () => {
        return await testS3Connection();
    },
});
// Restore from S3
export const restoreFromS3Endpoint = adminFactory.build({
    method: 'post',
    shortDescription: 'Restore from S3',
    description: 'Restores database from a backup stored in S3.',
    tag: 'Backup',
    input: z.object({
        s3Key: z.string(),
        dryRun: z.boolean().optional().default(false),
    }),
    output: z.object({
        success: z.boolean(),
        message: z.string(),
        collectionsRestored: z.number().optional(),
    }),
    handler: async ({ input }) => {
        const { s3Key, dryRun } = input;
        // Create temp directory
        const timestamp = Date.now();
        const tempDir = path.join(os.tmpdir(), `kling-restore-${timestamp}`);
        const archivePath = path.join(tempDir, 'backup.tar.gz');
        try {
            await fs.mkdir(tempDir, { recursive: true });
            // Download from S3
            console.log(`[Restore] Downloading ${s3Key} from S3...`);
            await downloadBackupFromS3(s3Key, archivePath);
            // Extract archive
            console.log(`[Restore] Extracting archive...`);
            await tar.extract({
                file: archivePath,
                cwd: tempDir,
            });
            // Find the dump directory
            const dumpDir = path.join(tempDir, 'dump');
            const dumpExists = await fs
                .stat(dumpDir)
                .then(() => true)
                .catch(() => false);
            if (!dumpExists) {
                throw createHttpError(400, 'Invalid backup archive: dump directory not found');
            }
            // Get list of databases in dump
            const databases = await fs.readdir(dumpDir);
            console.log(`[Restore] Found databases: ${databases.join(', ')}`);
            if (dryRun) {
                // Just return what would be restored
                return {
                    success: true,
                    message: `Dry run: Would restore ${databases.length} database(s): ${databases.join(', ')}`,
                    collectionsRestored: databases.length,
                };
            }
            // Get database URI
            const databaseUrl = process.env.DATABASE_URL;
            if (!databaseUrl) {
                throw createHttpError(500, 'DATABASE_URL environment variable is not set');
            }
            // Run mongorestore
            console.log(`[Restore] Running mongorestore...`);
            const mongorestoreCmd = `mongorestore --uri="${databaseUrl}" --drop "${dumpDir}"`;
            try {
                await execAsync(mongorestoreCmd, { maxBuffer: 1024 * 1024 * 100 });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                throw createHttpError(500, `mongorestore failed: ${message}`);
            }
            console.log(`[Restore] Restore completed successfully`);
            return {
                success: true,
                message: `Successfully restored ${databases.length} database(s)`,
                collectionsRestored: databases.length,
            };
        }
        finally {
            // Cleanup temp files
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            }
            catch {
                // Ignore cleanup errors
            }
        }
    },
});
// Restore from uploaded file
export const restoreFromUploadEndpoint = adminFactory.build({
    method: 'post',
    shortDescription: 'Restore from Upload',
    description: 'Restores database from an uploaded backup file (base64 encoded).',
    tag: 'Backup',
    input: z.object({
        fileContent: z.string(), // Base64 encoded tar.gz
        filename: z.string(),
        dryRun: z.boolean().optional().default(false),
    }),
    output: z.object({
        success: z.boolean(),
        message: z.string(),
        collectionsRestored: z.number().optional(),
    }),
    handler: async ({ input }) => {
        const { fileContent, filename, dryRun } = input;
        // Create temp directory
        const timestamp = Date.now();
        const tempDir = path.join(os.tmpdir(), `kling-restore-${timestamp}`);
        const archivePath = path.join(tempDir, filename);
        try {
            await fs.mkdir(tempDir, { recursive: true });
            // Decode and write file
            const buffer = Buffer.from(fileContent, 'base64');
            await fs.writeFile(archivePath, buffer);
            // Extract archive
            console.log(`[Restore] Extracting uploaded archive...`);
            await tar.extract({
                file: archivePath,
                cwd: tempDir,
            });
            // Find the dump directory
            const dumpDir = path.join(tempDir, 'dump');
            const dumpExists = await fs
                .stat(dumpDir)
                .then(() => true)
                .catch(() => false);
            if (!dumpExists) {
                throw createHttpError(400, 'Invalid backup archive: dump directory not found');
            }
            // Get list of databases in dump
            const databases = await fs.readdir(dumpDir);
            console.log(`[Restore] Found databases: ${databases.join(', ')}`);
            if (dryRun) {
                return {
                    success: true,
                    message: `Dry run: Would restore ${databases.length} database(s): ${databases.join(', ')}`,
                    collectionsRestored: databases.length,
                };
            }
            // Get database URI
            const databaseUrl = process.env.DATABASE_URL;
            if (!databaseUrl) {
                throw createHttpError(500, 'DATABASE_URL environment variable is not set');
            }
            // Run mongorestore
            console.log(`[Restore] Running mongorestore...`);
            const mongorestoreCmd = `mongorestore --uri="${databaseUrl}" --drop "${dumpDir}"`;
            try {
                await execAsync(mongorestoreCmd, { maxBuffer: 1024 * 1024 * 100 });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                throw createHttpError(500, `mongorestore failed: ${message}`);
            }
            console.log(`[Restore] Restore completed successfully`);
            return {
                success: true,
                message: `Successfully restored ${databases.length} database(s)`,
                collectionsRestored: databases.length,
            };
        }
        finally {
            // Cleanup temp files
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            }
            catch {
                // Ignore cleanup errors
            }
        }
    },
});
// Delete backup
export const deleteBackupEndpoint = adminFactory.build({
    method: 'delete',
    shortDescription: 'Delete Backup',
    description: 'Deletes a backup from database and S3.',
    tag: 'Backup',
    input: z.object({
        backupId: objectIdSchema,
    }),
    output: z.object({
        success: z.boolean(),
        message: z.string(),
    }),
    handler: async ({ input }) => {
        const backup = await prisma.backup.findUnique({
            where: { id: input.backupId },
        });
        if (!backup) {
            throw createHttpError(404, 'Backup not found');
        }
        // Delete from S3 if exists
        if (backup.s3Key) {
            try {
                await deleteBackupFromS3(backup.s3Key);
            }
            catch (error) {
                console.error('[Backup] Failed to delete from S3:', error);
                // Continue with database deletion even if S3 fails
            }
        }
        // Delete from database
        await prisma.backup.delete({
            where: { id: input.backupId },
        });
        return {
            success: true,
            message: 'Backup deleted successfully',
        };
    },
});
