const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin, requireSuperAdmin } = require('../middleware/auth.middleware');
const adminController = require('../controllers/admin.controller');

// Admin auth (uses regular user auth now — no separate admin_users table needed)
router.post('/login', adminController.adminLogin);

// Dashboard
router.get('/dashboard', authenticate, requireAdmin, adminController.getDashboardStats);

// User Management
router.get('/users', authenticate, requireAdmin, adminController.getUsers);
router.get('/users/:userId', authenticate, requireAdmin, adminController.getUserDetail);
router.post('/users/:userId/ban', authenticate, requireAdmin, adminController.banUser);
router.post('/users/:userId/unban', authenticate, requireAdmin, adminController.unbanUser);
router.delete('/users/:userId', authenticate, requireSuperAdmin, adminController.deleteUser);
router.post('/users/:userId/promote', authenticate, requireSuperAdmin, adminController.promoteToAdmin);
router.post('/users/:userId/demote', authenticate, requireSuperAdmin, adminController.demoteFromAdmin);
router.put('/users/:userId/subscription', authenticate, requireAdmin, adminController.changeUserSubscription);

// Content Moderation
router.get('/pulse', authenticate, requireAdmin, adminController.getAllPulse);
router.delete('/pulse/:postId', authenticate, requireAdmin, adminController.deletePulsePost);
router.get('/messages', authenticate, requireAdmin, adminController.getRecentMessages);

// Verifications
router.get('/verifications', authenticate, requireAdmin, adminController.getVerifications);
router.post('/verifications/:verificationId/review', authenticate, requireAdmin, adminController.reviewVerification);

// Reports
router.get('/reports', authenticate, requireAdmin, adminController.getReports);
router.post('/reports/:reportId/resolve', authenticate, requireAdmin, adminController.resolveReport);

// Analytics
router.get('/analytics', authenticate, requireAdmin, adminController.getAnalytics);
router.get('/activity-log', authenticate, requireAdmin, adminController.getActivityLog);

// System
router.post('/announce', authenticate, requireSuperAdmin, adminController.sendAnnouncement);
router.get('/system', authenticate, requireSuperAdmin, adminController.getSystemInfo);

module.exports = router;