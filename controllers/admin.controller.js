const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');
const { generateToken } = require('../middleware/auth.middleware');
const logger = require('../utils/logger');

// ─── Admin login via regular user account (must have is_admin=true) ───────────
exports.adminLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const { rows: users } = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = TRUE',
      [email]
    );
    if (users.length === 0) return res.status(401).json({ message: 'Invalid credentials' });
    const user = users[0];
    if (!user.is_admin && !user.is_super_admin) return res.status(403).json({ message: 'Not an admin account' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });
    await pool.query('UPDATE users SET last_active = NOW() WHERE id = $1', [user.id]);
    const token = generateToken(user.id);
    res.json({
      token,
      user: {
        id: user.id, email: user.email,
        firstName: user.first_name, lastName: user.last_name,
        isAdmin: user.is_admin, isSuperAdmin: user.is_super_admin,
        subscriptionTier: user.subscription_tier
      }
    });
  } catch (err) { next(err); }
};

// ─── Dashboard Stats ───────────────────────────────────────────────────────────
exports.getDashboardStats = async (req, res, next) => {
  try {
    const [userStats, matchStats, revenueStats, pendingVer, pulseStats, messageStats] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total_users,
        SUM(CASE WHEN DATE(created_at)=CURRENT_DATE THEN 1 ELSE 0 END) as new_today,
        SUM(CASE WHEN created_at >= NOW()-INTERVAL '7 days' THEN 1 ELSE 0 END) as new_week,
        SUM(CASE WHEN subscription_tier='premium' THEN 1 ELSE 0 END) as premium_users,
        SUM(CASE WHEN subscription_tier='vip' THEN 1 ELSE 0 END) as vip_users,
        SUM(CASE WHEN last_active >= NOW()-INTERVAL '24 hours' THEN 1 ELSE 0 END) as active_24h,
        SUM(CASE WHEN is_banned=TRUE THEN 1 ELSE 0 END) as banned_users
        FROM users`),
      pool.query(`SELECT COUNT(*) as total_matches,
        SUM(CASE WHEN DATE(created_at)=CURRENT_DATE THEN 1 ELSE 0 END) as matches_today
        FROM matches`),
      pool.query(`SELECT 
        COALESCE(SUM(CASE WHEN status='completed' THEN amount ELSE 0 END),0) as total_revenue,
        COALESCE(SUM(CASE WHEN status='completed' AND DATE(created_at)=CURRENT_DATE THEN amount ELSE 0 END),0) as revenue_today
        FROM payments`).catch(() => ({ rows: [{ total_revenue: 0, revenue_today: 0 }] })),
      pool.query(`SELECT COUNT(*) as count FROM university_verifications WHERE status='pending'`).catch(() => ({ rows: [{ count: 0 }] })),
      pool.query(`SELECT COUNT(*) as total_posts, SUM(CASE WHEN DATE(created_at)=CURRENT_DATE THEN 1 ELSE 0 END) as posts_today FROM posts`).catch(() => ({ rows: [{ total_posts: 0, posts_today: 0 }] })),
      pool.query(`SELECT COUNT(*) as total_messages FROM messages`).catch(() => ({ rows: [{ total_messages: 0 }] }))
    ]);

    const recentReports = await pool.query(`
      SELECT r.*, u1.first_name as reporter_name, u2.first_name as reported_name
      FROM reports r
      JOIN users u1 ON r.reporter_id=u1.id
      JOIN users u2 ON r.reported_id=u2.id
      WHERE r.status='pending' ORDER BY r.created_at DESC LIMIT 5
    `).catch(() => ({ rows: [] }));

    res.json({
      users: userStats.rows[0],
      matches: matchStats.rows[0],
      revenue: revenueStats.rows[0],
      pulse: pulseStats.rows[0],
      messages: messageStats.rows[0],
      pendingVerifications: pendingVer.rows[0].count,
      recentReports: recentReports.rows
    });
  } catch (err) { next(err); }
};

// ─── User Management ───────────────────────────────────────────────────────────
exports.getUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, status, tier } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let conditions = '';
    if (search) {
      params.push(`%${search}%`);
      conditions += ` AND (u.email ILIKE $${params.length} OR u.first_name ILIKE $${params.length} OR u.last_name ILIKE $${params.length})`;
    }
    if (status === 'banned') conditions += ` AND u.is_banned = TRUE`;
    else if (status === 'active') conditions += ` AND u.is_active = TRUE AND u.is_banned = FALSE`;
    if (tier) { params.push(tier); conditions += ` AND u.subscription_tier = $${params.length}`; }
    params.push(parseInt(limit), parseInt(offset));
    const { rows: users } = await pool.query(`
      SELECT u.id, u.email, u.first_name, u.last_name, u.university, u.gender,
             u.subscription_tier, u.verification_status, u.is_active, u.is_banned,
             u.is_admin, u.is_super_admin, u.created_at, u.last_active, u.profile_photo_url,
             (SELECT COUNT(*) FROM matches WHERE user1_id=u.id OR user2_id=u.id) as match_count
      FROM users u WHERE 1=1 ${conditions}
      ORDER BY u.created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}
    `, params);
    const countParams = params.slice(0, params.length - 2);
    const { rows: countResult } = await pool.query(`SELECT COUNT(*) as total FROM users u WHERE 1=1 ${conditions}`, countParams);
    res.json({ users, pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total } });
  } catch (err) { next(err); }
};

exports.getUserDetail = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { rows: users } = await pool.query(`
      SELECT u.*, 
        (SELECT COUNT(*) FROM matches WHERE user1_id=u.id OR user2_id=u.id) as match_count,
        (SELECT COUNT(*) FROM messages WHERE sender_id=u.id) as message_count
      FROM users u WHERE u.id=$1
    `, [userId]);
    if (users.length === 0) return res.status(404).json({ message: 'User not found' });
    const { password_hash, ...safeUser } = users[0];
    res.json({ user: safeUser });
  } catch (err) { next(err); }
};

exports.banUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;
    await pool.query(`UPDATE users SET is_banned=TRUE, ban_reason=$1 WHERE id=$2`, [reason, userId]);
    await pool.query(`INSERT INTO activity_logs (admin_id,action,entity_type,entity_id,details) VALUES($1,'ban_user','user',$2,$3)`,
      [req.user.id, userId, JSON.stringify({ reason })]).catch(() => {});
    logger.info(`User banned: ${userId}`);
    res.json({ message: 'User banned' });
  } catch (err) { next(err); }
};

exports.unbanUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    await pool.query(`UPDATE users SET is_banned=FALSE, ban_reason=NULL WHERE id=$1`, [userId]);
    await pool.query(`INSERT INTO activity_logs (admin_id,action,entity_type,entity_id,details) VALUES($1,'unban_user','user',$2,'{}')`,
      [req.user.id, userId]).catch(() => {});
    res.json({ message: 'User unbanned' });
  } catch (err) { next(err); }
};

exports.deleteUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    await pool.query(`DELETE FROM users WHERE id=$1`, [userId]);
    res.json({ message: 'User deleted permanently' });
  } catch (err) { next(err); }
};

exports.promoteToAdmin = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { superAdmin = false } = req.body;
    await pool.query(`UPDATE users SET is_admin=TRUE, is_super_admin=$1, subscription_tier='vip' WHERE id=$2`, [superAdmin, userId]);
    await pool.query(`INSERT INTO activity_logs (admin_id,action,entity_type,entity_id,details) VALUES($1,'promote_admin','user',$2,$3)`,
      [req.user.id, userId, JSON.stringify({ superAdmin })]).catch(() => {});
    res.json({ message: 'User promoted to admin' });
  } catch (err) { next(err); }
};

exports.demoteFromAdmin = async (req, res, next) => {
  try {
    const { userId } = req.params;
    await pool.query(`UPDATE users SET is_admin=FALSE, is_super_admin=FALSE WHERE id=$1`, [userId]);
    res.json({ message: 'Admin privileges removed' });
  } catch (err) { next(err); }
};

exports.changeUserSubscription = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { tier } = req.body;
    if (!['free','premium','vip'].includes(tier)) return res.status(400).json({ message: 'Invalid tier' });
    await pool.query(`UPDATE users SET subscription_tier=$1 WHERE id=$2`, [tier, userId]);
    res.json({ message: `Subscription changed to ${tier}` });
  } catch (err) { next(err); }
};

// ─── Content Moderation ────────────────────────────────────────────────────────
exports.getAllPulse = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const { rows: posts } = await pool.query(`
      SELECT p.*, u.first_name, u.last_name, u.email, u.profile_photo_url
      FROM posts p LEFT JOIN users u ON p.user_id=u.id
      ORDER BY p.created_at DESC LIMIT $1 OFFSET $2
    `, [limit, offset]).catch(() => ({ rows: [] }));
    res.json({ posts });
  } catch (err) { next(err); }
};

exports.deletePulsePost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    await pool.query(`DELETE FROM posts WHERE id=$1`, [postId]).catch(() => {});
    res.json({ message: 'Post deleted' });
  } catch (err) { next(err); }
};

exports.getRecentMessages = async (req, res, next) => {
  try {
    const { rows: messages } = await pool.query(`
      SELECT m.id, m.content, m.created_at, m.match_id,
             u.first_name as sender_name, u.email as sender_email
      FROM messages m JOIN users u ON m.sender_id=u.id
      ORDER BY m.created_at DESC LIMIT 50
    `).catch(() => ({ rows: [] }));
    res.json({ messages });
  } catch (err) { next(err); }
};

// ─── Verifications ─────────────────────────────────────────────────────────────
exports.getVerifications = async (req, res, next) => {
  try {
    const { status = 'pending' } = req.query;
    const { rows: verifications } = await pool.query(`
      SELECT uv.*, u.first_name, u.last_name, u.email, u.profile_photo_url
      FROM university_verifications uv JOIN users u ON uv.user_id=u.id
      WHERE uv.status=$1 ORDER BY uv.created_at DESC
    `, [status]).catch(() => ({ rows: [] }));
    res.json({ verifications });
  } catch (err) { next(err); }
};

exports.reviewVerification = async (req, res, next) => {
  try {
    const { verificationId } = req.params;
    const { status, notes } = req.body;
    await pool.query(`UPDATE university_verifications SET status=$1, admin_reviewed_by=$2, admin_reviewed_at=NOW(), ai_verification_notes=$3 WHERE id=$4`,
      [status, req.user.id, notes, verificationId]).catch(() => {});
    const { rows } = await pool.query('SELECT user_id FROM university_verifications WHERE id=$1', [verificationId]).catch(() => ({ rows: [] }));
    if (rows.length > 0) await pool.query(`UPDATE users SET verification_status=$1 WHERE id=$2`, [status, rows[0].user_id]).catch(() => {});
    res.json({ message: 'Verification reviewed' });
  } catch (err) { next(err); }
};

// ─── Reports ───────────────────────────────────────────────────────────────────
exports.getReports = async (req, res, next) => {
  try {
    const { status = 'pending' } = req.query;
    const { rows: reports } = await pool.query(`
      SELECT r.*, u1.first_name as reporter_name, u1.email as reporter_email,
             u2.first_name as reported_name, u2.email as reported_email
      FROM reports r JOIN users u1 ON r.reporter_id=u1.id JOIN users u2 ON r.reported_id=u2.id
      WHERE r.status=$1 ORDER BY r.created_at DESC
    `, [status]).catch(() => ({ rows: [] }));
    res.json({ reports });
  } catch (err) { next(err); }
};

exports.resolveReport = async (req, res, next) => {
  try {
    const { reportId } = req.params;
    const { resolution, action } = req.body;
    await pool.query(`UPDATE reports SET status='resolved', resolution_notes=$1, resolved_by=$2, resolved_at=NOW() WHERE id=$3`,
      [resolution, req.user.id, reportId]).catch(() => {});
    if (action === 'ban') {
      const { rows } = await pool.query('SELECT reported_id FROM reports WHERE id=$1', [reportId]).catch(() => ({ rows: [] }));
      if (rows.length > 0) await pool.query('UPDATE users SET is_banned=TRUE, ban_reason=$1 WHERE id=$2', [resolution, rows[0].reported_id]).catch(() => {});
    }
    res.json({ message: 'Report resolved' });
  } catch (err) { next(err); }
};

// ─── Analytics ─────────────────────────────────────────────────────────────────
exports.getAnalytics = async (req, res, next) => {
  try {
    const [signupTrend, matchTrend, topUniversities] = await Promise.all([
      pool.query(`SELECT DATE(created_at) as date, COUNT(*) as count FROM users WHERE created_at >= NOW()-INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY date`),
      pool.query(`SELECT DATE(created_at) as date, COUNT(*) as count FROM matches WHERE created_at >= NOW()-INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY date`).catch(() => ({ rows: [] })),
      pool.query(`SELECT university, COUNT(*) as count FROM users WHERE university IS NOT NULL GROUP BY university ORDER BY count DESC LIMIT 10`)
    ]);
    res.json({ signupTrend: signupTrend.rows, matchTrend: matchTrend.rows, topUniversities: topUniversities.rows });
  } catch (err) { next(err); }
};

exports.getActivityLog = async (req, res, next) => {
  try {
    const { rows: logs } = await pool.query(`
      SELECT al.*, u.first_name as admin_name, u.email as admin_email
      FROM activity_logs al LEFT JOIN users u ON al.admin_id=u.id
      ORDER BY al.created_at DESC LIMIT 100
    `).catch(() => ({ rows: [] }));
    res.json({ logs });
  } catch (err) { next(err); }
};

// ─── System ────────────────────────────────────────────────────────────────────
exports.sendAnnouncement = async (req, res, next) => {
  try {
    const { title, message, targetTier } = req.body;
    // Store announcement in DB for users to see
    await pool.query(`CREATE TABLE IF NOT EXISTS announcements (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), title TEXT, message TEXT, target_tier TEXT, created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW())`).catch(() => {});
    await pool.query(`INSERT INTO announcements (title, message, target_tier, created_by) VALUES($1,$2,$3,$4)`,
      [title, message, targetTier || 'all', req.user.id]);
    res.json({ message: 'Announcement sent' });
  } catch (err) { next(err); }
};

exports.getSystemInfo = async (req, res, next) => {
  try {
    const { rows: dbInfo } = await pool.query(`SELECT pg_database_size(current_database()) as db_size, version() as postgres_version`);
    res.json({
      nodeVersion: process.version,
      platform: process.platform,
      uptime: Math.floor(process.uptime()),
      memoryUsage: process.memoryUsage(),
      dbSize: dbInfo[0].db_size,
      postgresVersion: dbInfo[0].postgres_version,
      env: process.env.NODE_ENV
    });
  } catch (err) { next(err); }
};