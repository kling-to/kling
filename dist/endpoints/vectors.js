import { z } from 'zod';
import { authFactory } from '../factories';
// List indexes endpoint
export const listIndexesEndpoint = authFactory.build({
    method: 'get',
    shortDescription: 'List Indexes',
    description: 'Returns a list of vector indexes.',
    tag: 'Vectors',
    input: z.object({}),
    output: z.object({
        items: z.array(z.unknown()),
    }),
    handler: async () => {
        return { items: [] };
    },
});
// Vector search endpoint
export const vectorSearchEndpoint = authFactory.build({
    method: 'post',
    shortDescription: 'Vector Search',
    description: 'Performs a vector search and returns matching items.',
    tag: 'Vectors',
    input: z.object({}),
    output: z.object({
        items: z.array(z.unknown()),
    }),
    handler: async () => {
        return { items: [] };
    },
});
