/**
 * Token Endpoints
 *
 * Provides API endpoints for token management:
 * - Get balance and stats
 * - Purchase tokens (mock payment)
 * - Admin grant tokens
 * - Get transaction ledger
 */
import { z } from 'zod';
import { createAuthRoleTenantFactory, createAuthRoleFactory } from '../factories';
import createHttpError from 'http-errors';
import { getTokenStats, purchaseTokens, grantTokens, getTokenLedger, getTokenCostForChannel, } from '../utils/tokens';
import { checkTokenAlerts, getTokenForecast, checkAllTenantAlerts, notifyTenantAdmins, ALERT_THRESHOLDS, } from '../utils/token-alerts';
// Tenant-scoped factory for balance, purchase, ledger
const tenantTokenFactory = createAuthRoleTenantFactory(['tenant_admin', 'tenant_user'], 'tenantId');
// Admin-only factory for grants
const adminFactory = createAuthRoleFactory('system_admin');
/**
 * Get token balance and stats for a tenant
 */
export const getBalanceEndpoint = tenantTokenFactory.build({
    method: 'get',
    shortDescription: 'Get Token Balance',
    description: 'Returns the current token balance, reserved tokens, and usage statistics.',
    tag: 'Tokens',
    input: z.object({
        tenantId: z.string(),
    }),
    output: z.object({
        balance: z.number(),
        reserved: z.number(),
        available: z.number(),
        totalPurchased: z.number(),
        totalGranted: z.number(),
        totalConsumed: z.number(),
        estimatedSends: z.object({
            email: z.number(),
            sms: z.number(),
        }),
        tokenCosts: z.object({
            email: z.number(),
            sms: z.number(),
        }),
    }),
    handler: async ({ input }) => {
        const stats = await getTokenStats(input.tenantId);
        return {
            ...stats,
            tokenCosts: {
                email: getTokenCostForChannel('email'),
                sms: getTokenCostForChannel('sms'),
            },
        };
    },
});
/**
 * Purchase tokens (mock payment)
 */
export const purchaseEndpoint = tenantTokenFactory.build({
    method: 'post',
    shortDescription: 'Purchase Tokens',
    description: 'Purchase tokens using mock payment. Only tenant admins can purchase.',
    tag: 'Tokens',
    input: z.object({
        tenantId: z.string(),
        amount: z.number().int().positive().max(1000000),
        paymentMethod: z.enum(['mock_card', 'mock_bank']).default('mock_card'),
    }),
    output: z.object({
        success: z.boolean(),
        newBalance: z.number(),
        transactionId: z.string(),
        amount: z.number(),
    }),
    handler: async ({ input, ctx }) => {
        // Only tenant admins can purchase
        if (ctx.user.role === 'tenant_user') {
            throw createHttpError(403, 'Only tenant admins can purchase tokens');
        }
        const result = await purchaseTokens(input.tenantId, input.amount, ctx.user.sub, input.paymentMethod);
        return {
            success: result.success,
            newBalance: result.newBalance,
            transactionId: result.transactionId,
            amount: input.amount,
        };
    },
});
/**
 * Get token transaction ledger
 */
export const getLedgerEndpoint = tenantTokenFactory.build({
    method: 'get',
    shortDescription: 'Get Token Ledger',
    description: 'Returns paginated token transaction history.',
    tag: 'Tokens',
    input: z.object({
        tenantId: z.string(),
        type: z
            .enum(['purchase', 'grant', 'consumption', 'refund', 'reservation', 'release'])
            .optional(),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().positive().max(100).default(50),
    }),
    output: z.object({
        entries: z.array(z.object({
            id: z.string(),
            amount: z.number(),
            balanceAfter: z.number(),
            type: z.enum(['purchase', 'grant', 'consumption', 'refund', 'reservation', 'release']),
            reason: z.string().nullable(),
            provider: z.string().nullable(),
            channel: z.enum(['email', 'sms']).nullable(),
            actorType: z.string().nullable(),
            createdAt: z.date(),
        })),
        total: z.number(),
        page: z.number(),
        pageSize: z.number(),
        hasMore: z.boolean(),
    }),
    handler: async ({ input }) => {
        const result = await getTokenLedger(input.tenantId, {
            type: input.type,
            startDate: input.startDate ? new Date(input.startDate) : undefined,
            endDate: input.endDate ? new Date(input.endDate) : undefined,
            page: input.page,
            pageSize: input.pageSize,
        });
        return result;
    },
});
/**
 * Admin grant tokens to any tenant
 */
export const grantTokensEndpoint = adminFactory.build({
    method: 'post',
    shortDescription: 'Grant Tokens',
    description: 'System admin grants tokens to a tenant. Creates a ledger entry.',
    tag: 'Admin',
    input: z.object({
        tenantId: z.string(),
        amount: z.number().int().positive().max(1000000),
        reason: z.string().min(1).max(500),
    }),
    output: z.object({
        success: z.boolean(),
        newBalance: z.number(),
        tenantId: z.string(),
        amount: z.number(),
    }),
    handler: async ({ input, ctx }) => {
        const result = await grantTokens(input.tenantId, input.amount, `admin_manual_grant: ${input.reason}`, ctx.user.sub, 'admin', 'grant');
        return {
            success: true,
            newBalance: result.newBalance,
            tenantId: input.tenantId,
            amount: input.amount,
        };
    },
});
/**
 * Get token alerts for a tenant
 */
