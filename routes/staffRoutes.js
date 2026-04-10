'use strict';

const express = require('express');
const router = express.Router();
const Staff = require('../models/Staff');
const bcrypt = require('bcryptjs');

// ── Hardcoded superadmin ──
const SA_USER = process.env.SUPER_ADMIN_USER;
const SA_PASS = process.env.SUPER_ADMIN_PASS;

const { assignSeatNumbers, isStandingCategory, fetchFreshTtype } = require('../utils/seatHelper');

// ──────────────────────────────────────────────────────────
// LOGIN PAGE
// ─────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  if (req.session.staffLoggedIn) return res.redirect('/staff/dashboard');
  res.render('staff/login', {
    title: 'Staff Login — MEE',
    error: req.query.blocked ? 'Your account has been blocked. Contact the administrator.' : null,
  });
});


// ─────────────────────────────────────────────────────────────
// LOGIN POST
// ─────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.render('staff/login', { title: 'Staff Login — MEE', error: 'Please enter username and password.' });
  }

  // ── 1. Superadmin (hardcoded) ──
  if (username === SA_USER && password === SA_PASS) {
    req.session.superAdminLoggedIn = true;
    req.session.adminLoggedIn = true;
    req.session.staffLoggedIn = true;
    req.session.staffUser = {
      username, role: 'superadmin', name: 'Super Admin',
      canScanQR: true, canViewBookings: true, canManageEvents: true, canSellTickets: true
    };
    req.session.adminUser = username;
    req.session.superAdminUser = username;

    return req.session.save((err) => {
      if (err) { console.error('Session save error:', err); return res.redirect('/staff/login'); }
      return res.redirect('/superadmin');
    });
  }

  // ── 2. DB staff ──
  try {
    const member = await Staff.findOne({ username: username.trim() });

    if (!member) {
      return res.render('staff/login', { title: 'Staff Login — MEE', error: 'Invalid username or password.' });
    }
    if (!member.isActive) {
      return res.render('staff/login', { title: 'Staff Login — MEE', error: 'Your account is blocked. Contact the super admin.' });
    }

    let ok = false;
    if (member.password && member.password.startsWith('$2')) {
      ok = await bcrypt.compare(password, member.password);
    } else {
      ok = (member.password === password);
    }

    if (!ok) {
      return res.render('staff/login', { title: 'Staff Login — MEE', error: 'Invalid username or password.' });
    }

    req.session.staffLoggedIn = true;
    req.session.staffUser = {
      id: member._id.toString(),
      username: member.username,
      name: (member.firstName + ' ' + (member.lastName || '')).trim(),
      role: member.role,
      canScanQR: !!member.canScanQR,
      canViewBookings: !!member.canViewBookings,
      canManageEvents: !!member.canManageEvents,
      canSellTickets: !!member.canSellTickets,
    };

    if (member.role === 'superadmin') {
      req.session.superAdminLoggedIn = true;
      req.session.superAdminUser = member.username;
      req.session.adminLoggedIn = true;
      req.session.adminUser = member.username;
    } else if (member.role === 'admin' || member.canManageEvents) {
      req.session.adminLoggedIn = true;
      req.session.adminUser = member.username;
    }

    let dest = '/staff/dashboard';
    if (member.role === 'superadmin') dest = '/superadmin';
    else if (member.role === 'admin') dest = '/admin';
    else if (member.canSellTickets) dest = '/staff/sell';
    else if (member.canScanQR) dest = '/staff/scanner';

    return req.session.save((err) => {
      if (err) { console.error('Session save error:', err); return res.redirect('/staff/login'); }
      res.redirect(dest);
      if (!member.password.startsWith('$2')) {
        bcrypt.hash(password, 10)
          .then(hashed => Staff.findByIdAndUpdate(member._id, { password: hashed }))
          .then(() => console.log(`🔐 Password upgraded for: ${member.username}`))
          .catch(e => console.warn('Hash upgrade failed:', e.message));
      }
    });

  } catch (err) {
    console.error('Staff login error:', err);
    return res.render('staff/login', { title: 'Staff Login — MEE', error: 'Server error. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────────────────────


router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Session destroy error:', err);
    // Clear the session cookie from the browser
    res.clearCookie('mee.sid', { path: '/' });
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.redirect('/staff/login');
  });
});

