import dotenv from 'dotenv';
dotenv.config();
import { createServer } from 'express-zod-api';
import config from './config';
import routing from './routing';
import { initializeProviders } from './providers';
import { initializeBullMQ, shutdownBullMQ } from './utils/bullmq';
import { initializeIntegrations } from './integrations';
// Initialize message providers
initializeProviders().catch((err) => {
    console.error('[Providers] Failed to initialize:', err);
});
// Initialize BullMQ workers and sync schedules
initializeBullMQ().catch((err) => {
    console.error('[BullMQ] Failed to initialize:', err);
});
// Initialize e-commerce platform integrations
initializeIntegrations();
// Start server
createServer(config, routing);
// Graceful shutdown handling
const shutdown = async (signal) => {
    console.log(`\n[Server] Received ${signal}, shutting down gracefully...`);
    try {
        await shutdownBullMQ();
        console.log('[Server] Shutdown complete');
        process.exit(0);
    }
    catch (err) {
        console.error('[Server] Error during shutdown:', err);
        process.exit(1);
    }
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
