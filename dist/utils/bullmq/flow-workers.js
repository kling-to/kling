/**
 * Flow Workers
 *
 * Implements job processors for flow enrollment and step execution.
 */
import { Worker } from 'bullmq';
import { getRedisConnection, QUEUE_NAMES, getWorkerConcurrency } from './connection';
import { getFlowStepQueue } from './queues';
import prisma from '../prisma';
import { checkEligibility } from '../eligibility';
import { getProviderForChannel } from '../../providers';
import { createAuditLog } from '../audit';
import { canSendMessage } from '../quotas';
import { buildTemplateData, renderInlineTemplate, } from '../template-renderer';
import { fetchRecommendationsForMessage, templateNeedsRecommendations, } from '../recommendation-fetcher';
// System context for background worker audit logs
const SYSTEM_AUDIT_CONTEXT = {
    userId: undefined,
    ipAddress: 'system',
    userAgent: 'flow-worker',
};
// Worker instances
let flowEnrollmentWorker = null;
let flowStepWorker = null;
// ------------------------------------------------------
// HELPER FUNCTIONS
// ------------------------------------------------------
/**
 * Get next node IDs from current node (non-conditional edges)
 * Uses React Flow format: source/target instead of from/to
 * Excludes edges that have sourceHandle (used for conditional splits)
 */
function getNextNodes(definition, currentNodeId) {
    return definition.edges
        .filter((e) => e.source === currentNodeId && !e.sourceHandle && !e.data?.condition)
        .map((e) => e.target);
}
/**
 * Get next node IDs for a specific sourceHandle (used for conditional splits)
 * React Flow uses sourceHandle to identify which output handle an edge connects from
 */
function getNextNodesByHandle(definition, currentNodeId, handle) {
    return definition.edges
        .filter((e) => e.source === currentNodeId && e.sourceHandle === handle)
        .map((e) => e.target);
}
/**
 * Get nested value from object by dot-notation path
 */
function getNestedValue(obj, path) {
    return path.split('.').reduce((acc, part) => {
        return acc && typeof acc === 'object' ? acc[part] : undefined;
    }, obj);
}
/**
 * Evaluate a single condition
 */
function evaluateCondition(actualValue, operator, expectedValue) {
    switch (operator) {
        case 'eq':
            return actualValue === expectedValue;
        case 'neq':
            return actualValue !== expectedValue;
        case 'gt':
            return Number(actualValue) > Number(expectedValue);
        case 'gte':
            return Number(actualValue) >= Number(expectedValue);
        case 'lt':
            return Number(actualValue) < Number(expectedValue);
        case 'lte':
            return Number(actualValue) <= Number(expectedValue);
        case 'contains':
            return String(actualValue).toLowerCase().includes(String(expectedValue).toLowerCase());
        default:
            return false;
    }
}
/**
 * Evaluate conditions for conditional split
 */
function evaluateConditions(conditions, contextData) {
    for (const condition of conditions) {
        const value = getNestedValue(contextData, condition.field);
        const matches = evaluateCondition(value, condition.operator, condition.value);
        if (matches) {
            return condition;
        }
    }
    return null;
}
// ------------------------------------------------------
// FLOW ENROLLMENT WORKER
// ------------------------------------------------------
/**
 * Process flow enrollment job
 *
 * Triggered when an event matches a flow's trigger:
 * 1. Check if customer can enroll (re-enrollment rules, max enrollments)
 * 2. Check eligibility (opt-out)
 * 3. Create FlowEnrollment record
 * 4. Enqueue first step
 */
