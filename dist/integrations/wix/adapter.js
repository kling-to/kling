/**
 * Wix Platform Adapter
 * Handles OAuth and data sync for Wix Stores
 */
import crypto from 'crypto';
const WIX_WEBHOOK_EVENTS = [
    'wix.contacts.v4.contact_created',
    'wix.contacts.v4.contact_updated',
    'wix.contacts.v4.contact_deleted',
    'wix.ecom.v1.order_created',
    'wix.ecom.v1.order_updated',
    'wix.ecom.v1.order_approved',
    'wix.ecom.v1.order_canceled',
];
export class WixAdapter {
    platform = 'WIX';
    config;
    constructor(config) {
        this.config = config;
    }
    /**
     * Generate OAuth authorization URL
     */
    getAuthUrl(_instanceId, redirectUri, state) {
        return (`https://www.wix.com/installer/install?` +
            `appId=${this.config.appId}` +
            `&redirectUrl=${encodeURIComponent(redirectUri)}` +
            `&state=${state}`);
    }
    /**
     * Exchange authorization code for access token
     */
    async exchangeCodeForToken(instanceId, code, _redirectUri) {
        const response = await fetch('https://www.wixapis.com/oauth/access', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                grant_type: 'authorization_code',
                client_id: this.config.appId,
                client_secret: this.config.appSecret,
                code,
            }),
        });
        if (!response.ok) {
            throw new Error(`Failed to exchange code: ${await response.text()}`);
        }
        const data = (await response.json());
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: new Date(Date.now() + data.expires_in * 1000),
            scopes: this.config.scopes,
        };
    }
    /**
     * Refresh access token
     */
    async refreshAccessToken(refreshToken) {
        const response = await fetch('https://www.wixapis.com/oauth/access', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                grant_type: 'refresh_token',
                client_id: this.config.appId,
                client_secret: this.config.appSecret,
                refresh_token: refreshToken,
            }),
        });
        if (!response.ok) {
            throw new Error(`Failed to refresh token: ${await response.text()}`);
        }
        const data = (await response.json());
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: new Date(Date.now() + data.expires_in * 1000),
            scopes: this.config.scopes,
        };
    }
    /**
     * Register webhooks - Wix uses app configuration for webhooks
     */
    async registerWebhooks(_instanceId, _accessToken, _callbackUrl) {
        // Wix webhooks are configured in the Wix Developers Center
        // They cannot be programmatically registered
        return [];
    }
    /**
     * Unregister webhooks
     */
    async unregisterWebhooks(_instanceId, _accessToken, _webhookIds) {
        // Wix webhooks are configured in the Wix Developers Center
    }
    /**
     * Verify webhook signature
     */
    verifyWebhook(rawBody, signature, secret) {
        const hmac = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
        return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
    }
    /**
     * Fetch customers (contacts) from Wix
     */
    async fetchCustomers(_instanceId, accessToken, cursor) {
        const limit = 100;
        const body = {
            paging: { limit },
        };
        if (cursor) {
            body.paging.offset = parseInt(cursor, 10);
        }
        const response = await fetch('https://www.wixapis.com/contacts/v4/contacts/query', {
            method: 'POST',
            headers: {
                Authorization: accessToken,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch contacts: ${await response.text()}`);
        }
        const result = (await response.json());
        return {
            data: result.contacts.map((c) => this.mapContact(c)),
            hasMore: result.pagingMetadata.hasNext,
            cursor: result.pagingMetadata.hasNext
                ? String(result.pagingMetadata.offset + limit)
                : undefined,
        };
    }
    /**
     * Fetch orders from Wix
     */
    async fetchOrders(_instanceId, accessToken, cursor, _sinceDate) {
        const limit = 100;
        const body = {
            paging: { limit },
        };
        if (cursor) {
            body.paging.offset = parseInt(cursor, 10);
        }
        const response = await fetch('https://www.wixapis.com/ecom/v1/orders/query', {
            method: 'POST',
            headers: {
                Authorization: accessToken,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch orders: ${await response.text()}`);
        }
        const result = (await response.json());
        return {
            data: result.orders.filter((o) => o.buyerInfo.contactId).map((o) => this.mapOrder(o)),
            hasMore: result.pagingMetadata.hasNext,
            cursor: result.pagingMetadata.hasNext
                ? String(result.pagingMetadata.offset + limit)
                : undefined,
        };
    }
    /**
     * Parse webhook payload
     */
    parseWebhookPayload(topic, payload) {
        const data = payload;
        if (topic.includes('contact') && !topic.includes('deleted') && data.data) {
            return this.mapContact(data.data);
        }
        if (topic.includes('order') && !topic.includes('canceled') && data.data) {
            const order = data.data;
            if (order.buyerInfo.contactId) {
                return this.mapOrder(order);
            }
        }
        return null;
    }
    // ------------------------------------------------------
    // Private helper methods
    // ------------------------------------------------------
    mapContact(c) {
        const firstName = c.info?.name?.first || null;
        const lastName = c.info?.name?.last || null;
        const name = [firstName, lastName].filter(Boolean).join(' ') || null;
        return {
            externalId: `wix:${c.id}`,
            email: c.primaryInfo?.email || null,
            phone: c.primaryInfo?.phone || null,
            name,
            firstName,
            lastName,
            metadata: {
                wixId: c.id,
            },
            createdAt: new Date(c.createdDate),
            updatedAt: new Date(c.updatedDate),
        };
    }
    mapOrder(o) {
        let status = 'completed';
        switch (o.status.toLowerCase()) {
            case 'pending':
            case 'not_paid':
                status = 'pending';
                break;
            case 'approved':
            case 'paid':
            case 'fulfilled':
                status = 'completed';
                break;
            case 'canceled':
                status = 'cancelled';
                break;
        }
        const couponCode = o.appliedDiscounts?.find((d) => d.coupon)?.coupon?.code || null;
        return {
            externalId: `wix:${o.id}`,
            customerExternalId: `wix:${o.buyerInfo.contactId}`,
            total: parseFloat(o.totals.total.amount),
            currency: o.totals.total.currency,
            status,
            couponCode,
            items: o.lineItems.map((item) => ({
                sku: item.sku || item.catalogReference?.catalogItemId || `wix-${item.id}`,
                name: item.name,
                category: null,
                brand: null,
                price: parseFloat(item.price.amount),
                quantity: item.quantity,
            })),
            purchasedAt: new Date(o.createdDate),
        };
    }
}
/**
 * Create Wix adapter
 */
export function createWixAdapter(config) {
    return new WixAdapter({
        platform: 'WIX',
        appId: config.appId,
        appSecret: config.appSecret,
        scopes: config.scopes || [
            'WIX_STORES.READ_ORDERS',
            'WIX_STORES.READ_PRODUCTS',
            'CRM.CONTACTS_READ',
        ],
        webhookTopics: WIX_WEBHOOK_EVENTS,
    });
}
