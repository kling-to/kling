import prisma from './prisma';
/**
 * Create an immutable audit log entry.
 * Audit logs are append-only and should never be modified or deleted.
 */
export async function createAuditLog(options) {
    const { action, resourceType, resourceId, metadata, context } = options;
    await prisma.auditLog.create({
        data: {
            action,
            resourceType,
            resourceId,
            metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
            userId: context.userId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            requestId: context.requestId,
        },
    });
}
/**
 * Helper to extract audit context from an express-zod-api request.
 */
export function extractAuditContext(request, user) {
    const getHeader = (name) => {
        const value = request.headers[name.toLowerCase()];
        return Array.isArray(value) ? value[0] : value;
    };
    return {
        userId: user?.sub,
        ipAddress: getHeader('x-forwarded-for') ?? request.ip,
        userAgent: getHeader('user-agent'),
        requestId: getHeader('x-request-id'),
    };
}
/**
 * Audit log actions grouped by category for reference.
 */
export const AuditActions = {
    auth: {
        register: 'user_registered',
        login: 'user_login',
        logout: 'user_logout',
    },
    settings: {
        updated: 'settings_updated',
    },
    member: {
        invited: 'member_invited',
        joined: 'member_joined',
        removed: 'member_removed',
        roleChanged: 'member_role_changed',
    },
    campaign: {
        created: 'campaign_created',
        updated: 'campaign_updated',
        paused: 'campaign_paused',
        resumed: 'campaign_resumed',
        archived: 'campaign_archived',
        deleted: 'campaign_deleted',
    },
    message: {
        sent: 'message_sent',
        failed: 'message_failed',
        retried: 'message_retried',
    },
    customer: {
        created: 'customer_created',
        updated: 'customer_updated',
        optedOut: 'customer_opted_out',
        deleted: 'customer_deleted',
    },
    consent: {
        granted: 'consent_granted',
        revoked: 'consent_revoked',
    },
    data: {
        exportRequested: 'data_export_requested',
        deletionRequested: 'data_deletion_requested',
    },
    order: {
        created: 'order_created',
        statusChanged: 'order_status_changed',
        deleted: 'order_deleted',
    },
    integration: {
        connected: 'integration_connected',
        disconnected: 'integration_disconnected',
        syncStarted: 'integration_sync_started',
        syncCompleted: 'integration_sync_completed',
        syncFailed: 'integration_sync_failed',
    },
    form: {
        created: 'form_created',
        updated: 'form_updated',
        paused: 'form_paused',
        activated: 'form_activated',
        archived: 'form_archived',
        deleted: 'form_deleted',
        submissionReceived: 'form_submission_received',
    },
    experiment: {
        created: 'experiment_created',
        started: 'experiment_started',
        stopped: 'experiment_stopped',
        deleted: 'experiment_deleted',
    },
    suppression: {
        import: 'suppression_import',
    },
};
