const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const paymentController = require('../controllers/payment.controller');

router.get('/plans', authenticate, paymentController.getPlans);
router.get('/current', authenticate, paymentController.getCurrentSubscription);
router.post('/subscribe', authenticate, paymentController.createSubscription);
router.post('/boost', authenticate, paymentController.purchaseBoost);
router.post('/webhook', express.raw({ type: 'application/json' }), paymentController.webhook);

module.exports = router;