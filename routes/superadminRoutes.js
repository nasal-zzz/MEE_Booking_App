const express = require('express');
const router = express.Router();
const Staff = require('../models/Staff');
const Coupon = require('../models/Coupon');
const Booking = require('../models/Booking');
const Event = require('../models/Event');
const ScanLog = require('../models/ScanLog');
const User = require('../models/User');

// ── Default superadmin credentials ──
const SUPER_ADMIN = {
  username: process.env.SUPER_ADMIN_USER || 'superadmin',
  password: process.env.SUPER_ADMIN_PASS || 'MEE@SuperAdmin2026',
};

const userController = require('../controllers/userController');

router.get('/users', userController.getUsers);
router.post('/users/:id/block', userController.blockUser);
router.post('/users/:id/unblock', userController.unblockUser);
router.delete('/users/:id', userController.deleteUser); // superadmin-only


// ── Auth middleware ── accepts superAdminLoggedIn OR staffLoggedIn with superadmin role

const { superAuth } = require('../middleware/adminAuth');


router.get('/login', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  if (req.session.superAdminLoggedIn || req.session.staffLoggedIn) return res.redirect('/superadmin');
  return res.redirect('/staff/login#superadmin');
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (username === SUPER_ADMIN.username && password === SUPER_ADMIN.password) {
    // Upsert superadmin record in Staff DB so they appear in admin panel
    try {
      await Staff.findOneAndUpdate(
        { username },
        {
          username,
          password,
          firstName: 'Super',
          lastName: 'Admin',
          email: process.env.SUPER_ADMIN_EMAIL || 'superadmin@mee.local',
          phone: process.env.SUPER_ADMIN_PHONE || '0000000000',
          role: 'superadmin',
          isActive: true,
          canScanQR: true,
          canViewBookings: true,
          canManageEvents: true,
        },
        { upsert: true, new: true }
      );
    } catch (e) { /* non-fatal */ }
    req.session.superAdminLoggedIn = true;
    req.session.superAdminUser = username;
    req.session.staffLoggedIn = true;
    req.session.staffUser = { username, role: 'superadmin', name: 'Super Admin' };
    await new Promise((r, j) => req.session.save(e => e ? j(e) : r()));
    return res.redirect('/superadmin');
  }
  // Also try DB staff with superadmin role
  try {
    const member = await Staff.findOne({ username, role: 'superadmin' });
    if (member && member.password === password && member.isActive) {
      req.session.superAdminLoggedIn = true;
      req.session.superAdminUser = username;
      req.session.staffLoggedIn = true;
      req.session.staffUser = { id: member._id.toString(), username, role: 'superadmin', name: member.firstName + ' ' + (member.lastName || '') };
      await new Promise((r, j) => req.session.save(e => e ? j(e) : r()));
      return res.redirect('/superadmin');
    }
  } catch (e) { }
  res.render('superadmin/login', { title: 'Super Admin Login — MEE', error: 'Invalid credentials.' });
});

// router.get('/logout', (req, res) => {
//   req.session.destroy(() => res.redirect('/staff/login'));
// });

router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Session destroy error:', err);
    res.clearCookie('mee.sid', { path: '/' });
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.redirect('/staff/login');
  });
});



