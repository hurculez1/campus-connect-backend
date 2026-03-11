const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');

// Load environment variables FIRST — before anything else
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error(new Date().toISOString() + ' UNCAUGHT: ' + err.stack + '\n');
  if (process.env.NODE_ENV !== 'production') process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error(new Date().toISOString() + ' REJECTION: ' + String(reason) + '\n');
});

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const matchRoutes = require('./routes/match.routes');
const chatRoutes = require('./routes/chat.routes');
const paymentRoutes = require('./routes/payment.routes');
const adminRoutes = require('./routes/admin.routes');
const universityRoutes = require('./routes/university.routes');
const pulseRoutes = require('./routes/pulse.routes');
const { socketAuth } = require('./middleware/auth.middleware');
const socketHandler = require('./services/socket.service');
const { errorHandler } = require('./middleware/error.middleware');
const logger = require('./utils/logger');

// ─── CORS Origins must be defined BEFORE creating Socket.IO server ───────────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "https://frontend-hurculez1s-projects.vercel.app",
  "https://frontend-7q5a6gvbv-hurculez1s-projects.vercel.app",
  "https://frontend-c8eacgjry-hurculez1s-projects.vercel.app",
  "http://localhost:3000"
].filter(Boolean);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('.vercel.app')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ["GET", "POST"]
  }
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('.vercel.app')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.get('/api/media/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'uploads', req.params.filename);
  res.sendFile(filePath, { headers: { 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*' } }, (err) => {
    if (err) res.status(404).json({ message: 'Not found' });
  });
});
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/universities', universityRoutes);
app.use('/api/pulse', pulseRoutes);

// Root route for health check
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send('<html><body><h1>Campus Connect API is Online</h1></body></html>');
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// DB diagnostic endpoint — check database connection
app.get('/api/db-test', async (req, res) => {
  try {
    const { pool } = require('./config/database');
    const [rows] = await pool.execute('SELECT 1 + 1 AS result');
    const [userCount] = await pool.query('SELECT COUNT(*) as count FROM users');
    res.json({
      db: 'connected ✅',
      host: process.env.DB_HOST,
      dbName: process.env.DB_NAME,
      usersInDb: userCount[0].count,
      result: rows[0].result
    });
  } catch (err) {
    res.status(500).json({
      db: 'failed ❌',
      host: process.env.DB_HOST,
      error: err.message
    });
  }
});

// Auto-init DB schema on startup
const { initDatabase } = require('./config/db-init');
initDatabase().catch(err => {
  console.error('Database auto-init failed:', err.message);
});

// Socket.io authentication and handling
io.use(socketAuth);
socketHandler(io);

// Error handling
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

if (process.env.NODE_ENV !== 'production' || process.env.RENDER) {
  const PORT = process.env.PORT || 5000;
  httpServer.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
}

app.io = io;
module.exports = app;