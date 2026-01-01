import * as healthEndpoints from './endpoints/health';
import * as authEndpoints from './endpoints/auth';
import * as settingsEndpoints from './endpoints/settings';
import * as userEndpoints from './endpoints/users';
import * as invitationEndpoints from './endpoints/invitations';
import * as customerEndpoints from './endpoints/customers';
import * as campaignEndpoints from './endpoints/campaigns';
import * as messageEndpoints from './endpoints/messages';
import * as experimentEndpoints from './endpoints/experiments';
import * as consentEndpoints from './endpoints/consent';
import * as webhookEndpoints from './endpoints/webhooks';
import * as adminEndpoints from './endpoints/admin';
import * as orderEndpoints from './endpoints/orders';
import * as integrationEndpoints from './endpoints/integrations';
import * as flowEndpoints from './endpoints/flows';
import * as formEndpoints from './endpoints/forms';
import * as analyticsEndpoints from './endpoints/analytics';
import * as emailTemplateEndpoints from './endpoints/email-templates';
import * as recommendationEndpoints from './endpoints/recommendations';
import * as importEndpoints from './endpoints/imports';
import * as backupEndpoints from './endpoints/backup';
import * as setupEndpoints from './endpoints/setup';
import * as updateEndpoints from './endpoints/updates';
const routing = {
    v1: {
        health: {
            '': healthEndpoints.healthEndpoint,
            metrics: healthEndpoints.metricsEndpoint,
        },
        auth: {
            register: authEndpoints.registerEndpoint,
            login: authEndpoints.loginEndpoint,
            refresh: authEndpoints.refreshEndpoint,
            logout: authEndpoints.logoutEndpoint,
            me: authEndpoints.meEndpoint,
            'forgot-password': authEndpoints.forgotPasswordEndpoint,
            'reset-password': authEndpoints.resetPasswordEndpoint,
        },
        settings: {
            '': {
                get: settingsEndpoints.getSettingsEndpoint,
                patch: settingsEndpoints.updateSettingsEndpoint,
            },
            signup: settingsEndpoints.getSignupSettingsEndpoint,
            timezones: settingsEndpoints.getTimezonesEndpoint,
        },
        users: {
            '': userEndpoints.listUsersEndpoint,
            ':userId': {
                get: userEndpoints.getUserEndpoint,
                patch: userEndpoints.updateUserRoleEndpoint,
                delete: userEndpoints.deleteUserEndpoint,
            },
        },
        invitations: {
            '': {
                post: invitationEndpoints.createInvitationEndpoint,
                get: invitationEndpoints.listInvitationsEndpoint,
            },
            ':invitationId': {
                delete: invitationEndpoints.revokeInvitationEndpoint,
            },
            accept: invitationEndpoints.acceptInvitationEndpoint,
            validate: invitationEndpoints.validateInvitationEndpoint,
        },
        customers: {
            '': {
                get: customerEndpoints.listCustomersEndpoint,
                post: customerEndpoints.upsertCustomerEndpoint,
            },
            ':customerId': {
                '': customerEndpoints.getCustomerEndpoint,
                'opt-out': customerEndpoints.updateOptOutEndpoint,
                events: customerEndpoints.listCustomerEventsEndpoint,
            },
        },
        events: {
            ingest: customerEndpoints.ingestCustomerEventEndpoint,
        },
        campaigns: {
            '': {
                post: campaignEndpoints.createCampaignEndpoint,
                get: campaignEndpoints.listCampaignsEndpoint,
            },
            'from-natural-language': campaignEndpoints.createCampaignFromNLEndpoint,
            'parse-natural-language': campaignEndpoints.parseCampaignNLEndpoint,
            query: {
                preview: campaignEndpoints.previewQueryEndpoint,
            },
            ':campaignId': {
                get: campaignEndpoints.getCampaignEndpoint,
                patch: campaignEndpoints.updateCampaignEndpoint,
                delete: campaignEndpoints.deleteCampaignEndpoint,
                preview: campaignEndpoints.previewCampaignEndpoint,
                'preview-message': campaignEndpoints.previewCampaignMessageEndpoint,
                test: campaignEndpoints.testCampaignEndpoint,
                pause: campaignEndpoints.pauseCampaignEndpoint,
                resume: campaignEndpoints.resumeCampaignEndpoint,
                stats: campaignEndpoints.getCampaignStatsEndpoint,
                export: campaignEndpoints.exportCampaignDataEndpoint,
                'generate-subject-lines': campaignEndpoints.generateSubjectLinesEndpoint,
                revenue: {
                    '': campaignEndpoints.getCampaignRevenueEndpoint,
                    breakdown: campaignEndpoints.getCampaignRevenueBreakdownEndpoint,
                },
            },
        },
        flows: {
            '': {
                post: flowEndpoints.createFlowEndpoint,
                get: flowEndpoints.listFlowsEndpoint,
            },
            templates: {
                '': flowEndpoints.listFlowTemplatesEndpoint,
                ':templateId': flowEndpoints.getFlowTemplateEndpoint,
            },
            'from-template': flowEndpoints.createFlowFromTemplateEndpoint,
            'from-natural-language': flowEndpoints.createFlowFromNLEndpoint,
            'parse-natural-language': flowEndpoints.parseFlowNLEndpoint,
            ':flowId': {
                get: flowEndpoints.getFlowEndpoint,
                patch: flowEndpoints.updateFlowEndpoint,
                delete: flowEndpoints.deleteFlowEndpoint,
                pause: flowEndpoints.pauseFlowEndpoint,
                resume: flowEndpoints.resumeFlowEndpoint,
                enrollments: flowEndpoints.getFlowEnrollmentsEndpoint,
                analytics: flowEndpoints.getFlowAnalyticsEndpoint,
                revenue: flowEndpoints.getFlowRevenueEndpoint,
            },
        },
        'email-templates': {
            '': {
                post: emailTemplateEndpoints.createEmailTemplateEndpoint,
                get: emailTemplateEndpoints.listEmailTemplatesEndpoint,
            },
            categories: emailTemplateEndpoints.listEmailTemplateCategoriesEndpoint,
            preview: emailTemplateEndpoints.previewEmailTemplateEndpoint,
            ':templateId': {
                get: emailTemplateEndpoints.getEmailTemplateEndpoint,
                patch: emailTemplateEndpoints.updateEmailTemplateEndpoint,
                delete: emailTemplateEndpoints.deleteEmailTemplateEndpoint,
                duplicate: emailTemplateEndpoints.duplicateEmailTemplateEndpoint,
            },
        },
        forms: {
            '': {
                post: formEndpoints.createFormEndpoint,
                get: formEndpoints.listFormsEndpoint,
            },
            ':formId': {
                get: formEndpoints.getFormEndpoint,
                patch: formEndpoints.updateFormEndpoint,
                delete: formEndpoints.deleteFormEndpoint,
                pause: formEndpoints.pauseFormEndpoint,
                resume: formEndpoints.resumeFormEndpoint,
                submissions: formEndpoints.listFormSubmissionsEndpoint,
                analytics: formEndpoints.getFormAnalyticsEndpoint,
                export: formEndpoints.exportFormSubmissionsEndpoint,
            },
        },
        public: {
            forms: {
                ':formId': {
                    config: formEndpoints.getPublicFormConfigEndpoint,
                    submit: formEndpoints.submitFormEndpoint,
                    captcha: formEndpoints.generateCaptchaEndpoint,
                },
                captcha: {
                    validate: formEndpoints.validateCaptchaEndpoint,
                },
            },
        },
        analytics: {
            revenue: {
                dashboard: analyticsEndpoints.getRevenueDashboardEndpoint,
            },
        },
        recommendations: {
            'best-sellers': recommendationEndpoints.getBestSellersEndpoint,
            analytics: recommendationEndpoints.getRecommendationAnalyticsEndpoint,
            'track-click': recommendationEndpoints.trackRecommendationClickEndpoint,
            'track-purchase': recommendationEndpoints.trackRecommendationPurchaseEndpoint,
            'rebuild-patterns': recommendationEndpoints.rebuildCopurchasePatternsEndpoint,
            ':customerId': {
                '': recommendationEndpoints.getCustomerRecommendationsEndpoint,
                html: recommendationEndpoints.generateRecommendationsHtmlEndpoint,
            },
        },
        products: {
            '': {
                get: recommendationEndpoints.listProductsEndpoint,
                post: recommendationEndpoints.upsertProductEndpoint,
            },
            categories: recommendationEndpoints.getProductCategoriesEndpoint,
            brands: recommendationEndpoints.getProductBrandsEndpoint,
            ':sku': {
                delete: recommendationEndpoints.deleteProductEndpoint,
            },
        },
        'browse-events': recommendationEndpoints.trackBrowseEventEndpoint,
        imports: {
            klaviyo: {
                validate: importEndpoints.validateImportEndpoint,
                profiles: importEndpoints.importProfilesEndpoint,
                events: importEndpoints.importEventsEndpoint,
                segment: importEndpoints.translateSegmentEndpoint,
            },
            history: importEndpoints.listImportHistoryEndpoint,
            ':importId': importEndpoints.getImportDetailsEndpoint,
        },
        messages: {
            logs: messageEndpoints.listMessageLogsEndpoint,
            ':messageId': {
                '': messageEndpoints.getMessageLogEndpoint,
                retry: messageEndpoints.retryMessageEndpoint,
            },
        },
        experiments: {
            '': {
                post: experimentEndpoints.createExperimentEndpoint,
                get: experimentEndpoints.listExperimentsEndpoint,
            },
            ':experimentId': {
                get: experimentEndpoints.getExperimentEndpoint,
                delete: experimentEndpoints.deleteExperimentEndpoint,
                start: experimentEndpoints.startExperimentEndpoint,
                stop: experimentEndpoints.stopExperimentEndpoint,
            },
            assign: experimentEndpoints.assignCohortEndpoint,
            conversion: experimentEndpoints.recordConversionEndpoint,
        },
        consent: {
            record: consentEndpoints.recordConsentEndpoint,
            ':customerId': {
                history: consentEndpoints.getConsentHistoryEndpoint,
            },
            suppressions: {
                '': {
                    get: consentEndpoints.listSuppressionsEndpoint,
                    post: consentEndpoints.addSuppressionEndpoint,
                },
                remove: consentEndpoints.removeSuppressionEndpoint,
                import: consentEndpoints.importSuppressionsEndpoint,
                'import-history': consentEndpoints.listImportHistoryEndpoint,
                'imports/:importId': consentEndpoints.getImportDetailsEndpoint,
            },
            'export-data': consentEndpoints.requestDataExportEndpoint,
            'delete-data': consentEndpoints.requestDataDeletionEndpoint,
        },
        webhooks: {
            'delivery/:provider': webhookEndpoints.deliveryWebhookEndpoint,
            orders: webhookEndpoints.orderWebhookEndpoint,
        },
        admin: {
            system: {
                health: adminEndpoints.systemHealthEndpoint,
            },
            audit: adminEndpoints.auditListEndpoint,
            quota: adminEndpoints.quotaUsageEndpoint,
            'auto-tune': {
                status: adminEndpoints.autoTuneStatusEndpoint,
                trigger: adminEndpoints.triggerAutoTuneEndpoint,
                campaign: {
                    ':campaignId': {
                        performance: adminEndpoints.campaignPerformanceEndpoint,
                        evaluate: adminEndpoints.evaluateCampaignAutoTuneEndpoint,
                        run: adminEndpoints.runAutoTuneCampaignEndpoint,
                    },
                },
                run: adminEndpoints.runAutoTuneAllEndpoint,
            },
            'send-time': {
                calculate: adminEndpoints.calculateSendTimeProfilesEndpoint,
                stats: adminEndpoints.getSendTimeStatsEndpoint,
                profile: {
                    ':customerId': adminEndpoints.getSendTimeProfileEndpoint,
                },
                'preview-campaign': {
                    ':campaignId': adminEndpoints.previewCampaignSendTimesEndpoint,
                },
            },
            'browse-abandonment': {
                '': adminEndpoints.browseAbandonmentStatusEndpoint,
                trigger: adminEndpoints.triggerBrowseAbandonmentEndpoint,
                stats: adminEndpoints.browseAbandonmentStatsEndpoint,
            },
            predictions: {
                status: adminEndpoints.predictionStatusEndpoint,
                trigger: adminEndpoints.triggerPredictionEndpoint,
                stats: adminEndpoints.predictionStatsEndpoint,
                customer: {
                    ':customerId': {
                        '': adminEndpoints.getCustomerPredictionEndpoint,
                        recalculate: adminEndpoints.recalculateCustomerPredictionEndpoint,
                    },
                },
            },
            backups: {
                status: backupEndpoints.getBackupStatusEndpoint,
                '': {
                    get: backupEndpoints.listBackupsEndpoint,
                    post: backupEndpoints.triggerBackupEndpoint,
                },
                s3: {
                    '': backupEndpoints.listS3BackupsEndpoint,
                    test: backupEndpoints.testS3ConnectionEndpoint,
                },
                restore: {
                    s3: backupEndpoints.restoreFromS3Endpoint,
                    upload: backupEndpoints.restoreFromUploadEndpoint,
                },
                ':backupId': {
                    download: backupEndpoints.getBackupDownloadEndpoint,
                    delete: backupEndpoints.deleteBackupEndpoint,
                },
            },
            updates: {
                current: updateEndpoints.getCurrentVersionEndpoint,
                available: updateEndpoints.getAvailableVersionsEndpoint,
                'changelog/:version': updateEndpoints.getVersionChangelogEndpoint,
                install: updateEndpoints.installUpdateEndpoint,
                rollback: updateEndpoints.rollbackVersionEndpoint,
                history: updateEndpoints.getUpdateHistoryEndpoint,
                status: updateEndpoints.getUpdateStatusEndpoint,
            },
        },
        orders: {
            '': {
                get: orderEndpoints.listOrdersEndpoint,
                post: orderEndpoints.createOrderEndpoint,
            },
            ':orderId': {
                get: orderEndpoints.getOrderEndpoint,
                patch: orderEndpoints.updateOrderStatusEndpoint,
                delete: orderEndpoints.deleteOrderEndpoint,
            },
        },
        integrations: {
            '': integrationEndpoints.listIntegrationsEndpoint,
            ':integrationId': {
                '': {
                    get: integrationEndpoints.getIntegrationEndpoint,
                    delete: integrationEndpoints.deleteIntegrationEndpoint,
                },
                sync: integrationEndpoints.triggerSyncEndpoint,
            },
            shopify: {
                install: integrationEndpoints.shopifyInstallEndpoint,
                callback: integrationEndpoints.shopifyCallbackEndpoint,
                webhooks: integrationEndpoints.shopifyWebhookEndpoint,
            },
            woocommerce: {
                connect: integrationEndpoints.woocommerceConnectEndpoint,
                webhooks: integrationEndpoints.woocommerceWebhookEndpoint,
            },
            bigcommerce: {
                install: integrationEndpoints.bigcommerceInstallEndpoint,
                callback: integrationEndpoints.bigcommerceCallbackEndpoint,
            },
            wix: {
                install: integrationEndpoints.wixInstallEndpoint,
                callback: integrationEndpoints.wixCallbackEndpoint,
            },
            salesforce: {
                install: integrationEndpoints.salesforceInstallEndpoint,
                callback: integrationEndpoints.salesforceCallbackEndpoint,
            },
            magento: {
                connect: integrationEndpoints.magentoConnectEndpoint,
                webhooks: integrationEndpoints.magentoWebhookEndpoint,
            },
            square: {
                install: integrationEndpoints.squareInstallEndpoint,
                callback: integrationEndpoints.squareCallbackEndpoint,
                webhooks: integrationEndpoints.squareWebhookEndpoint,
            },
        },
        setup: {
            status: setupEndpoints.setupStatusEndpoint,
            'create-admin': setupEndpoints.createAdminEndpoint,
        },
    },
};
export default routing;
