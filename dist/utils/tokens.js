/**
 * Token Service
 *
 * Manages token-based billing for message sending.
 * Handles balance checks, reservations, deductions, grants, and purchases.
 */
import prisma from './prisma';
// Token costs per channel (configurable via env)
const TOKEN_COSTS = {
    email: parseInt(process.env.TOKEN_COST_EMAIL || '1', 10),
    sms: parseInt(process.env.TOKEN_COST_SMS || '3', 10),
};
// Starter tokens for new tenants
export const STARTER_TOKENS = parseInt(process.env.STARTER_TOKENS || '100', 10);
/**
 * Get token cost for a specific channel
 */
export function getTokenCostForChannel(channel) {
    return TOKEN_COSTS[channel] || 1;
}
/**
 * Get current token balance for a tenant
 */
export async function getTokenBalance(tenantId) {
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { tokenBalance: true, reservedTokens: true },
    });
    if (!tenant) {
        throw new Error(`Tenant not found: ${tenantId}`);
    }
    return {
        balance: tenant.tokenBalance,
        reserved: tenant.reservedTokens,
        available: tenant.tokenBalance - tenant.reservedTokens,
    };
}
/**
 * Get token statistics for a tenant
 */
export async function getTokenStats(tenantId) {
    const [tenant, aggregates] = await Promise.all([
        prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { tokenBalance: true, reservedTokens: true },
        }),
        prisma.tokenLedger.groupBy({
            by: ['type'],
            where: { tenantId },
            _sum: { amount: true },
        }),
    ]);
    if (!tenant) {
        throw new Error(`Tenant not found: ${tenantId}`);
    }
    const totals = aggregates.reduce((acc, item) => {
        const amount = item._sum.amount || 0;
        if (item.type === 'purchase')
            acc.purchased += amount;
        if (item.type === 'grant')
            acc.granted += amount;
        if (item.type === 'consumption')
            acc.consumed += Math.abs(amount);
        return acc;
    }, { purchased: 0, granted: 0, consumed: 0 });
    const available = tenant.tokenBalance - tenant.reservedTokens;
    return {
        balance: tenant.tokenBalance,
        reserved: tenant.reservedTokens,
        available,
        totalPurchased: totals.purchased,
        totalGranted: totals.granted,
        totalConsumed: totals.consumed,
        estimatedSends: {
            email: Math.floor(available / TOKEN_COSTS.email),
            sms: Math.floor(available / TOKEN_COSTS.sms),
        },
    };
}
/**
 * Reserve tokens for sending (atomic operation)
 * Returns true if reservation successful, false if insufficient tokens
 */
export async function reserveTokens(tenantId, amount) {
    // Use a transaction to ensure atomicity
    const result = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.findUnique({
            where: { id: tenantId },
            select: { tokenBalance: true, reservedTokens: true },
        });
        if (!tenant) {
            return { success: false, available: 0 };
        }
        const available = tenant.tokenBalance - tenant.reservedTokens;
        if (available < amount) {
            return { success: false, available };
        }
        // Reserve the tokens
        await tx.tenant.update({
            where: { id: tenantId },
            data: { reservedTokens: { increment: amount } },
        });
        return { success: true, available: available - amount };
    });
    return result;
}
/**
 * Deduct tokens after successful send (converts reservation to consumption)
 * Uses atomic operations without transactions to avoid deadlocks in concurrent scenarios
 */
