const logger = require('../utils/logger');

module.exports = (io) => {
  io.on('connection', (socket) => {
    logger.info(`User connected: ${socket.userId}`);

    // Join user's personal room
    socket.join(`user_${socket.userId}`);

    // Update online status
    const { pool } = require('../config/database');
    pool.query('UPDATE users SET last_active = NOW() WHERE id = $1', [socket.userId]);

    // Handle typing indicator
    socket.on('typing', (data) => {
      const { matchId, isTyping } = data;
      
      // Broadcast to match room
      socket.to(`match_${matchId}`).emit('typing', {
        userId: socket.userId,
        isTyping
      });
    });

    // Join match room for real-time messaging
    socket.on('join_match', (matchId) => {
      socket.join(`match_${matchId}`);
      logger.debug(`User ${socket.userId} joined match ${matchId}`);
    });

    // Leave match room
    socket.on('leave_match', (matchId) => {
      socket.leave(`match_${matchId}`);
    });

    // Handle message read receipts
    socket.on('message_read', async (data) => {
      const { matchId, messageId } = data;
      
      try {
        await pool.query(
          'UPDATE messages SET is_read = TRUE, read_at = NOW() WHERE id = $1',
          [messageId]
        );

        socket.to(`match_${matchId}`).emit('message_read', {
          messageId,
          readAt: new Date()
        });
      } catch (error) {
        logger.error('Message read error:', error);
      }
    });

    // Handle call signaling (for future video chat)
    socket.on('call_offer', (data) => {
      const { to, offer } = data;
      io.to(`user_${to}`).emit('call_offer', {
        from: socket.userId,
        offer
      });
    });

    socket.on('call_answer', (data) => {
      const { to, answer } = data;
      io.to(`user_${to}`).emit('call_answer', {
        from: socket.userId,
        answer
      });
    });

    socket.on('ice_candidate', (data) => {
      const { to, candidate } = data;
      io.to(`user_${to}`).emit('ice_candidate', {
        from: socket.userId,
        candidate
      });
    });

    // Disconnect
    socket.on('disconnect', () => {
      logger.info(`User disconnected: ${socket.userId}`);
    });
  });
};