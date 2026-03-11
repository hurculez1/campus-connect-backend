const { pool } = require('../config/database');
const logger = require('../utils/logger');
const CryptoJS = require('crypto-js');

const ENCRYPTION_KEY = process.env.MESSAGE_ENCRYPTION_KEY || 'default-key-32-chars-long!!!!!';

const decryptMessage = (ciphertext) => {
  if (!ciphertext) return null;
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    return decrypted || ciphertext;
  } catch (e) {
    return ciphertext;
  }
};

// Create a pending match request (Match Now)
exports.createMatchRequest = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { targetUserId } = req.body;
    
    console.log('Creating match request:', userId, '->', targetUserId);
    
    if (!targetUserId) {
      return res.status(400).json({ message: 'Target user ID required' });
    }
    
    if (userId === targetUserId) {
      return res.status(400).json({ message: 'Cannot match with yourself' });
    }
    
    // Check if already matched or request already exists
    const user1Id = userId < targetUserId ? userId : targetUserId;
    const user2Id = userId < targetUserId ? targetUserId : userId;

    const [existing] = await pool.query(
      'SELECT id, status FROM match_requests WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)',
      [userId, targetUserId, targetUserId, userId]
    );

    if (existing.length > 0) {
      if (existing[0].status === 'accepted') {
        return res.status(400).json({ message: 'Already matched with this user' });
      }
      if (existing[0].status === 'pending') {
        return res.status(400).json({ message: 'Request already sent' });
      }
    }

    // Create pending request
    const [result] = await pool.query(
      'INSERT INTO match_requests (from_user_id, to_user_id, status) VALUES (?, ?, ?)',
      [userId, targetUserId, 'pending']
    );
    
    const requestId = result.insertId;
    console.log('Created match request:', requestId);

    // Create notification for target user
    const [fromUser] = await pool.query(
      'SELECT first_name, profile_photo_url FROM users WHERE id = ?',
      [userId]
    );
    
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES (?, 'match_request', 'New Match Request!', ?, ?)`,
      [targetUserId, `${fromUser[0]?.first_name || 'Someone'} wants to connect with you!`, JSON.stringify({ requestId, fromUserId: userId })]
    );

    // Emit socket event to target user
    if (req.app.io) {
      req.app.io.to(`user_${targetUserId}`).emit('match_request', {
        requestId,
        fromUserId: userId,
        fromUserName: fromUser[0]?.first_name,
        message: 'You have a new match request!'
      });
    }

    res.json({ success: true, requestId, message: 'Match request sent!' });
  } catch (error) {
    console.error('Match request error:', error);
    next(error);
  }
};

// Accept a match request
exports.acceptMatchRequest = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { requestId } = req.body;
    
    console.log('Accepting match request:', requestId, 'by user:', userId);
    
    if (!requestId) {
      return res.status(400).json({ message: 'Request ID required' });
    }
    
    // Get the request
    const [requests] = await pool.query(
      'SELECT * FROM match_requests WHERE id = ? AND to_user_id = ? AND status = ?',
      [requestId, userId, 'pending']
    );

    if (requests.length === 0) {
      return res.status(404).json({ message: 'Request not found or already processed' });
    }

    const request = requests[0];
    const fromUserId = request.from_user_id;

    // Update request status
    await pool.query(
      'UPDATE match_requests SET status = ? WHERE id = ?',
      ['accepted', requestId]
    );

    // Create actual match
    const user1Id = userId < fromUserId ? userId : fromUserId;
    const user2Id = userId < fromUserId ? fromUserId : userId;

    const [existingMatch] = await pool.query(
      'SELECT id FROM matches WHERE user1_id = ? AND user2_id = ?',
      [user1Id, user2Id]
    );

    let matchId;
    if (existingMatch.length > 0) {
      matchId = existingMatch[0].id;
      await pool.query('UPDATE matches SET is_active = TRUE WHERE id = ?', [matchId]);
    } else {
      const [result] = await pool.query(
        'INSERT INTO matches (user1_id, user2_id, is_active) VALUES (?, ?, TRUE)',
        [user1Id, user2Id]
      );
      matchId = result.insertId;
    }

    // Create notification for the request sender
    const [toUser] = await pool.query(
      'SELECT first_name FROM users WHERE id = ?',
      [userId]
    );
    
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES (?, 'match', 'Match Accepted!', ?, ?)`,
      [fromUserId, `${toUser[0]?.first_name || 'Someone'} accepted your match request!`, JSON.stringify({ matchId })]
    );

    // Emit socket event
    const { io } = require('../server');
    if (io) {
      io.to(`user_${fromUserId}`).emit('match_accepted', {
        matchId,
        fromUserId: userId,
        message: 'Your match request was accepted!'
      });
    }

    res.json({ success: true, matchId, message: 'Match accepted!' });
  } catch (error) {
    console.error('Accept match error:', error);
    next(error);
  }
};

