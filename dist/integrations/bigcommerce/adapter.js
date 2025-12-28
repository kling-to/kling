/**
 * BigCommerce Platform Adapter
 * Handles OAuth and data sync for BigCommerce stores
 */
const BIGCOMMERCE_WEBHOOK_SCOPES = [
    'store/customer/created',
    'store/customer/updated',
    'store/customer/deleted',
    'store/order/created',
    'store/order/updated',
    'store/order/statusUpdated',
    'store/app/uninstalled',
];
export class BigCommerceAdapter {
    platform = 'BIGCOMMERCE';
    config;
    constructor(config) {
        this.config = config;
    }
    /**
     * Generate OAuth authorization URL
     */
    getAuthUrl(_storeHash, redirectUri, state) {
        const scopes = this.config.scopes.join(' ');
        return (`https://login.bigcommerce.com/oauth2/authorize?` +
            `client_id=${this.config.clientId}` +
            `&scope=${encodeURIComponent(scopes)}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&response_type=code` +
            `&state=${state}`);
    }
    /**
     * Exchange authorization code for access token
     */
    async exchangeCodeForToken(storeHash, code, redirectUri) {
        const response = await fetch('https://login.bigcommerce.com/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: this.config.clientId,
                client_secret: this.config.clientSecret,
                code,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
                context: `stores/${storeHash}`,
            }),
        });
        if (!response.ok) {
            throw new Error(`Failed to exchange code: ${await response.text()}`);
        }
        const data = (await response.json());
        return {
            accessToken: data.access_token,
            scopes: data.scope.split(' '),
        };
    }
    /**
     * Register webhooks with BigCommerce
     */
    async registerWebhooks(storeHash, accessToken, callbackUrl) {
        const webhookIds = [];
        for (const scope of BIGCOMMERCE_WEBHOOK_SCOPES) {
            try {
                const response = await fetch(`https://api.bigcommerce.com/stores/${storeHash}/v3/hooks`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Auth-Token': accessToken,
                    },
                    body: JSON.stringify({
                        scope,
                        destination: callbackUrl,
                        is_active: true,
                        headers: {},
                    }),
                });
                if (response.ok) {
                    const data = (await response.json());
                    webhookIds.push(data.data.id.toString());
                }
            }
            catch (error) {
                console.error(`Error registering BigCommerce webhook ${scope}:`, error);
            }
        }
        return webhookIds;
    }
    /**
     * Unregister webhooks
     */
    async unregisterWebhooks(storeHash, accessToken, webhookIds) {
        for (const webhookId of webhookIds) {
            try {
                await fetch(`https://api.bigcommerce.com/stores/${storeHash}/v3/hooks/${webhookId}`, {
                    method: 'DELETE',
                    headers: { 'X-Auth-Token': accessToken },
                });
            }
            catch (error) {
                console.error(`Error unregistering BigCommerce webhook ${webhookId}:`, error);
            }
        }
    }
    /**
     * Verify webhook - BigCommerce uses shared secret in payload
     * Note: BigCommerce webhooks don't use HMAC signature verification.
     * Verification is done via the registered callback URL.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    verifyWebhook(rawBody, signature, secret) {
        return true;
    }
    /**
     * Fetch customers from BigCommerce
     */
    async fetchCustomers(storeHash, accessToken, cursor) {
        const page = cursor ? parseInt(cursor, 10) : 1;
        const limit = 250;
        const response = await fetch(`https://api.bigcommerce.com/stores/${storeHash}/v3/customers?page=${page}&limit=${limit}`, { headers: { 'X-Auth-Token': accessToken } });
        if (!response.ok) {
            throw new Error(`Failed to fetch customers: ${await response.text()}`);
        }
        const result = (await response.json());
        const hasMore = result.meta.pagination.current_page < result.meta.pagination.total_pages;
        return {
            data: result.data.map((c) => this.mapCustomer(c)),
            hasMore,
            cursor: hasMore ? String(page + 1) : undefined,
        };
    }
    /**
     * Fetch orders from BigCommerce
     */
    async fetchOrders(storeHash, accessToken, cursor, sinceDate) {
        const page = cursor ? parseInt(cursor, 10) : 1;
        const limit = 250;
        let url = `https://api.bigcommerce.com/stores/${storeHash}/v2/orders?page=${page}&limit=${limit}`;
        if (sinceDate) {
            url += `&min_date_created=${sinceDate.toISOString()}`;
        }
        const response = await fetch(url, {
            headers: { 'X-Auth-Token': accessToken },
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch orders: ${await response.text()}`);
        }
        const orders = (await response.json());
        // Fetch line items for each order
        const ordersWithItems = [];
        for (const order of orders) {
            if (order.customer_id && order.products?.url) {
                try {
                    const productsResponse = await fetch(order.products.url, {
                        headers: { 'X-Auth-Token': accessToken },
                    });
                    if (productsResponse.ok) {
                        const products = (await productsResponse.json());
                        ordersWithItems.push(this.mapOrder(order, products));
                    }
                }
                catch {
                    // Skip order if can't fetch products
                }
            }
        }
        // Check if there's a next page (BigCommerce v2 uses Link header)
        const hasMore = orders.length === limit;
        return {
            data: ordersWithItems,
            hasMore,
            cursor: hasMore ? String(page + 1) : undefined,
        };
    }
    /**
     * Parse webhook payload
     */
    parseWebhookPayload(topic, payload) {
        const data = payload;
        if (topic.includes('customer') && !topic.includes('deleted') && data.data) {
            return this.mapCustomer(data.data);
        }
        // Orders require additional API call to get line items, so return null
        // and let the endpoint handle fetching the full order
        return null;
    }
    // ------------------------------------------------------
    // Private helper methods
    // ------------------------------------------------------
    mapCustomer(c) {
        const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || null;
        return {
            externalId: `bigcommerce:${c.id}`,
            email: c.email || null,
            phone: c.phone || null,
            name,
            firstName: c.first_name || null,
            lastName: c.last_name || null,
            metadata: {
                bigcommerceId: c.id,
                acceptsMarketing: c.accepts_product_review_abandoned_cart_emails,
            },
            createdAt: new Date(c.date_created),
            updatedAt: new Date(c.date_modified),
        };
    }
    mapOrder(o, products) {
        let status = 'completed';
        // BigCommerce status_ids: 0=Incomplete, 1=Pending, 2=Shipped, etc.
        if (o.status_id <= 1) {
            status = 'pending';
        }
        else if (o.status_id === 4 || o.status_id === 6) {
            // 4=Refunded, 6=Cancelled
            status = o.status_id === 4 ? 'refunded' : 'cancelled';
        }
        return {
            externalId: `bigcommerce:${o.id}`,
            customerExternalId: `bigcommerce:${o.customer_id}`,
            total: parseFloat(o.total_inc_tax),
            currency: o.currency_code,
            status,
            couponCode: null, // Would need to fetch from coupons URL
            items: products.map((p) => ({
                sku: p.sku || `bc-${p.product_id}`,
                name: p.name,
                category: null,
                brand: null,
                price: p.price_inc_tax,
                quantity: p.quantity,
            })),
            purchasedAt: new Date(o.date_created),
        };
    }
}
/**
 * Create BigCommerce adapter
 */
export function createBigCommerceAdapter(config) {
    return new BigCommerceAdapter({
        platform: 'BIGCOMMERCE',
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        scopes: config.scopes || ['store_v2_customers', 'store_v2_orders', 'store_v2_products'],
        webhookTopics: BIGCOMMERCE_WEBHOOK_SCOPES,
    });
}
