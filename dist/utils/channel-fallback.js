/**
 * Multi-Channel Fallback
 *
 * Enables automatic fallback to alternative channels when primary channel fails.
 * For example: email → sms
 */
import prisma from './prisma';
import { checkEligibility } from './eligibility';
/**
 * Default channel fallback order
 * Primary channel attempts first, then falls back to alternatives
 */
export const DEFAULT_FALLBACK_ORDER = {
    email: ['push', 'sms', 'whatsapp'],
    sms: ['whatsapp', 'push', 'email'],
    whatsapp: ['sms', 'push', 'email'],
    rcs: ['sms', 'whatsapp', 'push'], // RCS naturally falls back to SMS
    push: ['email', 'sms', 'whatsapp'],
};
/**
 * Default fallback configuration
 */
export const DEFAULT_FALLBACK_CONFIG = {
    enabled: true,
    maxAttempts: 2, // Try up to 2 fallback channels
    delayBetweenAttempts: 0, // No delay (immediate fallback)
    onlyOnPermanentFailure: true,
};
/**
 * Get available fallback channels for a customer
 * Checks eligibility for each potential fallback channel
 */
export async function getAvailableFallbackChannels(customer, primaryChannel, config, fallbackConfig = DEFAULT_FALLBACK_CONFIG) {
    if (!fallbackConfig.enabled) {
        return [];
    }
    // Get fallback order
    const fallbackOrder = fallbackConfig.fallbackOrder || DEFAULT_FALLBACK_ORDER[primaryChannel] || [];
    const maxAttempts = fallbackConfig.maxAttempts || 2;
    const availableChannels = [];
    // Check eligibility for each fallback channel
    for (const channel of fallbackOrder) {
        if (availableChannels.length >= maxAttempts) {
            break;
        }
        // Skip if customer doesn't have contact info for this channel
        if (channel === 'email' && !customer.email) {
            continue;
        }
        if (channel === 'sms' && !customer.phone) {
            continue;
        }
        if (channel === 'whatsapp' && !customer.whatsappNumber && !customer.phone) {
            continue;
        }
        if (channel === 'rcs' && !customer.phone) {
            continue;
        }
        if (channel === 'push' && !customer.pushToken) {
            continue;
        }
        // Check eligibility for this channel
        const eligibilityResult = await checkEligibility(customer, {
            ...config,
            channel,
        });
        if (eligibilityResult.eligible) {
            availableChannels.push(channel);
        }
    }
    return availableChannels;
}
/**
 * Determine the next fallback channel to try
 */
export function getNextFallbackChannel(attemptedChannels, primaryChannel, fallbackConfig = DEFAULT_FALLBACK_CONFIG) {
    if (!fallbackConfig.enabled) {
        return null;
    }
    const fallbackOrder = fallbackConfig.fallbackOrder || DEFAULT_FALLBACK_ORDER[primaryChannel] || [];
    const maxAttempts = fallbackConfig.maxAttempts || 2;
    // Count fallback attempts (exclude primary channel)
    const fallbackAttempts = attemptedChannels.filter((c) => c !== primaryChannel).length;
    if (fallbackAttempts >= maxAttempts) {
        return null;
    }
    // Find next channel that hasn't been tried
    for (const channel of fallbackOrder) {
        if (!attemptedChannels.includes(channel)) {
            return channel;
        }
    }
    return null;
}
/**
 * Check if a failure should trigger fallback
 */
export function shouldTriggerFallback(errorMessage, isRetryable, fallbackConfig = DEFAULT_FALLBACK_CONFIG) {
    if (!fallbackConfig.enabled) {
        return false;
    }
    // If we only fallback on permanent failures, check retryable flag
    if (fallbackConfig.onlyOnPermanentFailure && isRetryable) {
        return false;
    }
    // Common permanent failure patterns that should trigger fallback
    const permanentFailurePatterns = [
        'invalid_email',
        'invalid_phone',
        'unsubscribed',
        'blocked',
        'invalid_address',
        'no_contact_info',
        'opted_out',
        'channel_opted_out',
        'suppressed',
    ];
    const lowerError = errorMessage.toLowerCase();
    return permanentFailurePatterns.some((pattern) => lowerError.includes(pattern));
}
/**
 * Create a fallback message log entry
 */
export async function createFallbackMessageLog(originalMessageLogId, fallbackChannel, reason) {
    // Get original message log
    const originalLog = await prisma.messageLog.findUnique({
        where: { id: originalMessageLogId },
        select: {
            campaignId: true,
            customerId: true,
            body: true,
            subject: true,
            executionId: true,
            isTest: true,
        },
    });
    if (!originalLog) {
        throw new Error('Original message log not found');
    }
    // Get customer contact info for fallback channel
    const customer = await prisma.customer.findUnique({
        where: { id: originalLog.customerId },
        select: { email: true, phone: true, whatsappNumber: true, pushToken: true },
    });
    if (!customer) {
        throw new Error('Customer not found');
    }
    let recipient = null;
    switch (fallbackChannel) {
        case 'email':
            recipient = customer.email;
            break;
        case 'sms':
            recipient = customer.phone;
            break;
        case 'whatsapp':
            recipient = customer.whatsappNumber || customer.phone;
            break;
        case 'rcs':
            recipient = customer.phone;
            break;
        case 'push':
            recipient = customer.pushToken;
            break;
    }
    if (!recipient) {
        throw new Error(`No contact info for fallback channel ${fallbackChannel}`);
    }
    // Create new message log for fallback
    const fallbackLog = await prisma.messageLog.create({
        data: {
            campaignId: originalLog.campaignId,
            customerId: originalLog.customerId,
            channel: fallbackChannel,
            recipient,
            body: originalLog.body,
            subject: fallbackChannel === 'email' ? originalLog.subject : null,
            deliveryStatus: 'pending',
            executionId: originalLog.executionId,
            isTest: originalLog.isTest,
            correlationId: `fallback_${originalMessageLogId}`,
        },
    });
    // Update original log to note the fallback
    await prisma.messageLog.update({
        where: { id: originalMessageLogId },
        data: {
            errorMessage: `${reason} - Falling back to ${fallbackChannel}`,
        },
    });
    return fallbackLog.id;
}
/**
 * Get fallback history for a message
 */
export async function getFallbackHistory(originalMessageLogId) {
    const fallbackLogs = await prisma.messageLog.findMany({
        where: {
            correlationId: { startsWith: `fallback_${originalMessageLogId}` },
        },
        select: {
            channel: true,
            deliveryStatus: true,
            createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
    });
    return fallbackLogs.map((log) => ({
        channel: log.channel,
        status: log.deliveryStatus,
        timestamp: log.createdAt,
    }));
}
/**
 * Check if all fallback channels have been exhausted
 */
export function areFallbacksExhausted(attemptedChannels, primaryChannel, fallbackConfig = DEFAULT_FALLBACK_CONFIG) {
    if (!fallbackConfig.enabled) {
        return true;
    }
    const nextChannel = getNextFallbackChannel(attemptedChannels, primaryChannel, fallbackConfig);
    return nextChannel === null;
}