// Reject a match request
exports.rejectMatchRequest = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { requestId } = req.body;
    
    console.log('Rejecting match request:', requestId, 'by user:', userId);
    
    if (!requestId) {
      return res.status(400).json({ message: 'Request ID required' });
    }
    
    await pool.query(
      'UPDATE match_requests SET status = ? WHERE id = ? AND to_user_id = ? AND status = ?',
      ['rejected', requestId, userId, 'pending']
    );

    res.json({ success: true, message: 'Match request rejected' });
  } catch (error) {
    console.error('Reject match error:', error);
    next(error);
  }
};

// Get pending match requests
exports.getPendingRequests = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Get requests sent to me
    const [received] = await pool.query(
      `SELECT mr.*, u.id, u.id as userId, u.first_name, u.last_name, u.profile_photo_url, u.university, u.course
       FROM match_requests mr
       JOIN users u ON u.id = mr.from_user_id
       WHERE mr.to_user_id = ? AND mr.status = 'pending'
       ORDER BY mr.created_at DESC`,
      [userId]
    );

    // Get requests I sent
    const [sent] = await pool.query(
      `SELECT mr.*, u.id, u.id as userId, u.first_name, u.last_name, u.profile_photo_url, u.university, u.course
       FROM match_requests mr
       JOIN users u ON u.id = mr.to_user_id
       WHERE mr.from_user_id = ? AND mr.status = 'pending'
       ORDER BY mr.created_at DESC`,
      [userId]
    );

    [...received, ...sent].forEach(r => {
        if (r.created_at) r.created_at = new Date(r.created_at).toISOString();
    });

    res.json({ 
      received: received,
      sent: sent,
      receivedCount: received.length,
      sentCount: sent.length
    });
  } catch (error) {
    console.error('Get pending requests error:', error);
    next(error);
  }
};

