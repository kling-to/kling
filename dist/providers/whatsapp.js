import crypto from 'crypto';
import twilio from 'twilio';
export class TwilioWhatsAppProvider {
    name = 'twilio_whatsapp';
    channel = 'whatsapp';
    client;
    fromNumber;
    authToken;
    constructor(config) {
        const accountSid = config.apiKey;
        const authToken = config.apiSecret;
        if (!accountSid || !authToken) {
            throw new Error('Twilio Account SID and Auth Token are required for WhatsApp');
        }
        if (!config.fromAddress) {
            throw new Error('Twilio WhatsApp-enabled phone number is required');
        }
        this.client = twilio(accountSid, authToken);
        this.fromNumber = config.fromAddress.startsWith('whatsapp:')
            ? config.fromAddress
            : `whatsapp:${config.fromAddress}`;
        this.authToken = authToken;
    }
    async send(message) {
        try {
            const toNumber = message.to.startsWith('whatsapp:') ? message.to : `whatsapp:${message.to}`;
            const messageOptions = {
                to: toNumber,
                body: message.body,
                from: this.fromNumber,
            };
            if (message.metadata?.mediaUrl) {
                messageOptions.mediaUrl = [message.metadata.mediaUrl];
            }
            if (message.metadata?.statusCallback) {
                messageOptions.statusCallback = message.metadata.statusCallback;
            }
            const response = await this.client.messages.create(messageOptions);
            if (response.errorCode) {
                return {
                    success: false,
                    error: response.errorMessage || `Error code: ${response.errorCode}`,
                    retryable: this.isRetryableErrorCode(response.errorCode),
                };
            }
            return {
                success: true,
                providerMessageId: response.sid,
                providerResponse: {
                    sid: response.sid,
                    status: response.status,
                    dateCreated: response.dateCreated,
                    direction: response.direction,
                    price: response.price,
                    priceUnit: response.priceUnit,
                },
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const twilioError = error;
            return {
                success: false,
                error: errorMessage,
                retryable: this.isRetryableError(twilioError),
            };
        }
    }
    isRetryableErrorCode(errorCode) {
        const retryableCodes = [
            20429,
            63015,
            63016,
            63031,
        ];
        return retryableCodes.includes(errorCode);
    }
    isRetryableError(error) {
        if (error.status === 429)
            return true;
        if (error.code === 20429)
            return true;
        if (error.status && error.status >= 500)
            return true;
        if (error.code && this.isRetryableErrorCode(error.code))
            return true;
        return false;
    }
    verifyWebhook(payload, signatureData) {
        if (!this.authToken) {
            console.warn('[TwilioWhatsAppProvider] No auth token configured, skipping verification');
            return true;
        }
        try {
            let twilioSignature;
            let url;
            try {
                const data = JSON.parse(signatureData);
                twilioSignature = data.signature || '';
                url = data.url || '';
            }
            catch {
                twilioSignature = signatureData;
                url = '';
            }
            if (!twilioSignature) {
                console.warn('[TwilioWhatsAppProvider] Missing X-Twilio-Signature');
                return false;
            }
            const params = {};
            const urlParams = new URLSearchParams(payload);
            for (const [key, value] of urlParams.entries()) {
                params[key] = value;
            }
            if (url) {
                return twilio.validateRequest(this.authToken, twilioSignature, url, params);
            }
            console.warn('[TwilioWhatsAppProvider] URL not provided, using partial signature verification');
            const sortedParams = Object.keys(params)
                .sort()
                .map((key) => `${key}${params[key]}`)
                .join('');
            const computed = crypto
                .createHmac('sha1', this.authToken)
                .update(sortedParams)
                .digest('base64');
            return crypto.timingSafeEqual(Buffer.from(twilioSignature), Buffer.from(computed));
        }
        catch (error) {
            console.warn('[TwilioWhatsAppProvider] Webhook signature verification failed:', error);
            return false;
        }
    }
    parseWebhook(payload) {
        const data = payload;
        if (!data)
            return null;
        const messageSid = data.MessageSid || data.SmsSid || data.SmsMessageSid;
        const messageStatus = data.MessageStatus || data.SmsStatus;
        if (!messageSid || !messageStatus) {
            return null;
        }
        const statusMap = {
            queued: 'delivered',
            sending: 'delivered',
            sent: 'delivered',
            delivered: 'delivered',
            read: 'opened',
            failed: 'failed',
            undelivered: 'bounced',
            canceled: 'failed',
        };
        const eventType = statusMap[messageStatus.toLowerCase()];
        if (!eventType) {
            console.warn(`[TwilioWhatsAppProvider] Unknown message status: ${messageStatus}`);
            return null;
        }
        return {
            providerMessageId: messageSid,
            eventType,
            timestamp: new Date(),
            metadata: {
                status: messageStatus,
                to: data.To,
                from: data.From,
                errorCode: data.ErrorCode,
                errorMessage: data.ErrorMessage,
                accountSid: data.AccountSid,
                channel: 'whatsapp',
            },
        };
    }
    async healthCheck() {
        try {
            const account = await this.client.api.accounts.list({ limit: 1 });
            return account.length > 0;
        }
        catch {
            return false;
        }
    }
}
