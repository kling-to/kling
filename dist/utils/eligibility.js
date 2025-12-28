import prisma from './prisma';
import { isQuietHoursActive } from './quiet-hours';
/**
 * Check if a customer is on the suppression list.
 */
async function isOnSuppressionList(channel, contactValue) {
    const suppression = await prisma.suppressionEntry.findFirst({
        where: {
            channel,
            value: contactValue.toLowerCase(),
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], // Not expired
        },
    });
    return suppression !== null;
}
/**
 * Check if a customer was recently contacted (cooldown).
 */
function isCooldownActive(lastContactAt, cooldownHours) {
    if (!lastContactAt || cooldownHours <= 0) {
        return false;
    }
    const cooldownEnd = new Date(lastContactAt);
    cooldownEnd.setHours(cooldownEnd.getHours() + cooldownHours);
    return new Date() < cooldownEnd;
}
/**
 * Check if the same message was recently sent (dedupe).
 */
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
/**
 * Get the contact value for a customer based on channel.
 */
function getContactValue(customer, channel) {
    switch (channel) {
        case 'email':
            return customer.email;
        case 'sms':
            return customer.phone;
        case 'whatsapp':
            // Use dedicated WhatsApp number, or fall back to phone
            return customer.whatsappNumber || customer.phone;
        case 'rcs':
            // RCS uses phone number
            return customer.phone;
        case 'push':
            return customer.pushToken || null;
        default:
            return null;
    }
}
/**
 * Check if a customer is eligible to receive a message.
 * This implements the eligibility checks from Journey 6.
 */
export async function checkEligibility(customer, config) {
    const reasons = [];
    const details = {};
    const { channel, campaignId } = config;
    const cooldownHours = config.cooldownHours ?? 24;
    const dedupeHours = config.dedupeHours ?? 72;
    // 1. Check global opt-out
    if (customer.optOut) {
        reasons.push('opted_out');
        details.optedOut = true;
    }
    // 2. Check channel-specific opt-out
    if (customer.optOutChannels.includes(channel)) {
        reasons.push('channel_opted_out');
        details.channelOptedOut = channel;
    }
    // 3. Check contact info availability
    const contactValue = getContactValue(customer, channel);
    if (!contactValue) {
        reasons.push('no_contact_info');
        details.missingContactFor = channel;
    }
    // 4. Check suppression list (if contact info exists)
    if (contactValue) {
        const suppressed = await isOnSuppressionList(channel, contactValue);
        if (suppressed) {
            reasons.push('suppressed');
            details.suppressedValue = contactValue;
        }
    }
    // 5. Check cooldown
    if (isCooldownActive(customer.lastContactAt, cooldownHours)) {
        reasons.push('cooldown_active');
        details.cooldownUntil = new Date(customer.lastContactAt);
        details.cooldownUntil.setHours(details.cooldownUntil.getHours() + cooldownHours);
    }
    // 6. Check dedupe (same campaign message recently)
    const recentlySent = await wasRecentlySent(customer.id, campaignId, dedupeHours);
    if (recentlySent) {
        reasons.push('dedupe_recent_message');
        details.dedupeHours = dedupeHours;
    }
    // 7. Check quiet hours (DST-safe) - fetch from Settings table
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
    // 8. Check consent (if required)
    if (config.requireConsent) {
        const consentTypeMap = {
            email: 'email_marketing',
            sms: 'sms_marketing',
            whatsapp: 'whatsapp_marketing',
            rcs: 'sms_marketing', // RCS uses SMS consent
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
/**
 * Batch check eligibility for multiple customers.
 * Optimized with batch queries for suppression list and dedupe checks.
 */
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
    // 1. Batch fetch suppression entries
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
    // 2. Batch fetch recent messages for dedupe
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
    // 3. Batch fetch consent records (if required)
    let consentSet = new Set();
    if (config.requireConsent) {
        const consentTypeMap = {
            email: 'email_marketing',
            sms: 'sms_marketing',
            whatsapp: 'whatsapp_marketing',
            rcs: 'sms_marketing', // RCS uses SMS consent
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
    // 4. Check quiet hours once (applies to all customers) - fetch from Settings table
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
    // 5. Process each customer using pre-fetched data
    for (const customer of customers) {
        const reasons = [];
        const details = {};
        // Check global opt-out
        if (customer.optOut) {
            reasons.push('opted_out');
            details.optedOut = true;
        }
        // Check channel-specific opt-out
        if (customer.optOutChannels.includes(channel)) {
            reasons.push('channel_opted_out');
            details.channelOptedOut = channel;
        }
        // Check contact info availability
        const contactValue = getContactValue(customer, channel);
        if (!contactValue) {
            reasons.push('no_contact_info');
            details.missingContactFor = channel;
        }
        // Check suppression list (using pre-fetched data)
        if (contactValue && suppressedSet.has(contactValue.toLowerCase())) {
            reasons.push('suppressed');
            details.suppressedValue = contactValue;
        }
        // Check cooldown
        if (isCooldownActive(customer.lastContactAt, cooldownHours)) {
            reasons.push('cooldown_active');
            const cooldownUntil = new Date(customer.lastContactAt);
            cooldownUntil.setHours(cooldownUntil.getHours() + cooldownHours);
            details.cooldownUntil = cooldownUntil;
        }
        // Check dedupe (using pre-fetched data)
        if (recentlySentSet.has(customer.id)) {
            reasons.push('dedupe_recent_message');
            details.dedupeHours = dedupeHours;
        }
        // Check quiet hours
        if (inQuietHours) {
            reasons.push('quiet_hours');
            details.quietHoursStart = settings?.quietHoursStart;
            details.quietHoursEnd = settings?.quietHoursEnd;
            details.timezone = settings?.timezone;
            details.quietHoursDays = settings?.quietHoursDays;
        }
        // Check consent (using pre-fetched data)
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
