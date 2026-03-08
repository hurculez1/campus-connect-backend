const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const universityController = require('../controllers/university.controller');
const multer = require('multer');

const path = require('path');
const uploadDir = path.join(__dirname, '../uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const fs = require('fs');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});
const upload = multer({ storage: storage });

router.get('/', universityController.getUniversities);
router.post('/verify-email', authenticate, universityController.verifyStudentEmail);
router.post('/upload-id', authenticate, upload.single('studentId'), universityController.uploadStudentId);

module.exports = router;