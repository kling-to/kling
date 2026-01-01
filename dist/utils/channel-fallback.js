import prisma from './prisma';
import { checkEligibility } from './eligibility';
export const DEFAULT_FALLBACK_ORDER = {
    email: ['push', 'sms', 'whatsapp'],
    sms: ['whatsapp', 'push', 'email'],
    whatsapp: ['sms', 'push', 'email'],
    rcs: ['sms', 'whatsapp', 'push'],
    push: ['email', 'sms', 'whatsapp'],
};
export const DEFAULT_FALLBACK_CONFIG = {
    enabled: true,
    maxAttempts: 2,
    delayBetweenAttempts: 0,
    onlyOnPermanentFailure: true,
};
export async function getAvailableFallbackChannels(customer, primaryChannel, config, fallbackConfig = DEFAULT_FALLBACK_CONFIG) {
    if (!fallbackConfig.enabled) {
        return [];
    }
    const fallbackOrder = fallbackConfig.fallbackOrder || DEFAULT_FALLBACK_ORDER[primaryChannel] || [];
    const maxAttempts = fallbackConfig.maxAttempts || 2;
    const availableChannels = [];
    for (const channel of fallbackOrder) {
        if (availableChannels.length >= maxAttempts) {
            break;
        }
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
export function getNextFallbackChannel(attemptedChannels, primaryChannel, fallbackConfig = DEFAULT_FALLBACK_CONFIG) {
    if (!fallbackConfig.enabled) {
        return null;
    }
    const fallbackOrder = fallbackConfig.fallbackOrder || DEFAULT_FALLBACK_ORDER[primaryChannel] || [];
    const maxAttempts = fallbackConfig.maxAttempts || 2;
    const fallbackAttempts = attemptedChannels.filter((c) => c !== primaryChannel).length;
    if (fallbackAttempts >= maxAttempts) {
        return null;
    }
    for (const channel of fallbackOrder) {
        if (!attemptedChannels.includes(channel)) {
            return channel;
        }
    }
    return null;
}
export function shouldTriggerFallback(errorMessage, isRetryable, fallbackConfig = DEFAULT_FALLBACK_CONFIG) {
    if (!fallbackConfig.enabled) {
        return false;
    }
    if (fallbackConfig.onlyOnPermanentFailure && isRetryable) {
        return false;
    }
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
export async function createFallbackMessageLog(originalMessageLogId, fallbackChannel, reason) {
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
    await prisma.messageLog.update({
        where: { id: originalMessageLogId },
        data: {
            errorMessage: `${reason} - Falling back to ${fallbackChannel}`,
        },
    });
    return fallbackLog.id;
}
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
export function areFallbacksExhausted(attemptedChannels, primaryChannel, fallbackConfig = DEFAULT_FALLBACK_CONFIG) {
    if (!fallbackConfig.enabled) {
        return true;
    }
    const nextChannel = getNextFallbackChannel(attemptedChannels, primaryChannel, fallbackConfig);
    return nextChannel === null;
}
