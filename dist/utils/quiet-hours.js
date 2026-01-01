export const DEFAULT_QUIET_HOURS = {
    enabled: false,
    startTime: '22:00',
    endTime: '08:00',
    timezone: 'UTC',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
};
function parseTimeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}
function getCurrentTimeInTimezone(timezone) {
    const now = new Date();
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
function isTimeInRange(currentMinutes, startMinutes, endMinutes) {
    if (startMinutes > endMinutes) {
        return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}
export function isQuietHours(config) {
    if (!config.enabled) {
        return false;
    }
    try {
        const current = getCurrentTimeInTimezone(config.timezone);
        if (!config.daysOfWeek.includes(current.dayOfWeek)) {
            return false;
        }
        const currentMinutes = current.hour * 60 + current.minute;
        const startMinutes = parseTimeToMinutes(config.startTime);
        const endMinutes = parseTimeToMinutes(config.endTime);
        return isTimeInRange(currentMinutes, startMinutes, endMinutes);
    }
    catch (error) {
        console.error(`[QuietHours] Error checking quiet hours:`, error);
        return false;
    }
}
export function isQuietHoursActive(settings) {
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
export function getNextQuietHoursEnd(config) {
    if (!config.enabled) {
        return null;
    }
    try {
        const now = new Date();
        const current = getCurrentTimeInTimezone(config.timezone);
        const currentMinutes = current.hour * 60 + current.minute;
        const endMinutes = parseTimeToMinutes(config.endTime);
        const endDate = new Date(now);
        const endHour = Math.floor(endMinutes / 60);
        const endMinute = endMinutes % 60;
        const startMinutes = parseTimeToMinutes(config.startTime);
        if (startMinutes > endMinutes) {
            if (currentMinutes >= startMinutes) {
                endDate.setDate(endDate.getDate() + 1);
            }
        }
        else {
            if (currentMinutes >= endMinutes) {
                endDate.setDate(endDate.getDate() + 1);
            }
        }
        endDate.setHours(endHour, endMinute, 0, 0);
        return endDate;
    }
    catch (error) {
        console.error(`[QuietHours] Error calculating next end time:`, error);
        return null;
    }
}
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
export function isValidTimezone(timezone) {
    try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
        return true;
    }
    catch {
        return false;
    }
}
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
export function formatQuietHours(config) {
    if (!config.enabled) {
        return 'Quiet hours disabled';
    }
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = config.daysOfWeek.map((d) => dayNames[d]).join(', ');
    return `${config.startTime} - ${config.endTime} ${config.timezone} (${days})`;
}
