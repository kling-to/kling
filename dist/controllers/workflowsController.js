import { getTemporalClient } from '../utils/temporal/client';
import { QueryExecutionWorkflow } from '../utils/temporal/workdlows';
import { z } from 'zod';
import prisma from '../utils/prisma';
const createWorkflowSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    cron: z.string(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    query: z.union([z.string(), z.object({})]), // raw SQL or JSON filter
    messageTemplate: z.string(),
    channel: z.enum(['email', 'sms', 'push']),
    conditions: z.record(z.string(), z.unknown()).optional(),
    retrieval: z.record(z.string(), z.unknown()).optional(),
});
export const createWorkflow = async (req, res) => {
    try {
        //
        // 1. Validate Body
        //
        const body = createWorkflowSchema.parse(req.body);
        //
        // 2. Get auth + tenant info (added by middlewares)
        //
        const tenantId = req.tenantId;
        const userId = req.user.sub;
        //
        // 3. Create database record
        //
        const workflow = await prisma.workflowDefinition.create({
            data: {
                tenantId,
                createdBy: userId,
                name: body.name,
                description: body.description,
                cron: body.cron,
                startAt: new Date(body.startAt),
                endAt: new Date(body.endAt),
                query: typeof body.query === 'string' ? body.query : JSON.stringify(body.query),
                messageTemplate: body.messageTemplate,
                channel: body.channel,
                conditions: body.conditions ? JSON.parse(JSON.stringify(body.conditions)) : {},
                retrieval: body.retrieval ? JSON.parse(JSON.stringify(body.retrieval)) : null,
                status: 'active',
            },
        });
        //
        // 4. Create Temporal schedule
        //
        const client = await getTemporalClient();
        await client.schedule.create({
            scheduleId: `schedule_${workflow.id}`,
            spec: {
                cronExpressions: [workflow.cron],
                startAt: workflow.startAt,
                endAt: workflow.endAt,
            },
            action: {
                type: 'startWorkflow',
                workflowType: QueryExecutionWorkflow,
                taskQueue: 'default',
                args: [workflow.id], // workflowDefinitionId
            },
        });
        //
        // 5. Return created workflow
        //
        return res.status(201).json({
            message: 'Workflow created and scheduled.',
            workflow,
        });
    }
    catch (err) {
        console.error('Failed to create workflow:', err);
        if (err instanceof z.ZodError) {
            return res.status(400).json({
                error: 'Invalid data',
                issues: err.flatten(),
            });
        }
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({
            error: 'Failed to create workflow',
            details: errorMessage,
        });
    }
};
export const listWorkflows = async (req, res) => {
    try {
        const tenantId = (req.params.tenantId || req.query.tenantId);
        if (!tenantId) {
            return res.status(400).json({ error: 'Tenant ID is required' });
        }
        // Fetch workflows for the tenant
        const workflows = await prisma.workflowDefinition.findMany({
            where: {
                tenantId,
                status: { not: 'archived' }, // Don't show archived workflows
            },
            include: {
                creator: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ items: workflows });
    }
    catch (err) {
        console.error('List workflows error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({
            error: 'Failed to list workflows',
            details: errorMessage,
        });
    }
};
export const getWorkflow = async (req, res) => {
    try {
        const { workflowId } = req.params;
        const workflow = await prisma.workflowDefinition.findUnique({
            where: { id: workflowId },
            include: {
                creator: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                    },
                },
                tenant: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }
        res.json(workflow);
    }
    catch (err) {
        console.error('Get workflow error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({
            error: 'Failed to fetch workflow',
            details: errorMessage,
        });
    }
};
const updateWorkflowSchema = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    cron: z.string().optional(),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
    query: z.union([z.string(), z.object({})]).optional(),
    messageTemplate: z.string().optional(),
    channel: z.enum(['email', 'sms', 'push']).optional(),
    conditions: z.record(z.string(), z.unknown()).optional(),
    retrieval: z.record(z.string(), z.unknown()).optional(),
    status: z.enum(['active', 'paused', 'disabled']).optional(),
});
export const updateWorkflow = async (req, res) => {
    try {
        const { workflowId } = req.params;
        const body = updateWorkflowSchema.parse(req.body);
        // Fetch existing workflow
        const existingWorkflow = await prisma.workflowDefinition.findUnique({
            where: { id: workflowId },
        });
        if (!existingWorkflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }
        // Update workflow in database
        const updatedWorkflow = await prisma.workflowDefinition.update({
            where: { id: workflowId },
            data: {
                ...(body.name && { name: body.name }),
                ...(body.description && { description: body.description }),
                ...(body.cron && { cron: body.cron }),
                ...(body.startAt && { startAt: new Date(body.startAt) }),
                ...(body.endAt && { endAt: new Date(body.endAt) }),
                ...(body.query && {
                    query: typeof body.query === 'string' ? body.query : JSON.stringify(body.query),
                }),
                ...(body.messageTemplate && { messageTemplate: body.messageTemplate }),
                ...(body.channel && { channel: body.channel }),
                ...(body.conditions && { conditions: JSON.parse(JSON.stringify(body.conditions)) }),
                ...(body.retrieval !== undefined && {
                    retrieval: body.retrieval ? JSON.parse(JSON.stringify(body.retrieval)) : null,
                }),
                ...(body.status && { status: body.status }),
            },
        });
        // Note: Temporal schedule updates for timing changes (cron, startAt, endAt)
        // require deleting and recreating the schedule. For now, we only update the DB.
        // To update the schedule, delete and recreate the workflow.
        if (body.cron || body.startAt || body.endAt) {
            console.warn('Schedule timing updated in DB. Note: Temporal schedule not updated. Delete and recreate workflow to sync.');
        }
        res.json(updatedWorkflow);
    }
    catch (err) {
        console.error('Update workflow error:', err);
        if (err instanceof z.ZodError) {
            return res.status(400).json({
                error: 'Invalid data',
                issues: err.flatten(),
            });
        }
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({
            error: 'Failed to update workflow',
            details: errorMessage,
        });
    }
};
export const deleteWorkflow = async (req, res) => {
    try {
        const { workflowId } = req.params;
        // Soft delete by setting status to archived
        await prisma.workflowDefinition.update({
            where: { id: workflowId },
            data: { status: 'archived' },
        });
        // Pause or delete the Temporal schedule
        try {
            const client = await getTemporalClient();
            const scheduleHandle = client.schedule.getHandle(`schedule_${workflowId}`);
            await scheduleHandle.delete();
        }
        catch (temporalErr) {
            console.error('Failed to delete Temporal schedule:', temporalErr);
            // Don't fail the request if Temporal deletion fails
        }
        res.status(204).send();
    }
    catch (err) {
        console.error('Delete workflow error:', err);
        if (err && typeof err === 'object' && 'code' in err && err.code === 'P2025') {
            return res.status(404).json({ error: 'Workflow not found' });
        }
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({
            error: 'Failed to delete workflow',
            details: errorMessage,
        });
    }
};
export const previewWorkflow = async (req, res) => {
    try {
        const { workflowId } = req.params;
        // Fetch workflow
        const workflow = await prisma.workflowDefinition.findUnique({
            where: { id: workflowId },
        });
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }
        // Execute query to get preview of customers
        // This is a simplified version - in production you'd parse the query DSL
        let customers = [];
        try {
            // If query is a JSON object, use it as a Prisma filter
            const queryFilter = typeof workflow.query === 'string' ? JSON.parse(workflow.query) : workflow.query;
            const rawCustomers = await prisma.customer.findMany({
                where: {
                    tenantId: workflow.tenantId,
                    optOut: false,
                    ...queryFilter,
                },
                select: {
                    id: true,
                    email: true,
                    phone: true,
                    name: true,
                },
                take: 10, // Preview first 10 customers
            });
            customers = rawCustomers;
        }
        catch (parseErr) {
            // If parsing fails, return empty preview
            console.error('Query parsing error:', parseErr);
            customers = [];
        }
        res.json({
            workflow: {
                id: workflow.id,
                name: workflow.name,
                query: workflow.query,
            },
            preview: {
                count: customers.length,
                customers,
            },
        });
    }
    catch (err) {
        console.error('Preview workflow error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({
            error: 'Failed to preview workflow',
            details: errorMessage,
        });
    }
};
export const testWorkflow = async (req, res) => {
    try {
        const { workflowId } = req.params;
        // Fetch workflow
        const workflow = await prisma.workflowDefinition.findUnique({
            where: { id: workflowId },
        });
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }
        // Start a single immediate workflow execution
        const client = await getTemporalClient();
        const workflowHandle = await client.workflow.start(QueryExecutionWorkflow, {
            taskQueue: 'default',
            workflowId: `test-${workflowId}-${Date.now()}`,
            args: [workflowId],
        });
        res.json({
            id: workflowHandle.workflowId,
            workflowId: workflow.id,
            status: 'running',
            runId: workflowHandle.firstExecutionRunId,
        });
    }
    catch (err) {
        console.error('Test workflow error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({
            error: 'Failed to start test workflow',
            details: errorMessage,
        });
    }
};