export async function deductTokens(tenantId, amount, metadata) {
    // Use atomic $inc operations - no transaction needed since we already hold a reservation
    // This avoids MongoDB transaction deadlocks when multiple workers deduct concurrently
    const tenant = await prisma.tenant.update({
        where: { id: tenantId },
        data: {
            tokenBalance: { decrement: amount },
            reservedTokens: { decrement: amount },
        },
        select: { tokenBalance: true },
    });
    // Create ledger entry (separate operation, but safe since balance is already updated)
    await prisma.tokenLedger.create({
        data: {
            tenantId,
            amount: -amount,
            balanceAfter: tenant.tokenBalance,
            type: 'consumption',
            reason: 'message_send',
            messageLogId: metadata.messageLogId,
            campaignId: metadata.campaignId,
            customerId: metadata.customerId,
            provider: metadata.provider,
            channel: metadata.channel,
            actorType: 'system',
        },
    });
}
/**
 * Release reserved tokens (e.g., when send fails before deduction)
 * Only releases if there are actually tokens reserved to prevent negative values
 */
export async function releaseReservation(tenantId, amount) {
    // First check current reserved amount to prevent going negative
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { reservedTokens: true },
    });
    if (!tenant || tenant.reservedTokens <= 0) {
        // No tokens reserved, nothing to release
        return;
    }
    // Only release up to the amount actually reserved
    const releaseAmount = Math.min(amount, tenant.reservedTokens);
    if (releaseAmount > 0) {
        await prisma.tenant.update({
            where: { id: tenantId },
            data: { reservedTokens: { decrement: releaseAmount } },
        });
    }
}
/**
 * Grant tokens to a tenant (purchase, bonus, admin grant)
 */
export async function grantTokens(tenantId, amount, reason, actorId, actorType = 'system', type = 'grant') {
    const result = await prisma.$transaction(async (tx) => {
        // Add to balance
        const tenant = await tx.tenant.update({
            where: { id: tenantId },
            data: { tokenBalance: { increment: amount } },
            select: { tokenBalance: true },
        });
        // Create ledger entry
        await tx.tokenLedger.create({
            data: {
                tenantId,
                amount,
                balanceAfter: tenant.tokenBalance,
                type,
                reason,
                actorId,
                actorType,
            },
        });
        return { newBalance: tenant.tokenBalance };
    });
    return result;
}
/**
 * Purchase tokens (mock payment)
 */
export async function purchaseTokens(tenantId, amount, actorId, paymentMethod = 'mock') {
    // Mock payment validation
    if (amount <= 0) {
        throw new Error('Invalid token amount');
    }
    const result = await prisma.$transaction(async (tx) => {
        // Add to balance
        const tenant = await tx.tenant.update({
            where: { id: tenantId },
            data: { tokenBalance: { increment: amount } },
            select: { tokenBalance: true },
        });
        // Create ledger entry
        const ledger = await tx.tokenLedger.create({
            data: {
                tenantId,
                amount,
                balanceAfter: tenant.tokenBalance,
                type: 'purchase',
                reason: 'token_purchase',
                actorId,
                actorType: 'user',
                metadata: { paymentMethod, mockPayment: true },
            },
        });
        return { newBalance: tenant.tokenBalance, transactionId: ledger.id };
    });
    return { success: true, ...result };
}
/**
 * Check if tenant has sufficient tokens for a send
 */
export async function hasAvailableTokens(tenantId, channel) {
    const cost = getTokenCostForChannel(channel);
    const { available } = await getTokenBalance(tenantId);
    return available >= cost;
}
/**
 * Get token ledger entries for a tenant
 */
export async function getTokenLedger(tenantId, options = {}) {
    const { type, startDate, endDate, page = 1, pageSize = 50 } = options;
    const where = {
        tenantId,
        ...(type && { type }),
        ...(startDate && { createdAt: { gte: startDate } }),
        ...(endDate && { createdAt: { lte: endDate } }),
    };
    const [entries, total] = await Promise.all([
        prisma.tokenLedger.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: {
                id: true,
                amount: true,
                balanceAfter: true,
                type: true,
                reason: true,
                provider: true,
                channel: true,
                actorType: true,
                createdAt: true,
            },
        }),
        prisma.tokenLedger.count({ where }),
    ]);
    return {
        entries,
        total,
        page,
        pageSize,
        hasMore: page * pageSize < total,
    };
}
