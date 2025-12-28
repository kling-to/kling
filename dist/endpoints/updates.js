import { z } from 'zod';
import { publicFactory, createAuthRoleFactory } from '../factories';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// URL to check for latest version
const LATEST_VERSION_URL = process.env.LATEST_VERSION_URL ||
    'https://raw.githubusercontent.com/mukama/kling/main/releases/latest.json';
// Cache for version check (24 hours)
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
let cachedLatestVersion = null;
let lastCheckTime = 0;
// Get current version from VERSION file
function getCurrentVersion() {
    try {
        // Try VERSION file in project root (production)
        const versionPath = path.resolve(__dirname, '../../../../VERSION');
        if (fs.existsSync(versionPath)) {
            return fs.readFileSync(versionPath, 'utf-8').trim();
        }
        // Fallback to package.json version
        const pkgPath = path.resolve(__dirname, '../../package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            return pkg.version || '0.0.0';
        }
        return '0.0.0';
    }
    catch (error) {
        logger.error('Failed to read version', { error });
        return '0.0.0';
    }
}
// Fetch latest version from remote
async function fetchLatestVersion() {
    try {
        const response = await fetch(LATEST_VERSION_URL, {
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = (await response.json());
        return data;
    }
    catch (error) {
        logger.error('Failed to fetch latest version', { error, url: LATEST_VERSION_URL });
        return null;
    }
}
// Compare semver versions
function isNewerVersion(latest, current) {
    const latestParts = latest.split('.').map(Number);
    const currentParts = current.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        const latestPart = latestParts[i] || 0;
        const currentPart = currentParts[i] || 0;
        if (latestPart > currentPart)
            return true;
        if (latestPart < currentPart)
            return false;
    }
    return false;
}
// Check for updates endpoint (public - for UI notification)
export const checkUpdatesEndpoint = publicFactory.build({
    method: 'get',
    shortDescription: 'Check for Updates',
    description: 'Check if a newer version of Kling is available',
    tag: 'Updates',
    input: z.object({}),
    output: z.object({
        current: z.string(),
        latest: z.string(),
        updateAvailable: z.boolean(),
        breaking: z.boolean(),
        migrationRequired: z.boolean(),
        releaseNotes: z.string().optional(),
        released: z.string().optional(),
    }),
    handler: async () => {
        const currentVersion = getCurrentVersion();
        const now = Date.now();
        // Check cache
        if (cachedLatestVersion && now - lastCheckTime < CHECK_INTERVAL_MS) {
            return {
                current: currentVersion,
                latest: cachedLatestVersion.version,
                updateAvailable: isNewerVersion(cachedLatestVersion.version, currentVersion),
                breaking: cachedLatestVersion.breaking,
                migrationRequired: cachedLatestVersion.migrationRequired,
                releaseNotes: cachedLatestVersion.changelog,
                released: cachedLatestVersion.released,
            };
        }
        // Fetch latest
        const latest = await fetchLatestVersion();
        if (latest) {
            cachedLatestVersion = latest;
            lastCheckTime = now;
        }
        const latestVersion = latest?.version || currentVersion;
        return {
            current: currentVersion,
            latest: latestVersion,
            updateAvailable: isNewerVersion(latestVersion, currentVersion),
            breaking: latest?.breaking || false,
            migrationRequired: latest?.migrationRequired || false,
            releaseNotes: latest?.changelog,
            released: latest?.released,
        };
    },
});
// Force refresh update check (admin only)
export const refreshUpdatesEndpoint = createAuthRoleFactory('admin').build({
    method: 'post',
    shortDescription: 'Refresh Update Check',
    description: 'Force refresh the update check cache',
    tag: 'Updates',
    input: z.object({}),
    output: z.object({
        current: z.string(),
        latest: z.string(),
        updateAvailable: z.boolean(),
        breaking: z.boolean(),
        migrationRequired: z.boolean(),
        releaseNotes: z.string().optional(),
        released: z.string().optional(),
    }),
    handler: async () => {
        const currentVersion = getCurrentVersion();
        // Force fetch (ignore cache)
        const latest = await fetchLatestVersion();
        if (latest) {
            cachedLatestVersion = latest;
            lastCheckTime = Date.now();
        }
        const latestVersion = latest?.version || currentVersion;
        return {
            current: currentVersion,
            latest: latestVersion,
            updateAvailable: isNewerVersion(latestVersion, currentVersion),
            breaking: latest?.breaking || false,
            migrationRequired: latest?.migrationRequired || false,
            releaseNotes: latest?.changelog,
            released: latest?.released,
        };
    },
});
// Get update instructions (admin only)
export const getUpdateInstructionsEndpoint = createAuthRoleFactory('admin').build({
    method: 'get',
    shortDescription: 'Get Update Instructions',
    description: 'Get instructions for updating to the latest version',
    tag: 'Updates',
    input: z.object({}),
    output: z.object({
        current: z.string(),
        latest: z.string().optional(),
        updateAvailable: z.boolean(),
        instructions: z.array(z.string()),
        downloadUrl: z.string().optional(),
        changelog: z.string().optional(),
    }),
    handler: async () => {
        const currentVersion = getCurrentVersion();
        // Fetch latest if not cached
        if (!cachedLatestVersion) {
            cachedLatestVersion = await fetchLatestVersion();
            if (cachedLatestVersion) {
                lastCheckTime = Date.now();
            }
        }
        const latest = cachedLatestVersion;
        const updateAvailable = latest ? isNewerVersion(latest.version, currentVersion) : false;
        const instructions = [
            'SSH into your server',
            'Navigate to your Kling installation directory',
            'Run: bash scripts/update.sh',
            'The script will automatically:',
            '  - Backup your current installation',
            '  - Download and verify the new version',
            '  - Apply the update',
            '  - Restart the service',
            '  - Run health checks',
            '',
            'If something goes wrong, rollback with: bash scripts/rollback.sh',
        ];
        if (latest?.breaking) {
            instructions.unshift('WARNING: This is a breaking change. Review release notes carefully.', '');
        }
        if (latest?.migrationRequired) {
            instructions.push('', 'Note: This update includes database schema changes.');
        }
        return {
            current: currentVersion,
            latest: latest?.version,
            updateAvailable,
            instructions,
            downloadUrl: latest?.downloadUrl,
            changelog: latest?.changelog,
        };
    },
});
