import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createAuditLog, AuditActions } from './audit';
import { triggerBackupNow } from './bullmq/backup-worker';
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
export async function executeUpdateNow(data) {
    const { version, userId, skipBackup, isRollback } = data;
    const actionType = isRollback ? 'rollback' : 'update';
    setImmediate(async () => {
        const previousVersion = getCurrentVersion();
        console.log(`[UpdateExecutor] Starting ${actionType} to version ${version}...`);
        try {
            console.log('[UpdateExecutor] Running pre-flight checks...');
            if (!fs.existsSync(path.join(process.cwd(), '.git'))) {
                throw new Error('Not a git repository');
            }
            if (!skipBackup) {
                console.log('[UpdateExecutor] Creating database backup...');
                try {
                    await triggerBackupNow('system');
                    console.log('[UpdateExecutor] Backup created successfully');
                }
                catch (backupError) {
                    console.warn('[UpdateExecutor] Backup failed, continuing anyway:', backupError);
                }
            }
            else {
                console.log('[UpdateExecutor] Skipping backup (user requested)');
            }
            console.log('[UpdateExecutor] Fetching from remote...');
            const fetchResult = execCommand('git fetch --tags');
            if (!fetchResult.success) {
                throw new Error(`Git fetch failed: ${fetchResult.error}`);
            }
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
            console.log(`[UpdateExecutor] Target version: ${targetTag}`);
            console.log(`[UpdateExecutor] Checking out ${targetTag}...`);
            const checkoutResult = execCommand(`git checkout ${targetTag}`);
            if (!checkoutResult.success) {
                throw new Error(`Git checkout failed: ${checkoutResult.error}`);
            }
            console.log('[UpdateExecutor] Installing dependencies...');
            const installResult = execCommand('npm install --omit=dev');
            if (!installResult.success) {
                throw new Error(`npm install failed: ${installResult.error}`);
            }
            console.log('[UpdateExecutor] Generating Prisma client...');
            const generateResult = execCommand('npx prisma generate');
            if (!generateResult.success) {
                throw new Error(`Prisma generate failed: ${generateResult.error}`);
            }
            console.log('[UpdateExecutor] Running database migrations...');
            const migrateResult = execCommand('npx prisma migrate deploy');
            if (!migrateResult.success) {
                console.warn('[UpdateExecutor] Migration warning:', migrateResult.error);
            }
            console.log('[UpdateExecutor] Logging success...');
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
            console.log('[UpdateExecutor] Update completed successfully!');
            console.log('[UpdateExecutor] Restarting server NOW...');
            process.exit(0);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[UpdateExecutor] ${actionType} failed:`, errorMessage);
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
            if (!isRollback) {
                console.log(`[UpdateExecutor] Attempting to restore previous version ${previousVersion}...`);
                try {
                    execCommand(`git checkout v${previousVersion}`);
                    execCommand('npm install --omit=dev');
                    execCommand('npx prisma generate');
                    console.log('[UpdateExecutor] Restored previous version');
                }
                catch (rollbackError) {
                    console.error('[UpdateExecutor] Failed to restore previous version:', rollbackError);
                }
            }
            console.error(`[UpdateExecutor] ${actionType} failed and logged`);
        }
    });
}
