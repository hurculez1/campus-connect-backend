const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('firstName').trim().isLength({ min: 2 }),
  body('lastName').trim().isLength({ min: 2 }),
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
router.get('/me', authenticate, (req, res) => {
  const u = req.user;
  res.json({
    user: {
      id: u.id,
      email: u.email,
      firstName: u.first_name,
      lastName: u.last_name,
      subscriptionTier: u.subscription_tier,
      isAdmin: u.is_admin || false,
      isSuperAdmin: u.is_super_admin || false,
    }
  });
});

module.exports = router;