/**
 * Send Time Calculator
 *
 * Calculates optimal send times for each customer based on their
 * historical email open patterns from MessageLog.
 *
 * Algorithm (MVP Heuristic):
 * 1. Query MessageLog for customer's opens (last 90 days, email channel)
 * 2. Convert openedAt timestamps to customer's local timezone
 * 3. Build hourly distribution: { 0: 2, 9: 15, 10: 8, ..., 23: 1 }
 * 4. Find hour with most opens: optimalHour
 * 5. Calculate confidence based on concentration and sample size
 * 6. Store profile if confidence >= threshold
 */
import prisma from './prisma';
// Minimum opens required to calculate a profile
const MIN_SAMPLE_SIZE = 3;
// Minimum confidence to store a profile
const MIN_CONFIDENCE = 0.3;
// Days of history to analyze
const LOOKBACK_DAYS = 90;
/**
 * Get the hour (0-23) from a Date in a specific timezone
 */
function getHourInTimezone(date, timezone) {
    try {
        const tz = timezone || 'UTC';
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            hour: 'numeric',
            hour12: false,
        });
        const hour = parseInt(formatter.format(date), 10);
        // Handle midnight (24 -> 0)
        return hour === 24 ? 0 : hour;
    }
    catch {
        // Invalid timezone, fall back to UTC
        return date.getUTCHours();
    }
}
/**
 * Calculate optimal send time for a single customer
 */
export async function calculateCustomerSendTime(customerId) {
    try {
        // Get customer's timezone
        const customer = await prisma.customer.findUnique({
            where: { id: customerId },
            select: { timezone: true },
        });
        if (!customer) {
            return { success: false, reason: 'Customer not found' };
        }
        const timezone = customer.timezone;
        // Calculate lookback date
        const lookbackDate = new Date();
        lookbackDate.setDate(lookbackDate.getDate() - LOOKBACK_DAYS);
        // Get all email opens for this customer
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
        // Filter out nulls and check minimum sample size
        const validOpens = opens.filter((o) => o.openedAt !== null);
        if (validOpens.length < MIN_SAMPLE_SIZE) {
            return {
                success: false,
                reason: `Insufficient data: ${validOpens.length} opens (minimum: ${MIN_SAMPLE_SIZE})`,
            };
        }
        // Build hourly distribution
        const hourlyDistribution = {};
        for (let i = 0; i < 24; i++) {
            hourlyDistribution[i.toString()] = 0;
        }
        for (const open of validOpens) {
            const hour = getHourInTimezone(open.openedAt, timezone);
            hourlyDistribution[hour.toString()]++;
        }
        // Find optimal hour (hour with most opens)
        let optimalHour = 9; // Default
        let maxOpens = 0;
        for (const [hourStr, count] of Object.entries(hourlyDistribution)) {
            if (count > maxOpens) {
                maxOpens = count;
                optimalHour = parseInt(hourStr, 10);
            }
        }
        // Calculate confidence
        // concentration: what fraction of opens are in the optimal hour
        const concentration = maxOpens / validOpens.length;
        // sampleFactor: more samples = more confidence (caps at 1.0 at 20 samples)
        const sampleFactor = Math.min(validOpens.length / 20, 1.0);
        // Final confidence is concentration * sampleFactor
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
/**
 * Save a send time profile to the database
 */
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
/**
 * Calculate and save send time profiles for multiple customers
 */
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
/**
 * Calculate send time profiles for all customers with email opens
 * Processes in batches to avoid memory issues
 */
export async function calculateAllSendTimes(batchSize = 100) {
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - LOOKBACK_DAYS);
    // Get distinct customer IDs with email opens
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
    // Process in batches
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
/**
 * Get the optimal send hour for a customer
 * Returns null if no profile exists or confidence is too low
 */
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
/**
 * Check if a specific hour would fall within quiet hours
 */
function isHourInQuietHours(hour, quietHours) {
    if (!quietHours.enabled)
        return false;
    const [startH] = quietHours.startTime.split(':').map(Number);
    const [endH] = quietHours.endTime.split(':').map(Number);
    // Overnight period (e.g., 22:00 - 08:00)
    if (startH > endH) {
        return hour >= startH || hour < endH;
    }
    // Normal period (e.g., 09:00 - 17:00)
    return hour >= startH && hour < endH;
}
/**
 * Find the next valid hour after quiet hours end
 */
function getFirstHourAfterQuietHours(quietHours) {
    const [endH] = quietHours.endTime.split(':').map(Number);
    return endH;
}
/**
 * Calculate delay in milliseconds until the optimal send hour
 *
 * @param optimalHour - The target hour (0-23)
 * @param customerTimezone - Customer's timezone (or null for UTC)
 * @param maxDelayHours - Maximum hours to delay
 * @param quietHours - Optional quiet hours settings to avoid
 * @returns Delay in milliseconds, or 0 if should send immediately
 */
export function calculateSendDelay(optimalHour, customerTimezone, maxDelayHours = 24, quietHours) {
    const now = new Date();
    const tz = customerTimezone || 'UTC';
    // Get current hour in customer's timezone
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
    // Determine target hour - adjust if optimal falls in quiet hours
    let targetHour = optimalHour;
    if (quietHours && isHourInQuietHours(optimalHour, quietHours)) {
        // Optimal hour is in quiet hours, use first hour after quiet hours end
        targetHour = getFirstHourAfterQuietHours(quietHours);
    }
    // Calculate hours until target time
    let hoursUntilTarget;
    if (targetHour > currentHour) {
        hoursUntilTarget = targetHour - currentHour;
    }
    else if (targetHour < currentHour) {
        hoursUntilTarget = 24 - currentHour + targetHour;
    }
    else {
        // Same hour - but check if we're currently in quiet hours
        if (quietHours && isHourInQuietHours(currentHour, quietHours)) {
            // We're in quiet hours now, delay until they end
            targetHour = getFirstHourAfterQuietHours(quietHours);
            hoursUntilTarget =
                targetHour > currentHour ? targetHour - currentHour : 24 - currentHour + targetHour;
        }
        else {
            // Same hour, not in quiet hours - send now
            return 0;
        }
    }
    // Cap at maxDelayHours
    if (hoursUntilTarget > maxDelayHours) {
        return 0; // Send immediately if delay too long
    }
    // Convert to milliseconds
    return hoursUntilTarget * 60 * 60 * 1000;
}
/**
 * Get send time statistics for a set of customers
 * Useful for campaign preview
 */
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
