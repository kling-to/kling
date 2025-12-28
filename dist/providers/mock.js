import crypto from 'crypto';
/**
 * Mock email provider for local development and testing.
 * Logs messages to console and stores them in memory.
 */
export class MockEmailProvider {
    name = 'mock_email';
    channel = 'email';
    webhookSecret;
    shouldFail;
    failureRate;
    // In-memory storage for testing
    static sentMessages = [];
    constructor(config) {
        this.webhookSecret = config.webhookSecret || 'mock-webhook-secret';
        this.shouldFail = config.shouldFail || false;
        this.failureRate = config.failureRate || 0;
    }
    async send(message) {
        // Simulate failure based on configuration
        if (this.shouldFail || Math.random() < this.failureRate) {
            return {
                success: false,
                error: 'Mock provider failure (configured)',
                retryable: true,
            };
        }
        const providerMessageId = `mock_${crypto.randomUUID()}`;
        // Store message for testing
        MockEmailProvider.sentMessages.push({
            id: providerMessageId,
            message,
            sentAt: new Date(),
        });
        // Log for visibility during development
        console.log(`[MockEmailProvider] Message sent:`, {
            id: providerMessageId,
            to: message.to,
            subject: message.subject,
            bodyPreview: message.body.substring(0, 100),
        });
        return {
            success: true,
            providerMessageId,
            providerResponse: {
                mock: true,
                timestamp: new Date().toISOString(),
            },
        };
    }
    verifyWebhook(payload, signature) {
        const expectedSignature = crypto
            .createHmac('sha256', this.webhookSecret)
            .update(payload)
            .digest('hex');
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    }
    parseWebhook(payload) {
        const data = payload;
        if (!data)
            return null;
        // Support multiple common webhook payload formats:
        // 1. Standard format: { messageId, event, timestamp?, metadata? }
        // 2. SendGrid-like: { sg_message_id, event, timestamp }
        // 3. Mailgun-like: { "Message-Id", event, timestamp }
        // 4. Generic: { id, type/status/event, timestamp }
        const messageId = data.messageId ||
            data.sg_message_id ||
            data['Message-Id'] ||
            data.message_id ||
            data.id ||
            data.providerMessageId;
        const eventName = data.event ||
            data.type ||
            data.status ||
            data.eventType;
        if (!messageId || !eventName) {
            return null;
        }
        const eventTypeMap = {
            // Standard events
            delivered: 'delivered',
            bounced: 'bounced',
            opened: 'opened',
            clicked: 'clicked',
            unsubscribed: 'unsubscribed',
            complained: 'complained',
            failed: 'failed',
            // SendGrid-style
            processed: 'delivered',
            dropped: 'bounced',
            bounce: 'bounced',
            open: 'opened',
            click: 'clicked',
            spamreport: 'complained',
            // Mailgun-style
            accepted: 'delivered',
            rejected: 'failed',
            permanent_fail: 'bounced',
            temporary_fail: 'failed',
            // Generic aliases
            sent: 'delivered',
            success: 'delivered',
            error: 'failed',
            failure: 'failed',
        };
        const eventType = eventTypeMap[eventName.toLowerCase()];
        if (!eventType) {
            return null;
        }
        return {
            providerMessageId: messageId,
            eventType,
            timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
            metadata: data.metadata,
        };
    }
    async healthCheck() {
        return true;
    }
    /**
     * Clear all stored messages (for testing).
     */
    static clearMessages() {
        MockEmailProvider.sentMessages = [];
    }
    /**
     * Get all stored messages (for testing).
     */
    static getMessages() {
        return MockEmailProvider.sentMessages;
    }
}
/**
 * Mock SMS provider for local development and testing.
 */
