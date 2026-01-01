import crypto from 'crypto';
const WOOCOMMERCE_WEBHOOK_TOPICS = [
    'customer.created',
    'customer.updated',
    'customer.deleted',
    'order.created',
    'order.updated',
    'order.deleted',
    'order.refunded',
];
export class WooCommerceAdapter {
    platform = 'WOOCOMMERCE';
    config;
    constructor(config) {
        this.config = config;
    }
    getAuthUrl(siteUrl, _redirectUri, _state) {
        return `${siteUrl}/wp-admin/admin.php?page=wc-settings&tab=advanced&section=keys`;
    }
    async exchangeCodeForToken(siteUrl, credentials, _redirectUri) {
        const [consumerKey, consumerSecret] = credentials.split(':');
        const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
        const response = await fetch(`${siteUrl}/wp-json/wc/v3/system_status`, {
            headers: { Authorization: `Basic ${auth}` },
        });
        if (!response.ok) {
            throw new Error(`Invalid WooCommerce credentials: ${response.status}`);
        }
        return {
            accessToken: credentials,
            scopes: ['read_write'],
        };
    }
    async registerWebhooks(siteUrl, accessToken, callbackUrl) {
        const [consumerKey, consumerSecret] = accessToken.split(':');
        const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
        const webhookIds = [];
        for (const topic of WOOCOMMERCE_WEBHOOK_TOPICS) {
            try {
                const response = await fetch(`${siteUrl}/wp-json/wc/v3/webhooks`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Basic ${auth}`,
                    },
                    body: JSON.stringify({
                        name: `Kling - ${topic}`,
                        topic,
                        delivery_url: `${callbackUrl}?topic=${encodeURIComponent(topic)}`,
                        status: 'active',
                    }),
                });
                if (response.ok) {
                    const data = (await response.json());
                    webhookIds.push(data.id.toString());
                }
            }
            catch (error) {
                console.error(`Error registering WooCommerce webhook ${topic}:`, error);
            }
        }
        return webhookIds;
    }
    async unregisterWebhooks(siteUrl, accessToken, webhookIds) {
        const [consumerKey, consumerSecret] = accessToken.split(':');
        const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
        for (const webhookId of webhookIds) {
            try {
                await fetch(`${siteUrl}/wp-json/wc/v3/webhooks/${webhookId}?force=true`, {
                    method: 'DELETE',
                    headers: { Authorization: `Basic ${auth}` },
                });
            }
            catch (error) {
                console.error(`Error unregistering WooCommerce webhook ${webhookId}:`, error);
            }
        }
    }
    verifyWebhook(rawBody, signature, secret) {
        const hmac = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
        return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
    }
    async fetchCustomers(siteUrl, accessToken, cursor) {
        const [consumerKey, consumerSecret] = accessToken.split(':');
        const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
        const page = cursor ? parseInt(cursor, 10) : 1;
        const perPage = 100;
        const response = await fetch(`${siteUrl}/wp-json/wc/v3/customers?page=${page}&per_page=${perPage}`, { headers: { Authorization: `Basic ${auth}` } });
        if (!response.ok) {
            throw new Error(`Failed to fetch customers: ${await response.text()}`);
        }
        const customers = (await response.json());
        const totalPages = parseInt(response.headers.get('X-WP-TotalPages') || '1', 10);
        return {
            data: customers.map((c) => this.mapCustomer(c)),
            hasMore: page < totalPages,
            cursor: page < totalPages ? String(page + 1) : undefined,
        };
    }
    async fetchOrders(siteUrl, accessToken, cursor, sinceDate) {
        const [consumerKey, consumerSecret] = accessToken.split(':');
        const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
        const page = cursor ? parseInt(cursor, 10) : 1;
        const perPage = 100;
        let url = `${siteUrl}/wp-json/wc/v3/orders?page=${page}&per_page=${perPage}`;
        if (sinceDate) {
            url += `&after=${sinceDate.toISOString()}`;
        }
        const response = await fetch(url, {
            headers: { Authorization: `Basic ${auth}` },
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch orders: ${await response.text()}`);
        }
        const orders = (await response.json());
        const totalPages = parseInt(response.headers.get('X-WP-TotalPages') || '1', 10);
        return {
            data: orders.filter((o) => o.customer_id > 0).map((o) => this.mapOrder(o)),
            hasMore: page < totalPages,
            cursor: page < totalPages ? String(page + 1) : undefined,
        };
    }
    parseWebhookPayload(topic, payload) {
        if (topic.startsWith('customer.') && topic !== 'customer.deleted') {
            return this.mapCustomer(payload);
        }
        if (topic.startsWith('order.') && topic !== 'order.deleted') {
            const order = payload;
            if (order.customer_id > 0) {
                return this.mapOrder(order);
            }
        }
        return null;
    }
    mapCustomer(c) {
        const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || null;
        return {
            externalId: `woocommerce:${c.id}`,
            email: c.email || null,
            phone: c.billing?.phone || null,
            name,
            firstName: c.first_name || null,
            lastName: c.last_name || null,
            metadata: {
                woocommerceId: c.id,
                username: c.username,
            },
            createdAt: new Date(c.date_created),
            updatedAt: new Date(c.date_modified),
        };
    }
    mapOrder(o) {
        let status = 'completed';
        switch (o.status) {
            case 'pending':
            case 'processing':
            case 'on-hold':
                status = 'pending';
                break;
            case 'completed':
                status = 'completed';
                break;
            case 'refunded':
                status = 'refunded';
                break;
            case 'cancelled':
            case 'failed':
                status = 'cancelled';
                break;
        }
        const couponCode = o.coupon_lines?.[0]?.code || null;
        return {
            externalId: `woocommerce:${o.id}`,
            customerExternalId: `woocommerce:${o.customer_id}`,
            total: parseFloat(o.total),
            currency: o.currency,
            status,
            couponCode,
            items: o.line_items.map((item) => ({
                sku: item.sku || `woo-${item.product_id}`,
                name: item.name,
                category: null,
                brand: null,
                price: item.price,
                quantity: item.quantity,
            })),
            purchasedAt: new Date(o.date_created),
        };
    }
}
export function createWooCommerceAdapter() {
    return new WooCommerceAdapter({
        platform: 'WOOCOMMERCE',
        scopes: ['read_write'],
        webhookTopics: WOOCOMMERCE_WEBHOOK_TOPICS,
    });
}
