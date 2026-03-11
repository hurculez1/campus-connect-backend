const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth.middleware');
const chatController = require('../controllers/chat.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// ─── IMPORTANT: Static routes MUST come before dynamic /:matchId routes ──────

// Cloudinary direct upload support (bypasses Vercel multipart limit)
router.get('/upload-params', authenticate, chatController.getCloudinaryUploadParams);

// Self chat routes — MUST be before /:matchId
router.get('/self', authenticate, chatController.getSelfMessages);
router.post('/self', authenticate, chatController.sendSelfMessage);
router.post('/self/image', authenticate, upload.single('image'), chatController.sendSelfImageMessage);

// Connection routes — MUST be before /:matchId
router.post('/connection/start', authenticate, chatController.startConnection);
router.get('/connection/:connectionId/messages', authenticate, chatController.getConnectionMessages);
router.post('/connection/:connectionId/messages', authenticate, chatController.sendConnectionMessage);
router.post('/connection/:connectionId/image', authenticate, upload.single('image'), chatController.sendConnectionImageMessage);
router.post('/connection/:connectionId/save-image', authenticate, chatController.saveConnectionImageMessage);
router.get('/connections', authenticate, chatController.getMyConnections);

// Read all messages in a match
router.post('/:matchId/read', authenticate, async (req, res) => {
  try {
    const { matchId } = req.params;
    const userId = req.user.id;
    const { pool } = require('../config/database');
    await pool.query(
      'UPDATE messages SET is_read = TRUE, read_at = NOW() WHERE match_id = ? AND sender_id != ? AND is_read = FALSE',
      [matchId, userId]
    );
    res.json({ success: true });
  } catch (err) { res.json({ success: false }); }
});

// Dynamic match routes — AFTER all static routes
router.get('/:matchId/messages', authenticate, chatController.getMessages);
router.post('/:matchId/messages', authenticate, chatController.sendMessage);
router.post('/:matchId/image', authenticate, upload.single('image'), chatController.sendImageMessage);
router.post('/:matchId/save-image', authenticate, chatController.saveImageMessage);
router.delete('/messages/:messageId', authenticate, chatController.deleteMessage);
router.get('/:matchId/icebreakers', authenticate, chatController.getIcebreakers);

module.exports = router;
