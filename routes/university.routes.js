const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const universityController = require('../controllers/university.controller');
const multer = require('multer');

const upload = multer({ dest: 'uploads/' });

router.get('/', universityController.getUniversities);
router.post('/verify-email', authenticate, universityController.verifyStudentEmail);
router.post('/upload-id', authenticate, upload.single('studentId'), universityController.uploadStudentId);

module.exports = router;