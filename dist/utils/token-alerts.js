/**
 * Token Depletion Alerts
 *
 * Monitors token balances and sends alerts to tenants when:
 * - Balance falls below configurable threshold
 * - Balance is depleted (zero tokens)
 * - Tokens are about to run out based on consumption rate
 */
import prisma from './prisma';
import { createAuditLog, AuditActions } from './audit';
import { getTokenCostForChannel } from './tokens';
import { getProviderForChannel } from '../providers/registry';
// Alert thresholds (configurable via env)
export const ALERT_THRESHOLDS = {
    // Percentage of initial balance that triggers warning (e.g., 20%)
    lowBalancePercent: parseFloat(process.env.TOKEN_ALERT_LOW_PERCENT || '0.2'),
    // Absolute minimum balance that triggers critical alert
    criticalBalance: parseInt(process.env.TOKEN_ALERT_CRITICAL || '10', 10),
    // Days of consumption that triggers "running low" alert
    daysRunningLow: parseInt(process.env.TOKEN_ALERT_DAYS_LOW || '7', 10),
};
/**
 * Check token balance and generate alerts if needed
 */
export async function checkTokenAlerts(tenantId) {
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
            id: true,
            name: true,
            tokenBalance: true,
            reservedTokens: true,
        },
    });
    if (!tenant) {
        return null;
    }
    const availableBalance = tenant.tokenBalance - tenant.reservedTokens;
    // Check for depleted balance
    if (availableBalance <= 0) {
        return {
            tenantId: tenant.id,
            tenantName: tenant.name,
            level: 'critical',
            alertType: 'depleted',
            currentBalance: availableBalance,
            message: 'Token balance is depleted. Message sending is blocked until tokens are purchased.',
            createdAt: new Date(),
        };
    }
    // Check for critical balance
    if (availableBalance <= ALERT_THRESHOLDS.criticalBalance) {
        return {
            tenantId: tenant.id,
            tenantName: tenant.name,
            level: 'critical',
            alertType: 'critical_balance',
            currentBalance: availableBalance,
            threshold: ALERT_THRESHOLDS.criticalBalance,
            message: `Token balance is critically low (${availableBalance} tokens remaining). Purchase more tokens soon to avoid service interruption.`,
            createdAt: new Date(),
        };
    }
    // Calculate consumption rate for running low alert
    const consumptionStats = await getConsumptionRate(tenantId);
    if (consumptionStats.dailyRate > 0) {
        const daysRemaining = Math.floor(availableBalance / consumptionStats.dailyRate);
        if (daysRemaining <= ALERT_THRESHOLDS.daysRunningLow) {
            return {
                tenantId: tenant.id,
                tenantName: tenant.name,
                level: 'warning',
                alertType: 'running_low',
                currentBalance: availableBalance,
                estimatedDaysRemaining: daysRemaining,
                dailyConsumptionRate: consumptionStats.dailyRate,
                message: `At current usage rate, tokens will run out in approximately ${daysRemaining} day(s). Consider purchasing more tokens.`,
                createdAt: new Date(),
            };
        }
    }
    // Check for low balance percentage (based on peak balance)
    const peakBalance = await getPeakBalance(tenantId);
    const lowThreshold = Math.floor(peakBalance * ALERT_THRESHOLDS.lowBalancePercent);
    if (peakBalance > 0 && availableBalance <= lowThreshold) {
        return {
            tenantId: tenant.id,
            tenantName: tenant.name,
            level: 'info',
            alertType: 'low_balance',
            currentBalance: availableBalance,
            threshold: lowThreshold,
            message: `Token balance has dropped below ${Math.round(ALERT_THRESHOLDS.lowBalancePercent * 100)}% of peak balance. Consider purchasing more tokens.`,
            createdAt: new Date(),
        };
    }
    return null;
}
/**
 * Get consumption rate for a tenant (tokens per day)
 */
async function getConsumptionRate(tenantId) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const consumptionEntries = await prisma.tokenLedger.findMany({
        where: {
            tenantId,
            type: 'consumption',
            createdAt: { gte: sevenDaysAgo },
        },
        select: { amount: true },
    });
    const weeklyTotal = consumptionEntries.reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
    const dailyRate = weeklyTotal / 7;
    return { dailyRate, weeklyTotal };
}
/**
 * Get peak token balance for a tenant (highest balance ever recorded)
 */
async function getPeakBalance(tenantId) {
    const maxEntry = await prisma.tokenLedger.findFirst({
        where: { tenantId },
        orderBy: { balanceAfter: 'desc' },
        select: { balanceAfter: true },
    });
    return maxEntry?.balanceAfter || 0;
}
/**
 * Check all tenants for token alerts (for scheduled job)
 */
