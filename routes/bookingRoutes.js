  const express    = require('express');
  const router     = express.Router();
  const bc         = require('../controllers/bookingController');
  const { requireAuth } = require('../middleware/auth');
  const SeatMap    = require('../models/SeatMap');
  const Event      = require('../models/Event');


  const guardBookingEvent = async (req, res, next) => {
    try {
      const event = await Event.findById(req.params.eventId);
      if (!event)                            return res.redirect('/coming-soon?reason=no-event');
      if (!event.isActive)                   return res.redirect('/coming-soon?reason=inactive');
      if (new Date(event.date) < new Date()) return res.redirect('/coming-soon?reason=expired');
      req.event = event;
      next();
    } catch (err) {
      res.redirect('/coming-soon?reason=no-event');
    }
  };

  // ── NAMED ROUTES — must come BEFORE wildcard /:eventId ──────────────────────

  router.get('/my-bookings',            requireAuth, bc.getMyBookings);
  router.get('/ticket/:bookingId',      requireAuth, bc.getTicket);          // legacy → redirects to /success/
  router.get('/success/:bookingId',     requireAuth, bc.getSuccessPage);     // Step 4: success/download

  // Step 1 — Seat picker
  router.get('/seatmap/:eventId',  requireAuth, guardBookingEvent, bc.getSeatPicker);


  // Step 1 → Step 2 redirect helper (API seat-hold check kept)
  router.post('/seatmap/:eventId/hold', async (req, res) => {
    try {
      const { seatIds } = req.body;
      const seatMap = await SeatMap.findOne({ event: req.params.eventId, isActive: true });
      if (!seatMap) return res.json({ success: false, message: 'No seat map found' });
      const unavailable = [];
      seatMap.sections.forEach(sec => {
        sec.seats.forEach(seat => {
          if (seatIds.includes(seat.seatId) && seat.status !== 'available') unavailable.push(seat.seatId);
        });
      });
      if (unavailable.length) return res.json({ success: false, message: `Seats taken: ${unavailable.join(', ')}` });
      res.json({ success: true });
    } catch(err) {
      res.json({ success: false, message: err.message });
    }
  });

  // Step 2 — Attendee details
  router.get('/details/:eventId',  requireAuth, guardBookingEvent, bc.getDetailsPage);


  // Step 3 — Retry payment (for pending/failed bookings)
  router.get('/retry-payment/:bookingId',      requireAuth, bc.retryPayment);
  router.post('/retry-payment-api/:bookingId', requireAuth, bc.retryPaymentApi);

  // ── API ROUTES ───────────────────────────────────────────────────────────────
  router.post('/create-order',      requireAuth, bc.createOrder);
  router.post('/verify-payment',    requireAuth, bc.verifyPayment);
  router.post('/save-pending',      requireAuth, bc.savePending);
  router.post('/save-failed',       requireAuth, bc.saveFailed);
  router.get('/api/event',          bc.getEventData);
  router.get('/api/events',         bc.getAllEvents);

  // ── PDF DOWNLOAD — converts HTML ticket to real PDF via Puppeteer ────────────
  router.get('/pdf/:bookingId', requireAuth, async (req, res) => {
    let browser;
    try {
      const Booking            = require('../models/Booking');
      const { generateTicketPDF } = require('../utils/pdfHelper');
      const puppeteer          = require('puppeteer');

      const booking = await Booking.findOne({
        _id:  req.params.bookingId,
        user: req.user._id,
      }).populate('event').lean();

      if (!booking || booking.paymentStatus !== 'paid') {
        return res.status(404).send('Booking not found.');
      }

      // If gateNumber not on booking doc, look it up from event ticketType
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
      } catch(e) { /* sponsors are optional */ }

      // Step 1: generateTicketPDF returns an HTML Buffer
      const htmlBuffer = await generateTicketPDF({
        booking,
        event: booking.event,
        sponsors,
      });

      // Step 2: Launch Puppeteer and render HTML → real PDF
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--allow-file-access-from-files',   // ← lets Puppeteer load file:// background image
          '--disable-web-security',
        ],
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1122, height: 794 }); // A4 landscape at 96dpi

      await page.setContent(htmlBuffer.toString('utf8'), {
        waitUntil: 'domcontentloaded',  // don't wait for Google Fonts, loads faster
        timeout:   30000,
      });

      const pdfBuffer = await page.pdf({
        format:          'A4',
        landscape:       true,
        printBackground: true,
        margin:          { top: 0, right: 0, bottom: 0, left: 0 },
      });

      await browser.close();
      browser = null;

      // Step 3: Send the real PDF
      const filename = `MEE_${booking.bookingRef}.pdf`;
      res.set({
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length':      pdfBuffer.length,
        'Cache-Control':       'no-store',
      });
      res.send(pdfBuffer);

    } catch (err) {
      if (browser) await browser.close();
      console.error('PDF download error:', err);
      res.status(500).send('PDF generation failed: ' + err.message);
    }
  });

  // ── PDF CHECK — used by ticket.ejs to check if server PDF is available ───────
  router.get('/pdf-check/:bookingId', requireAuth, async (req, res) => {
    try {
      const Booking = require('../models/Booking');
      const booking = await Booking.findOne({
        _id:  req.params.bookingId,
        user: req.user._id,
      }).select('paymentStatus bookingRef').lean();
      if (!booking || booking.paymentStatus !== 'paid') return res.json({ available: false });
      res.json({ available: true, bookingRef: booking.bookingRef });
    } catch(e) {
      res.json({ available: false });
    }
  });

  // ── WILDCARD — legacy entry points (from home / event detail "Book Now" button)
  // These redirect to the proper step 1 or step 2 based on whether a seatmap exists
  router.get('/',           requireAuth, bc.getBookingPage);
  router.get('/:eventId',   requireAuth, bc.getBookingPage);

  module.exports = router;