const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cookieParser = require('cookie-parser');
const methodOverride = require('method-override');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');
const passport = require('./config/passport');



const connectDB = require('./config/db');
const { startCleanupJob } = require('./utils/cleanupPendingBookings');
const { startFailedCleanupJob } = require('./utils/cleanupFailedBookings'); // ✅ add this

connectDB()
  .then(() => {
    startCleanupJob();          // pending → failed  (every 12 hrs)
    startFailedCleanupJob();    // failed  → deleted  (every 2 hrs)
  })
  .catch(() => { });



const app = express();

// Trust proxy (needed for ngrok, reverse proxies - fixes secure cookie issues)
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,        // ← your inline styles/scripts
  crossOriginEmbedderPolicy: false,    // ← ✅ fixes Razorpay iframe blocking
  crossOriginOpenerPolicy: false,      // ← ✅ fixes Razorpay popup blocking
  crossOriginResourcePolicy: false,    // ← ✅ fixes Razorpay resource loading
}));

// ── ✅ CORS ──
app.use(cors({
  origin: process.env.APP_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));


// ── ✅ RAZORPAY WEBHOOK RAW BODY CAPTURE ──
// MUST come BEFORE express.json()
app.use('/booking/webhook/razorpay', (req, res, next) => {
  let rawData = '';
  req.setEncoding('utf8');

  req.on('data', chunk => {
    rawData += chunk;
  });

  req.on('end', () => {
    req.rawBody = rawData;
    try {
      req.body = JSON.parse(rawData);
    } catch (e) {
      req.body = {};
    }
    next();
  });
});

// ── MIDDLEWARE ──
app.use(morgan('dev'));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(cookieParser());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));


// ── RATE LIMITERS ──
// Auth endpoints (OTP send/verify) — strict
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many attempts. Please wait 15 minutes and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV !== 'production',
});

// OTP send — extra strict
const otpSendLimiter = rateLimit({
  windowMs: 120 * 60 * 1000,  // ← change from 10min to 2 hour
  max: 5,
  message: { success: false, message: 'Too many OTP requests. Please wait 1 hour before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV !== 'production',
});

// General API limiter
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: { success: false, message: 'Too many requests. Slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV !== 'production',
});

// Apply limiters
app.use('/auth/send-otp', otpSendLimiter);
app.use('/auth/resend-otp', otpSendLimiter);
app.use('/auth/send-phone-otp', otpSendLimiter);
app.use('/auth/resend-phone-otp', otpSendLimiter);
app.use('/auth/verify-otp', authLimiter);
app.use('/auth/verify-phone-otp', authLimiter);
app.use('/auth/verify-email-otp', authLimiter);
app.use('/auth/signup', authLimiter);
app.use('/booking/create-order', apiLimiter);
app.use('/booking/verify-payment', apiLimiter);
app.use('/staff/api/', apiLimiter);

// ── QR ROUTE ──
app.get('/qr/:filename', (req, res) => {
  const fs = require('fs');
  const filename = path.basename(req.params.filename);
  const file = path.join(__dirname, 'public', 'qr', filename);


  if (!fs.existsSync(file)) {
    console.warn('QR file not found:', file);
    return res.status(404).send('QR not found');
  }

  res.set({
    'Content-Type': 'image/png',
    'ngrok-skip-browser-warning': '1',
    'Cache-Control': 'public, max-age=86400',
    'Access-Control-Allow-Origin': '*',
  });

  res.sendFile(file);
});

// ── SESSION ──
const isProd = process.env.NODE_ENV === 'production';
const appUrl = process.env.APP_URL || 'http://localhost:3000';
const isHttps = appUrl.startsWith('https://');

app.use(session({
  secret: process.env.SESSION_SECRET || 'mee_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    ttl: 24 * 60 * 60,
    touchAfter: 24 * 3600,
  }),
  cookie: {
    secure: isHttps,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  },
}));

// ── PASSPORT ──
app.use(passport.initialize());
app.use(passport.session());

// ── VIEW ENGINE ──
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── GLOBAL LOCALS ──
app.use((req, res, next) => {
  res.locals.appName = process.env.APP_NAME || 'Melattur Entertainment Events';
  res.locals.appUrl = process.env.APP_URL || 'http://localhost:3000';
  res.locals.user = req.user || null;
  res.locals.rzpKeyId = process.env.RAZORPAY_KEY_ID;
  res.locals.currentPath = req.path;
  next();
});

// ── ROUTES ──
app.use('/', require('./routes/indexRoutes'));
app.use('/auth', require('./routes/authRoutes'));
app.use('/booking', require('./routes/bookingRoutes'));
app.use('/user', require('./routes/userRoutes'));
app.use('/admin', require('./routes/adminRoutes'));
app.use('/superadmin', require('./routes/superadminRoutes'));
app.use('/staff', require('./routes/staffRoutes'));

// ── 404 ──
app.use((req, res) => {
  res.status(404).render('pages/error', {
    title: '404 — MEE',
    message: 'Page not found.',
    code: 404,
  });
});

// ── GLOBAL ERROR HANDLER ──
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message, err.stack);

  const routePath = req.path || '';
  const detail = !isProd ? err.message : null;

  if (routePath.startsWith('/superadmin')) {
    return res.status(500).render('superadmin/error', {
      title: 'Error — Super Admin',
      status: 500,
      errTitle: 'SOMETHING WENT WRONG',
      errMessage: 'An unexpected error occurred.',
      errDetail: detail,
    });
  }

  if (routePath.startsWith('/admin')) {
    return res.status(500).render('admin/error', {
      title: 'Error — Admin',
      status: 500,
      errTitle: 'SOMETHING WENT WRONG',
      errMessage: 'An unexpected error occurred. Please try again.',
      errDetail: detail,
    });
  }

  res.status(500).render('pages/error', {
    title: 'Error — MEE',
    message: err.message || 'Something went wrong.',
    code: 500,
  });
});

const PORT = process.env.PORT || 3000;

// ✅ CRITICAL: Must listen on 0.0.0.0 for Docker
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
});

module.exports = app;