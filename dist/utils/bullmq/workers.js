/**
 * BullMQ Workers
 *
 * Implements job processors for campaign execution and customer messaging.
 */
import { Worker } from 'bullmq';
import { getRedisConnection, QUEUE_NAMES, getWorkerConcurrency } from './connection';
import { getCustomerQueue, getDLQ, } from './queues';
import crypto from 'crypto';
import prisma from '../prisma';
import { executeQuery, parseQueryDSL } from '../query-executor';
import { executeAggregationQuery } from '../query-aggregator';
import { checkEligibility } from '../eligibility';
import { getProviderForChannel } from '../../providers';
import { createAuditLog, AuditActions } from '../audit';
import { canSendMessage } from '../quotas';
import { formatDiscountValue, formatGiftValue } from '../promotions';
import { getNextFallbackChannel, shouldTriggerFallback, DEFAULT_FALLBACK_CONFIG, } from '../channel-fallback';
import { buildTemplateData, renderInlineTemplate, } from '../template-renderer';
import { fetchRecommendationsForMessage, templateNeedsRecommendations, } from '../recommendation-fetcher';
import { getCustomerOptimalHour, calculateSendDelay, } from '../send-time-calculator';
// Worker instances
let campaignWorker = null;
let customerWorker = null;
/**
 * Check if a query DSL contains an aggregation query
 */
function isAggregationQuery(dsl) {
    return (typeof dsl === 'object' &&
        dsl !== null &&
        'aggregation' in dsl &&
        typeof dsl.aggregation === 'object');
}
/**
 * Execute query - handles both standard and aggregation queries
 */
async function executeCampaignQuery(queryString, options) {
    const dsl = parseQueryDSL(queryString);
    // Check if this is an aggregation query
    if (isAggregationQuery(dsl)) {
        console.log(`[CampaignWorker] Executing aggregation query: ${dsl.aggregation.type}`);
        const result = await executeAggregationQuery(dsl, {
            page: options.page,
            pageSize: options.pageSize,
            excludeOptedOut: options.excludeOptedOut,
        });
        // Convert AggregationResult to QueryResult format
        return {
            customers: result.customers.map((c) => ({
                id: c.id,
                email: c.email,
                phone: c.phone,
                name: c.name,
                optOut: c.optOut,
                lastContactAt: c.lastContactAt,
                lastOrderAt: c.lastOrderAt,
                totalOrders: c.totalOrders,
                totalSpent: c.totalSpent,
                metadata: c.computed || null,
            })),
            total: result.total,
            hasMore: result.hasMore,
        };
    }
    // Standard query execution
    return executeQuery(dsl, options);
}
/**
 * Fetch application settings from database
 */
async function fetchAppSettings() {
    const settings = await prisma.settings.findFirst({
        select: {
            timezone: true,
            quietHoursStart: true,
            quietHoursEnd: true,
            quietHoursEnabled: true,
            quietHoursDays: true,
            fallbackEnabled: true,
            fallbackOrder: true,
            fallbackMaxAttempts: true,
            dailyMessageLimit: true,
            monthlyMessageLimit: true,
        },
    });
    if (!settings)
        return null;
    return {
        timezone: settings.timezone,
        quietHoursStart: settings.quietHoursStart,
        quietHoursEnd: settings.quietHoursEnd,
        quietHoursEnabled: settings.quietHoursEnabled,
        quietHoursDays: settings.quietHoursDays,
        fallbackEnabled: settings.fallbackEnabled,
        fallbackOrder: settings.fallbackOrder,
        fallbackMaxAttempts: settings.fallbackMaxAttempts,
        dailyMessageLimit: settings.dailyMessageLimit,
        monthlyMessageLimit: settings.monthlyMessageLimit,
    };
}
/**
 * Move a failed job to the dead-letter queue
 */
async function moveToDeadLetter(originalQueue, job, error) {
    const dlq = getDLQ();
    const dlqData = {
        originalQueue,
        originalJobId: job.id || 'unknown',
        originalJobData: job.data,
        failureReason: error.message,
        failedAt: new Date().toISOString(),
        attempts: job.attemptsMade,
    };
    await dlq.add(`dlq_${job.id}`, dlqData);
    console.log(`[DLQ] Job ${job.id} moved to dead-letter queue: ${error.message}`);
}
/**
 * Deterministically assign a customer to a cohort using SHA256 hash
 * Same experimentId + customerId always produces the same cohort
 */
