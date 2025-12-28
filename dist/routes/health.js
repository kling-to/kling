import express from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as healthCtrl from '../controllers/healthController';
const router = express.Router();
router.get('/', asyncHandler(healthCtrl.health));
router.get('/metrics', asyncHandler(healthCtrl.metrics));
export default router;
