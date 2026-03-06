const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const chatController = require('../controllers/chat.controller');

router.get('/:matchId/messages', authenticate, chatController.getMessages);
router.post('/:matchId/messages', authenticate, chatController.sendMessage);
router.delete('/messages/:messageId', authenticate, chatController.deleteMessage);
router.get('/:matchId/icebreakers', authenticate, chatController.getIcebreakers);

module.exports = router;