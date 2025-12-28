import jwt from 'jsonwebtoken';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.warn('WARNING: JWT_SECRET not set. Auth will fail until configured.');
}
export async function authenticate(req, res, next) {
    try {
        const auth = req.headers.authorization;
        if (!auth || !auth.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Missing authorization header' });
        }
        const token = auth.slice('Bearer '.length).trim();
        const payload = jwt.verify(token, JWT_SECRET, {
            algorithms: ['RS256'],
        });
        // minimal validation
        if (!payload || !payload.sub || !payload.role) {
            return res.status(401).json({ message: 'Invalid token payload' });
        }
        req.user = {
            sub: payload.sub,
            role: payload.role,
            tenantId: payload.tenantId ?? null,
            scopes: payload.scopes ?? [],
        };
        return next();
    }
    catch (err) {
        console.error('auth error', err);
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
}
