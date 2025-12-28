import { z } from 'zod';
import { createAuthRoleFactory, authFactory, publicFactory } from '../factories';
import prisma from '../utils/prisma';
import createHttpError from 'http-errors';
import timezonesModule from 'timezones-list';
// Handle both ESM and CJS module formats
const timezones = timezonesModule.default || timezonesModule;
import { createAuditLog, AuditActions } from '../utils/audit';
import { reinitializeProviders } from '../providers';
import { scheduleCartAbandonmentJob, removeCartAbandonmentSchedule, } from '../utils/bullmq/cart-abandonment-worker';
import { scheduleBrowseAbandonmentJob, removeBrowseAbandonmentSchedule, } from '../utils/bullmq/browse-abandonment-worker';
import { schedulePredictionJob, removePredictionSchedule } from '../utils/bullmq/prediction-worker';
import { scheduleBackupJob, removeBackupSchedule } from '../utils/bullmq/backup-worker';
import { encrypt, isEncrypted, isEncryptionConfigured, maskSecret } from '../utils/encryption.js';
import { invalidateSettingsCache } from '../utils/settings.js';
import { logger } from '../utils/logger.js';
/**
 * Encrypt sensitive field if encryption is configured
 * Skips if already encrypted or if encryption is not configured
 */
function encryptIfNeeded(value) {
    if (!value)
        return null;
    if (!isEncryptionConfigured())
        return value;
    if (isEncrypted(value))
        return value;
    return encrypt(value);
}
// Get the default settings or create them if they don't exist
async function getOrCreateSettings() {
    let settings = await prisma.settings.findFirst();
    if (!settings) {
        settings = await prisma.settings.create({
            data: {
                name: 'Kling',
                timezone: 'UTC',
            },
        });
    }
    return settings;
}
// Signup mode enum for validation
const signupModeSchema = z.enum(['open', 'domain_restricted', 'disabled']);
// Get settings endpoint
export const getSettingsEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'Get Settings',
    description: 'Returns the current system settings.',
    tag: 'Settings',
    input: z.object({}),
    output: z.object({
        id: z.string(),
        name: z.string(),
        timezone: z.string(),
        defaultMessageChannel: z.enum(['email', 'sms', 'whatsapp', 'rcs', 'push']),
        dailyMessageLimit: z.number(),
        monthlyMessageLimit: z.number(),
        quietHoursStart: z.string().nullable(),
        quietHoursEnd: z.string().nullable(),
        quietHoursEnabled: z.boolean(),
        quietHoursDays: z.array(z.number()),
        fallbackEnabled: z.boolean(),
        fallbackOrder: z.array(z.enum(['email', 'sms', 'whatsapp', 'rcs', 'push'])),
        fallbackMaxAttempts: z.number(),
        signupMode: signupModeSchema,
        allowedSignupDomains: z.array(z.string()),
        auditLogRetentionDays: z.number(),
        // Email provider settings
        useMockEmail: z.boolean(),
        resendApiKey: z.string().nullable(),
        resendFromAddress: z.string().nullable(),
        resendFromName: z.string().nullable(),
        resendWebhookSecret: z.string().nullable(),
        // SMS provider settings
        useMockSms: z.boolean(),
        twilioAccountSid: z.string().nullable(),
        twilioAuthToken: z.string().nullable(),
        twilioFromNumber: z.string().nullable(),
        twilioMessagingServiceSid: z.string().nullable(),
        // WhatsApp provider settings (via Twilio)
        useMockWhatsApp: z.boolean(),
        twilioWhatsAppNumber: z.string().nullable(),
        // RCS provider settings (via Twilio)
        useMockRcs: z.boolean(),
        twilioRcsAgentId: z.string().nullable(),
        // Push provider settings (FCM)
        useMockPush: z.boolean(),
        fcmProjectId: z.string().nullable(),
        fcmPrivateKey: z.string().nullable(),
        fcmClientEmail: z.string().nullable(),
        // AI provider settings
        openaiApiKey: z.string().nullable(),
        // Cart abandonment detection settings
        cartAbandonmentEnabled: z.boolean(),
        cartAbandonmentTimeoutMins: z.number(),
        cartAbandonmentCheckCron: z.string(),
        // Browse abandonment detection settings
        browseAbandonmentEnabled: z.boolean(),
        browseAbandonmentTimeoutMins: z.number(),
        browseAbandonmentCheckCron: z.string(),
        // Revenue attribution settings
        attributionEnabled: z.boolean(),
        attributionWindowDays: z.number(),
        attributionModel: z.string(),
        // Prediction settings
        predictionsEnabled: z.boolean(),
        predictionCalculationCron: z.string(),
        predictionMinOrders: z.number(),
        predictionMinMessages: z.number(),
        predictionLookbackDays: z.number(),
        // Database backup settings
        backupEnabled: z.boolean(),
        backupScheduleTime: z.string(),
        backupRetentionDays: z.number(),
        backupS3Bucket: z.string().nullable(),
        backupS3Region: z.string(),
        backupS3AccessKeyId: z.string().nullable(),
        backupS3SecretAccessKey: z.string().nullable(),
        backupS3Endpoint: z.string().nullable(),
        createdAt: z.date(),
        updatedAt: z.date(),
    }),
    handler: async () => {
        const settings = await getOrCreateSettings();
        return {
            id: settings.id,
            name: settings.name,
            timezone: settings.timezone,
            defaultMessageChannel: settings.defaultMessageChannel,
            dailyMessageLimit: settings.dailyMessageLimit,
            monthlyMessageLimit: settings.monthlyMessageLimit,
            quietHoursStart: settings.quietHoursStart,
            quietHoursEnd: settings.quietHoursEnd,
            quietHoursEnabled: settings.quietHoursEnabled,
            quietHoursDays: settings.quietHoursDays,
            fallbackEnabled: settings.fallbackEnabled,
            fallbackOrder: settings.fallbackOrder,
            fallbackMaxAttempts: settings.fallbackMaxAttempts,
            signupMode: settings.signupMode,
            allowedSignupDomains: settings.allowedSignupDomains,
            auditLogRetentionDays: settings.auditLogRetentionDays,
            // Email provider settings (mask API key for security)
            useMockEmail: settings.useMockEmail,
            resendApiKey: settings.resendApiKey ? maskSecret(settings.resendApiKey) : null,
            resendFromAddress: settings.resendFromAddress,
            resendFromName: settings.resendFromName,
            resendWebhookSecret: settings.resendWebhookSecret
                ? maskSecret(settings.resendWebhookSecret)
                : null,
            // SMS provider settings (mask secrets for security)
            useMockSms: settings.useMockSms,
            twilioAccountSid: settings.twilioAccountSid,
            twilioAuthToken: settings.twilioAuthToken ? maskSecret(settings.twilioAuthToken) : null,
            twilioFromNumber: settings.twilioFromNumber,
            twilioMessagingServiceSid: settings.twilioMessagingServiceSid,
            // WhatsApp provider settings (via Twilio)
            useMockWhatsApp: settings.useMockWhatsApp,
            twilioWhatsAppNumber: settings.twilioWhatsAppNumber,
            // RCS provider settings (via Twilio)
            useMockRcs: settings.useMockRcs,
            twilioRcsAgentId: settings.twilioRcsAgentId,
            // Push provider settings (FCM - mask private key for security)
            useMockPush: settings.useMockPush,
            fcmProjectId: settings.fcmProjectId,
            fcmPrivateKey: settings.fcmPrivateKey ? maskSecret(settings.fcmPrivateKey) : null,
            fcmClientEmail: settings.fcmClientEmail,
            // AI provider settings (mask for security)
            openaiApiKey: settings.openaiApiKey ? maskSecret(settings.openaiApiKey) : null,
            // Cart abandonment detection settings
            cartAbandonmentEnabled: settings.cartAbandonmentEnabled,
            cartAbandonmentTimeoutMins: settings.cartAbandonmentTimeoutMins,
            cartAbandonmentCheckCron: settings.cartAbandonmentCheckCron,
            // Browse abandonment detection settings
            browseAbandonmentEnabled: settings.browseAbandonmentEnabled,
            browseAbandonmentTimeoutMins: settings.browseAbandonmentTimeoutMins,
            browseAbandonmentCheckCron: settings.browseAbandonmentCheckCron,
            // Revenue attribution settings
            attributionEnabled: settings.attributionEnabled,
            attributionWindowDays: settings.attributionWindowDays,
            attributionModel: settings.attributionModel,
            // Prediction settings
            predictionsEnabled: settings.predictionsEnabled,
            predictionCalculationCron: settings.predictionCalculationCron,
            predictionMinOrders: settings.predictionMinOrders,
            predictionMinMessages: settings.predictionMinMessages,
            predictionLookbackDays: settings.predictionLookbackDays,
            // Database backup settings (mask secrets)
            backupEnabled: settings.backupEnabled,
            backupScheduleTime: settings.backupScheduleTime,
            backupRetentionDays: settings.backupRetentionDays,
            backupS3Bucket: settings.backupS3Bucket,
            backupS3Region: settings.backupS3Region,
            backupS3AccessKeyId: settings.backupS3AccessKeyId
                ? maskSecret(settings.backupS3AccessKeyId)
                : null,
            backupS3SecretAccessKey: settings.backupS3SecretAccessKey
                ? maskSecret(settings.backupS3SecretAccessKey)
                : null,
            backupS3Endpoint: settings.backupS3Endpoint,
            createdAt: settings.createdAt,
            updatedAt: settings.updatedAt,
        };
    },
});
// Update settings endpoint (admin only)
export const updateSettingsEndpoint = createAuthRoleFactory('admin').build({
    method: 'patch',
    shortDescription: 'Update Settings',
    description: 'Updates system settings. Only admins can modify settings.',
    tag: 'Settings',
    input: z.object({
        name: z.string().optional(),
        timezone: z.string().optional(),
        defaultMessageChannel: z.enum(['email', 'sms', 'whatsapp', 'rcs', 'push']).optional(),
        dailyMessageLimit: z.number().int().positive().optional(),
        monthlyMessageLimit: z.number().int().positive().optional(),
        quietHoursStart: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullable()
            .optional(),
        quietHoursEnd: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullable()
            .optional(),
        quietHoursEnabled: z.boolean().optional(),
        quietHoursDays: z.array(z.number().int().min(0).max(6)).optional(),
        fallbackEnabled: z.boolean().optional(),
        fallbackOrder: z.array(z.enum(['email', 'sms', 'whatsapp', 'rcs', 'push'])).optional(),
        fallbackMaxAttempts: z.number().int().min(1).max(5).optional(),
        signupMode: signupModeSchema.optional(),
        allowedSignupDomains: z.array(z.string().min(1)).optional(),
        auditLogRetentionDays: z.number().int().min(1).optional(), // Min 1 day (hard limit)
        // Email provider settings
        useMockEmail: z.boolean().optional(),
        resendApiKey: z.string().nullable().optional(),
        resendFromAddress: z.string().email().nullable().optional(),
        resendFromName: z.string().nullable().optional(),
        resendWebhookSecret: z.string().nullable().optional(),
        // SMS provider settings
        useMockSms: z.boolean().optional(),
        twilioAccountSid: z.string().nullable().optional(),
        twilioAuthToken: z.string().nullable().optional(),
        twilioFromNumber: z
            .string()
            .regex(/^\+[1-9]\d{1,14}$/, 'Must be E.164 format (e.g., +15551234567)')
            .nullable()
            .optional(),
        twilioMessagingServiceSid: z.string().nullable().optional(),
        // WhatsApp provider settings (via Twilio)
        useMockWhatsApp: z.boolean().optional(),
        twilioWhatsAppNumber: z
            .string()
            .regex(/^\+[1-9]\d{1,14}$/, 'Must be E.164 format (e.g., +15551234567)')
            .nullable()
            .optional(),
        // RCS provider settings (via Twilio)
        useMockRcs: z.boolean().optional(),
        twilioRcsAgentId: z.string().nullable().optional(),
        // Push provider settings (FCM)
        useMockPush: z.boolean().optional(),
        fcmProjectId: z.string().nullable().optional(),
        fcmPrivateKey: z.string().nullable().optional(),
        fcmClientEmail: z.string().email().nullable().optional(),
        // AI provider settings
        openaiApiKey: z.string().nullable().optional(),
        // Cart abandonment detection settings
        cartAbandonmentEnabled: z.boolean().optional(),
        cartAbandonmentTimeoutMins: z.number().int().min(1).max(1440).optional(), // 1 min to 24 hours
        cartAbandonmentCheckCron: z.string().optional(),
        // Browse abandonment detection settings
        browseAbandonmentEnabled: z.boolean().optional(),
        browseAbandonmentTimeoutMins: z.number().int().min(1).max(1440).optional(), // 1 min to 24 hours
        browseAbandonmentCheckCron: z.string().optional(),
        // Revenue attribution settings
        attributionEnabled: z.boolean().optional(),
        attributionWindowDays: z.number().int().min(1).max(90).optional(),
        attributionModel: z.enum(['last_touch', 'first_touch', 'linear']).optional(),
        // Prediction settings
        predictionsEnabled: z.boolean().optional(),
        predictionCalculationCron: z.string().optional(),
        predictionMinOrders: z.number().int().min(1).max(100).optional(),
        predictionMinMessages: z.number().int().min(1).max(100).optional(),
        predictionLookbackDays: z.number().int().min(1).max(365).optional(),
        // Database backup settings
        backupEnabled: z.boolean().optional(),
        backupScheduleTime: z
            .string()
            .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
            .optional(), // HH:MM format
        backupRetentionDays: z.number().int().min(1).max(365).optional(),
        backupS3Bucket: z.string().nullable().optional(),
        backupS3Region: z.string().optional(),
        backupS3AccessKeyId: z.string().nullable().optional(),
        backupS3SecretAccessKey: z.string().nullable().optional(),
        backupS3Endpoint: z.string().nullable().optional(),
    }),
    output: z.object({
        id: z.string(),
        name: z.string(),
        timezone: z.string(),
        defaultMessageChannel: z.enum(['email', 'sms', 'whatsapp', 'rcs', 'push']),
        dailyMessageLimit: z.number(),
        monthlyMessageLimit: z.number(),
        quietHoursStart: z.string().nullable(),
        quietHoursEnd: z.string().nullable(),
        quietHoursEnabled: z.boolean(),
        quietHoursDays: z.array(z.number()),
        fallbackEnabled: z.boolean(),
        fallbackOrder: z.array(z.enum(['email', 'sms', 'whatsapp', 'rcs', 'push'])),
        fallbackMaxAttempts: z.number(),
        signupMode: signupModeSchema,
        allowedSignupDomains: z.array(z.string()),
        auditLogRetentionDays: z.number(),
        // Email provider settings
        useMockEmail: z.boolean(),
        resendApiKey: z.string().nullable(),
        resendFromAddress: z.string().nullable(),
        resendFromName: z.string().nullable(),
        resendWebhookSecret: z.string().nullable(),
        // SMS provider settings
        useMockSms: z.boolean(),
        twilioAccountSid: z.string().nullable(),
        twilioAuthToken: z.string().nullable(),
        twilioFromNumber: z.string().nullable(),
        twilioMessagingServiceSid: z.string().nullable(),
        // WhatsApp provider settings (via Twilio)
        useMockWhatsApp: z.boolean(),
        twilioWhatsAppNumber: z.string().nullable(),
        // RCS provider settings (via Twilio)
        useMockRcs: z.boolean(),
        twilioRcsAgentId: z.string().nullable(),
        // Push provider settings (FCM)
        useMockPush: z.boolean(),
        fcmProjectId: z.string().nullable(),
        fcmPrivateKey: z.string().nullable(),
        fcmClientEmail: z.string().nullable(),
        // AI provider settings
        openaiApiKey: z.string().nullable(),
        // Cart abandonment detection settings
        cartAbandonmentEnabled: z.boolean(),
        cartAbandonmentTimeoutMins: z.number(),
        cartAbandonmentCheckCron: z.string(),
        // Browse abandonment detection settings
        browseAbandonmentEnabled: z.boolean(),
        browseAbandonmentTimeoutMins: z.number(),
        browseAbandonmentCheckCron: z.string(),
        // Revenue attribution settings
        attributionEnabled: z.boolean(),
        attributionWindowDays: z.number(),
        attributionModel: z.string(),
        // Prediction settings
        predictionsEnabled: z.boolean(),
        predictionCalculationCron: z.string(),
        predictionMinOrders: z.number(),
        predictionMinMessages: z.number(),
        predictionLookbackDays: z.number(),
        // Database backup settings
        backupEnabled: z.boolean(),
        backupScheduleTime: z.string(),
        backupRetentionDays: z.number(),
        backupS3Bucket: z.string().nullable(),
        backupS3Region: z.string(),
        backupS3AccessKeyId: z.string().nullable(),
        backupS3SecretAccessKey: z.string().nullable(),
        backupS3Endpoint: z.string().nullable(),
        updatedAt: z.date(),
    }),
    handler: async ({ input, ctx }) => {
        // Validate timezone if provided
        if (input.timezone) {
            const validTimezone = timezones.find((tz) => tz.tzCode === input.timezone);
            if (!validTimezone) {
                throw createHttpError(400, `Invalid timezone: ${input.timezone}`);
            }
        }
        // Validate domain_restricted mode requires at least one domain
        if (input.signupMode === 'domain_restricted') {
            const existingSettings = await getOrCreateSettings();
            const domains = input.allowedSignupDomains ?? existingSettings.allowedSignupDomains;
            if (!domains || domains.length === 0) {
                throw createHttpError(400, 'At least one domain is required when signup mode is domain_restricted');
            }
        }
        // Get or create settings
        const existingSettings = await getOrCreateSettings();
        // Update settings
        const settings = await prisma.settings.update({
            where: { id: existingSettings.id },
            data: {
                ...(input.name !== undefined && { name: input.name }),
                ...(input.timezone !== undefined && { timezone: input.timezone }),
                ...(input.defaultMessageChannel !== undefined && {
                    defaultMessageChannel: input.defaultMessageChannel,
                }),
                ...(input.dailyMessageLimit !== undefined && {
                    dailyMessageLimit: input.dailyMessageLimit,
                }),
                ...(input.monthlyMessageLimit !== undefined && {
                    monthlyMessageLimit: input.monthlyMessageLimit,
                }),
                ...(input.quietHoursStart !== undefined && {
                    quietHoursStart: input.quietHoursStart,
                }),
                ...(input.quietHoursEnd !== undefined && { quietHoursEnd: input.quietHoursEnd }),
                ...(input.quietHoursEnabled !== undefined && {
                    quietHoursEnabled: input.quietHoursEnabled,
                }),
                ...(input.quietHoursDays !== undefined && { quietHoursDays: input.quietHoursDays }),
                ...(input.fallbackEnabled !== undefined && {
                    fallbackEnabled: input.fallbackEnabled,
                }),
                ...(input.fallbackOrder !== undefined && { fallbackOrder: input.fallbackOrder }),
                ...(input.fallbackMaxAttempts !== undefined && {
                    fallbackMaxAttempts: input.fallbackMaxAttempts,
                }),
                ...(input.signupMode !== undefined && { signupMode: input.signupMode }),
                ...(input.allowedSignupDomains !== undefined && {
                    allowedSignupDomains: input.allowedSignupDomains,
                }),
                ...(input.auditLogRetentionDays !== undefined && {
                    auditLogRetentionDays: input.auditLogRetentionDays,
                }),
                // Email provider settings (encrypt sensitive fields)
                ...(input.useMockEmail !== undefined && { useMockEmail: input.useMockEmail }),
                ...(input.resendApiKey !== undefined && { resendApiKey: encryptIfNeeded(input.resendApiKey) }),
                ...(input.resendFromAddress !== undefined && {
                    resendFromAddress: input.resendFromAddress,
                }),
                ...(input.resendFromName !== undefined && { resendFromName: input.resendFromName }),
                ...(input.resendWebhookSecret !== undefined && {
                    resendWebhookSecret: encryptIfNeeded(input.resendWebhookSecret),
                }),
                // SMS provider settings (encrypt sensitive fields)
                ...(input.useMockSms !== undefined && { useMockSms: input.useMockSms }),
                ...(input.twilioAccountSid !== undefined && { twilioAccountSid: input.twilioAccountSid }),
                ...(input.twilioAuthToken !== undefined && { twilioAuthToken: encryptIfNeeded(input.twilioAuthToken) }),
                ...(input.twilioFromNumber !== undefined && { twilioFromNumber: input.twilioFromNumber }),
                ...(input.twilioMessagingServiceSid !== undefined && {
                    twilioMessagingServiceSid: input.twilioMessagingServiceSid,
                }),
                // WhatsApp provider settings
                ...(input.useMockWhatsApp !== undefined && { useMockWhatsApp: input.useMockWhatsApp }),
                ...(input.twilioWhatsAppNumber !== undefined && {
                    twilioWhatsAppNumber: input.twilioWhatsAppNumber,
                }),
                // RCS provider settings
                ...(input.useMockRcs !== undefined && { useMockRcs: input.useMockRcs }),
                ...(input.twilioRcsAgentId !== undefined && { twilioRcsAgentId: input.twilioRcsAgentId }),
                // Push provider settings (FCM - encrypt sensitive fields)
                ...(input.useMockPush !== undefined && { useMockPush: input.useMockPush }),
                ...(input.fcmProjectId !== undefined && { fcmProjectId: input.fcmProjectId }),
                ...(input.fcmPrivateKey !== undefined && { fcmPrivateKey: encryptIfNeeded(input.fcmPrivateKey) }),
                ...(input.fcmClientEmail !== undefined && { fcmClientEmail: input.fcmClientEmail }),
                // AI provider settings (encrypt sensitive fields)
                ...(input.openaiApiKey !== undefined && { openaiApiKey: encryptIfNeeded(input.openaiApiKey) }),
                // Cart abandonment detection settings
                ...(input.cartAbandonmentEnabled !== undefined && {
                    cartAbandonmentEnabled: input.cartAbandonmentEnabled,
                }),
                ...(input.cartAbandonmentTimeoutMins !== undefined && {
                    cartAbandonmentTimeoutMins: input.cartAbandonmentTimeoutMins,
                }),
                ...(input.cartAbandonmentCheckCron !== undefined && {
                    cartAbandonmentCheckCron: input.cartAbandonmentCheckCron,
                }),
                // Browse abandonment detection settings
                ...(input.browseAbandonmentEnabled !== undefined && {
                    browseAbandonmentEnabled: input.browseAbandonmentEnabled,
                }),
                ...(input.browseAbandonmentTimeoutMins !== undefined && {
                    browseAbandonmentTimeoutMins: input.browseAbandonmentTimeoutMins,
                }),
                ...(input.browseAbandonmentCheckCron !== undefined && {
                    browseAbandonmentCheckCron: input.browseAbandonmentCheckCron,
                }),
                // Revenue attribution settings
                ...(input.attributionEnabled !== undefined && {
                    attributionEnabled: input.attributionEnabled,
                }),
                ...(input.attributionWindowDays !== undefined && {
                    attributionWindowDays: input.attributionWindowDays,
                }),
                ...(input.attributionModel !== undefined && {
                    attributionModel: input.attributionModel,
                }),
                // Prediction settings
                ...(input.predictionsEnabled !== undefined && {
                    predictionsEnabled: input.predictionsEnabled,
                }),
                ...(input.predictionCalculationCron !== undefined && {
                    predictionCalculationCron: input.predictionCalculationCron,
                }),
                ...(input.predictionMinOrders !== undefined && {
                    predictionMinOrders: input.predictionMinOrders,
                }),
                ...(input.predictionMinMessages !== undefined && {
                    predictionMinMessages: input.predictionMinMessages,
                }),
                ...(input.predictionLookbackDays !== undefined && {
                    predictionLookbackDays: input.predictionLookbackDays,
                }),
                // Database backup settings
                ...(input.backupEnabled !== undefined && { backupEnabled: input.backupEnabled }),
                ...(input.backupScheduleTime !== undefined && {
                    backupScheduleTime: input.backupScheduleTime,
                }),
                ...(input.backupRetentionDays !== undefined && {
                    backupRetentionDays: input.backupRetentionDays,
                }),
                ...(input.backupS3Bucket !== undefined && { backupS3Bucket: input.backupS3Bucket }),
                ...(input.backupS3Region !== undefined && { backupS3Region: input.backupS3Region }),
                ...(input.backupS3AccessKeyId !== undefined && {
                    backupS3AccessKeyId: encryptIfNeeded(input.backupS3AccessKeyId),
                }),
                ...(input.backupS3SecretAccessKey !== undefined && {
                    backupS3SecretAccessKey: encryptIfNeeded(input.backupS3SecretAccessKey),
                }),
                ...(input.backupS3Endpoint !== undefined && { backupS3Endpoint: input.backupS3Endpoint }),
            },
        });
        // Audit log settings update
        const changedFields = [];
        if (input.name !== undefined)
            changedFields.push('name');
        if (input.timezone !== undefined)
            changedFields.push('timezone');
        if (input.defaultMessageChannel !== undefined)
            changedFields.push('defaultMessageChannel');
        if (input.dailyMessageLimit !== undefined)
            changedFields.push('dailyMessageLimit');
        if (input.monthlyMessageLimit !== undefined)
            changedFields.push('monthlyMessageLimit');
        if (input.quietHoursStart !== undefined)
            changedFields.push('quietHoursStart');
        if (input.quietHoursEnd !== undefined)
            changedFields.push('quietHoursEnd');
        if (input.quietHoursEnabled !== undefined)
            changedFields.push('quietHoursEnabled');
        if (input.quietHoursDays !== undefined)
            changedFields.push('quietHoursDays');
        if (input.fallbackEnabled !== undefined)
            changedFields.push('fallbackEnabled');
        if (input.fallbackOrder !== undefined)
            changedFields.push('fallbackOrder');
        if (input.fallbackMaxAttempts !== undefined)
            changedFields.push('fallbackMaxAttempts');
        if (input.signupMode !== undefined)
            changedFields.push('signupMode');
        if (input.allowedSignupDomains !== undefined)
            changedFields.push('allowedSignupDomains');
        if (input.auditLogRetentionDays !== undefined)
            changedFields.push('auditLogRetentionDays');
        // Email provider settings
        if (input.useMockEmail !== undefined)
            changedFields.push('useMockEmail');
        if (input.resendApiKey !== undefined)
            changedFields.push('resendApiKey');
        if (input.resendFromAddress !== undefined)
            changedFields.push('resendFromAddress');
        if (input.resendFromName !== undefined)
            changedFields.push('resendFromName');
        if (input.resendWebhookSecret !== undefined)
            changedFields.push('resendWebhookSecret');
        // SMS provider settings
        if (input.useMockSms !== undefined)
            changedFields.push('useMockSms');
        if (input.twilioAccountSid !== undefined)
            changedFields.push('twilioAccountSid');
        if (input.twilioAuthToken !== undefined)
            changedFields.push('twilioAuthToken');
        if (input.twilioFromNumber !== undefined)
            changedFields.push('twilioFromNumber');
        if (input.twilioMessagingServiceSid !== undefined)
            changedFields.push('twilioMessagingServiceSid');
        // WhatsApp provider settings
        if (input.useMockWhatsApp !== undefined)
            changedFields.push('useMockWhatsApp');
        if (input.twilioWhatsAppNumber !== undefined)
            changedFields.push('twilioWhatsAppNumber');
        // RCS provider settings
        if (input.useMockRcs !== undefined)
            changedFields.push('useMockRcs');
        if (input.twilioRcsAgentId !== undefined)
            changedFields.push('twilioRcsAgentId');
        // Push provider settings (FCM)
        if (input.useMockPush !== undefined)
            changedFields.push('useMockPush');
        if (input.fcmProjectId !== undefined)
            changedFields.push('fcmProjectId');
        if (input.fcmPrivateKey !== undefined)
            changedFields.push('fcmPrivateKey');
        if (input.fcmClientEmail !== undefined)
            changedFields.push('fcmClientEmail');
        // AI provider settings
        if (input.openaiApiKey !== undefined)
            changedFields.push('openaiApiKey');
        // Cart abandonment detection settings
        if (input.cartAbandonmentEnabled !== undefined)
            changedFields.push('cartAbandonmentEnabled');
        if (input.cartAbandonmentTimeoutMins !== undefined)
            changedFields.push('cartAbandonmentTimeoutMins');
        if (input.cartAbandonmentCheckCron !== undefined)
            changedFields.push('cartAbandonmentCheckCron');
        // Browse abandonment detection settings
        if (input.browseAbandonmentEnabled !== undefined)
            changedFields.push('browseAbandonmentEnabled');
        if (input.browseAbandonmentTimeoutMins !== undefined)
            changedFields.push('browseAbandonmentTimeoutMins');
        if (input.browseAbandonmentCheckCron !== undefined)
            changedFields.push('browseAbandonmentCheckCron');
        // Revenue attribution settings
        if (input.attributionEnabled !== undefined)
            changedFields.push('attributionEnabled');
        if (input.attributionWindowDays !== undefined)
            changedFields.push('attributionWindowDays');
        if (input.attributionModel !== undefined)
            changedFields.push('attributionModel');
        // Prediction settings
        if (input.predictionsEnabled !== undefined)
            changedFields.push('predictionsEnabled');
        if (input.predictionCalculationCron !== undefined)
            changedFields.push('predictionCalculationCron');
        if (input.predictionMinOrders !== undefined)
            changedFields.push('predictionMinOrders');
        if (input.predictionMinMessages !== undefined)
            changedFields.push('predictionMinMessages');
        if (input.predictionLookbackDays !== undefined)
            changedFields.push('predictionLookbackDays');
        // Database backup settings
        if (input.backupEnabled !== undefined)
            changedFields.push('backupEnabled');
        if (input.backupScheduleTime !== undefined)
            changedFields.push('backupScheduleTime');
        if (input.backupRetentionDays !== undefined)
            changedFields.push('backupRetentionDays');
        if (input.backupS3Bucket !== undefined)
            changedFields.push('backupS3Bucket');
        if (input.backupS3Region !== undefined)
            changedFields.push('backupS3Region');
        if (input.backupS3AccessKeyId !== undefined)
            changedFields.push('backupS3AccessKeyId');
        if (input.backupS3SecretAccessKey !== undefined)
            changedFields.push('backupS3SecretAccessKey');
        if (input.backupS3Endpoint !== undefined)
            changedFields.push('backupS3Endpoint');
        await createAuditLog({
            action: AuditActions.settings.updated,
            resourceType: 'settings',
            resourceId: settings.id,
            metadata: {
                changedFields,
                timezone: settings.timezone,
                signupMode: settings.signupMode,
            },
            context: { userId: ctx.user.sub },
        });
        // Reinitialize providers if any provider settings changed
        const providerFields = [
            'useMockEmail',
            'resendApiKey',
            'resendFromAddress',
            'resendFromName',
            'resendWebhookSecret',
            'useMockSms',
            'twilioAccountSid',
            'twilioAuthToken',
            'twilioFromNumber',
            'twilioMessagingServiceSid',
            'useMockWhatsApp',
            'twilioWhatsAppNumber',
            'useMockRcs',
            'twilioRcsAgentId',
            'useMockPush',
            'fcmProjectId',
            'fcmPrivateKey',
            'fcmClientEmail',
        ];
        const providerSettingsChanged = changedFields.some((field) => providerFields.includes(field));
        if (providerSettingsChanged) {
            await reinitializeProviders();
        }
        // Update cart abandonment schedule if settings changed
        const cartAbandonmentFields = ['cartAbandonmentEnabled', 'cartAbandonmentCheckCron'];
        const cartAbandonmentChanged = changedFields.some((field) => cartAbandonmentFields.includes(field));
        if (cartAbandonmentChanged) {
            if (settings.cartAbandonmentEnabled) {
                await scheduleCartAbandonmentJob(settings.cartAbandonmentCheckCron);
                logger.info('Cart abandonment detection enabled', {
                    component: 'Settings',
                    cron: settings.cartAbandonmentCheckCron,
                });
            }
            else {
                await removeCartAbandonmentSchedule();
                logger.info('Cart abandonment detection disabled', { component: 'Settings' });
            }
        }
        // Update browse abandonment schedule if settings changed
        const browseAbandonmentFields = ['browseAbandonmentEnabled', 'browseAbandonmentCheckCron'];
        const browseAbandonmentChanged = changedFields.some((field) => browseAbandonmentFields.includes(field));
        if (browseAbandonmentChanged) {
            if (settings.browseAbandonmentEnabled) {
                await scheduleBrowseAbandonmentJob(settings.browseAbandonmentCheckCron);
                logger.info('Browse abandonment detection enabled', {
                    component: 'Settings',
                    cron: settings.browseAbandonmentCheckCron,
                });
            }
            else {
                await removeBrowseAbandonmentSchedule();
                logger.info('Browse abandonment detection disabled', { component: 'Settings' });
            }
        }
        // Update prediction calculation schedule if settings changed
        const predictionFields = ['predictionsEnabled', 'predictionCalculationCron'];
        const predictionChanged = changedFields.some((field) => predictionFields.includes(field));
        if (predictionChanged) {
            if (settings.predictionsEnabled) {
                await schedulePredictionJob(settings.predictionCalculationCron);
                logger.info('Prediction calculation enabled', {
                    component: 'Settings',
                    cron: settings.predictionCalculationCron,
                });
            }
            else {
                await removePredictionSchedule();
                logger.info('Prediction calculation disabled', { component: 'Settings' });
            }
        }
        // Update backup schedule if settings changed
        const backupFields = ['backupEnabled', 'backupScheduleTime'];
        const backupChanged = changedFields.some((field) => backupFields.includes(field));
        if (backupChanged) {
            if (settings.backupEnabled) {
                await scheduleBackupJob();
                logger.info('Database backup enabled', {
                    component: 'Settings',
                    scheduleTime: settings.backupScheduleTime,
                });
            }
            else {
                await removeBackupSchedule();
                logger.info('Database backup disabled', { component: 'Settings' });
            }
        }
        // Invalidate settings cache after update
        await invalidateSettingsCache();
        return {
            id: settings.id,
            name: settings.name,
            timezone: settings.timezone,
            defaultMessageChannel: settings.defaultMessageChannel,
            dailyMessageLimit: settings.dailyMessageLimit,
            monthlyMessageLimit: settings.monthlyMessageLimit,
            quietHoursStart: settings.quietHoursStart,
            quietHoursEnd: settings.quietHoursEnd,
            quietHoursEnabled: settings.quietHoursEnabled,
            quietHoursDays: settings.quietHoursDays,
            fallbackEnabled: settings.fallbackEnabled,
            fallbackOrder: settings.fallbackOrder,
            fallbackMaxAttempts: settings.fallbackMaxAttempts,
            signupMode: settings.signupMode,
            allowedSignupDomains: settings.allowedSignupDomains,
            auditLogRetentionDays: settings.auditLogRetentionDays,
            // Email provider settings (mask secrets)
            useMockEmail: settings.useMockEmail,
            resendApiKey: settings.resendApiKey ? maskSecret(settings.resendApiKey) : null,
            resendFromAddress: settings.resendFromAddress,
            resendFromName: settings.resendFromName,
            resendWebhookSecret: settings.resendWebhookSecret
                ? maskSecret(settings.resendWebhookSecret)
                : null,
            // SMS provider settings (mask secrets)
            useMockSms: settings.useMockSms,
            twilioAccountSid: settings.twilioAccountSid,
            twilioAuthToken: settings.twilioAuthToken ? maskSecret(settings.twilioAuthToken) : null,
            twilioFromNumber: settings.twilioFromNumber,
            twilioMessagingServiceSid: settings.twilioMessagingServiceSid,
            // WhatsApp provider settings (via Twilio)
            useMockWhatsApp: settings.useMockWhatsApp,
            twilioWhatsAppNumber: settings.twilioWhatsAppNumber,
            // RCS provider settings (via Twilio)
            useMockRcs: settings.useMockRcs,
            twilioRcsAgentId: settings.twilioRcsAgentId,
            // Push provider settings (FCM - mask private key)
            useMockPush: settings.useMockPush,
            fcmProjectId: settings.fcmProjectId,
            fcmPrivateKey: settings.fcmPrivateKey ? maskSecret(settings.fcmPrivateKey) : null,
            fcmClientEmail: settings.fcmClientEmail,
            // AI provider settings (mask secrets)
            openaiApiKey: settings.openaiApiKey ? maskSecret(settings.openaiApiKey) : null,
            // Cart abandonment detection settings
            cartAbandonmentEnabled: settings.cartAbandonmentEnabled,
            cartAbandonmentTimeoutMins: settings.cartAbandonmentTimeoutMins,
            cartAbandonmentCheckCron: settings.cartAbandonmentCheckCron,
            // Browse abandonment detection settings
            browseAbandonmentEnabled: settings.browseAbandonmentEnabled,
            browseAbandonmentTimeoutMins: settings.browseAbandonmentTimeoutMins,
            browseAbandonmentCheckCron: settings.browseAbandonmentCheckCron,
            // Revenue attribution settings
            attributionEnabled: settings.attributionEnabled,
            attributionWindowDays: settings.attributionWindowDays,
            attributionModel: settings.attributionModel,
            // Prediction settings
            predictionsEnabled: settings.predictionsEnabled,
            predictionCalculationCron: settings.predictionCalculationCron,
            predictionMinOrders: settings.predictionMinOrders,
            predictionMinMessages: settings.predictionMinMessages,
            predictionLookbackDays: settings.predictionLookbackDays,
            // Database backup settings (mask secrets)
            backupEnabled: settings.backupEnabled,
            backupScheduleTime: settings.backupScheduleTime,
            backupRetentionDays: settings.backupRetentionDays,
            backupS3Bucket: settings.backupS3Bucket,
            backupS3Region: settings.backupS3Region,
            backupS3AccessKeyId: settings.backupS3AccessKeyId
                ? maskSecret(settings.backupS3AccessKeyId)
                : null,
            backupS3SecretAccessKey: settings.backupS3SecretAccessKey
                ? maskSecret(settings.backupS3SecretAccessKey)
                : null,
            backupS3Endpoint: settings.backupS3Endpoint,
            updatedAt: settings.updatedAt,
        };
    },
});
// Get signup settings (public - no auth required)
export const getSignupSettingsEndpoint = publicFactory.build({
    method: 'get',
    shortDescription: 'Get Signup Settings',
    description: 'Returns public signup settings (no authentication required).',
    tag: 'Settings',
    input: z.object({}),
    output: z.object({
        signupMode: signupModeSchema,
        allowedSignupDomains: z.array(z.string()),
    }),
    handler: async () => {
        const settings = await getOrCreateSettings();
        return {
            signupMode: settings.signupMode,
            allowedSignupDomains: settings.allowedSignupDomains,
        };
    },
});
// Get list of valid timezones
export const getTimezonesEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'List Timezones',
    description: 'Returns a list of valid IANA timezone codes.',
    tag: 'Settings',
    input: z.object({}),
    output: z.object({
        timezones: z.array(z.object({
            code: z.string(),
            label: z.string(),
            utc: z.string(),
        })),
    }),
    handler: async () => {
        return {
            timezones: timezones.map((tz) => ({
                code: tz.tzCode,
                label: tz.label,
                utc: tz.utc,
            })),
        };
    },
});
