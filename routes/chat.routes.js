const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth.middleware');
const chatController = require('../controllers/chat.controller');

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

router.get('/:matchId/messages', authenticate, chatController.getMessages);
router.post('/:matchId/messages', authenticate, chatController.sendMessage);
router.post('/:matchId/image', authenticate, upload.single('image'), chatController.sendImageMessage);
router.delete('/messages/:messageId', authenticate, chatController.deleteMessage);
router.get('/:matchId/icebreakers', authenticate, chatController.getIcebreakers);

// Self chat routes (notes to self)
router.get('/self', authenticate, chatController.getSelfMessages);
router.post('/self', authenticate, chatController.sendSelfMessage);
router.post('/self/image', authenticate, upload.single('image'), chatController.sendSelfImageMessage);

// Connection routes for unmatched user chat
router.post('/connection/start', authenticate, chatController.startConnection);
router.get('/connection/:connectionId/messages', authenticate, chatController.getConnectionMessages);
router.post('/connection/:connectionId/messages', authenticate, chatController.sendConnectionMessage);
router.post('/connection/:connectionId/image', authenticate, upload.single('image'), chatController.sendConnectionImageMessage);
router.get('/connections', authenticate, chatController.getMyConnections);

module.exports = router;