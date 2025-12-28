import { MockEmailProvider, MockSmsProvider, MockWhatsAppProvider, MockRcsProvider, MockPushProvider, } from './mock';
import { ResendEmailProvider } from './resend';
import { TwilioSmsProvider } from './twilio';
import { TwilioWhatsAppProvider } from './whatsapp';
import { TwilioRcsProvider } from './rcs';
import { FcmPushProvider } from './fcm';
import prisma from '../utils/prisma';
/**
 * Registry for message providers.
 * Manages provider instances and routes messages to the appropriate provider.
 */
class ProviderRegistry {
    providers = new Map();
    channelDefaults = new Map();
    /**
     * Register a provider instance.
     * @param provider The provider to register
     * @param isDefault Whether this should be the default provider for its channel
     */
    register(provider, isDefault = false) {
        this.providers.set(provider.name, provider);
        if (isDefault) {
            this.channelDefaults.set(provider.channel, provider.name);
        }
    }
    /**
     * Get a provider by name.
     * @param name Provider name
     * @returns The provider or undefined
     */
    get(name) {
        return this.providers.get(name);
    }
    /**
     * Get the default provider for a channel.
     * @param channel Message channel
     * @returns The default provider or undefined
     */
    getForChannel(channel) {
        const defaultName = this.channelDefaults.get(channel);
        if (defaultName) {
            return this.providers.get(defaultName);
        }
        // Fallback: find any provider for this channel
        for (const provider of this.providers.values()) {
            if (provider.channel === channel) {
                return provider;
            }
        }
        return undefined;
    }
    /**
     * List all registered providers.
     */
    list() {
        return Array.from(this.providers.values());
    }
    /**
     * Check if a provider is registered.
     */
    has(name) {
        return this.providers.has(name);
    }
    /**
     * Clear all providers (for testing).
     */
    clear() {
        this.providers.clear();
        this.channelDefaults.clear();
    }
}
// Singleton instance
export const providerRegistry = new ProviderRegistry();
/**
 * Initialize providers based on database settings.
 * Called at application startup.
 */