function assignCohort(experimentId, customerId, controlPercent) {
    const hash = crypto.createHash('sha256').update(`${experimentId}:${customerId}`).digest('hex');
    const hashValue = parseInt(hash.substring(0, 8), 16);
    const percentage = (hashValue / 0xffffffff) * 100;
    return percentage < controlPercent ? 'control' : 'treatment';
}
/**
 * Process a campaign job - executes query and enqueues customer jobs
 */
async function processCampaignJob(job) {
    const { campaignId, isTest = false } = job.data;
    const correlationId = `cmp_${campaignId}_${job.id}`;
    console.log(`[CampaignWorker] Starting job ${job.id} for campaign ${campaignId}`);
    // 1. Load campaign definition
    const campaign = await prisma.campaignDefinition.findUnique({
        where: { id: campaignId },
    });
    // Fetch application settings from database
    const appSettings = campaign ? await fetchAppSettings() : null;
    if (!campaign) {
        console.error(`[CampaignWorker] Campaign ${campaignId} not found`);
        throw new Error(`Campaign ${campaignId} not found`);
    }
    // Check if campaign is active (it might have been paused/archived since scheduling)
    if (campaign.status !== 'active') {
        console.log(`[CampaignWorker] Campaign ${campaignId} is ${campaign.status}, skipping execution`);
        return;
    }
    // Check if "once" campaign has already been executed
    if (campaign.executionType === 'once' && campaign.executedOnce) {
        console.log(`[CampaignWorker] Campaign ${campaignId} is a "once" campaign that has already executed, skipping`);
        return;
    }
    // Check for running experiment on this campaign (A/B Testing)
    const experiment = await prisma.experiment.findFirst({
        where: {
            campaignId: campaign.id,
            status: 'running',
        },
    });
    if (experiment) {
        console.log(`[CampaignWorker] Campaign ${campaignId} has running experiment ${experiment.id} (${experiment.name})`);
    }
    // 2. Create execution record
    const execution = await prisma.campaignExecution.create({
        data: {
            campaignId: campaign.id,
            correlationId, // Using correlationId as run ID
            bullMqJobId: `bullmq_${job.id}`,
            isTest,
            status: 'running',
        },
    });
    let customersMatched = 0;
    let messagesEnqueued = 0;
    try {
        // 3. Execute query with pagination (supports both standard and aggregation queries)
        let page = 1;
        const pageSize = 100;
        let hasMore = true;
        while (hasMore) {
            const result = await executeCampaignQuery(campaign.query, {
                excludeOptedOut: true,
                page,
                pageSize,
            });
            customersMatched = result.total;
            // 4. Enqueue per-customer jobs using bulk add for efficiency
            const customerQueue = getCustomerQueue();
            // Build promo info once (same for all customers in campaign)
            // Now using embedded discount/gift from campaign
            let promo;
            if (campaign.discount && campaign.discount.code) {
                promo = {
                    type: 'discount',
                    promoId: campaign.id, // Use campaign ID for tracking
                    code: campaign.discount.code,
                    formattedValue: formatDiscountValue(campaign.discount.type, campaign.discount.value),
                };
            }
            // Can have both discount AND gift
            let giftPromo;
            if (campaign.gift && campaign.gift.code) {
                giftPromo = {
                    type: 'gift',
                    promoId: campaign.id, // Use campaign ID for tracking
                    code: campaign.gift.code,
                    formattedValue: formatGiftValue(campaign.gift.type, campaign.gift.sku, campaign.gift.value ? parseFloat(campaign.gift.value) || null : null),
                };
            }
            // If no discount promo but have gift, use gift as primary promo
            if (!promo && giftPromo) {
                promo = giftPromo;
                giftPromo = undefined;
            }
            // Build fallback config once (same for all customers)
            const fallbackConfig = appSettings?.fallbackEnabled
                ? {
                    enabled: true,
                    primaryChannel: campaign.channel,
                    attemptedChannels: [campaign.channel],
                    config: {
                        enabled: true,
                        fallbackOrder: appSettings.fallbackOrder,
                        maxAttempts: appSettings.fallbackMaxAttempts || 2,
                        onlyOnPermanentFailure: true,
                    },
                }
                : undefined;
            // Build template content from campaign's inline email/sms fields
            let templateContent;
            const campaignEmail = campaign.email;
            const campaignSms = campaign.sms;
            if (campaignEmail || campaignSms) {
                templateContent = {
                    email: campaignEmail
                        ? {
                            subject: campaignEmail.subject,
                            preheader: campaignEmail.preheader || undefined,
                            body: campaignEmail.body,
                            html: campaignEmail.html || undefined,
                        }
                        : undefined,
                    sms: campaignSms ? { body: campaignSms.body } : undefined,
                };
            }
            // Collect jobs for bulk add
            const jobBatch = [];
            // Check existing jobs in parallel for idempotency
            const idempotencyKeys = result.customers.map((customer) => `${campaignId}_${customer.id}_${execution.id}`);
            const existingJobChecks = await Promise.all(idempotencyKeys.map((key) => customerQueue.getJob(key)));
            const existingJobSet = new Set(existingJobChecks
                .filter((job) => job !== undefined && job !== null)
                .map((job) => job.opts?.jobId));
            for (let i = 0; i < result.customers.length; i++) {
                const customer = result.customers[i];
                const idempotencyKey = idempotencyKeys[i];
                // Skip if already processed (idempotency)
                if (existingJobSet.has(idempotencyKey)) {
                    console.log(`[CampaignWorker] Skipping duplicate job for customer ${customer.id}`);
                    continue;
                }
                // Build experiment data if running an A/B test
                let experimentData;
                if (experiment) {
                    const cohort = assignCohort(experiment.id, customer.id, experiment.controlPercent);
                    // Create experiment assignment in database
                    await prisma.experimentAssignment.upsert({
                        where: {
                            experimentId_customerId: {
                                experimentId: experiment.id,
                                customerId: customer.id,
                            },
                        },
                        create: {
                            experimentId: experiment.id,
                            customerId: customer.id,
                            cohort,
                        },
                        update: {}, // Don't update if already exists (preserve original assignment)
                    });
                    experimentData = {
                        id: experiment.id,
                        cohort,
                        // Only include treatment overrides for treatment cohort
                        ...(cohort === 'treatment' && {
                            treatmentSubject: experiment.treatmentSubject || undefined,
                            treatmentBody: experiment.treatmentBody || undefined,
                            treatmentHtml: experiment.treatmentHtml || undefined,
                        }),
                    };
                }
                // Build recommendations config from campaign email settings (if present)
                const recommendationsConfig = campaign.email?.includeRecommendations
                    ? {
                        enabled: true,
                        algorithm: campaign.email.recommendationAlgorithm || undefined,
                        limit: campaign.email.recommendationLimit || undefined,
                        excludePurchased: campaign.email.excludePurchasedProducts || undefined,
                    }
                    : undefined;
                const customerJobData = {
                    campaignId: campaign.id,
                    customerId: customer.id,
                    channel: campaign.channel,
                    // Inline template content
                    templateContent,
                    executionId: execution.id,
                    isTest,
                    settings: {
                        timezone: appSettings?.timezone || 'UTC',
                        quietHoursStart: appSettings?.quietHoursStart || null,
                        quietHoursEnd: appSettings?.quietHoursEnd || null,
                    },
                    promo,
                    fallback: fallbackConfig,
                    // A/B Testing
                    experiment: experimentData,
                    // Product recommendations
                    recommendations: recommendationsConfig,
                };
                // Calculate delay for send time optimization
                let delay;
                if (campaign.enableSendTimeOptimization && !isTest) {
                    // Build quiet hours settings to avoid scheduling during quiet hours
                    const quietHoursSettings = appSettings?.quietHoursEnabled &&
                        appSettings?.quietHoursStart &&
                        appSettings?.quietHoursEnd
                        ? {
                            enabled: true,
                            startTime: appSettings.quietHoursStart,
                            endTime: appSettings.quietHoursEnd,
                            timezone: appSettings.timezone,
                            daysOfWeek: appSettings.quietHoursDays,
                        }
                        : undefined;
                    const profile = await getCustomerOptimalHour(customer.id);
                    if (profile) {
                        delay = calculateSendDelay(profile.hour, profile.timezone, campaign.maxOptimizationWindow, quietHoursSettings);
                        if (delay > 0) {
                            console.log(`[CampaignWorker] Send time optimization: delaying message to customer ${customer.id} by ${Math.round(delay / 3600000)}h (optimal hour: ${profile.hour})`);
                        }
                    }
                    else if (campaign.defaultSendHour !== null) {
                        // Use default send hour if no profile exists - fetch customer timezone
                        const customerRecord = await prisma.customer.findUnique({
                            where: { id: customer.id },
                            select: { timezone: true },
                        });
                        const customerTimezone = customerRecord?.timezone || appSettings?.timezone || 'UTC';
                        delay = calculateSendDelay(campaign.defaultSendHour, customerTimezone, campaign.maxOptimizationWindow, quietHoursSettings);
                    }
                }
                jobBatch.push({
                    name: `customer_${customer.id}`,
                    data: customerJobData,
                    opts: {
                        jobId: idempotencyKey,
                        ...(delay && delay > 0 && { delay }),
                    },
                });
                // For test runs, only process one customer
                if (isTest && jobBatch.length >= 1) {
                    break;
                }
            }
            // Bulk add jobs (much more efficient than individual adds)
            if (jobBatch.length > 0) {
                await customerQueue.addBulk(jobBatch);
                messagesEnqueued += jobBatch.length;
            }
            hasMore = result.hasMore && !isTest;
            page++;
        }
        // Update execution with customers matched
        await prisma.campaignExecution.update({
            where: { id: execution.id },
            data: {
                customersMatched,
                status: 'running', // Will be updated when all customer jobs complete
            },
        });
        // Mark "once" campaigns as executed
        if (campaign.executionType === 'once') {
            await prisma.campaignDefinition.update({
                where: { id: campaignId },
                data: { executedOnce: true },
            });
            console.log(`[CampaignWorker] Marked "once" campaign ${campaignId} as executed`);
        }
        console.log(`[CampaignWorker] Job ${job.id} completed: ${customersMatched} customers matched, ${messagesEnqueued} jobs enqueued`);
    }
    catch (err) {
        // Update execution with error
        await prisma.campaignExecution.update({
            where: { id: execution.id },
            data: {
                status: 'failed',
                completedAt: new Date(),
                errorMessage: err instanceof Error ? err.message : 'Unknown error',
            },
        });
        throw err;
    }
}
/**
 * Process a customer job - check eligibility and send message
 */