async function processFlowEnrollment(job) {
    const { flowId, customerId, triggerEventId, triggerData } = job.data;
    console.log(`[FlowEnrollmentWorker] Processing enrollment for flow ${flowId}, customer ${customerId}`);
    // 1. Load flow
    const flow = await prisma.flow.findUnique({ where: { id: flowId } });
    if (!flow || flow.status !== 'active') {
        console.log(`[FlowEnrollmentWorker] Flow ${flowId} not active, skipping`);
        return;
    }
    // 2. Check re-enrollment rules
    if (!flow.allowReenrollment) {
        const existingEnrollment = await prisma.flowEnrollment.findFirst({
            where: {
                flowId,
                customerId,
                status: { in: ['active', 'completed'] },
            },
        });
        if (existingEnrollment) {
            console.log(`[FlowEnrollmentWorker] Customer ${customerId} already enrolled in flow ${flowId}, skipping`);
            return;
        }
    }
    else if (flow.reenrollmentWaitDays) {
        // Check if enough time has passed since last enrollment
        const lastEnrollment = await prisma.flowEnrollment.findFirst({
            where: { flowId, customerId },
            orderBy: { enrolledAt: 'desc' },
        });
        if (lastEnrollment) {
            const waitMs = flow.reenrollmentWaitDays * 24 * 60 * 60 * 1000;
            const timeSinceLastEnrollment = Date.now() - lastEnrollment.enrolledAt.getTime();
            if (timeSinceLastEnrollment < waitMs) {
                console.log(`[FlowEnrollmentWorker] Customer ${customerId} enrolled too recently, need to wait ${flow.reenrollmentWaitDays} days`);
                return;
            }
        }
    }
    // 3. Check global enrollment cap
    if (flow.maxEnrollments) {
        const enrollmentCount = await prisma.flowEnrollment.count({
            where: { flowId, status: 'active' },
        });
        if (enrollmentCount >= flow.maxEnrollments) {
            console.log(`[FlowEnrollmentWorker] Flow ${flowId} at max enrollments (${flow.maxEnrollments})`);
            return;
        }
    }
    // 4. Load customer for eligibility check
    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: {
            id: true,
            email: true,
            phone: true,
            name: true,
            firstName: true,
            lastName: true,
            optOut: true,
            optOutChannels: true,
            lastContactAt: true,
            totalOrders: true,
            totalSpent: true,
        },
    });
    if (!customer) {
        console.error(`[FlowEnrollmentWorker] Customer ${customerId} not found`);
        return;
    }
    // 5. Basic eligibility check (global opt-out only at enrollment)
    if (customer.optOut) {
        console.log(`[FlowEnrollmentWorker] Customer ${customerId} opted out globally, skipping`);
        return;
    }
    // 6. Create enrollment
    const definition = flow.definition;
    const contextData = {
        trigger: triggerData,
        customer: {
            id: customer.id,
            email: customer.email,
            phone: customer.phone,
            name: customer.name,
            firstName: customer.firstName,
            lastName: customer.lastName,
            totalOrders: customer.totalOrders,
            totalSpent: customer.totalSpent,
        },
        enrolledAt: new Date().toISOString(),
    };
    const enrollment = await prisma.flowEnrollment.create({
        data: {
            flowId,
            customerId,
            status: 'active',
            currentStepId: definition.startNodeId,
            contextData: JSON.parse(JSON.stringify(contextData)),
            correlationId: `flow_${flowId}_${job.id}`,
            triggerEventId,
        },
    });
    console.log(`[FlowEnrollmentWorker] Created enrollment ${enrollment.id} for customer ${customerId} in flow ${flowId}`);
    // 7. Enqueue first step
    const flowStepQueue = getFlowStepQueue();
    await flowStepQueue.add(`step_${enrollment.id}_${definition.startNodeId}`, {
        enrollmentId: enrollment.id,
        flowId,
        customerId,
        stepNodeId: definition.startNodeId,
        contextData,
    });
    // Audit log
    await createAuditLog({
        action: 'flow_enrollment_created',
        resourceType: 'flow_enrollment',
        resourceId: enrollment.id,
        metadata: { flowId, customerId, triggerEventId },
        context: SYSTEM_AUDIT_CONTEXT,
    });
}
// ------------------------------------------------------
// FLOW STEP WORKER
// ------------------------------------------------------
/**
 * Get the message channel from node type
 */
function getChannelFromNodeType(nodeType) {
    switch (nodeType) {
        case 'send_email':
            return 'email';
        case 'send_sms':
            return 'sms';
        case 'send_whatsapp':
            return 'whatsapp';
        case 'send_rcs':
            return 'rcs';
        case 'send_push':
            return 'push';
        default:
            return null;
    }
}
/**
 * Execute send message step (email, SMS, WhatsApp, RCS, or Push)
 */
