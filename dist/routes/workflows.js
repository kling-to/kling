import express from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as wfCtrl from '../controllers/workflowsController';
import { authenticate } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';
import { requireTenant } from '../middlewares/requireTenant';
const router = express.Router();
// Note: I used /:tenantId/workflows for tenant-scoped creation/listing and /workflow/:workflowId for single workflow operations where tenant enforcement is done at controller level (or you can change to /tenants/:tenantId/workflows/:workflowId for stricter path-level enforcement).
// tenant-scoped workflows
router.post('/:tenantId/workflows', authenticate, requireTenant('tenantId'), requireRole('tenant_admin', 'tenant_user'), asyncHandler(wfCtrl.createWorkflow));
router.get('/:tenantId/workflows', authenticate, requireTenant('tenantId'), requireRole('tenant_admin', 'tenant_user'), asyncHandler(wfCtrl.listWorkflows));
router.get('/workflow/:workflowId', authenticate, requireRole('tenant_admin', 'tenant_user'), asyncHandler(wfCtrl.getWorkflow));
router.patch('/workflow/:workflowId', authenticate, requireRole('tenant_admin', 'tenant_user'), asyncHandler(wfCtrl.updateWorkflow));
router.delete('/workflow/:workflowId', authenticate, requireRole('tenant_admin'), asyncHandler(wfCtrl.deleteWorkflow));
router.post('/workflow/:workflowId/preview', authenticate, requireRole('tenant_admin', 'tenant_user'), asyncHandler(wfCtrl.previewWorkflow));
router.post('/workflow/:workflowId/test', authenticate, requireRole('tenant_admin', 'tenant_user'), asyncHandler(wfCtrl.testWorkflow));
export default router;
