import crypto from 'crypto';
import twilio from 'twilio';
/**
 * Twilio SMS provider for production SMS sending.
 * https://www.twilio.com/docs/sms
 */
export class TwilioSmsProvider {
    name = 'twilio';
    channel = 'sms';
    client;
    fromNumber;
    messagingServiceSid;
    authToken;
    constructor(config) {
        const accountSid = config.apiKey;
        const authToken = config.apiSecret;
        if (!accountSid || !authToken) {
            throw new Error('Twilio Account SID and Auth Token are required');
        }
        if (!config.fromAddress && !config.messagingServiceSid) {
            throw new Error('Twilio requires either fromAddress (phone number) or messagingServiceSid');
        }
        this.client = twilio(accountSid, authToken);
        this.fromNumber = config.fromAddress;
        this.messagingServiceSid = config.messagingServiceSid;
        this.authToken = authToken;
    }
    async send(message) {
        try {
            // Build message options
            const messageOptions = {
                to: message.to,
                body: message.body,
            };
            // Use Messaging Service SID if available (recommended for production)
            // Otherwise use the from phone number
            if (this.messagingServiceSid) {
                messageOptions.messagingServiceSid = this.messagingServiceSid;
            }
            else {
                messageOptions.from = this.fromNumber;
            }
            // Add status callback if configured via metadata
            if (message.metadata?.statusCallback) {
                messageOptions.statusCallback = message.metadata.statusCallback;
            }
            const response = await this.client.messages.create(messageOptions);
            // Check for error status
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
                    numSegments: response.numSegments,
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
        // Twilio error codes that are typically retryable
        // https://www.twilio.com/docs/api/errors
        const retryableCodes = [
            20429, // Too many requests
            30001, // Queue overflow
            30002, // Account suspended (might be temporary)
            30003, // Unreachable destination
            30005, // Unknown destination handset
            30006, // Landline or unreachable carrier
            30007, // Message filtered (carrier)
        ];
        return retryableCodes.includes(errorCode);
    }
    isRetryableError(error) {
        // Rate limiting
        if (error.status === 429)
            return true;
        if (error.code === 20429)
            return true;
        // Server errors
        if (error.status && error.status >= 500)
            return true;
        // Specific retryable error codes
        if (error.code && this.isRetryableErrorCode(error.code))
            return true;
        return false;
    }
    /**
     * Verify Twilio webhook signature using the official SDK.
     * @see https://www.twilio.com/docs/usage/webhooks/webhooks-security
     *
     * @param payload - Form-encoded POST body as string
     * @param signatureData - JSON string with: { "signature": "X-Twilio-Signature header", "url": "full webhook URL" }
     */
    verifyWebhook(payload, signatureData) {
        if (!this.authToken) {
            console.warn('[TwilioSmsProvider] No auth token configured, skipping verification');
            return true;
        }
        try {
            // Parse signature data (expected format: JSON with signature and url)
            let twilioSignature;
            let url;
            try {
                const data = JSON.parse(signatureData);
                twilioSignature = data.signature || '';
                url = data.url || '';
            }
            catch {
                // Fallback: treat signatureData as just the signature (legacy behavior)
                twilioSignature = signatureData;
                url = '';
            }
            if (!twilioSignature) {
                console.warn('[TwilioSmsProvider] Missing X-Twilio-Signature');
                return false;
            }
            // Parse the payload to get params (for POST webhooks)
            const params = {};
            const urlParams = new URLSearchParams(payload);
            for (const [key, value] of urlParams.entries()) {
                params[key] = value;
            }
            // Use Twilio SDK's validateRequest if URL is available
            if (url) {
                return twilio.validateRequest(this.authToken, twilioSignature, url, params);
            }
            // Fallback: Manual validation without URL (less secure, but works for testing)
            // Twilio signature = base64(HMAC-SHA1(authToken, url + sorted params))
            // Without URL, we can only verify the params portion
            console.warn('[TwilioSmsProvider] URL not provided, using partial signature verification');
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
            console.warn('[TwilioSmsProvider] Webhook signature verification failed:', error);
            return false;
        }
    }
    parseWebhook(payload) {
        // Twilio sends webhook data as form-encoded POST
        // Key fields: MessageSid, MessageStatus, To, From, ErrorCode
        const data = payload;
        if (!data)
            return null;
        // Twilio webhook payload fields
        // https://www.twilio.com/docs/sms/tutorials/how-to-confirm-delivery
        const messageSid = data.MessageSid || data.SmsSid || data.SmsMessageSid;
        const messageStatus = data.MessageStatus || data.SmsStatus;
        if (!messageSid || !messageStatus) {
            return null;
        }
        // Map Twilio status to our event types
        // https://www.twilio.com/docs/sms/api/message-resource#message-status-values
        const statusMap = {
            // Successful delivery states
            queued: 'delivered', // Message queued
            sending: 'delivered', // Message being sent
            sent: 'delivered', // Sent to carrier
            delivered: 'delivered', // Delivered to handset
            // Failure states
            failed: 'failed', // Message failed
            undelivered: 'bounced', // Not delivered (blocked, invalid number, etc.)
            // Other states we map to failed
            canceled: 'failed', // Message was canceled
            accepted: 'delivered', // Accepted by Twilio (for inbound)
            receiving: 'delivered', // Being received (for inbound)
            received: 'delivered', // Received (for inbound)
        };
        const eventType = statusMap[messageStatus.toLowerCase()];
        if (!eventType) {
            console.warn(`[TwilioSmsProvider] Unknown message status: ${messageStatus}`);
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
                numSegments: data.NumSegments,
                accountSid: data.AccountSid,
            },
        };
    }
    async healthCheck() {
        try {
            // Verify account by fetching account info
            const account = await this.client.api.accounts.list({ limit: 1 });
            return account.length > 0;
        }
        catch {
            return false;
        }
    }
}
