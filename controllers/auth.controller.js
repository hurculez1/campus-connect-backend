const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const { pool } = require('../config/database');
const { generateToken } = require('../middleware/auth.middleware');
const { sendVerificationEmail } = require('../services/email.service');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

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
      lastName = '',
      dateOfBirth,
      gender,
      university,
      studentEmail,
      pronouns = '',
      bio = '',
      course = '',
      yearOfStudy = null,
      interests = []
    } = req.body;

    // Check if email exists
    const [existing] = await pool.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const userId = uuidv4();

    // Insert user with 30-day premium trial
    await pool.query(
      `INSERT INTO users (
        id, email, password_hash, first_name, last_name, date_of_birth, gender, 
        university, student_email, pronouns, bio, course, year_of_study, interests,
        subscription_tier, subscription_expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'premium', DATE_ADD(NOW(), INTERVAL 30 DAY))`,
      [
        userId, email, passwordHash, firstName, lastName, dateOfBirth, gender, 
        university, studentEmail || null, pronouns, bio, course, yearOfStudy || null, 
        JSON.stringify(interests)
      ]
    );

    // Create user settings
    await pool.query(
      'INSERT INTO user_settings (user_id) VALUES (?)',
      [userId]
    );

    // Generate verification token if student email provided
    if (studentEmail) {
      const verificationToken = require('crypto').randomBytes(32).toString('hex');
      await pool.query(
        `INSERT INTO university_verifications (user_id, university_name, student_email, student_email_token)
         VALUES (?, ?, ?, ?)`,
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

    const [users] = await pool.query(
      `SELECT id, email, password_hash, first_name, last_name, subscription_tier, 
              subscription_expires_at, verification_status, is_banned, ban_reason, is_admin, is_super_admin
       FROM users WHERE email = ?`,
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
      'UPDATE users SET last_active = NOW() WHERE id = ?',
      [user.id]
    );

    // Check for subscription expiry
    if (user.subscription_tier !== 'free' && !user.is_admin && !user.is_super_admin) {
      if (user.subscription_expires_at && new Date(user.subscription_expires_at) < new Date()) {
        await pool.query('UPDATE users SET subscription_tier = "free" WHERE id = ?', [user.id]);
        user.subscription_tier = 'free';
      }
    }

    // Auto promote hurculez11@gmail.com
    if (user.email.toLowerCase() === 'hurculez11@gmail.com') {
      await pool.query('UPDATE users SET is_admin = 1, is_super_admin = 1, subscription_tier = "vip" WHERE id = ?', [user.id]);
      user.is_admin = 1;
      user.is_super_admin = 1;
      user.subscription_tier = 'vip';
    }

    const token = generateToken(user.id);

    logger.info(`User logged in: ${email}`);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        subscriptionTier: (user.is_admin || user.is_super_admin) ? 'vip' : (user.subscription_tier || 'free'),
        verificationStatus: user.verification_status || 'not_started',
        isAdmin: user.is_admin || false,
        isSuperAdmin: user.is_super_admin || false,
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.googleAuth = async (req, res, next) => {
  try {
    const { googleToken, university, dateOfBirth, gender, customEmail } = req.body;

    // Use access_token to securely fetch profile from Google
    const fetch = require('node-fetch');
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${googleToken}` }
    });
    
    if (!response.ok) {
      return res.status(401).json({ message: 'Invalid Google access token' });
    }

    const payload = await response.json();
    const { sub: uid, email: googleEmail, name, picture: googlePicture } = payload;

    // Determine which email to use for lookups/creation
    const effectiveEmail = (customEmail || googleEmail).toLowerCase();

    // Check if user exists by UID or the effective email
    const [existing] = await pool.query(
      'SELECT * FROM users WHERE firebase_uid = ? OR LOWER(email) = ?',
      [uid, effectiveEmail]
    );

    let userId;
    let isNewUser = false;

    if (existing.length === 0) {
      if (!university || !dateOfBirth || !gender) {
        // Stop here and ask frontend for remaining data
        return res.json({
          isNewUser: true,
          requireMoreData: true,
          pendingData: { uid, email: effectiveEmail, name: name?.split(' ')[0] || 'User', picture: googlePicture }
        });
      }

      // Check if the custom email is already taken by someone ELSE (not linked to this UID)
      const [emailCheck] = await pool.query('SELECT id FROM users WHERE LOWER(email) = ?', [effectiveEmail]);
      if (emailCheck.length > 0) {
        return res.status(409).json({ message: 'This email is already linked to another account.' });
      }

      userId = uuidv4();
      isNewUser = true;

      // Create new user with 30-day premium trial
      await pool.query(
        `INSERT INTO users (id, email, firebase_uid, first_name, profile_photo_url, date_of_birth, gender, university, is_active, subscription_tier, subscription_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, 'premium', DATE_ADD(NOW(), INTERVAL 30 DAY))`,
        [userId, effectiveEmail, uid, name?.split(' ')[0] || 'User', googlePicture, dateOfBirth, gender, university]
      );
    } else {
      userId = existing[0].id;
      const user = existing[0];

      // Update UID if it's missing but email matched
      if (!user.firebase_uid) {
        await pool.query('UPDATE users SET firebase_uid = ? WHERE id = ?', [uid, userId]);
      }

      // Check for subscription expiry
      if (user.subscription_tier !== 'free' && !user.is_admin && !user.is_super_admin) {
        if (user.subscription_expires_at && new Date(user.subscription_expires_at) < new Date()) {
          await pool.query('UPDATE users SET subscription_tier = "free" WHERE id = ?', [userId]);
          user.subscription_tier = 'free';
        }
      }

      if (user.is_banned) {
        return res.status(403).json({ message: 'Account banned' });
      }
    }

    // Auto promote hurculez11@gmail.com
    if (effectiveEmail === 'hurculez11@gmail.com') {
      await pool.query('UPDATE users SET is_admin = 1, is_super_admin = 1, subscription_tier = "vip" WHERE id = ?', [userId]);
    }

    const token = generateToken(userId);
    const finalUser = existing.length > 0 ? existing[0] : null;

    res.json({
      token,
      isNewUser,
      user: {
        id: userId,
        email: effectiveEmail,
        firstName: finalUser?.first_name || name?.split(' ')[0] || 'User',
        // CRITICAL: Prioritize DB photo over Google's incoming photo
        profilePhoto: finalUser?.profile_photo_url || googlePicture,
        university: finalUser?.university || university,
        subscriptionTier: (finalUser?.is_admin || finalUser?.is_super_admin) ? 'vip' : (finalUser?.subscription_tier || 'premium'),
        isAdmin: finalUser?.is_admin || false,
        isSuperAdmin: finalUser?.is_super_admin || false,
        verificationStatus: finalUser?.verification_status || 'not_started'
      }
    });
  } catch (error) {
    next(error);
  }
};


exports.verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.params;

    const [verifications] = await pool.query(
      `SELECT uv.*, u.id as user_id 
       FROM university_verifications uv
       JOIN users u ON uv.user_id = u.id
       WHERE uv.student_email_token = ? AND uv.status = 'pending'`,
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
       WHERE id = ?`,
      [verification.id]
    );

    // Update user verification status
    await pool.query(
      `UPDATE users SET verification_status = 'verified', student_id_verified = TRUE WHERE id = ?`,
      [verification.user_id]
    );

    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    next(error);
  }
};