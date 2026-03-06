const { pool } = require('../config/database');
const CryptoJS = require('crypto-js');
const logger = require('../utils/logger');

const ENCRYPTION_KEY = process.env.MESSAGE_ENCRYPTION_KEY || 'default-key-32-chars-long!!!!!'; // Must be 32 chars

const encryptMessage = (text) => {
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
};

const decryptMessage = (ciphertext) => {
  const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
};

exports.getMessages = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { matchId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    // Verify user is part of this match
    const { rows: matchCheck } = await pool.query(
      'SELECT * FROM matches WHERE id = $1 AND (user1_id = $2 OR user2_id = $3) AND is_active = TRUE',
      [matchId, userId, userId]
    );

    if (matchCheck.length === 0) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { rows: messages } = await pool.query(
      `SELECT m.id, m.sender_id, m.message_type, m.content, m.media_url,
              m.is_read, m.read_at, m.created_at, u.first_name, u.profile_photo_url
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.match_id = $1 AND m.is_deleted = FALSE
       ORDER BY m.created_at DESC
       LIMIT $2 OFFSET $3`,
      [matchId, parseInt(limit), parseInt(offset)]
    );

    // Decrypt messages
    const decryptedMessages = messages.map(msg => ({
      ...msg,
      content: msg.content ? decryptMessage(msg.content) : null
    })).reverse();

    // Mark messages as read
    await pool.query(
      `UPDATE messages SET is_read = TRUE, read_at = NOW() 
       WHERE match_id = $1 AND sender_id != $2 AND is_read = FALSE`,
      [matchId, userId]
    );

    res.json({ messages: decryptedMessages });
  } catch (error) {
    next(error);
  }
};

exports.sendMessage = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { matchId } = req.params;
    const { content, messageType = 'text' } = req.body;

    // Verify match exists and user is part of it
    const { rows: matchCheck } = await pool.query(
      'SELECT * FROM matches WHERE id = $1 AND (user1_id = $2 OR user2_id = $3) AND is_active = TRUE',
      [matchId, userId, userId]
    );

    if (matchCheck.length === 0) {
      return res.status(403).json({ message: 'Match not found or inactive' });
    }

    // Check if blocked
    const otherUserId = matchCheck[0].user1_id === userId ? matchCheck[0].user2_id : matchCheck[0].user1_id;
    const { rows: blocks } = await pool.query(
      'SELECT * FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $3 AND blocked_id = $4)',
      [userId, otherUserId, otherUserId, userId]
    );

    if (blocks.length > 0) {
      return res.status(403).json({ message: 'Cannot send message - user blocked' });
    }

    // Encrypt content
    const encryptedContent = encryptMessage(content);

    const { rows: result } = await pool.query(
      `INSERT INTO messages (match_id, sender_id, message_type, content, encrypted_payload)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [matchId, userId, messageType, encryptedContent, encryptedContent]
    );

    const messageId = result[0].id;

    // Create notification
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES ($1, 'message', 'New Message', $2, $3)`,
      [otherUserId, 'You have a new message', JSON.stringify({ matchId, senderId: userId })]
    );

    // Emit socket event
    const { io } = require('../server');
    io.to(`user_${otherUserId}`).emit('new_message', {
      matchId,
      message: {
        id: messageId,
        senderId: userId,
        content,
        messageType,
        createdAt: new Date()
      }
    });

    res.status(201).json({
      message: 'Message sent',
      messageId,
      content
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteMessage = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;

    const { rows: messages } = await pool.query(
      'SELECT * FROM messages WHERE id = $1 AND sender_id = $2',
      [messageId, userId]
    );

    if (messages.length === 0) {
      return res.status(404).json({ message: 'Message not found' });
    }

    await pool.query(
      'UPDATE messages SET is_deleted = TRUE, deleted_at = NOW() WHERE id = $1',
      [messageId]
    );

    res.json({ message: 'Message deleted' });
  } catch (error) {
    next(error);
  }
};

exports.getIcebreakers = async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const userId = req.user.id;

    const { rows: prompts } = await pool.query(
      `SELECT * FROM icebreaker_prompts 
       WHERE is_active = TRUE 
       ORDER BY RANDOM() LIMIT 5`
    );

    res.json({ icebreakers: prompts });
  } catch (error) {
    next(error);
  }
};