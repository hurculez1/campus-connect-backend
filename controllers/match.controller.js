const { pool } = require('../config/database');
const logger = require('../utils/logger');

exports.createDirectMatch = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { targetUserId } = req.body;
    
    // Sort IDs so user1 is always smaller than user2 to prevent duplicates
    const user1Id = userId < targetUserId ? userId : targetUserId;
    const user2Id = userId < targetUserId ? targetUserId : userId;

    const [existing] = await pool.query(
      'SELECT id FROM matches WHERE user1_id = ? AND user2_id = ?',
      [user1Id, user2Id]
    );

    if (existing.length > 0) {
      return res.json({ matchId: existing[0].id });
    }

    const [result] = await pool.query(
      'INSERT INTO matches (user1_id, user2_id) VALUES (?, ?)',
      [user1Id, user2Id]
    );

    res.json({ matchId: result.insertId });
  } catch (error) {
    next(error);
  }
};

exports.swipe = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { targetUserId, direction } = req.body;

    if (!['like', 'pass', 'super_like'].includes(direction)) {
      return res.status(400).json({ message: 'Invalid direction' });
    }

    // Check if super_like is available
    if (direction === 'super_like') {
      const [userCheck] = await pool.query(
        'SELECT subscription_tier, super_likes_available FROM users WHERE id = ?',
        [userId]
      );

      const user = userCheck[0];
      let availableSuperLikes = user.super_likes_available;

      if (user.subscription_tier === 'free') {
        availableSuperLikes = 0;
      } else if (user.subscription_tier === 'premium') {
        availableSuperLikes = Math.min(availableSuperLikes, 1);
      }

      if (availableSuperLikes <= 0) {
        return res.status(403).json({ message: 'No super likes available' });
      }

      // Deduct super like
      await pool.query(
        'UPDATE users SET super_likes_available = super_likes_available - 1 WHERE id = ?',
        [userId]
      );
    }

    // Check if free tier user has swipes remaining
    const [swipeCheck] = await pool.query(
      'SELECT daily_swipes_used, subscription_tier FROM users WHERE id = ?',
      [userId]
    );

    if (swipeCheck[0].subscription_tier === 'free' && swipeCheck[0].daily_swipes_used >= 50) {
      return res.status(403).json({ 
        message: 'Daily swipe limit reached',
        upgradeRequired: true
      });
    }

    // Increment swipe count for free tier
    if (swipeCheck[0].subscription_tier === 'free') {
      await pool.query(
        'UPDATE users SET daily_swipes_used = daily_swipes_used + 1 WHERE id = ?',
        [userId]
      );
    }

    // Check for reverse swipe (match)
    let isMatch = false;
    if (direction === 'like' || direction === 'super_like') {
      const [reverseSwipes] = await pool.query(
        "SELECT id FROM swipes WHERE swiper_id = ? AND swiped_id = ? AND direction IN ('like', 'super_like')",
        [targetUserId, userId]
      );

      isMatch = reverseSwipes.length > 0;
    }

    // Insert swipe
    const [swipeResult] = await pool.query(
      'INSERT INTO swipes (swiper_id, swiped_id, direction, is_match) VALUES (?, ?, ?, ?) ',
      [userId, targetUserId, direction, isMatch]
    );

    const swipeId = swipeResult.insertId;

    // If match, create match record
    if (isMatch) {
      const [reverseSwipe] = await pool.query(
        'SELECT id FROM swipes WHERE swiper_id = ? AND swiped_id = ?',
        [targetUserId, userId]
      );

      const user1Id = userId < targetUserId ? userId : targetUserId;
      const user2Id = userId < targetUserId ? targetUserId : userId;
      const swipe1Id = userId < targetUserId ? swipeId : reverseSwipe.insertId;
      const swipe2Id = userId < targetUserId ? reverseSwipe.insertId : swipeId;

      await pool.query(
        'INSERT INTO matches (user1_id, user2_id, swipe1_id, swipe2_id) VALUES (?, ?, ?, ?)',
        [user1Id, user2Id, swipe1Id, swipe2Id]
      );

      // Create notifications
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, body, data)
         VALUES (?, 'match', 'New Match!', 'You have a new match!', ?)`,
        [targetUserId, JSON.stringify({ matchUserId: userId })]
      );

      // Emit socket event
      const { io } = require('../server');
      io.to(`user_${targetUserId}`).emit('new_match', {
        userId: userId,
        message: 'You have a new match!'
      });

      logger.info(`New match created: ${userId} <-> ${targetUserId}`);
    }

    res.json({
      success: true,
      isMatch,
      direction
    });
  } catch (error) {
    next(error);
  }
};

exports.getMatches = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const [matches] = await pool.query(
      `SELECT 
        m.id as match_id,
        CASE 
          WHEN m.user1_id = ? THEN m.user2_id 
          ELSE m.user1_id 
        END as other_user_id,
        u.first_name, u.last_name, u.profile_photo_url, u.last_active,
        (SELECT content FROM messages WHERE match_id = m.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages WHERE match_id = m.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
        (SELECT COUNT(*) FROM messages WHERE match_id = m.id AND sender_id != ? AND is_read = FALSE) as unread_count,
        m.created_at as matched_at
       FROM matches m
       JOIN users u ON u.id = CASE WHEN m.user1_id = ? THEN m.user2_id ELSE m.user1_id END
       WHERE (m.user1_id = ? OR m.user2_id = ?) AND m.is_active = TRUE
       ORDER BY last_message_at DESC, m.created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, userId, userId, userId, userId, parseInt(limit), parseInt(offset)]
    );

    res.json({ matches });
  } catch (error) {
    next(error);
  }
};

exports.unmatch = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { matchId } = req.params;

    const [matches] = await pool.query(
      'SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?)',
      [matchId, userId, userId]
    );

    if (matches.length === 0) {
      return res.status(404).json({ message: 'Match not found' });
    }

    await pool.query(
      'UPDATE matches SET is_active = FALSE, unmatched_at = NOW(), unmatched_by = ? WHERE id = ?',
      [userId, matchId]
    );

    // Block the user
    const otherUserId = matches[0].user1_id === userId ? matches[0].user2_id : matches[0].user1_id;
    await pool.query(
      'INSERT INTO blocks (blocker_id, blocked_id, reason) VALUES (?, ?, ?)',
      [userId, otherUserId, 'Unmatched']
    );

    res.json({ message: 'Unmatched successfully' });
  } catch (error) {
    next(error);
  }
};

exports.getWhoLikedMe = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Premium/VIP feature
    if (req.user.subscription_tier === 'free') {
      const [count] = await pool.query(
        `SELECT COUNT(*) as count FROM swipes 
         WHERE swiped_id = ? AND direction = 'like' 
         AND swiper_id NOT IN (
           SELECT swiped_id FROM swipes WHERE swiper_id = ?
         )`,
        [userId, userId]
      );

      return res.json({
        count: count[0].count,
        blurred: true,
        message: 'Upgrade to Premium to see who liked you'
      });
    }

    const [likers] = await pool.query(
      `SELECT u.id, u.first_name, u.profile_photo_url, u.university,
              s.created_at as liked_at
       FROM swipes s
       JOIN users u ON s.swiper_id = u.id
       WHERE s.swiped_id = ? AND s.direction = 'like'
       AND s.swiper_id NOT IN (
         SELECT swiped_id FROM swipes WHERE swiper_id = ?
       )`,
      [userId, userId]
    );

    res.json({ users: likers, count: likers.length });
  } catch (error) {
    next(error);
  }
};