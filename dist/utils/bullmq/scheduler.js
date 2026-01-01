import { getCampaignQueue } from './queues';
function getScheduleJobKey(campaignId) {
    return `schedule_${campaignId}`;
}
function getCronOptions(cron, startAt, endAt, timezone) {
    return {
        pattern: cron,
        startDate: startAt,
        endDate: endAt,
        tz: timezone || 'UTC',
    };
}
export async function createCampaignSchedule(campaignId, cron, startAt, endAt, timezone) {
    const queue = getCampaignQueue();
    const jobKey = getScheduleJobKey(campaignId);
    const tz = timezone || 'UTC';
    const jobData = {
        campaignId,
    };
    await queue.add(jobKey, jobData, {
        repeat: getCronOptions(cron, startAt, endAt, tz),
        jobId: jobKey,
    });
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
export async function updateCampaignSchedule(campaignId, oldJobKey, cron, startAt, endAt, timezone) {
    if (oldJobKey) {
        await removeScheduleByKey(oldJobKey);
    }
    else {
        await removeCampaignSchedule(campaignId);
    }
    return createCampaignSchedule(campaignId, cron, startAt, endAt, timezone);
}
export async function removeScheduleByKey(jobKey) {
    const queue = getCampaignQueue();
    try {
        await queue.removeRepeatableByKey(jobKey);
    }
    catch (err) {
        console.warn(`[Scheduler] Could not remove job key ${jobKey}:`, err);
    }
}
export async function removeCampaignSchedule(campaignId) {
    const queue = getCampaignQueue();
    const jobKey = getScheduleJobKey(campaignId);
    const repeatableJobs = await queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        if (job.name === jobKey || job.key?.includes(campaignId)) {
            await queue.removeRepeatableByKey(job.key);
        }
    }
    const jobs = await queue.getJobs(['delayed', 'waiting']);
    for (const job of jobs) {
        if (job.data?.campaignId === campaignId) {
            await job.remove();
        }
    }
}
export async function pauseCampaignSchedule(campaignId, jobKey) {
    if (jobKey) {
        await removeScheduleByKey(jobKey);
    }
    else {
        await removeCampaignSchedule(campaignId);
    }
    console.log(`[Scheduler] Paused schedule for campaign ${campaignId}`);
}
export async function resumeCampaignSchedule(campaignId, cron, startAt, endAt, timezone) {
    const scheduleInfo = await createCampaignSchedule(campaignId, cron, startAt, endAt, timezone);
    console.log(`[Scheduler] Resumed schedule for campaign ${campaignId}`);
    return scheduleInfo;
}
export async function triggerCampaignNow(campaignId, isTest = false) {
    const queue = getCampaignQueue();
    const jobData = {
        campaignId,
        isTest,
    };
    const job = await queue.add(`immediate_${campaignId}_${Date.now()}`, jobData, {
        jobId: `test_${campaignId}_${Date.now()}`,
    });
    console.log(`[Scheduler] Triggered immediate execution for campaign ${campaignId}, job: ${job.id}`);
    return job.id || '';
}
export async function getScheduleInfo(campaignId) {
    const queue = getCampaignQueue();
    const jobKey = getScheduleJobKey(campaignId);
    const repeatableJobs = await queue.getRepeatableJobs();
    const job = repeatableJobs.find((j) => j.name === jobKey);
    if (!job) {
        return null;
    }
    return {
        jobKey: job.key,
        cron: job.pattern || '',
        timezone: job.tz || 'UTC',
        startAt: new Date(),
        endAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        nextRun: job.next ? new Date(job.next) : null,
    };
}
export async function getScheduleInfoByKey(jobKey) {
    const queue = getCampaignQueue();
    const repeatableJobs = await queue.getRepeatableJobs();
    const job = repeatableJobs.find((j) => j.key === jobKey);
    if (!job) {
        return null;
    }
    return {
        jobKey: job.key,
        cron: job.pattern || '',
        timezone: job.tz || 'UTC',
        startAt: new Date(),
        endAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        nextRun: job.next ? new Date(job.next) : null,
    };
}
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
