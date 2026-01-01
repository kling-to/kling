import crypto from 'crypto';
const SQUARE_WEBHOOK_EVENTS = [
    'customer.created',
    'customer.updated',
    'customer.deleted',
    'order.created',
    'order.updated',
    'order.fulfillment.updated',
    'payment.completed',
    'refund.created',
];
export class SquareAdapter {
    platform = 'SQUARE';
    config;
    baseUrl;
    constructor(config) {
        this.config = config;
        this.baseUrl =
            config.environment === 'sandbox'
                ? 'https://connect.squareupsandbox.com'
                : 'https://connect.squareup.com';
    }
    getAuthUrl(_locationId, redirectUri, state) {
        const scopes = [
            'CUSTOMERS_READ',
            'ORDERS_READ',
            'PAYMENTS_READ',
            'MERCHANT_PROFILE_READ',
            'ITEMS_READ',
        ].join('+');
        return (`${this.baseUrl}/oauth2/authorize?` +
            `client_id=${this.config.applicationId}` +
            `&scope=${scopes}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&state=${state}` +
            `&session=false`);
    }
    async exchangeCodeForToken(_locationId, code, redirectUri) {
        const response = await fetch(`${this.baseUrl}/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: this.config.applicationId,
                client_secret: this.config.accessToken,
                code,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }),
        });
        if (!response.ok) {
            throw new Error(`Failed to exchange code: ${await response.text()}`);
        }
        const data = (await response.json());
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: new Date(data.expires_at),
            scopes: ['CUSTOMERS_READ', 'ORDERS_READ', 'PAYMENTS_READ'],
        };
    }
    async refreshAccessToken(refreshToken) {
        const response = await fetch(`${this.baseUrl}/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: this.config.applicationId,
                client_secret: this.config.accessToken,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            }),
        });
        if (!response.ok) {
            throw new Error(`Failed to refresh token: ${await response.text()}`);
        }
        const data = (await response.json());
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: new Date(data.expires_at),
            scopes: ['CUSTOMERS_READ', 'ORDERS_READ', 'PAYMENTS_READ'],
        };
    }
    async registerWebhooks(_locationId, accessToken, callbackUrl) {
        const webhookIds = [];
        const response = await fetch(`${this.baseUrl}/v2/webhooks/subscriptions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                subscription: {
                    name: 'Kling Integration',
                    event_types: SQUARE_WEBHOOK_EVENTS,
                    notification_url: callbackUrl,
                    api_version: '2024-01-18',
                },
                idempotency_key: crypto.randomUUID(),
            }),
        });
        if (response.ok) {
            const data = (await response.json());
            webhookIds.push(data.subscription.id);
        }
        return webhookIds;
    }
    async unregisterWebhooks(_locationId, accessToken, webhookIds) {
        for (const webhookId of webhookIds) {
            try {
                await fetch(`${this.baseUrl}/v2/webhooks/subscriptions/${webhookId}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${accessToken}` },
                });
            }
            catch (error) {
                console.error(`Error unregistering Square webhook ${webhookId}:`, error);
            }
        }
    }
    verifyWebhook(rawBody, signature, secret) {
        const hmac = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
        return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
    }
    async fetchCustomers(_locationId, accessToken, cursor) {
        const limit = 100;
        const params = new URLSearchParams({ limit: String(limit) });
        if (cursor) {
            params.append('cursor', cursor);
        }
        const response = await fetch(`${this.baseUrl}/v2/customers?${params}`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch customers: ${await response.text()}`);
        }
        const result = (await response.json());
        return {
            data: (result.customers || []).map((c) => this.mapCustomer(c)),
            hasMore: !!result.cursor,
            cursor: result.cursor,
        };
    }
    async fetchOrders(locationId, accessToken, cursor, sinceDate) {
        const limit = 100;
        let locations = [];
        if (locationId) {
            locations = [locationId];
        }
        else {
            const locResponse = await fetch(`${this.baseUrl}/v2/locations`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (locResponse.ok) {
                const locData = (await locResponse.json());
                locations = locData.locations?.map((l) => l.id) || [];
            }
        }
        if (locations.length === 0) {
            return { data: [], hasMore: false };
        }
        const body = {
            location_ids: locations,
            limit,
        };
        if (cursor) {
            body.cursor = cursor;
        }
        if (sinceDate) {
            body.query = {
                filter: {
                    date_time_filter: {
                        created_at: {
                            start_at: sinceDate.toISOString(),
                        },
                    },
                },
            };
        }
        const response = await fetch(`${this.baseUrl}/v2/orders/search`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch orders: ${await response.text()}`);
        }
        const result = (await response.json());
        return {
            data: (result.orders || []).filter((o) => o.customer_id).map((o) => this.mapOrder(o)),
            hasMore: !!result.cursor,
            cursor: result.cursor,
        };
    }
    parseWebhookPayload(topic, payload) {
        const data = payload;
        if (topic.includes('customer') && !topic.includes('deleted') && data.data?.object?.customer) {
            return this.mapCustomer(data.data.object.customer);
        }
        if (topic.includes('order') && data.data?.object?.order) {
            const order = data.data.object.order;
            if (order.customer_id) {
                return this.mapOrder(order);
            }
        }
        return null;
    }
    mapCustomer(c) {
        const name = [c.given_name, c.family_name].filter(Boolean).join(' ') ||
            c.nickname ||
            c.company_name ||
            null;
        return {
            externalId: `square:${c.id}`,
            email: c.email_address || null,
            phone: c.phone_number || null,
            name,
            firstName: c.given_name || null,
            lastName: c.family_name || null,
            metadata: {
                squareId: c.id,
                companyName: c.company_name,
                city: c.address?.locality,
                state: c.address?.administrative_district_level_1,
                postalCode: c.address?.postal_code,
                country: c.address?.country,
                emailUnsubscribed: c.preferences?.email_unsubscribed,
            },
            createdAt: new Date(c.created_at),
            updatedAt: new Date(c.updated_at),
        };
    }
    mapOrder(o) {
        let status = 'completed';
        const stateLower = o.state.toLowerCase();
        if (stateLower === 'open' || stateLower === 'draft') {
            status = 'pending';
        }
        else if (stateLower === 'canceled') {
            status = 'cancelled';
        }
        const hasFullRefund = o.refunds?.some((r) => r.status === 'COMPLETED' && r.amount_money?.amount === o.total_money?.amount) || false;
        if (hasFullRefund) {
            status = 'refunded';
        }
        const total = (o.total_money?.amount || 0) / 100;
        const currency = o.total_money?.currency || 'USD';
        const discountName = o.discounts?.[0]?.name || null;
        return {
            externalId: `square:${o.id}`,
            customerExternalId: `square:${o.customer_id}`,
            total,
            currency,
            status,
            couponCode: discountName,
            items: (o.line_items || []).map((item) => ({
                sku: item.catalog_object_id || `sq-${item.uid}`,
                name: item.name || item.variation_name || 'Item',
                category: null,
                brand: null,
                price: (item.base_price_money?.amount || 0) / 100,
                quantity: parseInt(item.quantity, 10) || 1,
                discount: item.total_discount_money?.amount ? item.total_discount_money.amount / 100 : null,
            })),
            purchasedAt: new Date(o.created_at),
        };
    }
}
export function createSquareAdapter(config) {
    return new SquareAdapter({
        platform: 'SQUARE',
        applicationId: config.applicationId,
        accessToken: config.applicationSecret,
        environment: config.environment || 'production',
        scopes: ['CUSTOMERS_READ', 'ORDERS_READ', 'PAYMENTS_READ'],
        webhookTopics: SQUARE_WEBHOOK_EVENTS,
    });
}