export async function checkAllTenantAlerts() {
    const tenants = await prisma.tenant.findMany({
        select: { id: true },
    });
    const alerts = [];
    for (const tenant of tenants) {
        const alert = await checkTokenAlerts(tenant.id);
        if (alert) {
            alerts.push(alert);
        }
    }
    return alerts;
}
/**
 * Record a token alert in the audit log
 */
export async function recordTokenAlert(alert) {
    await createAuditLog({
        action: AuditActions.tenant.updated,
        resourceType: 'tenant',
        resourceId: alert.tenantId,
        metadata: {
            alertType: alert.alertType,
            alertLevel: alert.level,
            currentBalance: alert.currentBalance,
            threshold: alert.threshold,
            estimatedDaysRemaining: alert.estimatedDaysRemaining,
            dailyConsumptionRate: alert.dailyConsumptionRate,
            message: alert.message,
        },
        context: { tenantId: alert.tenantId },
    });
}
/**
 * Get token usage forecast
 */
export async function getTokenForecast(tenantId) {
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { tokenBalance: true, reservedTokens: true },
    });
    if (!tenant) {
        throw new Error(`Tenant not found: ${tenantId}`);
    }
    const availableBalance = tenant.tokenBalance - tenant.reservedTokens;
    const { dailyRate, weeklyTotal } = await getConsumptionRate(tenantId);
    // Get channel breakdown from recent consumption
    const channelBreakdown = await getChannelConsumptionBreakdown(tenantId);
    let estimatedDaysRemaining = null;
    let estimatedRunOutDate = null;
    if (dailyRate > 0) {
        estimatedDaysRemaining = Math.floor(availableBalance / dailyRate);
        estimatedRunOutDate = new Date();
        estimatedRunOutDate.setDate(estimatedRunOutDate.getDate() + estimatedDaysRemaining);
    }
    // Recommend purchasing enough tokens for 30 days at current rate
    const recommendedPurchase = Math.max(0, Math.ceil(dailyRate * 30) - availableBalance);
    return {
        currentBalance: availableBalance,
        dailyConsumptionRate: Math.round(dailyRate * 100) / 100,
        weeklyConsumptionRate: weeklyTotal,
        estimatedDaysRemaining,
        estimatedRunOutDate,
        recommendedPurchase,
        channelBreakdown: channelBreakdown.map((cb) => ({
            channel: cb.channel,
            sendsRemaining: Math.floor(availableBalance / getTokenCostForChannel(cb.channel)),
            percentOfUsage: cb.percentOfUsage,
        })),
    };
}
/**
 * Get consumption breakdown by channel
 */
async function getChannelConsumptionBreakdown(tenantId) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const channelStats = await prisma.tokenLedger.groupBy({
        by: ['channel'],
        where: {
            tenantId,
            type: 'consumption',
            createdAt: { gte: sevenDaysAgo },
            channel: { not: null },
        },
        _count: { id: true },
    });
    const totalCount = channelStats.reduce((sum, stat) => sum + stat._count.id, 0);
    return channelStats
        .filter((stat) => stat.channel !== null && (stat.channel === 'email' || stat.channel === 'sms'))
        .map((stat) => ({
        channel: stat.channel,
        count: stat._count.id,
        percentOfUsage: totalCount > 0 ? Math.round((stat._count.id / totalCount) * 100) : 0,
    }));
}
/**
 * Generate email subject based on alert level
 */
function getAlertEmailSubject(alert) {
    const prefix = alert.level === 'critical' ? '🚨 URGENT' : alert.level === 'warning' ? '⚠️' : 'ℹ️';
    switch (alert.alertType) {
        case 'depleted':
            return `${prefix} Token Balance Depleted - ${alert.tenantName}`;
        case 'critical_balance':
            return `${prefix} Critical Token Balance - ${alert.tenantName}`;
        case 'running_low':
            return `${prefix} Tokens Running Low - ${alert.tenantName}`;
        case 'low_balance':
            return `${prefix} Low Token Balance - ${alert.tenantName}`;
        default:
            return `${prefix} Token Alert - ${alert.tenantName}`;
    }
}
/**
 * Generate HTML email body for token alert
 */
