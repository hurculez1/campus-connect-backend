const express = require('express');
const router = express.Router();
const { authenticate, requireSubscription } = require('../middleware/auth.middleware');
const matchController = require('../controllers/match.controller');

router.post('/swipe', authenticate, matchController.swipe);
router.post('/direct', authenticate, matchController.createDirectMatch);
router.post('/request', authenticate, matchController.createMatchRequest); // New: pending match request
router.post('/accept', authenticate, matchController.acceptMatchRequest); // New: accept match request
router.post('/reject', authenticate, matchController.rejectMatchRequest); // New: reject match request
router.get('/requests', authenticate, matchController.getPendingRequests); // New: get pending requests
router.get('/', authenticate, matchController.getMatches);
router.get('/likes', authenticate, requireSubscription('premium'), matchController.getWhoLikedMe);
router.post('/seen-likes', authenticate, matchController.markLikesAsSeen);
router.get('/:matchId', authenticate, matchController.getMatchById);
router.delete('/:matchId', authenticate, matchController.unmatch);

module.exports = router;