/**
 * Salesforce Platform Adapter
 * Handles OAuth and data sync for Salesforce Commerce Cloud / CRM
 */
import crypto from 'crypto';
const SALESFORCE_WEBHOOK_EVENTS = [
    'Contact.create',
    'Contact.update',
    'Order.create',
    'Order.update',
    'Opportunity.create',
    'Opportunity.update',
];
export class SalesforceAdapter {
    platform = 'SALESFORCE';
    config;
    constructor(config) {
        this.config = config;
    }
    /**
     * Generate OAuth authorization URL
     */
    getAuthUrl(_instanceUrl, redirectUri, state) {
        const loginUrl = this.config.loginUrl || 'https://login.salesforce.com';
        return (`${loginUrl}/services/oauth2/authorize?` +
            `client_id=${this.config.clientId}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&response_type=code` +
            `&state=${state}`);
    }
    /**
     * Exchange authorization code for access token
     */
    async exchangeCodeForToken(_instanceUrl, code, redirectUri) {
        const loginUrl = this.config.loginUrl || 'https://login.salesforce.com';
        const response = await fetch(`${loginUrl}/services/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: this.config.clientId,
                client_secret: this.config.clientSecret,
                code,
                redirect_uri: redirectUri,
            }),
        });
        if (!response.ok) {
            throw new Error(`Failed to exchange code: ${await response.text()}`);
        }
        const data = (await response.json());
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            scopes: ['api', 'refresh_token'],
        };
    }
    /**
     * Refresh access token
     */
    async refreshAccessToken(refreshToken) {
        const loginUrl = this.config.loginUrl || 'https://login.salesforce.com';
        const response = await fetch(`${loginUrl}/services/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: this.config.clientId,
                client_secret: this.config.clientSecret,
                refresh_token: refreshToken,
            }),
        });
        if (!response.ok) {
            throw new Error(`Failed to refresh token: ${await response.text()}`);
        }
        const data = (await response.json());
        return {
            accessToken: data.access_token,
            refreshToken, // Salesforce doesn't always return a new refresh token
            scopes: ['api', 'refresh_token'],
        };
    }
    /**
     * Register webhooks - Salesforce uses Platform Events or Outbound Messages
     * These are typically configured in Salesforce Setup, not via API
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async registerWebhooks(_instanceUrl, _accessToken, _callbackUrl) {
        // Salesforce webhooks are configured via Salesforce Setup UI
        // or using Salesforce Connect / Platform Events
        return [];
    }
    /**
     * Unregister webhooks
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async unregisterWebhooks(_instanceUrl, _accessToken, _webhookIds) {
        // Webhooks are managed via Salesforce Setup
    }
    /**
     * Verify webhook signature (Outbound Messages use certificate validation)
     */
    verifyWebhook(rawBody, signature, secret) {
        // Salesforce Outbound Messages can be verified via the organization ID
        // or using the certificate for signed messages
        const hmac = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
        return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
    }
    /**
     * Fetch customers (Contacts) from Salesforce
     */
    async fetchCustomers(instanceUrl, accessToken, cursor) {
        const limit = 200;
        let query = `SELECT Id, Email, Phone, FirstName, LastName, Name, CreatedDate, LastModifiedDate,
                 MailingCity, MailingState, MailingCountry, MailingPostalCode
                 FROM Contact ORDER BY CreatedDate DESC LIMIT ${limit}`;
        if (cursor) {
            query = cursor; // Use nextRecordsUrl for pagination
        }
        const url = cursor || `${instanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(query)}`;
        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch contacts: ${await response.text()}`);
        }
        const result = (await response.json());
        return {
            data: result.records.map((c) => this.mapContact(c)),
            hasMore: !result.done,
            cursor: result.nextRecordsUrl ? `${instanceUrl}${result.nextRecordsUrl}` : undefined,
        };
    }
    /**
     * Fetch orders from Salesforce
     */
    async fetchOrders(instanceUrl, accessToken, cursor, 
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _sinceDate) {
        const limit = 200;
        // Fetch orders with their line items
        const query = `SELECT Id, AccountId, TotalAmount, Status, OrderNumber, EffectiveDate,
                 CreatedDate, LastModifiedDate
                 FROM Order ORDER BY CreatedDate DESC LIMIT ${limit}`;
        const url = cursor || `${instanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(query)}`;
        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch orders: ${await response.text()}`);
        }
        const result = (await response.json());
        // Fetch order items for each order
        const ordersWithItems = [];
        for (const order of result.records) {
            if (order.AccountId) {
                try {
                    const itemsQuery = `SELECT Id, Product2Id, Quantity, UnitPrice, TotalPrice, Description
                              FROM OrderItem WHERE OrderId = '${order.Id}'`;
                    const itemsResponse = await fetch(`${instanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(itemsQuery)}`, {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            'Content-Type': 'application/json',
                        },
                    });
                    if (itemsResponse.ok) {
                        const itemsResult = (await itemsResponse.json());
                        ordersWithItems.push(this.mapOrder(order, itemsResult.records));
                    }
                }
                catch {
                    // Skip order if can't fetch items
                }
            }
        }
        return {
            data: ordersWithItems,
            hasMore: !result.done,
            cursor: result.nextRecordsUrl ? `${instanceUrl}${result.nextRecordsUrl}` : undefined,
        };
    }
    /**
     * Parse webhook payload (Outbound Message format)
     */
    parseWebhookPayload(topic, payload) {
        const data = payload;
        if (topic.includes('Contact') && data.sObject) {
            return this.mapContact(data.sObject);
        }
        // Orders would need items fetched separately
        return null;
    }
    // ------------------------------------------------------
    // Private helper methods
    // ------------------------------------------------------
    mapContact(c) {
        const name = c.Name || [c.FirstName, c.LastName].filter(Boolean).join(' ') || null;
        return {
            externalId: `salesforce:${c.Id}`,
            email: c.Email || null,
            phone: c.Phone || null,
            name,
            firstName: c.FirstName || null,
            lastName: c.LastName || null,
            metadata: {
                salesforceId: c.Id,
                city: c.MailingCity,
                state: c.MailingState,
                country: c.MailingCountry,
                postalCode: c.MailingPostalCode,
            },
            createdAt: new Date(c.CreatedDate),
            updatedAt: new Date(c.LastModifiedDate),
        };
    }
    mapOrder(o, items) {
        let status = 'completed';
        const statusLower = o.Status.toLowerCase();
        if (statusLower === 'draft' || statusLower === 'pending') {
            status = 'pending';
        }
        else if (statusLower === 'cancelled' || statusLower === 'canceled') {
            status = 'cancelled';
        }
        return {
            externalId: `salesforce:${o.Id}`,
            customerExternalId: `salesforce:${o.AccountId}`,
            total: o.TotalAmount,
            currency: 'USD', // Salesforce stores currency in multi-currency orgs
            status,
            couponCode: null,
            items: items.map((item) => ({
                sku: item.Product2Id || `sf-item-${item.Id}`,
                name: item.Description || 'Order Item',
                category: null,
                brand: null,
                price: item.UnitPrice,
                quantity: item.Quantity,
            })),
            purchasedAt: new Date(o.EffectiveDate || o.CreatedDate),
        };
    }
}
/**
 * Create Salesforce adapter
 */
export function createSalesforceAdapter(config) {
    return new SalesforceAdapter({
        platform: 'SALESFORCE',
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        loginUrl: config.loginUrl || 'https://login.salesforce.com',
        scopes: ['api', 'refresh_token'],
        webhookTopics: SALESFORCE_WEBHOOK_EVENTS,
    });
}
