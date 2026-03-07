const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('firstName').trim().isLength({ min: 2 }),
  body('lastName').optional({ checkFalsy: true }).trim(),
  body('dateOfBirth').isDate(),
  body('gender').isIn(['male', 'female', 'non_binary', 'other']),
  body('university').notEmpty()
], authController.register);

router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], authController.login);

router.post('/google', authController.googleAuth);
router.get('/verify-email/:token', authController.verifyEmail);

// Returns fresh user object including admin flags — called on app load
router.get('/me', authenticate, async (req, res) => {
  const u = req.user;
  // Fetch the latest profile photo from DB since middleware doesn't load it
  try {
    const { pool } = require('../config/database');
    const [rows] = await pool.query('SELECT profile_photo_url FROM users WHERE id = ?', [u.id]);
    const photoUrl = rows[0]?.profile_photo_url || null;
    res.json({
      user: {
        id: u.id,
        email: u.email,
        firstName: u.first_name,
        lastName: u.last_name,
        subscriptionTier: (u.is_admin || u.is_super_admin) ? 'vip' : (u.subscription_tier || 'free'),
        isAdmin: u.is_admin || false,
        isSuperAdmin: u.is_super_admin || false,
        profile_photo_url: photoUrl,
        profilePhotoUrl: photoUrl,
      }
    });
  } catch {
    res.json({
      user: {
        id: u.id,
        email: u.email,
        firstName: u.first_name,
        lastName: u.last_name,
        subscriptionTier: (u.is_admin || u.is_super_admin) ? 'vip' : (u.subscription_tier || 'free'),
        isAdmin: u.is_admin || false,
        isSuperAdmin: u.is_super_admin || false,
      }
    });
  }
});

module.exports = router;