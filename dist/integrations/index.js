/**
 * E-commerce integrations module
 * Provides adapters for connecting to various e-commerce platforms
 */
// Core exports
export * from './types';
export { platformRegistry } from './registry';
export * from './sync-service';
// Platform adapters
export { ShopifyAdapter, createShopifyAdapter } from './shopify/adapter';
export { WooCommerceAdapter, createWooCommerceAdapter } from './woocommerce/adapter';
export { BigCommerceAdapter, createBigCommerceAdapter } from './bigcommerce/adapter';
export { WixAdapter, createWixAdapter } from './wix/adapter';
export { SalesforceAdapter, createSalesforceAdapter } from './salesforce/adapter';
export { MagentoAdapter, createMagentoAdapter } from './magento/adapter';
export { SquareAdapter, createSquareAdapter } from './square/adapter';
// Initialization function
import { platformRegistry } from './registry';
import { createShopifyAdapter } from './shopify/adapter';
import { createWooCommerceAdapter } from './woocommerce/adapter';
import { createBigCommerceAdapter } from './bigcommerce/adapter';
import { createWixAdapter } from './wix/adapter';
import { createSalesforceAdapter } from './salesforce/adapter';
import { createMagentoAdapter } from './magento/adapter';
import { createSquareAdapter } from './square/adapter';
/**
 * Initialize platform adapters from environment configuration
 * Call this during server startup
 */
export function initializeIntegrations() {
    // Initialize Shopify if configured
    const shopifyApiKey = process.env.SHOPIFY_API_KEY;
    const shopifyApiSecret = process.env.SHOPIFY_API_SECRET;
    if (shopifyApiKey && shopifyApiSecret) {
        const adapter = createShopifyAdapter({
            apiKey: shopifyApiKey,
            apiSecret: shopifyApiSecret,
            apiVersion: process.env.SHOPIFY_API_VERSION || '2024-01',
        });
        platformRegistry.register(adapter, {
            platform: 'SHOPIFY',
            apiKey: shopifyApiKey,
            apiSecret: shopifyApiSecret,
            scopes: ['read_customers', 'read_orders', 'read_products', 'read_checkouts'],
            apiVersion: process.env.SHOPIFY_API_VERSION || '2024-01',
            webhookTopics: [
                'customers/create',
                'customers/update',
                'orders/create',
                'orders/updated',
                'app/uninstalled',
            ],
        });
        console.log('✓ Shopify integration initialized');
    }
    // Initialize WooCommerce (always available, uses per-store credentials)
    const wooAdapter = createWooCommerceAdapter();
    platformRegistry.register(wooAdapter, {
        platform: 'WOOCOMMERCE',
        scopes: ['read_write'],
        webhookTopics: ['customer.created', 'customer.updated', 'order.created', 'order.updated'],
    });
    console.log('✓ WooCommerce integration initialized');
    // Initialize BigCommerce if configured
    const bcClientId = process.env.BIGCOMMERCE_CLIENT_ID;
    const bcClientSecret = process.env.BIGCOMMERCE_CLIENT_SECRET;
    if (bcClientId && bcClientSecret) {
        const adapter = createBigCommerceAdapter({
            clientId: bcClientId,
            clientSecret: bcClientSecret,
        });
        platformRegistry.register(adapter, {
            platform: 'BIGCOMMERCE',
            apiKey: bcClientId,
            apiSecret: bcClientSecret,
            scopes: ['store_v2_customers', 'store_v2_orders', 'store_v2_products'],
            webhookTopics: [
                'store/customer/created',
                'store/customer/updated',
                'store/order/created',
                'store/order/updated',
            ],
        });
        console.log('✓ BigCommerce integration initialized');
    }
    // Initialize Wix if configured
    const wixAppId = process.env.WIX_APP_ID;
    const wixAppSecret = process.env.WIX_APP_SECRET;
    if (wixAppId && wixAppSecret) {
        const adapter = createWixAdapter({
            appId: wixAppId,
            appSecret: wixAppSecret,
        });
        platformRegistry.register(adapter, {
            platform: 'WIX',
            apiKey: wixAppId,
            apiSecret: wixAppSecret,
            scopes: ['WIX_STORES.READ_ORDERS', 'CRM.CONTACTS_READ'],
            webhookTopics: [
                'wix.contacts.v4.contact_created',
                'wix.contacts.v4.contact_updated',
                'wix.ecom.v1.order_created',
                'wix.ecom.v1.order_updated',
            ],
        });
        console.log('✓ Wix integration initialized');
    }
    // Initialize Salesforce if configured
    const sfClientId = process.env.SALESFORCE_CLIENT_ID;
    const sfClientSecret = process.env.SALESFORCE_CLIENT_SECRET;
    if (sfClientId && sfClientSecret) {
        const adapter = createSalesforceAdapter({
            clientId: sfClientId,
            clientSecret: sfClientSecret,
            loginUrl: process.env.SALESFORCE_LOGIN_URL,
        });
        platformRegistry.register(adapter, {
            platform: 'SALESFORCE',
            apiKey: sfClientId,
            apiSecret: sfClientSecret,
            scopes: ['api', 'refresh_token'],
            webhookTopics: ['Contact.create', 'Contact.update', 'Order.create', 'Order.update'],
        });
        console.log('✓ Salesforce integration initialized');
    }
    // Initialize Magento (always available, uses per-store tokens)
    const magentoAdapter = createMagentoAdapter();
    platformRegistry.register(magentoAdapter, {
        platform: 'MAGENTO',
        scopes: ['customers', 'orders', 'products'],
        webhookTopics: [
            'customer_save_after',
            'customer_delete_after',
            'sales_order_place_after',
            'sales_order_save_after',
        ],
    });
    console.log('✓ Magento integration initialized');
    // Initialize Square if configured
    const squareAppId = process.env.SQUARE_APPLICATION_ID;
    const squareAppSecret = process.env.SQUARE_APPLICATION_SECRET;
    if (squareAppId && squareAppSecret) {
        const adapter = createSquareAdapter({
            applicationId: squareAppId,
            applicationSecret: squareAppSecret,
            environment: process.env.SQUARE_ENVIRONMENT || 'production',
        });
        platformRegistry.register(adapter, {
            platform: 'SQUARE',
            apiKey: squareAppId,
            apiSecret: squareAppSecret,
            scopes: ['CUSTOMERS_READ', 'ORDERS_READ', 'PAYMENTS_READ'],
            webhookTopics: ['customer.created', 'customer.updated', 'order.created', 'order.updated'],
        });
        console.log('✓ Square integration initialized');
    }
    console.log(`Integrations ready: ${platformRegistry.getRegisteredPlatforms().join(', ')}`);
}
