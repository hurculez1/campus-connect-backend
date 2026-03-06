const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');
const { generateToken } = require('../middleware/auth.middleware');
const logger = require('../utils/logger');

exports.adminLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const { rows: admins } = await pool.query(
      'SELECT * FROM admin_users WHERE email = $1 AND is_active = TRUE',
      [email]
    );

    if (admins.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const admin = admins[0];
    const isValidPassword = await bcrypt.compare(password, admin.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    await pool.query(
      'UPDATE admin_users SET last_login = NOW() WHERE id = $1',
      [admin.id]
    );

    const token = generateToken(admin.id);

    res.json({
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        firstName: admin.first_name,
        lastName: admin.last_name,
        role: admin.role
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.getDashboardStats = async (req, res, next) => {
  try {
    // Total users
    const { rows: userStats } = await pool.query(`
      SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN DATE(created_at) = CURRENT_DATE THEN 1 ELSE 0 END) as new_today,
        SUM(CASE WHEN subscription_tier = 'premium' THEN 1 ELSE 0 END) as premium_users,
        SUM(CASE WHEN subscription_tier = 'vip' THEN 1 ELSE 0 END) as vip_users,
        SUM(CASE WHEN last_active >= NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END) as active_24h
      FROM users
    `);

    // Total matches
    const { rows: matchStats } = await pool.query(`
      SELECT 
        COUNT(*) as total_matches,
        SUM(CASE WHEN DATE(created_at) = CURRENT_DATE THEN 1 ELSE 0 END) as matches_today
      FROM matches
    `);

    // Revenue
    const { rows: revenueStats } = await pool.query(`
      SELECT 
        SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_revenue,
        SUM(CASE WHEN status = 'completed' AND DATE(created_at) = CURRENT_DATE THEN amount ELSE 0 END) as revenue_today
      FROM payments
    `);

    // Pending verifications
    const { rows: pendingVerifications } = await pool.query(`
      SELECT COUNT(*) as count FROM university_verifications WHERE status = 'pending'
    `);

    // Recent reports
    const { rows: recentReports } = await pool.query(`
      SELECT r.*, u1.first_name as reporter_name, u2.first_name as reported_name
      FROM reports r
      JOIN users u1 ON r.reporter_id = u1.id
      JOIN users u2 ON r.reported_id = u2.id
      WHERE r.status = 'pending'
      ORDER BY r.created_at DESC LIMIT 5
    `);

    res.json({
      users: userStats[0],
      matches: matchStats[0],
      revenue: revenueStats[0],
      pendingVerifications: pendingVerifications[0].count,
      recentReports
    });
  } catch (error) {
    next(error);
  }
};

exports.getUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, status, verification } = req.query;
    const offset = (page - 1) * limit;

    const params = [];
    let conditions = '';

    if (search) {
      params.push(`%${search}%`);
      conditions += ` AND (u.email ILIKE $${params.length} OR u.first_name ILIKE $${params.length} OR u.last_name ILIKE $${params.length})`;
    }

    if (status === 'banned') {
      conditions += ` AND u.is_banned = TRUE`;
    } else if (status === 'active') {
      conditions += ` AND u.is_active = TRUE AND u.is_banned = FALSE`;
    }

    if (verification) {
      params.push(verification);
      conditions += ` AND u.verification_status = $${params.length}`;
    }

    params.push(parseInt(limit), parseInt(offset));

    const { rows: users } = await pool.query(`
      SELECT u.id, u.email, u.first_name, u.last_name, u.university, 
             u.subscription_tier, u.verification_status, u.is_active, u.is_banned,
             u.created_at, u.last_active,
             (SELECT COUNT(*) FROM matches WHERE user1_id = u.id OR user2_id = u.id) as match_count
      FROM users u
      WHERE 1=1 ${conditions}
      ORDER BY u.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    // Get total count
    const countParams = params.slice(0, params.length - 2);
    const { rows: countResult } = await pool.query(
      `SELECT COUNT(*) as total FROM users u WHERE 1=1 ${conditions}`,
      countParams
    );

    res.json({
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.banUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { reason, duration } = req.body;

    await pool.query(
      `UPDATE users SET is_banned = TRUE, ban_reason = $1 WHERE id = $2`,
      [reason, userId]
    );

    // Log action
    await pool.query(
      `INSERT INTO activity_logs (admin_id, action, entity_type, entity_id, details)
       VALUES ($1, 'ban_user', 'user', $2, $3)`,
      [req.user.id, userId, JSON.stringify({ reason, duration })]
    );

    logger.info(`User banned: ${userId} by admin ${req.user.id}`);

    res.json({ message: 'User banned successfully' });
  } catch (error) {
    next(error);
  }
};

exports.unbanUser = async (req, res, next) => {
  try {
    const { userId } = req.params;

    await pool.query(
      `UPDATE users SET is_banned = FALSE, ban_reason = NULL WHERE id = $1`,
      [userId]
    );

    await pool.query(
      `INSERT INTO activity_logs (admin_id, action, entity_type, entity_id, details)
       VALUES ($1, 'unban_user', 'user', $2, '{}')`,
      [req.user.id, userId]
    );

    res.json({ message: 'User unbanned successfully' });
  } catch (error) {
    next(error);
  }
};

exports.getVerifications = async (req, res, next) => {
  try {
    const { status = 'pending' } = req.query;

    const { rows: verifications } = await pool.query(`
      SELECT uv.*, u.first_name, u.last_name, u.email, u.profile_photo_url
      FROM university_verifications uv
      JOIN users u ON uv.user_id = u.id
      WHERE uv.status = $1
      ORDER BY uv.created_at DESC
    `, [status]);

    res.json({ verifications });
  } catch (error) {
    next(error);
  }
};

exports.reviewVerification = async (req, res, next) => {
  try {
    const { verificationId } = req.params;
    const { status, notes } = req.body;

    await pool.query(
      `UPDATE university_verifications 
       SET status = $1, admin_reviewed_by = $2, admin_reviewed_at = NOW(), ai_verification_notes = $3
       WHERE id = $4`,
      [status, req.user.id, notes, verificationId]
    );

    // Update user verification status
    const { rows: verifications } = await pool.query(
      'SELECT user_id FROM university_verifications WHERE id = $1',
      [verificationId]
    );

    if (verifications.length > 0) {
      await pool.query(
        `UPDATE users SET verification_status = $1 WHERE id = $2`,
        [status, verifications[0].user_id]
      );
    }

    res.json({ message: 'Verification reviewed' });
  } catch (error) {
    next(error);
  }
};

exports.getReports = async (req, res, next) => {
  try {
    const { status = 'pending' } = req.query;

    const { rows: reports } = await pool.query(`
      SELECT r.*, 
             u1.first_name as reporter_name, u1.email as reporter_email,
             u2.first_name as reported_name, u2.email as reported_email
      FROM reports r
      JOIN users u1 ON r.reporter_id = u1.id
      JOIN users u2 ON r.reported_id = u2.id
      WHERE r.status = $1
      ORDER BY r.created_at DESC
    `, [status]);

    res.json({ reports });
  } catch (error) {
    next(error);
  }
};

exports.resolveReport = async (req, res, next) => {
  try {
    const { reportId } = req.params;
    const { resolution, action } = req.body;

    await pool.query(
      `UPDATE reports 
       SET status = 'resolved', resolution_notes = $1, resolved_by = $2, resolved_at = NOW()
       WHERE id = $3`,
      [resolution, req.user.id, reportId]
    );

    // Get report details
    const { rows: reports } = await pool.query(
      'SELECT reported_id FROM reports WHERE id = $1',
      [reportId]
    );

    // Take action if specified
    if (action === 'ban' && reports.length > 0) {
      await pool.query(
        'UPDATE users SET is_banned = TRUE, ban_reason = $1 WHERE id = $2',
        [resolution, reports[0].reported_id]
      );
    }

    res.json({ message: 'Report resolved' });
  } catch (error) {
    next(error);
  }
};