import express from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as tenantsCtrl from '../controllers/tenantsController';
import { authenticate } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';
const router = express.Router();
router.post('/', authenticate, requireRole('system_admin'), asyncHandler(tenantsCtrl.createTenant));
router.get('/:tenantId', authenticate, requireRole('system_admin', 'tenant_admin'), asyncHandler(tenantsCtrl.getTenant));
export default router;