// ─────────────────────────────────────────────────────────────
// AUTH MIDDLEWARE
// ─────────────────────────────────────────────────────────────

const staffAuth = require('../middleware/staffAuth');


// ─────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────
router.get('/dashboard', staffAuth, (req, res) => {
  const u = req.session.staffUser;
  if (u.role === 'superadmin') return res.redirect('/superadmin');
  if (u.role === 'admin') return res.redirect('/admin');
  if (u.canSellTickets) return res.redirect('/staff/sell');
  if (u.canScanQR) return res.redirect('/staff/scanner');
  res.render('staff/dashboard', { title: 'Staff Dashboard — MEE', staffUser: u });
});

// ─────────────────────────────────────────────────────────────
// QR SCANNER
// ─────────────────────────────────────────────────────────────
router.get('/scanner', staffAuth, (req, res) => {
  const u = req.session.staffUser;
  if (!u.canScanQR && u.role !== 'admin' && u.role !== 'superadmin') {
    return res.redirect('/staff/dashboard');
  }
  res.render('staff/scanner', { title: 'QR Scanner — MEE', staffUser: u });
});

// ─────────────────────────────────────────────────────────────
// SELL PAGE
// ─────────────────────────────────────────────────────────────
router.get('/sell', staffAuth, async (req, res) => {
  const u = req.session.staffUser;
  if (!u.canSellTickets && u.role !== 'admin' && u.role !== 'superadmin') {
    return res.redirect('/staff/dashboard');
  }
  try {
    const Event = require('../models/Event');
    const Booking = require('../models/Booking');
    const SeatMap = require('../models/SeatMap');

    const events = await Event.find({ isActive: true }).sort({ date: 1 }).lean();
    const mySales = await Booking.find({ soldBy: u.username, paymentMethod: 'cash' })
      .populate('event', 'name date venue')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const seatMaps = {};
    for (const ev of events) {
      const sm = await SeatMap.findOne({ event: ev._id, isActive: true }).lean();
      if (sm) seatMaps[ev._id.toString()] = sm;
    }

    res.render('staff/sell', {
      title: 'Sell Tickets — MEE',
      staffUser: u,
      events,
      mySales,
      seatMaps: JSON.stringify(seatMaps),
    });
  } catch (err) {
    console.error('Sell page error:', err);
    res.redirect('/staff/dashboard');
  }
});


