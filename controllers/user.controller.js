const { pool } = require('../config/database');
const logger = require('../utils/logger');

exports.getProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { rows: users } = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.date_of_birth, u.gender, u.pronouns,
              u.bio, u.university, u.course, u.year_of_study, u.profile_photo_url, u.photos,
              u.interests, u.location_lat, u.location_lng, u.city, u.subscription_tier,
              u.verification_status, u.preferred_age_min, u.preferred_age_max, u.preferred_gender,
              u.preferred_distance_km, u.language_preference, u.created_at,
              us.email_notifications, us.push_notifications, us.profile_visibility
       FROM users u
       LEFT JOIN user_settings us ON u.id = us.user_id
       WHERE u.id = $1`,
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
        fields.push(`${key} = $${values.length}`);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    values.push(userId);

    await pool.query(
      `UPDATE users SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`,
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

    // Upload to Cloudinary
    const cloudinary = require('../config/cloudinary');
    const result = await cloudinary.uploader.upload(file.path, {
      folder: 'campus-connect/photos',
      transformation: [{ width: 800, height: 800, crop: 'limit' }]
    });

    // Get current photos
    const { rows: users } = await pool.query(
      'SELECT photos FROM users WHERE id = $1',
      [userId]
    );

    let photos = users[0].photos ? (typeof users[0].photos === 'string' ? JSON.parse(users[0].photos) : users[0].photos) : [];

    if (photos.length >= 10) {
      return res.status(400).json({ message: 'Maximum 10 photos allowed' });
    }

    photos.push({
      url: result.secure_url,
      public_id: result.public_id,
      is_primary: photos.length === 0
    });

    // Update profile photo if first photo
    const updateFields = ['photos = $1'];
    const updateValues = [JSON.stringify(photos)];

    if (photos.length === 1) {
      updateFields.push(`profile_photo_url = $${updateValues.length + 1}`);
      updateValues.push(result.secure_url);
    }

    updateValues.push(userId);

    await pool.query(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = $${updateValues.length}`,
      updateValues
    );

    res.json({
      message: 'Photo uploaded successfully',
      photo: {
        url: result.secure_url,
        public_id: result.public_id
      }
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
    const { rows: users } = await pool.query(
      `SELECT preferred_age_min, preferred_age_max, preferred_gender, 
              preferred_distance_km, university, location_lat, location_lng
       FROM users WHERE id = $1`,
      [userId]
    );

    const user = users[0];

    // Check swipe limits for free tier
    const { rows: swipeCheck } = await pool.query(
      `SELECT daily_swipes_used, daily_swipes_reset_at, subscription_tier
       FROM users WHERE id = $1`,
      [userId]
    );

    const swipeData = swipeCheck[0];
    const isFreeTier = swipeData.subscription_tier === 'free';

    // Reset daily swipes if needed
    const lastReset = new Date(swipeData.daily_swipes_reset_at);
    const now = new Date();
    if (lastReset.getDate() !== now.getDate() || lastReset.getMonth() !== now.getMonth()) {
      await pool.query(
        'UPDATE users SET daily_swipes_used = 0, daily_swipes_reset_at = NOW() WHERE id = $1',
        [userId]
      );
    }

    // Get users already swiped
    const { rows: swipedUsers } = await pool.query(
      'SELECT swiped_id FROM swipes WHERE swiper_id = $1',
      [userId]
    );
    const swipedIds = swipedUsers.map(s => s.swiped_id);
    swipedIds.push(userId); // Exclude self

    // Build query with positional params
    const params = [user.location_lat, user.location_lng, user.location_lat];

    let excludeClause;
    if (swipedIds.length > 0) {
      swipedIds.forEach(id => params.push(id));
      const placeholders = swipedIds.map((_, i) => `$${3 + i + 1}`).join(',');
      excludeClause = `u.id NOT IN (${placeholders})`;
    } else {
      excludeClause = 'TRUE';
    }

    let query = `
      SELECT u.id, u.first_name, u.last_name, u.date_of_birth, u.gender,
             u.bio, u.university, u.course, u.year_of_study, u.profile_photo_url,
             u.photos, u.interests, u.verification_status,
             (6371 * acos(cos(radians($1)) * cos(radians(u.location_lat)) * 
              cos(radians(u.location_lng) - radians($2)) + sin(radians($1)) * sin(radians(u.location_lat))))
             AS distance
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
        genders.forEach(g => params.push(g));
        const gPlaceholders = genders.map((_, i) => `$${params.length - genders.length + i + 1}`).join(',');
        query += ` AND u.gender IN (${gPlaceholders})`;
      }
    }

    if (user.preferred_age_min) {
      params.push(user.preferred_age_min);
      query += ` AND DATE_PART('year', AGE(CURRENT_DATE, u.date_of_birth)) >= $${params.length}`;
    }

    if (user.preferred_age_max) {
      params.push(user.preferred_age_max);
      query += ` AND DATE_PART('year', AGE(CURRENT_DATE, u.date_of_birth)) <= $${params.length}`;
    }

    if (user.preferred_distance_km) {
      params.push(user.preferred_distance_km);
      query += ` HAVING distance <= $${params.length}`;
    }

    params.push(parseInt(limit), parseInt(offset));
    query += ` ORDER BY u.last_active DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { rows: potentialMatches } = await pool.query(query, params);

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
      score += Math.random() * 10;

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
        fields.push(`${key} = $${values.length}`);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    values.push(userId);

    await pool.query(
      `UPDATE user_settings SET ${fields.join(', ')}, updated_at = NOW() WHERE user_id = $${values.length}`,
      values
    );

    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    next(error);
  }
};