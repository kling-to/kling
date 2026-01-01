/**
 * Temporal Workflow Definitions
 *
 * These workflows orchestrate the execution of scheduled marketing campaigns.
 * They run in the Temporal worker process and coordinate activities.
 *
 * NOTE: In a production setup, workflows run in a separate worker process.
 * Activities are the only way workflows can interact with external systems.
 */
/**
 * QueryExecutionWorkflow
 *
 * This is the main scheduled workflow that:
 * 1. Loads the workflow definition
 * 2. Executes the query to find matching customers
 * 3. Spawns child workflows for each customer
 * 4. Records execution statistics
 *
 * In production, this would use Temporal's workflow APIs:
 * - proxyActivities() to call activities
 * - executeChild() to spawn child workflows
 * - continueAsNew() for large result sets
 */
export async function QueryExecutionWorkflow(input) {
    const { workflowDefinitionId, isTest = false } = input;
    // In a real Temporal workflow, we would:
    // const activities = proxyActivities<typeof import('./activities')>({
    //   startToCloseTimeout: '1 minute',
    // });
    // For now, we import activities directly (this works for testing)
    const activities = await import('./activities');
    // 1. Load workflow definition
    const workflow = await activities.loadWorkflowDefinition({
        workflowDefinitionId,
    });
    if (!workflow) {
        return {
            success: false,
            executionId: null,
            customersMatched: 0,
            messagesSent: 0,
            messagesSkipped: 0,
            messagesFailed: 0,
            error: 'Workflow definition not found',
        };
    }
    // 2. Create execution record
    const executionId = await activities.createExecutionRecord({
        workflowId: workflow.id,
        tenantId: workflow.tenantId,
        temporalRunId: `run_${Date.now()}`, // In real Temporal: workflow.workflowInfo().runId
        temporalWorkflowId: `wf_${workflow.id}`,
        isTest,
    });
    let customersMatched = 0;
    let messagesSent = 0;
    let messagesSkipped = 0;
    let messagesFailed = 0;
    try {
        // 3. Execute query with pagination
        let page = 1;
        const pageSize = 100;
        let hasMore = true;
        while (hasMore) {
            const queryResult = await activities.executeWorkflowQuery({
                tenantId: workflow.tenantId,
                query: workflow.query,
                page,
                pageSize,
            });
            customersMatched = queryResult.total;
            // 4. Process each customer
            for (const customerId of queryResult.customerIds) {
                // Check eligibility
                const eligibility = await activities.checkCustomerEligibility({
                    customerId,
                    workflowId: workflow.id,
                    tenantId: workflow.tenantId,
                    channel: workflow.channel,
                    tenant: workflow.tenant,
                });
                if (!eligibility.eligible || !eligibility.customer) {
                    messagesSkipped++;
                    continue;
                }
                // Send message
                const sendResult = await activities.sendMessage({
                    workflowId: workflow.id,
                    tenantId: workflow.tenantId,
                    customerId,
                    channel: workflow.channel,
                    messageTemplate: workflow.messageTemplate,
                    customer: {
                        email: eligibility.customer.email,
                        phone: eligibility.customer.phone,
                        name: null, // Would need to fetch full customer data
                    },
                    temporalRunId: `run_${Date.now()}`,
                    isTest,
                });
                if (sendResult.success) {
                    messagesSent++;
                }
                else {
                    messagesFailed++;
                }
            }
            hasMore = queryResult.hasMore;
            page++;
            // Safety limit for test runs
            if (isTest && messagesSent >= 1) {
                break;
            }
        }
        // 5. Record execution stats
        await activities.recordExecutionStats({
            executionId,
            customersMatched,
            messagesSent,
            messagesSkipped,
            messagesFailed,
            status: 'completed',
        });
        return {
            success: true,
            executionId,
            customersMatched,
            messagesSent,
            messagesSkipped,
            messagesFailed,
        };
    }
    catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        // Record failure
        await activities.recordExecutionStats({
            executionId,
            customersMatched,
            messagesSent,
            messagesSkipped,
            messagesFailed,
            status: 'failed',
            errorMessage,
        });
        return {
            success: false,
            executionId,
            customersMatched,
            messagesSent,
            messagesSkipped,
            messagesFailed,
            error: errorMessage,
        };
    }
}
/**
 * CustomerNotificationWorkflow
 *
 * Child workflow that handles sending a notification to a single customer.
 * This includes:
 * 1. Re-checking eligibility (customer state may have changed)
 * 2. Rendering the message template
 * 3. Sending via the appropriate provider
 * 4. Recording the result
 */
export async function CustomerNotificationWorkflow(input) {
    const activities = await import('./activities');
    // 1. Check eligibility
    const eligibility = await activities.checkCustomerEligibility({
        customerId: input.customerId,
        workflowId: input.workflowId,
        tenantId: input.tenantId,
        channel: input.channel,
        tenant: input.tenant,
    });
    if (!eligibility.eligible || !eligibility.customer) {
        return {
            success: false,
            messageLogId: null,
            skipped: true,
            skipReasons: eligibility.reasons,
        };
    }
    // 2. Send message
    const sendResult = await activities.sendMessage({
        workflowId: input.workflowId,
        tenantId: input.tenantId,
        customerId: input.customerId,
        channel: input.channel,
        messageTemplate: input.messageTemplate,
        customer: {
            email: eligibility.customer.email,
            phone: eligibility.customer.phone,
            name: null,
        },
        temporalRunId: input.temporalRunId,
        isTest: input.isTest,
    });
    if (sendResult.success) {
        return {
            success: true,
            messageLogId: sendResult.messageLogId,
            skipped: false,
            skipReasons: [],
        };
    }
    else {
        return {
            success: false,
            messageLogId: sendResult.messageLogId,
            skipped: false,
            skipReasons: [],
            error: sendResult.error || 'Send failed',
        };
    }
}
// Export for backward compatibility with existing code
export { QueryExecutionWorkflow as default };
