const express = require('express');
  const router = express.Router();
  const Event = require('../models/Event');
  const Banner = require('../models/Banner');
  const Referral = require('../models/Referral');
  const { optionalAuth, noCache } = require('../middleware/auth');

  const renderComingSoon = async (res, user) => {
    try {
      const anyEvent = await Event.findOne({}).sort({ date: -1 });
      let reason = 'no-event';
      if (anyEvent) {
        if (!anyEvent.isActive) reason = 'inactive';
        else if (new Date(anyEvent.date) < new Date()) reason = 'expired';
      }
      return res.render('pages/coming-soon', { title: 'Coming Soon — MEE', reason, user: user || null });
    } catch (e) {
      return res.render('pages/coming-soon', { title: 'Coming Soon — MEE', reason: 'no-event', user: user || null });
    }
  };



  // Home page — noCache ensures back button always hits server
  router.get('/', noCache, optionalAuth, async (req, res) => {
    try {
      const allEvents = await Event.find().sort({ date: -1 });
      // const events = allEvents.filter(ev => ev.isActive && new Date(ev.date) >= new Date());

// FIX — expire only after the event date (end of that day)
const events = allEvents.filter(ev => {
  if (!ev.isActive) return false;
  const eventEnd = new Date(ev.date);
  eventEnd.setHours(23, 59, 59, 999);
  return eventEnd >= new Date();
});


const pastEvents = allEvents.filter(ev => {
  const eventEnd = new Date(ev.date);
  eventEnd.setHours(23, 59, 59, 999);
  return eventEnd < new Date();
});

      // const pastEvents = allEvents.filter(ev => new Date(ev.date) < new Date());
      const banners = await Banner.find({ isVisible: true }).sort({ order: 1 }).lean();
  const featuredEvent = events[0] || null;
  if (!featuredEvent) return renderComingSoon(res, req.user);
  res.render('pages/index', {
    title: 'MEE — Book Your Event Entry',
    events, pastEvents, banners,
    event: featuredEvent,
    user: req.user || null,
  });
    } catch (err) {
      res.render('pages/index', { title: 'Melattur Entertainment Events', events: [], pastEvents: [], banners: [], event: null, user: null });
    }
  });

  router.post('/', (req, res) => {
    console.log(req.body);
    res.sendStatus(200);
  });

  router.get('/coming-soon', optionalAuth, (req, res) => {
    const allowed = ['no-event', 'expired', 'inactive'];
    const reason  = allowed.includes(req.query.reason) ? req.query.reason : 'no-event';
    res.render('pages/coming-soon', { title: 'Coming Soon — MEE', reason, user: req.user || null });
  });

  // Event detail page
  router.get('/event/:id', optionalAuth, async (req, res) => {
    try {
      const event = await Event.findById(req.params.id);
  
      if (!event)                                    return res.redirect('/coming-soon?reason=no-event');
      if (!event.isActive)                           return res.redirect('/coming-soon?reason=inactive');
      // if (new Date(event.date) < new Date())         return res.redirect('/coming-soon?reason=expired');

      const eventEnd = new Date(event.date);
eventEnd.setHours(23, 59, 59, 999);
if (eventEnd < new Date()) return res.redirect('/coming-soon?reason=expired');

      // Also fetch all active events so the detail page can show the hero slider
      const events = await Event.find({ isActive: true }).sort({ isFeatured: -1, date: 1 });
      // Find user's paid bookings for this event — to show what they've already booked
      let userBookedCategories = [];
      let userHasMultipleEntry = false;
      if (req.user) {
        const Booking = require('../models/Booking');
        const userBookings = await Booking.find({
          user: req.user._id, event: event._id, paymentStatus: 'paid'
        }).select('ticketType');
        userBookedCategories = userBookings.map(b => b.ticketType);
        // Check if any of their bookings is a multiple-entry type
        userHasMultipleEntry = event.ticketTypes
          .filter(t => userBookedCategories.includes(t.category) && t.ticketType === 'multiple')
          .length > 0;
      }
      // Fetch real reviews for this event (visible only)
      const Review = require('../models/Review');
      const realReviews = await Review.find({ event: event._id, isVisible: true })
        .populate('user', 'firstName lastName')
        .sort({ createdAt: -1 })
        .lean();

      res.render('pages/event-detail', {
        title: `${event.name} — MEE`,
        event,
        events,
        user: req.user || null,
        userBookedCategories,
        userHasMultipleEntry,
        realReviews,
      });
    } catch (err) {
      console.error('Event detail error:', err);
      res.status(500).render('pages/error', {
        title: 'Error — MEE',
        message: 'Could not load event.',
        code: 500,
      });
    }
  });

  // Payment page (GET — just renders the page, actual payment via POST API)
  router.get('/payment', optionalAuth, (req, res) => {
    res.render('pages/payment', { title: 'Payment — MEE', user: req.user || null });
  });

  // ── Referral link tracker — /r/:code ──
  router.get('/r/:code', optionalAuth, async (req, res) => {
    try {
      const code = req.params.code.toUpperCase();
      const referral = await Referral.findOne({ code });

      // Not found or deleted — redirect silently
      if (!referral) return res.redirect('/');

      // Paused — redirect silently, no tracking
      if (!referral.isActive) return res.redirect('/');

      // Active — count visit
      await Referral.findByIdAndUpdate(referral._id, { $inc: { visits: 1 } });

      // Save to session for new users who sign up after visiting
      req.session.referralCode = code;
      await new Promise(r => req.session.save(r));

      // Already logged-in user — save referral code to their profile if not already set
      if (req.user && !req.user.referralCode) {
        const User = require('../models/User');
        await User.findByIdAndUpdate(req.user._id, { referralCode: code });
        await Referral.findByIdAndUpdate(referral._id, { $inc: { signups: 1 } });
      }

    } catch (e) { /* non-fatal */ }
    res.redirect('/');
  });


  // Help & Support page
  router.get('/support', optionalAuth, (req, res) => {
    res.render('pages/support', { title: 'Help & Support — MEE', user: req.user || null });
  });

  router.get('/terms', (req, res) => {
    res.render('pages/terms', { user: req.user || null });
  });

  router.get('/privacy', (req, res) => {
    res.render('pages/privacy', { user: req.user || null });
  });

  // Support email send
  router.post('/support/send', optionalAuth, async (req, res) => {
    try {
      const { name, phone, email, subject, message } = req.body;
      if (!name || !email || !subject || !message) {
        return res.json({ success: false, message: 'All required fields must be filled.' });
      }
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: false,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      if (!process.env.SMTP_USER) {
        console.log(`📧 [Support DEV] From: ${name} <${email}> | ${subject}`);
        return res.json({ success: true });
      }
      await transporter.sendMail({
        from: `"Melattur Entertainment Events Support" <${process.env.SMTP_USER}>`,
        to: 'meemelattur@gmail.com',
        replyTo: email,
        subject: `[Melattur Entertainment Events Support] ${subject}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;"><h2>MEE Support</h2>
          <p><b>Name:</b> ${name}</p><p><b>Email:</b> ${email}</p>
          <p><b>Phone:</b> ${phone || '—'}</p><p><b>Subject:</b> ${subject}</p>
          <p><b>Message:</b><br>${message}</p></div>`,
      });
      res.json({ success: true });
    } catch (err) {
      console.error('Support email error:', err);
      res.json({ success: false, message: 'Failed to send email. Please contact us via WhatsApp.' });
    }
  });

  module.exports = router;