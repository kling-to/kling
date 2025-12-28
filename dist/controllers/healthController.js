export const health = async (req, res) => {
    res.json({
        status: 'ok',
        checks: {
            database: 'ok',
            temporal: 'ok',
            vectorDb: 'ok',
            messageProviders: 'ok',
        },
    });
};
export const metrics = async (req, res) => {
    res.type('text/plain').send('# metrics placeholder');
};
