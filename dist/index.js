import dotenv from 'dotenv';
dotenv.config();
import { createServer } from 'express-zod-api';
import config from './config';
import routing from './routing';
import { initializeProviders } from './providers';
import { initializeBullMQ, shutdownBullMQ } from './utils/bullmq';
import { initializeIntegrations } from './integrations';
initializeProviders().catch((err) => {
    console.error('[Providers] Failed to initialize:', err);
});
initializeBullMQ().catch((err) => {
    console.error('[BullMQ] Failed to initialize:', err);
});
initializeIntegrations();
createServer(config, routing);
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