async function executeSendMessageStep(node, enrollment, customerId, stepNodeId) {
    const channel = getChannelFromNodeType(node.type);
    if (!channel) {
        throw new Error(`Invalid send node type: ${node.type}`);
    }
    // Load customer
    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: {
            id: true,
            email: true,
            phone: true,
            whatsappNumber: true,
            pushToken: true,
            name: true,
            firstName: true,
            lastName: true,
            optOut: true,
            optOutChannels: true,
            lastContactAt: true,
        },
    });
    if (!customer) {
        console.error(`[FlowStepWorker] Customer ${customerId} not found`);
        throw new Error(`Customer ${customerId} not found`);
    }
    // Check eligibility
    const eligibility = await checkEligibility(customer, {
        channel,
        campaignId: enrollment.flowId, // Use flowId for tracking
    });
    if (!eligibility.eligible) {
        console.log(`[FlowStepWorker] Customer ${customerId} not eligible: ${eligibility.reasons.join(', ')}`);
        return;
    }
    // Check quota
    const quotaCheck = await canSendMessage();
    if (!quotaCheck.allowed) {
        console.log(`[FlowStepWorker] Quota exceeded: ${quotaCheck.reason}`);
        return;
    }
    // Check if we need to fetch product recommendations
    let recommendationsData;
    if (channel === 'email') {
        const emailConfig = node.data.config;
        const templateContent = `${emailConfig.subject} ${emailConfig.body} ${emailConfig.html || ''}`;
        const needsRecs = emailConfig.includeRecommendations || templateNeedsRecommendations(templateContent);
        if (needsRecs) {
            const recConfig = {
                algorithm: emailConfig.recommendationAlgorithm,
                limit: emailConfig.recommendationLimit,
                excludePurchased: emailConfig.excludePurchasedProducts,
                categoryFilter: emailConfig.recommendationCategoryFilter,
                brandFilter: emailConfig.recommendationBrandFilter,
            };
            const recResult = await fetchRecommendationsForMessage(customerId, recConfig);
            if (recResult.items.length > 0) {
                recommendationsData = {
                    items: recResult.items,
                    config: recResult.config,
                };
            }
        }
    }
    // Render message content with context data (including recommendations if available)
    const templateData = buildTemplateData({
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        firstName: customer.firstName,
        lastName: customer.lastName,
    }, undefined, // promo
    undefined, // product
    recommendationsData);
    let recipient;
    let body;
    let subject;
    let html;
    let metadata;
    switch (channel) {
        case 'email': {
            const emailConfig = node.data.config;
            if (!customer.email) {
                console.log(`[FlowStepWorker] Customer ${customerId} has no email, skipping`);
                return;
            }
            recipient = customer.email;
            subject = renderInlineTemplate(emailConfig.subject, templateData);
            body = renderInlineTemplate(emailConfig.body, templateData);
            if (emailConfig.html) {
                html = renderInlineTemplate(emailConfig.html, templateData);
            }
            break;
        }
        case 'sms': {
            const smsConfig = node.data.config;
            if (!customer.phone) {
                console.log(`[FlowStepWorker] Customer ${customerId} has no phone, skipping`);
                return;
            }
            recipient = customer.phone;
            body = renderInlineTemplate(smsConfig.body, templateData);
            break;
        }
        case 'whatsapp': {
            const waConfig = node.data.config;
            const waNumber = customer.whatsappNumber || customer.phone;
            if (!waNumber) {
                console.log(`[FlowStepWorker] Customer ${customerId} has no WhatsApp number, skipping`);
                return;
            }
            recipient = waNumber;
            body = renderInlineTemplate(waConfig.body, templateData);
            if (waConfig.mediaUrl) {
                metadata = {
                    mediaUrl: waConfig.mediaUrl,
                    mediaType: waConfig.mediaType,
                };
            }
            break;
        }
        case 'rcs': {
            const rcsConfig = node.data.config;
            if (!customer.phone) {
                console.log(`[FlowStepWorker] Customer ${customerId} has no phone for RCS, skipping`);
                return;
            }
            recipient = customer.phone;
            body = renderInlineTemplate(rcsConfig.body, templateData);
            if (rcsConfig.title) {
                subject = renderInlineTemplate(rcsConfig.title, templateData);
            }
            if (rcsConfig.imageUrl || rcsConfig.suggestions) {
                metadata = {
                    imageUrl: rcsConfig.imageUrl,
                    suggestions: rcsConfig.suggestions,
                };
            }
            break;
        }
        case 'push': {
            const pushConfig = node.data.config;
            if (!customer.pushToken) {
                console.log(`[FlowStepWorker] Customer ${customerId} has no push token, skipping`);
                return;
            }
            recipient = customer.pushToken;
            subject = renderInlineTemplate(pushConfig.title, templateData);
            body = renderInlineTemplate(pushConfig.body, templateData);
            metadata = {
                imageUrl: pushConfig.imageUrl,
                deepLink: pushConfig.deepLink,
                data: pushConfig.data,
            };
            break;
        }
        default:
            throw new Error(`Unsupported channel: ${channel}`);
    }
    // Create message log with flow tracking fields
    const messageLog = await prisma.messageLog.create({
        data: {
            customerId,
            channel,
            recipient,
            body,
            subject: subject || null,
            deliveryStatus: 'pending',
            correlationId: enrollment.correlationId,
            // Flow tracking fields (links message to flow enrollment)
            flowId: enrollment.flowId,
            flowEnrollmentId: enrollment.id,
            flowStepId: stepNodeId,
        },
    });
    // Send via provider
    try {
        const provider = getProviderForChannel(channel);
        const outgoingMessage = {
            to: recipient,
            body,
            subject,
            html,
            metadata,
        };
        const result = await provider.send(outgoingMessage);
        // Update message log
        await prisma.messageLog.update({
            where: { id: messageLog.id },
            data: {
                deliveryStatus: result.success ? 'sent' : 'failed',
                sentAt: result.success ? new Date() : null,
                providerName: provider.name,
                providerMessageId: result.providerMessageId,
                errorMessage: result.error,
            },
        });
        // Update customer last contact time
        if (result.success) {
            await prisma.customer.update({
                where: { id: customerId },
                data: { lastContactAt: new Date() },
            });
        }
        console.log(`[FlowStepWorker] Sent ${channel} to ${customerId}, messageLog: ${messageLog.id}, success: ${result.success}`);
    }
    catch (error) {
        // Update message log with error
        await prisma.messageLog.update({
            where: { id: messageLog.id },
            data: {
                deliveryStatus: 'failed',
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
            },
        });
        throw error;
    }
}
/**
 * Process flow step job
 *
 * Executes a single step in a flow:
 * 1. Load enrollment and flow
 * 2. Execute step action (send message, wait, evaluate condition)
 * 3. Update enrollment state
 * 4. Enqueue next step(s)
 */
