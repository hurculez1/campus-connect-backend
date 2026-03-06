const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const adminController = require('../controllers/admin.controller');

router.post('/login', adminController.adminLogin);
router.get('/dashboard', authenticate, adminController.getDashboardStats);
router.get('/users', authenticate, adminController.getUsers);
router.post('/users/:userId/ban', authenticate, adminController.banUser);
router.post('/users/:userId/unban', authenticate, adminController.unbanUser);
router.get('/verifications', authenticate, adminController.getVerifications);
router.post('/verifications/:verificationId/review', authenticate, adminController.reviewVerification);
router.get('/reports', authenticate, adminController.getReports);
router.post('/reports/:reportId/resolve', authenticate, adminController.resolveReport);

module.exports = router;