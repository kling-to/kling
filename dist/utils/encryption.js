import crypto from 'crypto';
import { logger } from './logger.js';
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
function getEncryptionKey() {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
        throw new Error('ENCRYPTION_KEY environment variable is required for encryption');
    }
    const keyBuffer = Buffer.from(key, 'hex');
    if (keyBuffer.length !== KEY_LENGTH) {
        throw new Error(`ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (64 hex characters)`);
    }
    return keyBuffer;
}
function getOldEncryptionKey() {
    const key = process.env.ENCRYPTION_KEY_OLD;
    if (!key)
        return null;
    const keyBuffer = Buffer.from(key, 'hex');
    if (keyBuffer.length !== KEY_LENGTH) {
        logger.warn('ENCRYPTION_KEY_OLD is invalid, ignoring');
        return null;
    }
    return keyBuffer;
}
export function encrypt(plaintext) {
    if (!plaintext)
        return '';
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}
export function decrypt(encryptedText) {
    if (!encryptedText)
        return '';
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
        return encryptedText;
    }
    const [ivHex, authTagHex, encrypted] = parts;
    try {
        return decryptWithKey(getEncryptionKey(), ivHex, authTagHex, encrypted);
    }
    catch (err) {
        const oldKey = getOldEncryptionKey();
        if (oldKey) {
            logger.info('Attempting decryption with old key (key rotation in progress)');
            return decryptWithKey(oldKey, ivHex, authTagHex, encrypted);
        }
        throw err;
    }
}
function decryptWithKey(key, ivHex, authTagHex, encrypted) {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
export function generateEncryptionKey() {
    return crypto.randomBytes(KEY_LENGTH).toString('hex');
}
export function isEncrypted(value) {
    if (!value)
        return false;
    const parts = value.split(':');
    return parts.length === 3 && parts.every((part) => /^[0-9a-f]+$/i.test(part));
}
export function maskSecret(secret) {
    if (!secret || secret.length <= 8) {
        return '*'.repeat(secret?.length || 8);
    }
    return `${secret.slice(0, 4)}${'*'.repeat(secret.length - 8)}${secret.slice(-4)}`;
}
export function isEncryptionConfigured() {
    return !!process.env.ENCRYPTION_KEY;
}
