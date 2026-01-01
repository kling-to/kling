import crypto from 'crypto';
const MAGENTO_WEBHOOK_EVENTS = [
    'customer_save_after',
    'customer_delete_after',
    'sales_order_place_after',
    'sales_order_save_after',
];
export class MagentoAdapter {
    platform = 'MAGENTO';
    config;
    constructor(config) {
        this.config = config;
    }
    getAuthUrl(baseUrl, _redirectUri, _state) {
        return `${baseUrl}/admin/integration`;
    }
    async exchangeCodeForToken(baseUrl, code, _redirectUri) {
        const response = await fetch(`${baseUrl}/rest/V1/store/storeConfigs`, {
            headers: {
                Authorization: `Bearer ${code}`,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(`Failed to verify token: ${await response.text()}`);
        }
        return {
            accessToken: code,
            scopes: ['customers', 'orders', 'products'],
        };
    }
    async registerWebhooks(_baseUrl, _accessToken, _callbackUrl) {
        return [];
    }
    async unregisterWebhooks(_baseUrl, _accessToken, _webhookIds) {
    }
    verifyWebhook(rawBody, signature, secret) {
        const hmac = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
        return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
    }
    async fetchCustomers(baseUrl, accessToken, cursor) {
        const pageSize = 100;
        const currentPage = cursor ? parseInt(cursor, 10) : 1;
        const searchCriteria = new URLSearchParams({
            'searchCriteria[pageSize]': String(pageSize),
            'searchCriteria[currentPage]': String(currentPage),
            'searchCriteria[sortOrders][0][field]': 'created_at',
            'searchCriteria[sortOrders][0][direction]': 'DESC',
        });
        const response = await fetch(`${baseUrl}/rest/V1/customers/search?${searchCriteria}`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch customers: ${await response.text()}`);
        }
        const result = (await response.json());
        const totalPages = Math.ceil(result.total_count / pageSize);
        const hasMore = currentPage < totalPages;
        return {
            data: result.items.map((c) => this.mapCustomer(c)),
            hasMore,
            cursor: hasMore ? String(currentPage + 1) : undefined,
        };
    }
    async fetchOrders(baseUrl, accessToken, cursor, sinceDate) {
        const pageSize = 100;
        const currentPage = cursor ? parseInt(cursor, 10) : 1;
        const searchCriteria = new URLSearchParams({
            'searchCriteria[pageSize]': String(pageSize),
            'searchCriteria[currentPage]': String(currentPage),
            'searchCriteria[sortOrders][0][field]': 'created_at',
            'searchCriteria[sortOrders][0][direction]': 'DESC',
        });
        if (sinceDate) {
            searchCriteria.append('searchCriteria[filter_groups][0][filters][0][field]', 'created_at');
            searchCriteria.append('searchCriteria[filter_groups][0][filters][0][value]', sinceDate.toISOString());
            searchCriteria.append('searchCriteria[filter_groups][0][filters][0][condition_type]', 'gteq');
        }
        const response = await fetch(`${baseUrl}/rest/V1/orders?${searchCriteria}`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch orders: ${await response.text()}`);
        }
        const result = (await response.json());
        const totalPages = Math.ceil(result.total_count / pageSize);
        const hasMore = currentPage < totalPages;
        return {
            data: result.items.filter((o) => o.customer_id).map((o) => this.mapOrder(o)),
            hasMore,
            cursor: hasMore ? String(currentPage + 1) : undefined,
        };
    }
    parseWebhookPayload(topic, payload) {
        const data = payload;
        if (topic.includes('customer') && !topic.includes('delete') && data.customer) {
            return this.mapCustomer(data.customer);
        }
        if (topic.includes('order') && data.order && data.order.customer_id) {
            return this.mapOrder(data.order);
        }
        return null;
    }
    mapCustomer(c) {
        const name = [c.firstname, c.lastname].filter(Boolean).join(' ') || null;
        const primaryAddress = c.addresses?.[0];
        return {
            externalId: `magento:${c.id}`,
            email: c.email || null,
            phone: primaryAddress?.telephone || null,
            name,
            firstName: c.firstname || null,
            lastName: c.lastname || null,
            metadata: {
                magentoId: c.id,
                city: primaryAddress?.city,
                region: primaryAddress?.region?.region,
                postalCode: primaryAddress?.postcode,
                country: primaryAddress?.country_id,
                isSubscribed: c.extension_attributes?.is_subscribed,
            },
            createdAt: new Date(c.created_at),
            updatedAt: new Date(c.updated_at),
        };
    }
    mapOrder(o) {
        let status = 'completed';
        const stateLower = o.state.toLowerCase();
        if (stateLower === 'pending' || stateLower === 'new' || stateLower === 'holded') {
            status = 'pending';
        }
        else if (stateLower === 'canceled') {
            status = 'cancelled';
        }
        else if (stateLower === 'closed' && o.status.toLowerCase().includes('refund')) {
            status = 'refunded';
        }
        return {
            externalId: `magento:${o.entity_id}`,
            customerExternalId: `magento:${o.customer_id}`,
            total: o.grand_total,
            currency: o.base_currency_code,
            status,
            couponCode: o.coupon_code || null,
            items: o.items
                .filter((item) => item.product_type !== 'configurable')
                .map((item) => ({
                sku: item.sku,
                name: item.name,
                category: null,
                brand: null,
                price: item.price,
                quantity: item.qty_ordered,
                originalPrice: item.original_price || null,
                discount: item.discount_amount || null,
            })),
            purchasedAt: new Date(o.created_at),
        };
    }
}
export function createMagentoAdapter(config) {
    return new MagentoAdapter({
        platform: 'MAGENTO',
        consumerKey: '',
        consumerSecret: '',
        accessToken: config?.accessToken || '',
        accessTokenSecret: '',
        scopes: ['customers', 'orders', 'products'],
        webhookTopics: MAGENTO_WEBHOOK_EVENTS,
    });
}
