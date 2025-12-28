import express from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as msgCtrl from '../controllers/messagesController';
import { authenticate } from '../middlewares/auth';
const router = express.Router();
router.get('/logs', authenticate, asyncHandler(msgCtrl.listMessageLogs));
router.get('/:messageId', authenticate, asyncHandler(msgCtrl.getMessageLog));
router.post('/:messageId/retry', authenticate, asyncHandler(msgCtrl.retryMessage));
export default router;
