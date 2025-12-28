import crypto from 'crypto';
import { Resend } from 'resend';
/**
 * Resend email provider for production email sending.
 * https://resend.com/docs
 */
export class ResendEmailProvider {
    name = 'resend';
    channel = 'email';
    client;
    fromAddress;
    fromName;
    webhookSecret;
    constructor(config) {
        if (!config.apiKey) {
            throw new Error('Resend API key is required');
        }
        this.client = new Resend(config.apiKey);
        this.fromAddress = config.fromAddress || 'noreply@example.com';
        this.fromName = config.fromName || 'Kling';
        this.webhookSecret = config.webhookSecret || '';
    }
    async send(message) {
        try {
            const from = this.fromName ? `${this.fromName} <${this.fromAddress}>` : this.fromAddress;
            const response = await this.client.emails.send({
                from,
                to: message.to,
                subject: message.subject || 'No Subject',
                text: message.body,
                html: message.html,
            });
            if (response.error) {
                return {
                    success: false,
                    error: response.error.message,
                    retryable: this.isRetryableError(response.error),
                };
            }
            return {
                success: true,
                providerMessageId: response.data?.id,
                providerResponse: response.data,
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: errorMessage,
                retryable: this.isRetryableError(error),
            };
        }
    }
    isRetryableError(error) {
        if (!error || typeof error !== 'object')
            return false;
        // Resend API errors
        const err = error;
        // Rate limiting or server errors are retryable
        if (err.statusCode && err.statusCode >= 500)
            return true;
        if (err.statusCode === 429)
            return true;
        // Network errors are typically retryable
        if (err.name === 'FetchError' || err.name === 'NetworkError')
            return true;
        return false;
    }
    /**
     * Verify Resend webhook signature using Svix format.
     * Resend uses Svix for webhooks with headers: svix-id, svix-timestamp, svix-signature
     * @see https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
     *
     * @param payload - Raw request body as string
     * @param headers - JSON string with svix headers: { "svix-id": "...", "svix-timestamp": "...", "svix-signature": "..." }
     */
    verifyWebhook(payload, headers) {
        if (!this.webhookSecret) {
            console.warn('[ResendEmailProvider] No webhook secret configured, skipping verification');
            return true;
        }
        try {
            // Parse headers (expected format: JSON object with svix-id, svix-timestamp, svix-signature)
            const headerObj = JSON.parse(headers);
            const svixId = headerObj['svix-id'];
            const svixTimestamp = headerObj['svix-timestamp'];
            const svixSignature = headerObj['svix-signature'];
            if (!svixId || !svixTimestamp || !svixSignature) {
                console.warn('[ResendEmailProvider] Missing required Svix headers');
                return false;
            }
            // Check timestamp to prevent replay attacks (5 minute tolerance)
            const timestampSeconds = parseInt(svixTimestamp, 10);
            const now = Math.floor(Date.now() / 1000);
            if (Math.abs(now - timestampSeconds) > 300) {
                console.warn('[ResendEmailProvider] Webhook timestamp too old or in future');
                return false;
            }
            // Create the signed content: msgId.timestamp.payload
            const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
            // Extract base64 secret (remove 'whsec_' prefix if present)
            const secret = this.webhookSecret.startsWith('whsec_')
                ? this.webhookSecret.slice(6)
                : this.webhookSecret;
            const secretBytes = Buffer.from(secret, 'base64');
            // Compute expected signature using HMAC-SHA256
            const expectedSignature = crypto
                .createHmac('sha256', secretBytes)
                .update(signedContent)
                .digest('base64');
            // Svix signature header may contain multiple signatures (v1,sig1 v1,sig2)
            // We need to check if any of them match
            const signatures = svixSignature.split(' ');
            for (const sig of signatures) {
                const [version, sigValue] = sig.split(',');
                if (version !== 'v1')
                    continue;
                try {
                    if (crypto.timingSafeEqual(Buffer.from(sigValue, 'base64'), Buffer.from(expectedSignature, 'base64'))) {
                        return true;
                    }
                }
                catch {
                    // Buffer length mismatch, continue to next signature
                }
            }
            return false;
        }
        catch (error) {
            console.warn('[ResendEmailProvider] Webhook verification failed:', error);
            return false;
        }
    }
    parseWebhook(payload) {
        const data = payload;
        if (!data)
            return null;
        // Resend webhook format
        // https://resend.com/docs/dashboard/webhooks/event-types
        const eventType = data.type;
        const eventData = data.data;
        if (!eventType || !eventData)
            return null;
        const emailId = eventData.email_id;
        if (!emailId)
            return null;
        const eventTypeMap = {
            'email.sent': 'delivered',
            'email.delivered': 'delivered',
            'email.delivery_delayed': 'delivered', // Still in transit
            'email.bounced': 'bounced',
            'email.complained': 'complained',
            'email.opened': 'opened',
            'email.clicked': 'clicked',
        };
        const mappedType = eventTypeMap[eventType];
        if (!mappedType)
            return null;
        return {
            providerMessageId: emailId,
            eventType: mappedType,
            timestamp: data.created_at ? new Date(data.created_at) : new Date(),
            metadata: eventData,
        };
    }
    async healthCheck() {
        try {
            // Resend doesn't have a dedicated health endpoint
            // We can try to list domains as a connectivity check
            const response = await this.client.domains.list();
            return !response.error;
        }
        catch {
            return false;
        }
    }
}
