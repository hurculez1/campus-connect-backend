const { pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

exports.getPosts = async (req, res, next) => {
  try {
    const { campus, tab } = req.query;
    const params = [];

    let conditions = '';

    if (campus && campus !== 'All Campuses') {
      params.push(campus);
      conditions += ' AND p.campus = ?';
    }

    if (tab === 'Confessions') {
      conditions += ' AND p.is_anonymous = TRUE';
    }

    const orderBy = tab === 'Trending' ? 'p.likes_count DESC' : 'p.created_at DESC';

    const [posts] = await pool.query(`
      SELECT p.*, u.first_name, u.profile_photo_url, u.university as user_campus
      FROM posts p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE 1=1 ${conditions}
      ORDER BY ${orderBy}
      LIMIT 100
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
    const postId = uuidv4();

    await pool.query(
      `INSERT INTO posts (id, user_id, content, campus, is_anonymous, type)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [postId, userId, content, campus, isAnonymous ? 1 : 0, type || 'general']
    );

    // Emit socket event for admin real-time update
    try {
      const { io } = require('../server');
      if (io) {
        io.emit('new_pulse_post', { postId, userId, campus, content });
      }
    } catch (e) {}

    res.status(201).json({
      message: 'Post created',
      postId
    });
  } catch (error) {
    next(error);
  }
};

exports.likePost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    await pool.query(
      'UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?',
      [postId]
    );
    res.json({ message: 'Post liked' });
  } catch (error) {
    next(error);
  }
};

exports.getCampuses = async (req, res, next) => {
  try {
    const [campuses] = await pool.query(`
      SELECT campus, COUNT(*) as post_count 
      FROM posts 
      WHERE campus IS NOT NULL AND campus != '' 
      GROUP BY campus 
      ORDER BY post_count DESC
    `);
    
    // Always include a few defaults if database is empty to ensure UI doesn't break
    const defaultCampuses = ['Makerere', 'MUBS', 'Kyambogo', 'UCU', 'MUST', 'KIU'];
    let result = campuses.map(c => c.campus);
    
    // Merge defaults to the end if they aren't already included
    defaultCampuses.forEach(dc => {
      if (!result.includes(dc)) result.push(dc);
    });

    res.json({ campuses: result });
  } catch (error) {
    next(error);
  }
};