// ── PUBLIC: Coupon validation (used by checkout — no auth needed) ──
router.post('/api/validate-coupon', async (req, res) => {
  try {
    const { code, orderAmount } = req.body;
    if (!code) return res.json({ success: false, message: 'No coupon code provided.' });
    const coupon = await Coupon.findOne({ code: code.toUpperCase().trim(), isActive: true });
    if (!coupon) return res.json({ success: false, message: 'Invalid coupon code.' });
    const now = new Date();
    if (coupon.validFrom && now < new Date(coupon.validFrom)) return res.json({ success: false, message: 'Coupon not yet active.' });
    if (coupon.validUntil) {
      const expiry = new Date(coupon.validUntil); expiry.setHours(23, 59, 59, 999);
      if (now > expiry) return res.json({ success: false, message: 'Coupon has expired.' });
    }
    if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) return res.json({ success: false, message: 'Coupon usage limit reached.' });
    // One-per-user check
    const userId = req.session?.userId || req.session?.user?._id || null;
    if (userId && coupon.usedBy && coupon.usedBy.map(id => id.toString()).includes(userId.toString())) {
      return res.json({ success: false, message: 'You have already used this coupon.' });
    }
    const amount = parseFloat(orderAmount) || 0;
    const quantity = parseInt(req.body.quantity) || 1;
    if (coupon.minOrder > 0 && amount < coupon.minOrder) return res.json({ success: false, message: 'Minimum order amount ₹' + coupon.minOrder + ' required.' });
    if (coupon.minTickets > 0 && quantity < coupon.minTickets) return res.json({ success: false, message: 'Minimum ' + coupon.minTickets + ' ticket' + (coupon.minTickets > 1 ? 's' : '') + ' required to use this coupon.' });
    const discount = coupon.type === 'percent'
      ? Math.round((amount * coupon.value) / 100)
      : coupon.value;
    res.json({ success: true, discount: Math.min(discount, amount), code: coupon.code, description: coupon.description });
  } catch (err) { console.error('Coupon validate error:', err); res.json({ success: false, message: 'Server error.' }); }
});

router.use(superAuth);

