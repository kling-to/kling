import prisma from './prisma.js';
import { decrypt, isEncrypted, isEncryptionConfigured } from './encryption.js';
import { getCache, setCache, deleteCache, CACHE_KEYS, CACHE_TTL } from './cache.js';
import { logger } from './logger.js';
import createHttpError from 'http-errors';
export const SENSITIVE_FIELDS = [
    'resendApiKey',
    'resendWebhookSecret',
    'smtpPassword',
    'twilioAuthToken',
    'openaiApiKey',
    'fcmPrivateKey',
    'backupS3AccessKeyId',
    'backupS3SecretAccessKey',
];
export async function getDecryptedSettings() {
    const cached = await getCache(CACHE_KEYS.SETTINGS);
    if (cached) {
        logger.debug('Using cached settings', { component: 'Settings' });
        return cached;
    }
    const settings = await prisma.settings.findFirst();
    if (!settings) {
        throw createHttpError(500, 'Settings not found');
    }
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
                }
            }
        }
        await setCache(CACHE_KEYS.SETTINGS, decrypted, CACHE_TTL.SETTINGS);
        return decrypted;
    }
    await setCache(CACHE_KEYS.SETTINGS, settings, CACHE_TTL.SETTINGS);
    return settings;
}
export async function invalidateSettingsCache() {
    await deleteCache(CACHE_KEYS.SETTINGS);
    logger.debug('Settings cache invalidated', { component: 'Settings' });
}
export async function getDecryptedCredential(field) {
    const settings = await getDecryptedSettings();
    return settings[field] || null;
}
