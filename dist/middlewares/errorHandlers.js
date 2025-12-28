export function notFoundHandler(req, res) {
    res.status(404).json({ code: 'not_found', message: 'Not Found' });
}
export function errorHandler(err, req, res) {
    console.error(err);
    const status = err && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
        ? err.status
        : 500;
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    const details = err && typeof err === 'object' && 'details' in err ? err.details : undefined;
    res.status(status).json({ code: 'error', message, details });
}
