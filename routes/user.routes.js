const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth.middleware');
const userController = require('../controllers/user.controller');

const os = require('os');
const path = require('path');
const uploadDir = os.tmpdir();
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});
const upload = multer({ storage: storage });

router.get('/profile', authenticate, userController.getProfile);
router.put('/profile', authenticate, userController.updateProfile);
router.post('/photos', authenticate, upload.single('photo'), userController.uploadPhoto);
router.get('/discover', authenticate, userController.getPotentialMatches);
router.get('/notification-count', authenticate, userController.getNotificationCount);
router.put('/settings', authenticate, userController.updateSettings);

module.exports = router;