// ── DASHBOARD ──
router.get('/', async (req, res) => {
  try {
    const Event = require('../models/Event');
    const [staffCount, totalBookings, totalRevenueAgg, coupons, totalUsers, events] = await Promise.all([
      Staff.countDocuments(),
      Booking.countDocuments({ paymentStatus: 'paid' }),
      Booking.aggregate([{ $match: { paymentStatus: 'paid' } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
      Coupon.countDocuments(),
      User.countDocuments(),
      Event.find().sort({ date: -1 }),
    ]);

    // Active event panel — same as admin dashboard
    const activeEvent = events.find(e => e.isActive) || null;
    let activeEventBookings = [], activeEventRevenue = 0;
    if (activeEvent) {
      activeEventBookings = await Booking.find({
        event: activeEvent._id,
        paymentStatus: 'paid',
      }).populate('user', 'name phone email').lean();
      activeEventRevenue = activeEventBookings.reduce((s, b) => s + (b.totalAmount || 0), 0);
    }

    const currentAdmin = req.session.staffUser || { username: req.session.superAdminUser || 'superadmin', name: 'Super Admin', role: 'superadmin' };
    res.render('superadmin/dashboard', {
      title: 'Super Admin — MEE',
      staffCount, totalBookings,
      totalRevenue: totalRevenueAgg[0]?.total || 0,
      totalUsers,
      coupons,
      currentAdmin,
      activeEvent,
      activeEventBookings,
      activeEventRevenue,
    });
  } catch (err) {
    console.error('Superadmin dashboard error:', err);
    res.render('superadmin/dashboard', { title: 'Super Admin', staffCount: 0, totalBookings: 0, totalRevenue: 0, totalUsers: 0, coupons: 0, currentAdmin: req.session.staffUser || { name: 'Super Admin', role: 'superadmin' }, activeEvent: null, activeEventBookings: [], activeEventRevenue: 0 });
  }
});

// ── STAFF MANAGEMENT ──
router.get('/staff', async (req, res) => {
  try {
    const staff = await Staff.find().sort({ createdAt: -1 });
    const currentAdmin = req.session.staffUser || { username: req.session.superAdminUser || 'superadmin', name: 'Super Admin', role: 'superadmin' };
    res.render('superadmin/staff', { title: 'Staff Management — MEE', staff, currentAdmin });
  } catch (err) {
    res.render('superadmin/staff', { title: 'Staff Management', staff: [] });
  }
});

router.post('/staff', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, role, canScanQR, canViewBookings, canManageEvents, canSellTickets,
      manualUsername, manualPassword } = req.body;

    let username, password;

    if (manualUsername && manualUsername.trim()) {
      // Manual credentials provided
      username = manualUsername.trim().toLowerCase().replace(/\s+/g, '-');
      if (!manualPassword || manualPassword.trim().length < 4)
        return res.json({ success: false, message: 'Password must be at least 4 characters.' });
      password = manualPassword.trim();
      // Check username is unique
      const taken = await Staff.findOne({ username });
      if (taken) return res.json({ success: false, message: `Username "${username}" is already taken.` });
    } else {
      // Auto-generate username and password
      const prefix = role === 'admin' ? 'admin' : 'staff';
      const baseUser = `${prefix}-${firstName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const existing = await Staff.findOne({ username: baseUser });
      username = existing ? `${baseUser}${Math.floor(Math.random() * 900) + 100}` : baseUser;
      const last3 = (phone || '000').slice(-3);
      password = `${username}-${last3}`;
    }

    const member = await Staff.create({
      firstName, lastName: lastName || '', email, phone: phone || '',
      username, password, role: role || 'staff',
      canScanQR: canScanQR === 'on', canViewBookings: canViewBookings === 'on', canManageEvents: canManageEvents === 'on', canSellTickets: canSellTickets === 'on',
      createdBy: null,
    });
    res.json({ success: true, username: member.username, password: member.password, id: member._id });
  } catch (err) {
    res.json({ success: false, message: err.code === 11000 ? 'Email or username already exists.' : err.message });
  }
});

router.post('/staff/:id/toggle', async (req, res) => {
  try {
    const member = await Staff.findById(req.params.id);
    if (!member) return res.json({ success: false, message: 'Not found' });
    member.isActive = !member.isActive;
    await member.save();
    res.json({ success: true, isActive: member.isActive });
  } catch (err) { res.json({ success: false, message: err.message }); }
});

router.post('/staff/:id/delete', async (req, res) => {
  try {
    await Staff.findByIdAndDelete(req.params.id);
    res.redirect('/superadmin/staff');
  } catch (err) { res.redirect('/superadmin/staff'); }
});

// GET /superadmin/staff/:id/credentials — fetch current creds for edit modal
router.get('/staff/:id/credentials', async (req, res) => {
  try {
    const member = await Staff.findById(req.params.id).lean();
    if (!member) return res.json({ success: false, message: 'Not found' });
    res.json({ success: true, username: member.username, password: member.password });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST /superadmin/staff/:id/credentials — superadmin-only credential edit
router.post('/staff/:id/credentials', async (req, res) => {
  try {
    const { newUsername, newPassword } = req.body;
    if (!newUsername || newUsername.trim().length < 2)
      return res.json({ success: false, message: 'Username must be at least 2 characters.' });
    if (!newPassword || newPassword.trim().length < 4)
      return res.json({ success: false, message: 'Password must be at least 4 characters.' });

    const username = newUsername.trim().toLowerCase().replace(/\s+/g, '-');

    // Ensure unique username (excluding self)
    const conflict = await Staff.findOne({ username, _id: { $ne: req.params.id } });
    if (conflict) return res.json({ success: false, message: `Username "${username}" is already taken.` });

    await Staff.findByIdAndUpdate(req.params.id, { username, password: newPassword.trim() });
    res.json({ success: true, username });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ── COUPON MANAGEMENT ──
router.get('/coupons', async (req, res) => {
  try {
    const currentAdmin = req.session.staffUser || { username: req.session.superAdminUser || 'superadmin', name: 'Super Admin', role: 'superadmin' };
    const events = await Event.find({}, 'name date').sort({ date: -1 }).lean();
    const rawCoupons = await Coupon.find().sort({ createdAt: -1 }).lean();

    const codes = rawCoupons.map(c => c.code);
    const usageBookings = await Booking.find({
      couponCode: { $in: codes }, paymentStatus: 'paid',
    }).populate('event', 'name date venue').populate('user', 'firstName lastName phone email').sort({ createdAt: -1 }).lean();

    const usageMap = {};
    for (const b of usageBookings) {
      if (!usageMap[b.couponCode]) usageMap[b.couponCode] = [];
      usageMap[b.couponCode].push(b);
    }

    const now = new Date();
    const coupons = rawCoupons.map(c => ({
      ...c,
      usages: usageMap[c.code] || [],
      isExpired: !!(c.validUntil && now > new Date(c.validUntil)),
    }));

    res.render('superadmin/coupons', { title: 'Coupons — Super Admin', coupons, events, currentAdmin });
  } catch (err) {
    console.error('SA coupons error:', err);
    res.status(500).send('Error loading coupons: ' + err.message);
  }
});

router.post('/coupons', async (req, res) => {
  try {
    const { code, type, value, minOrder, minTickets, maxUses, validFrom, validUntil, description, isActive, isFeatured } = req.body;
    if (!code || !code.trim()) return res.redirect('/superadmin/coupons?err=Code+required');
    if (!value || parseFloat(value) <= 0) return res.redirect('/superadmin/coupons?err=Value+must+be+greater+than+0');
    const cleanCode = code.toUpperCase().trim();
    const existing = await Coupon.findOne({ code: cleanCode });
    if (existing) return res.redirect('/superadmin/coupons?err=' + encodeURIComponent(`Coupon code "${cleanCode}" already exists.`));
    await Coupon.create({
      code: cleanCode, type: type || 'fixed',
      value: parseFloat(value), minOrder: parseFloat(minOrder) || 0,
      minTickets: parseInt(minTickets) || 0, maxUses: parseInt(maxUses) || 0,
      validFrom: validFrom || null, validUntil: validUntil || null,
      description: description || '',
      isActive: isActive === 'on' || isActive === true,
      isFeatured: isFeatured === 'on' || isFeatured === true,
    });
    res.redirect('/superadmin/coupons');
  } catch (err) {
    res.redirect('/superadmin/coupons?err=' + encodeURIComponent(err.code === 11000 ? 'Coupon code already exists.' : err.message));
  }
});

router.post('/coupons/:id/edit', async (req, res) => {
  try {
    const { code, type, value, minOrder, minTickets, maxUses, validFrom, validUntil, description, isActive, isFeatured } = req.body;
    await Coupon.findByIdAndUpdate(req.params.id, {
      code: code.toUpperCase().trim(), type: type || 'fixed',
      value: parseFloat(value), minOrder: parseFloat(minOrder) || 0,
      minTickets: parseInt(minTickets) || 0, maxUses: parseInt(maxUses) || 0,
      validFrom: validFrom || null, validUntil: validUntil || null,
      description: description || '',
      isActive: isActive === 'on' || isActive === true,
      isFeatured: isFeatured === 'on' || isFeatured === true,
    });
    res.redirect('/superadmin/coupons');
  } catch (err) {
    res.redirect('/superadmin/coupons?err=' + encodeURIComponent(err.message));
  }
});

router.post('/coupons/:id/toggle', async (req, res) => {
  try {
    const c = await Coupon.findById(req.params.id);
    if (c) { c.isActive = !c.isActive; await c.save(); }
    res.redirect('/superadmin/coupons');
  } catch (err) { res.redirect('/superadmin/coupons'); }
});

router.post('/coupons/:id/feature', async (req, res) => {
  try {
    const c = await Coupon.findById(req.params.id);
    if (c) { c.isFeatured = !c.isFeatured; await c.save(); }
    res.redirect('/superadmin/coupons');
  } catch (err) { res.redirect('/superadmin/coupons'); }
});

router.post('/coupons/:id/delete', async (req, res) => {
  try {
    await Coupon.findByIdAndDelete(req.params.id);
    res.redirect('/superadmin/coupons');
  } catch (err) { res.redirect('/superadmin/coupons'); }
});

// ── USERS BY EVENT (ATTENDEES) ──
router.get('/users-by-event', async (req, res) => {
  try {
    const currentAdmin = req.session.staffUser || { username: req.session.superAdminUser || 'superadmin', name: 'Super Admin', role: 'superadmin' };
    const isSuperAdmin = true;
    const events = await Event.find().sort({ date: -1 }).select('name date').lean();
    const selectedEventId = req.query.eventId || '';
    let bookings = [], selectedEvent = null;
    if (selectedEventId) {
      selectedEvent = await Event.findById(selectedEventId).select('name date venue').lean();
      bookings = await Booking.find({ event: selectedEventId, paymentStatus: 'paid' })
        .populate('user', 'firstName lastName email phone').sort({ createdAt: -1 }).lean();
      const enteredRefs = new Set(
        (await ScanLog.find({ event: selectedEventId }).select('bookingRef').lean()).map(l => l.bookingRef)
      );
      const attendees = [];
      bookings.forEach(b => {
        (b.tickets || []).forEach(t => {
          attendees.push({
            bookingRef: b.bookingRef, ticketType: b.ticketType,
            totalAmount: b.totalAmount, quantity: b.quantity,
            couponCode: b.couponCode || null, createdAt: b.createdAt,
            user: b.user, ticketId: t.ticketId,
            name: t.attendee?.name || (b.user ? (b.user.firstName + ' ' + (b.user.lastName || '')) : '—'),
            age: t.attendee?.age || null,
            gender: t.attendee?.gender || '',
            seatNumber: t.seatNumber || null,
            isUsed: t.isUsed || false, usedAt: t.usedAt || null,
            entered: enteredRefs.has(b.bookingRef),
          });
        });
      });
      return res.render('superadmin/users-by-event', { title: 'Attendees — Super Admin', events, bookings, attendees, selectedEvent, selectedEventId, currentAdmin, isSuperAdmin });
    }
    res.render('superadmin/users-by-event', { title: 'Attendees — Super Admin', events, bookings: [], attendees: [], selectedEvent: null, selectedEventId, currentAdmin, isSuperAdmin });
  } catch (err) {
    console.error('[SA] users-by-event error:', err.message);
    res.status(500).send('Error: ' + err.message);
  }
});

// ── ONE-TIME REPAIR: Fix existing bookings with "PENDING" in qrData ──
router.post('/api/repair-qr', async (req, res) => {
  try {
    const { generateQRCode, buildQRPayload, buildGroupQRPayload } = require('../utils/qrHelper');
    // Find all paid bookings where any ticket has "PENDING" in qrData
    const bookings = await Booking.find({ paymentStatus: 'paid' });
    let fixed = 0, skipped = 0;
    for (const booking of bookings) {
      let changed = false;
      const isGroup = booking.tickets.length > 1 && booking.tickets[0]?.qrData?.includes('"grp":true');
      if (isGroup) {
        // Check if group QR has PENDING
        const first = booking.tickets[0];
        if (first.qrData && first.qrData.includes('"PENDING"')) {
          const oldPayload = JSON.parse(first.qrData);
          const newPayload = { ...oldPayload, b: booking.bookingRef };
          const newQR = await generateQRCode(newPayload).catch(() => '');
          const newData = JSON.stringify(newPayload);
          booking.tickets.forEach(t => { t.qrData = newData; if (newQR) t.qrCode = newQR; });
          changed = true;
        }
      } else {
        for (const t of booking.tickets) {
          if (t.qrData && t.qrData.includes('"PENDING"')) {
            const oldPayload = JSON.parse(t.qrData);
            const newPayload = { ...oldPayload, b: booking.bookingRef };
            const newQR = await generateQRCode(newPayload).catch(() => '');
            t.qrData = JSON.stringify(newPayload);
            if (newQR) t.qrCode = newQR;
            changed = true;
          }
        }
      }
      if (changed) { await booking.save(); fixed++; }
      else skipped++;
    }
    res.json({ success: true, message: `Fixed ${fixed} bookings, ${skipped} already OK.`, fixed, skipped });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ── Superadmin error handler ──
// ── Superadmin: Entered Tickets (Scan Log) ──
router.get('/entered-tickets', async (req, res) => {
  try {
    const currentAdmin = req.session.staffUser || { username: req.session.superAdminUser || 'superadmin', name: 'Super Admin', role: 'superadmin' };
    const events = await Event.find().sort({ date: -1 }).lean();
    const selectedEventId = req.query.eventId || (events[0]?._id?.toString() || '');
    let logs = [];
    let selectedEvent = null;
    if (selectedEventId) {
      selectedEvent = await Event.findById(selectedEventId).lean();
      logs = await ScanLog.find({ event: selectedEventId })
        .populate('booking', 'bookingRef ticketType quantity totalAmount')
        .sort({ scannedAt: -1 })
        .lean();
    }
    res.render('superadmin/entered-tickets', { title: 'Entered Tickets — SuperAdmin', events, logs, selectedEvent, selectedEventId, currentAdmin });
  } catch (err) { console.error(err); res.status(500).send('Error loading entered tickets'); }
});



// ── BOOKINGS ──
router.get('/bookings', async (req, res) => {
  try {
    const currentAdmin = req.session.staffUser || { username: req.session.superAdminUser || 'superadmin', name: 'Super Admin', role: 'superadmin' };
    const events = await Event.find({}, 'name date').sort({ date: -1 }).lean();
    const bookings = await Booking.find()
      .populate('user', 'firstName lastName phone email')
      .populate('event', 'name date _id')
      .sort({ createdAt: -1 })
      .lean();
    res.render('superadmin/bookings', { title: 'Bookings — Super Admin', bookings, events, currentAdmin });
  } catch (err) {
    console.error('[SA] bookings error:', err.message);
    res.status(500).send('Error loading bookings: ' + err.message);
  }
});

// ── PAYMENTS ──
router.get('/payments', async (req, res) => {
  try {
    const currentAdmin = req.session.staffUser || { username: req.session.superAdminUser || 'superadmin', name: 'Super Admin', role: 'superadmin' };
    const events = await Event.find({}, 'name date').sort({ date: -1 }).lean();
    const bookings = await Booking.find()
      .populate('user', 'firstName lastName phone email')
      .populate('event', 'name date _id')
      .sort({ createdAt: -1 })
      .lean();

    // Build per-event revenue stats
    const evMap = {};
    bookings.filter(b => b.paymentStatus === 'paid').forEach(b => {
      const evId = b.event ? b.event._id.toString() : 'unknown';
      const evName = b.event ? b.event.name : 'Unknown';
      if (!evMap[evId]) evMap[evId] = { _id: evId, name: evName, revenue: 0, count: 0 };
      evMap[evId].revenue += b.totalAmount || 0;
      evMap[evId].count++;
    });
    const eventStats = Object.values(evMap).map(e => ({
      ...e,
      avgAmount: e.count > 0 ? Math.round(e.revenue / e.count) : 0,
    })).sort((a, b) => b.revenue - a.revenue);

    res.render('superadmin/payments', { title: 'Payments — Super Admin', bookings, events, eventStats, currentAdmin });
  } catch (err) {
    console.error('[SA] payments error:', err.message);
    res.status(500).send('Error loading payments: ' + err.message);
  }
});

router.use((err, req, res, next) => {
  console.error('[SUPERADMIN ERROR]', req.path, err.message);
  const isJson = req.headers['content-type']?.includes('application/json') || req.xhr;
  if (isJson) return res.status(500).json({ success: false, message: err.message });
  res.status(500).render('superadmin/error', {
    title: 'Error — Super Admin',
    status: 500,
    errTitle: 'SOMETHING WENT WRONG',
    errMessage: 'An unexpected error occurred in the Super Admin panel.',
    errDetail: process.env.NODE_ENV !== 'production' ? err.message : null,
  });
});


// ── SuperAdmin: Referral Management ──
const Referral = require('../models/Referral');
const Sponsor = require('../models/Sponsor');

router.get('/referrals', async (req, res) => {
  try {
    const referrals = await Referral.find().sort({ createdAt: -1 }).lean();
    const appUrl = process.env.APP_URL;
    res.render('superadmin/referrals', { title: 'Referral Links — SuperAdmin', referrals, appUrl });
  } catch (err) { res.status(500).send('Error loading referrals'); }
});

router.post('/referrals', async (req, res) => {
  try {
    const { code, label, description } = req.body;
    if (!code || !label) return res.json({ success: false, message: 'Code and label are required.' });
    await Referral.create({ code: code.toUpperCase().trim(), label, description: description || '', createdBy: 'superadmin' });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.code === 11000 ? 'Code already exists.' : err.message });
  }
});

router.post('/referrals/:id/toggle', async (req, res) => {
  try {
    const r = await Referral.findById(req.params.id);
    if (!r) return res.json({ success: false });
    r.isActive = !r.isActive; await r.save();
    res.json({ success: true, isActive: r.isActive });
  } catch (err) { res.json({ success: false }); }
});

router.post('/referrals/:id/delete', async (req, res) => {
  await Referral.findByIdAndDelete(req.params.id).catch(() => { });
  res.redirect('/superadmin/referrals');
});

router.get('/api/referral-users', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.json({ success: false, message: 'Code required' });
    const users = await User.find({ referralCode: code.toUpperCase() })
      .select('firstName lastName phone email createdAt').lean();
    const result = await Promise.all(users.map(async u => {
      const bookingCount = await Booking.countDocuments({ user: u._id, paymentStatus: 'paid' });
      return { ...u, bookingCount };
    }));
    res.json({ success: true, users: result });
  } catch (err) { res.json({ success: false, message: err.message }); }
});


// GET /superadmin/referrals/:id/qr — generate & download QR PNG server-side
router.get('/referrals/:id/qr', async (req, res) => {
  try {
    const referral = await Referral.findById(req.params.id).lean();
    if (!referral) return res.status(404).send('Not found');
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const url = `${appUrl}/r/${referral.code}`;
    const QRCode = require('qrcode');
    const buffer = await QRCode.toBuffer(url, {
      width: 512,
      margin: 3,
      color: { dark: '#ffffff', light: '#0B0B0F' },
      errorCorrectionLevel: 'H',
    });
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `attachment; filename="MEE-QR-${referral.code}.png"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).send('QR generation failed: ' + err.message);
  }
});




