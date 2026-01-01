import crypto from 'crypto';
const SHOPIFY_WEBHOOK_TOPICS = [
    'customers/create',
    'customers/update',
    'customers/delete',
    'orders/create',
    'orders/updated',
    'orders/cancelled',
    'refunds/create',
    'carts/create',
    'carts/update',
    'app/uninstalled',
];
export class ShopifyAdapter {
    platform = 'SHOPIFY';
    config;
    constructor(config) {
        this.config = config;
    }
    getAuthUrl(shopDomain, redirectUri, state) {
        const scopes = this.config.scopes.join(',');
        const shop = this.normalizeShopDomain(shopDomain);
        return (`https://${shop}/admin/oauth/authorize?` +
            `client_id=${this.config.apiKey}` +
            `&scope=${scopes}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&state=${state}`);
    }
    async exchangeCodeForToken(shopDomain, code, _redirectUri) {
        const shop = this.normalizeShopDomain(shopDomain);
        const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: this.config.apiKey,
                client_secret: this.config.apiSecret,
                code,
            }),
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to exchange code for token: ${error}`);
        }
        const data = (await response.json());
        return {
            accessToken: data.access_token,
            scopes: data.scope.split(','),
        };
    }
    async registerWebhooks(shopDomain, accessToken, callbackUrl) {
        const shop = this.normalizeShopDomain(shopDomain);
        const webhookIds = [];
        for (const topic of SHOPIFY_WEBHOOK_TOPICS) {
            try {
                const response = await fetch(`https://${shop}/admin/api/${this.config.apiVersion}/webhooks.json`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Shopify-Access-Token': accessToken,
                    },
                    body: JSON.stringify({
                        webhook: {
                            topic,
                            address: `${callbackUrl}?topic=${encodeURIComponent(topic)}`,
                            format: 'json',
                        },
                    }),
                });
                if (response.ok) {
                    const data = (await response.json());
                    webhookIds.push(data.webhook.id.toString());
                }
                else {
                    console.warn(`Failed to register webhook ${topic}:`, await response.text());
                }
            }
            catch (error) {
                console.error(`Error registering webhook ${topic}:`, error);
            }
        }
        return webhookIds;
    }
    async unregisterWebhooks(shopDomain, accessToken, webhookIds) {
        const shop = this.normalizeShopDomain(shopDomain);
        for (const webhookId of webhookIds) {
            try {
                await fetch(`https://${shop}/admin/api/${this.config.apiVersion}/webhooks/${webhookId}.json`, {
                    method: 'DELETE',
                    headers: { 'X-Shopify-Access-Token': accessToken },
                });
            }
            catch (error) {
                console.error(`Error unregistering webhook ${webhookId}:`, error);
            }
        }
    }
    verifyWebhook(rawBody, signature, secret) {
        const hmac = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
        return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
    }
    async fetchCustomers(shopDomain, accessToken, cursor) {
        const shop = this.normalizeShopDomain(shopDomain);
        const limit = 250;
        let url = `https://${shop}/admin/api/${this.config.apiVersion}/customers.json?limit=${limit}`;
        if (cursor) {
            url = cursor;
        }
        const response = await fetch(url, {
            headers: { 'X-Shopify-Access-Token': accessToken },
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch customers: ${await response.text()}`);
        }
        const data = (await response.json());
        const linkHeader = response.headers.get('Link');
        const nextLink = this.parseNextLink(linkHeader);
        return {
            data: data.customers.map((c) => this.mapCustomer(c)),
            hasMore: !!nextLink,
            cursor: nextLink,
        };
    }
    async fetchOrders(shopDomain, accessToken, cursor, sinceDate) {
        const shop = this.normalizeShopDomain(shopDomain);
        const limit = 250;
        let url = `https://${shop}/admin/api/${this.config.apiVersion}/orders.json?limit=${limit}&status=any`;
        if (sinceDate) {
            url += `&created_at_min=${sinceDate.toISOString()}`;
        }
        if (cursor) {
            url = cursor;
        }
        const response = await fetch(url, {
            headers: { 'X-Shopify-Access-Token': accessToken },
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch orders: ${await response.text()}`);
        }
        const data = (await response.json());
        const linkHeader = response.headers.get('Link');
        const nextLink = this.parseNextLink(linkHeader);
        return {
            data: data.orders.map((o) => this.mapOrder(o)),
            hasMore: !!nextLink,
            cursor: nextLink,
        };
    }
    parseWebhookPayload(topic, payload) {
        switch (topic) {
            case 'customers/create':
            case 'customers/update':
                return this.mapCustomer(payload);
            case 'orders/create':
            case 'orders/updated':
            case 'orders/cancelled':
                return this.mapOrder(payload);
            case 'carts/create':
            case 'carts/update':
                return this.mapCart(payload);
            case 'refunds/create':
                const refundPayload = payload;
                console.log('Refund received for order:', refundPayload.order_id);
                return null;
            case 'customers/delete':
            case 'app/uninstalled':
                return null;
            default:
                console.warn(`Unknown Shopify webhook topic: ${topic}`);
                return null;
        }
    }
    normalizeShopDomain(shop) {
        if (!shop.includes('.')) {
            return `${shop}.myshopify.com`;
        }
        return shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
    }
    parseNextLink(linkHeader) {
        if (!linkHeader)
            return undefined;
        const links = linkHeader.split(',');
        for (const link of links) {
            const match = link.match(/<([^>]+)>;\s*rel="next"/);
            if (match) {
                return match[1];
            }
        }
        return undefined;
    }
    mapCustomer(c) {
        const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || null;
        return {
            externalId: `shopify:${c.id}`,
            email: c.email || null,
            phone: c.phone || null,
            name,
            firstName: c.first_name || null,
            lastName: c.last_name || null,
            metadata: {
                shopifyId: c.id,
                tags: c.tags,
                note: c.note,
                acceptsMarketing: c.accepts_marketing,
            },
            createdAt: new Date(c.created_at),
            updatedAt: new Date(c.updated_at),
        };
    }
    mapOrder(o) {
        const customerId = o.customer?.id;
        if (!customerId) {
            throw new Error(`Order ${o.id} has no customer`);
        }
        let status = 'completed';
        if (o.cancelled_at) {
            status = 'cancelled';
        }
        else if (o.financial_status === 'refunded') {
            status = 'refunded';
        }
        else if (o.financial_status === 'partially_refunded') {
            status = 'partial_refund';
        }
        else if (o.financial_status === 'pending' || o.financial_status === 'authorized') {
            status = 'pending';
        }
        const couponCode = o.discount_codes?.[0]?.code || null;
        return {
            externalId: `shopify:${o.id}`,
            customerExternalId: `shopify:${customerId}`,
            total: parseFloat(o.total_price),
            currency: o.currency,
            status,
            couponCode,
            items: o.line_items.map((item) => ({
                sku: item.sku || `shopify-${item.variant_id}`,
                name: item.title || item.name,
                category: null,
                brand: item.vendor || null,
                price: parseFloat(item.price),
                quantity: item.quantity,
                originalPrice: null,
                discount: item.total_discount ? parseFloat(item.total_discount) : null,
            })),
            purchasedAt: new Date(o.created_at),
        };
    }
    mapCart(c) {
        return {
            externalId: `shopify:cart:${c.token}`,
            customerExternalId: c.customer?.id
                ? `shopify:${c.customer.id}`
                : `shopify:anonymous:${c.token}`,
            items: c.line_items.map((item) => ({
                sku: item.sku || `shopify-${item.variant_id}`,
                name: item.title || item.name,
                category: null,
                brand: item.vendor || null,
                price: parseFloat(item.price),
                quantity: item.quantity,
            })),
            total: parseFloat(c.total_price),
            currency: c.currency,
        };
    }
}
export function createShopifyAdapter(config) {
    return new ShopifyAdapter({
        platform: 'SHOPIFY',
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
        scopes: config.scopes || ['read_customers', 'read_orders', 'read_products', 'read_checkouts'],
        apiVersion: config.apiVersion || '2024-01',
        webhookTopics: SHOPIFY_WEBHOOK_TOPICS,
    });
}
