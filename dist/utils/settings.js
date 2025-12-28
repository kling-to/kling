/**
 * Settings Utilities
 *
 * Provides helpers for accessing settings with decrypted credentials.
 * NEVER expose decrypted settings in API responses.
 */
import prisma from './prisma.js';
import { decrypt, isEncrypted, isEncryptionConfigured } from './encryption.js';
import { getCache, setCache, deleteCache, CACHE_KEYS, CACHE_TTL } from './cache.js';
import { logger } from './logger.js';
import createHttpError from 'http-errors';
// Sensitive fields that should be encrypted
export const SENSITIVE_FIELDS = [
    'resendApiKey',
    'resendWebhookSecret',
    'twilioAuthToken',
    'openaiApiKey',
    'fcmPrivateKey',
    'backupS3AccessKeyId',
    'backupS3SecretAccessKey',
];
/**
 * Get settings with decrypted credentials (for internal use only)
 * NEVER expose this directly to API responses
 */
export async function getDecryptedSettings() {
    // Try cache first
    const cached = await getCache(CACHE_KEYS.SETTINGS);
    if (cached) {
        logger.debug('Using cached settings', { component: 'Settings' });
        return cached;
    }
    const settings = await prisma.settings.findFirst();
    if (!settings) {
        throw createHttpError(500, 'Settings not found');
    }
    // Decrypt sensitive fields if encryption is configured
    if (isEncryptionConfigured()) {
        const decrypted = { ...settings };
        for (const field of SENSITIVE_FIELDS) {
            const value = settings[field];
            if (value && typeof value === 'string' && isEncrypted(value)) {
                try {
                    decrypted[field] = decrypt(value);
                }
                catch (err) {
                    logger.error('Failed to decrypt setting', {
                        component: 'Settings',
                        field,
                        error: err.message,
                    });
                    // Keep encrypted value on decryption failure
                }
            }
        }
        // Cache decrypted settings
        await setCache(CACHE_KEYS.SETTINGS, decrypted, CACHE_TTL.SETTINGS);
        return decrypted;
    }
    // No encryption configured, return as-is
    await setCache(CACHE_KEYS.SETTINGS, settings, CACHE_TTL.SETTINGS);
    return settings;
}
/**
 * Invalidate settings cache (call after updates)
 */
export async function invalidateSettingsCache() {
    await deleteCache(CACHE_KEYS.SETTINGS);
    logger.debug('Settings cache invalidated', { component: 'Settings' });
}
/**
 * Get a specific decrypted credential
 */
export async function getDecryptedCredential(field) {
    const settings = await getDecryptedSettings();
    return settings[field] || null;
}
