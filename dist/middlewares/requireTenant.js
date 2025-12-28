/**
 * Enforces that the request pertains to the tenant the user belongs to unless the user is system_admin.
 *
 * - Looks for tenantId in req.params.tenantId.
 * - Falls back to X-Tenant-Id header or query param.
 */
export const requireTenant = (paramName = 'tenantId') => (req, res, next) => {
    const user = req.user;
    if (!user)
        return res.status(401).json({ message: 'Unauthenticated' });
    // System admins bypass tenant check
    if (user.role === 'system_admin')
        return next();
    const tenantParam = (req.params && req.params[paramName]) || req.header('X-Tenant-Id') || req.query.tenantId;
    if (!tenantParam) {
        return res.status(400).json({ message: 'Missing tenant identifier' });
    }
    if (String(tenantParam) !== String(user.tenantId)) {
        return res.status(403).json({ message: 'Forbidden: tenant mismatch' });
    }
    return next();
};
