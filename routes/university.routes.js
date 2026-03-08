const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const universityController = require('../controllers/university.controller');
const multer = require('multer');

const fs = require('fs');
if (!fs.existsSync('/tmp/uploads')) {
  fs.mkdirSync('/tmp/uploads', { recursive: true });
}
const upload = multer({ dest: '/tmp/uploads/' });

router.get('/', universityController.getUniversities);
router.post('/verify-email', authenticate, universityController.verifyStudentEmail);
router.post('/upload-id', authenticate, upload.single('studentId'), universityController.uploadStudentId);

module.exports = router;