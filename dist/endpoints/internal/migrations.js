import { z } from 'zod';
import { internalFactory } from '../../factories';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
const execAsync = promisify(exec);
// Migration status response schema
const migrationStatusSchema = z.object({
    status: z.enum(['up-to-date', 'pending', 'error']),
    lastApplied: z.string().optional(),
    pending: z.array(z.string()),
    appliedCount: z.number(),
    error: z.string().optional(),
});
/**
 * Get migration status
 * Returns information about applied and pending migrations
 */
export const getMigrationStatusEndpoint = internalFactory.build({
    method: 'get',
    shortDescription: 'Get Migration Status',
    description: 'Returns the current migration status including pending migrations.',
    tag: 'Internal',
    input: z.object({}),
    output: migrationStatusSchema,
    handler: async () => {
        try {
            // Run prisma migrate status
            const { stdout, stderr } = await execAsync('npx prisma migrate status --schema=/opt/kling/prisma/schema.prisma', {
                cwd: '/opt/kling',
                timeout: 30000,
            });
            const output = stdout + stderr;
            // Parse the output
            const pending = parsePendingMigrations(output);
            const lastApplied = parseLastAppliedMigration(output);
            const appliedCount = parseAppliedCount(output);
            const status = pending.length > 0 ? 'pending' : 'up-to-date';
            return {
                status,
                lastApplied,
                pending,
                appliedCount,
            };
        }
        catch (error) {
            console.error('Migration status check failed:', error);
            return {
                status: 'error',
                pending: [],
                appliedCount: 0,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    },
});
/**
 * Apply pending migrations
 * Runs prisma migrate deploy and any custom migration scripts
 */
export const applyMigrationsEndpoint = internalFactory.build({
    method: 'post',
    shortDescription: 'Apply Migrations',
    description: 'Applies all pending database migrations.',
    tag: 'Internal',
    input: z.object({
        dryRun: z.boolean().optional().default(false),
    }),
    output: z.object({
        success: z.boolean(),
        migrationsApplied: z.array(z.string()),
        log: z.string(),
        error: z.string().optional(),
    }),
    handler: async ({ input }) => {
        const logs = [];
        const migrationsApplied = [];
        try {
            // 1. Run pre-migration hooks if they exist
            const preMigratePath = '/opt/kling/migrations/hooks/pre-migrate.sh';
            if (await fileExists(preMigratePath)) {
                logs.push('Running pre-migration hook...');
                try {
                    const { stdout } = await execAsync(`bash ${preMigratePath}`, {
                        cwd: '/opt/kling',
                        timeout: 60000,
                    });
                    logs.push(stdout);
                }
                catch (error) {
                    logs.push(`Pre-migration hook failed: ${error}`);
                    throw new Error('Pre-migration hook failed');
                }
            }
            // 2. Run Prisma migrations
            if (input.dryRun) {
                logs.push('Dry run mode - skipping actual migration');
                const { stdout } = await execAsync('npx prisma migrate status --schema=/opt/kling/prisma/schema.prisma', { cwd: '/opt/kling', timeout: 30000 });
                logs.push(stdout);
            }
            else {
                logs.push('Applying Prisma migrations...');
                const { stdout, stderr } = await execAsync('npx prisma migrate deploy --schema=/opt/kling/prisma/schema.prisma', { cwd: '/opt/kling', timeout: 300000 } // 5 minute timeout
                );
                logs.push(stdout);
                if (stderr)
                    logs.push(stderr);
                // Parse applied migrations from output
                const appliedMatches = stdout.match(/(\d+_[a-z_]+)/g);
                if (appliedMatches) {
                    migrationsApplied.push(...appliedMatches);
                }
                // 3. Regenerate Prisma client
                logs.push('Regenerating Prisma client...');
                const { stdout: genStdout } = await execAsync('npx prisma generate --schema=/opt/kling/prisma/schema.prisma', { cwd: '/opt/kling', timeout: 60000 });
                logs.push(genStdout);
            }
            // 4. Run custom migration scripts
            const scriptsDir = '/opt/kling/migrations/scripts';
            if (await fileExists(scriptsDir)) {
                const files = await fs.readdir(scriptsDir);
                const scripts = files.filter((f) => f.endsWith('.ts') || f.endsWith('.js')).sort();
                for (const script of scripts) {
                    logs.push(`Running custom migration script: ${script}`);
                    if (!input.dryRun) {
                        try {
                            const { stdout } = await execAsync(`npx tsx ${path.join(scriptsDir, script)}`, {
                                cwd: '/opt/kling',
                                timeout: 300000, // 5 minute timeout per script
                            });
                            logs.push(stdout);
                            migrationsApplied.push(script);
                        }
                        catch (error) {
                            logs.push(`Script ${script} failed: ${error}`);
                            throw new Error(`Custom migration script ${script} failed`);
                        }
                    }
                }
            }
            // 5. Run post-migration hooks if they exist
            const postMigratePath = '/opt/kling/migrations/hooks/post-migrate.sh';
            if ((await fileExists(postMigratePath)) && !input.dryRun) {
                logs.push('Running post-migration hook...');
                try {
                    const { stdout } = await execAsync(`bash ${postMigratePath}`, {
                        cwd: '/opt/kling',
                        timeout: 60000,
                    });
                    logs.push(stdout);
                }
                catch (error) {
                    logs.push(`Post-migration hook failed: ${error}`);
                    // Don't throw - post-migration hook failures are logged but not fatal
                }
            }
            return {
                success: true,
                migrationsApplied,
                log: logs.join('\n'),
            };
        }
        catch (error) {
            return {
                success: false,
                migrationsApplied,
                log: logs.join('\n'),
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    },
});
/**
 * Get detailed health information for updates
 */
export const getDetailedHealthEndpoint = internalFactory.build({
    method: 'get',
    shortDescription: 'Get Detailed Health',
    description: 'Returns detailed health information for update verification.',
    tag: 'Internal',
    input: z.object({}),
    output: z.object({
        healthy: z.boolean(),
        checks: z.object({
            database: z.object({
                status: z.enum(['ok', 'error']),
                message: z.string().optional(),
            }),
            redis: z.object({
                status: z.enum(['ok', 'error']),
                message: z.string().optional(),
            }),
            disk: z.object({
                status: z.enum(['ok', 'warning', 'error']),
                usedPercent: z.number(),
                message: z.string().optional(),
            }),
            memory: z.object({
                status: z.enum(['ok', 'warning', 'error']),
                usedPercent: z.number(),
                message: z.string().optional(),
            }),
            services: z.object({
                status: z.enum(['ok', 'error']),
                running: z.array(z.string()),
                stopped: z.array(z.string()),
            }),
        }),
    }),
    handler: async () => {
        const checks = {
            database: await checkDatabase(),
            redis: await checkRedis(),
            disk: await checkDisk(),
            memory: checkMemory(),
            services: await checkServices(),
        };
        const healthy = checks.database.status === 'ok' &&
            checks.redis.status === 'ok' &&
            checks.disk.status !== 'error' &&
            checks.memory.status !== 'error' &&
            checks.services.status === 'ok';
        return { healthy, checks };
    },
});
// Helper functions
function parsePendingMigrations(output) {
    const pending = [];
    const lines = output.split('\n');
    for (const line of lines) {
        if (line.includes('not yet been applied')) {
            const match = line.match(/(\d+_[a-z_]+)/);
            if (match) {
                pending.push(match[1]);
            }
        }
    }
    return pending;
}
function parseLastAppliedMigration(output) {
    const lines = output.split('\n');
    for (const line of lines) {
        if (line.includes('applied')) {
            const match = line.match(/(\d+_[a-z_]+)/);
            if (match) {
                return match[1];
            }
        }
    }
    return undefined;
}
function parseAppliedCount(output) {
    const match = output.match(/(\d+) migrations? applied/);
    return match ? parseInt(match[1], 10) : 0;
}
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
async function checkDatabase() {
    try {
        // Try to connect to MongoDB
        const { stdout } = await execAsync('mongosh --eval "db.adminCommand({ ping: 1 })" --quiet', {
            timeout: 10000,
        });
        if (stdout.includes('ok')) {
            return { status: 'ok' };
        }
        return { status: 'error', message: 'MongoDB ping failed' };
    }
    catch (error) {
        return {
            status: 'error',
            message: error instanceof Error ? error.message : 'MongoDB check failed',
        };
    }
}
async function checkRedis() {
    try {
        const { stdout } = await execAsync('redis-cli ping', { timeout: 5000 });
        if (stdout.trim() === 'PONG') {
            return { status: 'ok' };
        }
        return { status: 'error', message: 'Redis ping failed' };
    }
    catch (error) {
        return {
            status: 'error',
            message: error instanceof Error ? error.message : 'Redis check failed',
        };
    }
}
async function checkDisk() {
    try {
        const { stdout } = await execAsync("df -h / | tail -1 | awk '{print $5}'", {
            timeout: 5000,
        });
        const usedPercent = parseInt(stdout.replace('%', ''), 10);
        if (usedPercent >= 90) {
            return { status: 'error', usedPercent, message: 'Disk usage critical' };
        }
        if (usedPercent >= 80) {
            return { status: 'warning', usedPercent, message: 'Disk usage high' };
        }
        return { status: 'ok', usedPercent };
    }
    catch (error) {
        return {
            status: 'error',
            usedPercent: 0,
            message: error instanceof Error ? error.message : 'Disk check failed',
        };
    }
}
function checkMemory() {
    const totalMemory = os.totalmem();
    const usedPercent = ((totalMemory - os.freemem()) / totalMemory) * 100;
    if (usedPercent >= 90) {
        return { status: 'error', usedPercent, message: 'Memory usage critical' };
    }
    if (usedPercent >= 80) {
        return { status: 'warning', usedPercent, message: 'Memory usage high' };
    }
    return { status: 'ok', usedPercent };
}
async function checkServices() {
    const services = ['kling', 'nginx', 'mongod', 'redis-server'];
    const running = [];
    const stopped = [];
    for (const service of services) {
        try {
            const { stdout } = await execAsync(`systemctl is-active ${service}`, {
                timeout: 5000,
            });
            if (stdout.trim() === 'active') {
                running.push(service);
            }
            else {
                stopped.push(service);
            }
        }
        catch {
            stopped.push(service);
        }
    }
    return {
        status: stopped.length === 0 ? 'ok' : 'error',
        running,
        stopped,
    };
}
