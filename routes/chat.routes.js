const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const chatController = require('../controllers/chat.controller');

router.get('/:matchId/messages', authenticate, chatController.getMessages);
router.post('/:matchId/messages', authenticate, chatController.sendMessage);
router.delete('/messages/:messageId', authenticate, chatController.deleteMessage);
router.get('/:matchId/icebreakers', authenticate, chatController.getIcebreakers);

// Connection routes for unmatched user chat
router.post('/connection/start', authenticate, chatController.startConnection);
router.get('/connection/:connectionId/messages', authenticate, chatController.getConnectionMessages);
router.post('/connection/:connectionId/messages', authenticate, chatController.sendConnectionMessage);
router.get('/connections', authenticate, chatController.getMyConnections);

module.exports = router;