async function processFlowStep(job) {
    const { enrollmentId, flowId, customerId, stepNodeId, contextData } = job.data;
    console.log(`[FlowStepWorker] Processing step ${stepNodeId} for enrollment ${enrollmentId}`);
    // 1. Load enrollment
    const enrollment = await prisma.flowEnrollment.findUnique({
        where: { id: enrollmentId },
    });
    if (!enrollment || enrollment.status !== 'active') {
        console.log(`[FlowStepWorker] Enrollment ${enrollmentId} not active, skipping`);
        return;
    }
    // 2. Load flow and find current node
    const flow = await prisma.flow.findUnique({ where: { id: flowId } });
    if (!flow) {
        console.error(`[FlowStepWorker] Flow ${flowId} not found`);
        throw new Error(`Flow ${flowId} not found`);
    }
    // Check if flow is still active
    if (flow.status !== 'active') {
        console.log(`[FlowStepWorker] Flow ${flowId} is no longer active, exiting enrollment`);
        await prisma.flowEnrollment.update({
            where: { id: enrollmentId },
            data: {
                status: 'exited',
                exitedAt: new Date(),
                errorMessage: 'Flow deactivated during execution',
            },
        });
        return;
    }
    const definition = flow.definition;
    const node = definition.nodes.find((n) => n.id === stepNodeId);
    if (!node) {
        console.error(`[FlowStepWorker] Node ${stepNodeId} not found in flow ${flowId}`);
        throw new Error(`Node ${stepNodeId} not found in flow ${flowId}`);
    }
    console.log(`[FlowStepWorker] Executing step ${stepNodeId} (type: ${node.type})`);
    // 3. Execute step based on type
    let nextNodeIds = [];
    const flowStepQueue = getFlowStepQueue();
    try {
        switch (node.type) {
            case 'send_email':
            case 'send_sms':
            case 'send_whatsapp':
            case 'send_rcs':
            case 'send_push':
                await executeSendMessageStep(node, { id: enrollment.id, flowId: enrollment.flowId, correlationId: enrollment.correlationId }, customerId, stepNodeId);
                nextNodeIds = getNextNodes(definition, stepNodeId);
                break;
            case 'wait': {
                // Wait step: schedule next step with delay
                const waitConfig = node.data.config;
                const delayMs = waitConfig.delay * 1000; // Convert seconds to milliseconds
                nextNodeIds = getNextNodes(definition, stepNodeId);
                // Enqueue next steps with delay
                for (const nextNodeId of nextNodeIds) {
                    await flowStepQueue.add(`step_${enrollmentId}_${nextNodeId}`, {
                        enrollmentId,
                        flowId,
                        customerId,
                        stepNodeId: nextNodeId,
                        contextData,
                    }, {
                        delay: delayMs,
                    });
                }
                // Update enrollment
                await prisma.flowEnrollment.update({
                    where: { id: enrollmentId },
                    data: {
                        currentStepId: nextNodeIds[0] || null,
                        lastStepAt: new Date(),
                        stepsCompleted: { increment: 1 },
                    },
                });
                console.log(`[FlowStepWorker] Wait step scheduled ${nextNodeIds.length} next steps with ${delayMs}ms delay`);
                // Audit log
                await createAuditLog({
                    action: 'flow_step_executed',
                    resourceType: 'flow_enrollment',
                    resourceId: enrollmentId,
                    metadata: { flowId, customerId, stepNodeId, stepType: node.type },
                    context: SYSTEM_AUDIT_CONTEXT,
                });
                return; // Early return - next steps enqueued with delay
            }
            case 'conditional_split': {
                const splitConfig = node.data.config;
                // Refresh customer data for condition evaluation
                const customer = await prisma.customer.findUnique({
                    where: { id: customerId },
                    select: {
                        totalOrders: true,
                        totalSpent: true,
                        lastOrderAt: true,
                    },
                });
                // Merge fresh customer data into context
                const enrichedContext = {
                    ...contextData,
                    customer: {
                        ...contextData.customer,
                        totalOrders: customer?.totalOrders ?? 0,
                        totalSpent: customer?.totalSpent ?? 0,
                        lastOrderAt: customer?.lastOrderAt?.toISOString() ?? null,
                    },
                };
                const matchingCondition = evaluateConditions(splitConfig.conditions, enrichedContext);
                if (matchingCondition) {
                    // Use sourceHandle to route - "true" handle for matched conditions
                    nextNodeIds = getNextNodesByHandle(definition, stepNodeId, 'true');
                    console.log(`[FlowStepWorker] Conditional split matched: ${matchingCondition.label}, routing to "true" branch, next nodes: ${nextNodeIds.join(', ')}`);
                }
                else {
                    // No condition matched - use "false" handle
                    nextNodeIds = getNextNodesByHandle(definition, stepNodeId, 'false');
                    console.log(`[FlowStepWorker] No condition matched, routing to "false" branch, next nodes: ${nextNodeIds.join(', ')}`);
                }
                break;
            }
            case 'exit_flow': {
                const exitConfig = node.data.config;
                await prisma.flowEnrollment.update({
                    where: { id: enrollmentId },
                    data: {
                        status: 'completed',
                        currentStepId: null,
                        completedAt: new Date(),
                        stepsCompleted: { increment: 1 },
                    },
                });
                await createAuditLog({
                    action: 'flow_enrollment_completed',
                    resourceType: 'flow_enrollment',
                    resourceId: enrollmentId,
                    metadata: { flowId, customerId, exitReason: exitConfig.reason },
                    context: SYSTEM_AUDIT_CONTEXT,
                });
                console.log(`[FlowStepWorker] Flow completed for enrollment ${enrollmentId}`);
                return; // Early return - flow is done
            }
            case 'trigger':
                // Trigger node is the entry point - just move to next nodes
                console.log(`[FlowStepWorker] Processing trigger node, moving to next steps`);
                nextNodeIds = getNextNodes(definition, stepNodeId);
                break;
            default:
                console.error(`[FlowStepWorker] Unknown step type: ${node.type}`);
                throw new Error(`Unknown step type: ${node.type}`);
        }
        // 4. Enqueue next steps (for non-wait, non-exit steps)
        if (nextNodeIds.length > 0) {
            for (const nextNodeId of nextNodeIds) {
                await flowStepQueue.add(`step_${enrollmentId}_${nextNodeId}`, {
                    enrollmentId,
                    flowId,
                    customerId,
                    stepNodeId: nextNodeId,
                    contextData,
                });
            }
            // Update enrollment
            await prisma.flowEnrollment.update({
                where: { id: enrollmentId },
                data: {
                    currentStepId: nextNodeIds[0],
                    lastStepAt: new Date(),
                    stepsCompleted: { increment: 1 },
                },
            });
        }
        else {
            // No next nodes - flow has ended
            await prisma.flowEnrollment.update({
                where: { id: enrollmentId },
                data: {
                    status: 'completed',
                    currentStepId: null,
                    completedAt: new Date(),
                    stepsCompleted: { increment: 1 },
                },
            });
            console.log(`[FlowStepWorker] No next nodes, flow completed for enrollment ${enrollmentId}`);
        }
        // Audit log
        await createAuditLog({
            action: 'flow_step_executed',
            resourceType: 'flow_enrollment',
            resourceId: enrollmentId,
            metadata: { flowId, customerId, stepNodeId, stepType: node.type },
            context: SYSTEM_AUDIT_CONTEXT,
        });
    }
    catch (error) {
        // Update enrollment with error
        await prisma.flowEnrollment.update({
            where: { id: enrollmentId },
            data: {
                stepsFailed: { increment: 1 },
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
                errorDetails: error instanceof Error ? { stack: error.stack } : null,
            },
        });
        throw error;
    }
}
// ------------------------------------------------------
// WORKER MANAGEMENT
// ------------------------------------------------------
/**
 * Start the flow enrollment worker
 */