async function processCustomerJob(job) {
    const { campaignId, customerId, channel, templateContent, executionId, isTest } = job.data;
    const correlationId = `cust_${customerId}_${job.id}`;
    console.log(`[CustomerWorker] Processing job ${job.id} for customer ${customerId}`);
    // 1. Load customer
    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: {
            id: true,
            email: true,
            phone: true,
            name: true,
            optOut: true,
            optOutChannels: true,
            lastContactAt: true,
        },
    });
    if (!customer) {
        console.error(`[CustomerWorker] Customer ${customerId} not found`);
        throw new Error(`Customer ${customerId} not found`);
    }
    // 2. Check eligibility
    const eligibilityCustomer = {
        id: customer.id,
        email: customer.email,
        phone: customer.phone,
        optOut: customer.optOut,
        optOutChannels: customer.optOutChannels,
        lastContactAt: customer.lastContactAt,
    };
    const eligibility = await checkEligibility(eligibilityCustomer, {
        channel,
        campaignId,
    });
    if (!eligibility.eligible) {
        console.log(`[CustomerWorker] Customer ${customerId} not eligible: ${eligibility.reasons.join(', ')}`);
        // Update execution stats
        await prisma.campaignExecution.update({
            where: { id: executionId },
            data: {
                messagesSkipped: { increment: 1 },
            },
        });
        return;
    }
    // 3. Check quota limits (skip for test runs)
    if (!isTest) {
        const quotaCheck = await canSendMessage();
        if (!quotaCheck.allowed) {
            console.log(`[CustomerWorker] Quota exceeded: ${quotaCheck.reason}`);
            // Create message log with failure status
            await prisma.messageLog.create({
                data: {
                    campaignId,
                    customerId,
                    channel,
                    recipient: customer.email || customer.phone || 'unknown',
                    body: '[quota_exceeded]',
                    deliveryStatus: 'failed',
                    errorMessage: quotaCheck.reason || 'quota_exceeded',
                    executionId,
                    isTest,
                },
            });
            // Update execution stats
            await prisma.campaignExecution.update({
                where: { id: executionId },
                data: {
                    messagesSkipped: { increment: 1 },
                },
            });
            return;
        }
    }
    // 4. Determine recipient address
    let to;
    if (channel === 'email' && customer.email) {
        to = customer.email;
    }
    else if (channel === 'sms' && customer.phone) {
        to = customer.phone;
    }
    else {
        console.error(`[CustomerWorker] No contact info for customer ${customerId} on channel ${channel}`);
        await prisma.campaignExecution.update({
            where: { id: executionId },
            data: {
                messagesSkipped: { increment: 1 },
            },
        });
        return;
    }
    // 5. Render message content with promo placeholders
    const { promo, experiment, recommendations: recConfig } = job.data;
    // Fetch product recommendations if enabled or template needs them
    let recommendationsData;
    if (channel === 'email' && templateContent?.email) {
        const templateStr = `${templateContent.email.subject} ${templateContent.email.body} ${templateContent.email.html || ''}`;
        const needsRecs = recConfig?.enabled || templateNeedsRecommendations(templateStr);
        if (needsRecs) {
            const recResult = await fetchRecommendationsForMessage(customerId, {
                algorithm: recConfig?.algorithm,
                limit: recConfig?.limit,
                excludePurchased: recConfig?.excludePurchased,
                categoryFilter: recConfig?.categoryFilter,
                brandFilter: recConfig?.brandFilter,
            });
            if (recResult.items.length > 0) {
                recommendationsData = {
                    items: recResult.items,
                    config: recResult.config,
                };
            }
        }
    }
    const templateData = buildTemplateData(customer, promo, undefined, // product data (for browse abandonment)
    recommendationsData);
    // Log experiment cohort for debugging
    if (experiment) {
        console.log(`[CustomerWorker] Customer ${customerId} in experiment ${experiment.id}, cohort: ${experiment.cohort}`);
    }
    // Determine content based on template content
    let bodyContent;
    let subjectContent;
    let htmlContent;
    if (!templateContent) {
        throw new Error('No template content available');
    }
    const channelKey = channel;
    if (channelKey === 'email' && templateContent.email) {
        // Apply treatment overrides if in treatment cohort
        const subject = experiment?.cohort === 'treatment' && experiment.treatmentSubject
            ? experiment.treatmentSubject
            : templateContent.email.subject;
        const body = experiment?.cohort === 'treatment' && experiment.treatmentBody
            ? experiment.treatmentBody
            : templateContent.email.body;
        const html = experiment?.cohort === 'treatment' && experiment.treatmentHtml
            ? experiment.treatmentHtml
            : templateContent.email.html;
        subjectContent = renderInlineTemplate(subject, templateData);
        bodyContent = renderInlineTemplate(body, templateData);
        if (html) {
            htmlContent = renderInlineTemplate(html, templateData);
        }
    }
    else if (channelKey === 'sms' && templateContent.sms) {
        // Apply treatment body override for SMS if in treatment cohort
        const body = experiment?.cohort === 'treatment' && experiment.treatmentBody
            ? experiment.treatmentBody
            : templateContent.sms.body;
        bodyContent = renderInlineTemplate(body, templateData);
    }
    else {
        throw new Error(`No template content for channel: ${channel}`);
    }
    // 6. Create message log entry (pending)
    const messageLog = await prisma.messageLog.create({
        data: {
            campaignId,
            customerId,
            channel,
            recipient: to,
            body: bodyContent,
            subject: subjectContent || null,
            deliveryStatus: 'pending',
            correlationId,
            executionId,
            isTest,
            // A/B Testing tracking
            experimentId: experiment?.id || null,
            cohort: experiment?.cohort || null,
        },
    });
    try {
        // 7. Get provider and send
        const provider = getProviderForChannel(channel);
        const outgoingMessage = {
            to,
            body: bodyContent,
            subject: subjectContent,
            html: htmlContent,
        };
        const result = await provider.send(outgoingMessage);
        if (result.success) {
            // Update message log with success
            await prisma.messageLog.update({
                where: { id: messageLog.id },
                data: {
                    deliveryStatus: 'sent',
                    sentAt: new Date(),
                    providerName: provider.name,
                    providerMessageId: result.providerMessageId,
                    providerResponse: result.providerResponse
                        ? JSON.parse(JSON.stringify(result.providerResponse))
                        : undefined,
                },
            });
            // Update customer last contact time
            await prisma.customer.update({
                where: { id: customerId },
                data: { lastContactAt: new Date() },
            });
            // Update execution stats
            await prisma.campaignExecution.update({
                where: { id: executionId },
                data: {
                    messagesSent: { increment: 1 },
                },
            });
            // Track promo grant if applicable (skip for test runs)
            // Now references campaignId instead of discountId/giftId
            if (promo && !isTest) {
                try {
                    if (promo.type === 'discount') {
                        // Create a discount redemption record showing the code was sent
                        await prisma.discountRedemption.create({
                            data: {
                                campaignId: promo.promoId, // Now using campaignId
                                customerId,
                                discountType: 'percentage', // Will be updated when actually redeemed
                                discountValue: 0, // Will be filled when actually redeemed at checkout
                                code: promo.code,
                                status: 'pending', // Pending until redeemed
                            },
                        });
                        console.log(`[CustomerWorker] Tracked discount code ${promo.code} sent to ${customerId}`);
                    }
                    else if (promo.type === 'gift') {
                        // Create a gift grant record
                        await prisma.giftGrant.create({
                            data: {
                                campaignId: promo.promoId, // Now using campaignId
                                customerId,
                                giftType: 'redemption_code', // Will be updated based on campaign gift type
                                code: promo.code,
                                status: 'granted',
                            },
                        });
                        console.log(`[CustomerWorker] Tracked gift code ${promo.code} granted to ${customerId}`);
                    }
                }
                catch (promoErr) {
                    // Log but don't fail the message send
                    console.error(`[CustomerWorker] Failed to track promo grant:`, promoErr);
                }
            }
            // Audit log
            await createAuditLog({
                action: AuditActions.message.sent,
                resourceType: 'message',
                resourceId: messageLog.id,
                metadata: {
                    campaignId,
                    customerId,
                    channel,
                    providerMessageId: result.providerMessageId,
                    jobId: job.id,
                },
                context: {},
            });
            console.log(`[CustomerWorker] Message sent to customer ${customerId}, messageLog: ${messageLog.id}`);
        }
        else {
            // Update message log with failure
            await prisma.messageLog.update({
                where: { id: messageLog.id },
                data: {
                    deliveryStatus: result.retryable ? 'pending' : 'failed',
                    providerName: provider.name,
                    errorMessage: result.error,
                    retryCount: job.attemptsMade,
                },
            });
            if (!result.retryable) {
                // Check if we should attempt channel fallback
                const fallbackData = job.data.fallback;
                const fallbackConfig = fallbackData?.config || DEFAULT_FALLBACK_CONFIG;
                const attemptedChannels = fallbackData?.attemptedChannels || [channel];
                const primaryChannel = fallbackData?.primaryChannel || channel;
                // Determine if fallback should be triggered
                const triggerFallback = fallbackConfig.enabled &&
                    shouldTriggerFallback(result.error || 'unknown', false, fallbackConfig);
                if (triggerFallback) {
                    const nextChannel = getNextFallbackChannel(attemptedChannels, primaryChannel, fallbackConfig);
                    if (nextChannel) {
                        // Enqueue fallback job
                        console.log(`[CustomerWorker] Triggering fallback from ${channel} to ${nextChannel} for customer ${customerId}`);
                        const customerQueue = getCustomerQueue();
                        const fallbackJobData = {
                            ...job.data,
                            channel: nextChannel,
                            fallback: {
                                enabled: true,
                                primaryChannel,
                                attemptedChannels: [...attemptedChannels, nextChannel],
                                originalMessageLogId: fallbackData?.originalMessageLogId || messageLog.id,
                                config: fallbackConfig,
                            },
                        };
                        await customerQueue.add(`fallback_${customerId}_${nextChannel}_${Date.now()}`, fallbackJobData);
                        // Update original message log to note fallback
                        await prisma.messageLog.update({
                            where: { id: messageLog.id },
                            data: {
                                errorMessage: `${result.error} - Falling back to ${nextChannel}`,
                            },
                        });
                        // Don't count as failed since we're retrying on another channel
                        return;
                    }
                }
                // No fallback available or not triggered - count as permanent failure
                await prisma.campaignExecution.update({
                    where: { id: executionId },
                    data: {
                        messagesFailed: { increment: 1 },
                    },
                });
            }
            // Audit log
            await createAuditLog({
                action: AuditActions.message.failed,
                resourceType: 'message',
                resourceId: messageLog.id,
                metadata: {
                    campaignId,
                    customerId,
                    channel,
                    error: result.error,
                    retryable: result.retryable,
                    jobId: job.id,
                    fallbackAttempted: job.data.fallback?.enabled || false,
                    attemptedChannels: job.data.fallback?.attemptedChannels || [channel],
                },
                context: {},
            });
            if (result.retryable) {
                throw new Error(result.error || 'Retryable send failure');
            }
        }
    }
    catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        // Update message log with error
        await prisma.messageLog.update({
            where: { id: messageLog.id },
            data: {
                deliveryStatus: 'failed',
                errorMessage,
                retryCount: job.attemptsMade,
            },
        });
        throw err; // Re-throw for BullMQ retry handling
    }
}
/**
 * Start the campaign worker
 */
