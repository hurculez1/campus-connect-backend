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
              preferred_distance_km, language_preference, created_at,
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
      'preferred_distance_km', 'language_preference'
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

    if (!file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const apiUrl = process.env.API_URL || 'https://api.quickercarts.com';
    const photoUrl = `${apiUrl}/uploads/${file.filename}`;

    const [users] = await pool.query('SELECT photos FROM users WHERE id = ?', [userId]);

    let photos = users[0].photos ? (typeof users[0].photos === 'string' ? JSON.parse(users[0].photos) : users[0].photos) : [];

    if (photos.length >= 10) {
      return res.status(400).json({ message: 'Maximum 10 photos allowed' });
    }

    photos.push({
      url: photoUrl,
      public_id: file.filename,
      is_primary: photos.length === 0
    });

    const updateFields = ['photos = ?'];
    const updateValues = [JSON.stringify(photos)];

    if (photos.length === 1) {
      updateFields.push('profile_photo_url = ?');
      updateValues.push(photoUrl);
    }

    updateValues.push(userId);

    await pool.query(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    res.json({
      message: 'Photo uploaded successfully',
      photo: { url: photoUrl, public_id: file.filename }
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

    const [potentialMatches] = await pool.query(query, params);

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