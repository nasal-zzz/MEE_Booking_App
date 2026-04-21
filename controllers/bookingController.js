'use strict';

const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const Razorpay = require('razorpay');
const crypto = require('crypto');
const Event = require('../models/Event');
const Booking = require('../models/Booking');
const SeatMap = require('../models/SeatMap');
const User = require('../models/User');
const { generateTicketId, generateSharedQR } = require('../utils/qrHelper');
const { sendBookingConfirmation, sendPendingPaymentReminder, sendFailedPaymentNotice } = require('../utils/emailHelper');
const {
  isStandingCategory,
  assignSeatNumbers,
  releaseSeatsToPool,   // ← replaces your local releaseSeats()
  fetchFreshTtype,
} = require('../utils/seatHelper');

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

// Look up the gateNumber for a given booking's ticket category from the event
function getGateNumber(event, ticketCategory) {
  if (!event || !event.ticketTypes) return '';
  const ttype = event.ticketTypes.find(
    t => (t.category || '').toLowerCase() === (ticketCategory || '').toLowerCase()
  );
  return ttype?.gateNumber || '';
}

// ─────────────────────────────────────────────────────────────
// STEP 1 — GET /booking/seatmap/:eventId
// ─────────────────────────────────────────────────────────────
exports.getSeatPicker = async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId);
    const seatMap = await SeatMap.findOne({ event: req.params.eventId, isActive: true }).lean();
    if (!event) return res.redirect('/');
    if (!seatMap) return res.redirect(`/booking/details/${req.params.eventId}`);
    const CAT_COLORS = { platinum: '#9D4EDD', gold: '#f5c842', silver: '#c0c8d8', fanfit: '#00FF88', family: '#FF6B6B' };
    res.render('pages/seatpicker', {
      title: `Choose Your Zone — ${event.name}`,
      event, seatMap, CAT_COLORS, user: req.user,
    });
  } catch (err) {
    console.error('getSeatPicker error:', err);
    res.redirect('/');
  }
};

// ─────────────────────────────────────────────────────────────
// STEP 2 — GET /booking/details/:eventId
// ─────────────────────────────────────────────────────────────
exports.getDetailsPage = async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId);
    if (!event) return res.redirect('/');
    res.render('pages/booking-details', {
      title: `Attendee Details — ${event.name}`,
      event,
      user: req.user,
      query: req.query,
    });
  } catch (err) {
    console.error('getDetailsPage error:', err);
    res.redirect('/');
  }
};

// ─────────────────────────────────────────────────────────────
// LEGACY — GET /booking/:eventId
// ─────────────────────────────────────────────────────────────
exports.getBookingPage = async (req, res) => {
  try {
    const eventId = req.params.eventId || null;
    const event = eventId
      ? await Event.findById(eventId)
      : await Event.findOne({ isActive: true }).sort({ date: 1 });
    if (!event) return res.redirect('/');
    const seatMap = await SeatMap.findOne({ event: event._id, isActive: true }).lean();
    if (seatMap) return res.redirect(`/booking/seatmap/${event._id}`);
    return res.redirect(`/booking/details/${event._id}`);
  } catch (err) {
    console.error('getBookingPage error:', err);
    res.redirect('/');
  }
};

