const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth.middleware');
const userController = require('../controllers/user.controller');

const fs = require('fs');
if (!fs.existsSync('/tmp/uploads')) {
  fs.mkdirSync('/tmp/uploads', { recursive: true });
}
const upload = multer({ dest: '/tmp/uploads/' });

router.get('/profile', authenticate, userController.getProfile);
router.put('/profile', authenticate, userController.updateProfile);
router.post('/photos', authenticate, upload.single('photo'), userController.uploadPhoto);
router.get('/discover', authenticate, userController.getPotentialMatches);
router.put('/settings', authenticate, userController.updateSettings);

module.exports = router;