const { pool } = require('../config/database');

exports.getUniversities = async (req, res, next) => {
  try {
    const [universities] = await pool.query(
      'SELECT * FROM universities WHERE is_active = TRUE ORDER BY name'
    );

    res.json({ universities });
  } catch (error) {
    next(error);
  } 
};

exports.verifyStudentEmail = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { studentEmail } = req.body;

    // Validate email domain
    const [users] = await pool.query(
      'SELECT university FROM users WHERE id = ?',
      [userId]
    );

    const user = users[0];

    const [universities] = await pool.query(
      'SELECT student_email_domain FROM universities WHERE name = ?',
      [user.university]
    );

    if (universities.length === 0) {
      return res.status(400).json({ message: 'University not found' });
    }

    const domain = universities[0].student_email_domain;

    if (!studentEmail.endsWith(`@${domain}`)) {
      return res.status(400).json({
        message: `Email must be from ${domain} domain`,
        expectedDomain: domain
      });
    }

    // Create or update verification record
    const token = require('crypto').randomBytes(32).toString('hex');

    await pool.query(
      `INSERT INTO university_verifications (user_id, university_name, student_email, student_email_token, verification_method)
       VALUES (?, ?, ?, ?, 'email')
       ON CONFLICT (user_id) DO UPDATE 
       SET student_email = ?, student_email_token = ?, status = 'pending', student_email_verified = FALSE`,
      [userId, user.university, studentEmail, token]
    );

    // Send verification email
    const { sendVerificationEmail } = require('../services/email.service');
    await sendVerificationEmail(studentEmail, token, req.user.first_name);

    res.json({ message: 'Verification email sent' });
  } catch (error) {
    next(error);
  }
};

exports.uploadStudentId = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Upload to Cloudinary
    const cloudinary = require('../config/cloudinary');
    const result = await cloudinary.uploader.upload(file.path, {
      folder: 'campus-connect/verifications',
      resource_type: 'image'
    });

    // AI verification simulation
    const aiScore = Math.random() * 0.3 + 0.7; // Simulated score 0.7-1.0

    const [users] = await pool.query(
      'SELECT university FROM users WHERE id = ?',
      [userId]
    );

    const verificationStatus = aiScore > 0.8 ? 'verified' : 'pending';

    await pool.query(
      `INSERT INTO university_verifications 
       (user_id, university_name, student_id_image_url, ai_verification_score, verification_method, status)
       VALUES (?, ?, ?, ?, 'student_id', ?)
       ON CONFLICT (user_id) DO UPDATE
       SET student_id_image_url = ?, ai_verification_score = ?, status = ?`,
      [userId, users[0].university, result.secure_url, aiScore, verificationStatus]
    );

    // Auto-verify if high AI score
    if (aiScore > 0.8) {
      await pool.query(
        "UPDATE users SET verification_status = 'verified', student_id_verified = TRUE WHERE id = ?",
        [userId]
      );
    }

    res.json({
      message: 'Student ID uploaded',
      aiScore,
      verified: aiScore > 0.8
    });
  } catch (error) {
    next(error);
  }
};