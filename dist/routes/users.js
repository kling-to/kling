import express from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as usersCtrl from '../controllers/usersController';
import { authenticate } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';
const router = express.Router();
router.get('/', authenticate, requireRole('system_admin'), asyncHandler(usersCtrl.listUsers));
router.get('/:userId', authenticate, asyncHandler(usersCtrl.getUser));
export default router;
