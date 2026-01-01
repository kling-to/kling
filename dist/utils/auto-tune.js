import prisma from './prisma';
import { pauseCampaignSchedule } from './bullmq';
import { createAuditLog, AuditActions } from './audit';
export const DEFAULT_AUTO_TUNE_CONFIG = {
    enabled: true,
    minExecutions: 3,
    minMessagesSent: 50,
    thresholds: {
        minDeliveryRate: 0.5,
        minOpenRate: 0.05,
        minClickRate: 0.005,
        maxBounceRate: 0.1,
        maxComplaintRate: 0.001,
        maxFailureRate: 0.3,
    },
    evaluationWindowDays: 7,
};
export async function getCampaignPerformance(campaignId, windowDays = 7) {
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - windowDays);
    const campaign = await prisma.campaignDefinition.findUnique({
        where: { id: campaignId },
        select: {
            id: true,
            name: true,
            channel: true,
        },
    });
    if (!campaign) {
        return null;
    }
    const executions = await prisma.campaignExecution.findMany({
        where: {
            campaignId,
            startedAt: { gte: windowStart },
            status: { in: ['completed', 'failed'] },
        },
        select: {
            messagesSent: true,
            messagesFailed: true,
        },
    });
    const messageStats = await prisma.messageLog.groupBy({
        by: ['deliveryStatus'],
        where: {
            campaignId,
            createdAt: { gte: windowStart },
        },
        _count: true,
    });
    const stats = {
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        bounced: 0,
        failed: 0,
        complained: 0,
    };
    for (const stat of messageStats) {
        const count = stat._count;
        switch (stat.deliveryStatus) {
            case 'sent':
            case 'delivered':
                stats.sent += count;
                if (stat.deliveryStatus === 'delivered') {
                    stats.delivered += count;
                }
                break;
            case 'opened':
                stats.sent += count;
                stats.delivered += count;
                stats.opened += count;
                break;
            case 'clicked':
                stats.sent += count;
                stats.delivered += count;
                stats.opened += count;
                stats.clicked += count;
                break;
            case 'bounced':
                stats.sent += count;
                stats.bounced += count;
                break;
            case 'failed':
                stats.failed += count;
                break;
            case 'complained':
                stats.sent += count;
                stats.complained += count;
                break;
        }
    }
    const totalSent = stats.sent + stats.failed;
    return {
        campaignId: campaign.id,
        campaignName: campaign.name,
        channel: campaign.channel,
        executionCount: executions.length,
        totalSent: stats.sent,
        totalDelivered: stats.delivered,
        totalOpened: stats.opened,
        totalClicked: stats.clicked,
        totalBounced: stats.bounced,
        totalFailed: stats.failed,
        totalComplained: stats.complained,
        deliveryRate: stats.sent > 0 ? stats.delivered / stats.sent : 0,
        openRate: stats.delivered > 0 ? stats.opened / stats.delivered : 0,
        clickRate: stats.opened > 0 ? stats.clicked / stats.opened : 0,
        bounceRate: stats.sent > 0 ? stats.bounced / stats.sent : 0,
        complaintRate: stats.sent > 0 ? stats.complained / stats.sent : 0,
        failureRate: totalSent > 0 ? stats.failed / totalSent : 0,
    };
}
export function evaluateCampaign(metrics, config) {
    const reasons = [];
    if (metrics.executionCount < config.minExecutions) {
        return {
            campaignId: metrics.campaignId,
            shouldPause: false,
            reasons: [`Not enough executions (${metrics.executionCount}/${config.minExecutions})`],
            metrics,
        };
    }
    if (metrics.totalSent < config.minMessagesSent) {
        return {
            campaignId: metrics.campaignId,
            shouldPause: false,
            reasons: [`Not enough messages sent (${metrics.totalSent}/${config.minMessagesSent})`],
            metrics,
        };
    }
    if (metrics.deliveryRate < config.thresholds.minDeliveryRate) {
        reasons.push(`Low delivery rate: ${(metrics.deliveryRate * 100).toFixed(1)}% < ${(config.thresholds.minDeliveryRate * 100).toFixed(1)}%`);
    }
    if (metrics.bounceRate > config.thresholds.maxBounceRate) {
        reasons.push(`High bounce rate: ${(metrics.bounceRate * 100).toFixed(1)}% > ${(config.thresholds.maxBounceRate * 100).toFixed(1)}%`);
    }
    if (metrics.complaintRate > config.thresholds.maxComplaintRate) {
        reasons.push(`High complaint rate: ${(metrics.complaintRate * 100).toFixed(2)}% > ${(config.thresholds.maxComplaintRate * 100).toFixed(2)}%`);
    }
    if (metrics.failureRate > config.thresholds.maxFailureRate) {
        reasons.push(`High failure rate: ${(metrics.failureRate * 100).toFixed(1)}% > ${(config.thresholds.maxFailureRate * 100).toFixed(1)}%`);
    }
    if (metrics.channel === 'email') {
        if (metrics.openRate < config.thresholds.minOpenRate && metrics.totalDelivered > 0) {
            reasons.push(`Low open rate: ${(metrics.openRate * 100).toFixed(1)}% < ${(config.thresholds.minOpenRate * 100).toFixed(1)}%`);
        }
        if (metrics.clickRate < config.thresholds.minClickRate && metrics.totalOpened > 0) {
            reasons.push(`Low click rate: ${(metrics.clickRate * 100).toFixed(2)}% < ${(config.thresholds.minClickRate * 100).toFixed(2)}%`);
        }
    }
    return {
        campaignId: metrics.campaignId,
        shouldPause: reasons.length > 0,
        reasons,
        metrics,
    };
}
export async function autoTuneCampaign(campaignId, config = DEFAULT_AUTO_TUNE_CONFIG) {
    if (!config.enabled) {
        return null;
    }
    const metrics = await getCampaignPerformance(campaignId, config.evaluationWindowDays);
    if (!metrics) {
        return null;
    }
    const result = evaluateCampaign(metrics, config);
    if (result.shouldPause) {
        console.log(`[AutoTune] Campaign ${campaignId} flagged for pause: ${result.reasons.join(', ')}`);
        try {
            const campaign = await prisma.campaignDefinition.findUnique({
                where: { id: campaignId },
                select: { bullmqJobKey: true },
            });
            await pauseCampaignSchedule(campaignId, campaign?.bullmqJobKey || null);
            await prisma.campaignDefinition.update({
                where: { id: campaignId },
                data: { status: 'paused' },
            });
            await createAuditLog({
                action: AuditActions.campaign.paused,
                resourceType: 'campaign',
                resourceId: campaignId,
                metadata: {
                    reason: 'auto-tune',
                    triggers: result.reasons,
                    metrics: {
                        deliveryRate: result.metrics.deliveryRate,
                        bounceRate: result.metrics.bounceRate,
                        complaintRate: result.metrics.complaintRate,
                        failureRate: result.metrics.failureRate,
                        openRate: result.metrics.openRate,
                        clickRate: result.metrics.clickRate,
                    },
                },
                context: {},
            });
            console.log(`[AutoTune] Campaign ${campaignId} paused successfully`);
        }
        catch (err) {
            console.error(`[AutoTune] Failed to pause campaign ${campaignId}:`, err);
        }
    }
    return result;
}
export async function autoTuneActiveCampaigns(config = DEFAULT_AUTO_TUNE_CONFIG) {
    if (!config.enabled) {
        return [];
    }
    const campaigns = await prisma.campaignDefinition.findMany({
        where: {
            status: 'active',
        },
        select: { id: true },
    });
    const results = [];
    for (const campaign of campaigns) {
        const result = await autoTuneCampaign(campaign.id, config);
        if (result) {
            results.push(result);
        }
    }
    return results;
}
export async function autoTuneAllCampaigns(config = DEFAULT_AUTO_TUNE_CONFIG) {
    if (!config.enabled) {
        return { evaluated: 0, paused: 0, results: [] };
    }
    const campaigns = await prisma.campaignDefinition.findMany({
        where: {
            status: 'active',
        },
        select: { id: true },
    });
    const results = [];
    let paused = 0;
    for (const campaign of campaigns) {
        const result = await autoTuneCampaign(campaign.id, config);
        if (result) {
            results.push(result);
            if (result.shouldPause) {
                paused++;
            }
        }
    }
    console.log(`[AutoTune] Evaluated ${results.length} campaigns, paused ${paused}`);
    return {
        evaluated: results.length,
        paused,
        results,
    };
}