router.post('/api/sell', staffAuth, async (req, res) => {
  const u = req.session.staffUser;
  if (!u.canSellTickets && u.role !== 'admin' && u.role !== 'superadmin') {
    return res.json({ success: false, message: 'No sell permission.' });
  }
  try {
    const { eventId, ticketType, quantity, attendees, buyerPhone, buyerEmail, buyerName, zone } = req.body;

    if (!buyerPhone && !buyerEmail) {
      return res.json({ success: false, message: 'Phone or email is required.' });
    }

    const qty = parseInt(quantity) || 1;

    const Event = require('../models/Event');
    const Booking = require('../models/Booking');
    const SeatMap = require('../models/SeatMap');
    const { generateTicketId, generateSharedQR } = require('../utils/qrHelper');
    // ✅ CHANGE: import seat helpers
    const { assignSeatNumbers, isStandingCategory, fetchFreshTtype } = require('../utils/seatHelper');

    const event = await Event.findOne({ _id: eventId, isActive: true });
    if (!event) return res.json({ success: false, message: 'Event not found.' });

    const ttype = event.ticketTypes.find(
      t => (t.category || '').toLowerCase() === (ticketType || '').toLowerCase()
    );
    if (!ttype) return res.json({ success: false, message: 'Invalid ticket category.' });
    if (!ttype.isActive) return res.json({ success: false, message: 'This ticket category is not available.' });

    const availableSeats = ttype.totalSeats - ttype.bookedSeats;
    if (availableSeats < qty) {
      const left = Math.max(0, availableSeats);
      if (left <= 0) return res.json({ success: false, message: `Sorry, ${ttype.category} tickets are sold out.` });
      return res.json({ success: false, message: `Only ${left} seat(s) left — not enough for ${qty}.` });
    }

    // ── Atomic seat reservation ──
    const maxBookedAllowed = ttype.totalSeats - qty;

    const reservedEvent = await Event.findOneAndUpdate(
      {
        _id: event._id,
        ticketTypes: {
          $elemMatch: {
            _id: ttype._id,
            isActive: true,
            bookedSeats: { $gte: 0, $lte: maxBookedAllowed },
          }
        }
      },
      { $inc: { 'ticketTypes.$[tt].bookedSeats': qty } },
      { arrayFilters: [{ 'tt._id': ttype._id }], new: true }
    );

    if (!reservedEvent) {
      const freshEvent = await Event.findById(event._id);
      const freshTtype = freshEvent?.ticketTypes?.id(ttype._id);
      const left = freshTtype ? Math.max(0, freshTtype.totalSeats - freshTtype.bookedSeats) : 0;
      if (left <= 0) return res.json({ success: false, message: `Sorry, ${ttype.category} tickets are sold out.` });
      return res.json({ success: false, message: `Only ${left} seat(s) left — not enough for your order of ${qty}.` });
    }

    // ── Zone capacity check ──
    if (zone) {
      const sm = await SeatMap.findOne({ event: event._id, isActive: true }).lean();
      if (sm) {
        const sec = sm.sections.find(s => s.name === zone);
        if (sec) {
          const za = sec.totalSeats - sec.bookedSeats;
          if (za < qty) {
            await Event.updateOne(
              { _id: event._id, 'ticketTypes._id': ttype._id, 'ticketTypes.bookedSeats': { $gte: qty } },
              { $inc: { 'ticketTypes.$.bookedSeats': -qty } }
            ).catch(() => { });
            return res.json({ success: false, message: `Only ${Math.max(0, za)} seats in zone "${zone}".` });
          }
        }
      }
    }

    const standing = isStandingCategory(ttype);
    const gateNumber = ttype.gateNumber || '';
    const pricePerTicket = ttype.price;
    const convFee = event.convenienceFee || 0;

    let discount = 0;
    if (Array.isArray(ttype.discountTiers) && ttype.discountTiers.length > 0) {
      const app = ttype.discountTiers
        .filter(d => d.minQty > 0 && d.discount > 0 && qty >= d.minQty)
        .sort((a, b) => b.minQty - a.minQty);
      if (app.length > 0) {
        const bestTier = app[0];
        const groups = Math.floor(qty / bestTier.minQty);
        discount = groups * bestTier.discount;
      }
    } else if (ttype.comboOfferMinQty > 0 && ttype.comboOfferDiscount > 0 && qty >= ttype.comboOfferMinQty) {
      const groups = Math.floor(qty / ttype.comboOfferMinQty);
      discount = groups * ttype.comboOfferDiscount;
    }

    const totalAmount = Math.max(0, pricePerTicket * qty - discount + convFee);

    // ── Build tickets WITHOUT seatNumber — assigned atomically below ──
    const attArr = Array.isArray(attendees) ? attendees : [attendees];
    const tickets = [];
    for (let i = 0; i < qty; i++) {
      const att = attArr[i] || attArr[0] || {};
      tickets.push({
        ticketId: generateTicketId(i),
        // ✅ CHANGE: no seatNumber here
        isStanding: standing,
        sectionName: zone || null,
        attendee: {
          name: att.name || buyerName || 'Guest',
          age: parseInt(att.age) || 0,
          gender: att.gender || '',
          special: att.special || '',
        },
        qrData: '',
        qrCode: '',
      });
    }

    // ✅ CHANGE: assign seat numbers atomically using shared engine
    const freshTtypeForSeats = await fetchFreshTtype(event._id, ttype.category);
    await assignSeatNumbers(event._id, freshTtypeForSeats || ttype, tickets);

    // ── Generate booking ref ──
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let bookingRef = 'MEE-CASH-';
    for (let i = 0; i < 6; i++) bookingRef += chars[Math.floor(Math.random() * chars.length)];

    const fakePayId = 'CASH_' + Date.now();

    const booking = await Booking.create({
      event: event._id,
      user: null,
      ticketType: ttype.category,
      pricePerTicket,
      quantity: qty,
      subtotal: pricePerTicket * qty,
      discount,
      convenienceFee: convFee,
      totalAmount,
      paymentStatus: 'paid',
      paymentMethod: 'cash',
      paymentId: fakePayId,
      orderId: 'CASH_' + Date.now(),
      bookingRef,
      contactPhone: buyerPhone ? String(buyerPhone).replace(/\D/g, '') : '',
      contactEmail: buyerEmail ? buyerEmail.trim().toLowerCase() : '',
      contactName: buyerName ? buyerName.trim() : (tickets[0]?.attendee?.name || 'Guest'),
      tickets,
      soldBy: u.username,
      gateNumber,
    });

    // Generate shared QR
    try {
      await generateSharedQR(booking.tickets, {
        bookingRef: booking.bookingRef,
        eventId: event._id.toString(),
        paymentId: fakePayId,
        ticketType: ttype.category,
      });
      await booking.save();
    } catch (qrErr) {
      console.error('Shared QR gen error (cash sale):', qrErr.message);
    }

    if (zone) {
      SeatMap.updateOne(
        { event: event._id, 'sections.name': zone },
        { $inc: { 'sections.$.bookedSeats': qty } }
      ).catch(() => { });
    }

    const phone = buyerPhone ? String(buyerPhone).replace(/\D/g, '') : '';
    const email = buyerEmail || '';
    const guestName = booking.tickets[0].attendee.name;
    try {
      const { sendWhatsAppTickets } = require('../utils/whatsappHelper');
      const { sendBookingConfirmation } = require('../utils/emailHelper');
      if (phone) sendWhatsAppTickets({ phone, name: guestName, booking, event }).catch(() => { });
      if (email) sendBookingConfirmation({ to: email, name: guestName, booking, event }).catch(() => { });
    } catch (ne) { console.warn('Notify error:', ne.message); }

    console.log(`💵 Cash sale: ${bookingRef} by ${u.username} | ${qty}× ${ttype.category} | ₹${totalAmount} (disc: ₹${discount}) | gate: ${gateNumber || 'N/A'}`);

    return res.json({
      success: true,
      bookingId: booking._id,
      bookingRef: booking.bookingRef,
      tickets: booking.tickets.map(t => ({
        ticketId: t.ticketId,
        attendee: t.attendee.name,
        seatNumber: t.isStanding ? null : t.seatNumber,
        gateNumber: gateNumber || null,
        qrCode: t.qrCode,
      })),
      event: { name: event.name, date: event.date, venue: event.venue, doorsOpen: event.doorsOpen },
      totalAmount,
      discount,
    });
  } catch (err) {
    console.error('Sell API error:', err);
    return res.json({ success: false, message: err.message });
  }
});



