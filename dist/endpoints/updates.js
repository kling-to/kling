import { z } from 'zod';
import { createAuthRoleFactory } from '../factories';
import prisma from '../utils/prisma';
import { createAuditLog, extractAuditContext, AuditActions } from '../utils/audit';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import createHttpError from 'http-errors';
const GITHUB_REPO = 'kling-to/kling';
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}`;
function getCurrentVersion() {
    try {
        const packagePath = path.join(process.cwd(), 'package.json');
        if (fs.existsSync(packagePath)) {
            const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
            return pkg.version || '1.0.0';
        }
    }
    catch {
    }
    return '1.0.0';
}
function getGitInfo() {
    try {
        const isGitRepo = fs.existsSync(path.join(process.cwd(), '.git'));
        if (!isGitRepo) {
            return { sha: null, tag: null, isGitRepo: false };
        }
        let sha = null;
        let tag = null;
        try {
            sha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
        }
        catch {
        }
        try {
            tag = execSync('git describe --tags --exact-match 2>/dev/null', {
                encoding: 'utf-8',
            }).trim();
        }
        catch {
        }
        return { sha, tag, isGitRepo };
    }
    catch {
        return { sha: null, tag: null, isGitRepo: false };
    }
}
function isNewer(a, b) {
    const partsA = a.replace(/^v/, '').split('.').map(Number);
    const partsB = b.replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((partsA[i] || 0) > (partsB[i] || 0))
            return true;
        if ((partsA[i] || 0) < (partsB[i] || 0))
            return false;
    }
    return false;
}
function isBreakingChange(currentTag, previousTag) {
    if (!previousTag)
        return false;
    const current = currentTag.replace(/^v/, '').split('.').map(Number);
    const previous = previousTag.replace(/^v/, '').split('.').map(Number);
    return current[0] > previous[0];
}
function hasMigrations(body) {
    const migrationKeywords = [
        'migration',
        'database migration',
        'migrate',
        'schema change',
        'prisma migrate',
        'breaking change to database',
    ];
    const lowerBody = body.toLowerCase();
    return migrationKeywords.some((keyword) => lowerBody.includes(keyword));
}
async function getTagCommitSha(tag) {
    try {
        const response = await fetch(`${GITHUB_API}/git/ref/tags/${tag}`);
        if (!response.ok)
            return 'unknown';
        const data = (await response.json());
        return data.object.sha.substring(0, 8);
    }
    catch {
        return 'unknown';
    }
}
async function fetchGitHubReleases() {
    const response = await fetch(`${GITHUB_API}/releases`, {
        headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'Kling-Update-Service',
        },
    });
    if (!response.ok) {
        throw createHttpError(502, 'Failed to fetch releases from GitHub');
    }
    const releases = (await response.json());
    const publishedReleases = releases.filter((r) => !r.draft && !r.prerelease);
    if (publishedReleases.length === 0) {
        throw createHttpError(404, 'No published releases found');
    }
    publishedReleases.sort((a, b) => (isNewer(a.tag_name, b.tag_name) ? -1 : 1));
    const latest = publishedReleases[0].tag_name.replace(/^v/, '');
    let currentMinVersion = '1.0.0';
    const versions = await Promise.all(publishedReleases.map(async (release, index) => {
        const version = release.tag_name.replace(/^v/, '');
        const previousRelease = publishedReleases[index + 1] || null;
        const breaking = isBreakingChange(release.tag_name, previousRelease?.tag_name || null);
        const migrations = hasMigrations(release.body || '');
        if (breaking) {
            currentMinVersion = version;
        }
        const sha = await getTagCommitSha(release.tag_name);
        return {
            version,
            tag: release.tag_name,
            releaseDate: release.published_at,
            changelog: release.body || 'No release notes available.',
            breakingChanges: breaking,
            migrations,
            minVersion: currentMinVersion,
            sha,
        };
    }));
    return { latest, versions };
}
const versionInfoSchema = z.object({
    version: z.string(),
    tag: z.string(),
    releaseDate: z.string(),
    changelog: z.string(),
    breakingChanges: z.boolean(),
    migrations: z.boolean(),
    minVersion: z.string(),
    sha: z.string(),
});
export const getCurrentVersionEndpoint = createAuthRoleFactory('admin').build({
    method: 'get',
    shortDescription: 'Get Current Version',
    description: 'Returns the currently installed version of Kling.',
    tag: 'Updates',
    input: z.object({}),
    output: z.object({
        version: z.string(),
        tag: z.string().nullable(),
        installedAt: z.string().nullable(),
        gitSha: z.string().nullable(),
        isGitRepo: z.boolean(),
        uptime: z.number(),
        nodeVersion: z.string(),
    }),
    handler: async () => {
        const version = getCurrentVersion();
        const { sha, tag, isGitRepo } = getGitInfo();
        const settings = await prisma.settings.findFirst({
            select: { createdAt: true },
        });
        return {
            version,
            tag: tag || `v${version}`,
            installedAt: settings?.createdAt?.toISOString() || null,
            gitSha: sha,
            isGitRepo,
            uptime: process.uptime(),
            nodeVersion: process.version,
        };
    },
});
export const getAvailableVersionsEndpoint = createAuthRoleFactory('admin').build({
    method: 'get',
    shortDescription: 'Get Available Versions',
    description: 'Returns all available versions from GitHub Releases.',
    tag: 'Updates',
    input: z.object({}),
    output: z.object({
        current: z.string(),
        latest: z.string(),
        updateAvailable: z.boolean(),
        versions: z.array(versionInfoSchema),
    }),
    handler: async () => {
        const currentVersion = getCurrentVersion();
        const releasesData = await fetchGitHubReleases();
        return {
            current: currentVersion,
            latest: releasesData.latest,
            updateAvailable: isNewer(releasesData.latest, currentVersion),
            versions: releasesData.versions,
        };
    },
});
export const getVersionChangelogEndpoint = createAuthRoleFactory('admin').build({
    method: 'get',
    shortDescription: 'Get Version Changelog',
    description: 'Returns the detailed changelog for a specific version.',
    tag: 'Updates',
    input: z.object({
        version: z.string(),
    }),
    output: versionInfoSchema,
    handler: async ({ input }) => {
        const releasesData = await fetchGitHubReleases();
        const versionInfo = releasesData.versions.find((v) => v.version === input.version || v.tag === input.version || v.tag === `v${input.version}`);
        if (!versionInfo) {
            throw createHttpError(404, `Version ${input.version} not found`);
        }
        return versionInfo;
    },
});
export const installUpdateEndpoint = createAuthRoleFactory('admin').build({
    method: 'post',
    shortDescription: 'Install Update',
    description: 'Installs a specific version of Kling. This will restart the server.',
    tag: 'Updates',
    input: z.object({
        version: z.string().optional(),
        skipBackup: z.boolean().optional().default(false),
    }),
    output: z.object({
        success: z.boolean(),
        version: z.string(),
        message: z.string(),
        jobId: z.string().nullable(),
    }),
    handler: async ({ input, ctx }) => {
        const { version, skipBackup } = input;
        const targetVersion = version || 'latest';
        const { isGitRepo } = getGitInfo();
        if (!isGitRepo) {
            throw createHttpError(400, 'Not a git repository. Updates are only supported for git-based installations.');
        }
        const releasesData = await fetchGitHubReleases();
        const resolvedVersion = targetVersion === 'latest' ? releasesData.latest : targetVersion;
        const versionExists = releasesData.versions.some((v) => v.version === resolvedVersion ||
            v.tag === resolvedVersion ||
            v.tag === `v${resolvedVersion}`);
        if (!versionExists && targetVersion !== 'latest') {
            throw createHttpError(404, `Version ${targetVersion} not found`);
        }
        await createAuditLog({
            action: AuditActions.systemUpdate.started,
            resourceType: 'system',
            resourceId: resolvedVersion,
            metadata: { targetVersion: resolvedVersion, skipBackup },
            context: extractAuditContext(ctx.request, ctx.user),
        });
        const { queueUpdateJob } = await import('../utils/bullmq/update-worker');
        const jobId = await queueUpdateJob({
            version: resolvedVersion,
            userId: ctx.user.sub,
            skipBackup,
            isRollback: false,
        });
        return {
            success: true,
            version: resolvedVersion,
            message: `Update to v${resolvedVersion} has been queued. The server will restart automatically.`,
            jobId,
        };
    },
});
export const rollbackVersionEndpoint = createAuthRoleFactory('admin').build({
    method: 'post',
    shortDescription: 'Rollback Version',
    description: 'Rolls back to a previous version of Kling.',
    tag: 'Updates',
    input: z.object({
        version: z.string(),
        skipBackup: z.boolean().optional().default(false),
    }),
    output: z.object({
        success: z.boolean(),
        version: z.string(),
        message: z.string(),
        jobId: z.string().nullable(),
    }),
    handler: async ({ input, ctx }) => {
        const { version, skipBackup } = input;
        const { isGitRepo } = getGitInfo();
        if (!isGitRepo) {
            throw createHttpError(400, 'Not a git repository. Rollbacks are only supported for git-based installations.');
        }
        const releasesData = await fetchGitHubReleases();
        const versionExists = releasesData.versions.some((v) => v.version === version || v.tag === version || v.tag === `v${version}`);
        if (!versionExists) {
            throw createHttpError(404, `Version ${version} not found`);
        }
        await createAuditLog({
            action: AuditActions.systemRollback.started,
            resourceType: 'system',
            resourceId: version,
            metadata: { version, skipBackup },
            context: extractAuditContext(ctx.request, ctx.user),
        });
        const { queueUpdateJob } = await import('../utils/bullmq/update-worker');
        const jobId = await queueUpdateJob({
            version,
            userId: ctx.user.sub,
            skipBackup,
            isRollback: true,
        });
        return {
            success: true,
            version,
            message: `Rollback to v${version} has been queued. The server will restart automatically.`,
            jobId,
        };
    },
});
export const getUpdateHistoryEndpoint = createAuthRoleFactory('admin').build({
    method: 'get',
    shortDescription: 'Update History',
    description: 'Returns the history of system updates and rollbacks.',
    tag: 'Updates',
    input: z.object({
        page: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 1)),
        pageSize: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 20)),
    }),
    output: z.object({
        items: z.array(z.object({
            id: z.string(),
            action: z.string(),
            version: z.string(),
            userId: z.string().nullable(),
            userName: z.string().nullable(),
            userEmail: z.string().nullable(),
            success: z.boolean().nullable(),
            error: z.string().nullable(),
            createdAt: z.string(),
        })),
        total: z.number(),
        page: z.number(),
        pageSize: z.number(),
        hasMore: z.boolean(),
    }),
    handler: async ({ input }) => {
        const { page, pageSize } = input;
        const skip = (page - 1) * pageSize;
        const updateActions = [
            'system_update_started',
            'system_update_completed',
            'system_update_failed',
            'system_rollback_started',
            'system_rollback_completed',
            'system_rollback_failed',
        ];
        const [logs, total] = await Promise.all([
            prisma.auditLog.findMany({
                where: {
                    action: { in: updateActions },
                },
                skip,
                take: pageSize + 1,
                orderBy: { createdAt: 'desc' },
                include: {
                    user: {
                        select: { name: true, email: true },
                    },
                },
            }),
            prisma.auditLog.count({
                where: {
                    action: { in: updateActions },
                },
            }),
        ]);
        const hasMore = logs.length > pageSize;
        if (hasMore)
            logs.pop();
        return {
            items: logs.map((log) => {
                const metadata = log.metadata;
                return {
                    id: log.id,
                    action: log.action,
                    version: log.resourceId || 'unknown',
                    userId: log.userId,
                    userName: log.user?.name || null,
                    userEmail: log.user?.email || null,
                    success: metadata?.success,
                    error: metadata?.error || null,
                    createdAt: log.createdAt.toISOString(),
                };
            }),
            total,
            page,
            pageSize,
            hasMore,
        };
    },
});
export const getUpdateStatusEndpoint = createAuthRoleFactory('admin').build({
    method: 'get',
    shortDescription: 'Get Update Status',
    description: 'Returns the status of the current update job, if any.',
    tag: 'Updates',
    input: z.object({}),
    output: z.object({
        isUpdating: z.boolean(),
        currentJob: z
            .object({
            id: z.string(),
            version: z.string(),
            isRollback: z.boolean(),
            status: z.string(),
            progress: z.number().nullable(),
            startedAt: z.string().nullable(),
        })
            .nullable(),
    }),
    handler: async () => {
        const { getActiveUpdateJob } = await import('../utils/bullmq/update-worker');
        const activeJob = await getActiveUpdateJob();
        if (!activeJob) {
            return {
                isUpdating: false,
                currentJob: null,
            };
        }
        const state = await activeJob.getState();
        const progress = activeJob.progress;
        return {
            isUpdating: state === 'active' || state === 'waiting',
            currentJob: {
                id: activeJob.id || '',
                version: activeJob.data.version,
                isRollback: activeJob.data.isRollback || false,
                status: state,
                progress: typeof progress === 'number' ? progress : null,
                startedAt: activeJob.processedOn ? new Date(activeJob.processedOn).toISOString() : null,
            },
        };
    },
});
