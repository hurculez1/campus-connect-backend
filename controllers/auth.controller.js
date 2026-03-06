const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const { pool } = require('../config/database');
const { generateToken } = require('../middleware/auth.middleware');
const { sendVerificationEmail } = require('../services/email.service');
const logger = require('../utils/logger');

const SALT_ROUNDS = 12;

exports.register = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      email,
      password,
      firstName,
      lastName,
      dateOfBirth,
      gender,
      university,
      studentEmail
    } = req.body;

    // Check if email exists
    const { rows: existing } = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert user
    const { rows: newUser } = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, date_of_birth, gender, university, student_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [email, passwordHash, firstName, lastName, dateOfBirth, gender, university, studentEmail || null]
    );

    const userId = newUser[0].id;

    // Create user settings
    await pool.query(
      'INSERT INTO user_settings (user_id) VALUES ($1)',
      [userId]
    );

    // Generate verification token if student email provided
    if (studentEmail) {
      const verificationToken = require('crypto').randomBytes(32).toString('hex');
      await pool.query(
        `INSERT INTO university_verifications (user_id, university_name, student_email, student_email_token)
         VALUES ($1, $2, $3, $4)`,
        [userId, university, studentEmail, verificationToken]
      );
      await sendVerificationEmail(studentEmail, verificationToken, firstName);
    }

    // Generate JWT
    const token = generateToken(userId);

    logger.info(`New user registered: ${email}`);

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        id: userId,
        email,
        firstName,
        lastName,
        university,
        verificationStatus: studentEmail ? 'pending' : 'not_started'
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const { rows: users } = await pool.query(
      `SELECT id, email, password_hash, first_name, last_name, subscription_tier, 
              verification_status, is_banned, ban_reason
       FROM users WHERE email = $1 AND is_active = TRUE`,
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = users[0];

    if (user.is_banned) {
      return res.status(403).json({ 
        message: 'Account banned',
        reason: user.ban_reason
      });
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Update last active
    await pool.query(
      'UPDATE users SET last_active = NOW() WHERE id = $1',
      [user.id]
    );

    const token = generateToken(user.id);

    logger.info(`User logged in: ${email}`);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        subscriptionTier: user.subscription_tier,
        verificationStatus: user.verification_status
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.googleAuth = async (req, res, next) => {
  try {
    const { googleToken, university, dateOfBirth, gender } = req.body;

    // Use access_token to securely fetch profile from Google without needing an ID token
    const fetch = require('node-fetch');
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${googleToken}` }
    });
    
    if (!response.ok) {
      return res.status(401).json({ message: 'Invalid Google access token' });
    }

    const payload = await response.json();
    const { sub: uid, email, name, picture } = payload;

    // Check if user exists
    const { rows: existing } = await pool.query(
      'SELECT * FROM users WHERE firebase_uid = $1 OR email = $2',
      [uid, email]
    );

    let userId;

    if (existing.length === 0) {
      if (!university || !dateOfBirth || !gender) {
        // Stop here and ask frontend for remaining data
        return res.json({
          isNewUser: true,
          requireMoreData: true,
          pendingData: { uid, email, name: name?.split(' ')[0] || 'User', picture }
        });
      }

      // Create new user with completion data
      const { rows: newUser } = await pool.query(
        `INSERT INTO users (email, firebase_uid, first_name, profile_photo_url, date_of_birth, gender, university, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE) RETURNING id`,
        [email, uid, name?.split(' ')[0] || 'User', picture, dateOfBirth, gender, university]
      );
      userId = newUser[0].id;
      await pool.query('INSERT INTO user_settings (user_id) VALUES ($1)', [userId]);
    } else {
      userId = existing[0].id;
      if (existing[0].is_banned) {
        return res.status(403).json({ message: 'Account banned' });
      }
    }

    const token = generateToken(userId);

    res.json({
      token,
      isNewUser: existing.length === 0,
      user: {
        id: userId,
        email,
        firstName: name?.split(' ')[0] || 'User',
        profilePhoto: picture,
        university: existing.length > 0 ? existing[0].university : university,
        verificationStatus: existing.length > 0 ? existing[0].verification_status : 'not_started'
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.params;

    const { rows: verifications } = await pool.query(
      `SELECT uv.*, u.id as user_id 
       FROM university_verifications uv
       JOIN users u ON uv.user_id = u.id
       WHERE uv.student_email_token = $1 AND uv.status = 'pending'`,
      [token]
    );

    if (verifications.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    const verification = verifications[0];

    // Update verification status
    await pool.query(
      `UPDATE university_verifications 
       SET student_email_verified = TRUE, status = 'verified', updated_at = NOW()
       WHERE id = $1`,
      [verification.id]
    );

    // Update user verification status
    await pool.query(
      `UPDATE users SET verification_status = 'verified', student_id_verified = TRUE WHERE id = $1`,
      [verification.user_id]
    );

    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    next(error);
  }
};