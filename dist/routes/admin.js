import express from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as adminCtrl from '../controllers/adminController';
import { authenticate } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';
const router = express.Router();
router.get('/system/health', authenticate, requireRole('system_admin'), asyncHandler(adminCtrl.systemHealth));
router.get('/audit', authenticate, requireRole('system_admin'), asyncHandler(adminCtrl.auditList));
export default router;
