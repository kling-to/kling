export const systemHealth = async (req, res) => {
    // provide deeper diagnostics for admins
    res.json({
        db: 'ok',
        temporal: { status: 'ok' },
        vectorDb: 'ok',
        messageProviders: 'ok',
    });
};
export const auditList = async (req, res) => {
    res.json({ items: [] });
};