export function startCampaignWorker() {
    if (campaignWorker) {
        return campaignWorker;
    }
    campaignWorker = new Worker(QUEUE_NAMES.CAMPAIGN, async (job) => {
        await processCampaignJob(job);
    }, {
        connection: getRedisConnection(),
        concurrency: getWorkerConcurrency(),
    });
    // Handle job completion
    campaignWorker.on('completed', (job) => {
        console.log(`[CampaignWorker] Job ${job.id} completed successfully`);
    });
    // Handle job failure
    campaignWorker.on('failed', async (job, err) => {
        console.error(`[CampaignWorker] Job ${job?.id} failed:`, err.message);
        if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
            // Max retries reached, move to DLQ
            await moveToDeadLetter(QUEUE_NAMES.CAMPAIGN, job, err);
        }
    });
    console.log('[CampaignWorker] Started');
    return campaignWorker;
}
/**
 * Start the customer worker
 */
export function startCustomerWorker() {
    if (customerWorker) {
        return customerWorker;
    }
    customerWorker = new Worker(QUEUE_NAMES.CUSTOMER, async (job) => {
        await processCustomerJob(job);
    }, {
        connection: getRedisConnection(),
        concurrency: getWorkerConcurrency() * 2, // Higher concurrency for customer jobs
    });
    // Handle job completion
    customerWorker.on('completed', (job) => {
        console.log(`[CustomerWorker] Job ${job.id} completed successfully`);
    });
    // Handle job failure
    customerWorker.on('failed', async (job, err) => {
        console.error(`[CustomerWorker] Job ${job?.id} failed:`, err.message);
        if (job && job.attemptsMade >= (job.opts.attempts || 5)) {
            // Max retries reached, move to DLQ
            await moveToDeadLetter(QUEUE_NAMES.CUSTOMER, job, err);
            // Update execution stats
            if (job.data.executionId) {
                await prisma.campaignExecution.update({
                    where: { id: job.data.executionId },
                    data: {
                        messagesFailed: { increment: 1 },
                    },
                });
            }
        }
    });
    console.log('[CustomerWorker] Started');
    return customerWorker;
}
/**
 * Start all workers
 */
export function startAllWorkers() {
    return {
        campaignWorker: startCampaignWorker(),
        customerWorker: startCustomerWorker(),
    };
}
/**
 * Stop all workers gracefully
 */
export async function stopAllWorkers() {
    const closePromises = [];
    if (campaignWorker) {
        closePromises.push(campaignWorker.close());
        campaignWorker = null;
    }
    if (customerWorker) {
        closePromises.push(customerWorker.close());
        customerWorker = null;
    }
    await Promise.all(closePromises);
    console.log('[Workers] All workers stopped');
}
/**
 * Check if workers are running
 */
export function areWorkersRunning() {
    return {
        campaign: campaignWorker !== null && campaignWorker.isRunning(),
        customer: customerWorker !== null && customerWorker.isRunning(),
    };
}
