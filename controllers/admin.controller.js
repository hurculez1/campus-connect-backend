const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');
const { generateToken } = require('../middleware/auth.middleware');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

// ─── Admin login via regular user account (must have is_admin=true) ───────────
exports.adminLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const [users] = await pool.query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND is_active = TRUE',
      [email]
    );
    if (users.length === 0) return res.status(401).json({ message: 'Invalid credentials' });
    const user = users[0];
    if (!user.is_admin && !user.is_super_admin) return res.status(403).json({ message: 'Not an admin account' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });
    await pool.query('UPDATE users SET last_active = NOW() WHERE id = ?', [user.id]);
    const token = generateToken(user.id);
    res.json({
      success: true,
      token,
      user: {
        id: user.id, email: user.email,
        firstName: user.first_name, lastName: user.last_name,
        isAdmin: true, isSuperAdmin: user.is_super_admin ? true : false,
        subscriptionTier: 'vip'
      }
    });
  } catch (err) { next(err); }
};

// ─── Dashboard Stats ───────────────────────────────────────────────────────────
exports.getDashboardStats = async (req, res, next) => {
  try {
    const safeQuery = async (query) => {
      try {
        const [rows] = await pool.query(query);
        return rows[0] || {};
      } catch (err) {
        // The instruction seems to be malformed and mixing code from different parts.
        // If the intent was to suppress a 429 toast, it would typically be handled
        // at the HTTP response level, not within a database query wrapper's catch block.
        // Given the instruction to "incorporate the change in a way so that the resulting file is syntactically correct",
        // and the provided snippet `case 429: return null;` is not valid here,
        // I will assume the comment was the primary intent for this location,
        // and the `return {}` should remain for database errors.
        // If the 429 handling was for an HTTP response, it belongs elsewhere.
        // Returning an empty object for database errors is consistent with existing logic.
        return {};
      }
    };

    const userStats = await safeQuery(`SELECT COUNT(CASE WHEN (is_banned = 0 OR is_banned IS NULL) THEN 1 END) as total_users,
        SUM(CASE WHEN DATE(created_at)=CURDATE() AND (is_banned = 0 OR is_banned IS NULL) THEN 1 ELSE 0 END) as new_today,
        SUM(CASE WHEN created_at >= NOW() - INTERVAL 7 DAY AND (is_banned = 0 OR is_banned IS NULL) THEN 1 ELSE 0 END) as new_week,
        SUM(CASE WHEN subscription_tier='premium' AND (is_banned = 0 OR is_banned IS NULL) AND (SELECT COUNT(*) FROM payments p WHERE p.user_id=users.id AND p.status='completed') > 0 THEN 1 ELSE 0 END) as premium_users,
        SUM(CASE WHEN subscription_tier='premium' AND (is_banned = 0 OR is_banned IS NULL) AND (SELECT COUNT(*) FROM payments p WHERE p.user_id=users.id AND p.status='completed') = 0 THEN 1 ELSE 0 END) as trial_users,
        SUM(CASE WHEN subscription_tier='vip' AND (is_banned = 0 OR is_banned IS NULL) THEN 1 ELSE 0 END) as vip_users,
        SUM(CASE WHEN last_active >= NOW() - INTERVAL 24 HOUR AND (is_banned = 0 OR is_banned IS NULL) THEN 1 ELSE 0 END) as active_24h,
        SUM(CASE WHEN is_banned = 1 THEN 1 ELSE 0 END) as banned_users
        FROM users`);

    const matchStats = await safeQuery(`SELECT COUNT(*) as total_matches,
        SUM(CASE WHEN DATE(created_at)=CURDATE() THEN 1 ELSE 0 END) as matches_today
        FROM matches`);

    const revenueStats = await safeQuery(`SELECT 
        COALESCE(SUM(CASE WHEN status='completed' THEN amount ELSE 0 END),0) as total_revenue,
        COALESCE(SUM(CASE WHEN status='completed' AND DATE(created_at)=CURDATE() THEN amount ELSE 0 END),0) as revenue_today
        FROM payments`);

    const pendingVer = await safeQuery(`SELECT COUNT(*) as count FROM university_verifications WHERE status='pending'`);
    const pulseStats = await safeQuery(`SELECT COUNT(*) as total_posts, SUM(CASE WHEN DATE(created_at)=CURDATE() THEN 1 ELSE 0 END) as posts_today FROM posts`);
    const messageStats = await safeQuery(`SELECT COUNT(*) as total_messages FROM messages`);

    let recentReports = [];
    try {
      const [rows] = await pool.query(`
        SELECT r.*, u1.first_name as reporter_name, u2.first_name as reported_name
        FROM reports r
        JOIN users u1 ON r.reporter_id=u1.id
        JOIN users u2 ON r.reported_id=u2.id
        WHERE r.status='pending' ORDER BY r.created_at DESC LIMIT 5
      `);
      recentReports = rows;
    } catch (e) {}

    res.json({
      users: userStats,
      matches: matchStats,
      revenue: revenueStats,
      pulse: pulseStats,
      messages: messageStats,
      pendingVerifications: pendingVer.count || 0,
      recentReports
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
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      conditions += ` AND (u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)`;
    }
    if (status === 'banned') conditions += ` AND u.is_banned = 1`;
    else if (status === 'active') conditions += ` AND u.is_active = 1 AND u.is_banned = 0`;
    if (tier) { params.push(tier); conditions += ` AND u.subscription_tier = ?`; }
    
    const countParams = [...params];
    params.push(parseInt(limit), parseInt(offset));

    const [users] = await pool.query(`
      SELECT u.id, u.email, u.first_name, u.last_name, u.university, u.gender,
             u.subscription_tier, u.verification_status, u.is_active, u.is_banned,
             u.is_admin, u.is_super_admin, u.created_at, u.last_active, u.profile_photo_url,
             (SELECT COUNT(*) FROM matches WHERE user1_id=u.id OR user2_id=u.id) as match_count,
             (SELECT COUNT(*) FROM payments WHERE user_id=u.id AND status='completed') as payment_count
      FROM users u WHERE 1=1 ${conditions}
      ORDER BY u.created_at DESC LIMIT ? OFFSET ?
    `, params);

    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM users u WHERE 1=1 ${conditions}`, countParams);
    const [activeCount] = await pool.query(`SELECT COUNT(*) as total FROM users WHERE (is_banned = 0 OR is_banned IS NULL)`);
    const [bannedCount] = await pool.query(`SELECT COUNT(*) as total FROM users WHERE is_banned = 1`);
    res.json({ 
      users, 
      active_count: activeCount[0].total, 
      banned_count: bannedCount[0].total,
      pagination: { 
        page: parseInt(page), 
        limit: parseInt(limit), 
        total: countResult[0].total 
      } 
    });
  } catch (err) { next(err); }
};

exports.getUserDetail = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const [users] = await pool.query(`
      SELECT u.*, 
        (SELECT COUNT(*) FROM matches WHERE user1_id=u.id OR user2_id=u.id) as match_count,
        (SELECT COUNT(*) FROM messages WHERE sender_id=u.id) as message_count
      FROM users u WHERE u.id=?
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
    await pool.query(`UPDATE users SET is_banned=1, ban_reason=? WHERE id=?`, [reason, userId]);
    // Optionally insert log
    res.json({ message: 'User banned' });
  } catch (err) { next(err); }
};

exports.unbanUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    await pool.query(`UPDATE users SET is_banned=0, ban_reason=NULL WHERE id=?`, [userId]);
    res.json({ message: 'User unbanned' });
  } catch (err) { next(err); }
};

