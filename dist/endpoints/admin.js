import { z } from 'zod';
import { createAuthRoleFactory, authFactory } from '../factories';
import prisma from '../utils/prisma';
import { getQueueMetrics, areWorkersRunning, triggerAutoTuneNow, isAutoTuneWorkerRunning, } from '../utils/bullmq';
import { providerRegistry } from '../providers';
import { AuditAction } from '@prisma/client';
import { getCampaignPerformance, evaluateCampaign, autoTuneCampaign, autoTuneActiveCampaigns, DEFAULT_AUTO_TUNE_CONFIG, } from '../utils/auto-tune';
import { checkQuotaFresh } from '../utils/quotas';
import { objectIdSchema } from '../utils/validation';
// System health endpoint (owner/admin only)
export const systemHealthEndpoint = createAuthRoleFactory('admin').build({
    method: 'get',
    shortDescription: 'System Health',
    description: 'Returns the health status of system components.',
    tag: 'Admin',
    input: z.object({}),
    output: z.object({
        status: z.enum(['healthy', 'degraded', 'unhealthy']),
        timestamp: z.string(),
        components: z.object({
            database: z.object({
                status: z.enum(['ok', 'error']),
                latencyMs: z.number().optional(),
                error: z.string().optional(),
            }),
            bullmq: z.object({
                status: z.enum(['ok', 'error']),
                workers: z.object({
                    campaign: z.boolean(),
                    customer: z.boolean(),
                }),
                queues: z
                    .object({
                    campaign: z.object({
                        waiting: z.number(),
                        active: z.number(),
                        completed: z.number(),
                        failed: z.number(),
                        delayed: z.number(),
                    }),
                    customer: z.object({
                        waiting: z.number(),
                        active: z.number(),
                        completed: z.number(),
                        failed: z.number(),
                        delayed: z.number(),
                    }),
                    dlq: z.object({
                        waiting: z.number(),
                    }),
                })
                    .optional(),
                error: z.string().optional(),
            }),
            messageProviders: z.object({
                status: z.enum(['ok', 'degraded', 'error']),
                providers: z.array(z.object({
                    name: z.string(),
                    channel: z.string(),
                    healthy: z.boolean(),
                })),
            }),
        }),
    }),
    handler: async () => {
        let dbStatus = { status: 'ok', latencyMs: 0 };
        let bullmqStatus = {
            status: 'ok',
            workers: { campaign: false, customer: false },
        };
        let providerStatus = { status: 'ok', providers: [] };
        // Check database
        const dbStart = Date.now();
        try {
            await prisma.$runCommandRaw({ ping: 1 });
            dbStatus = { status: 'ok', latencyMs: Date.now() - dbStart };
        }
        catch (err) {
            dbStatus = {
                status: 'error',
                latencyMs: Date.now() - dbStart,
                error: err instanceof Error ? err.message : 'Database connection failed',
            };
        }
        // Check BullMQ
        try {
            const workers = areWorkersRunning();
            const metrics = await getQueueMetrics();
            bullmqStatus = {
                status: workers.campaign && workers.customer ? 'ok' : 'error',
                workers,
                queues: metrics,
            };
        }
        catch (err) {
            bullmqStatus = {
                status: 'error',
                workers: { campaign: false, customer: false },
                error: err instanceof Error ? err.message : 'BullMQ connection failed',
            };
        }
        // Check message providers
        const providers = providerRegistry.list();
        const providerHealthChecks = await Promise.all(providers.map(async (provider) => {
            const healthy = await provider.healthCheck();
            return {
                name: provider.name,
                channel: provider.channel,
                healthy,
            };
        }));
        const unhealthyProviders = providerHealthChecks.filter((p) => !p.healthy);
        let providerStatusValue = 'ok';
        if (unhealthyProviders.length === providerHealthChecks.length &&
            providerHealthChecks.length > 0) {
            providerStatusValue = 'error';
        }
        else if (unhealthyProviders.length > 0) {
            providerStatusValue = 'degraded';
        }
        providerStatus = { status: providerStatusValue, providers: providerHealthChecks };
        // Determine overall status
        let overallStatus = 'healthy';
        if (dbStatus.status === 'error') {
            overallStatus = 'unhealthy';
        }
        else if (bullmqStatus.status === 'error' || providerStatus.status === 'error') {
            overallStatus = 'degraded';
        }
        else if (providerStatus.status === 'degraded') {
            overallStatus = 'degraded';
        }
        return {
            status: overallStatus,
            timestamp: new Date().toISOString(),
            components: {
                database: dbStatus,
                bullmq: bullmqStatus,
                messageProviders: providerStatus,
            },
        };
    },
});
// Audit list endpoint
export const auditListEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'Audit Logs',
    description: 'Returns a paginated list of audit logs.',
    tag: 'Admin',
    input: z.object({
        page: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 1)),
        pageSize: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 50)),
        action: z.string().optional(),
        resourceType: z.string().optional(),
        resourceId: z.string().optional(),
        userId: z.string().optional(),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
    }),
    output: z.object({
        items: z.array(z.object({
            id: z.string(),
            userId: z.string().nullable(),
            action: z.string(),
            resourceType: z.string().nullable(),
            resourceId: z.string().nullable(),
            metadata: z.unknown(),
            ipAddress: z.string().nullable(),
            userAgent: z.string().nullable(),
            createdAt: z.string(),
            user: z
                .object({
                name: z.string().nullable(),
                email: z.string(),
            })
                .nullable(),
        })),
        total: z.number(),
        page: z.number(),
        pageSize: z.number(),
        hasMore: z.boolean(),
    }),
    handler: async ({ input }) => {
        const { page, pageSize, action, resourceType, resourceId, userId, startDate, endDate } = input;
        const skip = (page - 1) * pageSize;
        // Build where clause using Prisma types
        const where = {};
        // Cast action to AuditAction enum if provided
        if (action && Object.values(AuditAction).includes(action)) {
            where.action = action;
        }
        if (resourceType)
            where.resourceType = resourceType;
        if (resourceId)
            where.resourceId = resourceId;
        if (userId)
            where.userId = userId;
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate)
                where.createdAt.gte = new Date(startDate);
            if (endDate)
                where.createdAt.lte = new Date(endDate);
        }
        const [logs, total] = await Promise.all([
            prisma.auditLog.findMany({
                where,
                skip,
                take: pageSize + 1,
                orderBy: { createdAt: 'desc' },
                include: {
                    user: {
                        select: {
                            name: true,
                            email: true,
                        },
                    },
                },
            }),
            prisma.auditLog.count({ where }),
        ]);
        const hasMore = logs.length > pageSize;
        if (hasMore)
            logs.pop();
        return {
            items: logs.map((log) => ({
                id: log.id,
                userId: log.userId,
                action: log.action,
                resourceType: log.resourceType,
                resourceId: log.resourceId,
                metadata: log.metadata,
                ipAddress: log.ipAddress,
                userAgent: log.userAgent,
                createdAt: log.createdAt.toISOString(),
                user: log.user
                    ? {
                        name: log.user.name,
                        email: log.user.email,
                    }
                    : null,
            })),
            total,
            page,
            pageSize,
            hasMore,
        };
    },
});
// Quota usage endpoint
export const quotaUsageEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'Quota Usage',
    description: 'Returns message quota usage for the system.',
    tag: 'Admin',
    input: z.object({}),
    output: z.object({
        limits: z.object({
            dailyMessageLimit: z.number(),
            monthlyMessageLimit: z.number(),
        }),
        usage: z.object({
            today: z.number(),
            thisMonth: z.number(),
        }),
        remaining: z.object({
            today: z.number(),
            thisMonth: z.number(),
        }),
    }),
    handler: async () => {
        // Get fresh quota status (no cache)
        const quotaStatus = await checkQuotaFresh();
        return {
            limits: {
                dailyMessageLimit: quotaStatus.daily.limit,
                monthlyMessageLimit: quotaStatus.monthly.limit,
            },
            usage: {
                today: quotaStatus.daily.used,
                thisMonth: quotaStatus.monthly.used,
            },
            remaining: {
                today: quotaStatus.daily.remaining,
                thisMonth: quotaStatus.monthly.remaining,
            },
        };
    },
});
// Auto-tune config schema for validation
const autoTuneConfigSchema = z.object({
    enabled: z.boolean().optional(),
    minExecutions: z.number().min(1).optional(),
    minMessagesSent: z.number().min(1).optional(),
    thresholds: z
        .object({
        minDeliveryRate: z.number().min(0).max(1).optional(),
        minOpenRate: z.number().min(0).max(1).optional(),
        minClickRate: z.number().min(0).max(1).optional(),
        maxBounceRate: z.number().min(0).max(1).optional(),
        maxComplaintRate: z.number().min(0).max(1).optional(),
        maxFailureRate: z.number().min(0).max(1).optional(),
    })
        .optional(),
    evaluationWindowDays: z.number().min(1).optional(),
});
// Get campaign performance metrics
export const campaignPerformanceEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'Campaign Performance',
    description: 'Returns performance metrics for a specific campaign.',
    tag: 'Admin',
    input: z.object({
        campaignId: objectIdSchema,
        windowDays: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 7)),
    }),
    output: z.object({
        campaignId: z.string(),
        campaignName: z.string(),
        channel: z.string(),
        executionCount: z.number(),
        metrics: z.object({
            totalSent: z.number(),
            totalDelivered: z.number(),
            totalOpened: z.number(),
            totalClicked: z.number(),
            totalBounced: z.number(),
            totalFailed: z.number(),
            totalComplained: z.number(),
            deliveryRate: z.number(),
            openRate: z.number(),
            clickRate: z.number(),
            bounceRate: z.number(),
            complaintRate: z.number(),
            failureRate: z.number(),
        }),
    }),
    handler: async ({ input }) => {
        const metrics = await getCampaignPerformance(input.campaignId, input.windowDays);
        if (!metrics) {
            throw new Error('Campaign not found');
        }
        return {
            campaignId: metrics.campaignId,
            campaignName: metrics.campaignName,
            channel: metrics.channel,
            executionCount: metrics.executionCount,
            metrics: {
                totalSent: metrics.totalSent,
                totalDelivered: metrics.totalDelivered,
                totalOpened: metrics.totalOpened,
                totalClicked: metrics.totalClicked,
                totalBounced: metrics.totalBounced,
                totalFailed: metrics.totalFailed,
                totalComplained: metrics.totalComplained,
                deliveryRate: metrics.deliveryRate,
                openRate: metrics.openRate,
                clickRate: metrics.clickRate,
                bounceRate: metrics.bounceRate,
                complaintRate: metrics.complaintRate,
                failureRate: metrics.failureRate,
            },
        };
    },
});
// Evaluate campaign for auto-tune without pausing
export const evaluateCampaignAutoTuneEndpoint = authFactory.build({
    method: 'post',
    shortDescription: 'Evaluate Auto-tune',
    description: 'Evaluates a campaign against auto-tune rules without pausing it.',
    tag: 'Admin',
    input: z.object({
        campaignId: objectIdSchema,
        config: autoTuneConfigSchema.optional(),
    }),
    output: z.object({
        campaignId: z.string(),
        shouldPause: z.boolean(),
        reasons: z.array(z.string()),
        metrics: z.object({
            executionCount: z.number(),
            totalSent: z.number(),
            deliveryRate: z.number(),
            bounceRate: z.number(),
            failureRate: z.number(),
            openRate: z.number(),
            clickRate: z.number(),
        }),
    }),
    handler: async ({ input }) => {
        const config = {
            ...DEFAULT_AUTO_TUNE_CONFIG,
            ...input.config,
            thresholds: {
                ...DEFAULT_AUTO_TUNE_CONFIG.thresholds,
                ...input.config?.thresholds,
            },
        };
        const metrics = await getCampaignPerformance(input.campaignId, config.evaluationWindowDays);
        if (!metrics) {
            throw new Error('Campaign not found');
        }
        const result = evaluateCampaign(metrics, config);
        return {
            campaignId: result.campaignId,
            shouldPause: result.shouldPause,
            reasons: result.reasons,
            metrics: {
                executionCount: result.metrics.executionCount,
                totalSent: result.metrics.totalSent,
                deliveryRate: result.metrics.deliveryRate,
                bounceRate: result.metrics.bounceRate,
                failureRate: result.metrics.failureRate,
                openRate: result.metrics.openRate,
                clickRate: result.metrics.clickRate,
            },
        };
    },
});
// Run auto-tune for a single campaign (will pause if needed)
export const runAutoTuneCampaignEndpoint = createAuthRoleFactory('admin').build({
    method: 'post',
    shortDescription: 'Run Auto-tune',
    description: 'Runs auto-tune evaluation for a campaign and pauses it if thresholds are exceeded.',
    tag: 'Admin',
    input: z.object({
        campaignId: objectIdSchema,
        config: autoTuneConfigSchema.optional(),
    }),
    output: z.object({
        campaignId: z.string(),
        wasPaused: z.boolean(),
        reasons: z.array(z.string()),
    }),
    handler: async ({ input }) => {
        const config = {
            ...DEFAULT_AUTO_TUNE_CONFIG,
            ...input.config,
            thresholds: {
                ...DEFAULT_AUTO_TUNE_CONFIG.thresholds,
                ...input.config?.thresholds,
            },
        };
        const result = await autoTuneCampaign(input.campaignId, config);
        if (!result) {
            return {
                campaignId: input.campaignId,
                wasPaused: false,
                reasons: ['Auto-tune is disabled or campaign not found'],
            };
        }
        return {
            campaignId: result.campaignId,
            wasPaused: result.shouldPause,
            reasons: result.reasons,
        };
    },
});
// Run auto-tune for all campaigns
export const runAutoTuneAllEndpoint = createAuthRoleFactory('admin').build({
    method: 'post',
    shortDescription: 'Run All Auto-tune',
    description: 'Runs auto-tune evaluation for all active campaigns.',
    tag: 'Admin',
    input: z.object({
        config: autoTuneConfigSchema.optional(),
    }),
    output: z.object({
        evaluated: z.number(),
        paused: z.number(),
        results: z.array(z.object({
            campaignId: z.string(),
            wasPaused: z.boolean(),
            reasons: z.array(z.string()),
        })),
    }),
    handler: async ({ input }) => {
        const config = {
            ...DEFAULT_AUTO_TUNE_CONFIG,
            ...input.config,
            thresholds: {
                ...DEFAULT_AUTO_TUNE_CONFIG.thresholds,
                ...input.config?.thresholds,
            },
        };
        const results = await autoTuneActiveCampaigns(config);
        const paused = results.filter((r) => r.shouldPause).length;
        return {
            evaluated: results.length,
            paused,
            results: results.map((r) => ({
                campaignId: r.campaignId,
                wasPaused: r.shouldPause,
                reasons: r.reasons,
            })),
        };
    },
});
// Trigger system-wide auto-tune via BullMQ worker
export const triggerAutoTuneEndpoint = createAuthRoleFactory('admin').build({
    method: 'post',
    shortDescription: 'Trigger Auto-tune',
    description: 'Triggers an immediate system-wide auto-tune evaluation via BullMQ.',
    tag: 'Admin',
    input: z.object({
        config: autoTuneConfigSchema.optional(),
    }),
    output: z.object({
        success: z.boolean(),
        jobId: z.string(),
        message: z.string(),
    }),
    handler: async ({ input }) => {
        if (!isAutoTuneWorkerRunning()) {
            throw new Error('Auto-tune worker is not running');
        }
        const config = input.config
            ? {
                ...DEFAULT_AUTO_TUNE_CONFIG,
                ...input.config,
                thresholds: {
                    ...DEFAULT_AUTO_TUNE_CONFIG.thresholds,
                    ...input.config?.thresholds,
                },
            }
            : undefined;
        const jobId = await triggerAutoTuneNow(config);
        return {
            success: true,
            jobId,
            message: 'Auto-tune job triggered. Check audit logs for results.',
        };
    },
});
// Get auto-tune status
export const autoTuneStatusEndpoint = createAuthRoleFactory('admin').build({
    method: 'get',
    shortDescription: 'Auto-tune Status',
    description: 'Returns the current status of the auto-tune worker.',
    tag: 'Admin',
    input: z.object({}),
    output: z.object({
        workerRunning: z.boolean(),
        defaultConfig: z.object({
            enabled: z.boolean(),
            minExecutions: z.number(),
            minMessagesSent: z.number(),
            evaluationWindowDays: z.number(),
            thresholds: z.object({
                minDeliveryRate: z.number(),
                minOpenRate: z.number(),
                minClickRate: z.number(),
                maxBounceRate: z.number(),
                maxComplaintRate: z.number(),
                maxFailureRate: z.number(),
            }),
        }),
    }),
    handler: async () => {
        return {
            workerRunning: isAutoTuneWorkerRunning(),
            defaultConfig: DEFAULT_AUTO_TUNE_CONFIG,
        };
    },
});
// ============================================================
// SEND TIME OPTIMIZATION ENDPOINTS
// ============================================================
import { calculateCustomerSendTime, calculateAllSendTimes, calculateBatchSendTimes, getSendTimeDistribution, } from '../utils/send-time-calculator';
/**
 * Calculate send time profiles for customers
 */
