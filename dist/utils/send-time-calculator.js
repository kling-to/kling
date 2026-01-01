import prisma from './prisma';
const MIN_SAMPLE_SIZE = 3;
const MIN_CONFIDENCE = 0.3;
const LOOKBACK_DAYS = 90;
function getHourInTimezone(date, timezone) {
    try {
        const tz = timezone || 'UTC';
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            hour: 'numeric',
            hour12: false,
        });
        const hour = parseInt(formatter.format(date), 10);
        return hour === 24 ? 0 : hour;
    }
    catch {
        return date.getUTCHours();
    }
}
export async function calculateCustomerSendTime(customerId) {
    try {
        const customer = await prisma.customer.findUnique({
            where: { id: customerId },
            select: { timezone: true },
        });
        if (!customer) {
            return { success: false, reason: 'Customer not found' };
        }
        const timezone = customer.timezone;
        const lookbackDate = new Date();
        lookbackDate.setDate(lookbackDate.getDate() - LOOKBACK_DAYS);
        const opens = await prisma.messageLog.findMany({
            where: {
                customerId,
                channel: 'email',
                openedAt: { gte: lookbackDate },
            },
            select: {
                openedAt: true,
            },
        });
        const validOpens = opens.filter((o) => o.openedAt !== null);
        if (validOpens.length < MIN_SAMPLE_SIZE) {
            return {
                success: false,
                reason: `Insufficient data: ${validOpens.length} opens (minimum: ${MIN_SAMPLE_SIZE})`,
            };
        }
        const hourlyDistribution = {};
        for (let i = 0; i < 24; i++) {
            hourlyDistribution[i.toString()] = 0;
        }
        for (const open of validOpens) {
            const hour = getHourInTimezone(open.openedAt, timezone);
            hourlyDistribution[hour.toString()]++;
        }
        let optimalHour = 9;
        let maxOpens = 0;
        for (const [hourStr, count] of Object.entries(hourlyDistribution)) {
            if (count > maxOpens) {
                maxOpens = count;
                optimalHour = parseInt(hourStr, 10);
            }
        }
        const concentration = maxOpens / validOpens.length;
        const sampleFactor = Math.min(validOpens.length / 20, 1.0);
        const confidence = concentration * sampleFactor;
        if (confidence < MIN_CONFIDENCE) {
            return {
                success: false,
                reason: `Low confidence: ${confidence.toFixed(2)} (minimum: ${MIN_CONFIDENCE})`,
            };
        }
        const profile = {
            customerId,
            optimalHour,
            confidence,
            sampleSize: validOpens.length,
            hourlyDistribution,
            timezone,
        };
        return { success: true, profile };
    }
    catch (error) {
        return {
            success: false,
            reason: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
export async function saveSendTimeProfile(profile) {
    await prisma.customerSendTimeProfile.upsert({
        where: { customerId: profile.customerId },
        create: {
            customerId: profile.customerId,
            optimalHour: profile.optimalHour,
            confidence: profile.confidence,
            sampleSize: profile.sampleSize,
            hourlyDistribution: profile.hourlyDistribution,
            timezone: profile.timezone,
        },
        update: {
            optimalHour: profile.optimalHour,
            confidence: profile.confidence,
            sampleSize: profile.sampleSize,
            hourlyDistribution: profile.hourlyDistribution,
            timezone: profile.timezone,
            calculatedAt: new Date(),
        },
    });
}
export async function calculateBatchSendTimes(customerIds) {
    let calculated = 0;
    let skipped = 0;
    let errors = 0;
    let totalConfidence = 0;
    for (const customerId of customerIds) {
        const result = await calculateCustomerSendTime(customerId);
        if (result.success && result.profile) {
            await saveSendTimeProfile(result.profile);
            calculated++;
            totalConfidence += result.profile.confidence;
        }
        else if (result.reason?.includes('Insufficient') ||
            result.reason?.includes('Low confidence')) {
            skipped++;
        }
        else {
            errors++;
        }
    }
    return {
        total: customerIds.length,
        calculated,
        skipped,
        errors,
        averageConfidence: calculated > 0 ? totalConfidence / calculated : 0,
    };
}
export async function calculateAllSendTimes(batchSize = 100) {
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - LOOKBACK_DAYS);
    const customersWithOpens = await prisma.messageLog.findMany({
        where: {
            channel: 'email',
            openedAt: { gte: lookbackDate },
        },
        select: {
            customerId: true,
        },
        distinct: ['customerId'],
    });
    const customerIds = customersWithOpens.map((c) => c.customerId);
    let totalCalculated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let totalConfidenceSum = 0;
    for (let i = 0; i < customerIds.length; i += batchSize) {
        const batch = customerIds.slice(i, i + batchSize);
        const result = await calculateBatchSendTimes(batch);
        totalCalculated += result.calculated;
        totalSkipped += result.skipped;
        totalErrors += result.errors;
        totalConfidenceSum += result.averageConfidence * result.calculated;
    }
    return {
        total: customerIds.length,
        calculated: totalCalculated,
        skipped: totalSkipped,
        errors: totalErrors,
        averageConfidence: totalCalculated > 0 ? totalConfidenceSum / totalCalculated : 0,
    };
}
export async function getCustomerOptimalHour(customerId) {
    const profile = await prisma.customerSendTimeProfile.findUnique({
        where: { customerId },
    });
    if (!profile) {
        return null;
    }
    return {
        hour: profile.optimalHour,
        confidence: profile.confidence,
        timezone: profile.timezone,
    };
}
function isHourInQuietHours(hour, quietHours) {
    if (!quietHours.enabled)
        return false;
    const [startH] = quietHours.startTime.split(':').map(Number);
    const [endH] = quietHours.endTime.split(':').map(Number);
    if (startH > endH) {
        return hour >= startH || hour < endH;
    }
    return hour >= startH && hour < endH;
}
function getFirstHourAfterQuietHours(quietHours) {
    const [endH] = quietHours.endTime.split(':').map(Number);
    return endH;
}
export function calculateSendDelay(optimalHour, customerTimezone, maxDelayHours = 24, quietHours) {
    const now = new Date();
    const tz = customerTimezone || 'UTC';
    let currentHour;
    try {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            hour: 'numeric',
            hour12: false,
        });
        currentHour = parseInt(formatter.format(now), 10);
        if (currentHour === 24)
            currentHour = 0;
    }
    catch {
        currentHour = now.getUTCHours();
    }
    let targetHour = optimalHour;
    if (quietHours && isHourInQuietHours(optimalHour, quietHours)) {
        targetHour = getFirstHourAfterQuietHours(quietHours);
    }
    let hoursUntilTarget;
    if (targetHour > currentHour) {
        hoursUntilTarget = targetHour - currentHour;
    }
    else if (targetHour < currentHour) {
        hoursUntilTarget = 24 - currentHour + targetHour;
    }
    else {
        if (quietHours && isHourInQuietHours(currentHour, quietHours)) {
            targetHour = getFirstHourAfterQuietHours(quietHours);
            hoursUntilTarget =
                targetHour > currentHour ? targetHour - currentHour : 24 - currentHour + targetHour;
        }
        else {
            return 0;
        }
    }
    if (hoursUntilTarget > maxDelayHours) {
        return 0;
    }
    return hoursUntilTarget * 60 * 60 * 1000;
}
export async function getSendTimeDistribution(customerIds) {
    const profiles = await prisma.customerSendTimeProfile.findMany({
        where: { customerId: { in: customerIds } },
    });
    const hourlyDistribution = {};
    for (let i = 0; i < 24; i++) {
        hourlyDistribution[i.toString()] = 0;
    }
    let totalConfidence = 0;
    for (const profile of profiles) {
        hourlyDistribution[profile.optimalHour.toString()]++;
        totalConfidence += profile.confidence;
    }
    return {
        withProfile: profiles.length,
        withoutProfile: customerIds.length - profiles.length,
        hourlyDistribution,
        averageConfidence: profiles.length > 0 ? totalConfidence / profiles.length : 0,
    };
}
