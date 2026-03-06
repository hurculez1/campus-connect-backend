const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { pool } = require('../config/database');
const logger = require('../utils/logger');

const SUBSCRIPTION_PLANS = {
  premium: {
    monthly: { amount: 18000, currency: 'UGX', usd: 499 },
    stripePriceId: process.env.STRIPE_PREMIUM_PRICE_ID
  },
  vip: {
    monthly: { amount: 36000, currency: 'UGX', usd: 999 },
    stripePriceId: process.env.STRIPE_VIP_PRICE_ID
  }
};

exports.getPlans = async (req, res, next) => {
  try {
    res.json({
      plans: {
        free: {
          name: 'Free',
          price: 0,
          features: [
            '50 swipes per day',
            '5 matches per day',
            'Basic filters',
            'Core messaging',
            'Ads supported'
          ]
        },
        premium: {
          name: 'Premium',
          price: { ugx: 18000, usd: 4.99 },
          features: [
            'Unlimited swipes',
            'Unlimited matches',
            'Ad-free experience',
            'Advanced filters',
            'See who liked you',
            '1 Super Like per day'
          ]
        },
        vip: {
          name: 'VIP',
          price: { ugx: 36000, usd: 9.99 },
          features: [
            'Everything in Premium',
            'Priority matching',
            '5 Super Likes per day',
            'AI date coaching',
            'Exclusive campus events',
            'Custom profile themes'
          ]
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.createSubscription = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { plan, paymentMethod, provider = 'stripe' } = req.body;

    if (!['premium', 'vip'].includes(plan)) {
      return res.status(400).json({ message: 'Invalid plan' });
    }

    if (provider === 'stripe') {
      // Create Stripe checkout session
      const session = await stripe.checkout.sessions.create({
        customer_email: req.user.email,
        line_items: [{
          price: SUBSCRIPTION_PLANS[plan].stripePriceId,
          quantity: 1,
        }],
        mode: 'subscription',
        success_url: `${process.env.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/payment/cancel`,
        metadata: {
          userId,
          plan
        }
      });

      // Create pending subscription record
      await pool.query(
        `INSERT INTO subscriptions (user_id, tier, status, payment_provider, started_at, expires_at)
         VALUES ($1, $2, 'pending', 'stripe', NOW(), NOW() + INTERVAL '1 month')`,
        [userId, plan]
      );

      res.json({ checkoutUrl: session.url, sessionId: session.id });
    } else if (provider === 'mtn_mobile_money' || provider === 'airtel_money') {
      // Simulated mobile money integration
      const transactionId = `MM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      await pool.query(
        `INSERT INTO payments (user_id, payment_type, amount, currency, provider, provider_transaction_id, status)
         VALUES ($1, 'subscription', $2, 'UGX', $3, $4, 'pending')`,
        [userId, SUBSCRIPTION_PLANS[plan].monthly.amount, provider, transactionId]
      );

      res.json({
        message: 'Mobile money payment initiated',
        transactionId,
        instructions: `Please dial *165# for MTN or *185# for Airtel to complete payment of UGX ${SUBSCRIPTION_PLANS[plan].monthly.amount}`,
        simulated: true
      });
    }
  } catch (error) {
    next(error);
  }
};

exports.webhook = async (req, res, next) => {
  try {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      logger.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { userId, plan } = session.metadata;

      // Update subscription
      await pool.query(
        `UPDATE subscriptions 
         SET status = 'active', payment_id = $1, started_at = NOW(), expires_at = NOW() + INTERVAL '1 month'
         WHERE user_id = $2 AND tier = $3`,
        [session.subscription, userId, plan]
      );

      // Update user tier
      await pool.query(
        `UPDATE users SET subscription_tier = $1, subscription_expires_at = NOW() + INTERVAL '1 month' WHERE id = $2`,
        [plan, userId]
      );

      logger.info(`Subscription activated: ${userId} - ${plan}`);
    }

    res.json({ received: true });
  } catch (error) {
    next(error);
  }
};

exports.purchaseBoost = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { quantity = 1 } = req.body;

    const boostPrice = quantity * 5000; // UGX 5,000 per boost

    const { rows: result } = await pool.query(
      `INSERT INTO payments (user_id, payment_type, amount, currency, provider, status)
       VALUES ($1, 'boost', $2, 'UGX', 'stripe', 'pending') RETURNING id`,
      [userId, boostPrice]
    );

    res.json({
      message: 'Boost purchase initiated',
      amount: boostPrice,
      quantity,
      paymentId: result[0].id
    });
  } catch (error) {
    next(error);
  }
};

exports.getCurrentSubscription = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { rows: subscriptions } = await pool.query(
      `SELECT * FROM subscriptions 
       WHERE user_id = $1 AND status = 'active' AND expires_at > NOW()
       ORDER BY expires_at DESC LIMIT 1`,
      [userId]
    );

    const { rows: user } = await pool.query(
      'SELECT subscription_tier, subscription_expires_at, daily_swipes_used, super_likes_available FROM users WHERE id = $1',
      [userId]
    );

    res.json({
      tier: user[0]?.subscription_tier || 'free',
      expiresAt: user[0]?.subscription_expires_at,
      dailySwipesUsed: user[0]?.daily_swipes_used,
      superLikesAvailable: user[0]?.super_likes_available,
      subscription: subscriptions[0] || null
    });
  } catch (error) {
    next(error);
  }
};