export const calculateSendTimeProfilesEndpoint = createAuthRoleFactory('admin').build({
    method: 'post',
    shortDescription: 'Calculate Send Time Profiles',
    description: 'Calculates optimal send time profiles for customers based on their email open history. Can calculate for all customers or a specific subset.',
    tag: 'Admin',
    input: z.object({
        customerIds: z.array(objectIdSchema).optional(),
        recalculateAll: z.boolean().optional().default(false),
    }),
    output: z.object({
        total: z.number(),
        calculated: z.number(),
        skipped: z.number(),
        errors: z.number(),
        averageConfidence: z.number(),
    }),
    handler: async ({ input }) => {
        if (input.recalculateAll || !input.customerIds) {
            return await calculateAllSendTimes();
        }
        return await calculateBatchSendTimes(input.customerIds);
    },
});
/**
 * Get send time profile for a specific customer
 */
export const getSendTimeProfileEndpoint = createAuthRoleFactory('admin', 'manager').build({
    method: 'get',
    shortDescription: 'Get Send Time Profile',
    description: 'Returns the send time optimization profile for a specific customer.',
    tag: 'Admin',
    input: z.object({
        customerId: objectIdSchema,
    }),
    output: z.object({
        profile: z
            .object({
            customerId: z.string(),
            optimalHour: z.number(),
            confidence: z.number(),
            sampleSize: z.number(),
            hourlyDistribution: z.record(z.string(), z.number()),
            timezone: z.string().nullable(),
            calculatedAt: z.string(),
        })
            .nullable(),
        calculated: z
            .object({
            optimalHour: z.number(),
            confidence: z.number(),
            sampleSize: z.number(),
            hourlyDistribution: z.record(z.string(), z.number()),
            timezone: z.string().nullable(),
            reason: z.string().optional(),
        })
            .optional(),
    }),
    handler: async ({ input }) => {
        // Get stored profile
        const storedProfile = await prisma.customerSendTimeProfile.findUnique({
            where: { customerId: input.customerId },
        });
        // Also calculate fresh profile for comparison
        const freshResult = await calculateCustomerSendTime(input.customerId);
        return {
            profile: storedProfile
                ? {
                    customerId: storedProfile.customerId,
                    optimalHour: storedProfile.optimalHour,
                    confidence: storedProfile.confidence,
                    sampleSize: storedProfile.sampleSize,
                    hourlyDistribution: storedProfile.hourlyDistribution,
                    timezone: storedProfile.timezone,
                    calculatedAt: storedProfile.calculatedAt.toISOString(),
                }
                : null,
            calculated: freshResult.success && freshResult.profile
                ? {
                    optimalHour: freshResult.profile.optimalHour,
                    confidence: freshResult.profile.confidence,
                    sampleSize: freshResult.profile.sampleSize,
                    hourlyDistribution: freshResult.profile.hourlyDistribution,
                    timezone: freshResult.profile.timezone,
                }
                : freshResult.reason
                    ? {
                        optimalHour: 0,
                        confidence: 0,
                        sampleSize: 0,
                        hourlyDistribution: {},
                        timezone: null,
                        reason: freshResult.reason,
                    }
                    : undefined,
        };
    },
});
/**
 * Get send time optimization statistics
 */
