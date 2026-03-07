const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const pulseController = require('../controllers/pulse.controller');

router.get('/', pulseController.getPosts);
router.get('/campuses', pulseController.getCampuses);
router.post('/', authenticate, pulseController.createPost);
router.post('/:postId/like', pulseController.likePost);

module.exports = router;
