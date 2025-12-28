/**
 * System Update Worker
 *
 * BullMQ worker that handles system updates and rollbacks.
 * Performs git operations, dependency installation, migrations,
 * and triggers server restart.
 */
import { Worker, Queue } from 'bullmq';
import { getRedisConnection } from './connection';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createAuditLog, AuditActions } from '../audit';
import { triggerBackupNow } from './backup-worker';
// Queue name
export const UPDATE_QUEUE_NAME = 'updateQueue';
// Singleton instances
let updateQueue = null;
let updateWorker = null;
/**
 * Get or create the update queue
 */
export function getUpdateQueue() {
    if (!updateQueue) {
        updateQueue = new Queue(UPDATE_QUEUE_NAME, {
            connection: getRedisConnection(),
            defaultJobOptions: {
                attempts: 1, // Don't retry updates automatically
                removeOnComplete: {
                    age: 7 * 24 * 60 * 60, // Keep completed jobs for 7 days
                    count: 20,
                },
                removeOnFail: {
                    age: 30 * 24 * 60 * 60, // Keep failed jobs for 30 days
                },
            },
        });
    }
    return updateQueue;
}
/**
 * Queue an update job
 */
export async function queueUpdateJob(data) {
    const queue = getUpdateQueue();
    // Check if there's already an active update job
    const activeJobs = await queue.getActive();
    const waitingJobs = await queue.getWaiting();
    if (activeJobs.length > 0 || waitingJobs.length > 0) {
        throw new Error('An update is already in progress. Please wait for it to complete.');
    }
    const job = await queue.add('update', data, {
        jobId: `update-${Date.now()}`,
    });
    return job.id || '';
}
/**
 * Get the currently active update job, if any
 */
export async function getActiveUpdateJob() {
    const queue = getUpdateQueue();
    const activeJobs = await queue.getActive();
    if (activeJobs.length > 0) {
        return activeJobs[0];
    }
    const waitingJobs = await queue.getWaiting();
    if (waitingJobs.length > 0) {
        return waitingJobs[0];
    }
    return null;
}
/**
 * Execute a command and return output
 */
