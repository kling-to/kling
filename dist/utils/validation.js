/**
 * Validation utilities for common input types
 */
import { z } from 'zod';
/**
 * MongoDB ObjectId regex pattern
 * ObjectIds are 24 character hex strings
 */
const OBJECT_ID_REGEX = /^[a-f\d]{24}$/i;
/**
 * Validates if a string is a valid MongoDB ObjectId format
 */
export function isValidObjectId(id) {
    return OBJECT_ID_REGEX.test(id);
}
/**
 * Zod schema for MongoDB ObjectId validation
 * Use this in endpoint input schemas to validate ID parameters
 */
export const objectIdSchema = z.string().refine(isValidObjectId, { message: 'Invalid ID format' });
/**
 * Creates a Zod schema for a specific entity ID with custom error message
 */
export function createObjectIdSchema(entityName) {
    return z.string().refine(isValidObjectId, { message: `Invalid ${entityName} ID format` });
}