// ── SPONSORS (superadmin) ──
router.get('/sponsors', async (req, res) => {
  try {
    const currentAdmin = req.session.staffUser || { username: req.session.superAdminUser || 'superadmin', name: 'Super Admin', role: 'superadmin' };
    const Event = require('../models/Event');
    const sponsors = await Sponsor.find().sort({ order: 1, createdAt: -1 }).populate('events', 'name date').lean();
    const events = await Event.find({}, 'name date').sort({ date: -1 }).lean();
    res.render('mee-admin/sponsors', { title: 'Sponsors — Super Admin', sponsors, events, currentAdmin, isSuperAdmin: true });
  } catch (err) { console.error(err); res.redirect('/superadmin'); }
});

router.post('/sponsors', async (req, res) => {
  try {
    const { name, logo, tier, website, showOnTicket, showOnSite, events } = req.body;
    if (!name) return res.json({ success: false, message: 'Name is required.' });
    if (!logo) return res.json({ success: false, message: 'Logo is required.' });
    const count = await Sponsor.countDocuments();
    await Sponsor.create({
      name: name.trim(), logo, tier: tier || 'partner',
      website: website || '',
      showOnTicket: showOnTicket === true || showOnTicket === 'true',
      showOnSite: showOnSite === true || showOnSite === 'true',
      events: Array.isArray(events) ? events : (events ? [events] : []),
      order: count,
    });
    res.json({ success: true });
  } catch (err) { res.json({ success: false, message: err.message }); }
});