exports.deleteUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    await pool.query(`DELETE FROM users WHERE id=?`, [userId]);
    res.json({ message: 'User deleted permanently' });
  } catch (err) { next(err); }
};

exports.promoteToAdmin = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { superAdmin = false } = req.body;
    await pool.query(`UPDATE users SET is_admin=1, is_super_admin=?, subscription_tier='premium' WHERE id=?`, [superAdmin ? 1 : 0, userId]);
    res.json({ message: 'User promoted to admin' });
  } catch (err) { next(err); }
};

exports.demoteFromAdmin = async (req, res, next) => {
  try {
    const { userId } = req.params;
    await pool.query(`UPDATE users SET is_admin=0, is_super_admin=0 WHERE id=?`, [userId]);
    res.json({ message: 'Admin privileges removed' });
  } catch (err) { next(err); }
};

exports.changeUserSubscription = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { tier } = req.body;
    if (!['free','premium','vip'].includes(tier)) return res.status(400).json({ message: 'Invalid tier' });
    await pool.query(`UPDATE users SET subscription_tier=? WHERE id=?`, [tier, userId]);
    res.json({ message: `Subscription changed to ${tier}` });
  } catch (err) { next(err); }
};

exports.updateUserProfile = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { university, interests } = req.body;
    
    let interestsStr = interests;
    if (Array.isArray(interests)) {
      interestsStr = JSON.stringify(interests);
    }

    await pool.query(
      'UPDATE users SET university = ?, interests = ? WHERE id = ?',
      [university, interestsStr, userId]
    );

    res.json({ success: true, message: 'User profile updated' });
  } catch (err) { next(err); }
};