export class MockSmsProvider {
    name = 'mock_sms';
    channel = 'sms';
    webhookSecret;
    shouldFail;
    failureRate;
    static sentMessages = [];
    constructor(config) {
        this.webhookSecret = config.webhookSecret || 'mock-webhook-secret';
        this.shouldFail = config.shouldFail || false;
        this.failureRate = config.failureRate || 0;
    }
    async send(message) {
        if (this.shouldFail || Math.random() < this.failureRate) {
            return {
                success: false,
                error: 'Mock SMS provider failure',
                retryable: true,
            };
        }
        const providerMessageId = `mock_sms_${crypto.randomUUID()}`;
        MockSmsProvider.sentMessages.push({
            id: providerMessageId,
            message,
            sentAt: new Date(),
        });
        console.log(`[MockSmsProvider] SMS sent:`, {
            id: providerMessageId,
            to: message.to,
            bodyPreview: message.body.substring(0, 50),
        });
        return {
            success: true,
            providerMessageId,
            providerResponse: { mock: true },
        };
    }
    verifyWebhook(payload, signature) {
        const expectedSignature = crypto
            .createHmac('sha256', this.webhookSecret)
            .update(payload)
            .digest('hex');
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    }
    parseWebhook(payload) {
        const data = payload;
        if (!data)
            return null;
        // Support multiple common SMS webhook payload formats:
        // 1. Standard: { messageId, status }
        // 2. Twilio-like: { MessageSid, MessageStatus }
        // 3. Generic: { id, status/event }
        const messageId = data.messageId ||
            data.MessageSid ||
            data.message_sid ||
            data.message_id ||
            data.id ||
            data.providerMessageId;
        const statusName = data.status ||
            data.MessageStatus ||
            data.event ||
            data.type;
        if (!messageId || !statusName) {
            return null;
        }
        const statusMap = {
            // Standard statuses
            delivered: 'delivered',
            failed: 'failed',
            undelivered: 'bounced',
            // Twilio-style
            sent: 'delivered',
            queued: 'delivered',
            accepted: 'delivered',
            receiving: 'delivered',
            received: 'delivered',
        };
        return {
            providerMessageId: messageId,
            eventType: statusMap[statusName.toLowerCase()] || 'failed',
            timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
        };
    }
    async healthCheck() {
        return true;
    }
    static clearMessages() {
        MockSmsProvider.sentMessages = [];
    }
    static getMessages() {
        return MockSmsProvider.sentMessages;
    }
}
/**
 * Mock WhatsApp provider for local development and testing.
 */
export class MockWhatsAppProvider {
    name = 'mock_whatsapp';
    channel = 'whatsapp';
    webhookSecret;
    shouldFail;
    failureRate;
    static sentMessages = [];
    constructor(config) {
        this.webhookSecret = config.webhookSecret || 'mock-webhook-secret';
        this.shouldFail = config.shouldFail || false;
        this.failureRate = config.failureRate || 0;
    }
    async send(message) {
        if (this.shouldFail || Math.random() < this.failureRate) {
            return {
                success: false,
                error: 'Mock WhatsApp provider failure',
                retryable: true,
            };
        }
        const providerMessageId = `mock_whatsapp_${crypto.randomUUID()}`;
        MockWhatsAppProvider.sentMessages.push({
            id: providerMessageId,
            message,
            sentAt: new Date(),
        });
        console.log(`[MockWhatsAppProvider] WhatsApp sent:`, {
            id: providerMessageId,
            to: message.to,
            bodyPreview: message.body.substring(0, 50),
            hasMedia: !!message.metadata?.mediaUrl,
        });
        return {
            success: true,
            providerMessageId,
            providerResponse: { mock: true, channel: 'whatsapp' },
        };
    }
    verifyWebhook(payload, signature) {
        const expectedSignature = crypto
            .createHmac('sha256', this.webhookSecret)
            .update(payload)
            .digest('hex');
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    }
    parseWebhook(payload) {
        const data = payload;
        if (!data)
            return null;
        const messageId = data.messageId || data.MessageSid || data.id;
        const statusName = data.status || data.MessageStatus || data.event;
        if (!messageId || !statusName) {
            return null;
        }
        const statusMap = {
            delivered: 'delivered',
            read: 'opened',
            failed: 'failed',
            sent: 'delivered',
        };
        return {
            providerMessageId: messageId,
            eventType: statusMap[statusName.toLowerCase()] || 'failed',
            timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
        };
    }
    async healthCheck() {
        return true;
    }
    static clearMessages() {
        MockWhatsAppProvider.sentMessages = [];
    }
    static getMessages() {
        return MockWhatsAppProvider.sentMessages;
    }
}
/**
 * Mock RCS provider for local development and testing.
 */
