const { pool } = require('../config/database');
const logger = require('../utils/logger');

exports.getProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [users] = await pool.query(
      `SELECT id, email, first_name, last_name, date_of_birth, gender, pronouns,
              bio, university, course, year_of_study, profile_photo_url, photos,
              interests, location_lat, location_lng, city, subscription_tier,
              verification_status, preferred_age_min, preferred_age_max, preferred_gender,
              preferred_distance_km, language_preference, is_admin, is_super_admin, created_at,
              (SELECT COUNT(*) FROM matches WHERE user1_id=id OR user2_id=id) as match_count,
              (SELECT COUNT(*) FROM messages WHERE sender_id=id) as message_count
       FROM users
       WHERE id = ?`,
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ user: users[0] });
  } catch (error) {
    next(error);
  }
};

exports.getUserProfile = async (req, res, next) => {
  try {
    const userId = req.params.id;

    const [users] = await pool.query(
      `SELECT id, first_name, last_name, date_of_birth, gender, pronouns,
              bio, university, course, year_of_study, profile_photo_url, photos,
              interests, subscription_tier, verification_status, created_at,
              (SELECT COUNT(*) FROM matches WHERE user1_id=id OR user2_id=id) as match_count
       FROM users
       WHERE id = ?`,
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ user: users[0] });
  } catch (error) {
    next(error);
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const updates = req.body;

    const allowedFields = [
      'first_name', 'last_name', 'bio', 'pronouns', 'course', 'year_of_study',
      'university', 'photos', 'interests', 'location_lat', 'location_lng', 'city',
      'preferred_age_min', 'preferred_age_max', 'preferred_gender',
      'preferred_distance_km', 'language_preference', 'show_me'
    ];

    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        values.push(typeof value === 'object' ? JSON.stringify(value) : value);
        fields.push(`${key} = ?`);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    values.push(userId);

    await pool.query(
      `UPDATE users SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );

    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    next(error);
  }
};

exports.uploadPhoto = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const file = req.file;
    const isProfilePhoto = req.query.profile === 'true';

    if (!file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const cloudinary = require('../config/cloudinary');
    const [users] = await pool.query('SELECT photos, profile_photo_url FROM users WHERE id = ?', [userId]);
    let photos = users[0].photos ? (typeof users[0].photos === 'string' ? JSON.parse(users[0].photos) : users[0].photos) : [];
    let profilePhotoUrl = users[0].profile_photo_url;

    // Clean up photos array - ensure it's always an array
    if (!Array.isArray(photos)) {
      photos = [];
    }

    if (isProfilePhoto) {
      // PROFILE PHOTO: Overwrite the existing profile photo
      const oldProfileUrl = profilePhotoUrl;
      
      const result = await cloudinary.uploader.upload(file.path, {
        folder: 'campus-connect/profiles'
      });
      
      // Delete old profile photo from Cloudinary
      if (oldProfileUrl) {
        try {
          const publicId = oldProfileUrl.split('/').pop().split('.')[0];
          await cloudinary.uploader.destroy(`campus-connect/profiles/${publicId}`);
        } catch (err) {
          logger.error(`Failed to delete old profile photo: ${err.message}`);
        }
      }
      
      profilePhotoUrl = result.secure_url;
      
      // Update existing primary in photos array or add new
      const primaryIndex = photos.findIndex(p => p.is_primary);
      if (primaryIndex !== -1) {
        photos[primaryIndex] = { url: result.secure_url, public_id: result.public_id, is_primary: true };
      } else {
        photos.push({ url: result.secure_url, public_id: result.public_id, is_primary: true });
      }
    } else {
      // ADDITIONAL PHOTOS: Limit to 10, reset if exceeded
      const nonPrimaryPhotos = photos.filter(p => !p.is_primary);
      
      if (nonPrimaryPhotos.length >= 10) {
        // Delete all non-primary photos from Cloudinary
        for (const photo of nonPrimaryPhotos) {
          if (photo.public_id) {
            try {
              await cloudinary.uploader.destroy(photo.public_id);
            } catch (err) {
              logger.error(`Failed to delete photo: ${err.message}`);
            }
          }
        }
        // Keep only profile photo
        photos = photos.filter(p => p.is_primary);
        logger.info(`User ${userId} reset additional photos after reaching limit`);
      }
      
      const result = await cloudinary.uploader.upload(file.path, {
        folder: 'campus-connect/profiles'
      });
      
      photos.push({
        url: result.secure_url,
        public_id: result.public_id,
        is_primary: false
      });
    }

    // Remove the file from tmp/uploads after upload
    const fs = require('fs');
    try { fs.unlinkSync(file.path); } catch(e) { }

    await pool.query(
      'UPDATE users SET photos = ?, profile_photo_url = ? WHERE id = ?',
      [JSON.stringify(photos), profilePhotoUrl, userId]
    );

    res.json({
      message: isProfilePhoto ? 'Profile photo updated' : 'Photo uploaded',
      photoCount: photos.filter(p => !p.is_primary).length,
      maxPhotos: 10,
      photo: photos[photos.length - 1]
    });
  } catch (error) {
    next(error);
  }
};

exports.getPotentialMatches = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 30 } = req.query;
    const offset = (page - 1) * limit;

    // Get user preferences
    const [users] = await pool.query(
      `SELECT preferred_age_min, preferred_age_max, preferred_gender, university, interests
       FROM users WHERE id = ?`,
      [userId]
    );
    const user = users[0];

    // Check/reset swipe limits
    const [swipeCheck] = await pool.query(
      `SELECT daily_swipes_used, daily_swipes_reset_at, subscription_tier FROM users WHERE id = ?`,
      [userId]
    );
    const swipeData = swipeCheck[0];
    const isFreeTier = swipeData.subscription_tier === 'free';
    const lastReset = new Date(swipeData.daily_swipes_reset_at || 0);
    const now = new Date();
    if (lastReset.getDate() !== now.getDate() || lastReset.getMonth() !== now.getMonth()) {
      await pool.query(
        'UPDATE users SET daily_swipes_used = 0, daily_swipes_reset_at = NOW() WHERE id = ?',
        [userId]
      );
    }

    // ─── Single Unified Query: Priority to unseen, then recycle everything else ───
    // This removes the need for a separate fallback query and ensures a continuous loop.
    let query = `
      SELECT u.id, u.first_name, u.last_name, u.date_of_birth, u.gender,
             u.bio, u.university, u.course, u.year_of_study, u.profile_photo_url,
             u.photos, u.interests, u.verification_status, u.subscription_tier,
             0 AS distance,
             CASE WHEN s.id IS NULL THEN 0 ELSE 1 END AS already_seen
      FROM users u
      LEFT JOIN swipes s ON s.swiper_id = ? AND s.swiped_id = u.id
      WHERE u.id != ?
        AND u.is_active = TRUE
        AND u.is_banned = FALSE
        AND u.show_me = TRUE
    `;
    let params = [userId, userId];

    // Optional gender preference filter
    if (user.preferred_gender) {
      try {
        const genders = typeof user.preferred_gender === 'string'
          ? JSON.parse(user.preferred_gender || '[]')
          : (user.preferred_gender || []);
        if (Array.isArray(genders) && genders.length > 0) {
          const gPlaceholders = genders.map(() => '?').join(',');
          query += ` AND u.gender IN (${gPlaceholders})`;
          params.push(...genders);
        }
      } catch { }
    }

    // Optional age filters
    if (user.preferred_age_min) {
      query += ` AND TIMESTAMPDIFF(YEAR, u.date_of_birth, CURDATE()) >= ?`;
      params.push(user.preferred_age_min);
    }
    if (user.preferred_age_max) {
      query += ` AND TIMESTAMPDIFF(YEAR, u.date_of_birth, CURDATE()) <= ?`;
      params.push(user.preferred_age_max);
    }

    // ORDER: Unseen people first, then newer people, then active people
    query += ` ORDER BY already_seen ASC, u.created_at DESC, u.last_active DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    let [potentialMatches] = await pool.query(query, params);

    // Compatibility score
    let userInterests = [];
    try { userInterests = typeof user.interests === 'string' ? JSON.parse(user.interests) : (user.interests || []); } catch { }

    const matchesWithScores = potentialMatches.map(m => {
      let mInterests = [];
      try { mInterests = typeof m.interests === 'string' ? JSON.parse(m.interests) : (m.interests || []); } catch { }
      const shared = userInterests.filter(i => mInterests.includes(i));
      const score = userInterests.length > 0 ? Math.round((shared.length / userInterests.length) * 60 + 20) : 70;
      return { ...m, compatibility: Math.min(score, 99) };
    });

    res.json({
      matches: matchesWithScores,
      swipeLimit: {
        used: isFreeTier ? swipeData.daily_swipes_used : 0,
        limit: isFreeTier ? 50 : Infinity,
        remaining: isFreeTier ? Math.max(0, 50 - swipeData.daily_swipes_used) : Infinity
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.updateSettings = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const updates = req.body;

    const allowedFields = [
      'email_notifications', 'push_notifications', 'match_notifications',
      'message_notifications', 'show_online_status', 'show_last_active',
      'profile_visibility', 'distance_unit'
    ];

    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        values.push(value);
        fields.push(`${key} = ?`);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    values.push(userId);

    await pool.query(
      `UPDATE users SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );

    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    next(error);
  }
};

exports.markPulseSeen = async (req, res, next) => {
  try {
    const userId = req.user.id;
    await pool.query('UPDATE users SET last_pulse_check_at = NOW() WHERE id = ?', [userId]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

exports.getNotificationCount = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Unread messages from matches
    const [msgCount] = await pool.query(
      'SELECT COUNT(*) as count FROM messages m JOIN matches ma ON m.match_id = ma.id WHERE (ma.user1_id = ? OR ma.user2_id = ?) AND ma.is_active = TRUE AND m.sender_id != ? AND m.is_read = FALSE',
      [userId, userId, userId]
    );

    // Unread messages from connections
    const [connMsgCount] = await pool.query(
      'SELECT COUNT(*) as count FROM connection_messages cm JOIN connections c ON cm.connection_id = c.id WHERE (c.user1_id = ? OR c.user2_id = ?) AND cm.sender_id != ? AND cm.is_read = FALSE',
      [userId, userId, userId]
    );

    // New likes (people who liked me but I haven't liked back AND since last check)
    const [likesCount] = await pool.query(
      `SELECT COUNT(*) as count FROM swipes 
       WHERE swiped_id = ? AND direction = 'like'
       AND swiper_id NOT IN (SELECT swiped_id FROM swipes WHERE swiper_id = ?)
       AND created_at > (SELECT COALESCE(last_likes_check_at, '1970-01-01 00:00:00') FROM users WHERE id = ?)`,
      [userId, userId, userId]
    );

    // Pending match requests (received)
    let reqCount = [{ count: 0 }];
    try {
      [reqCount] = await pool.query(
        'SELECT COUNT(*) as count FROM match_requests WHERE to_user_id = ? AND status = "pending"',
        [userId]
      );
    } catch(e) {}

    // Unseen pulse posts (posts created after user's last pulse check)
    let pulseCount = [{ count: 0 }];
    try {
      [pulseCount] = await pool.query(
        `SELECT COUNT(*) as count FROM posts 
         WHERE user_id != ? 
         AND created_at > (SELECT COALESCE(last_pulse_check_at, created_at) FROM users WHERE id = ?)`,
        [userId, userId]
      );
    } catch(e) {}

    const totalMessages = msgCount[0].count + connMsgCount[0].count;
    const totalRequests = reqCount[0].count;

    res.json({
      total: totalMessages + likesCount[0].count + totalRequests,
      messages: totalMessages,
      likes: likesCount[0].count,
      requests: totalRequests,
      pulse: pulseCount[0].count  // Unseen vibes on Pulse
    });
  } catch (error) {
    next(error);
  }
};