function execCommand(command, cwd) {
    try {
        const output = execSync(command, {
            cwd: cwd || process.cwd(),
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        return { success: true, output };
    }
    catch (err) {
        const error = err;
        return {
            success: false,
            output: '',
            error: error.stderr || error.message || 'Command failed',
        };
    }
}
/**
 * Get the current version from package.json
 */
function getCurrentVersion() {
    try {
        const packagePath = path.join(process.cwd(), 'package.json');
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
        return pkg.version || '1.0.0';
    }
    catch {
        return '1.0.0';
    }
}
/**
 * Start the update worker
 */
export function startUpdateWorker() {
    if (updateWorker) {
        return updateWorker;
    }
    updateWorker = new Worker(UPDATE_QUEUE_NAME, async (job) => {
        const { version, userId, skipBackup, isRollback } = job.data;
        const previousVersion = getCurrentVersion();
        const actionType = isRollback ? 'rollback' : 'update';
        console.log(`[UpdateWorker] Starting ${actionType} to version ${version}...`);
        try {
            // Step 1: Pre-flight checks
            await job.updateProgress(5);
            console.log('[UpdateWorker] Running pre-flight checks...');
            // Check if we're in a git repository
            if (!fs.existsSync(path.join(process.cwd(), '.git'))) {
                throw new Error('Not a git repository');
            }
            // Check disk space (basic check)
            const { output: dfOutput } = execCommand('df -h .');
            console.log('[UpdateWorker] Disk space:', dfOutput.split('\n')[1]);
            // Step 2: Create backup (unless skipped)
            await job.updateProgress(10);
            if (!skipBackup) {
                console.log('[UpdateWorker] Creating database backup...');
                try {
                    await triggerBackupNow('system');
                    console.log('[UpdateWorker] Backup created successfully');
                }
                catch (backupError) {
                    console.warn('[UpdateWorker] Backup failed, continuing anyway:', backupError);
                    // Don't fail the update if backup fails
                }
            }
            else {
                console.log('[UpdateWorker] Skipping backup (user requested)');
            }
            // Step 3: Fetch latest from remote
            await job.updateProgress(20);
            console.log('[UpdateWorker] Fetching from remote...');
            const fetchResult = execCommand('git fetch --tags');
            if (!fetchResult.success) {
                throw new Error(`Git fetch failed: ${fetchResult.error}`);
            }
            // Step 4: Resolve version to tag
            await job.updateProgress(30);
            let targetTag = version;
            if (version === 'latest') {
                const tagsResult = execCommand('git describe --tags $(git rev-list --tags --max-count=1)');
                if (!tagsResult.success) {
                    throw new Error('Could not determine latest version');
                }
                targetTag = tagsResult.output.trim();
            }
            else if (!version.startsWith('v')) {
                targetTag = `v${version}`;
            }
            console.log(`[UpdateWorker] Target version: ${targetTag}`);
            // Step 5: Checkout the version
            await job.updateProgress(40);
            console.log(`[UpdateWorker] Checking out ${targetTag}...`);
            const checkoutResult = execCommand(`git checkout ${targetTag}`);
            if (!checkoutResult.success) {
                throw new Error(`Git checkout failed: ${checkoutResult.error}`);
            }
            // Step 6: Install dependencies
            await job.updateProgress(50);
            console.log('[UpdateWorker] Installing dependencies...');
            const installResult = execCommand('npm install --omit=dev');
            if (!installResult.success) {
                throw new Error(`npm install failed: ${installResult.error}`);
            }
            // Step 7: Generate Prisma client
            await job.updateProgress(70);
            console.log('[UpdateWorker] Generating Prisma client...');
            const generateResult = execCommand('npx prisma generate');
            if (!generateResult.success) {
                throw new Error(`Prisma generate failed: ${generateResult.error}`);
            }
            // Step 8: Run database migrations
            await job.updateProgress(80);
            console.log('[UpdateWorker] Running database migrations...');
            const migrateResult = execCommand('npx prisma migrate deploy');
            if (!migrateResult.success) {
                console.warn('[UpdateWorker] Migration warning:', migrateResult.error);
                // Don't fail on migration warnings, only on errors
                if (migrateResult.error && !migrateResult.error.includes('Already in sync')) {
                    throw new Error(`Prisma migrate failed: ${migrateResult.error}`);
                }
            }
            // Step 9: Log success
            await job.updateProgress(90);
            console.log('[UpdateWorker] Logging success...');
            await createAuditLog({
                action: isRollback
                    ? AuditActions.systemRollback.completed
                    : AuditActions.systemUpdate.completed,
                resourceType: 'system',
                resourceId: targetTag,
                metadata: {
                    success: true,
                    previousVersion,
                    newVersion: targetTag,
                },
                context: { userId },
            });
            // Step 10: Schedule restart
            await job.updateProgress(100);
            console.log('[UpdateWorker] Update completed successfully!');
            console.log('[UpdateWorker] Server will restart in 3 seconds...');
            // Give time for the response to be sent, then restart
            setTimeout(() => {
                console.log('[UpdateWorker] Restarting server...');
                // Exit with code 0 so supervisor/docker restarts us
                process.exit(0);
            }, 3000);
            return {
                success: true,
                version: targetTag,
                previousVersion,
                completedAt: new Date(),
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[UpdateWorker] ${actionType} failed:`, errorMessage);
            // Log failure
            await createAuditLog({
                action: isRollback
                    ? AuditActions.systemRollback.failed
                    : AuditActions.systemUpdate.failed,
                resourceType: 'system',
                resourceId: version,
                metadata: {
                    success: false,
                    error: errorMessage,
                    previousVersion,
                },
                context: { userId },
            });
            // Try to rollback to previous version on failure (if not already a rollback)
            if (!isRollback) {
                console.log(`[UpdateWorker] Attempting to restore previous version ${previousVersion}...`);
                try {
                    execCommand(`git checkout v${previousVersion}`);
                    execCommand('npm install --omit=dev');
                    execCommand('npx prisma generate');
                    console.log('[UpdateWorker] Restored previous version');
                }
                catch (rollbackError) {
                    console.error('[UpdateWorker] Failed to restore previous version:', rollbackError);
                }
            }
            throw error;
        }
    }, {
        connection: getRedisConnection(),
        concurrency: 1, // Only one update at a time
    });
    updateWorker.on('completed', (job, result) => {
        console.log(`[UpdateWorker] Job ${job.id} completed: ${result.version}`);
    });
    updateWorker.on('failed', (job, error) => {
        console.error(`[UpdateWorker] Job ${job?.id} failed:`, error.message);
    });
    console.log('[UpdateWorker] Started');
    return updateWorker;
}
/**
 * Stop the update worker
 */
export async function stopUpdateWorker() {
    if (updateWorker) {
        await updateWorker.close();
        updateWorker = null;
        console.log('[UpdateWorker] Stopped');
    }
}
/**
 * Check if update worker is running
 */
export function isUpdateWorkerRunning() {
    return updateWorker !== null && !updateWorker.closing;
}