export const getSendTimeStatsEndpoint = createAuthRoleFactory('admin', 'manager').build({
    method: 'get',
    shortDescription: 'Get Send Time Stats',
    description: 'Returns overall statistics about send time optimization profiles.',
    tag: 'Admin',
    input: z.object({}),
    output: z.object({
        totalProfiles: z.number(),
        averageConfidence: z.number(),
        hourlyDistribution: z.record(z.string(), z.number()),
        confidenceBreakdown: z.object({
            high: z.number(),
            medium: z.number(),
            low: z.number(),
        }),
    }),
    handler: async () => {
        const profiles = await prisma.customerSendTimeProfile.findMany();
        const hourlyDistribution = {};
        for (let i = 0; i < 24; i++) {
            hourlyDistribution[i.toString()] = 0;
        }
        let totalConfidence = 0;
        let high = 0;
        let medium = 0;
        let low = 0;
        for (const profile of profiles) {
            hourlyDistribution[profile.optimalHour.toString()]++;
            totalConfidence += profile.confidence;
            if (profile.confidence >= 0.7) {
                high++;
            }
            else if (profile.confidence >= 0.4) {
                medium++;
            }
            else {
                low++;
            }
        }
        return {
            totalProfiles: profiles.length,
            averageConfidence: profiles.length > 0 ? totalConfidence / profiles.length : 0,
            hourlyDistribution,
            confidenceBreakdown: { high, medium, low },
        };
    },
});
/**
 * Preview send time distribution for a campaign
 */
