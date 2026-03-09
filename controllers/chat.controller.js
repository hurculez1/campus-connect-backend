const { pool } = require('../config/database');
const CryptoJS = require('crypto-js');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

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
    const [matchCheck] = await pool.query(
      'SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?) AND is_active = TRUE',
      [matchId, userId, userId]
    );

    if (matchCheck.length === 0) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const [messages] = await pool.query(
      `SELECT m.id, m.sender_id, m.message_type, m.content, m.media_url,
              m.is_read, m.read_at, m.created_at, u.first_name, u.profile_photo_url
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.match_id = ? AND m.is_deleted = FALSE
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`,
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
       WHERE match_id = ? AND sender_id != ? AND is_read = FALSE`,
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
    const [matchCheck] = await pool.query(
      'SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?) AND is_active = TRUE',
      [matchId, userId, userId]
    );

    if (matchCheck.length === 0) {
      return res.status(403).json({ message: 'Match not found or inactive' });
    }

    // Check if blocked
    const otherUserId = matchCheck[0].user1_id === userId ? matchCheck[0].user2_id : matchCheck[0].user1_id;
    const [blocks] = await pool.query(
      'SELECT * FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
      [userId, otherUserId, otherUserId, userId]
    );

    if (blocks.length > 0) {
      return res.status(403).json({ message: 'Cannot send message - user blocked' });
    }

    // Encrypt content
    const encryptedContent = encryptMessage(content);

    const [result] = await pool.query(
      `INSERT INTO messages (match_id, sender_id, message_type, content, encrypted_payload)
       VALUES (?, ?, ?, ?, ?)`,
      [matchId, userId, messageType, encryptedContent, encryptedContent]
    );

    const messageId = result.insertId;

    // Create notification
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES (?, 'message', 'New Message', ?, ?)`,
      [otherUserId, 'You have a new message', JSON.stringify({ matchId, senderId: userId })]
    );

    // Emit socket event
    const server = require('../server');
    const io = server.io;
    if (io) {
      io.to(`match_${matchId}`).emit('new_message', {
        matchId,
        message: {
          id: messageId,
          senderId: userId,
          sender_id: userId,
          content,
          messageType,
          message_type: messageType,
          media_url: null,
          created_at: new Date(),
          is_read: false
        }
      });
    }

    res.status(201).json({
      message: 'Message sent',
      messageId,
      content,
      success: true
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteMessage = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;

    const [messages] = await pool.query(
      'SELECT * FROM messages WHERE id = ? AND sender_id = ?',
      [messageId, userId]
    );

    if (messages.length === 0) {
      return res.status(404).json({ message: 'Message not found' });
    }

    await pool.query(
      'UPDATE messages SET is_deleted = TRUE, deleted_at = NOW() WHERE id = ?',
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

    const [prompts] = await pool.query(
      `SELECT * FROM icebreaker_prompts 
       WHERE is_active = TRUE 
       ORDER BY RAND() LIMIT 5`
    );

    res.json({ icebreakers: prompts });
  } catch (error) {
    next(error);
  }
};

// ─── Connection Chat (for unmatched users) ───────────────────────────────────────

exports.startConnection = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { targetUserId } = req.body;

    if (!targetUserId) {
      return res.status(400).json({ message: 'Target user ID required' });
    }

    // First check if they are already matched
    const user1Id = userId < targetUserId ? userId : targetUserId;
    const user2Id = userId < targetUserId ? targetUserId : userId;
    const [match] = await pool.query(
      'SELECT id FROM matches WHERE user1_id = ? AND user2_id = ? AND is_active = TRUE',
      [user1Id, user2Id]
    );

    if (match.length > 0) {
       return res.json({ matchId: match[0].id, alreadyExists: true, type: 'match' });
    }

    // Then check if connection already exists
    const [existing] = await pool.query(
      `SELECT * FROM connections 
       WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)
       AND status = 'active'`,
      [userId, targetUserId, targetUserId, userId]
    );

    if (existing.length > 0) {
      return res.json({ connectionId: existing[0].id, alreadyExists: true, type: 'connection' });
    }

    // Create new connection
    const connectionId = uuidv4();
    await pool.query(
      `INSERT INTO connections (id, user1_id, user2_id, initiated_by) VALUES (?, ?, ?, ?)`,
      [connectionId, userId, targetUserId, userId]
    );

    // Create notification for target user
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES (?, 'message', 'New Message', 'Someone wants to chat with you!', ?)`,
      [targetUserId, JSON.stringify({ connectionId, fromUserId: userId })]
    );

    // Emit socket event
    const server = require('../server');
    const io = server.io;
    if (io) {
      io.to(`user_${targetUserId}`).emit('new_connection', {
        connectionId,
        fromUserId: userId,
        message: 'Someone wants to chat with you!'
      });
    }

    res.json({ connectionId, alreadyExists: false });
  } catch (error) {
    next(error);
  }
};

exports.getConnectionMessages = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { connectionId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    // Verify user is part of this connection
    const [connCheck] = await pool.query(
      'SELECT * FROM connections WHERE id = ? AND (user1_id = ? OR user2_id = ?) AND status = "active"',
      [connectionId, userId, userId]
    );

    if (connCheck.length === 0) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const connection = connCheck[0];

    const [messages] = await pool.query(
      `SELECT cm.*, u.first_name, u.profile_photo_url
       FROM connection_messages cm
       JOIN users u ON cm.sender_id = u.id
       WHERE cm.connection_id = ?
       ORDER BY cm.created_at DESC
       LIMIT ? OFFSET ?`,
      [connectionId, parseInt(limit), parseInt(offset)]
    );

    // Decrypt messages
    const decryptedMessages = messages.map(msg => ({
      ...msg,
      content: msg.content ? decryptMessage(msg.content) : null
    })).reverse();

    // Mark messages as read
    await pool.query(
      `UPDATE connection_messages SET is_read = TRUE, read_at = NOW() 
       WHERE connection_id = ? AND sender_id != ? AND is_read = FALSE`,
      [connectionId, userId]
    );

    // Get other user info
    const otherUserId = connection.user1_id === userId ? connection.user2_id : connection.user1_id;
    const [otherUser] = await pool.query(
      'SELECT id, first_name, last_name, profile_photo_url, university, course, year_of_study, bio, interests, gender, verification_status FROM users WHERE id = ?',
      [otherUserId]
    );

    if (otherUser[0]?.interests && typeof otherUser[0].interests === 'string') {
      try {
        otherUser[0].interests = JSON.parse(otherUser[0].interests);
      } catch (e) {
        otherUser[0].interests = [];
      }
    }

    res.json({ 
      messages: decryptedMessages, 
      connection: { ...connection, otherUser: otherUser[0] }
    });
  } catch (error) {
    next(error);
  }
};

exports.sendConnectionMessage = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { connectionId } = req.params;
    const { content, messageType = 'text' } = req.body;

    // Verify connection exists and user is part of it
    const [connCheck] = await pool.query(
      'SELECT * FROM connections WHERE id = ? AND (user1_id = ? OR user2_id = ?) AND status = "active"',
      [connectionId, userId, userId]
    );

    if (connCheck.length === 0) {
      return res.status(403).json({ message: 'Connection not found or inactive' });
    }

    const connection = connCheck[0];
    const otherUserId = connection.user1_id === userId ? connection.user2_id : connection.user1_id;

    // Encrypt content
    const encryptedContent = encryptMessage(content);

    const messageId = uuidv4();

    await pool.query(
      `INSERT INTO connection_messages (id, connection_id, sender_id, message_type, content)
       VALUES (?, ?, ?, ?, ?)`,
      [messageId, connectionId, userId, messageType, encryptedContent]
    );

    // Create notification
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES (?, 'message', 'New Message', ?, ?)`,
      [otherUserId, 'You have a new message', JSON.stringify({ connectionId, senderId: userId })]
    );

    // Emit socket event
    const server = require('../server');
    const io = server.io;
    if (io) {
      io.to(`connection_${connectionId}`).emit('new_connection_message', {
        connectionId,
        message: {
          id: messageId,
          senderId: userId,
          sender_id: userId,
          content,
          messageType,
          message_type: messageType,
          media_url: null,
          created_at: new Date(),
          is_read: false
        }
      });
    }

    res.status(201).json({
      message: 'Message sent',
      messageId,
      content
    });
  } catch (error) {
    next(error);
  }
};

