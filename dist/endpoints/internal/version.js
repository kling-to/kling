import { z } from 'zod';
import { internalFactory } from '../../factories';
import fs from 'fs/promises';
import path from 'path';
// Version manifest schema
const versionManifestSchema = z.object({
    version: z.string(),
    buildDate: z.string(),
    gitCommit: z.string(),
    gitBranch: z.string(),
    snapshot: z.object({
        name: z.string(),
    }),
    components: z.object({
        backend: z.string(),
        frontend: z.string(),
    }),
});
// Default version for development
const devVersion = {
    version: 'dev',
    buildDate: new Date().toISOString(),
    gitCommit: 'development',
    gitBranch: 'main',
    snapshot: {
        name: 'development',
    },
    components: {
        backend: 'dev',
        frontend: 'dev',
    },
};
/**
 * Get version information from the installation
 * Used by cloud dashboard to check current version and health
 */
export const getVersionEndpoint = internalFactory.build({
    method: 'get',
    shortDescription: 'Get Version',
    description: 'Returns the current version information of the installation.',
    tag: 'Internal',
    input: z.object({}),
    output: z.object({
        version: z.string(),
        buildDate: z.string(),
        gitCommit: z.string(),
        gitBranch: z.string(),
        snapshot: z.object({
            name: z.string(),
        }),
        components: z.object({
            backend: z.string(),
            frontend: z.string(),
        }),
        health: z.object({
            status: z.enum(['healthy', 'degraded', 'unhealthy']),
            uptime: z.number(),
            memoryUsage: z.number(),
        }),
    }),
    handler: async () => {
        // Try to read version manifest from production location
        let manifest = devVersion;
        try {
            const versionPath = path.join('/opt/kling', 'version.json');
            const content = await fs.readFile(versionPath, 'utf-8');
            const parsed = JSON.parse(content);
            manifest = versionManifestSchema.parse(parsed);
        }
        catch {
            // In development or if file doesn't exist, use dev version
        }
        // Get health metrics
        const uptime = process.uptime();
        const memoryUsage = process.memoryUsage();
        const heapUsedPercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
        // Determine health status
        let status = 'healthy';
        if (heapUsedPercent > 90) {
            status = 'unhealthy';
        }
        else if (heapUsedPercent > 75) {
            status = 'degraded';
        }
        return {
            ...manifest,
            health: {
                status,
                uptime: Math.floor(uptime),
                memoryUsage: Math.round(heapUsedPercent * 100) / 100,
            },
        };
    },
});