export const previewCampaignSendTimesEndpoint = createAuthRoleFactory('admin', 'manager').build({
    method: 'post',
    shortDescription: 'Preview Campaign Send Times',
    description: 'Shows how messages would be distributed across hours if send time optimization is enabled for a campaign.',
    tag: 'Admin',
    input: z.object({
        campaignId: objectIdSchema,
    }),
    output: z.object({
        campaignName: z.string(),
        targetedCustomers: z.number(),
        withProfile: z.number(),
        withoutProfile: z.number(),
        hourlyDistribution: z.record(z.string(), z.number()),
        averageConfidence: z.number(),
        defaultSendHour: z.number().nullable(),
    }),
    handler: async ({ input }) => {
        const campaign = await prisma.campaignDefinition.findUnique({
            where: { id: input.campaignId },
        });
        if (!campaign) {
            throw new Error('Campaign not found');
        }
        // Get targeted customers (simplified - use preview endpoint logic)
        // For now, just get all customers with email
        const customers = await prisma.customer.findMany({
            where: { optOut: false, email: { not: null } },
            select: { id: true },
            take: 10000, // Limit for preview
        });
        const customerIds = customers.map((c) => c.id);
        const distribution = await getSendTimeDistribution(customerIds);
        return {
            campaignName: campaign.name,
            targetedCustomers: customerIds.length,
            withProfile: distribution.withProfile,
            withoutProfile: distribution.withoutProfile,
            hourlyDistribution: distribution.hourlyDistribution,
            averageConfidence: distribution.averageConfidence,
            defaultSendHour: campaign.defaultSendHour,
        };
    },
});
// ============================================================
// BROWSE ABANDONMENT ENDPOINTS
// ============================================================
import { getBrowseAbandonmentScheduleInfo, triggerBrowseAbandonmentNow, isBrowseAbandonmentWorkerRunning, } from '../utils/bullmq/browse-abandonment-worker';
/**
 * Get browse abandonment status
 */
