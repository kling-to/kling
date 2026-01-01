import prisma from './prisma';
import { isQuietHoursActive } from './quiet-hours';
async function isOnSuppressionList(channel, contactValue) {
    const suppression = await prisma.suppressionEntry.findFirst({
        where: {
            channel,
            value: contactValue.toLowerCase(),
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
    });
    return suppression !== null;
}
function isCooldownActive(lastContactAt, cooldownHours) {
    if (!lastContactAt || cooldownHours <= 0) {
        return false;
    }
    const cooldownEnd = new Date(lastContactAt);
    cooldownEnd.setHours(cooldownEnd.getHours() + cooldownHours);
    return new Date() < cooldownEnd;
}
async function wasRecentlySent(customerId, campaignId, dedupeHours) {
    if (dedupeHours <= 0) {
        return false;
    }
    const dedupeStart = new Date();
    dedupeStart.setHours(dedupeStart.getHours() - dedupeHours);
    const recentMessage = await prisma.messageLog.findFirst({
        where: {
            customerId,
            campaignId,
            sentAt: { gte: dedupeStart },
            deliveryStatus: { notIn: ['failed', 'bounced'] },
        },
    });
    return recentMessage !== null;
}
function getContactValue(customer, channel) {
    switch (channel) {
        case 'email':
            return customer.email;
        case 'sms':
            return customer.phone;
        case 'whatsapp':
            return customer.whatsappNumber || customer.phone;
        case 'rcs':
            return customer.phone;
        case 'push':
            return customer.pushToken || null;
        default:
            return null;
    }
}
export async function checkEligibility(customer, config) {
    const reasons = [];
    const details = {};
    const { channel, campaignId } = config;
    const cooldownHours = config.cooldownHours ?? 24;
    const dedupeHours = config.dedupeHours ?? 72;
    if (customer.optOut) {
        reasons.push('opted_out');
        details.optedOut = true;
    }
    if (customer.optOutChannels.includes(channel)) {
        reasons.push('channel_opted_out');
        details.channelOptedOut = channel;
    }
    const contactValue = getContactValue(customer, channel);
    if (!contactValue) {
        reasons.push('no_contact_info');
        details.missingContactFor = channel;
    }
    if (contactValue) {
        const suppressed = await isOnSuppressionList(channel, contactValue);
        if (suppressed) {
            reasons.push('suppressed');
            details.suppressedValue = contactValue;
        }
    }
    if (isCooldownActive(customer.lastContactAt, cooldownHours)) {
        reasons.push('cooldown_active');
        details.cooldownUntil = new Date(customer.lastContactAt);
        details.cooldownUntil.setHours(details.cooldownUntil.getHours() + cooldownHours);
    }
    const recentlySent = await wasRecentlySent(customer.id, campaignId, dedupeHours);
    if (recentlySent) {
        reasons.push('dedupe_recent_message');
        details.dedupeHours = dedupeHours;
    }
    const settings = await prisma.settings.findFirst();
    if (settings) {
        const inQuietHours = isQuietHoursActive({
            timezone: settings.timezone,
            quietHoursEnabled: settings.quietHoursEnabled ??
                (settings.quietHoursStart != null && settings.quietHoursEnd != null),
            quietHoursStart: settings.quietHoursStart,
            quietHoursEnd: settings.quietHoursEnd,
            quietHoursDays: settings.quietHoursDays,
        });
        if (inQuietHours) {
            reasons.push('quiet_hours');
            details.quietHoursStart = settings.quietHoursStart;
            details.quietHoursEnd = settings.quietHoursEnd;
            details.timezone = settings.timezone;
            details.quietHoursDays = settings.quietHoursDays;
        }
    }
    if (config.requireConsent) {
        const consentTypeMap = {
            email: 'email_marketing',
            sms: 'sms_marketing',
            whatsapp: 'whatsapp_marketing',
            rcs: 'sms_marketing',
            push: 'push_marketing',
        };
        const consentType = consentTypeMap[channel] || 'email_marketing';
        const consent = await prisma.consentLog.findFirst({
            where: {
                customerId: customer.id,
                consentType,
                granted: true,
            },
            orderBy: { createdAt: 'desc' },
        });
        if (!consent) {
            reasons.push('consent_not_granted');
            details.missingConsent = consentType;
        }
    }
    return {
        eligible: reasons.length === 0,
        reasons,
        details,
    };
}
export async function checkEligibilityBatch(customers, config) {
    const results = new Map();
    if (customers.length === 0) {
        return results;
    }
    const { channel, campaignId } = config;
    const cooldownHours = config.cooldownHours ?? 24;
    const dedupeHours = config.dedupeHours ?? 72;
    const dedupeStart = new Date();
    dedupeStart.setHours(dedupeStart.getHours() - dedupeHours);
    const contactValues = customers
        .map((c) => getContactValue(c, channel))
        .filter((v) => v !== null)
        .map((v) => v.toLowerCase());
    const suppressions = contactValues.length > 0
        ? await prisma.suppressionEntry.findMany({
            where: {
                channel,
                value: { in: contactValues },
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            select: { value: true },
        })
        : [];
    const suppressedSet = new Set(suppressions.map((s) => s.value.toLowerCase()));
    const customerIds = customers.map((c) => c.id);
    const recentMessages = dedupeHours > 0
        ? await prisma.messageLog.findMany({
            where: {
                customerId: { in: customerIds },
                campaignId,
                sentAt: { gte: dedupeStart },
                deliveryStatus: { notIn: ['failed', 'bounced'] },
            },
            select: { customerId: true },
        })
        : [];
    const recentlySentSet = new Set(recentMessages.map((m) => m.customerId));
    let consentSet = new Set();
    if (config.requireConsent) {
        const consentTypeMap = {
            email: 'email_marketing',
            sms: 'sms_marketing',
            whatsapp: 'whatsapp_marketing',
            rcs: 'sms_marketing',
            push: 'push_marketing',
        };
        const consentType = consentTypeMap[channel] || 'email_marketing';
        const consents = await prisma.consentLog.findMany({
            where: {
                customerId: { in: customerIds },
                consentType,
                granted: true,
            },
            select: { customerId: true },
            distinct: ['customerId'],
        });
        consentSet = new Set(consents.map((c) => c.customerId));
    }
    let inQuietHours = false;
    const settings = await prisma.settings.findFirst();
    if (settings) {
        inQuietHours = isQuietHoursActive({
            timezone: settings.timezone,
            quietHoursEnabled: settings.quietHoursEnabled ??
                (settings.quietHoursStart != null && settings.quietHoursEnd != null),
            quietHoursStart: settings.quietHoursStart,
            quietHoursEnd: settings.quietHoursEnd,
            quietHoursDays: settings.quietHoursDays,
        });
    }
    for (const customer of customers) {
        const reasons = [];
        const details = {};
        if (customer.optOut) {
            reasons.push('opted_out');
            details.optedOut = true;
        }
        if (customer.optOutChannels.includes(channel)) {
            reasons.push('channel_opted_out');
            details.channelOptedOut = channel;
        }
        const contactValue = getContactValue(customer, channel);
        if (!contactValue) {
            reasons.push('no_contact_info');
            details.missingContactFor = channel;
        }
        if (contactValue && suppressedSet.has(contactValue.toLowerCase())) {
            reasons.push('suppressed');
            details.suppressedValue = contactValue;
        }
        if (isCooldownActive(customer.lastContactAt, cooldownHours)) {
            reasons.push('cooldown_active');
            const cooldownUntil = new Date(customer.lastContactAt);
            cooldownUntil.setHours(cooldownUntil.getHours() + cooldownHours);
            details.cooldownUntil = cooldownUntil;
        }
        if (recentlySentSet.has(customer.id)) {
            reasons.push('dedupe_recent_message');
            details.dedupeHours = dedupeHours;
        }
        if (inQuietHours) {
            reasons.push('quiet_hours');
            details.quietHoursStart = settings?.quietHoursStart;
            details.quietHoursEnd = settings?.quietHoursEnd;
            details.timezone = settings?.timezone;
            details.quietHoursDays = settings?.quietHoursDays;
        }
        if (config.requireConsent && !consentSet.has(customer.id)) {
            reasons.push('consent_not_granted');
            details.missingConsent = channel === 'email' ? 'email_marketing' : 'sms_marketing';
        }
        results.set(customer.id, {
            eligible: reasons.length === 0,
            reasons,
            details,
        });
    }
    return results;
}