router.post('/sponsors/:id/edit', async (req, res) => {
  try {
    const { name, logo, tier, website, showOnTicket, showOnSite, events } = req.body;
    const upd = {
      name: name.trim(), tier: tier || 'partner', website: website || '',
      showOnTicket: showOnTicket === true || showOnTicket === 'true',
      showOnSite: showOnSite === true || showOnSite === 'true',
      events: Array.isArray(events) ? events : (events ? [events] : []),
    };
    if (logo && logo.startsWith('data:image')) upd.logo = logo;
    await Sponsor.findByIdAndUpdate(req.params.id, upd);
    res.json({ success: true });
  } catch (err) { res.json({ success: false, message: err.message }); }
});

router.post('/sponsors/:id/toggle', async (req, res) => {
  try {
    const s = await Sponsor.findById(req.params.id);
    if (!s) return res.json({ success: false });
    s.isActive = !s.isActive; await s.save();
    res.json({ success: true, isActive: s.isActive });
  } catch (err) { res.json({ success: false }); }
});

router.post('/sponsors/:id/delete', async (req, res) => {
  try { await Sponsor.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (err) { res.json({ success: false, message: err.message }); }
});



// ── SELLER ACTIVITY ──
router.get('/seller-activity', async (req, res) => {
  try {
    const { staffId, eventId, dateFrom, dateTo } = req.query;

    const query = { paymentMethod: 'cash', paymentStatus: 'paid' };
    if (staffId) query.soldBy = staffId;
    if (eventId) query.event = eventId;
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) { const d = new Date(dateTo); d.setHours(23, 59, 59, 999); query.createdAt.$lte = d; }
    }

    const [allStaff, events, bookings] = await Promise.all([
      Staff.find({ canSellTickets: true }).sort({ firstName: 1 }).lean(),
      Event.find().sort({ date: -1 }).select('name date venue').lean(),
      Booking.find(query)
        .populate('event', 'name date venue')
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    // Aggregate per-seller stats
    const sellerMap = {};
    for (const b of bookings) {
      const seller = b.soldBy || 'Unknown';
      if (!sellerMap[seller]) {
        sellerMap[seller] = { seller, tickets: 0, revenue: 0, bookings: 0, attendees: [] };
      }
      sellerMap[seller].bookings++;
      sellerMap[seller].tickets += b.quantity || 0;
      sellerMap[seller].revenue += b.totalAmount || 0;
      (b.tickets || []).forEach(t => {
        sellerMap[seller].attendees.push({
          name: t.attendee?.name || '—',
          ticketId: t.ticketId || '—',
          type: b.ticketType || '—',
          event: b.event?.name || '—',
          date: b.createdAt,
        });
      });
    }

    const sellerStats = Object.values(sellerMap).sort((a, b) => b.revenue - a.revenue);
    const totalRevenue = bookings.reduce((s, b) => s + (b.totalAmount || 0), 0);
    const totalTickets = bookings.reduce((s, b) => s + (b.quantity || 0), 0);

    const currentAdmin = req.session.staffUser || { name: 'Super Admin', role: 'superadmin' };
    res.render('superadmin/seller-activity', {
      title: 'Seller Activity — MEE',
      sellerStats, allStaff, events, bookings,
      totalRevenue, totalTickets,
      filters: {
        staffId: staffId || '',
        eventId: eventId || '',
        dateFrom: dateFrom || '',
        dateTo: dateTo || '',
      },
      currentAdmin,
    });
  } catch (err) {
    console.error('Seller activity error:', err);
    res.redirect('/superadmin');
  }
});



module.exports = router;