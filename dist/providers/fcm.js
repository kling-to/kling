import crypto from 'crypto';
/**
 * Firebase Cloud Messaging (FCM) provider for push notifications.
 * Uses FCM HTTP v1 API for sending push notifications to mobile devices.
 * @see https://firebase.google.com/docs/cloud-messaging/http-server-ref
 */
export class FcmPushProvider {
    name = 'fcm';
    channel = 'push';
    projectId;
    clientEmail;
    privateKey;
    accessToken = null;
    tokenExpiry = 0;
    constructor(config) {
        const projectId = config.projectId;
        const clientEmail = config.clientEmail;
        const privateKey = config.privateKey;
        if (!projectId || !clientEmail || !privateKey) {
            throw new Error('FCM requires projectId, clientEmail, and privateKey');
        }
        this.projectId = projectId;
        this.clientEmail = clientEmail;
        // Handle escaped newlines in private key
        this.privateKey = privateKey.replace(/\\n/g, '\n');
    }
    /**
     * Generate a JWT for FCM authentication
     */
    generateJWT() {
        const now = Math.floor(Date.now() / 1000);
        const exp = now + 3600; // 1 hour expiry
        const header = {
            alg: 'RS256',
            typ: 'JWT',
        };
        const payload = {
            iss: this.clientEmail,
            sub: this.clientEmail,
            aud: 'https://oauth2.googleapis.com/token',
            iat: now,
            exp: exp,
            scope: 'https://www.googleapis.com/auth/firebase.messaging',
        };
        const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
        const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const signatureInput = `${encodedHeader}.${encodedPayload}`;
        const sign = crypto.createSign('RSA-SHA256');
        sign.update(signatureInput);
        const signature = sign.sign(this.privateKey, 'base64url');
        return `${signatureInput}.${signature}`;
    }
    /**
     * Get OAuth2 access token for FCM API
     */
    async getAccessToken() {
        // Return cached token if still valid
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }
        const jwt = this.generateJWT();
        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: jwt,
            }),
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to get FCM access token: ${error}`);
        }
        const data = (await response.json());
        this.accessToken = data.access_token;
        // Set expiry 5 minutes before actual expiry to be safe
        this.tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
        return this.accessToken;
    }
    async send(message) {
        try {
            const accessToken = await this.getAccessToken();
            // Build FCM message payload
            const fcmMessage = {
                message: {
                    token: message.to, // Device token
                    notification: {
                        title: message.subject || 'Notification',
                        body: message.body,
                    },
                },
            };
            // Add image if present
            if (message.metadata?.imageUrl) {
                fcmMessage.message.notification.image = message.metadata.imageUrl;
            }
            // Add custom data payload
            if (message.metadata?.data) {
                const dataPayload = message.metadata.data;
                fcmMessage.message.data = {};
                for (const [key, value] of Object.entries(dataPayload)) {
                    fcmMessage.message.data[key] = String(value);
                }
            }
            // Add deep link
            if (message.metadata?.deepLink) {
                const deepLink = message.metadata.deepLink;
                fcmMessage.message.android = {
                    priority: 'high',
                    notification: {
                        click_action: deepLink,
                    },
                };
                fcmMessage.message.webpush = {
                    notification: {
                        click_action: deepLink,
                    },
                };
            }
            // Send to FCM HTTP v1 API
            const response = await fetch(`https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(fcmMessage),
            });
            const responseData = (await response.json());
            if (!response.ok || responseData.error) {
                const errorMessage = responseData.error?.message || 'Unknown FCM error';
                const errorCode = responseData.error?.details?.[0]?.errorCode;
                return {
                    success: false,
                    error: errorMessage,
                    retryable: this.isRetryableError(response.status, errorCode),
                };
            }
            // Extract message ID from response (format: projects/{project}/messages/{messageId})
            const messageId = responseData.name?.split('/').pop() || responseData.name;
            return {
                success: true,
                providerMessageId: messageId,
                providerResponse: responseData,
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: errorMessage,
                retryable: true, // Network errors are retryable
            };
        }
    }
    isRetryableError(statusCode, errorCode) {
        // Server errors are retryable
        if (statusCode >= 500)
            return true;
        // Rate limiting
        if (statusCode === 429)
            return true;
        // FCM-specific retryable errors
        const retryableErrorCodes = ['UNAVAILABLE', 'INTERNAL', 'QUOTA_EXCEEDED'];
        if (errorCode && retryableErrorCodes.includes(errorCode))
            return true;
        return false;
    }
    /**
     * FCM doesn't use traditional webhook signatures.
     * Cloud Functions or Cloud Run are typically used for delivery receipts.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    verifyWebhook(_payload, _signature) {
        // FCM delivery receipts are typically handled via Firebase Cloud Functions
        // For direct HTTP delivery receipts, verification would depend on setup
        console.warn('[FcmPushProvider] Webhook verification not implemented for FCM');
        return true;
    }
    parseWebhook(payload) {
        // FCM delivery receipts format varies based on setup
        // This handles the common data message format
        const data = payload;
        if (!data)
            return null;
        const messageId = data.messageId || data.message_id;
        const eventType = data.eventType || data.event_type;
        if (!messageId)
            return null;
        const eventTypeMap = {
            delivered: 'delivered',
            opened: 'opened',
            clicked: 'clicked',
            failed: 'failed',
            dismissed: 'failed',
        };
        return {
            providerMessageId: messageId,
            eventType: eventTypeMap[eventType?.toLowerCase()] || 'delivered',
            timestamp: new Date(),
            metadata: data,
        };
    }
    async healthCheck() {
        try {
            // Try to get access token as health check
            await this.getAccessToken();
            return true;
        }
        catch {
            return false;
        }
    }
}
