import prisma from '../prisma';
import { executeQuery, parseQueryDSL } from '../query-executor';
import { checkEligibility } from '../eligibility';
import { getProviderForChannel } from '../../providers';
import { createAuditLog, AuditActions } from '../audit';
/**
 * Activity: Load workflow definition from database.
 */
export async function loadWorkflowDefinition(input) {
    const workflow = await prisma.workflowDefinition.findUnique({
        where: { id: input.workflowDefinitionId },
        include: {
            tenant: {
                select: {
                    timezone: true,
                    quietHoursStart: true,
                    quietHoursEnd: true,
                },
            },
        },
    });
    if (!workflow || !workflow.tenant) {
        return null;
    }
    return {
        id: workflow.id,
        tenantId: workflow.tenantId,
        name: workflow.name,
        query: workflow.query,
        messageTemplate: workflow.messageTemplate,
        channel: workflow.channel,
        conditions: workflow.conditions,
        retrieval: workflow.retrieval,
        tenant: {
            timezone: workflow.tenant.timezone,
            quietHoursStart: workflow.tenant.quietHoursStart,
            quietHoursEnd: workflow.tenant.quietHoursEnd,
        },
    };
}
/**
 * Activity: Execute workflow query to find matching customers.
 */
export async function executeWorkflowQuery(input) {
    const dsl = parseQueryDSL(input.query);
    const result = await executeQuery(input.tenantId, dsl, {
        excludeOptedOut: true,
        page: input.page,
        pageSize: input.pageSize,
    });
    return {
        customerIds: result.customers.map((c) => c.id),
        total: result.total,
        hasMore: result.hasMore,
    };
}
/**
 * Activity: Check if a customer is eligible to receive a message.
 */
export async function checkCustomerEligibility(input) {
    const customer = await prisma.customer.findUnique({
        where: { id: input.customerId },
        select: {
            id: true,
            email: true,
            phone: true,
            optOut: true,
            optOutChannels: true,
            lastContactAt: true,
        },
    });
    if (!customer) {
        return {
            eligible: false,
            reasons: ['customer_not_found'],
            customer: null,
        };
    }
    const result = await checkEligibility(customer, {
        channel: input.channel,
        tenantId: input.tenantId,
        workflowId: input.workflowId,
        tenant: input.tenant,
    });
    return {
        eligible: result.eligible,
        reasons: result.reasons,
        customer,
    };
}
/**
 * Activity: Send a message to a customer.
 */
export async function sendMessage(input) {
    const { workflowId, tenantId, customerId, channel, messageTemplate, customer, temporalRunId } = input;
    // Determine recipient address
    let to;
    if (channel === 'email' && customer.email) {
        to = customer.email;
    }
    else if (channel === 'sms' && customer.phone) {
        to = customer.phone;
    }
    else {
        return {
            success: false,
            messageLogId: null,
            providerMessageId: null,
            error: `No contact info for channel ${channel}`,
        };
    }
    // Render message template
    const content = renderTemplate(messageTemplate, {
        name: customer.name || 'Customer',
        email: customer.email || '',
        phone: customer.phone || '',
    });
    // Create message log entry (pending)
    const messageLog = await prisma.messageLog.create({
        data: {
            workflowId,
            tenantId,
            customerId,
            channel,
            recipient: to,
            body: content,
            subject: channel === 'email' ? 'Message from your store' : null,
            deliveryStatus: 'pending',
            temporalRunId,
            isTest: input.isTest,
        },
    });
    try {
        // Get provider and send
        const provider = getProviderForChannel(channel);
        const outgoingMessage = {
            to,
            body: content,
            subject: channel === 'email' ? 'Message from your store' : undefined,
        };
        const result = await provider.send(outgoingMessage);
        if (result.success) {
            // Update message log with success
            await prisma.messageLog.update({
                where: { id: messageLog.id },
                data: {
                    deliveryStatus: 'sent',
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
            // Audit log
            await createAuditLog({
                action: AuditActions.message.sent,
                resourceType: 'message',
                resourceId: messageLog.id,
                metadata: {
                    workflowId,
                    customerId,
                    channel,
                    providerMessageId: result.providerMessageId,
                },
                context: { tenantId },
            });
            return {
                success: true,
                messageLogId: messageLog.id,
                providerMessageId: result.providerMessageId || null,
                error: null,
            };
        }
        else {
            // Update message log with failure
            await prisma.messageLog.update({
                where: { id: messageLog.id },
                data: {
                    deliveryStatus: result.retryable ? 'pending' : 'failed',
                    providerName: provider.name,
                    errorMessage: result.error,
                    retryCount: result.retryable ? 1 : 0,
                    nextRetryAt: result.retryable ? new Date(Date.now() + 60000) : null, // Retry in 1 min
                },
            });
            // Audit log
            await createAuditLog({
                action: AuditActions.message.failed,
                resourceType: 'message',
                resourceId: messageLog.id,
                metadata: {
                    workflowId,
                    customerId,
                    channel,
                    error: result.error,
                    retryable: result.retryable,
                },
                context: { tenantId },
            });
            return {
                success: false,
                messageLogId: messageLog.id,
                providerMessageId: null,
                error: result.error || 'Unknown error',
            };
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
            },
        });
        return {
            success: false,
            messageLogId: messageLog.id,
            providerMessageId: null,
            error: errorMessage,
        };
    }
}
/**
 * Activity: Record workflow execution statistics.
 */
export async function recordExecutionStats(input) {
    await prisma.workflowExecution.update({
        where: { id: input.executionId },
        data: {
            status: input.status,
            completedAt: new Date(),
            customersMatched: input.customersMatched,
            messagesSent: input.messagesSent,
            messagesSkipped: input.messagesSkipped,
            messagesFailed: input.messagesFailed,
            errorMessage: input.errorMessage,
        },
    });
}
/**
 * Activity: Create workflow execution record.
 */
export async function createExecutionRecord(input) {
    const execution = await prisma.workflowExecution.create({
        data: {
            workflowId: input.workflowId,
            tenantId: input.tenantId,
            temporalRunId: input.temporalRunId,
            temporalWorkflowId: input.temporalWorkflowId,
            isTest: input.isTest,
            status: 'running',
        },
    });
    return execution.id;
}
/**
 * Simple template rendering with placeholder substitution.
 */
function renderTemplate(template, data) {
    let result = template;
    for (const [key, value] of Object.entries(data)) {
        result = result.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value);
    }
    return result;
}
