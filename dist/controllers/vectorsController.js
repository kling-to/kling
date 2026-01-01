export const listIndexes = async (req, res) => {
    res.json([]);
};
export const vectorSearch = async (req, res) => {
    // tenantId, seed, topK would be used for vector search in full implementation
    // call qdrant/pinecone etc.
    res.json({ items: [] });
};