export async function initializeProviders() {
    // Clear existing providers before reinitializing
    providerRegistry.clear();
    // Load settings from database
    const settings = await prisma.settings.findFirst();
    // Determine if we should use mock providers (default to mock if no settings)
    const useMockEmail = settings?.useMockEmail ?? true;
    const useMockSms = settings?.useMockSms ?? true;
    // Initialize email provider
    if (useMockEmail) {
        providerRegistry.register(new MockEmailProvider({}), true);
        console.log('[ProviderRegistry] Mock email provider initialized');
    }
    else {
        // Use database settings only
        const apiKey = settings?.resendApiKey;
        if (apiKey) {
            const resendConfig = {
                apiKey,
                fromAddress: settings?.resendFromAddress || 'noreply@example.com',
                fromName: settings?.resendFromName || 'Kling',
                webhookSecret: settings?.resendWebhookSecret || undefined,
            };
            providerRegistry.register(new ResendEmailProvider(resendConfig), true);
            console.log('[ProviderRegistry] Resend email provider initialized');
        }
        else {
            console.warn('[ProviderRegistry] No Resend API key configured, falling back to mock');
            providerRegistry.register(new MockEmailProvider({}), true);
        }
    }
    // Initialize SMS provider
    if (useMockSms) {
        providerRegistry.register(new MockSmsProvider({}), true);
        console.log('[ProviderRegistry] Mock SMS provider initialized');
    }
    else {
        // Use database settings only
        const accountSid = settings?.twilioAccountSid;
        const authToken = settings?.twilioAuthToken;
        if (accountSid && authToken) {
            const twilioConfig = {
                apiKey: accountSid,
                apiSecret: authToken,
                fromAddress: settings?.twilioFromNumber || undefined,
                messagingServiceSid: settings?.twilioMessagingServiceSid || undefined,
            };
            try {
                providerRegistry.register(new TwilioSmsProvider(twilioConfig), true);
                console.log('[ProviderRegistry] Twilio SMS provider initialized');
            }
            catch (error) {
                console.error('[ProviderRegistry] Failed to initialize Twilio:', error);
                providerRegistry.register(new MockSmsProvider({}), true);
            }
        }
        else {
            console.warn('[ProviderRegistry] No Twilio credentials configured, falling back to mock');
            providerRegistry.register(new MockSmsProvider({}), true);
        }
    }
    // Initialize WhatsApp provider (uses Twilio)
    const useMockWhatsApp = settings?.useMockWhatsApp ?? true;
    if (useMockWhatsApp) {
        providerRegistry.register(new MockWhatsAppProvider({}), true);
        console.log('[ProviderRegistry] Mock WhatsApp provider initialized');
    }
    else {
        const accountSid = settings?.twilioAccountSid;
        const authToken = settings?.twilioAuthToken;
        const whatsappNumber = settings?.twilioWhatsAppNumber;
        if (accountSid && authToken && whatsappNumber) {
            const whatsappConfig = {
                apiKey: accountSid,
                apiSecret: authToken,
                fromAddress: whatsappNumber,
            };
            try {
                providerRegistry.register(new TwilioWhatsAppProvider(whatsappConfig), true);
                console.log('[ProviderRegistry] Twilio WhatsApp provider initialized');
            }
            catch (error) {
                console.error('[ProviderRegistry] Failed to initialize WhatsApp:', error);
                providerRegistry.register(new MockWhatsAppProvider({}), true);
            }
        }
        else {
            console.warn('[ProviderRegistry] No WhatsApp credentials configured, falling back to mock');
            providerRegistry.register(new MockWhatsAppProvider({}), true);
        }
    }
    // Initialize RCS provider (uses Twilio)
    const useMockRcs = settings?.useMockRcs ?? true;
    if (useMockRcs) {
        providerRegistry.register(new MockRcsProvider({}), true);
        console.log('[ProviderRegistry] Mock RCS provider initialized');
    }
    else {
        const accountSid = settings?.twilioAccountSid;
        const authToken = settings?.twilioAuthToken;
        const fromNumber = settings?.twilioFromNumber;
        if (accountSid && authToken && fromNumber) {
            const rcsConfig = {
                apiKey: accountSid,
                apiSecret: authToken,
                fromAddress: fromNumber,
                agentId: settings?.twilioRcsAgentId || undefined,
            };
            try {
                providerRegistry.register(new TwilioRcsProvider(rcsConfig), true);
                console.log('[ProviderRegistry] Twilio RCS provider initialized');
            }
            catch (error) {
                console.error('[ProviderRegistry] Failed to initialize RCS:', error);
                providerRegistry.register(new MockRcsProvider({}), true);
            }
        }
        else {
            console.warn('[ProviderRegistry] No RCS credentials configured, falling back to mock');
            providerRegistry.register(new MockRcsProvider({}), true);
        }
    }
    // Initialize Push provider (FCM)
    const useMockPush = settings?.useMockPush ?? true;
    if (useMockPush) {
        providerRegistry.register(new MockPushProvider({}), true);
        console.log('[ProviderRegistry] Mock Push provider initialized');
    }
    else {
        const projectId = settings?.fcmProjectId;
        const privateKey = settings?.fcmPrivateKey;
        const clientEmail = settings?.fcmClientEmail;
        if (projectId && privateKey && clientEmail) {
            const fcmConfig = {
                projectId,
                privateKey,
                clientEmail,
            };
            try {
                providerRegistry.register(new FcmPushProvider(fcmConfig), true);
                console.log('[ProviderRegistry] FCM Push provider initialized');
            }
            catch (error) {
                console.error('[ProviderRegistry] Failed to initialize FCM:', error);
                providerRegistry.register(new MockPushProvider({}), true);
            }
        }
        else {
            console.warn('[ProviderRegistry] No FCM credentials configured, falling back to mock');
            providerRegistry.register(new MockPushProvider({}), true);
        }
    }
}
/**
 * Reinitialize providers after settings change.
 * Call this after updating provider settings.
 */
export async function reinitializeProviders() {
    console.log('[ProviderRegistry] Reinitializing providers after settings change');
    await initializeProviders();
}
/**
 * Get the provider for a specific channel.
 * @param channel The message channel
 * @returns The appropriate provider
 * @throws Error if no provider is available for the channel
 */
export function getProviderForChannel(channel) {
    const provider = providerRegistry.getForChannel(channel);
    if (!provider) {
        throw new Error(`No provider available for channel: ${channel}`);
    }
    return provider;
}