// ─── Content Moderation ────────────────────────────────────────────────────────
exports.getAllPulse = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let posts = [];
    try {
      const [rows] = await pool.query(`
        SELECT p.*, u.first_name, u.last_name, u.email, u.profile_photo_url
        FROM posts p LEFT JOIN users u ON p.user_id=u.id
        ORDER BY p.created_at DESC LIMIT ? OFFSET ?
      `, [parseInt(limit), parseInt(offset)]);
      posts = rows;
    } catch(e) {}
    res.json({ posts });
  } catch (err) { next(err); }
};

exports.deletePulsePost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    await pool.query(`DELETE FROM posts WHERE id=?`, [postId]).catch(() => {});
    res.json({ message: 'Post deleted' });
  } catch (err) { next(err); }
};

exports.getRecentMessages = async (req, res, next) => {
  try {
    let messages = [];
    try {
      const [rows] = await pool.query(`
        SELECT m.id, m.content, m.created_at, m.match_id,
               u.first_name as sender_name, u.email as sender_email
        FROM messages m JOIN users u ON m.sender_id=u.id
        ORDER BY m.created_at DESC LIMIT 50
      `);
      messages = rows;
    } catch(e){}
    res.json({ messages });
  } catch (err) { next(err); }
};

// ─── Verifications ─────────────────────────────────────────────────────────────
exports.getVerifications = async (req, res, next) => {
  try {
    const { status = 'pending' } = req.query;
    let verifications = [];
    try {
      const [rows] = await pool.query(`
        SELECT uv.*, u.first_name, u.last_name, u.email, u.profile_photo_url
        FROM university_verifications uv JOIN users u ON uv.user_id=u.id
        WHERE uv.status=? ORDER BY uv.created_at DESC
      `, [status]);
      verifications = rows;
    } catch(e){}
    res.json({ verifications });
  } catch (err) { next(err); }
};

exports.reviewVerification = async (req, res, next) => {
  try {
    const { verificationId } = req.params;
    const { status, notes } = req.body;
    await pool.query(`UPDATE university_verifications SET status=?, admin_reviewed_by=?, admin_reviewed_at=NOW(), ai_verification_notes=? WHERE id=?`,
      [status, req.user.id, notes, verificationId]).catch(() => {});
    const [rows] = await pool.query('SELECT user_id FROM university_verifications WHERE id=?', [verificationId]).catch(() => Object.create({rows:[]}));
    if (rows && rows.length > 0) await pool.query(`UPDATE users SET verification_status=? WHERE id=?`, [status, rows[0].user_id]).catch(() => {});
    res.json({ message: 'Verification reviewed' });
  } catch (err) { next(err); }
};

// ─── Reports ───────────────────────────────────────────────────────────────────
exports.getReports = async (req, res, next) => {
  try {
    const { status = 'pending' } = req.query;
    let reports = [];
    try {
      const [rows] = await pool.query(`
        SELECT r.*, u1.first_name as reporter_name, u1.email as reporter_email,
               u2.first_name as reported_name, u2.email as reported_email
        FROM reports r JOIN users u1 ON r.reporter_id=u1.id JOIN users u2 ON r.reported_id=u2.id
        WHERE r.status=? ORDER BY r.created_at DESC
      `, [status]);
      reports = rows;
    } catch(e){}
    res.json({ reports });
  } catch (err) { next(err); }
};

exports.resolveReport = async (req, res, next) => {
  try {
    const { reportId } = req.params;
    const { resolution, action } = req.body;
    await pool.query(`UPDATE reports SET status='resolved', resolution_notes=?, resolved_by=?, resolved_at=NOW() WHERE id=?`,
      [resolution, req.user.id, reportId]).catch(() => {});
    if (action === 'ban') {
      const [rows] = await pool.query('SELECT reported_id FROM reports WHERE id=?', [reportId]);
      if (rows && rows.length > 0) await pool.query('UPDATE users SET is_banned=1, ban_reason=? WHERE id=?', [resolution, rows[0].reported_id]).catch(() => {});
    }
    res.json({ message: 'Report resolved' });
  } catch (err) { next(err); }
};

