import { z } from 'zod';
import { publicFactory } from '../factories';
import { areWorkersRunning } from '../utils/bullmq';
import prisma from '../utils/prisma';
import { providerRegistry } from '../providers/registry';
import { register, metrics } from '../utils/metrics.js';
// Health check endpoint
export const healthEndpoint = publicFactory.build({
    method: 'get',
    shortDescription: 'Health Check',
    description: 'Returns the health status of the application and its dependencies.',
    tag: 'Health',
    input: z.object({}),
    output: z.object({
        status: z.string(),
        checks: z.object({
            database: z.string(),
            bullmq: z.string(),
            messageProviders: z.string(),
        }),
    }),
    handler: async () => {
        // Check database connectivity
        let databaseStatus = 'error';
        try {
            await prisma.$runCommandRaw({ ping: 1 });
            databaseStatus = 'ok';
        }
        catch {
            databaseStatus = 'error';
        }
        // Check BullMQ workers
        const workers = areWorkersRunning();
        const bullmqStatus = workers.campaign && workers.customer ? 'ok' : 'degraded';
        // Check message providers
        let messageProvidersStatus = 'ok';
        const providers = providerRegistry.list();
        if (providers.length === 0) {
            messageProvidersStatus = 'error';
        }
        else {
            const healthChecks = await Promise.all(providers.map((p) => p.healthCheck()));
            const allHealthy = healthChecks.every((h) => h);
            const noneHealthy = healthChecks.every((h) => !h);
            if (noneHealthy) {
                messageProvidersStatus = 'error';
            }
            else if (!allHealthy) {
                messageProvidersStatus = 'degraded';
            }
        }
        // Determine overall status
        let status = 'ok';
        if (databaseStatus === 'error') {
            status = 'error';
        }
        else if (bullmqStatus === 'degraded' || messageProvidersStatus === 'degraded') {
            status = 'degraded';
        }
        else if (messageProvidersStatus === 'error') {
            status = 'degraded';
        }
        return {
            status,
            checks: {
                database: databaseStatus,
                bullmq: bullmqStatus,
                messageProviders: messageProvidersStatus,
            },
        };
    },
});
// Metrics endpoint (returns Prometheus format)
export const metricsEndpoint = publicFactory.build({
    method: 'get',
    shortDescription: 'Prometheus Metrics',
    description: 'Returns application metrics in Prometheus format for monitoring.',
    tag: 'Health',
    input: z.object({}),
    output: z.object({
        metrics: z.string(),
    }),
    handler: async () => {
        // Update provider health metrics
        const providers = providerRegistry.list();
        for (const provider of providers) {
            const healthy = await provider.healthCheck();
            metrics.providerHealth
                .labels({ provider: provider.name, channel: provider.channel })
                .set(healthy ? 1 : 0);
        }
        // Return metrics in Prometheus format
        const metricsText = await register.metrics();
        return { metrics: metricsText };
    },
});
