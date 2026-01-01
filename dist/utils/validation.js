import { z } from 'zod';
const OBJECT_ID_REGEX = /^[a-f\d]{24}$/i;
export function isValidObjectId(id) {
    return OBJECT_ID_REGEX.test(id);
}
export const objectIdSchema = z.string().refine(isValidObjectId, { message: 'Invalid ID format' });
export function createObjectIdSchema(entityName) {
    return z.string().refine(isValidObjectId, { message: `Invalid ${entityName} ID format` });
}