exports.createDirectMatch = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { targetUserId } = req.body;
    
    console.log('Creating direct match:', userId, '->', targetUserId);
    
    if (!targetUserId) {
      return res.status(400).json({ message: 'Target user ID required' });
    }
    
    if (userId === targetUserId) {
      return res.status(400).json({ message: 'Cannot match with yourself' });
    }
    
    // Sort IDs so user1 is always smaller than user2
    const user1Id = userId < targetUserId ? userId : targetUserId;
    const user2Id = userId < targetUserId ? targetUserId : userId;

    const [existing] = await pool.query(
      'SELECT id, is_active FROM matches WHERE user1_id = ? AND user2_id = ?',
      [user1Id, user2Id]
    );

    let matchId;
    if (existing.length > 0) {
      matchId = existing[0].id;
      if (!existing[0].is_active) {
        await pool.query('UPDATE matches SET is_active = TRUE WHERE id = ?', [matchId]);
      }
      console.log('Found existing match:', matchId);
    } else {
      const [result] = await pool.query(
        'INSERT INTO matches (user1_id, user2_id, is_active) VALUES (?, ?, TRUE)',
        [user1Id, user2Id]
      );
      matchId = result.insertId;
      console.log('Created new match:', matchId);
    }

    // Create notification for target user
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES (?, 'match', 'New Connection!', 'Someone wants to chat with you!', ?)`,
      [targetUserId, JSON.stringify({ matchUserId: userId, matchId })]
    );

    // Emit socket event to target user using req.app.io (not circular require)
    if (req.app.io) {
      req.app.io.to(`user_${targetUserId}`).emit('new_match', {
        userId: userId,
        matchId: matchId,
        message: 'Someone wants to chat with you!'
      });
    }

    res.json({ matchId, success: true });
  } catch (error) {
    console.error('Direct match error:', error);
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

    // Check for reverse swipe (match) OR shared interests for automatic match
    let isMatch = false;
    if (direction === 'like' || direction === 'super_like') {
      const [reverseSwipes] = await pool.query(
        "SELECT id FROM swipes WHERE swiper_id = ? AND swiped_id = ? AND direction IN ('like', 'super_like')",
        [targetUserId, userId]
      );

      if (reverseSwipes.length > 0) {
        isMatch = true;
      } else {
        // Check for shared interests
        const [users] = await pool.query(
          'SELECT interests FROM users WHERE id IN (?, ?)',
          [userId, targetUserId]
        );
        
        if (users.length === 2) {
          try {
            const int1 = JSON.parse(users[0].interests || '[]');
            const int2 = JSON.parse(users[1].interests || '[]');
            const shared = int1.filter(i => int2.includes(i));
            if (shared.length > 0) {
              isMatch = true;
              logger.info(`Automatic interest match: ${userId} <-> ${targetUserId} (Shared: ${shared.join(', ')})`);
            }
          } catch (e) {
            logger.error('Error parsing interests for auto-match:', e);
          }
        }
      }
    }

    // Insert swipe with handling for duplicates to avoid annoying alerts
    const [swipeResult] = await pool.query(
      `INSERT INTO swipes (swiper_id, swiped_id, direction, is_match) 
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE direction = VALUES(direction), is_match = VALUES(is_match)`,
      [userId, targetUserId, direction, isMatch]
    );

    const swipeId = swipeResult.insertId;

    // If match, create match record
    if (isMatch) {
      const [reverseSwipes] = await pool.query(
        'SELECT id FROM swipes WHERE swiper_id = ? AND swiped_id = ?',
        [targetUserId, userId]
      );

      const user1Id = userId < targetUserId ? userId : targetUserId;
      const user2Id = userId < targetUserId ? targetUserId : userId;
      const swipe1Id = userId < targetUserId ? swipeId : (reverseSwipes[0]?.id || null);
      const swipe2Id = userId < targetUserId ? (reverseSwipes[0]?.id || null) : swipeId;

      await pool.query(
        'INSERT IGNORE INTO matches (user1_id, user2_id, swipe1_id, swipe2_id) VALUES (?, ?, ?, ?)',
        [user1Id, user2Id, swipe1Id, swipe2Id]
      );

      // Create notifications
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, body, data)
         VALUES (?, 'match', 'New Match!', 'You have a new match!', ?)`,
        [targetUserId, JSON.stringify({ matchUserId: userId })],
      );

      // Emit socket event to BOTH users
      if (req.app.io) {
        // To target
        req.app.io.to(`user_${targetUserId}`).emit('new_match', {
          userId: userId,
          matchId: user1Id < user2Id ? user1Id : user2Id, // Fallback placeholder if id fetch below fails
          message: 'You have a new match!'
        });
        // To self
        req.app.io.to(`user_${userId}`).emit('new_match', {
          userId: targetUserId,
          message: 'It\'s a match!'
        });
      }
    } else if (direction === 'like') {
      // Notify about a new like (not yet a match)
      if (req.app.io) {
        req.app.io.to(`user_${targetUserId}`).emit('new_like', {
          fromUserId: userId,
          message: 'Someone liked your profile!'
        });
      }
    }

      logger.info(`New match created: ${userId} <-> ${targetUserId}`);

      // Emit global event for admin dashboard
      try {
        if (req.app.io) {
          req.app.io.emit('stats_update', { type: 'new_match' });
        }
      } catch (e) {}

      // Get the actual match ID for the response
      let createdMatchId = null;
      try {
        const [matchRow] = await pool.query(
          'SELECT id FROM matches WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?) LIMIT 1',
          [userId, targetUserId, targetUserId, userId]
        );
        createdMatchId = matchRow[0]?.id || null;
      } catch(e) {}

      res.json({
        success: true,
        isMatch,
        direction,
        matchedUser: isMatch ? {
          id: targetUserId,
          matchId: createdMatchId,
          firstName: (await pool.query('SELECT first_name FROM users WHERE id = ?', [targetUserId]))[0][0]?.first_name || 'User'
        } : null
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
        u.first_name, u.last_name, u.profile_photo_url, u.last_active, u.university, u.course, u.year_of_study,
        u.bio, u.interests, u.gender, u.verification_status,
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

    // Parse and decrypt
    const parsedMatches = matches.map(m => {
      // Decrypt last_message
      if (m.last_message && m.last_message !== '[Image]') {
        m.last_message = decryptMessage(m.last_message);
      }

      // Ensure ISO dates
      if (m.matched_at) m.matched_at = new Date(m.matched_at).toISOString();
      if (m.last_message_at) m.last_message_at = new Date(m.last_message_at).toISOString();
      if (m.last_active) m.last_active = new Date(m.last_active).toISOString();

      if (m.interests && typeof m.interests === 'string') {
        try {
          m.interests = JSON.parse(m.interests);
        } catch (e) {
          m.interests = [];
        }
      }
      m.id = m.other_user_id;
      m.userId = m.other_user_id;
      return m;
    });

    res.json({ matches: parsedMatches });
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

exports.markLikesAsSeen = async (req, res, next) => {
  try {
    const userId = req.user.id;
    await pool.query('UPDATE users SET last_likes_check_at = NOW() WHERE id = ?', [userId]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

exports.getWhoLikedMe = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const isFree = req.user.subscription_tier === 'free';

    // Get last check time
    const [user] = await pool.query('SELECT last_likes_check_at FROM users WHERE id = ?', [userId]);
    const lastCheck = user[0]?.last_likes_check_at || '1970-01-01 00:00:00';

    // Fetch all likers
    const [likers] = await pool.query(
      `SELECT u.id, u.id as userId, u.first_name, u.profile_photo_url, u.university, u.bio, u.course, u.year_of_study, u.interests,
              s.created_at as liked_at,
              CASE WHEN s.created_at > ? THEN 1 ELSE 0 END as is_new
       FROM swipes s
       JOIN users u ON s.swiper_id = u.id
       WHERE s.swiped_id = ? AND s.direction = 'like'
       ORDER BY s.created_at DESC`,
      [lastCheck, userId]
    );

    likers.forEach(l => {
        if (l.liked_at) l.liked_at = new Date(l.liked_at).toISOString();
    });

    // Calculate count of NEW likes (specifically for the badge)
    const newLikes = likers.filter(l => l.is_new).length;

    res.json({
      users: likers,
      count: likers.length,
      newCount: newLikes,
      blurred: isFree
    });
  } catch (error) {
    next(error);
  }
};

exports.getMatchById = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { matchId } = req.params;

    const [matches] = await pool.query(
      `SELECT 
        m.id as match_id,
        CASE 
          WHEN m.user1_id = ? THEN m.user2_id 
          ELSE m.user1_id 
        END as other_user_id,
        u.first_name, u.last_name, u.profile_photo_url, u.last_active, u.university, u.course, u.year_of_study,
        u.bio, u.interests, u.gender, u.verification_status,
        m.created_at as matched_at
       FROM matches m
       JOIN users u ON u.id = CASE WHEN m.user1_id = ? THEN m.user2_id ELSE m.user1_id END
       WHERE m.id = ? AND (m.user1_id = ? OR m.user2_id = ?) AND m.is_active = TRUE`,
      [userId, userId, matchId, userId, userId]
    );

    if (matches.length === 0) {
      return res.status(404).json({ message: 'Match not found or inactive' });
    }

    const match = matches[0];
    // Parse interests if it's a JSON string
    if (match.interests && typeof match.interests === 'string') {
      try {
        match.interests = JSON.parse(match.interests);
      } catch (e) {
        match.interests = [];
      }
    }

    match.id = match.other_user_id;
    match.userId = match.other_user_id;

    res.json(match);
  } catch (error) {
    next(error);
  }
};

exports.getLikedUserIds = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [likes] = await pool.query(
      "SELECT swiped_id FROM swipes WHERE swiper_id = ? AND direction IN ('like', 'super_like')",
      [userId]
    );
    res.json({ ids: likes.map(l => l.swiped_id) });
  } catch (error) {
    next(error);
  }
};