export const browseAbandonmentStatusEndpoint = createAuthRoleFactory('admin').build({
    method: 'get',
    shortDescription: 'Browse Abandonment Status',
    description: 'Returns the current status of browse abandonment detection.',
    tag: 'Admin',
    input: z.object({}),
    output: z.object({
        workerRunning: z.boolean(),
        schedule: z.object({
            enabled: z.boolean(),
            cronPattern: z.string().nullable(),
            nextRun: z.date().nullable(),
        }),
        settings: z.object({
            timeoutMins: z.number(),
        }),
    }),
    handler: async () => {
        const scheduleInfo = await getBrowseAbandonmentScheduleInfo();
        const settings = await prisma.settings.findFirst();
        return {
            workerRunning: isBrowseAbandonmentWorkerRunning(),
            schedule: {
                enabled: scheduleInfo.enabled,
                cronPattern: scheduleInfo.cronPattern,
                nextRun: scheduleInfo.nextRun,
            },
            settings: {
                timeoutMins: settings?.browseAbandonmentTimeoutMins ?? 120,
            },
        };
    },
});
/**
 * Trigger browse abandonment detection now
 */
export const triggerBrowseAbandonmentEndpoint = createAuthRoleFactory('admin').build({
    method: 'post',
    shortDescription: 'Trigger Browse Abandonment',
    description: 'Triggers an immediate browse abandonment detection run.',
    tag: 'Admin',
    input: z.object({
        timeoutMins: z.number().int().min(1).max(1440).optional(),
    }),
    output: z.object({
        success: z.boolean(),
        jobId: z.string(),
        message: z.string(),
    }),
    handler: async ({ input }) => {
        if (!isBrowseAbandonmentWorkerRunning()) {
            throw new Error('Browse abandonment worker is not running');
        }
        const jobId = await triggerBrowseAbandonmentNow(input.timeoutMins);
        return {
            success: true,
            jobId,
            message: 'Browse abandonment detection triggered. Check events for results.',
        };
    },
});
/**
 * Get browse abandonment statistics
 */
