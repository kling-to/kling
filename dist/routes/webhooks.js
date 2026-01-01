import express from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as whCtrl from '../controllers/webhooksController';
const router = express.Router();
router.post('/delivery', asyncHandler(whCtrl.deliveryWebhook));
export default router;
