import crypto from 'crypto';
import { Resend } from 'resend';
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
        const err = error;
        if (err.statusCode && err.statusCode >= 500)
            return true;
        if (err.statusCode === 429)
            return true;
        if (err.name === 'FetchError' || err.name === 'NetworkError')
            return true;
        return false;
    }
    verifyWebhook(payload, headers) {
        if (!this.webhookSecret) {
            console.warn('[ResendEmailProvider] No webhook secret configured, skipping verification');
            return true;
        }
        try {
            const headerObj = JSON.parse(headers);
            const svixId = headerObj['svix-id'];
            const svixTimestamp = headerObj['svix-timestamp'];
            const svixSignature = headerObj['svix-signature'];
            if (!svixId || !svixTimestamp || !svixSignature) {
                console.warn('[ResendEmailProvider] Missing required Svix headers');
                return false;
            }
            const timestampSeconds = parseInt(svixTimestamp, 10);
            const now = Math.floor(Date.now() / 1000);
            if (Math.abs(now - timestampSeconds) > 300) {
                console.warn('[ResendEmailProvider] Webhook timestamp too old or in future');
                return false;
            }
            const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
            const secret = this.webhookSecret.startsWith('whsec_')
                ? this.webhookSecret.slice(6)
                : this.webhookSecret;
            const secretBytes = Buffer.from(secret, 'base64');
            const expectedSignature = crypto
                .createHmac('sha256', secretBytes)
                .update(signedContent)
                .digest('base64');
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
            'email.delivery_delayed': 'delivered',
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
            const response = await this.client.domains.list();
            return !response.error;
        }
        catch {
            return false;
        }
    }
}
