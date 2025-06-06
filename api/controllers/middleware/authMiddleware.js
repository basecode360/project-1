// middleware/authMiddleware.js
import jwt from 'jsonwebtoken';
import User from '../../models/Users.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('Missing JWT_SECRET environment variable');
}

/**
 * Protect routes by requiring a valid JWT in "Authorization: Bearer <token>".
 * Attaches `req.user = { id, email }` if valid.
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.id, email: payload.email };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

/**
 * Optionally use on callback when we pass state = JWT. We verify stateJwt here.
 */
export function verifyStateJwt(stateJwt) {
  return jwt.verify(stateJwt, JWT_SECRET);
}

/**
 * Given a user ID, generate a new JWT to return to frontend.
 */
export function generateJwtForUser(user) {
  // Payload can include any minimal info; include “id” and “email”.
  const payload = { id: user._id, email: user.email };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });
}