export function startFlowEnrollmentWorker() {
    if (flowEnrollmentWorker) {
        console.log('[FlowEnrollmentWorker] Already running');
        return flowEnrollmentWorker;
    }
    flowEnrollmentWorker = new Worker(QUEUE_NAMES.FLOW_ENROLLMENT, processFlowEnrollment, {
        connection: getRedisConnection(),
        concurrency: getWorkerConcurrency(),
    });
    flowEnrollmentWorker.on('completed', (job) => {
        console.log(`[FlowEnrollmentWorker] Job ${job.id} completed`);
    });
    flowEnrollmentWorker.on('failed', (job, error) => {
        console.error(`[FlowEnrollmentWorker] Job ${job?.id} failed:`, error);
    });
    console.log('[FlowEnrollmentWorker] Started');
    return flowEnrollmentWorker;
}
/**
 * Start the flow step worker
 */
export function startFlowStepWorker() {
    if (flowStepWorker) {
        console.log('[FlowStepWorker] Already running');
        return flowStepWorker;
    }
    flowStepWorker = new Worker(QUEUE_NAMES.FLOW_STEP, processFlowStep, {
        connection: getRedisConnection(),
        concurrency: getWorkerConcurrency() * 2, // Higher concurrency for steps
    });
    flowStepWorker.on('completed', (job) => {
        console.log(`[FlowStepWorker] Job ${job.id} completed`);
    });
    flowStepWorker.on('failed', (job, error) => {
        console.error(`[FlowStepWorker] Job ${job?.id} failed:`, error);
    });
    console.log('[FlowStepWorker] Started');
    return flowStepWorker;
}
/**
 * Start all flow workers
 */
export function startFlowWorkers() {
    startFlowEnrollmentWorker();
    startFlowStepWorker();
    console.log('[FlowWorkers] All flow workers started');
}
/**
 * Stop all flow workers
 */
export async function stopFlowWorkers() {
    const stopPromises = [];
    if (flowEnrollmentWorker) {
        stopPromises.push(flowEnrollmentWorker.close());
        flowEnrollmentWorker = null;
    }
    if (flowStepWorker) {
        stopPromises.push(flowStepWorker.close());
        flowStepWorker = null;
    }
    await Promise.all(stopPromises);
    console.log('[FlowWorkers] All flow workers stopped');
}
/**
 * Check if flow workers are running
 */
export function areFlowWorkersRunning() {
    return flowEnrollmentWorker !== null && flowStepWorker !== null;
}
