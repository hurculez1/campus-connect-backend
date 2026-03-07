const { pool } = require('../config/database');

exports.getPosts = async (req, res, next) => {
  try {
    // Ensure table exists safely immediately upon first loading Pulse
    await pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          content TEXT,
          campus VARCHAR(200),
          is_anonymous BOOLEAN DEFAULT FALSE,
          type VARCHAR(20) DEFAULT 'general',
          likes_count INT DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          comments_count INT DEFAULT 0
      )
    `);

    const { campus, tab } = req.query;
    const params = [];

    let conditions = '';

    if (campus && campus !== 'All Campuses') {
      params.push(campus);
      conditions += ` AND p.campus = $${params.length}`;
    }

    if (tab === 'Confessions') {
      conditions += ` AND p.is_anonymous = TRUE`;
    }

    const orderBy = tab === 'Trending' ? 'p.likes_count DESC' : 'p.created_at DESC';

    const { rows: posts } = await pool.query(`
      SELECT p.*, u.first_name, u.profile_photo_url, u.university as user_campus
      FROM posts p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE 1=1 ${conditions}
      ORDER BY ${orderBy}
    `, params);

    res.json({ posts });
  } catch (error) {
    next(error);
  }
};

exports.createPost = async (req, res, next) => {
  try {
    const { content, campus, isAnonymous, type } = req.body;
    const userId = req.user.id;

    const { rows: result } = await pool.query(
      `INSERT INTO posts (user_id, content, campus, is_anonymous, type) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, content, campus, isAnonymous, type || 'general']
    );

    res.status(201).json({
      message: 'Post created',
      postId: result[0].id
    });
  } catch (error) {
    next(error);
  }
};

exports.likePost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    await pool.query(
      'UPDATE posts SET likes_count = likes_count + 1 WHERE id = $1',
      [postId]
    );
    res.json({ message: 'Post liked' });
  } catch (error) {
    next(error);
  }
};