exports.getMyConnections = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [connections] = await pool.query(
      `SELECT c.*, 
              u.id as other_user_id, u.first_name, u.last_name, u.profile_photo_url, u.university,
              (SELECT content FROM connection_messages WHERE connection_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
              (SELECT created_at FROM connection_messages WHERE connection_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
              (SELECT COUNT(*) FROM connection_messages WHERE connection_id = c.id AND sender_id != ? AND is_read = 0) as unread_count
       FROM connections c
       JOIN users u ON u.id = CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END
       WHERE (c.user1_id = ? OR c.user2_id = ?) AND c.status = 'active'
       ORDER BY last_message_at DESC, c.created_at DESC`,
      [userId, userId, userId, userId]
    );

    res.json({ connections });
  } catch (error) {
    next(error);
  }
};

// ─── Image Message Handling ─────────────────────────────────────────────────

exports.sendImageMessage = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { matchId } = req.params;
    const cloudinary = require('../config/cloudinary');

    if (!req.file) {
      return res.status(400).json({ message: 'No image uploaded' });
    }

    // Verify user is part of this match
    const [matchCheck] = await pool.query(
      'SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?) AND is_active = TRUE',
      [matchId, userId, userId]
    );

    if (matchCheck.length === 0) {
      return res.status(403).json({ message: 'Not authorized to send messages to this match' });
    }

    const otherUserId = matchCheck[0].user1_id === userId ? matchCheck[0].user2_id : matchCheck[0].user1_id;

    // Upload to Cloudinary
    const b64 = Buffer.from(req.file.buffer).toString('base64');
    const dataURI = `data:${req.file.mimetype};base64,${b64}`;
    
    const result = await cloudinary.uploader.upload(dataURI, {
      folder: 'campus-connect/chats',
      transformation: [{ width: 1000, height: 1000, crop: 'limit' }]
    });

    const encryptedContent = encryptMessage('[Image]');
    
    const [dbResult] = await pool.query(
      `INSERT INTO messages (match_id, sender_id, message_type, content, media_url, encrypted_payload)
       VALUES (?, ?, 'image', ?, ?, ?)`,
      [matchId, userId, encryptedContent, result.secure_url, encryptedContent]
    );

    const messageId = dbResult.insertId;

    // Create notification
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES (?, 'message', 'New Image', 'You received an image!', ?)`,
      [otherUserId, JSON.stringify({ matchId, senderId: userId })]
    );

    // Emit socket event
    const server = require('../server');
    const io = server.io;
    if (io) {
      io.to(`match_${matchId}`).emit('new_message', {
        matchId,
        message: {
          id: messageId,
          senderId: userId,
          content: '[Image]',
          messageType: 'image',
          imageUrl: result.secure_url,
          createdAt: new Date()
        }
      });
    }

    res.status(201).json({
      messageId,
      imageUrl: result.secure_url
    });
  } catch (error) {
    next(error);
  }
};

// --- SELF CHAT (NOTES) ---
exports.getSelfMessages = async (req, res, next) => {
  try {
    const userId = req.user.id;
    // Using match_id = 0 for self chat
    const [messages] = await pool.query(
      `SELECT id, content, message_type, media_url as imageUrl, created_at 
       FROM messages 
       WHERE sender_id = ? AND (match_id = 0 OR match_id IS NULL) 
       ORDER BY created_at ASC`,
      [userId]
    );

    const decryptedMessages = messages.map(msg => ({
      ...msg,
      content: msg.content ? decryptMessage(msg.content) : null
    }));

    res.json({ success: true, messages: decryptedMessages });
  } catch (err) { next(err); }
};

exports.sendSelfMessage = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { content } = req.body;
    
    const encryptedContent = encryptMessage(content);
    
    const [result] = await pool.query(
      `INSERT INTO messages (sender_id, match_id, content, encrypted_payload, message_type, is_read) 
       VALUES (?, 0, ?, ?, 'text', 1)`,
      [userId, encryptedContent, encryptedContent]
    );

    const messageId = result.insertId;
    
    // Emit for real-time (to self's personal room)
    const server = require('../server');
    const io = server.io;
    if (io) {
      io.to(`user_${userId}`).emit('new_message', { matchId: 0, senderId: userId, messageId, isSelf: true });
    }

    res.json({ success: true, messageId });
  } catch (err) { next(err); }
};

exports.sendSelfImageMessage = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const file = req.file;
    if (!file) return res.status(400).json({ message: 'No file uploaded' });

    const cloudinary = require('../config/cloudinary');
    // Upload from buffer
    const b64 = Buffer.from(file.buffer).toString('base64');
    const dataURI = `data:${file.mimetype};base64,${b64}`;
    
    const result = await cloudinary.uploader.upload(dataURI, { 
      folder: 'campus-connect/chats',
      transformation: [{ width: 1000, height: 1000, crop: 'limit' }]
    });
    
    const encryptedContent = encryptMessage('[Image]');
    
    const [dbRes] = await pool.query(
      `INSERT INTO messages (sender_id, match_id, content, encrypted_payload, message_type, media_url, is_read) 
       VALUES (?, 0, ?, ?, 'image', ?, 1)`,
      [userId, encryptedContent, encryptedContent, result.secure_url]
    );
    
    // Emit for real-time
    const server = require('../server');
    const io = server.io;
    if (io) {
      io.to(`user_${userId}`).emit('new_message', { matchId: 0, senderId: userId, messageId: dbRes.insertId, isSelf: true });
    }

    res.json({ success: true, messageId: dbRes.insertId, imageUrl: result.secure_url });
  } catch (err) { next(err); }
};

exports.sendConnectionImageMessage = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { connectionId } = req.params;
    const cloudinary = require('../config/cloudinary');

    if (!req.file) {
      return res.status(400).json({ message: 'No image uploaded' });
    }

    // Verify connection exists
    const [connCheck] = await pool.query(
      'SELECT * FROM connections WHERE id = ? AND (user1_id = ? OR user2_id = ?) AND status = "active"',
      [connectionId, userId, userId]
    );

    if (connCheck.length === 0) {
      return res.status(403).json({ message: 'Connection not found' });
    }

    const otherUserId = connCheck[0].user1_id === userId ? connCheck[0].user2_id : connCheck[0].user1_id;

    // Upload to Cloudinary
    const b64 = Buffer.from(req.file.buffer).toString('base64');
    const dataURI = `data:${req.file.mimetype};base64,${b64}`;
    
    const result = await cloudinary.uploader.upload(dataURI, {
      folder: 'campus-connect/chats',
      transformation: [{ width: 1000, height: 1000, crop: 'limit' }]
    });

    const messageId = uuidv4();
    const encryptedContent = encryptMessage('[Image]');
    
    await pool.query(
      `INSERT INTO connection_messages (id, connection_id, sender_id, message_type, content, media_url)
       VALUES (?, ?, ?, 'image', ?, ?)`,
      [messageId, connectionId, userId, encryptedContent, result.secure_url]
    );

    // Emit socket event
    const server = require('../server');
    const io = server.io;
    if (io) {
      io.to(`connection_${connectionId}`).emit('new_connection_message', {
        connectionId,
        message: {
          id: messageId,
          senderId: userId,
          sender_id: userId,
          content: '[Image]',
          messageType: 'image',
          message_type: 'image',
          media_url: result.secure_url,
          created_at: new Date(),
          is_read: false
        }
      });
    }res.status(201).json({
      messageId,
      imageUrl: result.secure_url
    });
  } catch (error) {
    next(error);
  }
};