export const browseAbandonmentStatsEndpoint = createAuthRoleFactory('admin', 'manager').build({
    method: 'get',
    shortDescription: 'Browse Abandonment Stats',
    description: 'Returns statistics about browse abandonment detection.',
    tag: 'Admin',
    input: z.object({
        days: z.number().int().min(1).max(90).optional().default(30),
    }),
    output: z.object({
        period: z.string(),
        totalViews: z.number(),
        totalAbandoned: z.number(),
        abandonmentRate: z.number(),
        flowsTriggered: z.number(),
        topProducts: z.array(z.object({
            productId: z.string(),
            productName: z.string().nullable(),
            views: z.number(),
            abandoned: z.number(),
        })),
    }),
    handler: async ({ input }) => {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - input.days);
        // Count product views
        const viewEvents = await prisma.customerEvent.findMany({
            where: {
                eventType: 'product_viewed',
                createdAt: { gte: cutoffDate },
            },
            select: {
                id: true,
                eventData: true,
            },
        });
        // Count browse abandonment events
        const abandonedEvents = await prisma.customerEvent.findMany({
            where: {
                eventType: 'browse_abandoned',
                createdAt: { gte: cutoffDate },
            },
            select: {
                id: true,
                eventData: true,
            },
        });
        // Count flow enrollments triggered by browse_abandoned
        const flowEnrollments = await prisma.flowEnrollment.count({
            where: {
                enrolledAt: { gte: cutoffDate },
                flow: {
                    triggerType: 'browse_abandonment',
                },
            },
        });
        // Build product stats
        const productViews = new Map();
        for (const event of viewEvents) {
            const data = event.eventData;
            const productId = data?.productId || 'unknown';
            const productName = data?.productName || null;
            if (!productViews.has(productId)) {
                productViews.set(productId, { name: productName, views: 0, abandoned: 0 });
            }
            productViews.get(productId).views++;
        }
        for (const event of abandonedEvents) {
            const data = event.eventData;
            const productId = data?.productId || 'unknown';
            const productName = data?.productName || null;
            if (!productViews.has(productId)) {
                productViews.set(productId, { name: productName, views: 0, abandoned: 0 });
            }
            productViews.get(productId).abandoned++;
        }
        // Top 10 products by abandonment
        const topProducts = Array.from(productViews.entries())
            .map(([productId, data]) => ({
            productId,
            productName: data.name,
            views: data.views,
            abandoned: data.abandoned,
        }))
            .sort((a, b) => b.abandoned - a.abandoned)
            .slice(0, 10);
        const totalViews = viewEvents.length;
        const totalAbandoned = abandonedEvents.length;
        return {
            period: `${input.days} days`,
            totalViews,
            totalAbandoned,
            abandonmentRate: totalViews > 0 ? totalAbandoned / totalViews : 0,
            flowsTriggered: flowEnrollments,
            topProducts,
        };
    },
});
// ============================================================
// PREDICTIVE ANALYTICS ENDPOINTS
// ============================================================
import { getPredictionJobStatus, triggerPredictionCalculation, } from '../utils/bullmq/prediction-worker';
import { getPredictionStats, calculateCustomerPrediction, savePrediction, } from '../utils/prediction-calculator';
/**
 * Get prediction worker status
 */