export const getAlertsEndpoint = tenantTokenFactory.build({
    method: 'get',
    shortDescription: 'Get Token Alerts',
    description: 'Check for any token-related alerts (low balance, depletion warnings).',
    tag: 'Tokens',
    input: z.object({
        tenantId: z.string(),
    }),
    output: z.object({
        hasAlert: z.boolean(),
        alert: z
            .object({
            level: z.enum(['info', 'warning', 'critical']),
            alertType: z.enum([
                'low_balance',
                'critical_balance',
                'depleted',
                'running_low',
                'high_consumption',
            ]),
            currentBalance: z.number(),
            threshold: z.number().optional(),
            estimatedDaysRemaining: z.number().optional(),
            dailyConsumptionRate: z.number().optional(),
            message: z.string(),
        })
            .nullable(),
        thresholds: z.object({
            lowBalancePercent: z.number(),
            criticalBalance: z.number(),
            daysRunningLow: z.number(),
        }),
    }),
    handler: async ({ input }) => {
        const alert = await checkTokenAlerts(input.tenantId);
        return {
            hasAlert: alert !== null,
            alert: alert
                ? {
                    level: alert.level,
                    alertType: alert.alertType,
                    currentBalance: alert.currentBalance,
                    threshold: alert.threshold,
                    estimatedDaysRemaining: alert.estimatedDaysRemaining,
                    dailyConsumptionRate: alert.dailyConsumptionRate,
                    message: alert.message,
                }
                : null,
            thresholds: ALERT_THRESHOLDS,
        };
    },
});
/**
 * Get token usage forecast
 */
export const getForecastEndpoint = tenantTokenFactory.build({
    method: 'get',
    shortDescription: 'Get Token Forecast',
    description: 'Get token usage forecast including estimated days remaining and recommended purchase.',
    tag: 'Tokens',
    input: z.object({
        tenantId: z.string(),
    }),
    output: z.object({
        currentBalance: z.number(),
        dailyConsumptionRate: z.number(),
        weeklyConsumptionRate: z.number(),
        estimatedDaysRemaining: z.number().nullable(),
        estimatedRunOutDate: z.date().nullable(),
        recommendedPurchase: z.number(),
        channelBreakdown: z.array(z.object({
            channel: z.enum(['email', 'sms']),
            sendsRemaining: z.number(),
            percentOfUsage: z.number(),
        })),
    }),
    handler: async ({ input }) => {
        const forecast = await getTokenForecast(input.tenantId);
        return forecast;
    },
});
/**
 * Admin endpoint to check all tenant alerts
 */
export const checkAllAlertsEndpoint = adminFactory.build({
    method: 'get',
    shortDescription: 'Check All Tenant Alerts',
    description: 'System admin check for token alerts across all tenants.',
    tag: 'Admin',
    input: z.object({}),
    output: z.object({
        totalTenants: z.number(),
        tenantsWithAlerts: z.number(),
        alerts: z.array(z.object({
            tenantId: z.string(),
            tenantName: z.string(),
            level: z.enum(['info', 'warning', 'critical']),
            alertType: z.enum([
                'low_balance',
                'critical_balance',
                'depleted',
                'running_low',
                'high_consumption',
            ]),
            currentBalance: z.number(),
            message: z.string(),
        })),
    }),
    handler: async () => {
        const alerts = await checkAllTenantAlerts();
        return {
            totalTenants: alerts.length,
            tenantsWithAlerts: alerts.length,
            alerts: alerts.map((a) => ({
                tenantId: a.tenantId,
                tenantName: a.tenantName,
                level: a.level,
                alertType: a.alertType,
                currentBalance: a.currentBalance,
                message: a.message,
            })),
        };
    },
});
/**
 * Admin endpoint to send notifications for alerts
 */
export const sendAlertNotificationsEndpoint = adminFactory.build({
    method: 'post',
    shortDescription: 'Send Alert Notifications',
    description: 'Send token alert notifications to tenant admins via email.',
    tag: 'Admin',
    input: z.object({
        tenantId: z.string().optional(),
        sendAll: z.boolean().default(false),
    }),
    output: z.object({
        notificationsSent: z.number(),
        tenantsNotified: z.array(z.string()),
        emailsSent: z.array(z.string()),
        emailsFailed: z.array(z.string()),
    }),
    handler: async ({ input }) => {
        const tenantsNotified = [];
        const allEmailsSent = [];
        const allEmailsFailed = [];
        if (input.sendAll) {
            const alerts = await checkAllTenantAlerts();
            for (const alert of alerts) {
                const result = await notifyTenantAdmins(alert);
                tenantsNotified.push(alert.tenantId);
                allEmailsSent.push(...result.notified);
                allEmailsFailed.push(...result.failed);
            }
        }
        else if (input.tenantId) {
            const alert = await checkTokenAlerts(input.tenantId);
            if (alert) {
                const result = await notifyTenantAdmins(alert);
                tenantsNotified.push(alert.tenantId);
                allEmailsSent.push(...result.notified);
                allEmailsFailed.push(...result.failed);
            }
        }
        else {
            throw createHttpError(400, 'Either tenantId or sendAll must be specified');
        }
        return {
            notificationsSent: tenantsNotified.length,
            tenantsNotified,
            emailsSent: allEmailsSent,
            emailsFailed: allEmailsFailed,
        };
    },
});
