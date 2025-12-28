/**
 * Integration endpoints for connecting e-commerce platforms
 */
import { z } from 'zod';
import createHttpError from 'http-errors';
import crypto from 'crypto';
import { authFactory, createAuthRoleFactory, publicWithRequestFactory } from '../factories';
import prisma from '../utils/prisma';
import { createAuditLog, AuditActions, extractAuditContext } from '../utils/audit';
import { platformRegistry } from '../integrations/registry';
import { syncCustomersBatch, syncOrdersBatch, createSyncLog, completeSyncLog, } from '../integrations/sync-service';
import { objectIdSchema } from '../utils/validation';
const adminFactory = createAuthRoleFactory('admin');
// ------------------------------------------------------
// Schemas
// ------------------------------------------------------
const integrationSchema = z.object({
    id: z.string(),
    platform: z.enum([
        'SHOPIFY',
        'WOOCOMMERCE',
        'BIGCOMMERCE',
        'WIX',
        'SALESFORCE',
        'MAGENTO',
        'SQUARE',
        'CUSTOM',
    ]),
    name: z.string(),
    shopDomain: z.string().nullable(),
    syncStatus: z.enum(['PENDING', 'SYNCING', 'SYNCED', 'FAILED']),
    lastSyncAt: z.date().nullable(),
    lastSyncError: z.string().nullable(),
    syncCustomers: z.boolean(),
    syncOrders: z.boolean(),
    syncProducts: z.boolean(),
    createdAt: z.date(),
    updatedAt: z.date(),
});
// ------------------------------------------------------
// List integrations
// ------------------------------------------------------
export const listIntegrationsEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'List integrations',
    description: 'List all connected e-commerce platform integrations',
    tag: 'Integrations',
    input: z.object({}),
    output: z.object({
        integrations: z.array(integrationSchema),
        availablePlatforms: z.array(z.string()),
    }),
    handler: async () => {
        const integrations = await prisma.integration.findMany({
            orderBy: { createdAt: 'desc' },
        });
        return {
            integrations: integrations.map((i) => ({
                id: i.id,
                platform: i.platform,
                name: i.name,
                shopDomain: i.shopDomain,
                syncStatus: i.syncStatus,
                lastSyncAt: i.lastSyncAt,
                lastSyncError: i.lastSyncError,
                syncCustomers: i.syncCustomers,
                syncOrders: i.syncOrders,
                syncProducts: i.syncProducts,
                createdAt: i.createdAt,
                updatedAt: i.updatedAt,
            })),
            availablePlatforms: platformRegistry.getRegisteredPlatforms(),
        };
    },
});
// ------------------------------------------------------
// Get integration details
// ------------------------------------------------------
export const getIntegrationEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'Get integration',
    description: 'Get details of a specific integration',
    tag: 'Integrations',
    input: z.object({
        integrationId: objectIdSchema,
    }),
    output: z.object({
        integration: integrationSchema.extend({
            syncLogs: z.array(z.object({
                id: z.string(),
                entityType: z.string(),
                direction: z.string(),
                status: z.string(),
                recordsProcessed: z.number(),
                recordsCreated: z.number(),
                recordsUpdated: z.number(),
                recordsFailed: z.number(),
                startedAt: z.date(),
                completedAt: z.date().nullable(),
                errorMessage: z.string().nullable(),
            })),
        }),
    }),
    handler: async ({ input }) => {
        const integration = await prisma.integration.findUnique({
            where: { id: input.integrationId },
            include: {
                syncLogs: {
                    orderBy: { startedAt: 'desc' },
                    take: 20,
                },
            },
        });
        if (!integration) {
            throw createHttpError(404, 'Integration not found');
        }
        return {
            integration: {
                id: integration.id,
                platform: integration.platform,
                name: integration.name,
                shopDomain: integration.shopDomain,
                syncStatus: integration.syncStatus,
                lastSyncAt: integration.lastSyncAt,
                lastSyncError: integration.lastSyncError,
                syncCustomers: integration.syncCustomers,
                syncOrders: integration.syncOrders,
                syncProducts: integration.syncProducts,
                createdAt: integration.createdAt,
                updatedAt: integration.updatedAt,
                syncLogs: integration.syncLogs.map((log) => ({
                    id: log.id,
                    entityType: log.entityType,
                    direction: log.direction,
                    status: log.status,
                    recordsProcessed: log.recordsProcessed,
                    recordsCreated: log.recordsCreated,
                    recordsUpdated: log.recordsUpdated,
                    recordsFailed: log.recordsFailed,
                    startedAt: log.startedAt,
                    completedAt: log.completedAt,
                    errorMessage: log.errorMessage,
                })),
            },
        };
    },
});
// ------------------------------------------------------
// Delete integration
// ------------------------------------------------------
export const deleteIntegrationEndpoint = adminFactory.build({
    method: 'delete',
    shortDescription: 'Delete integration',
    description: 'Disconnect and delete an integration',
    tag: 'Integrations',
    input: z.object({
        integrationId: objectIdSchema,
    }),
    output: z.object({
        success: z.boolean(),
    }),
    handler: async ({ input, ctx }) => {
        const integration = await prisma.integration.findUnique({
            where: { id: input.integrationId },
        });
        if (!integration) {
            throw createHttpError(404, 'Integration not found');
        }
        // Try to unregister webhooks if we have the adapter and token
        if (integration.accessToken && integration.webhookIds.length > 0) {
            try {
                const adapter = platformRegistry.getAdapter(integration.platform);
                if (adapter && integration.shopDomain) {
                    await adapter.unregisterWebhooks(integration.shopDomain, integration.accessToken, integration.webhookIds);
                }
            }
            catch (error) {
                console.error('Failed to unregister webhooks:', error);
                // Continue with deletion anyway
            }
        }
        // Delete integration (cascades to sync logs)
        await prisma.integration.delete({
            where: { id: input.integrationId },
        });
        await createAuditLog({
            action: AuditActions.integration.disconnected,
            resourceType: 'integration',
            resourceId: input.integrationId,
            metadata: {
                platform: integration.platform,
                shopDomain: integration.shopDomain,
            },
            context: { userId: ctx.user.sub },
        });
        return { success: true };
    },
});
// ------------------------------------------------------
// Trigger manual sync
// ------------------------------------------------------
export const triggerSyncEndpoint = adminFactory.build({
    method: 'post',
    shortDescription: 'Trigger sync',
    description: 'Manually trigger a data sync for an integration',
    tag: 'Integrations',
    input: z.object({
        integrationId: objectIdSchema,
        entityTypes: z.array(z.enum(['customers', 'orders'])).optional(),
    }),
    output: z.object({
        success: z.boolean(),
        message: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const integration = await prisma.integration.findUnique({
            where: { id: input.integrationId },
        });
        if (!integration) {
            throw createHttpError(404, 'Integration not found');
        }
        if (!integration.accessToken || !integration.shopDomain) {
            throw createHttpError(400, 'Integration is not properly configured');
        }
        const adapter = platformRegistry.getAdapter(integration.platform);
        if (!adapter) {
            throw createHttpError(400, `No adapter available for ${integration.platform}`);
        }
        // Update status to syncing
        await prisma.integration.update({
            where: { id: integration.id },
            data: { syncStatus: 'SYNCING' },
        });
        await createAuditLog({
            action: AuditActions.integration.syncStarted,
            resourceType: 'integration',
            resourceId: integration.id,
            metadata: { platform: integration.platform },
            context: { userId: ctx.user.sub },
        });
        const entityTypes = input.entityTypes || ['customers', 'orders'];
        // Run sync in background (non-blocking)
        (async () => {
            try {
                // Sync customers first if requested
                if (entityTypes.includes('customers') && integration.syncCustomers) {
                    const logId = await createSyncLog(integration.id, 'customers', 'inbound');
                    let cursor;
                    const totalResult = {
                        success: true,
                        recordsProcessed: 0,
                        recordsCreated: 0,
                        recordsUpdated: 0,
                        recordsFailed: 0,
                        errors: [],
                    };
                    do {
                        const page = await adapter.fetchCustomers(integration.shopDomain, integration.accessToken, cursor);
                        const result = await syncCustomersBatch(page.data, integration, ctx.user.sub);
                        totalResult.recordsProcessed += result.recordsProcessed;
                        totalResult.recordsCreated += result.recordsCreated;
                        totalResult.recordsUpdated += result.recordsUpdated;
                        totalResult.recordsFailed += result.recordsFailed;
                        totalResult.errors.push(...result.errors);
                        totalResult.success = totalResult.success && result.success;
                        cursor = page.hasMore ? page.cursor : undefined;
                    } while (cursor);
                    await completeSyncLog(logId, totalResult);
                }
                // Sync orders if requested
                if (entityTypes.includes('orders') && integration.syncOrders) {
                    const logId = await createSyncLog(integration.id, 'orders', 'inbound');
                    let cursor;
                    const totalResult = {
                        success: true,
                        recordsProcessed: 0,
                        recordsCreated: 0,
                        recordsUpdated: 0,
                        recordsFailed: 0,
                        errors: [],
                    };
                    do {
                        const page = await adapter.fetchOrders(integration.shopDomain, integration.accessToken, cursor);
                        const result = await syncOrdersBatch(page.data, integration, ctx.user.sub);
                        totalResult.recordsProcessed += result.recordsProcessed;
                        totalResult.recordsCreated += result.recordsCreated;
                        totalResult.recordsUpdated += result.recordsUpdated;
                        totalResult.recordsFailed += result.recordsFailed;
                        totalResult.errors.push(...result.errors);
                        totalResult.success = totalResult.success && result.success;
                        cursor = page.hasMore ? page.cursor : undefined;
                    } while (cursor);
                    await completeSyncLog(logId, totalResult);
                }
                // Update integration status
                await prisma.integration.update({
                    where: { id: integration.id },
                    data: {
                        syncStatus: 'SYNCED',
                        lastSyncAt: new Date(),
                        lastSyncError: null,
                    },
                });
            }
            catch (error) {
                console.error('Sync failed:', error);
                await prisma.integration.update({
                    where: { id: integration.id },
                    data: {
                        syncStatus: 'FAILED',
                        lastSyncError: error instanceof Error ? error.message : 'Unknown error',
                    },
                });
                await createAuditLog({
                    action: AuditActions.integration.syncFailed,
                    resourceType: 'integration',
                    resourceId: integration.id,
                    metadata: {
                        platform: integration.platform,
                        error: error instanceof Error ? error.message : 'Unknown error',
                    },
                    context: { userId: ctx.user.sub },
                });
            }
        })();
        return {
            success: true,
            message: 'Sync started in background',
        };
    },
});
// ------------------------------------------------------
// Shopify OAuth endpoints
// ------------------------------------------------------
export const shopifyInstallEndpoint = adminFactory.build({
    method: 'get',
    shortDescription: 'Start Shopify OAuth',
    description: 'Start the Shopify OAuth flow to connect a store',
    tag: 'Integrations',
    input: z.object({
        shop: z.string().min(1),
    }),
    output: z.object({
        authUrl: z.string(),
        state: z.string(),
    }),
    handler: async ({ input }) => {
        const adapter = platformRegistry.getAdapter('SHOPIFY');
        if (!adapter) {
            throw createHttpError(501, 'Shopify integration not configured');
        }
        // Generate state for CSRF protection
        const state = crypto.randomBytes(16).toString('hex');
        // Get base URL from environment or default
        const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
        const redirectUri = `${baseUrl}/v1/integrations/shopify/callback`;
        const authUrl = adapter.getAuthUrl(input.shop, redirectUri, state);
        return { authUrl, state };
    },
});
export const shopifyCallbackEndpoint = publicWithRequestFactory.build({
    method: 'get',
    shortDescription: 'Shopify OAuth callback',
    description: 'Handle the Shopify OAuth callback',
    tag: 'Integrations',
    input: z.object({
        code: z.string(),
        shop: z.string(),
        state: z.string(),
        hmac: z.string().optional(),
    }),
    output: z.object({
        success: z.boolean(),
        integrationId: z.string(),
        message: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const adapter = platformRegistry.getAdapter('SHOPIFY');
        if (!adapter) {
            throw createHttpError(501, 'Shopify integration not configured');
        }
        // TODO: Validate state against session/database stored value
        // For now, we proceed with the exchange
        const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
        const redirectUri = `${baseUrl}/v1/integrations/shopify/callback`;
        try {
            const tokens = await adapter.exchangeCodeForToken(input.shop, input.code, redirectUri);
            // Generate webhook secret
            const webhookSecret = crypto.randomBytes(32).toString('hex');
            // Create or update integration
            const integration = await prisma.integration.upsert({
                where: {
                    platform_shopDomain: {
                        platform: 'SHOPIFY',
                        shopDomain: input.shop,
                    },
                },
                create: {
                    platform: 'SHOPIFY',
                    name: input.shop.replace('.myshopify.com', ''),
                    shopDomain: input.shop,
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    tokenExpiresAt: tokens.expiresAt,
                    scopes: tokens.scopes,
                    webhookSecret,
                    syncStatus: 'PENDING',
                    createdBy: 'system', // TODO: Get from session
                },
                update: {
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    tokenExpiresAt: tokens.expiresAt,
                    scopes: tokens.scopes,
                    webhookSecret,
                    syncStatus: 'PENDING',
                },
            });
            // Register webhooks
            const webhookCallbackUrl = `${baseUrl}/v1/integrations/shopify/webhooks`;
            const webhookIds = await adapter.registerWebhooks(input.shop, tokens.accessToken, webhookCallbackUrl);
            // Update with webhook IDs
            await prisma.integration.update({
                where: { id: integration.id },
                data: { webhookIds },
            });
            await createAuditLog({
                action: AuditActions.integration.connected,
                resourceType: 'integration',
                resourceId: integration.id,
                metadata: {
                    platform: 'SHOPIFY',
                    shopDomain: input.shop,
                    scopes: tokens.scopes,
                },
                context: extractAuditContext(ctx.request),
            });
            return {
                success: true,
                integrationId: integration.id,
                message: `Successfully connected ${input.shop}`,
            };
        }
        catch (error) {
            console.error('Shopify OAuth error:', error);
            throw createHttpError(400, `Failed to connect Shopify store: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    },
});
// ------------------------------------------------------
// Shopify webhooks endpoint
// ------------------------------------------------------
export const shopifyWebhookEndpoint = publicWithRequestFactory.build({
    method: 'post',
    shortDescription: 'Shopify webhook handler',
    description: 'Receive and process Shopify webhooks',
    tag: 'Integrations',
    input: z.object({}).passthrough(),
    output: z.object({
        received: z.boolean(),
    }),
    handler: async ({ ctx }) => {
        const shopDomain = ctx.request.headers['x-shopify-shop-domain'];
        const hmacHeader = ctx.request.headers['x-shopify-hmac-sha256'];
        const topic = ctx.request.headers['x-shopify-topic'];
        if (!shopDomain || !hmacHeader || !topic) {
            throw createHttpError(400, 'Missing required Shopify headers');
        }
        // Find integration
        const integration = await prisma.integration.findFirst({
            where: {
                platform: 'SHOPIFY',
                shopDomain,
            },
        });
        if (!integration || !integration.webhookSecret) {
            throw createHttpError(404, 'Integration not found');
        }
        // Verify webhook signature
        const adapter = platformRegistry.getAdapter('SHOPIFY');
        if (!adapter) {
            throw createHttpError(501, 'Shopify adapter not available');
        }
        const rawBody = JSON.stringify(ctx.request.body);
        const isValid = adapter.verifyWebhook(rawBody, hmacHeader, integration.webhookSecret);
        if (!isValid) {
            throw createHttpError(401, 'Invalid webhook signature');
        }
        // Process webhook based on topic
        const payload = adapter.parseWebhookPayload(topic, ctx.request.body);
        if (payload) {
            // Handle different payload types
            if ('customerExternalId' in payload && 'purchasedAt' in payload) {
                // It's an order (has purchasedAt, unlike Cart)
                await syncOrdersBatch([payload], integration);
            }
            else if ('externalId' in payload && !('customerExternalId' in payload)) {
                // It's a customer (has externalId but no customerExternalId)
                await syncCustomersBatch([payload], integration);
            }
            // Carts are ignored for now - they would need separate handling
        }
        // Handle app uninstall
        if (topic === 'app/uninstalled') {
            await prisma.integration.update({
                where: { id: integration.id },
                data: {
                    accessToken: null,
                    refreshToken: null,
                    webhookIds: [],
                    syncStatus: 'FAILED',
                    lastSyncError: 'App was uninstalled from Shopify',
                },
            });
            await createAuditLog({
                action: AuditActions.integration.disconnected,
                resourceType: 'integration',
                resourceId: integration.id,
                metadata: {
                    platform: 'SHOPIFY',
                    shopDomain,
                    reason: 'app_uninstalled',
                },
                context: {},
            });
        }
        return { received: true };
    },
});
// ------------------------------------------------------
// WooCommerce connect endpoint (API key based)
// ------------------------------------------------------
export const woocommerceConnectEndpoint = adminFactory.build({
    method: 'post',
    shortDescription: 'Connect WooCommerce',
    description: 'Connect a WooCommerce store using API credentials',
    tag: 'Integrations',
    input: z.object({
        name: z.string().min(1),
        siteUrl: z.string().url(),
        consumerKey: z.string().min(1),
        consumerSecret: z.string().min(1),
    }),
    output: z.object({
        success: z.boolean(),
        integrationId: z.string(),
        message: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        // Normalize site URL
        const siteUrl = input.siteUrl.replace(/\/$/, '');
        // Verify credentials by making a test API call
        try {
            const auth = Buffer.from(`${input.consumerKey}:${input.consumerSecret}`).toString('base64');
            const response = await fetch(`${siteUrl}/wp-json/wc/v3/system_status`, {
                headers: { Authorization: `Basic ${auth}` },
            });
            if (!response.ok) {
                throw new Error(`API returned status ${response.status}`);
            }
        }
        catch (error) {
            throw createHttpError(400, `Failed to connect to WooCommerce: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        // Generate webhook secret
        const webhookSecret = crypto.randomBytes(32).toString('hex');
        // Store credentials (access token field stores combined key:secret)
        const integration = await prisma.integration.create({
            data: {
                platform: 'WOOCOMMERCE',
                name: input.name,
                shopDomain: siteUrl,
                accessToken: `${input.consumerKey}:${input.consumerSecret}`,
                webhookSecret,
                scopes: ['read_write'],
                syncStatus: 'PENDING',
                createdBy: ctx.user.sub,
            },
        });
        await createAuditLog({
            action: AuditActions.integration.connected,
            resourceType: 'integration',
            resourceId: integration.id,
            metadata: {
                platform: 'WOOCOMMERCE',
                siteUrl,
            },
            context: { userId: ctx.user.sub },
        });
        return {
            success: true,
            integrationId: integration.id,
            message: `Successfully connected WooCommerce store: ${input.name}`,
        };
    },
});
// ------------------------------------------------------
// WooCommerce webhook endpoint
// ------------------------------------------------------
export const woocommerceWebhookEndpoint = publicWithRequestFactory.build({
    method: 'post',
    shortDescription: 'WooCommerce webhook handler',
    description: 'Receive and process WooCommerce webhooks',
    tag: 'Integrations',
    input: z.object({}).passthrough(),
    output: z.object({
        received: z.boolean(),
    }),
    handler: async ({ ctx }) => {
        const signature = ctx.request.headers['x-wc-webhook-signature'];
        const source = ctx.request.headers['x-wc-webhook-source'];
        const topic = ctx.request.headers['x-wc-webhook-topic'];
        if (!signature || !source) {
            throw createHttpError(400, 'Missing required WooCommerce headers');
        }
        // Find integration by source URL
        const integration = await prisma.integration.findFirst({
            where: {
                platform: 'WOOCOMMERCE',
                shopDomain: source.replace(/\/$/, ''),
            },
        });
        if (!integration || !integration.webhookSecret) {
            throw createHttpError(404, 'Integration not found');
        }
        // Verify webhook signature (WooCommerce uses base64-encoded HMAC-SHA256)
        const rawBody = JSON.stringify(ctx.request.body);
        const hmac = crypto
            .createHmac('sha256', integration.webhookSecret)
            .update(rawBody, 'utf8')
            .digest('base64');
        if (hmac !== signature) {
            throw createHttpError(401, 'Invalid webhook signature');
        }
        // Process based on topic
        const adapter = platformRegistry.getAdapter('WOOCOMMERCE');
        if (adapter) {
            const payload = adapter.parseWebhookPayload(topic || '', ctx.request.body);
            if (payload) {
                if ('customerExternalId' in payload && 'purchasedAt' in payload) {
                    await syncOrdersBatch([payload], integration);
                }
                else if ('externalId' in payload && !('customerExternalId' in payload)) {
                    await syncCustomersBatch([payload], integration);
                }
            }
        }
        return { received: true };
    },
});
// ------------------------------------------------------
// BigCommerce OAuth endpoints
// ------------------------------------------------------
export const bigcommerceInstallEndpoint = adminFactory.build({
    method: 'get',
    shortDescription: 'Start BigCommerce OAuth',
    description: 'Start the BigCommerce OAuth flow to connect a store',
    tag: 'Integrations',
    input: z.object({}),
    output: z.object({
        authUrl: z.string(),
        state: z.string(),
    }),
    handler: async () => {
        const adapter = platformRegistry.getAdapter('BIGCOMMERCE');
        if (!adapter) {
            throw createHttpError(501, 'BigCommerce integration not configured');
        }
        const state = crypto.randomBytes(16).toString('hex');
        const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
        const redirectUri = `${baseUrl}/v1/integrations/bigcommerce/callback`;
        const authUrl = adapter.getAuthUrl('', redirectUri, state);
        return { authUrl, state };
    },
});
export const bigcommerceCallbackEndpoint = publicWithRequestFactory.build({
    method: 'get',
    shortDescription: 'BigCommerce OAuth callback',
    description: 'Handle the BigCommerce OAuth callback',
    tag: 'Integrations',
    input: z.object({
        code: z.string(),
        context: z.string(),
        scope: z.string(),
    }),
    output: z.object({
        success: z.boolean(),
        integrationId: z.string(),
        message: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const adapter = platformRegistry.getAdapter('BIGCOMMERCE');
        if (!adapter) {
            throw createHttpError(501, 'BigCommerce integration not configured');
        }
        const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
        const redirectUri = `${baseUrl}/v1/integrations/bigcommerce/callback`;
        try {
            // Context format: stores/{store_hash}
            const storeHash = input.context.split('/')[1];
            const tokens = await adapter.exchangeCodeForToken(storeHash, input.code, redirectUri);
            const webhookSecret = crypto.randomBytes(32).toString('hex');
            const integration = await prisma.integration.upsert({
                where: {
                    platform_storeId: {
                        platform: 'BIGCOMMERCE',
                        storeId: storeHash,
                    },
                },
                create: {
                    platform: 'BIGCOMMERCE',
                    name: `BigCommerce Store ${storeHash}`,
                    storeId: storeHash,
                    accessToken: tokens.accessToken,
                    scopes: tokens.scopes,
                    webhookSecret,
                    syncStatus: 'PENDING',
                    createdBy: 'system',
                },
                update: {
                    accessToken: tokens.accessToken,
                    scopes: tokens.scopes,
                    syncStatus: 'PENDING',
                },
            });
            await createAuditLog({
                action: AuditActions.integration.connected,
                resourceType: 'integration',
                resourceId: integration.id,
                metadata: {
                    platform: 'BIGCOMMERCE',
                    storeHash,
                    scopes: tokens.scopes,
                },
                context: extractAuditContext(ctx.request),
            });
            return {
                success: true,
                integrationId: integration.id,
                message: `Successfully connected BigCommerce store`,
            };
        }
        catch (error) {
            console.error('BigCommerce OAuth error:', error);
            throw createHttpError(400, `Failed to connect BigCommerce store: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    },
});
// ------------------------------------------------------
// Wix OAuth endpoints
// ------------------------------------------------------
export const wixInstallEndpoint = adminFactory.build({
    method: 'get',
    shortDescription: 'Start Wix OAuth',
    description: 'Start the Wix OAuth flow to connect a store',
    tag: 'Integrations',
    input: z.object({}),
    output: z.object({
        authUrl: z.string(),
        state: z.string(),
    }),
    handler: async () => {
        const adapter = platformRegistry.getAdapter('WIX');
        if (!adapter) {
            throw createHttpError(501, 'Wix integration not configured');
        }
        const state = crypto.randomBytes(16).toString('hex');
        const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
        const redirectUri = `${baseUrl}/v1/integrations/wix/callback`;
        const authUrl = adapter.getAuthUrl('', redirectUri, state);
        return { authUrl, state };
    },
});
export const wixCallbackEndpoint = publicWithRequestFactory.build({
    method: 'get',
    shortDescription: 'Wix OAuth callback',
    description: 'Handle the Wix OAuth callback',
    tag: 'Integrations',
    input: z.object({
        code: z.string(),
        instanceId: z.string(),
    }),
    output: z.object({
        success: z.boolean(),
        integrationId: z.string(),
        message: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const adapter = platformRegistry.getAdapter('WIX');
        if (!adapter) {
            throw createHttpError(501, 'Wix integration not configured');
        }
        const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
        const redirectUri = `${baseUrl}/v1/integrations/wix/callback`;
        try {
            const tokens = await adapter.exchangeCodeForToken(input.instanceId, input.code, redirectUri);
            const webhookSecret = crypto.randomBytes(32).toString('hex');
            const integration = await prisma.integration.upsert({
                where: {
                    platform_storeId: {
                        platform: 'WIX',
                        storeId: input.instanceId,
                    },
                },
                create: {
                    platform: 'WIX',
                    name: `Wix Store ${input.instanceId.slice(0, 8)}`,
                    storeId: input.instanceId,
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    tokenExpiresAt: tokens.expiresAt,
                    scopes: tokens.scopes,
                    webhookSecret,
                    syncStatus: 'PENDING',
                    createdBy: 'system',
                },
                update: {
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    tokenExpiresAt: tokens.expiresAt,
                    scopes: tokens.scopes,
                    syncStatus: 'PENDING',
                },
            });
            await createAuditLog({
                action: AuditActions.integration.connected,
                resourceType: 'integration',
                resourceId: integration.id,
                metadata: {
                    platform: 'WIX',
                    instanceId: input.instanceId,
                    scopes: tokens.scopes,
                },
                context: extractAuditContext(ctx.request),
            });
            return {
                success: true,
                integrationId: integration.id,
                message: `Successfully connected Wix store`,
            };
        }
        catch (error) {
            console.error('Wix OAuth error:', error);
            throw createHttpError(400, `Failed to connect Wix store: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    },
});
// ------------------------------------------------------
// Salesforce OAuth endpoints
// ------------------------------------------------------
export const salesforceInstallEndpoint = adminFactory.build({
    method: 'get',
    shortDescription: 'Start Salesforce OAuth',
    description: 'Start the Salesforce OAuth flow to connect',
    tag: 'Integrations',
    input: z.object({}),
    output: z.object({
        authUrl: z.string(),
        state: z.string(),
    }),
    handler: async () => {
        const adapter = platformRegistry.getAdapter('SALESFORCE');
        if (!adapter) {
            throw createHttpError(501, 'Salesforce integration not configured');
        }
        const state = crypto.randomBytes(16).toString('hex');
        const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
        const redirectUri = `${baseUrl}/v1/integrations/salesforce/callback`;
        const authUrl = adapter.getAuthUrl('', redirectUri, state);
        return { authUrl, state };
    },
});
export const salesforceCallbackEndpoint = publicWithRequestFactory.build({
    method: 'get',
    shortDescription: 'Salesforce OAuth callback',
    description: 'Handle the Salesforce OAuth callback',
    tag: 'Integrations',
    input: z.object({
        code: z.string(),
        state: z.string(),
    }),
    output: z.object({
        success: z.boolean(),
        integrationId: z.string(),
        message: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const adapter = platformRegistry.getAdapter('SALESFORCE');
        if (!adapter) {
            throw createHttpError(501, 'Salesforce integration not configured');
        }
        const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
        const redirectUri = `${baseUrl}/v1/integrations/salesforce/callback`;
        try {
            const tokens = await adapter.exchangeCodeForToken('', input.code, redirectUri);
            const webhookSecret = crypto.randomBytes(32).toString('hex');
            // Extract instance URL from token exchange (stored in metadata for API calls)
            const integration = await prisma.integration.create({
                data: {
                    platform: 'SALESFORCE',
                    name: 'Salesforce CRM',
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    scopes: tokens.scopes,
                    webhookSecret,
                    syncStatus: 'PENDING',
                    createdBy: 'system',
                },
            });
            await createAuditLog({
                action: AuditActions.integration.connected,
                resourceType: 'integration',
                resourceId: integration.id,
                metadata: {
                    platform: 'SALESFORCE',
                    scopes: tokens.scopes,
                },
                context: extractAuditContext(ctx.request),
            });
            return {
                success: true,
                integrationId: integration.id,
                message: 'Successfully connected Salesforce',
            };
        }
        catch (error) {
            console.error('Salesforce OAuth error:', error);
            throw createHttpError(400, `Failed to connect Salesforce: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    },
});
// ------------------------------------------------------
// Magento connect endpoint (Integration token based)
// ------------------------------------------------------
export const magentoConnectEndpoint = adminFactory.build({
    method: 'post',
    shortDescription: 'Connect Magento',
    description: 'Connect a Magento store using an integration access token',
    tag: 'Integrations',
    input: z.object({
        name: z.string().min(1),
        baseUrl: z.string().url(),
        accessToken: z.string().min(1),
    }),
    output: z.object({
        success: z.boolean(),
        integrationId: z.string(),
        message: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        // Normalize base URL
        const baseUrl = input.baseUrl.replace(/\/$/, '');
        // Verify credentials by making a test API call
        try {
            const response = await fetch(`${baseUrl}/rest/V1/store/storeConfigs`, {
                headers: {
                    Authorization: `Bearer ${input.accessToken}`,
                    'Content-Type': 'application/json',
                },
            });
            if (!response.ok) {
                throw new Error(`API returned status ${response.status}`);
            }
        }
        catch (error) {
            throw createHttpError(400, `Failed to connect to Magento: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        const webhookSecret = crypto.randomBytes(32).toString('hex');
        const integration = await prisma.integration.create({
            data: {
                platform: 'MAGENTO',
                name: input.name,
                shopDomain: baseUrl,
                accessToken: input.accessToken,
                webhookSecret,
                scopes: ['customers', 'orders', 'products'],
                syncStatus: 'PENDING',
                createdBy: ctx.user.sub,
            },
        });
        await createAuditLog({
            action: AuditActions.integration.connected,
            resourceType: 'integration',
            resourceId: integration.id,
            metadata: {
                platform: 'MAGENTO',
                baseUrl,
            },
            context: { userId: ctx.user.sub },
        });
        return {
            success: true,
            integrationId: integration.id,
            message: `Successfully connected Magento store: ${input.name}`,
        };
    },
});
// ------------------------------------------------------
// Magento webhook endpoint
// ------------------------------------------------------
export const magentoWebhookEndpoint = publicWithRequestFactory.build({
    method: 'post',
    shortDescription: 'Magento webhook handler',
    description: 'Receive and process Magento webhooks',
    tag: 'Integrations',
    input: z.object({}).passthrough(),
    output: z.object({
        received: z.boolean(),
    }),
    handler: async ({ ctx }) => {
        const signature = ctx.request.headers['x-magento-signature'];
        const storeUrl = ctx.request.headers['x-magento-store-url'];
        const topic = ctx.request.headers['x-magento-topic'];
        if (!signature || !storeUrl) {
            throw createHttpError(400, 'Missing required Magento headers');
        }
        // Find integration by store URL
        const integration = await prisma.integration.findFirst({
            where: {
                platform: 'MAGENTO',
                shopDomain: storeUrl.replace(/\/$/, ''),
            },
        });
        if (!integration || !integration.webhookSecret) {
            throw createHttpError(404, 'Integration not found');
        }
        // Verify webhook signature
        const rawBody = JSON.stringify(ctx.request.body);
        const hmac = crypto
            .createHmac('sha256', integration.webhookSecret)
            .update(rawBody, 'utf8')
            .digest('hex');
        if (hmac !== signature) {
            throw createHttpError(401, 'Invalid webhook signature');
        }
        // Process based on topic
        const adapter = platformRegistry.getAdapter('MAGENTO');
        if (adapter) {
            const payload = adapter.parseWebhookPayload(topic || '', ctx.request.body);
            if (payload) {
                if ('customerExternalId' in payload && 'purchasedAt' in payload) {
                    await syncOrdersBatch([payload], integration);
                }
                else if ('externalId' in payload && !('customerExternalId' in payload)) {
                    await syncCustomersBatch([payload], integration);
                }
            }
        }
        return { received: true };
    },
});
// ------------------------------------------------------
// Square OAuth endpoints
// ------------------------------------------------------
export const squareInstallEndpoint = adminFactory.build({
    method: 'get',
    shortDescription: 'Start Square OAuth',
    description: 'Start the Square OAuth flow to connect',
    tag: 'Integrations',
    input: z.object({}),
    output: z.object({
        authUrl: z.string(),
        state: z.string(),
    }),
    handler: async () => {
        const adapter = platformRegistry.getAdapter('SQUARE');
        if (!adapter) {
            throw createHttpError(501, 'Square integration not configured');
        }
        const state = crypto.randomBytes(16).toString('hex');
        const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
        const redirectUri = `${baseUrl}/v1/integrations/square/callback`;
        const authUrl = adapter.getAuthUrl('', redirectUri, state);
        return { authUrl, state };
    },
});
export const squareCallbackEndpoint = publicWithRequestFactory.build({
    method: 'get',
    shortDescription: 'Square OAuth callback',
    description: 'Handle the Square OAuth callback',
    tag: 'Integrations',
    input: z.object({
        code: z.string(),
        state: z.string(),
    }),
    output: z.object({
        success: z.boolean(),
        integrationId: z.string(),
        message: z.string(),
    }),
    handler: async ({ input, ctx }) => {
        const adapter = platformRegistry.getAdapter('SQUARE');
        if (!adapter) {
            throw createHttpError(501, 'Square integration not configured');
        }
        const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
        const redirectUri = `${baseUrl}/v1/integrations/square/callback`;
        try {
            const tokens = await adapter.exchangeCodeForToken('', input.code, redirectUri);
            const webhookSecret = crypto.randomBytes(32).toString('hex');
            const integration = await prisma.integration.create({
                data: {
                    platform: 'SQUARE',
                    name: 'Square Merchant',
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    tokenExpiresAt: tokens.expiresAt,
                    scopes: tokens.scopes,
                    webhookSecret,
                    syncStatus: 'PENDING',
                    createdBy: 'system',
                },
            });
            // Register webhooks
            if (tokens.accessToken) {
                const webhookCallbackUrl = `${baseUrl}/v1/integrations/square/webhooks`;
                const webhookIds = await adapter.registerWebhooks('', tokens.accessToken, webhookCallbackUrl);
                await prisma.integration.update({
                    where: { id: integration.id },
                    data: { webhookIds },
                });
            }
            await createAuditLog({
                action: AuditActions.integration.connected,
                resourceType: 'integration',
                resourceId: integration.id,
                metadata: {
                    platform: 'SQUARE',
                    scopes: tokens.scopes,
                },
                context: extractAuditContext(ctx.request),
            });
            return {
                success: true,
                integrationId: integration.id,
                message: 'Successfully connected Square',
            };
        }
        catch (error) {
            console.error('Square OAuth error:', error);
            throw createHttpError(400, `Failed to connect Square: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    },
});
// ------------------------------------------------------
// Square webhook endpoint
// ------------------------------------------------------
export const squareWebhookEndpoint = publicWithRequestFactory.build({
    method: 'post',
    shortDescription: 'Square webhook handler',
    description: 'Receive and process Square webhooks',
    tag: 'Integrations',
    input: z.object({}).passthrough(),
    output: z.object({
        received: z.boolean(),
    }),
    handler: async ({ ctx }) => {
        const signature = ctx.request.headers['x-square-signature'];
        const eventType = ctx.request.body?.type;
        if (!signature) {
            throw createHttpError(400, 'Missing Square signature header');
        }
        // Find integration by checking all Square integrations
        // In production, you'd store the merchant_id in the integration
        const integrations = await prisma.integration.findMany({
            where: { platform: 'SQUARE' },
        });
        let matchedIntegration = null;
        const rawBody = JSON.stringify(ctx.request.body);
        for (const integration of integrations) {
            if (integration.webhookSecret) {
                const adapter = platformRegistry.getAdapter('SQUARE');
                if (adapter && adapter.verifyWebhook(rawBody, signature, integration.webhookSecret)) {
                    matchedIntegration = integration;
                    break;
                }
            }
        }
        if (!matchedIntegration) {
            throw createHttpError(401, 'Invalid webhook signature');
        }
        // Process based on event type
        const adapter = platformRegistry.getAdapter('SQUARE');
        if (adapter && eventType) {
            const payload = adapter.parseWebhookPayload(eventType, ctx.request.body);
            if (payload) {
                if ('customerExternalId' in payload && 'purchasedAt' in payload) {
                    await syncOrdersBatch([payload], matchedIntegration);
                }
                else if ('externalId' in payload && !('customerExternalId' in payload)) {
                    await syncCustomersBatch([payload], matchedIntegration);
                }
            }
        }
        return { received: true };
    },
});