// ─── Analytics ─────────────────────────────────────────────────────────────────
exports.getAnalytics = async (req, res, next) => {
  try {
    let signupTrend = [], matchTrend = [], topUniversities = [];
    try {
      const [s] = await pool.query(`SELECT DATE(created_at) as date, COUNT(*) as count FROM users WHERE created_at >= NOW() - INTERVAL 30 DAY GROUP BY DATE(created_at) ORDER BY date`);
      signupTrend = s;
      const [m] = await pool.query(`SELECT DATE(created_at) as date, COUNT(*) as count FROM matches WHERE created_at >= NOW() - INTERVAL 30 DAY GROUP BY DATE(created_at) ORDER BY date`);
      matchTrend = m;
      const [u] = await pool.query(`SELECT university, COUNT(*) as count FROM users WHERE university IS NOT NULL GROUP BY university ORDER BY count DESC LIMIT 10`);
      topUniversities = u;
    } catch (e) {}
    res.json({ signupTrend, matchTrend, topUniversities });
  } catch (err) { next(err); }
};

exports.getActivityLog = async (req, res, next) => {
  res.json({ logs: [] }); // Activity logs disabled to simplify MySQL migration structure
};

// ─── System ────────────────────────────────────────────────────────────────────
exports.sendAnnouncement = async (req, res, next) => {
  try {
    res.json({ message: 'Announcement sent' });
  } catch (err) { next(err); }
};

exports.getSystemInfo = async (req, res, next) => {
  try {
    res.json({
      nodeVersion: process.version,
      platform: process.platform,
      uptime: Math.floor(process.uptime()),
      memoryUsage: process.memoryUsage(),
      dbSize: 0,
      postgresVersion: 'MySQL',
      env: process.env.NODE_ENV
    });
  } catch (err) { next(err); }
};

exports.cleanupTestAccounts = async (req, res, next) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM users WHERE email LIKE '%ai%' OR email LIKE '%test%' OR first_name LIKE '%Test%' OR last_name LIKE '%Test%'"
    );
    res.json({ message: `Successfully deleted ${result.affectedRows} accounts.` });
  } catch (err) { next(err); }
};

// ─── Pulse Content Moderation ──────────────────────────────────────────────────
exports.getAllPulse = async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const [posts] = await pool.query(
      `SELECT 
        p.id, p.content, p.media_url, p.created_at, p.is_ghost,
        p.likes_count, p.comments_count,
        COALESCE(u.first_name, 'Ghost User') as first_name,
        COALESCE(u.last_name, '') as last_name,
        u.profile_photo_url,
        u.email,
        u.id as user_id,
        IF(p.is_ghost = 1, CONCAT('Ghost • ', COALESCE(u.university, 'Unknown Uni')), CONCAT(COALESCE(u.first_name,'Unknown'), ' • ', COALESCE(u.university,''))) as display_name
       FROM posts p
       LEFT JOIN users u ON p.user_id = u.id
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [parseInt(limit), parseInt(offset)]
    );
    res.json({ posts, total: posts.length });
  } catch (err) {
    // Fallback if posts table doesn't have all expected columns
    try {
      const [posts] = await pool.query(
        `SELECT p.*, COALESCE(u.first_name,'Unknown') as first_name, u.profile_photo_url, u.email
         FROM posts p LEFT JOIN users u ON p.user_id = u.id
         ORDER BY p.created_at DESC LIMIT 50`
      );
      res.json({ posts });
    } catch (e) {
      res.json({ posts: [] });
    }
  }
};

exports.deletePulsePost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    await pool.query('DELETE FROM posts WHERE id = ?', [postId]);
    res.json({ success: true, message: 'Post removed' });
  } catch (err) { next(err); }
};

// ─── Recent Messages ───────────────────────────────────────────────────────────
exports.getRecentMessages = async (req, res, next) => {
  try {
    const [messages] = await pool.query(
      `SELECT m.id, m.content, m.created_at, m.message_type,
              u.first_name, u.profile_photo_url
       FROM messages m
       LEFT JOIN users u ON m.sender_id = u.id
       WHERE m.sender_id != 0
       ORDER BY m.created_at DESC
       LIMIT 100`
    );
    res.json({ messages });
  } catch (err) { res.json({ messages: [] }); }
};