// ─────────────────────────────────────────────────────────────
// API: My sales history
// ─────────────────────────────────────────────────────────────
router.get('/api/my-sales', staffAuth, async (req, res) => {
  try {
    const u = req.session.staffUser;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const Booking = require('../models/Booking');
    const total = await Booking.countDocuments({ soldBy: u.username, paymentMethod: 'cash' });
    const sales = await Booking.find({ soldBy: u.username, paymentMethod: 'cash' })
      .populate('event', 'name date venue')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    res.json({ success: true, sales, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// API: Fresh event data
// ─────────────────────────────────────────────────────────────
router.get('/api/event/:eventId', staffAuth, async (req, res) => {
  try {
    const Event = require('../models/Event');
    const event = await Event.findOne({ _id: req.params.eventId, isActive: true }).lean();
    if (!event) return res.json({ success: false, message: 'Event not found.' });
    res.json({ success: true, event });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.get('/api/seatmap/:eventId', staffAuth, async (req, res) => {
  try {
    const SeatMap = require('../models/SeatMap');
    const sm = await SeatMap.findOne({ event: req.params.eventId, isActive: true }).lean();
    if (!sm) return res.json({ success: false, message: 'No active seat map.' });
    res.json({ success: true, seatMap: sm });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// API: Scan QR
// ─────────────────────────────────────────────────────────────
router.post('/api/scan', staffAuth, async (req, res) => {
  try {
    const u = req.session.staffUser;
    if (!u.canScanQR && u.role !== 'admin' && u.role !== 'superadmin') {
      return res.json({ success: false, message: 'No scan permission.' });
    }

    const { qrData, ticketId, bookingRef, checkInAll } = req.body;
    const Booking = require('../models/Booking');

    let payload = null;
    if (qrData) {
      try { payload = typeof qrData === 'string' ? JSON.parse(qrData) : qrData; } catch { }
    }

    const lookupRef = payload?.b || bookingRef || null;
    const lookupTicketId = payload?.t || ticketId || null;

    if (!lookupRef && !lookupTicketId) {
      return res.json({ success: false, status: 'invalid', message: 'No ticket data provided.' });
    }

    let booking = null;
    if (lookupRef) {
      booking = await Booking.findOne({ bookingRef: lookupRef, paymentStatus: 'paid' }).populate('event', 'name date venue');
    }
    if (!booking && lookupTicketId) {
      booking = await Booking.findOne({ 'tickets.ticketId': lookupTicketId, paymentStatus: 'paid' }).populate('event', 'name date venue');
    }
    if (!booking) {
      return res.json({ success: false, status: 'invalid', message: 'Booking not found or payment not confirmed.' });
    }

    if (checkInAll) {
      const alreadyAllUsed = booking.tickets.every(t => t.isUsed);
      if (alreadyAllUsed) {
        return res.json({
          success: false,
          status: 'used',
          message: `All ${booking.tickets.length} attendees already checked in.`,
          booking: _buildBookingResponse(booking, u),
        });
      }

      const now = new Date();
      let checkedInCount = 0;
      booking.tickets.forEach(t => {
        if (!t.isUsed) {
          t.isUsed = true;
          t.usedAt = now;
          t.usedBy = u.username;
          checkedInCount++;
        }
      });
      await booking.save();

      try {
        const ScanLog = require('../models/ScanLog');
        for (const t of booking.tickets) {
          if (t.usedAt?.getTime() === now.getTime()) {
            await ScanLog.create({
              booking: booking._id,
              event: booking.event._id,
              ticketId: t.ticketId,
              bookingRef: booking.bookingRef,
              attendeeName: t.attendee?.name || '',
              attendeeAge: t.attendee?.age || 0,
              attendeeGender: t.attendee?.gender || '',
              ticketType: booking.ticketType || '',
              scannedBy: u.username,
              staffName: u.name || u.username,
              isGroup: booking.tickets.length > 1,
              groupSize: booking.tickets.length,
            });
          }
        }
      } catch (e) { console.error('ScanLog error:', e.message); }

      return res.json({
        success: true,
        status: 'valid',
        message: `✓ All ${checkedInCount} attendee(s) checked in`,
        booking: _buildBookingResponse(booking, u),
        scannedBy: u.name,
      });
    }

    const usedCount = booking.tickets.filter(t => t.isUsed).length;
    const allUsed = usedCount === booking.tickets.length;

    return res.json({
      success: true,
      status: allUsed ? 'used' : 'valid',
      message: allUsed
        ? `All ${booking.tickets.length} attendees already checked in`
        : `${booking.tickets.length - usedCount} of ${booking.tickets.length} pending check-in`,
      booking: _buildBookingResponse(booking, u),
      scannedBy: u.name,
    });

  } catch (err) {
    console.error('Scan error:', err);
    res.json({ success: false, status: 'error', message: 'Server error. Try again.' });
  }
});

// ─────────────────────────────────────────────────────────────
// API: Check in a SINGLE attendee
// ─────────────────────────────────────────────────────────────
router.post('/api/scan-ticket', staffAuth, async (req, res) => {
  try {
    const u = req.session.staffUser;
    if (!u.canScanQR && u.role !== 'admin' && u.role !== 'superadmin') {
      return res.json({ success: false, message: 'No scan permission.' });
    }

    const { ticketId, bookingRef } = req.body;
    if (!ticketId) return res.json({ success: false, message: 'ticketId is required.' });

    const Booking = require('../models/Booking');

    const booking = await Booking.findOne({
      bookingRef,
      paymentStatus: 'paid',
    }).populate('event', 'name date venue');

    if (!booking) {
      return res.json({ success: false, status: 'invalid', message: 'Booking not found.' });
    }

    const ticket = booking.tickets.find(t => t.ticketId === ticketId);
    if (!ticket) {
      return res.json({ success: false, status: 'invalid', message: 'Ticket not found in this booking.' });
    }

    if (ticket.isUsed) {
      return res.json({
        success: false,
        status: 'used',
        message: `${ticket.attendee?.name || 'Attendee'} is already checked in.`,
        usedAt: ticket.usedAt,
        usedBy: ticket.usedBy,
        booking: _buildBookingResponse(booking, u),
      });
    }

    ticket.isUsed = true;
    ticket.usedAt = new Date();
    ticket.usedBy = u.username;
    await booking.save();

    try {
      const ScanLog = require('../models/ScanLog');
      await ScanLog.create({
        booking: booking._id,
        event: booking.event._id,
        ticketId: ticket.ticketId,
        bookingRef: booking.bookingRef,
        attendeeName: ticket.attendee?.name || '',
        attendeeAge: ticket.attendee?.age || 0,
        attendeeGender: ticket.attendee?.gender || '',
        ticketType: booking.ticketType || '',
        scannedBy: u.username,
        staffName: u.name || u.username,
        isGroup: booking.tickets.length > 1,
        groupSize: booking.tickets.length,
      });
    } catch (e) { console.error('ScanLog error:', e.message); }

    return res.json({
      success: true,
      status: 'valid',
      message: `✓ ${ticket.attendee?.name || 'Attendee'} checked in`,
      ticketId: ticket.ticketId,
      attendee: ticket.attendee?.name,
      seatNumber: ticket.isStanding ? null : (ticket.seatNumber || null),
      gateNumber: booking.gateNumber || null,  // ✅ include gate number in scan response
      booking: _buildBookingResponse(booking, u),
      scannedBy: u.name,
    });

  } catch (err) {
    console.error('scan-ticket error:', err);
    res.json({ success: false, status: 'error', message: 'Server error. Try again.' });
  }
});

// ─────────────────────────────────────────────────────────────
// HELPER: Build standardised booking response for scanner UI
// ─────────────────────────────────────────────────────────────
function _buildBookingResponse(booking, u) {
  return {
    bookingRef: booking.bookingRef,
    ticketType: booking.ticketType,
    quantity: booking.quantity,
    gateNumber: booking.gateNumber || null,  // ✅ include gate number in scanner response
    event: {
      name: booking.event?.name,
      date: booking.event?.date,
      venue: booking.event?.venue,
    },
    tickets: booking.tickets.map(t => ({
      ticketId: t.ticketId,
      seatNumber: t.isStanding ? null : (t.seatNumber || null),
      isStanding: !!t.isStanding,
      isUsed: t.isUsed,
      usedAt: t.usedAt || null,
      usedBy: t.usedBy || null,
      attendee: {
        name: t.attendee?.name || 'Guest',
        age: t.attendee?.age || 0,
        gender: t.attendee?.gender || '',
      },
    })),
  };
}


// ── PDF download for staff sell page / reprint ──
// GET /staff/api/booking-pdf/:bookingId
router.get('/api/booking-pdf/:bookingId', staffAuth, async (req, res) => {
  try {
    const Booking = require('../models/Booking');
    const Event = require('../models/Event');
    const { generateTicketPDF } = require('../utils/pdfHelper');

    // Staff can reprint any cash booking, admins can reprint all
    const u = req.session.staffUser;
    const query = {
      _id: req.params.bookingId,
      paymentStatus: 'paid',
    };
    // Non-admin staff can only reprint their own sales
    if (u.role !== 'superadmin' && u.role !== 'admin') {
      query.soldBy = u.username;
    }

    const booking = await Booking.findOne(query).populate('event').lean();
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found.' });

    // ✅ Resolve gate number
    if (!booking.gateNumber && booking.event) {
      const ttype = (booking.event.ticketTypes || []).find(
        t => (t.category || '').toLowerCase() === (booking.ticketType || '').toLowerCase()
      );
      booking.gateNumber = ttype?.gateNumber || '';
    }

    let sponsors = [];
    try {
      const Sponsor = require('../models/Sponsor');
      sponsors = await Sponsor.find({ isActive: true, showOnTicket: true })
        .sort({ order: 1 }).lean();
    } catch (e) { }

    const pdfBuffer = await generateTicketPDF({
      booking,
      event: booking.event,
      sponsors,
    });

    const filename = `MEE_${booking.bookingRef}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': pdfBuffer.length,
      'Cache-Control': 'no-store',
    });
    res.send(pdfBuffer);

  } catch (err) {
    console.error('Staff PDF download error:', err);
    res.status(500).json({ success: false, message: 'PDF generation failed: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// API: Get single booking for reprint
// ─────────────────────────────────────────────────────────────
router.get('/api/booking/:bookingId', staffAuth, async (req, res) => {
  try {
    const Booking = require('../models/Booking');
    const u = req.session.staffUser;

    const query = {
      _id: req.params.bookingId,
      paymentStatus: 'paid',
    };
    // Non-admin staff can only reprint their own sales
    if (u.role !== 'superadmin' && u.role !== 'admin') {
      query.soldBy = u.username;
    }

    const booking = await Booking.findOne(query)
      .populate('event', 'name date venue doorsOpen ticketTypes')
      .lean();

    if (!booking) {
      return res.json({ success: false, message: 'Booking not found.' });
    }

    // Resolve gate number if missing
    if (!booking.gateNumber && booking.event) {
      const ttype = (booking.event.ticketTypes || []).find(
        t => (t.category || '').toLowerCase() === (booking.ticketType || '').toLowerCase()
      );
      booking.gateNumber = ttype?.gateNumber || '';
    }

    // Resolve pricePerTicket
    if (!booking.pricePerTicket && booking.event) {
      const ttype = (booking.event.ticketTypes || []).find(
        t => (t.category || '').toLowerCase() === (booking.ticketType || '').toLowerCase()
      );
      booking.pricePerTicket = ttype?.price || 0;
    }

    return res.json({
      success: true,
      bookingId: booking._id,
      bookingRef: booking.bookingRef,
      ticketType: booking.ticketType,
      pricePerTicket: booking.pricePerTicket,
      totalAmount: booking.totalAmount,
      event: booking.event,
      tickets: booking.tickets.map(t => ({
        ticketId: t.ticketId,
        attendee: t.attendee?.name || 'Guest',
        seatNumber: t.isStanding ? null : (t.seatNumber || null),
        gateNumber: booking.gateNumber || null,
        qrCode: t.qrCode || '',
      })),
    });

  } catch (err) {
    console.error('Booking fetch error:', err);
    res.json({ success: false, message: err.message });
  }
});

module.exports = router;