// ─────────────────────────────────────────────────────────────
// POST /booking/create-order
// ─────────────────────────────────────────────────────────────
exports.createOrder = async (req, res) => {
  try {
    const { ticketType, quantity, couponCode, attendees, zone, email, whatsapp } = req.body;
    const qty = parseInt(quantity) || 1;

    const eventId = req.body.eventId || req.session.pendingEventId;
    const event = eventId
      ? await Event.findOne({ _id: eventId, isActive: true })
      : await Event.findOne({ isActive: true }).sort({ date: 1 });
    if (!event) return res.json({ success: false, message: 'Event not found.' });

    const ttype = event.ticketTypes.find(
      t => (t.category || '').trim().toLowerCase() === (ticketType || '').trim().toLowerCase()
    );
    if (!ttype) return res.json({ success: false, message: 'Invalid ticket type selected.' });
    if (!ttype.isActive) return res.json({ success: false, message: `${ttype.name || ttype.category} tickets are currently not available.` });

    const effectiveQty = ttype.ticketType === 'multiple' ? 1 : qty;
    const maxAllowed = ttype.maxPerOrder > 0 ? ttype.maxPerOrder : 10;
    if (effectiveQty > maxAllowed)
      return res.json({ success: false, message: `Max ${maxAllowed} tickets per order for ${ttype.name || ttype.category}.` });

    // Cancel old PENDING bookings and release their seats back to the pool
    const prevPending = await Booking.find({
      user: req.user._id,
      event: event._id,
      paymentStatus: 'pending',
    }).populate('event');

    for (const prev of prevPending) {
      await releaseSeatsToPool(event._id, prev.ticketType, prev)
        .catch(e => console.warn('createOrder: seat release error:', e.message));
      console.log(`🔓 createOrder: released ${prev.quantity} seats back to pool for ${prev.ticketType}`);
    }

    await Booking.updateMany(
      { user: req.user._id, event: event._id, paymentStatus: { $in: ['pending', 'failed'] } },
      { paymentStatus: 'failed' }
    ).catch(() => { });

    // ── ATOMIC SEAT RESERVATION ──
    const availableSeats = ttype.totalSeats - ttype.bookedSeats;
    if (availableSeats < effectiveQty) {
      const left = Math.max(0, availableSeats);
      if (left <= 0) return res.json({ success: false, message: `Sorry, ${ttype.name || ttype.category} tickets are sold out.` });
      return res.json({ success: false, message: `Only ${left} seat(s) left — not enough for your order of ${effectiveQty}.` });
    }

    const maxBookedSeatsAllowed = ttype.totalSeats - effectiveQty;

    const reservedEvent = await Event.findOneAndUpdate(
      {
        _id: event._id,
        ticketTypes: {
          $elemMatch: {
            _id: ttype._id,
            isActive: true,
            bookedSeats: { $gte: 0, $lte: maxBookedSeatsAllowed },
          }
        }
      },
      { $inc: { 'ticketTypes.$[tt].bookedSeats': effectiveQty } },
      { arrayFilters: [{ 'tt._id': ttype._id }], new: true }
    );

    if (!reservedEvent) {
      const freshEvent = await Event.findById(event._id);
      const freshTtype = freshEvent?.ticketTypes?.id(ttype._id);
      const left = freshTtype ? Math.max(0, freshTtype.totalSeats - freshTtype.bookedSeats) : 0;
      if (left <= 0) return res.json({ success: false, message: `Sorry, ${ttype.name || ttype.category} tickets are sold out.` });
      return res.json({ success: false, message: `Only ${left} seat(s) left — not enough for your order of ${effectiveQty}.` });
    }

    // const updatedTtype       = reservedEvent.ticketTypes.id(ttype._id);
    // const postIncBookedSeats = updatedTtype.bookedSeats;

    // console.log(`✅ Seats reserved atomically: ${effectiveQty} × ${ttype.category} | bookedSeats now: ${postIncBookedSeats}/${updatedTtype.totalSeats}`);

    const updatedTtype = reservedEvent.ticketTypes.id(ttype._id);
    console.log(`✅ Seats reserved atomically: ${effectiveQty} × ${ttype.category} | bookedSeats now: ${updatedTtype.bookedSeats}/${updatedTtype.totalSeats}`);


    // ── Pricing & coupon ──
    const pricePerTicket = ttype.price;
    const subtotal = pricePerTicket * effectiveQty;
    const convFee = event.convenienceFee || 0;
    let discount = 0;

    if (Array.isArray(ttype.discountTiers) && ttype.discountTiers.length > 0) {
      const applicable = ttype.discountTiers
        .filter(d => d.minQty > 0 && d.discount > 0 && effectiveQty >= d.minQty)
        .sort((a, b) => b.minQty - a.minQty);
      if (applicable.length > 0) {
        const bestTier = applicable[0];
        const groups = Math.floor(effectiveQty / bestTier.minQty);
        discount = groups * bestTier.discount;
      }
    } else if (ttype.comboOfferMinQty > 0 && ttype.comboOfferDiscount > 0 && effectiveQty >= ttype.comboOfferMinQty) {
      const groups = Math.floor(effectiveQty / ttype.comboOfferMinQty);
      discount = groups * ttype.comboOfferDiscount;
    }

    if (couponCode) {
      try {
        const Coupon = require('../models/Coupon');
        const coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true });
        if (coupon) {
          const now = new Date();
          const validFrom = coupon.validFrom ? new Date(coupon.validFrom) : null;
          const validUntil = coupon.validUntil ? new Date(coupon.validUntil) : null;
          if (validUntil) validUntil.setHours(23, 59, 59, 999);
          const notYet = validFrom && now < validFrom;
          const expired = validUntil && now > validUntil;
          const maxedOut = coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses;
          const belowMin = coupon.minOrder > 0 && subtotal < coupon.minOrder;
          const userId = req.session?.userId || req.session?.user?._id || null;
          const alreadyUsed = userId && coupon.usedBy && coupon.usedBy.map(id => id.toString()).includes(userId.toString());
          if (!notYet && !expired && !maxedOut && !belowMin && !alreadyUsed) {
            const couponDisc = coupon.type === 'percent'
              ? Math.round(subtotal * coupon.value / 100)
              : coupon.value;
            discount = Math.max(discount, couponDisc);
          }
        }
      } catch (e) { console.warn('Coupon error in createOrder:', e.message); }
    }

    const totalAmount = Math.max(subtotal - discount + convFee, 0);

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
    const order = await razorpay.orders.create({
      amount: totalAmount * 100,
      currency: 'INR',
      receipt: 'MEE_' + Date.now(),
    });

    try {
      const updates = {};
      if (email && !req.user.email) updates.email = email.trim().toLowerCase();
      if (whatsapp && !req.user.whatsapp) updates.whatsapp = whatsapp.trim();
      if (Object.keys(updates).length) {
        await User.findByIdAndUpdate(req.user._id, updates);
        if (updates.email) req.user.email = updates.email;
        if (updates.whatsapp) req.user.whatsapp = updates.whatsapp;
      }
    } catch (ue) { console.warn('User update error:', ue.message); }

    const attendeeList = Array.isArray(attendees) ? attendees : [attendees];
    const standing = isStandingCategory(ttype);
    const pendingTickets = [];
    for (let i = 0; i < effectiveQty; i++) {
      const att = attendeeList[i] || attendeeList[0] || { name: req.user.firstName, age: 25 };
      pendingTickets.push({
        ticketId: generateTicketId(i),
        attendee: { name: att.name || req.user.firstName, age: parseInt(att.age) || 25, gender: att.gender || '', special: att.special || '' },
        qrCode: '',
        qrData: '',
        isStanding: standing,
      });
    }

    const pendingBookingDoc = await Booking.create({
      user: req.user._id,
      event: event._id,
      ticketType: ttype.category,
      pricePerTicket,
      quantity: effectiveQty,
      subtotal,
      discount,
      couponCode: couponCode ? couponCode.toUpperCase() : null,
      convenienceFee: convFee,
      totalAmount,
      gateNumber: ttype.gateNumber || '',
      tickets: pendingTickets,
      paymentStatus: 'pending',
      orderId: order.id,
      contactPhone: req.user.phone || '',
      contactEmail: email ? email.trim().toLowerCase() : (req.user.email || ''),
      contactName: (req.user.firstName + ' ' + (req.user.lastName || '')).trim(),
    });

    console.log('💾 Pending booking saved:', pendingBookingDoc.bookingRef, '| order:', order.id);

    req.session.pendingBooking = {
      bookingId: pendingBookingDoc._id.toString(),
      eventId: event._id.toString(),
      ticketType: ttype.category,
      zone: zone || '',
      quantity: effectiveQty,
      pricePerTicket,
      subtotal,
      discount,
      couponCode: couponCode ? couponCode.toUpperCase() : null,
      convenienceFee: convFee,
      totalAmount,
      gateNumber: ttype.gateNumber || '',
      attendees: attendeeList,
      orderId: order.id,
      contactEmail: email ? email.trim().toLowerCase() : (req.user.email || ''),
      contactWhatsapp: whatsapp ? whatsapp.trim() : (req.user.whatsapp || req.user.phone || ''),
      // postIncBookedSeats: postIncBookedSeats,
      isStanding: standing,
    };

    await new Promise((resolve, reject) => {
      req.session.save(err => err ? reject(err) : resolve());
    });

    return res.json({
      success: true,
      orderId: order.id,
      amount: totalAmount * 100,
      key: process.env.RAZORPAY_KEY_ID,
      currency: 'INR',
      prefill: {
        name: (req.user.firstName + ' ' + (req.user.lastName || '')).trim(),
        email: email || req.user.email || '',
        contact: req.user.phone || '',
      },
    });
  } catch (err) {
    console.error('createOrder error:', err);
    res.json({ success: false, message: 'Failed to create order: ' + err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// POST /booking/save-pending
// ─────────────────────────────────────────────────────────────
exports.savePending = async (req, res) => {
  try {
    const pending = req.session.pendingBooking;
    if (!pending) return res.json({ success: true });

    let bookingDoc = null;
    if (pending.bookingId) {
      bookingDoc = await Booking.findById(pending.bookingId).populate('event').catch(() => null);
    } else if (pending.orderId) {
      bookingDoc = await Booking.findOne({ orderId: pending.orderId }).populate('event').catch(() => null);
    }

    const shouldRelease = bookingDoc?.paymentStatus === 'pending';

    if (shouldRelease && pending.eventId && pending.ticketType && bookingDoc) {
      await releaseSeatsToPool(pending.eventId, pending.ticketType, bookingDoc)
        .catch(e => console.warn('savePending seat release error:', e.message));
      console.log(`🔓 savePending: released seats for ${pending.ticketType}`);
    }

    const name = req.user?.firstName || 'Customer';
    const email = pending.contactEmail || req.user?.email || '';
    const phone = pending.contactWhatsapp || req.user?.whatsapp || req.user?.phone || '';

    if (bookingDoc && bookingDoc.paymentStatus === 'pending' && (email || phone)) {
      try {
        const eventDoc = await Event.findById(pending.eventId).lean();
        if (eventDoc) {
          // if (email) {
          //   sendPendingPaymentReminder({ to: email, name, booking: bookingDoc, event: eventDoc }).catch(() => { });
          // }
          if (phone) {
            const { sendWhatsAppPending } = require('../utils/whatsappHelper');
            sendWhatsAppPending({ phone, name, booking: bookingDoc, event: eventDoc }).catch(() => { });
          }
        }
      } catch (ne) { console.warn('savePending notify error:', ne.message); }
    }
  } catch (e) { console.warn('savePending error:', e.message); }
  return res.json({ success: true });
};

exports.checkExistingBooking = async (req, res) => {
  try {
    const { eventId } = req.query;
    if (!eventId || !req.user) return res.json({ exists: false });
    const existing = await Booking.findOne({
      user: req.user._id,
      event: eventId,
      paymentStatus: { $in: ['pending', 'failed'] },
    }).sort({ createdAt: -1 }).select('_id bookingRef paymentStatus totalAmount ticketType quantity createdAt');
    if (existing) return res.json({ exists: true, booking: existing });
    return res.json({ exists: false });
  } catch (e) {
    return res.json({ exists: false });
  }
};

// ─────────────────────────────────────────────────────────────
// POST /booking/save-failed
// ─────────────────────────────────────────────────────────────
exports.saveFailed = async (req, res) => {
  try {
    const pending = req.session.pendingBooking;
    let failedBooking = null;
    let wasActuallyPending = false;

    if (pending?.bookingId) {
      const before = await Booking.findOne({ _id: pending.bookingId, paymentStatus: 'pending' }).catch(() => null);
      wasActuallyPending = !!before;

      failedBooking = await Booking.findOneAndUpdate(
        { _id: pending.bookingId, paymentStatus: { $in: ['pending', 'failed'] } },
        { paymentStatus: 'failed' },
        { new: true }
      ).populate('event').catch(() => null);
    }

    if (!failedBooking && pending?.orderId) {
      const before = await Booking.findOne({ orderId: pending.orderId, paymentStatus: 'pending' }).catch(() => null);
      if (before) wasActuallyPending = true;

      failedBooking = await Booking.findOneAndUpdate(
        { orderId: pending.orderId, paymentStatus: { $in: ['pending', 'failed'] } },
        { paymentStatus: 'failed' },
        { new: true }
      ).populate('event').catch(() => null);
    }

    if (!failedBooking && pending?.eventId && req.user?._id) {
      const before = await Booking.findOne({
        user: req.user._id, event: pending.eventId, paymentStatus: 'pending'
      }).catch(() => null);
      if (before) wasActuallyPending = true;

      failedBooking = await Booking.findOneAndUpdate(
        { user: req.user._id, event: pending.eventId, paymentStatus: { $in: ['pending', 'failed'] } },
        { paymentStatus: 'failed' },
        { new: true, sort: { createdAt: -1 } }
      ).populate('event').catch(() => null);
    }

    if (wasActuallyPending && pending?.eventId && pending?.ticketType && failedBooking) {
      await releaseSeatsToPool(pending.eventId, pending.ticketType, failedBooking)
        .catch(e => console.warn('saveFailed seat release error:', e.message));
      console.log(`🔓 Released ${pending.quantity} seats (payment failed) for ${pending.ticketType}`);
    } else if (pending?.eventId && !wasActuallyPending) {
      console.log(`ℹ️  saveFailed: booking was already failed — skipping seat release for ${pending.ticketType}`);
    }

    delete req.session.pendingBooking;
    req.session.save(() => { });

    if (!failedBooking) return res.json({ success: true });

    try {
      const eventDoc = failedBooking.event || (pending?.eventId ? await Event.findById(pending.eventId).lean() : null);
      const name = req.user?.firstName || 'Customer';
      const email = pending?.contactEmail || req.user?.email || '';
      const phone = pending?.contactWhatsapp || req.user?.whatsapp || req.user?.phone || '';

      // if (email && eventDoc) {
      //   sendFailedPaymentNotice({ to: email, name, booking: failedBooking, event: eventDoc }).catch(() => { });
      // }
      
      if (phone && eventDoc) {
        const { sendWhatsAppPaymentFailed } = require('../utils/whatsappHelper');
        sendWhatsAppPaymentFailed({ phone, name, booking: failedBooking, event: eventDoc }).catch(() => { });
      }
    } catch (ne) { console.warn('saveFailed notify error:', ne.message); }

  } catch (e) { console.warn('saveFailed error:', e.message); }
  return res.json({ success: true });
};

// ─────────────────────────────────────────────────────────────
// GET /booking/retry/:bookingId
// FIX RISK 3: If booking is 'failed', its seats were released.
// Re-reserve atomically before entering the payment flow.
// ─────────────────────────────────────────────────────────────
exports.retryPayment = async (req, res) => {
  try {
    const booking = await Booking.findOne({
      _id: req.params.bookingId,
      user: req.user._id,
    }).populate('event');

    if (!booking || !['pending', 'failed'].includes(booking.paymentStatus)) {
      return res.redirect('/booking/my-bookings');
    }

    const event = booking.event;
    if (!event || !event.isActive) return res.redirect('/booking/my-bookings');

    const ttype = event.ticketTypes.find(t => t.category === booking.ticketType);

    // ── FIX RISK 3: re-reserve seats when retrying a failed booking ──
    let postIncBookedSeats = null;

    if (booking.paymentStatus === 'failed') {
      // Seats were released when it failed — reclaim them atomically now
      const maxAllowed = ttype ? (ttype.totalSeats - booking.quantity) : 0;

      const reReserved = await Event.findOneAndUpdate(
        {
          _id: event._id,
          ticketTypes: {
            $elemMatch: {
              category: booking.ticketType,
              isActive: true,
              bookedSeats: { $gte: 0, $lte: maxAllowed },
            }
          }
        },
        { $inc: { 'ticketTypes.$.bookedSeats': booking.quantity } },
        { new: true }
      ).catch(() => null);

      if (!reReserved) {
        console.warn(`retryPayment: could not re-reserve ${booking.quantity} seats for ${booking.ticketType} — sold out`);
        return res.redirect('/booking/my-bookings?msg=sold_out');
      }

      const freshTtype = reReserved.ticketTypes.find(t => t.category === booking.ticketType);
      postIncBookedSeats = freshTtype?.bookedSeats ?? null;

      // Promote booking back to pending so verifyPayment can find and update it
      await Booking.updateOne(
        { _id: booking._id },
        { $set: { paymentStatus: 'pending' } }
      );

      console.log(`✅ retryPayment: re-reserved ${booking.quantity} seats for ${booking.ticketType} | bookedSeats now: ${postIncBookedSeats}`);
    } else {
      // Still pending — seats already held, just look up current counter
      postIncBookedSeats = ttype?.bookedSeats ?? null;
    }

    req.session.pendingBooking = {
      bookingId: booking._id.toString(),
      eventId: event._id.toString(),
      ticketType: booking.ticketType,
      quantity: booking.quantity,
      pricePerTicket: booking.pricePerTicket,
      subtotal: booking.subtotal,
      discount: booking.discount || 0,
      couponCode: booking.couponCode || null,
      convenienceFee: booking.convenienceFee,
      totalAmount: booking.totalAmount,
      gateNumber: booking.gateNumber || ttype?.gateNumber || '',
      attendees: booking.tickets.map(t => ({ name: t.attendee.name, age: t.attendee.age, special: t.attendee.special || '' })),
      postIncBookedSeats,
    };

    await new Promise((resolve, reject) => { req.session.save(err => err ? reject(err) : resolve()); });

    const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
    const order = await razorpay.orders.create({ amount: booking.totalAmount * 100, currency: 'INR', receipt: 'MEE_RETRY_' + Date.now() });

    req.session.pendingBooking.orderId = order.id;
    await new Promise((resolve, reject) => { req.session.save(err => err ? reject(err) : resolve()); });

    res.render('pages/retry-payment', {
      title: `Complete Payment — ${event.name}`,
      booking, event, order,
      user: req.user,
      rzpKey: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('retryPayment error:', err);
    res.redirect('/booking/my-bookings');
  }
};

// ─────────────────────────────────────────────────────────────
// POST /booking/verify-payment
// ─────────────────────────────────────────────────────────────
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    const pending = req.session.pendingBooking;

    if (!pending) {
      return res.json({ success: false, message: 'Session expired. Contact support with Payment ID: ' + razorpay_payment_id });
    }

    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');
    if (expectedSig !== razorpay_signature) {
      return res.json({ success: false, message: 'Payment signature verification failed.' });
    }

    const alreadyPaid = await Booking.findOne({ paymentId: razorpay_payment_id, paymentStatus: 'paid' });
    if (alreadyPaid) {
      delete req.session.pendingBooking;
      req.session.save(() => { });
      return res.json({ success: true, bookingId: alreadyPaid._id, bookingRef: alreadyPaid.bookingRef });
    }

    const existingBooking =
      (pending.bookingId ? await Booking.findOne({ _id: pending.bookingId, paymentStatus: { $in: ['pending', 'failed'] } }) : null)
      || await Booking.findOne({ orderId: razorpay_order_id, paymentStatus: { $in: ['pending', 'failed'] } })
      || await Booking.findOne({ user: req.user._id, event: pending.eventId, paymentStatus: { $in: ['pending', 'failed'] } }).sort({ createdAt: -1 });

    if (existingBooking) {
      console.log('verifyPayment: upgrading', existingBooking.paymentStatus, '-> paid:', existingBooking.bookingRef);

      const evForSeat = await Event.findById(pending.eventId).lean();
      const ttypeForSeat = evForSeat?.ticketTypes?.find(t => t.category === pending.ticketType);
      const standing = pending.isStanding ?? isStandingCategory(ttypeForSeat);
      const gateNumber = pending.gateNumber || getGateNumber(evForSeat, pending.ticketType);

      await assignSeatNumbers(
        pending.eventId,
        ttypeForSeat,
        existingBooking.tickets,
      );

      existingBooking.gateNumber = gateNumber;

      await generateSharedQR(existingBooking.tickets, {
        bookingId: existingBooking._id,
        bookingRef: existingBooking.bookingRef,
        eventId: pending.eventId,
        paymentId: razorpay_payment_id,
        ticketType: pending.ticketType,
      });

      const atomicUpdate = await Booking.findOneAndUpdate(
        { _id: existingBooking._id, paymentStatus: { $in: ['pending', 'failed'] } },
        {
          $set: {
            paymentStatus: 'paid',
            paymentId: razorpay_payment_id,
            orderId: razorpay_order_id,
            signature: razorpay_signature,
            tickets: existingBooking.tickets,
            gateNumber,
          }
        },
        { new: true }
      );

      if (!atomicUpdate) {
        console.log('verifyPayment: webhook already completed booking, skipping notifications');
        delete req.session.pendingBooking;
        req.session.save(() => { });
        return res.json({ success: true, bookingId: existingBooking._id, bookingRef: existingBooking.bookingRef });
      }

      if (pending.zone) {
        await SeatMap.updateOne(
          { event: pending.eventId, 'sections.name': pending.zone },
          { $inc: { 'sections.$.bookedSeats': pending.quantity } }
        ).catch(() => { });
      }
      if (pending.couponCode) {
        const Coupon = require('../models/Coupon');
        const _userId = req.session?.userId || req.user?._id || null;
        const _cu = { $inc: { usedCount: 1 } };
        if (_userId) _cu.$addToSet = { usedBy: _userId };
        await Coupon.findOneAndUpdate({ code: pending.couponCode }, _cu).catch(() => { });
      }
      await User.findByIdAndUpdate(req.user._id, { $addToSet: { bookings: existingBooking._id } }).catch(() => { });

      delete req.session.pendingBooking;
      req.session.save(() => { });

      try {
        const evDoc = evForSeat || await Event.findById(pending.eventId).lean();
        const notifyEmail = pending.contactEmail || req.user.email || '';
        const notifyWhatsapp = pending.contactWhatsapp || req.user.whatsapp || req.user.phone || '';
        const bookingForNotify = atomicUpdate;
        bookingForNotify.gateNumber = gateNumber;
        if (notifyEmail && evDoc) sendBookingConfirmation({ to: notifyEmail, name: req.user.firstName, booking: bookingForNotify, event: evDoc }).catch(() => { });

        if (notifyWhatsapp && evDoc) {
          const { sendWhatsAppTickets } = require('../utils/whatsappHelper');
          sendWhatsAppTickets({ phone: notifyWhatsapp, name: req.user.firstName, booking: bookingForNotify, event: evDoc }).catch(() => { });
        }
      } catch (ne) { console.warn('Notify err (pending→paid):', ne.message); }

      return res.json({ success: true, bookingId: existingBooking._id, bookingRef: existingBooking.bookingRef });
    }


    console.warn('⚠ verifyPayment: no pending booking found — checking for existing orderId before fallback create');

    const orphanedBooking = await Booking.findOne({ orderId: razorpay_order_id }).catch(() => null);
    if (orphanedBooking) {
      // A booking exists (maybe paid by webhook already) — don't create another one
      console.log('verifyPayment: orphaned booking found via orderId, skipping fallback create:', orphanedBooking.bookingRef);
      delete req.session.pendingBooking;
      req.session.save(() => { });
      return res.json({ success: true, bookingId: orphanedBooking._id, bookingRef: orphanedBooking.bookingRef });
    }

    console.warn('⚠ verifyPayment: confirmed no existing booking — proceeding with session-loss fallback create');

    const evFallback = await Event.findById(pending.eventId).lean();
    const ttypeFallback = evFallback?.ticketTypes?.find(t => t.category === pending.ticketType);
    const standingFallback = pending.isStanding ?? isStandingCategory(ttypeFallback);
    const gateNumberFallback = pending.gateNumber || getGateNumber(evFallback, pending.ticketType);

    const fbTtypeCheck = evFallback?.ticketTypes?.find(t => t.category === pending.ticketType);
    const fbMaxAllowed = fbTtypeCheck ? (fbTtypeCheck.totalSeats - pending.quantity) : 0;

    const fallbackReserved = await Event.findOneAndUpdate(
      {
        _id: pending.eventId,
        ticketTypes: {
          $elemMatch: {
            category: pending.ticketType,
            bookedSeats: { $gte: 0, $lte: fbMaxAllowed },
          }
        }
      },
      { $inc: { 'ticketTypes.$.bookedSeats': pending.quantity } },
      { new: true }
    ).catch(() => null);

    // FIX RISK 2 (also applied here): use the fresh postInc from the
    // atomic update above, not a stale snapshot from populate
    const fbTtype = fallbackReserved?.ticketTypes?.find(t => t.category === pending.ticketType);
    const fbPostInc = fbTtype?.bookedSeats ?? null;

    const attendees = pending.attendees || [];
    const ticketCount = attendees.length > 0 ? attendees.length : pending.quantity;
    const tickets = [];

    for (let i = 0; i < ticketCount; i++) {
      const att = attendees[i] || attendees[0] || { name: req.user.firstName, age: 25 };
      tickets.push({
        ticketId: generateTicketId(i),
        isStanding: standingFallback,
        attendee: {
          name: att.name || req.user.firstName,
          age: parseInt(att.age) || 25,
          gender: att.gender || '',
          special: att.special || '',
        },
        qrData: '',
        qrCode: '',
      });
    }

    // Assign seat numbers using fresh postInc (pool-first, then counter)
    await assignSeatNumbers(pending.eventId, ttypeFallback, tickets, fbPostInc, pending.quantity);

    const booking = await Booking.create({
      user: req.user._id,
      event: pending.eventId,
      ticketType: pending.ticketType,
      pricePerTicket: pending.pricePerTicket,
      quantity: pending.quantity,
      subtotal: pending.subtotal,
      discount: pending.discount || 0,
      couponCode: pending.couponCode || null,
      convenienceFee: pending.convenienceFee || 0,
      totalAmount: pending.totalAmount,
      tickets,
      paymentStatus: 'paid',
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      signature: razorpay_signature,
      contactPhone: req.user.phone || '',
      contactEmail: req.user.email || '',
      gateNumber: gateNumberFallback,
    });

    try {
      await generateSharedQR(booking.tickets, {
        bookingId: booking._id,
        bookingRef: booking.bookingRef,
        eventId: pending.eventId,
        paymentId: razorpay_payment_id,
        ticketType: pending.ticketType,
      });
      await booking.save();
    } catch (qrErr) {
      console.error('QR gen failed (booking still valid):', qrErr.message);
    }

    if (pending.zone) {
      await SeatMap.updateOne(
        { event: pending.eventId, 'sections.name': pending.zone },
        { $inc: { 'sections.$.bookedSeats': pending.quantity } }
      ).catch(() => { });
    }
    await User.findByIdAndUpdate(req.user._id, { $push: { bookings: booking._id } }).catch(() => { });

    if (req.user.referralCode) {
      const Referral = require('../models/Referral');
      Referral.findOneAndUpdate({ code: req.user.referralCode }, { $inc: { bookings: 1 } }).catch(() => { });
    }

    const notifyEmail = pending.contactEmail || req.user.email || '';
    const notifyWhatsapp = pending.contactWhatsapp || req.user.whatsapp || req.user.phone || '';
    let eventDoc = null;
    try { eventDoc = await Event.findById(pending.eventId); } catch (e) { }

    if (notifyEmail && eventDoc) sendBookingConfirmation({ to: notifyEmail, name: req.user.firstName, booking, event: eventDoc }).catch(() => { });
    if (notifyWhatsapp && eventDoc) {
      try {
        const { sendWhatsAppTickets } = require('../utils/whatsappHelper');
        sendWhatsAppTickets({ phone: notifyWhatsapp, name: req.user.firstName, booking, event: eventDoc }).catch(() => { });
      } catch (e) { }
    }

    delete req.session.pendingBooking;
    req.session.save(() => { });

    return res.json({ success: true, bookingId: booking._id, bookingRef: booking.bookingRef });
  } catch (err) {
    console.error('verifyPayment FULL ERROR:', err);
    res.json({ success: false, message: 'Booking save failed: ' + err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /booking/success/:bookingId
// ─────────────────────────────────────────────────────────────
exports.getSuccessPage = async (req, res) => {
  try {
    const booking = await Booking.findOne({
      _id: req.params.bookingId,
      user: req.user._id,
    }).populate('event');
    if (!booking || booking.paymentStatus !== 'paid') return res.redirect('/booking/my-bookings');

    if (!booking.gateNumber && booking.event) {
      booking.gateNumber = getGateNumber(booking.event, booking.ticketType);
    }

    let sponsors = [];
    try {
      const Sponsor = require('../models/Sponsor');
      sponsors = await Sponsor.find({ isActive: true, showOnTicket: true }).sort({ order: 1 }).lean();
    } catch (e) { }

    res.render('pages/ticket', {
      title: 'Booking Confirmed — MEE',
      booking,
      event: booking.event,
      user: req.user,
      sponsors,
    });
  } catch (err) {
    console.error('getSuccessPage error:', err);
    res.status(500).render('pages/error', { message: err.message, code: 500 });
  }
};

exports.getTicket = async (req, res) => {
  return res.redirect('/booking/success/' + req.params.bookingId);
};

// ─────────────────────────────────────────────────────────────
// GET /booking/my-bookings
// ─────────────────────────────────────────────────────────────
exports.getMyBookings = async (req, res) => {
  try {
    const all = await Booking.find({ user: req.user._id }).populate('event').sort({ createdAt: -1 });
    const byEvent = {};
    const noEvent = [];
    for (const b of all) {
      const evId = b.event?._id?.toString();
      if (!evId) { noEvent.push(b); continue; }
      if (!byEvent[evId]) byEvent[evId] = { paid: [], pending: [], failed: [] };
      if (b.paymentStatus === 'paid') byEvent[evId].paid.push(b);
      else if (b.paymentStatus === 'pending') byEvent[evId].pending.push(b);
      else byEvent[evId].failed.push(b);
    }
    const bookings = [];
    for (const evId of Object.keys(byEvent)) {
      const group = byEvent[evId];
      if (group.paid.length > 0) bookings.push(group.paid.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]);
      else if (group.pending.length > 0) bookings.push(group.pending.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]);
      else if (group.failed.length > 0) bookings.push(group.failed.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]);
    }
    for (const b of noEvent) bookings.push(b);
    bookings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.render('pages/my-bookings', { title: 'My Tickets — MEE', bookings, user: req.user });
  } catch (err) {
    console.error('getMyBookings error:', err);
    res.status(500).render('pages/error', { message: err.message, code: 500 });
  }
};

exports.getEventData = async (req, res) => {
  try {
    const eventId = req.query.id;
    const event = eventId
      ? await Event.findOne({ _id: eventId, isActive: true })
      : await Event.findOne({ isActive: true }).sort({ date: 1 });
    if (!event) return res.json({ success: false, message: 'No active event.' });
    res.json({ success: true, event });
  } catch (err) { res.json({ success: false, message: err.message }); }
};

exports.getAllEvents = async (req, res) => {
  try {
    const events = await Event.find({ isActive: true }).sort({ isFeatured: -1, date: 1 });
    res.json({ success: true, events });
  } catch (err) { res.json({ success: false, message: err.message }); }
};

// ─────────────────────────────────────────────────────────────
// POST /booking/retry-payment-api (JSON endpoint)
// FIX RISK 3: Same re-reservation logic as retryPayment (page)
// ─────────────────────────────────────────────────────────────
exports.retryPaymentApi = async (req, res) => {
  try {
    const booking = await Booking.findOne({
      _id: req.params.bookingId,
      user: req.user._id,
    }).populate('event');

    if (!booking || !['pending', 'failed'].includes(booking.paymentStatus)) {
      return res.json({ success: false, message: 'Booking not found or already paid.' });
    }

    const ttype = booking.event?.ticketTypes?.find(t => t.category === booking.ticketType);
    let postIncBookedSeats = null;

    if (booking.paymentStatus === 'failed') {
      // Seats were released when it failed — reclaim them atomically now
      const maxAllowed = ttype ? (ttype.totalSeats - booking.quantity) : 0;

      const reReserved = await Event.findOneAndUpdate(
        {
          _id: booking.event._id,
          ticketTypes: {
            $elemMatch: {
              category: booking.ticketType,
              isActive: true,
              bookedSeats: { $gte: 0, $lte: maxAllowed },
            }
          }
        },
        { $inc: { 'ticketTypes.$.bookedSeats': booking.quantity } },
        { new: true }
      ).catch(() => null);

      if (!reReserved) {
        return res.json({ success: false, message: `Sorry, ${booking.ticketType} tickets are sold out.` });
      }

      const freshTtype = reReserved.ticketTypes.find(t => t.category === booking.ticketType);
      postIncBookedSeats = freshTtype?.bookedSeats ?? null;

      // Promote back to pending
      await Booking.updateOne({ _id: booking._id }, { $set: { paymentStatus: 'pending' } });

      console.log(`✅ retryPaymentApi: re-reserved ${booking.quantity} seats | bookedSeats now: ${postIncBookedSeats}`);
    } else {
      postIncBookedSeats = ttype?.bookedSeats ?? null;
    }

    req.session.pendingBooking = {
      bookingId: booking._id.toString(),
      eventId: booking.event._id.toString(),
      ticketType: booking.ticketType,
      quantity: booking.quantity,
      pricePerTicket: booking.pricePerTicket,
      subtotal: booking.subtotal,
      discount: booking.discount || 0,
      couponCode: booking.couponCode || null,
      convenienceFee: booking.convenienceFee,
      totalAmount: booking.totalAmount,
      gateNumber: booking.gateNumber || ttype?.gateNumber || '',
      attendees: booking.tickets.map(t => ({ name: t.attendee.name, age: t.attendee.age, special: t.attendee.special || '' })),
      postIncBookedSeats,
    };

    const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
    const order = await razorpay.orders.create({ amount: booking.totalAmount * 100, currency: 'INR', receipt: 'MEE_PAYNOW_' + Date.now() });

    req.session.pendingBooking.orderId = order.id;
    await new Promise((resolve, reject) => { req.session.save(err => err ? reject(err) : resolve()); });

    res.json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID,
      amount: order.amount,
      currency: order.currency,
      orderId: order.id,
      description: booking.ticketType + ' × ' + booking.quantity,
      prefill: {
        name: req.user.firstName + ' ' + (req.user.lastName || ''),
        email: req.user.email || '',
        contact: req.user.phone || '',
      },
    });
  } catch (err) {
    console.error('retryPaymentApi error:', err);
    res.json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// POST /booking/resend-whatsapp/:bookingId
// ─────────────────────────────────────────────────────────────
exports.resendWhatsApp = async (req, res) => {
  const fs = require('fs');
  const path = require('path');
  let tmpFile = null;
  try {
    const booking = await Booking.findOne({
      _id: req.params.bookingId,
      user: req.user._id,
      paymentStatus: 'paid',
    }).populate('event');
    if (!booking) return res.json({ success: false, message: 'Booking not found.' });

    const phone = req.user.whatsapp || req.user.phone;
    if (!phone) return res.json({ success: false, message: 'No WhatsApp number on your account.' });

    const { pdfBase64 } = req.body;
    if (!pdfBase64) return res.json({ success: false, message: 'No PDF data received.' });

    const base64Data = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
    const filename = `ticket_${booking.bookingRef}_${Date.now()}.pdf`;
    const ticketDir = path.join(__dirname, '../public/ticket');
    if (!fs.existsSync(ticketDir)) fs.mkdirSync(ticketDir, { recursive: true });
    tmpFile = path.join(ticketDir, filename);
    fs.writeFileSync(tmpFile, Buffer.from(base64Data, 'base64'));

    const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
    const pdfUrl = `${APP_URL}/ticket/${filename}`;

    const { sendWhatsAppPDF } = require('../utils/whatsappHelper');
    await sendWhatsAppPDF({ phone, pdfUrl, bookingRef: booking.bookingRef });



    setTimeout(() => {
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (e) { }
    }, 2 * 60 * 1000);


    return res.json({ success: true });
  } catch (err) {
    console.error('resendWhatsApp error:', err);
    try { if (tmpFile && require('fs').existsSync(tmpFile)) require('fs').unlinkSync(tmpFile); } catch (e) { }
    return res.json({ success: false, message: 'Failed to send: ' + err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// RAZORPAY WEBHOOK HANDLER
// FIX RISK 2: fetch fresh ttype from DB before assignSeatNumbers
// ─────────────────────────────────────────────────────────────
exports.razorpayWebhook = async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) return res.status(200).json({ status: 'error', message: 'Webhook secret not configured' });

    const receivedSig = req.headers['x-razorpay-signature'];
    if (!receivedSig) return res.status(400).json({ error: 'Missing signature' });

    const expectedSig = crypto.createHmac('sha256', webhookSecret).update(req.rawBody).digest('hex');
    if (expectedSig !== receivedSig) return res.status(400).json({ error: 'Invalid signature' });

    const webhookEvent = req.body;
    const evtType = webhookEvent.event;
    console.log(`📩 Razorpay Webhook: ${evtType}`);

    if (evtType === 'payment.captured' || evtType === 'order.paid') {
      const paymentId = webhookEvent.payload?.payment?.entity?.id;
      const orderId = webhookEvent.payload?.payment?.entity?.order_id || webhookEvent.payload?.order?.entity?.id;
      if (!paymentId || !orderId) return res.status(200).json({ status: 'ignored' });

      const alreadyPaid = await Booking.findOne({ paymentId, paymentStatus: 'paid' });
      if (alreadyPaid) return res.status(200).json({ status: 'already_processed' });

      const booking = await Booking.findOne({
        orderId,
        paymentStatus: { $in: ['pending', 'failed'] },
      }).populate('event').populate('user');
      if (!booking) return res.status(200).json({ status: 'no_booking_found' });

      const eventDoc = booking.event;
      const userDoc = booking.user;
      if (!eventDoc || !userDoc) return res.status(200).json({ status: 'missing_references' });

      // FIX RISK 2: fetch a FRESH ttype snapshot so bookedSeats
      // is current, not a stale value from the populate above
      const freshTtype = await fetchFreshTtype(eventDoc._id, booking.ticketType);
      const standing = isStandingCategory(freshTtype);
      const gateNumber = getGateNumber(eventDoc, booking.ticketType);

      // postIncBookedSeats from the fresh fetch — accurate counter
      const postIncBookedSeats = freshTtype?.bookedSeats ?? null;


      await assignSeatNumbers(
        eventDoc._id,
        freshTtype,
        booking.tickets,
      );

      await generateSharedQR(booking.tickets, {
        bookingId: booking._id,
        bookingRef: booking.bookingRef,
        eventId: eventDoc._id,
        paymentId,
        ticketType: booking.ticketType,
      });

      const webhookFlipped = await Booking.findOneAndUpdate(
        { _id: booking._id, paymentStatus: { $in: ['pending', 'failed'] } },
        {
          $set: {
            paymentStatus: 'paid',
            paymentId,
            orderId,
            tickets: booking.tickets,
            gateNumber,
          }
        },
        { new: true }
      );

      if (!webhookFlipped) {
        console.log(`ℹ️  Webhook: verifyPayment already completed ${booking.bookingRef} — skipping notifications`);
        return res.status(200).json({ status: 'already_processed_by_verify' });
      }

      if (booking.couponCode) {
        const Coupon = require('../models/Coupon');
        await Coupon.findOneAndUpdate(
          { code: booking.couponCode },
          { $inc: { usedCount: 1 }, $addToSet: { usedBy: userDoc._id } }
        ).catch(() => { });
      }
      await User.findByIdAndUpdate(userDoc._id, { $addToSet: { bookings: booking._id } }).catch(() => { });

      try {
        const notifyEmail = booking.contactEmail || userDoc.email || '';
        const notifyWhatsapp = booking.contactWhatsapp || userDoc.whatsapp || userDoc.phone || '';
        const userName = userDoc.firstName || 'Customer';
        const bookingForNotify = webhookFlipped;
        bookingForNotify.gateNumber = gateNumber;
        if (notifyEmail) sendBookingConfirmation({ to: notifyEmail, name: userName, booking: bookingForNotify, event: eventDoc }).catch(() => { });
        if (notifyWhatsapp) {
          const { sendWhatsAppTickets } = require('../utils/whatsappHelper');
          sendWhatsAppTickets({ phone: notifyWhatsapp, name: userName, booking: bookingForNotify, event: eventDoc }).catch(() => { });
        }
      } catch (ne) { console.warn('Webhook notify error:', ne.message); }

      return res.status(200).json({ status: 'ok', bookingRef: booking.bookingRef });
    }

    if (evtType === 'payment.failed') {
      const orderId = webhookEvent.payload?.payment?.entity?.order_id;
      if (orderId) {
        const failedB = await Booking.findOne({ orderId, paymentStatus: 'pending' }).catch(() => null);
        if (failedB) {
          const failedBWithTickets = await Booking.findById(failedB._id)
            .populate('event').lean().catch(() => failedB);
          await releaseSeatsToPool(failedB.event, failedB.ticketType, failedBWithTickets).catch(() => { });
          console.log(`🔓 Webhook: released ${failedB.quantity} seats (payment.failed) for ${failedB.ticketType}`);
        }
        await Booking.findOneAndUpdate(
          { orderId, paymentStatus: { $in: ['pending', 'failed'] } },
          { paymentStatus: 'failed' }
        ).catch(() => null);
      }
      return res.status(200).json({ status: 'ok' });
    }

    return res.status(200).json({ status: 'ignored' });
  } catch (err) {
    console.error('❌ Webhook handler error:', err);
    return res.status(200).json({ status: 'error', message: err.message });
  }
};