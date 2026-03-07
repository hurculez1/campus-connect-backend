const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

const verifyToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    
    const [users] = await pool.query(
      'SELECT id, email, first_name, last_name, subscription_tier, is_banned, is_admin, is_super_admin FROM users WHERE id = ?',
      [decoded.userId]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: 'User not found' });
    }

    if (users[0].is_banned) {
      return res.status(403).json({ message: 'Account has been banned' });
    }

    const user = users[0];
    if (user.is_admin || user.is_super_admin) {
      user.subscription_tier = 'vip';
    }
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    return res.status(500).json({ message: 'Authentication error' });
  }
};

const socketAuth = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error('Authentication required'));
    }

    const decoded = verifyToken(token);
    const [users] = await pool.query(
      'SELECT id, email, first_name, is_banned FROM users WHERE id = ?',
      [decoded.userId]
    );

    if (users.length === 0 || users[0].is_banned) {
      return next(new Error('Authentication failed'));
    }

    socket.userId = users.insertId;
    socket.user = users[0];
    next();
  } catch (error) {
    next(new Error('Authentication failed'));
  }
};

const requireSubscription = (tier) => {
  return (req, res, next) => {
    const userTier = req.user.subscription_tier;
    const tiers = ['free', 'premium', 'vip'];
    
    if (tiers.indexOf(userTier) < tiers.indexOf(tier)) {
      return res.status(403).json({ 
        message: 'Subscription required',
        requiredTier: tier,
        currentTier: userTier
      });
    }
    next();
  };
};

const requireAdmin = (req, res, next) => {
  if (!req.user?.is_admin && !req.user?.is_super_admin) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

const requireSuperAdmin = (req, res, next) => {
  if (!req.user?.is_super_admin) {
    return res.status(403).json({ message: 'Super admin access required' });
  }
  next();
};

module.exports = {
  generateToken,
  verifyToken,
  authenticate,
  socketAuth,
  requireSubscription,
  requireAdmin,
  requireSuperAdmin
};