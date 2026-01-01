import express from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as vecCtrl from '../controllers/vectorsController';
import { authenticate } from '../middlewares/auth';
const router = express.Router();
router.get('/indexes', authenticate, asyncHandler(vecCtrl.listIndexes));
router.post('/search', authenticate, asyncHandler(vecCtrl.vectorSearch));
export default router;
