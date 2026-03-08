const express = require('express');
const fs = require('fs');
const path = require('path');

process.on('uncaughtException', (err) => {
  fs.appendFileSync('startup-error-log.txt', new Date().toISOString() + ' UNCAUGHT: ' + err.stack + '\n');
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  fs.appendFileSync('startup-error-log.txt', new Date().toISOString() + ' REJECTION: ' + String(reason) + '\n');
});
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

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

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
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
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true
}));

app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later.'
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.get('/uploads/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'uploads', req.params.filename);
  res.sendFile(filePath, { headers: { 'Content-Type': 'image/jpeg' } }, (err) => {
    if (err) res.status(404).send('Not found');
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

// Root route for cPanel health check
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send('<html><body><h1>Campus Connect API is Online</h1></body></html>');
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Temporary DB diagnostic — remove after debugging
app.get('/api/db-test', async (req, res) => {
  try {
    const { pool } = require('./config/database');
    const [rows] = await pool.execute('SELECT 1 + 1 AS result');
    res.json({
      db: 'connected ✅',
      result: rows[0].result,
      host: process.env.DB_HOST,
      name: process.env.DB_NAME,
      user: process.env.DB_USER
    });
  } catch (err) {
    res.status(500).json({
      db: 'failed ❌',
      error: err.message,
      code: err.code,
      host: process.env.DB_HOST,
      name: process.env.DB_NAME,
      user: process.env.DB_USER
    });
  }
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

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

module.exports = { app, io };