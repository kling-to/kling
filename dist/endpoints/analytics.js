/**
 * Analytics Endpoints
 *
 * Revenue attribution and analytics dashboard endpoints.
 */
import { z } from 'zod';
import { createAuthRoleFactory } from '../factories';
import prisma from '../utils/prisma';
import { calculateFlowRevenue, calculateMultipleCampaignRevenue, } from '../utils/revenue-attribution';
const staffFactory = createAuthRoleFactory('admin', 'manager', 'staff');
// ============================================================
// REVENUE DASHBOARD
// ============================================================
/**
 * Get revenue dashboard overview
 */
export const getRevenueDashboardEndpoint = staffFactory.build({
    method: 'get',
    shortDescription: 'Get Revenue Dashboard',
    description: 'Returns aggregated revenue metrics across all campaigns and flows.',
    tag: 'Analytics',
    input: z.object({
        period: z.enum(['7d', '14d', '30d', '90d']).default('30d'),
        limit: z.coerce.number().min(1).max(20).default(10),
        sortBy: z.enum(['revenue', 'orders', 'aov']).default('revenue'),
    }),
    output: z.object({
        summary: z.object({
            totalRevenue: z.number(),
            totalOrders: z.number(),
            averageOrderValue: z.number(),
            attributionWindow: z.string(),
            attributionModel: z.string(),
            period: z.string(),
            startDate: z.string(),
            endDate: z.string(),
        }),
        topCampaigns: z.array(z.object({
            campaignId: z.string(),
            campaignName: z.string(),
            channel: z.string(),
            revenue: z.number(),
            orders: z.number(),
            aov: z.number(),
        })),
        topFlows: z.array(z.object({
            flowId: z.string(),
            flowName: z.string(),
            triggerType: z.string(),
            revenue: z.number(),
            orders: z.number(),
            aov: z.number(),
        })),
        revenueByChannel: z.array(z.object({
            channel: z.string(),
            revenue: z.number(),
            orders: z.number(),
            aov: z.number(),
        })),
    }),
    handler: async ({ input }) => {
        const { period, limit, sortBy } = input;
        // Calculate date range
        const periodDays = { '7d': 7, '14d': 14, '30d': 30, '90d': 90 }[period];
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - periodDays);
        // Get attribution settings
        const settings = await prisma.settings.findFirst();
        const attributionWindow = settings?.attributionWindowDays || 7;
        const attributionModel = settings?.attributionModel || 'last_touch';
        // Get all active/paused campaigns (not archived)
        const campaigns = await prisma.campaignDefinition.findMany({
            where: {
                status: { not: 'archived' },
            },
            select: {
                id: true,
                name: true,
                channel: true,
            },
        });
        // Get all active/paused flows
        const flows = await prisma.flow.findMany({
            where: {
                status: { not: 'archived' },
            },
            select: {
                id: true,
                name: true,
                triggerType: true,
            },
        });
        // Calculate campaign revenues in batch
        const campaignIds = campaigns.map((c) => c.id);
        const campaignRevenueMap = await calculateMultipleCampaignRevenue(campaignIds, { windowDays: attributionWindow, model: attributionModel }, startDate, endDate);
        // Calculate flow revenues
        const flowRevenues = await Promise.all(flows.map(async (flow) => {
            const revenue = await calculateFlowRevenue(flow.id, { windowDays: attributionWindow, model: attributionModel }, startDate, endDate);
            return {
                flowId: flow.id,
                flowName: flow.name,
                triggerType: flow.triggerType,
                revenue: revenue.totalRevenue,
                orders: revenue.totalOrders,
                aov: revenue.averageOrderValue,
            };
        }));
        // Build campaign results
        const campaignResults = campaigns.map((campaign) => {
            const revenue = campaignRevenueMap.get(campaign.id);
            return {
                campaignId: campaign.id,
                campaignName: campaign.name,
                channel: campaign.channel,
                revenue: revenue?.totalRevenue || 0,
                orders: revenue?.totalOrders || 0,
                aov: revenue?.averageOrderValue || 0,
            };
        });
        // Sort campaigns
        const sortedCampaigns = [...campaignResults].sort((a, b) => {
            if (sortBy === 'revenue')
                return b.revenue - a.revenue;
            if (sortBy === 'orders')
                return b.orders - a.orders;
            return b.aov - a.aov;
        });
        // Sort flows
        const sortedFlows = [...flowRevenues].sort((a, b) => {
            if (sortBy === 'revenue')
                return b.revenue - a.revenue;
            if (sortBy === 'orders')
                return b.orders - a.orders;
            return b.aov - a.aov;
        });
        // Calculate totals
        const totalCampaignRevenue = campaignResults.reduce((sum, c) => sum + c.revenue, 0);
        const totalFlowRevenue = flowRevenues.reduce((sum, f) => sum + f.revenue, 0);
        const totalCampaignOrders = campaignResults.reduce((sum, c) => sum + c.orders, 0);
        const totalFlowOrders = flowRevenues.reduce((sum, f) => sum + f.orders, 0);
        const totalRevenue = totalCampaignRevenue + totalFlowRevenue;
        const totalOrders = totalCampaignOrders + totalFlowOrders;
        const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        // Calculate revenue by channel
        const emailRevenue = campaignResults
            .filter((c) => c.channel === 'email')
            .reduce((sum, c) => sum + c.revenue, 0);
        const emailOrders = campaignResults
            .filter((c) => c.channel === 'email')
            .reduce((sum, c) => sum + c.orders, 0);
        const smsRevenue = campaignResults
            .filter((c) => c.channel === 'sms')
            .reduce((sum, c) => sum + c.revenue, 0);
        const smsOrders = campaignResults
            .filter((c) => c.channel === 'sms')
            .reduce((sum, c) => sum + c.orders, 0);
        return {
            summary: {
                totalRevenue,
                totalOrders,
                averageOrderValue,
                attributionWindow: `${attributionWindow} days`,
                attributionModel,
                period,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
            },
            topCampaigns: sortedCampaigns.slice(0, limit),
            topFlows: sortedFlows.slice(0, limit),
            revenueByChannel: [
                {
                    channel: 'email',
                    revenue: emailRevenue,
                    orders: emailOrders,
                    aov: emailOrders > 0 ? emailRevenue / emailOrders : 0,
                },
                {
                    channel: 'sms',
                    revenue: smsRevenue,
                    orders: smsOrders,
                    aov: smsOrders > 0 ? smsRevenue / smsOrders : 0,
                },
            ],
        };
    },
});