function getAlertEmailHtml(alert, recipientName) {
    const levelColor = alert.level === 'critical' ? '#dc2626' : alert.level === 'warning' ? '#d97706' : '#2563eb';
    const actionText = alert.level === 'critical'
        ? 'Immediate action required to restore service.'
        : alert.level === 'warning'
            ? 'Please purchase more tokens soon.'
            : 'Consider purchasing more tokens.';
    let detailsHtml = '';
    if (alert.estimatedDaysRemaining !== undefined) {
        detailsHtml += `<p><strong>Estimated days remaining:</strong> ${alert.estimatedDaysRemaining}</p>`;
    }
    if (alert.dailyConsumptionRate !== undefined) {
        detailsHtml += `<p><strong>Daily consumption rate:</strong> ${Math.round(alert.dailyConsumptionRate)} tokens/day</p>`;
    }
    if (alert.threshold !== undefined) {
        detailsHtml += `<p><strong>Threshold:</strong> ${alert.threshold} tokens</p>`;
    }
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: ${levelColor}; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0; font-size: 24px;">Token Alert</h1>
    <p style="margin: 10px 0 0 0; opacity: 0.9;">${alert.tenantName}</p>
  </div>

  <div style="background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
    <p>Hi ${recipientName},</p>

    <div style="background: white; padding: 15px; border-radius: 6px; border-left: 4px solid ${levelColor}; margin: 20px 0;">
      <p style="margin: 0;"><strong>${alert.message}</strong></p>
    </div>

    <p><strong>Current balance:</strong> ${alert.currentBalance} tokens</p>
    ${detailsHtml}

    <p style="margin-top: 20px;">${actionText}</p>

    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
      <p style="color: #6b7280; font-size: 14px; margin: 0;">
        This is an automated notification from Upsale.
      </p>
    </div>
  </div>
</body>
</html>
`;
}
/**
 * Generate plain text email body for token alert
 */
function getAlertEmailText(alert, recipientName) {
    let text = `Hi ${recipientName},\n\n`;
    text += `TOKEN ALERT for ${alert.tenantName}\n`;
    text += `${'='.repeat(40)}\n\n`;
    text += `${alert.message}\n\n`;
    text += `Current balance: ${alert.currentBalance} tokens\n`;
    if (alert.estimatedDaysRemaining !== undefined) {
        text += `Estimated days remaining: ${alert.estimatedDaysRemaining}\n`;
    }
    if (alert.dailyConsumptionRate !== undefined) {
        text += `Daily consumption rate: ${Math.round(alert.dailyConsumptionRate)} tokens/day\n`;
    }
    if (alert.threshold !== undefined) {
        text += `Threshold: ${alert.threshold} tokens\n`;
    }
    text += `\n`;
    if (alert.level === 'critical') {
        text += `⚠️ Immediate action required to restore service.\n`;
    }
    else if (alert.level === 'warning') {
        text += `Please purchase more tokens soon.\n`;
    }
    else {
        text += `Consider purchasing more tokens.\n`;
    }
    text += `\n---\nThis is an automated notification from Upsale.`;
    return text;
}
/**
 * Send notification to tenant admins about token alert
 * Sends actual emails via the configured email provider (Resend in production)
 */
export async function notifyTenantAdmins(alert) {
    // Get tenant admins (owners and admins)
    const admins = await prisma.tenantMember.findMany({
        where: {
            tenantId: alert.tenantId,
            role: { in: ['OWNER', 'ADMIN'] },
        },
        include: {
            user: {
                select: { email: true, name: true },
            },
        },
    });
    console.log(`[TokenAlerts] Notifying ${admins.length} admin(s) for tenant ${alert.tenantName}:`);
    console.log(`  Alert: ${alert.alertType} (${alert.level})`);
    console.log(`  Message: ${alert.message}`);
    const notified = [];
    const failed = [];
    // Get email provider
    let emailProvider;
    try {
        emailProvider = getProviderForChannel('email');
    }
    catch (error) {
        console.error('[TokenAlerts] No email provider available:', error);
        // Record the alert even if we can't send emails
        await recordTokenAlert(alert);
        return { notified: [], failed: admins.map((a) => a.user?.email || 'unknown') };
    }
    const subject = getAlertEmailSubject(alert);
    for (const admin of admins) {
        if (!admin.user?.email)
            continue;
        const recipientName = admin.user.name || 'Admin';
        const html = getAlertEmailHtml(alert, recipientName);
        const text = getAlertEmailText(alert, recipientName);
        try {
            const result = await emailProvider.send({
                to: admin.user.email,
                subject,
                body: text,
                html,
                metadata: {
                    alertType: alert.alertType,
                    alertLevel: alert.level,
                    tenantId: alert.tenantId,
                },
            });
            if (result.success) {
                console.log(`  ✓ Notified: ${admin.user.email}`);
                notified.push(admin.user.email);
            }
            else {
                console.error(`  ✗ Failed to notify ${admin.user.email}: ${result.error}`);
                failed.push(admin.user.email);
            }
        }
        catch (error) {
            console.error(`  ✗ Error notifying ${admin.user.email}:`, error);
            failed.push(admin.user.email);
        }
    }
    // Record the notification in audit log
    await recordTokenAlert(alert);
    return { notified, failed };
}
