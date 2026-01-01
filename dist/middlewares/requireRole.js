export const requireRole = (...allowed) => (req, res, next) => {
    const user = req.user;
    if (!user)
        return res.status(401).json({ message: 'Unauthenticated' });
    const userRole = user.role;
    if (allowed.includes(userRole) || user.role === 'system_admin')
        return next();
    return res.status(403).json({ message: 'Forbidden: insufficient role' });
};
