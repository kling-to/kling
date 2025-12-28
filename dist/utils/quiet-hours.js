/**
 * Quiet Hours Utility
 *
 * Provides DST-safe, timezone-aware quiet hours checking.
 * Supports configurable day-of-week restrictions.
 */
/**
 * Default quiet hours configuration
 */
export const DEFAULT_QUIET_HOURS = {
    enabled: false,
    startTime: '22:00',
    endTime: '08:00',
    timezone: 'UTC',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6], // All days
};
/**
 * Parse time string "HH:mm" into minutes from midnight
 */
function parseTimeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}
/**
 * Get current time in a specific timezone
 * Uses Intl.DateTimeFormat which handles DST automatically
 */
function getCurrentTimeInTimezone(timezone) {
    const now = new Date();
    // Get time components in the target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        weekday: 'short',
    });
    const parts = formatter.formatToParts(now);
    let hour = 0;
    let minute = 0;
    let weekday = '';
    for (const part of parts) {
        if (part.type === 'hour') {
            hour = parseInt(part.value, 10);
        }
        else if (part.type === 'minute') {
            minute = parseInt(part.value, 10);
        }
        else if (part.type === 'weekday') {
            weekday = part.value;
        }
    }
    // Convert weekday to number (0 = Sunday)
    const dayMap = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
    };
    const dayOfWeek = dayMap[weekday] ?? 0;
    return { hour, minute, dayOfWeek };
}
/**
 * Check if a time (in minutes from midnight) falls within quiet hours
 * Handles overnight periods (e.g., 22:00 - 08:00)
 */
function isTimeInRange(currentMinutes, startMinutes, endMinutes) {
    // Handle overnight range (e.g., 22:00 - 08:00)
    if (startMinutes > endMinutes) {
        return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
    // Normal range (e.g., 09:00 - 17:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}
/**
 * Check if current time is within quiet hours for a given configuration
 * This is the primary function to use for quiet hours checking
 */
export function isQuietHours(config) {
    if (!config.enabled) {
        return false;
    }
    try {
        const current = getCurrentTimeInTimezone(config.timezone);
        // Check if today is in the allowed days
        if (!config.daysOfWeek.includes(current.dayOfWeek)) {
            return false;
        }
        const currentMinutes = current.hour * 60 + current.minute;
        const startMinutes = parseTimeToMinutes(config.startTime);
        const endMinutes = parseTimeToMinutes(config.endTime);
        return isTimeInRange(currentMinutes, startMinutes, endMinutes);
    }
    catch (error) {
        // If timezone is invalid, don't block (fail open)
        console.error(`[QuietHours] Error checking quiet hours:`, error);
        return false;
    }
}
/**
 * Check if quiet hours are active based on settings
 */
export function isQuietHoursActive(settings) {
    // If quiet hours are not configured, return false
    if (!settings.quietHoursEnabled || !settings.quietHoursStart || !settings.quietHoursEnd) {
        return false;
    }
    const config = {
        enabled: settings.quietHoursEnabled,
        startTime: settings.quietHoursStart,
        endTime: settings.quietHoursEnd,
        timezone: settings.timezone || 'UTC',
        daysOfWeek: settings.quietHoursDays || [0, 1, 2, 3, 4, 5, 6],
    };
    return isQuietHours(config);
}
/**
 * Get the next time quiet hours will end
 * Useful for scheduling delayed delivery
 */
export function getNextQuietHoursEnd(config) {
    if (!config.enabled) {
        return null;
    }
    try {
        const now = new Date();
        const current = getCurrentTimeInTimezone(config.timezone);
        const currentMinutes = current.hour * 60 + current.minute;
        const endMinutes = parseTimeToMinutes(config.endTime);
        // Create a date object for the end time
        const endDate = new Date(now);
        // Calculate hours and minutes for end time
        const endHour = Math.floor(endMinutes / 60);
        const endMinute = endMinutes % 60;
        // If we're past the end time today, or in an overnight period before the end,
        // the end time is today. Otherwise, it's tomorrow.
        const startMinutes = parseTimeToMinutes(config.startTime);
        // Overnight period check
        if (startMinutes > endMinutes) {
            // Overnight period (e.g., 22:00 - 08:00)
            if (currentMinutes >= startMinutes) {
                // After start, so end is tomorrow
                endDate.setDate(endDate.getDate() + 1);
            }
            // If before end time, end is today (no change needed)
        }
        else {
            // Normal period (e.g., 09:00 - 17:00)
            if (currentMinutes >= endMinutes) {
                // After end time today, next quiet hours end is tomorrow
                endDate.setDate(endDate.getDate() + 1);
            }
        }
        // Set the end time
        endDate.setHours(endHour, endMinute, 0, 0);
        return endDate;
    }
    catch (error) {
        console.error(`[QuietHours] Error calculating next end time:`, error);
        return null;
    }
}
/**
 * Calculate delay until quiet hours end (in milliseconds)
 * Returns 0 if not in quiet hours
 */
export function getDelayUntilQuietHoursEnd(config) {
    if (!isQuietHours(config)) {
        return 0;
    }
    const endTime = getNextQuietHoursEnd(config);
    if (!endTime) {
        return 0;
    }
    const now = new Date();
    const delay = endTime.getTime() - now.getTime();
    return Math.max(0, delay);
}
/**
 * Validate timezone string
 */
export function isValidTimezone(timezone) {
    try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Get list of common timezones for selection
 */
export function getCommonTimezones() {
    return [
        'UTC',
        'America/New_York',
        'America/Chicago',
        'America/Denver',
        'America/Los_Angeles',
        'America/Anchorage',
        'Pacific/Honolulu',
        'America/Toronto',
        'America/Vancouver',
        'America/Sao_Paulo',
        'Europe/London',
        'Europe/Paris',
        'Europe/Berlin',
        'Europe/Moscow',
        'Asia/Dubai',
        'Asia/Kolkata',
        'Asia/Singapore',
        'Asia/Tokyo',
        'Asia/Shanghai',
        'Australia/Sydney',
        'Australia/Perth',
        'Pacific/Auckland',
    ];
}
/**
 * Format quiet hours configuration for display
 */
export function formatQuietHours(config) {
    if (!config.enabled) {
        return 'Quiet hours disabled';
    }
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = config.daysOfWeek.map((d) => dayNames[d]).join(', ');
    return `${config.startTime} - ${config.endTime} ${config.timezone} (${days})`;
}
