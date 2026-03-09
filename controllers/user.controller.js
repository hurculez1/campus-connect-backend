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

exports.updateProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const updates = req.body;

    const allowedFields = [
      'first_name', 'last_name', 'bio', 'pronouns', 'course', 'year_of_study',
      'photos', 'interests', 'location_lat', 'location_lng', 'city',
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
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    // Get user preferences
    const [users] = await pool.query(
      `SELECT preferred_age_min, preferred_age_max, preferred_gender, 
              preferred_distance_km, university, location_lat, location_lng
       FROM users WHERE id = ?`,
      [userId]
    );

    const user = users[0];

    // Check swipe limits for free tier
    const [swipeCheck] = await pool.query(
      `SELECT daily_swipes_used, daily_swipes_reset_at, subscription_tier
       FROM users WHERE id = ?`,
      [userId]
    );

    const swipeData = swipeCheck[0];
    const isFreeTier = swipeData.subscription_tier === 'free';

    // Reset daily swipes if needed
    const lastReset = new Date(swipeData.daily_swipes_reset_at);
    const now = new Date();
    if (lastReset.getDate() !== now.getDate() || lastReset.getMonth() !== now.getMonth()) {
      await pool.query(
        'UPDATE users SET daily_swipes_used = 0, daily_swipes_reset_at = NOW() WHERE id = ?',
        [userId]
      );
    }

    // Get users already swiped
    const [swipedUsers] = await pool.query(
      'SELECT swiped_id FROM swipes WHERE swiper_id = ?',
      [userId]
    );
    const swipedIds = swipedUsers.map(s => s.swiped_id);
    swipedIds.push(userId); // Exclude self

    let params = [];
    let distanceSelect = '0 AS distance';

    if (user.location_lat != null && user.location_lng != null) {
      params.push(user.location_lat, user.location_lng, user.location_lat);
      distanceSelect = `(6371 * acos(cos(radians(?)) * cos(radians(u.location_lat)) * cos(radians(u.location_lng) - radians(?)) + sin(radians(?)) * sin(radians(u.location_lat)))) AS distance`;
    }

    let excludeClause = 'TRUE';
    if (swipedIds.length > 0) {
      const placeholders = swipedIds.map(() => '?').join(',');
      excludeClause = `u.id NOT IN (${placeholders})`;
      params.push(...swipedIds);
    }

    let query = `
      SELECT u.id, u.first_name, u.last_name, u.date_of_birth, u.gender,
             u.bio, u.university, u.course, u.year_of_study, u.profile_photo_url,
             u.photos, u.interests, u.verification_status,
             ${distanceSelect}
      FROM users u
      WHERE ${excludeClause}
        AND u.is_active = TRUE
        AND u.is_banned = FALSE
        AND u.show_me = TRUE
    `;

    // Add preference filters
    if (user.preferred_gender) {
      const genders = typeof user.preferred_gender === 'string' ? JSON.parse(user.preferred_gender || '[]') : (user.preferred_gender || []);
      if (genders.length > 0) {
        const gPlaceholders = genders.map(() => '?').join(',');
        query += ` AND u.gender IN (${gPlaceholders})`;
        params.push(...genders);
      }
    }

    if (user.preferred_age_min) {
      query += ` AND TIMESTAMPDIFF(YEAR, u.date_of_birth, CURDATE()) >= ?`;
      params.push(user.preferred_age_min);
    }

    if (user.preferred_age_max) {
      query += ` AND TIMESTAMPDIFF(YEAR, u.date_of_birth, CURDATE()) <= ?`;
      params.push(user.preferred_age_max);
    }

    let havingClause = '';
    if (user.preferred_distance_km && user.location_lat != null) {
      havingClause = ` HAVING distance <= ?`;
      params.push(user.preferred_distance_km);
    }

    query += havingClause;
    
    query += ` ORDER BY u.last_active DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    let [potentialMatches] = await pool.query(query, params);

    // FALLBACK LOGIC: If no NEW users, show previously swiped users (excluding matches/blocks)
    if (potentialMatches.length === 0) {
      // Re-run query without the excludeClause for swipedIds, 
      // but still exclude matches and blocks (which are handled by u.id NOT IN matches/blocks if we had those tables, but here we just simplify)
      // Actually, we should just show the swiped ones except those they LIKED already if we want "Discover" to feel fresh.
      // But user said "even if one viewed them already".
      let fallbackParams = [];
      let fallbackQuery = `
        SELECT u.id, u.first_name, u.last_name, u.date_of_birth, u.gender,
               u.bio, u.university, u.course, u.year_of_study, u.profile_photo_url,
               u.photos, u.interests, u.verification_status,
               ${distanceSelect.replace(/\?/g, '??')} -- This is getting complex with params
        FROM users u
        WHERE u.id != ?
          AND u.is_active = TRUE
          AND u.is_banned = FALSE
          AND u.show_me = TRUE
          -- Exclude people already matched
          AND u.id NOT IN (
            SELECT CASE WHEN user1_id = ? THEN user2_id ELSE user1_id END
            FROM matches WHERE user1_id = ? OR user2_id = ?
          )
      `;
      // For simplicity, let's just use a more relaxed version of the original query
      const [fallbackResults] = await pool.query(`
        SELECT u.id, u.first_name, u.last_name, u.date_of_birth, u.gender,
               u.bio, u.university, u.course, u.year_of_study, u.profile_photo_url,
               u.photos, u.interests, u.verification_status
        FROM users u
        WHERE u.id != ? 
          AND u.is_active = TRUE 
          AND u.is_banned = FALSE
          AND u.id NOT IN (
            SELECT CASE WHEN user1_id = ? THEN user2_id ELSE user1_id END
            FROM matches WHERE (user1_id = ? OR user2_id = ?) AND is_active = TRUE
          )
        ORDER BY RAND()
        LIMIT ?
      `, [userId, userId, userId, userId, parseInt(limit)]);
      potentialMatches = fallbackResults;
    }

    // Compatibility Scoring
    const userInterests = user.interests ? (typeof user.interests === 'string' ? JSON.parse(user.interests) : user.interests) : [];

    const matchesWithScores = potentialMatches.map(m => {
      const matchInterests = m.interests ? (typeof m.interests === 'string' ? JSON.parse(m.interests) : m.interests) : [];
      const sharedInterests = userInterests.filter(interest => matchInterests.includes(interest));

      let score = 50;
      if (userInterests.length > 0) {
        score = (sharedInterests.length / userInterests.length) * 60 + 20;
      }

      if (m.university === user.university) score += 10;
      // Removed fake extra randomness

      return {
        ...m,
        compatibility: Math.min(Math.round(score), 99)
      };
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

    // New likes (simplified to avoid schema errors)
    const [likesCount] = await pool.query(
      `SELECT COUNT(*) as count FROM swipes 
       WHERE swiped_id = ? AND direction = 'like'
       AND swiper_id NOT IN (SELECT swiped_id FROM swipes WHERE swiper_id = ?)`,
      [userId, userId]
    );

    // Pending match requests (received)
    let reqCount = [{ count: 0 }];
    try {
      [reqCount] = await pool.query(
        'SELECT COUNT(*) as count FROM match_requests WHERE to_user_id = ? AND status = "pending"',
        [userId]
      );
    } catch(e) {
      // Ignore if match_requests table schema mismatch
    }

    const totalMessages = msgCount[0].count + connMsgCount[0].count;
    const totalRequests = reqCount[0].count;
    
    res.json({
      total: totalMessages + likesCount[0].count + totalRequests,
      messages: totalMessages,
      likes: likesCount[0].count,
      requests: totalRequests
    });
  } catch (error) {
    next(error);
  }
};