export class MockRcsProvider {
    name = 'mock_rcs';
    channel = 'rcs';
    webhookSecret;
    shouldFail;
    failureRate;
    static sentMessages = [];
    constructor(config) {
        this.webhookSecret = config.webhookSecret || 'mock-webhook-secret';
        this.shouldFail = config.shouldFail || false;
        this.failureRate = config.failureRate || 0;
    }
    async send(message) {
        if (this.shouldFail || Math.random() < this.failureRate) {
            return {
                success: false,
                error: 'Mock RCS provider failure',
                retryable: true,
            };
        }
        const providerMessageId = `mock_rcs_${crypto.randomUUID()}`;
        MockRcsProvider.sentMessages.push({
            id: providerMessageId,
            message,
            sentAt: new Date(),
        });
        console.log(`[MockRcsProvider] RCS sent:`, {
            id: providerMessageId,
            to: message.to,
            bodyPreview: message.body.substring(0, 50),
            hasImage: !!message.metadata?.imageUrl,
        });
        return {
            success: true,
            providerMessageId,
            providerResponse: { mock: true, channel: 'rcs' },
        };
    }
    verifyWebhook(payload, signature) {
        const expectedSignature = crypto
            .createHmac('sha256', this.webhookSecret)
            .update(payload)
            .digest('hex');
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    }
    parseWebhook(payload) {
        const data = payload;
        if (!data)
            return null;
        const messageId = data.messageId || data.MessageSid || data.id;
        const statusName = data.status || data.MessageStatus || data.event;
        if (!messageId || !statusName) {
            return null;
        }
        const statusMap = {
            delivered: 'delivered',
            read: 'opened',
            failed: 'failed',
            sent: 'delivered',
        };
        return {
            providerMessageId: messageId,
            eventType: statusMap[statusName.toLowerCase()] || 'failed',
            timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
        };
    }
    async healthCheck() {
        return true;
    }
    static clearMessages() {
        MockRcsProvider.sentMessages = [];
    }
    static getMessages() {
        return MockRcsProvider.sentMessages;
    }
}
/**
 * Mock Push provider for local development and testing.
 */
export class MockPushProvider {
    name = 'mock_push';
    channel = 'push';
    webhookSecret;
    shouldFail;
    failureRate;
    static sentMessages = [];
    constructor(config) {
        this.webhookSecret = config.webhookSecret || 'mock-webhook-secret';
        this.shouldFail = config.shouldFail || false;
        this.failureRate = config.failureRate || 0;
    }
    async send(message) {
        if (this.shouldFail || Math.random() < this.failureRate) {
            return {
                success: false,
                error: 'Mock Push provider failure',
                retryable: true,
            };
        }
        const providerMessageId = `mock_push_${crypto.randomUUID()}`;
        MockPushProvider.sentMessages.push({
            id: providerMessageId,
            message,
            sentAt: new Date(),
        });
        console.log(`[MockPushProvider] Push notification sent:`, {
            id: providerMessageId,
            token: message.to.substring(0, 20) + '...',
            title: message.subject,
            bodyPreview: message.body.substring(0, 50),
        });
        return {
            success: true,
            providerMessageId,
            providerResponse: { mock: true, channel: 'push' },
        };
    }
    verifyWebhook(payload, signature) {
        const expectedSignature = crypto
            .createHmac('sha256', this.webhookSecret)
            .update(payload)
            .digest('hex');
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    }
    parseWebhook(payload) {
        const data = payload;
        if (!data)
            return null;
        const messageId = data.messageId || data.message_id || data.id;
        const eventType = data.eventType || data.event;
        if (!messageId) {
            return null;
        }
        const eventTypeMap = {
            delivered: 'delivered',
            opened: 'opened',
            clicked: 'clicked',
            failed: 'failed',
        };
        return {
            providerMessageId: messageId,
            eventType: eventTypeMap[eventType?.toLowerCase()] || 'delivered',
            timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
        };
    }
    async healthCheck() {
        return true;
    }
    static clearMessages() {
        MockPushProvider.sentMessages = [];
    }
    static getMessages() {
        return MockPushProvider.sentMessages;
    }
}