export const predictionStatusEndpoint = createAuthRoleFactory('admin').build({
    method: 'get',
    shortDescription: 'Prediction Status',
    description: 'Returns the current status of the prediction calculation worker.',
    tag: 'Admin',
    input: z.object({}),
    output: z.object({
        workerStatus: z.object({
            isScheduled: z.boolean(),
            cronPattern: z.string().nullable(),
            nextRun: z.date().nullable(),
            activeJobs: z.number(),
            waitingJobs: z.number(),
            completedJobs: z.number(),
            failedJobs: z.number(),
        }),
        settings: z.object({
            predictionsEnabled: z.boolean(),
            predictionCalculationCron: z.string(),
            predictionMinOrders: z.number(),
            predictionMinMessages: z.number(),
            predictionLookbackDays: z.number(),
        }),
    }),
    handler: async () => {
        const workerStatus = await getPredictionJobStatus();
        const settings = await prisma.settings.findFirst();
        return {
            workerStatus,
            settings: {
                predictionsEnabled: settings?.predictionsEnabled ?? false,
                predictionCalculationCron: settings?.predictionCalculationCron ?? '0 2 * * *',
                predictionMinOrders: settings?.predictionMinOrders ?? 2,
                predictionMinMessages: settings?.predictionMinMessages ?? 5,
                predictionLookbackDays: settings?.predictionLookbackDays ?? 90,
            },
        };
    },
});
/**
 * Trigger prediction calculation now
 */
export const triggerPredictionEndpoint = createAuthRoleFactory('admin').build({
    method: 'post',
    shortDescription: 'Trigger Prediction Calculation',
    description: 'Triggers an immediate prediction calculation run for all customers or a specific customer.',
    tag: 'Admin',
    input: z.object({
        customerId: objectIdSchema.optional(),
    }),
    output: z.object({
        success: z.boolean(),
        jobId: z.string(),
        message: z.string(),
    }),
    handler: async ({ input }) => {
        const settings = await prisma.settings.findFirst();
        if (!settings?.predictionsEnabled) {
            throw new Error('Predictions are disabled in settings');
        }
        const { jobId } = await triggerPredictionCalculation(input.customerId);
        return {
            success: true,
            jobId,
            message: input.customerId
                ? `Prediction calculation triggered for customer ${input.customerId}`
                : 'Prediction calculation triggered for all customers',
        };
    },
});
/**
 * Get prediction statistics
 */
export const predictionStatsEndpoint = createAuthRoleFactory('admin', 'manager').build({
    method: 'get',
    shortDescription: 'Prediction Stats',
    description: 'Returns overall statistics about customer predictions.',
    tag: 'Admin',
    input: z.object({}),
    output: z.object({
        enabled: z.boolean(),
        totalCustomers: z.number(),
        customersWithPredictions: z.number(),
        lastCalculatedAt: z.date().nullable(),
        averageConfidence: z.number(),
        ltvDistribution: z.object({
            min: z.number(),
            max: z.number(),
            average: z.number(),
            median: z.number(),
        }),
        churnDistribution: z.object({
            low: z.number(),
            medium: z.number(),
            high: z.number(),
            critical: z.number(),
        }),
        engagementDistribution: z.object({
            low: z.number(),
            medium: z.number(),
            high: z.number(),
        }),
    }),
    handler: async () => {
        return await getPredictionStats();
    },
});
/**
 * Get prediction for a specific customer
 */
