export { getRedisConnection, QUEUE_NAMES, getWorkerConcurrency } from './connection';
export { getCampaignQueue, getCustomerQueue, getDLQ, getFlowEnrollmentQueue, getFlowStepQueue, getQueueMetrics, closeAllQueues, } from './queues';
export { createCampaignSchedule, updateCampaignSchedule, removeCampaignSchedule, removeScheduleByKey, pauseCampaignSchedule, resumeCampaignSchedule, triggerCampaignNow, getScheduleInfo, getScheduleInfoByKey, getRegisteredSchedules, } from './scheduler';
export { startCampaignWorker, startCustomerWorker, startAllWorkers, stopAllWorkers, areWorkersRunning, } from './workers';
export { startFlowEnrollmentWorker, startFlowStepWorker, startFlowWorkers, stopFlowWorkers, areFlowWorkersRunning, } from './flow-workers';
export { getAutoTuneQueue, startAutoTuneWorker, stopAutoTuneWorker, scheduleAutoTuneJob, triggerAutoTuneNow, isAutoTuneWorkerRunning, } from './auto-tune-worker';
export { getAuditCleanupQueue, startAuditCleanupWorker, stopAuditCleanupWorker, scheduleAuditCleanupJob, triggerAuditCleanupNow, isAuditCleanupWorkerRunning, getAuditCleanupScheduleInfo, } from './audit-cleanup-worker';
export { getCartAbandonmentQueue, startCartAbandonmentWorker, stopCartAbandonmentWorker, scheduleCartAbandonmentJob, removeCartAbandonmentSchedule, triggerCartAbandonmentNow, isCartAbandonmentWorkerRunning, getCartAbandonmentScheduleInfo, } from './cart-abandonment-worker';
export { getBrowseAbandonmentQueue, startBrowseAbandonmentWorker, stopBrowseAbandonmentWorker, scheduleBrowseAbandonmentJob, removeBrowseAbandonmentSchedule, triggerBrowseAbandonmentNow, isBrowseAbandonmentWorkerRunning, getBrowseAbandonmentScheduleInfo, } from './browse-abandonment-worker';
export { getPredictionQueue, schedulePredictionJob, removePredictionSchedule, triggerPredictionCalculation, startPredictionWorker, stopPredictionWorker, getPredictionJobStatus, initializePredictionWorker, } from './prediction-worker';
export { getBackupQueue, startBackupWorker, stopBackupWorker, scheduleBackupJob, removeBackupSchedule, triggerBackupNow, isBackupWorkerRunning, getBackupScheduleInfo, } from './backup-worker';
export { getUpdateQueue, startUpdateWorker, stopUpdateWorker, queueUpdateJob, getActiveUpdateJob, isUpdateWorkerRunning, } from './update-worker';
export async function initializeBullMQ() {
    const { startAllWorkers } = await import('./workers');
    const { startFlowWorkers } = await import('./flow-workers');
    const { startAutoTuneWorker, scheduleAutoTuneJob } = await import('./auto-tune-worker');
    const { startAuditCleanupWorker, scheduleAuditCleanupJob } = await import('./audit-cleanup-worker');
    const { startCartAbandonmentWorker, scheduleCartAbandonmentJob, removeCartAbandonmentSchedule } = await import('./cart-abandonment-worker');
    const { startBrowseAbandonmentWorker, scheduleBrowseAbandonmentJob, removeBrowseAbandonmentSchedule, } = await import('./browse-abandonment-worker');
    const { startPredictionWorker, schedulePredictionJob, removePredictionSchedule } = await import('./prediction-worker');
    const { startBackupWorker, scheduleBackupJob, removeBackupSchedule } = await import('./backup-worker');
    const { startUpdateWorker } = await import('./update-worker');
    const { getRegisteredSchedules } = await import('./scheduler');
    const prisma = (await import('../prisma')).default;
    startAllWorkers();
    startFlowWorkers();
    startAutoTuneWorker();
    await scheduleAutoTuneJob('0 */6 * * *');
    startAuditCleanupWorker();
    await scheduleAuditCleanupJob('0 3 * * *');
    startCartAbandonmentWorker();
    const settings = await prisma.settings.findFirst();
    if (settings?.cartAbandonmentEnabled) {
        const cronPattern = settings.cartAbandonmentCheckCron || '*/15 * * * *';
        await scheduleCartAbandonmentJob(cronPattern);
        console.log(`[BullMQ] Cart abandonment detection enabled with cron: ${cronPattern}`);
    }
    else {
        await removeCartAbandonmentSchedule();
        console.log('[BullMQ] Cart abandonment detection disabled');
    }
    startBrowseAbandonmentWorker();
    if (settings?.browseAbandonmentEnabled) {
        const cronPattern = settings.browseAbandonmentCheckCron || '*/30 * * * *';
        await scheduleBrowseAbandonmentJob(cronPattern);
        console.log(`[BullMQ] Browse abandonment detection enabled with cron: ${cronPattern}`);
    }
    else {
        await removeBrowseAbandonmentSchedule();
        console.log('[BullMQ] Browse abandonment detection disabled');
    }
    startPredictionWorker();
    if (settings?.predictionsEnabled) {
        const cronPattern = settings.predictionCalculationCron || '0 2 * * *';
        await schedulePredictionJob(cronPattern);
        console.log(`[BullMQ] Prediction calculation enabled with cron: ${cronPattern}`);
    }
    else {
        await removePredictionSchedule();
        console.log('[BullMQ] Prediction calculation disabled');
    }
    startBackupWorker();
    if (settings?.backupEnabled) {
        await scheduleBackupJob();
        console.log(`[BullMQ] Database backup enabled at ${settings.backupScheduleTime}`);
    }
    else {
        await removeBackupSchedule();
        console.log('[BullMQ] Database backup disabled');
    }
    startUpdateWorker();
    console.log('[BullMQ] System update worker enabled');
    const schedules = await getRegisteredSchedules();
    console.log(`[BullMQ] Initialized: ${schedules.length} campaign schedules active in Redis`);
}
export async function shutdownBullMQ() {
    const { stopAllWorkers } = await import('./workers');
    const { stopFlowWorkers } = await import('./flow-workers');
    const { closeAllQueues } = await import('./queues');
    const { stopAutoTuneWorker } = await import('./auto-tune-worker');
    const { stopAuditCleanupWorker } = await import('./audit-cleanup-worker');
    const { stopCartAbandonmentWorker } = await import('./cart-abandonment-worker');
    const { stopBrowseAbandonmentWorker } = await import('./browse-abandonment-worker');
    const { stopPredictionWorker } = await import('./prediction-worker');
    const { stopBackupWorker } = await import('./backup-worker');
    const { stopUpdateWorker } = await import('./update-worker');
    console.log('[BullMQ] Shutting down...');
    await stopAllWorkers();
    await stopFlowWorkers();
    await stopAutoTuneWorker();
    await stopAuditCleanupWorker();
    await stopCartAbandonmentWorker();
    await stopBrowseAbandonmentWorker();
    await stopPredictionWorker();
    await stopBackupWorker();
    await stopUpdateWorker();
    await closeAllQueues();
    console.log('[BullMQ] Shutdown complete');
}
