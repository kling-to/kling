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
    getAuthUrl(_instanceUrl, redirectUri, state) {
        const loginUrl = this.config.loginUrl || 'https://login.salesforce.com';
        return (`${loginUrl}/services/oauth2/authorize?` +
            `client_id=${this.config.clientId}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&response_type=code` +
            `&state=${state}`);
    }
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
            refreshToken,
            scopes: ['api', 'refresh_token'],
        };
    }
    async registerWebhooks(_instanceUrl, _accessToken, _callbackUrl) {
        return [];
    }
    async unregisterWebhooks(_instanceUrl, _accessToken, _webhookIds) {
    }
    verifyWebhook(rawBody, signature, secret) {
        const hmac = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
        return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
    }
    async fetchCustomers(instanceUrl, accessToken, cursor) {
        const limit = 200;
        let query = `SELECT Id, Email, Phone, FirstName, LastName, Name, CreatedDate, LastModifiedDate,
                 MailingCity, MailingState, MailingCountry, MailingPostalCode
                 FROM Contact ORDER BY CreatedDate DESC LIMIT ${limit}`;
        if (cursor) {
            query = cursor;
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
    async fetchOrders(instanceUrl, accessToken, cursor, _sinceDate) {
        const limit = 200;
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
                }
            }
        }
        return {
            data: ordersWithItems,
            hasMore: !result.done,
            cursor: result.nextRecordsUrl ? `${instanceUrl}${result.nextRecordsUrl}` : undefined,
        };
    }
    parseWebhookPayload(topic, payload) {
        const data = payload;
        if (topic.includes('Contact') && data.sObject) {
            return this.mapContact(data.sObject);
        }
        return null;
    }
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
            currency: 'USD',
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