export const getCustomerPredictionEndpoint = createAuthRoleFactory('admin', 'manager').build({
    method: 'get',
    shortDescription: 'Get Customer Prediction',
    description: 'Returns the prediction data for a specific customer.',
    tag: 'Admin',
    input: z.object({
        customerId: objectIdSchema,
    }),
    output: z.object({
        prediction: z
            .object({
            customerId: z.string(),
            predictedLTV: z.number().nullable(),
            avgOrderValue: z.number().nullable(),
            purchaseFrequency: z.number().nullable(),
            churnRiskScore: z.number().nullable(),
            daysSinceLastOrder: z.number().nullable(),
            avgDaysBetween: z.number().nullable(),
            expectedNextOrder: z.date().nullable(),
            engagementScore: z.number().nullable(),
            emailOpenRate: z.number().nullable(),
            emailClickRate: z.number().nullable(),
            messagesSent: z.number().nullable(),
            messagesEngaged: z.number().nullable(),
            calculatedAt: z.date(),
            sampleSize: z.number(),
            confidence: z.number().nullable(),
            lastOrderAt: z.date().nullable(),
            totalOrders: z.number(),
            totalSpent: z.number(),
        })
            .nullable(),
        customer: z
            .object({
            id: z.string(),
            name: z.string().nullable(),
            email: z.string().nullable(),
            phone: z.string().nullable(),
            totalOrders: z.number(),
            totalSpent: z.number(),
            lastOrderAt: z.date().nullable(),
        })
            .nullable(),
    }),
    handler: async ({ input }) => {
        const customer = await prisma.customer.findUnique({
            where: { id: input.customerId },
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                totalOrders: true,
                totalSpent: true,
                lastOrderAt: true,
            },
        });
        if (!customer) {
            throw new Error('Customer not found');
        }
        const prediction = await prisma.customerPrediction.findUnique({
            where: { customerId: input.customerId },
        });
        return {
            prediction: prediction
                ? {
                    customerId: prediction.customerId,
                    predictedLTV: prediction.predictedLTV,
                    avgOrderValue: prediction.avgOrderValue,
                    purchaseFrequency: prediction.purchaseFrequency,
                    churnRiskScore: prediction.churnRiskScore,
                    daysSinceLastOrder: prediction.daysSinceLastOrder,
                    avgDaysBetween: prediction.avgDaysBetween,
                    expectedNextOrder: prediction.expectedNextOrder,
                    engagementScore: prediction.engagementScore,
                    emailOpenRate: prediction.emailOpenRate,
                    emailClickRate: prediction.emailClickRate,
                    messagesSent: prediction.messagesSent,
                    messagesEngaged: prediction.messagesEngaged,
                    calculatedAt: prediction.calculatedAt,
                    sampleSize: prediction.sampleSize,
                    confidence: prediction.confidence,
                    lastOrderAt: prediction.lastOrderAt,
                    totalOrders: prediction.totalOrders,
                    totalSpent: prediction.totalSpent,
                }
                : null,
            customer,
        };
    },
});
/**
 * Recalculate prediction for a specific customer
 */
export const recalculateCustomerPredictionEndpoint = createAuthRoleFactory('admin').build({
    method: 'post',
    shortDescription: 'Recalculate Customer Prediction',
    description: 'Recalculates and updates the prediction for a specific customer immediately.',
    tag: 'Admin',
    input: z.object({
        customerId: objectIdSchema,
    }),
    output: z.object({
        success: z.boolean(),
        prediction: z.object({
            customerId: z.string(),
            predictedLTV: z.number().nullable(),
            churnRiskScore: z.number().nullable(),
            engagementScore: z.number().nullable(),
            confidence: z.number().nullable(),
            calculatedAt: z.date(),
        }),
    }),
    handler: async ({ input }) => {
        const settings = await prisma.settings.findFirst();
        const config = {
            minOrders: settings?.predictionMinOrders ?? 2,
            minMessages: settings?.predictionMinMessages ?? 5,
            lookbackDays: settings?.predictionLookbackDays ?? 90,
        };
        const predictionResult = await calculateCustomerPrediction(input.customerId, config);
        await savePrediction(predictionResult);
        // Fetch the saved prediction to get the calculatedAt timestamp
        const savedPrediction = await prisma.customerPrediction.findUnique({
            where: { customerId: input.customerId },
        });
        return {
            success: true,
            prediction: {
                customerId: predictionResult.customerId,
                predictedLTV: predictionResult.predictedLTV,
                churnRiskScore: predictionResult.churnRiskScore,
                engagementScore: predictionResult.engagementScore,
                confidence: predictionResult.confidence,
                calculatedAt: savedPrediction?.calculatedAt ?? new Date(),
            },
        };
    },
});
