/**
 * BullMQ Scheduler
 *
 * Manages repeatable jobs for campaign scheduling.
 * BullMQ/Redis is the single source of truth for schedules.
 * MongoDB stores a reference (bullmqJobKey) to the Redis job.
 */
import { getCampaignQueue } from './queues';
/**
 * Generate a deterministic job key for a campaign schedule.
 */
function getScheduleJobKey(campaignId) {
    return `schedule_${campaignId}`;
}
/**
 * Convert cron expression to BullMQ repeat options
 */
function getCronOptions(cron, startAt, endAt, timezone) {
    return {
        pattern: cron,
        startDate: startAt,
        endDate: endAt,
        tz: timezone || 'UTC',
    };
}
/**
 * Create a campaign schedule in BullMQ.
 * Returns the job key to store in MongoDB.
 */
export async function createCampaignSchedule(campaignId, cron, startAt, endAt, timezone) {
    const queue = getCampaignQueue();
    const jobKey = getScheduleJobKey(campaignId);
    const tz = timezone || 'UTC';
    const jobData = {
        campaignId,
    };
    // Add repeatable job with deterministic key
    await queue.add(jobKey, jobData, {
        repeat: getCronOptions(cron, startAt, endAt, tz),
        jobId: jobKey,
    });
    // Get the repeatable job info to find the actual key
    const repeatableJobs = await queue.getRepeatableJobs();
    const repeatableJob = repeatableJobs.find((j) => j.name === jobKey);
    const scheduleInfo = {
        jobKey: repeatableJob?.key || jobKey,
        cron,
        timezone: tz,
        startAt,
        endAt,
        nextRun: repeatableJob?.next ? new Date(repeatableJob.next) : null,
    };
    console.log(`[Scheduler] Created schedule for campaign ${campaignId}: ${cron} (${tz})`);
    return scheduleInfo;
}
/**
 * Update a campaign's schedule (remove old, create new)
 * Returns the new job key.
 */
export async function updateCampaignSchedule(campaignId, oldJobKey, cron, startAt, endAt, timezone) {
    // Remove existing schedule if we have the key
    if (oldJobKey) {
        await removeScheduleByKey(oldJobKey);
    }
    else {
        // Fallback: try to remove by campaign ID pattern
        await removeCampaignSchedule(campaignId);
    }
    // Create new schedule
    return createCampaignSchedule(campaignId, cron, startAt, endAt, timezone);
}
/**
 * Remove a schedule by its BullMQ job key
 */
export async function removeScheduleByKey(jobKey) {
    const queue = getCampaignQueue();
    try {
        await queue.removeRepeatableByKey(jobKey);
    }
    catch (err) {
        // Job may not exist, that's okay
        console.warn(`[Scheduler] Could not remove job key ${jobKey}:`, err);
    }
}
/**
 * Remove a campaign's schedule by campaign ID (fallback method)
 */
export async function removeCampaignSchedule(campaignId) {
    const queue = getCampaignQueue();
    const jobKey = getScheduleJobKey(campaignId);
    // Remove all repeatable jobs with this key
    const repeatableJobs = await queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        if (job.name === jobKey || job.key?.includes(campaignId)) {
            await queue.removeRepeatableByKey(job.key);
        }
    }
    // Also remove any delayed/waiting jobs for this campaign
    const jobs = await queue.getJobs(['delayed', 'waiting']);
    for (const job of jobs) {
        if (job.data?.campaignId === campaignId) {
            await job.remove();
        }
    }
}
/**
 * Pause a campaign's schedule (removes from BullMQ)
 */
export async function pauseCampaignSchedule(campaignId, jobKey) {
    if (jobKey) {
        await removeScheduleByKey(jobKey);
    }
    else {
        await removeCampaignSchedule(campaignId);
    }
    console.log(`[Scheduler] Paused schedule for campaign ${campaignId}`);
}
/**
 * Resume a campaign's schedule (re-creates in BullMQ)
 * Returns the new job key.
 */
export async function resumeCampaignSchedule(campaignId, cron, startAt, endAt, timezone) {
    const scheduleInfo = await createCampaignSchedule(campaignId, cron, startAt, endAt, timezone);
    console.log(`[Scheduler] Resumed schedule for campaign ${campaignId}`);
    return scheduleInfo;
}
/**
 * Trigger an immediate one-time execution of a campaign (for testing)
 */
export async function triggerCampaignNow(campaignId, isTest = false) {
    const queue = getCampaignQueue();
    const jobData = {
        campaignId,
        isTest,
    };
    // Add immediate job with unique ID
    const job = await queue.add(`immediate_${campaignId}_${Date.now()}`, jobData, {
        jobId: `test_${campaignId}_${Date.now()}`,
    });
    console.log(`[Scheduler] Triggered immediate execution for campaign ${campaignId}, job: ${job.id}`);
    return job.id || '';
}
/**
 * Get schedule info for a campaign from BullMQ
 */
export async function getScheduleInfo(campaignId) {
    const queue = getCampaignQueue();
    const jobKey = getScheduleJobKey(campaignId);
    const repeatableJobs = await queue.getRepeatableJobs();
    const job = repeatableJobs.find((j) => j.name === jobKey);
    if (!job) {
        return null;
    }
    // Note: BullMQ RepeatableJob doesn't expose startDate/endDate directly
    // We only have access to pattern, tz, and next run time
    return {
        jobKey: job.key,
        cron: job.pattern || '',
        timezone: job.tz || 'UTC',
        startAt: new Date(), // Not available from RepeatableJob, use current date
        endAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // Default 1 year
        nextRun: job.next ? new Date(job.next) : null,
    };
}
/**
 * Get schedule info by job key from BullMQ
 */
export async function getScheduleInfoByKey(jobKey) {
    const queue = getCampaignQueue();
    const repeatableJobs = await queue.getRepeatableJobs();
    const job = repeatableJobs.find((j) => j.key === jobKey);
    if (!job) {
        return null;
    }
    // Note: BullMQ RepeatableJob doesn't expose startDate/endDate directly
    return {
        jobKey: job.key,
        cron: job.pattern || '',
        timezone: job.tz || 'UTC',
        startAt: new Date(), // Not available from RepeatableJob
        endAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // Default 1 year
        nextRun: job.next ? new Date(job.next) : null,
    };
}
/**
 * Get list of all registered repeatable jobs
 */
export async function getRegisteredSchedules() {
    const queue = getCampaignQueue();
    const repeatableJobs = await queue.getRepeatableJobs();
    return repeatableJobs
        .filter((job) => job.name.startsWith('schedule_'))
        .map((job) => ({
        campaignId: job.name.replace('schedule_', ''),
        jobKey: job.key,
        cron: job.pattern || '',
        timezone: job.tz || 'UTC',
        nextRun: job.next ? new Date(job.next) : null,
    }));
}
