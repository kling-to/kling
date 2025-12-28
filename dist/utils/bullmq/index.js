/**
 * BullMQ Module Entry Point
 *
 * Exports all BullMQ utilities for campaign scheduling and execution.
 */
// Connection utilities
export { getRedisConnection, QUEUE_NAMES, getWorkerConcurrency } from './connection';
// Queue utilities
export { getCampaignQueue, getCustomerQueue, getDLQ, getFlowEnrollmentQueue, getFlowStepQueue, getQueueMetrics, closeAllQueues, } from './queues';
// Scheduler utilities
export { createCampaignSchedule, updateCampaignSchedule, removeCampaignSchedule, removeScheduleByKey, pauseCampaignSchedule, resumeCampaignSchedule, triggerCampaignNow, getScheduleInfo, getScheduleInfoByKey, getRegisteredSchedules, } from './scheduler';
// Worker utilities
export { startCampaignWorker, startCustomerWorker, startAllWorkers, stopAllWorkers, areWorkersRunning, } from './workers';
// Flow worker utilities
export { startFlowEnrollmentWorker, startFlowStepWorker, startFlowWorkers, stopFlowWorkers, areFlowWorkersRunning, } from './flow-workers';
// Auto-tune utilities
export { getAutoTuneQueue, startAutoTuneWorker, stopAutoTuneWorker, scheduleAutoTuneJob, triggerAutoTuneNow, isAutoTuneWorkerRunning, } from './auto-tune-worker';
// Audit cleanup utilities
export { getAuditCleanupQueue, startAuditCleanupWorker, stopAuditCleanupWorker, scheduleAuditCleanupJob, triggerAuditCleanupNow, isAuditCleanupWorkerRunning, getAuditCleanupScheduleInfo, } from './audit-cleanup-worker';
// Cart abandonment detection utilities
export { getCartAbandonmentQueue, startCartAbandonmentWorker, stopCartAbandonmentWorker, scheduleCartAbandonmentJob, removeCartAbandonmentSchedule, triggerCartAbandonmentNow, isCartAbandonmentWorkerRunning, getCartAbandonmentScheduleInfo, } from './cart-abandonment-worker';
// Browse abandonment detection utilities
export { getBrowseAbandonmentQueue, startBrowseAbandonmentWorker, stopBrowseAbandonmentWorker, scheduleBrowseAbandonmentJob, removeBrowseAbandonmentSchedule, triggerBrowseAbandonmentNow, isBrowseAbandonmentWorkerRunning, getBrowseAbandonmentScheduleInfo, } from './browse-abandonment-worker';
// Prediction calculation utilities
export { getPredictionQueue, schedulePredictionJob, removePredictionSchedule, triggerPredictionCalculation, startPredictionWorker, stopPredictionWorker, getPredictionJobStatus, initializePredictionWorker, } from './prediction-worker';
// Database backup utilities
export { getBackupQueue, startBackupWorker, stopBackupWorker, scheduleBackupJob, removeBackupSchedule, triggerBackupNow, isBackupWorkerRunning, getBackupScheduleInfo, } from './backup-worker';
// System update utilities
export { getUpdateQueue, startUpdateWorker, stopUpdateWorker, queueUpdateJob, getActiveUpdateJob, isUpdateWorkerRunning, } from './update-worker';
/**
 * Initialize BullMQ - call this on application startup
 *
 * Note: No sync needed! BullMQ/Redis is the source of truth for schedules.
 * Campaign schedules persist in Redis and workers pick them up automatically.
 */
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
    // Start workers - they'll pick up any existing schedules from Redis
    startAllWorkers();
    // Start flow workers for event-driven automation
    startFlowWorkers();
    // Start auto-tune worker and schedule job (every 6 hours)
    startAutoTuneWorker();
    await scheduleAutoTuneJob('0 */6 * * *');
    // Start audit cleanup worker and schedule job (daily at 3:00 AM)
    startAuditCleanupWorker();
    await scheduleAuditCleanupJob('0 3 * * *');
    // Start cart abandonment worker (conditionally based on settings)
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
    // Start browse abandonment worker (conditionally based on settings)
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
    // Start prediction worker (conditionally based on settings)
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
    // Start backup worker (conditionally based on settings)
    startBackupWorker();
    if (settings?.backupEnabled) {
        await scheduleBackupJob();
        console.log(`[BullMQ] Database backup enabled at ${settings.backupScheduleTime}`);
    }
    else {
        await removeBackupSchedule();
        console.log('[BullMQ] Database backup disabled');
    }
    // Start update worker (always enabled for git-based installations)
    startUpdateWorker();
    console.log('[BullMQ] System update worker enabled');
    // Log current state (no sync needed)
    const schedules = await getRegisteredSchedules();
    console.log(`[BullMQ] Initialized: ${schedules.length} campaign schedules active in Redis`);
}
/**
 * Shutdown BullMQ gracefully - call this on application shutdown
 */
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
    // Stop workers first (drain in-progress jobs)
    await stopAllWorkers();
    // Stop flow workers
    await stopFlowWorkers();
    // Stop auto-tune worker
    await stopAutoTuneWorker();
    // Stop audit cleanup worker
    await stopAuditCleanupWorker();
    // Stop cart abandonment worker
    await stopCartAbandonmentWorker();
    // Stop browse abandonment worker
    await stopBrowseAbandonmentWorker();
    // Stop prediction worker
    await stopPredictionWorker();
    // Stop backup worker
    await stopBackupWorker();
    // Stop update worker
    await stopUpdateWorker();
    // Close queue connections
    await closeAllQueues();
    console.log('[BullMQ] Shutdown complete');
}
