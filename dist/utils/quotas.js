import prisma from './prisma';
import { getCache, setCache, deleteCache, CACHE_KEYS, CACHE_TTL } from './cache';
export async function checkQuota() {
    const settings = await prisma.settings.findFirst({
        select: { dailyMessageLimit: true, monthlyMessageLimit: true },
    });
    if (!settings) {
        throw new Error('Settings not found. Please initialize the application.');
    }
    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [dailyUsed, monthlyUsed] = await Promise.all([
        prisma.messageLog.count({
            where: {
                sentAt: { gte: startOfDay },
                deliveryStatus: { in: ['sent', 'delivered'] },
            },
        }),
        prisma.messageLog.count({
            where: {
                sentAt: { gte: startOfMonth },
                deliveryStatus: { in: ['sent', 'delivered'] },
            },
        }),
    ]);
    const dailyRemaining = Math.max(0, settings.dailyMessageLimit - dailyUsed);
    const monthlyRemaining = Math.max(0, settings.monthlyMessageLimit - monthlyUsed);
    let withinLimits = true;
    let reason;
    if (dailyUsed >= settings.dailyMessageLimit) {
        withinLimits = false;
        reason = 'daily_limit_exceeded';
    }
    else if (monthlyUsed >= settings.monthlyMessageLimit) {
        withinLimits = false;
        reason = 'monthly_limit_exceeded';
    }
    return {
        withinLimits,
        daily: {
            limit: settings.dailyMessageLimit,
            used: dailyUsed,
            remaining: dailyRemaining,
        },
        monthly: {
            limit: settings.monthlyMessageLimit,
            used: monthlyUsed,
            remaining: monthlyRemaining,
        },
        reason,
    };
}
export async function canSendMessage() {
    const cacheKey = `${CACHE_KEYS.QUOTA_STATUS}global`;
    const cached = await getCache(cacheKey);
    if (cached) {
        if (!cached.withinLimits) {
            return {
                allowed: false,
                reason: cached.reason,
            };
        }
        return { allowed: true };
    }
    const status = await checkQuota();
    const cachedStatus = {
        ...status,
        cachedAt: Date.now(),
    };
    await setCache(cacheKey, cachedStatus, CACHE_TTL.QUOTA_STATUS);
    if (!status.withinLimits) {
        return {
            allowed: false,
            reason: status.reason,
        };
    }
    return { allowed: true };
}
export async function checkQuotaFresh() {
    await invalidateQuotaCache();
    return checkQuota();
}
export async function invalidateQuotaCache() {
    await deleteCache(`${CACHE_KEYS.QUOTA_STATUS}global`);
}
