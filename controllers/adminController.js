const Event   = require('../models/Event');
const Booking = require('../models/Booking');
const User    = require('../models/User');

// ── Helper: get current admin from session ──
function getCurrentAdmin(req) {
  if (req.session.staffUser) return req.session.staffUser;
  if (req.session.adminUser) return { username: req.session.adminUser, name: req.session.adminUser, role: 'admin' };
  return { username: 'admin', name: 'Admin', role: 'admin' };
}

// ── Parse event form body into DB-ready object ──
function parseEventBody(b) {
  let rawTiers = [];
  try { rawTiers = JSON.parse(b.ticketTypesJson || '[]'); } catch(e) {}

  const ticketTypes = rawTiers.map(t => ({
    category:    String(t.category || '').toLowerCase().replace(/\s+/g,'_'),
    name:        String(t.name     || t.category || ''),
    color:       t.color           || '#6A0DAD',
    price:       parseInt(t.price)        || 0,
    ageLimit:    parseInt(t.ageLimit)     || 0,
    ticketType:  t.ticketType             || 'single',
    totalSeats:  parseInt(t.totalSeats)   || 0,
    bookedSeats: parseInt(t.bookedSeats)  || 0,
    maxPerOrder: parseInt(t.maxPerOrder)  || 10,
    seatType:    t.seatType               || 'standing',
    seatPrefix:  String(t.seatPrefix      || '').toLowerCase().replace(/\s+/g,''),
    seatStart:   parseInt(t.seatStart)    || 1,
    gateNumber:  String(t.gateNumber      || ''),
    discountTiers: Array.isArray(t.discountTiers)
      ? t.discountTiers
          .filter(d => d.minQty > 0 && d.discount > 0)
          .map(d => ({ minQty: parseInt(d.minQty), discount: parseInt(d.discount) }))
          .sort((a,b) => a.minQty - b.minQty)
      : [],
    comboOfferMinQty:   (Array.isArray(t.discountTiers) && t.discountTiers[0]) ? parseInt(t.discountTiers[0].minQty)||0 : 0,
    comboOfferDiscount: (Array.isArray(t.discountTiers) && t.discountTiers[0]) ? parseInt(t.discountTiers[0].discount)||0 : 0,
    terms:       t.terms                  || '',
    isActive:    t.isActive === true || t.isActive === 'true',
    isCombo:     t.isCombo  === true || t.isCombo  === 'true',
    comboCount:  parseInt(t.comboCount)   || 0,

      // ✅ Preserve these — never reset on edit
  paidSeatCount:  parseInt(t.paidSeatCount)  || 0,
  releasedSeats:  Array.isArray(t.releasedSeats) ? t.releasedSeats : [],
  }));

  let artists = [];
  try { artists = JSON.parse(b.artistsJson || '[]'); } catch(e) {}

  return {
    name:             b.name,
    shortDescription: b.shortDescription || '',
    about:            b.about            || '',
    instructions:     b.instructions     || '',
    bannerDesktop:      b.bannerDesktop      || '',
    bannerMobile:       b.bannerMobile       || '',
    bannerDetail:       b.bannerDetail       || '',
    bannerDetailMobile: b.bannerDetailMobile || '',
    slideDesktop:       b.slideDesktop       || '',
    slideMobile:        b.slideMobile        || '',
    artists,
    date:             new Date(b.date),
    doorsOpen:        b.doorsOpen        || '',
    endTime:          b.endTime          || '',
    venue:            b.venue,
    venueAddress:     b.venueAddress     || '',
    googleMapLink:    b.googleMapLink    || '',
    convenienceFee:   parseInt(b.convenienceFee) || 0,
    isActive:         b.isActive === 'true' || b.isActive === true,
    isFeatured:       b.isFeatured === 'true' || b.isFeatured === true,
    ticketTypes,
  };
}

exports.getDashboard = async (req, res) => {
  try {
    const [events, totalBookings, totalUsers] = await Promise.all([
      Event.find().sort({ date: -1 }),
      Booking.countDocuments({ paymentStatus: 'paid' }),
      User.countDocuments(),
    ]);

    // ── Revenue: gross, discount, net ──
    const revenueAgg = await Booking.aggregate([
      { $match: { paymentStatus: 'paid' } },
      {
        $group: {
          _id: null,
          grossRevenue:  { $sum: '$subtotal' },
          totalDiscount: { $sum: { $ifNull: ['$discount', 0] } },
        }
      },
    ]);
    const grossRevenue  = revenueAgg[0]?.grossRevenue  || 0;
    const totalDiscount = revenueAgg[0]?.totalDiscount || 0;
    const netRevenue    = grossRevenue - totalDiscount;

    // ── Active event panel ──
    const activeEvent = await Event.findOne({ isActive: true }).sort({ date: 1 }).lean() || null;
    let activeEventBookings = [];
    let activeEventRevenue = 0;
    if (activeEvent) {
  activeEventBookings = await Booking.find({
  event: activeEvent._id,
  paymentStatus: 'paid',
})
  .populate('user', 'name phone email')
  .sort({ createdAt: -1 })   // ← newest first
  .lean();
  
      activeEventRevenue = activeEventBookings.reduce((s, b) => s + (b.totalAmount || 0), 0);
    }

    const currentAdmin = getCurrentAdmin(req);
    const isSuperAdmin = req.session.superAdminLoggedIn ||
      (req.session.staffLoggedIn && req.session.staffUser?.role === 'superadmin');

    res.render('mee-admin/dashboard', {
      title: 'Admin — MEE',
      events,
      currentAdmin,
      isSuperAdmin,
      activeEvent,
      activeEventBookings,
      activeEventRevenue,
      stats: {
        totalEvents:   events.length,
        activeEvents:  events.filter(e => e.isActive).length,
        totalBookings,
        totalUsers,
        grossRevenue,
        totalDiscount,
        revenue: netRevenue,   // net revenue — used for the green stat card
      },
    });
  } catch (err) {
    res.status(500).send('Admin error: ' + err.message);
  }
};


exports.getRevenueByDate = async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = { paymentStatus: 'paid' };

    if (from || to) {
      match.createdAt = {};
      if (from) {
        const [fy, fm, fd] = from.split('-').map(Number);
        const fromUTC = new Date(Date.UTC(fy, fm - 1, fd, 0, 0, 0, 0));
        fromUTC.setUTCMinutes(fromUTC.getUTCMinutes() - 330); // midnight IST → UTC
        match.createdAt.$gte = fromUTC;
      }
      if (to) {
        const [ty, tm, td] = to.split('-').map(Number);
        const toUTC = new Date(Date.UTC(ty, tm - 1, td, 23, 59, 59, 999));
        toUTC.setUTCMinutes(toUTC.getUTCMinutes() - 330); // 23:59:59 IST → UTC
        match.createdAt.$lte = toUTC;
      }
    }

    const data = await Booking.aggregate([
      { $match: match },
      {
        $group: {
          _id:      { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } },
          gross:    { $sum: '$subtotal' },
          discount: { $sum: { $ifNull: ['$discount', 0] } },
          bookings: { $sum: 1 },
        }
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id:      0,
          date:     '$_id',
          gross:    1,
          discount: 1,
          bookings: 1,
          net:      { $subtract: ['$gross', { $ifNull: ['$discount', 0] }] },
        }
      },
    ]);

    res.json({ success: true, data });
  } catch (err) {
    console.error('getRevenueByDate error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getNewEvent = (req, res) => {
  const currentAdmin = getCurrentAdmin(req);
  const isSuperAdmin = req.session.superAdminLoggedIn || (req.session.staffLoggedIn && req.session.staffUser?.role === 'superadmin');
  res.render('mee-admin/event-form', { title: 'New Event — Admin', event: null, error: null, currentAdmin, isSuperAdmin });
};

exports.postCreateEvent = async (req, res) => {
  try {
    const event = await Event.create(parseEventBody(req.body));
    console.log('✅ Event created:', event.name);
    return res.redirect('/mee-admin?success=Event+created');
  } catch (err) {
    console.error('postCreateEvent error:', err);
    const currentAdmin = getCurrentAdmin(req);
    const isSuperAdmin = req.session.superAdminLoggedIn || (req.session.staffLoggedIn && req.session.staffUser?.role === 'superadmin');
    return res.render('mee-admin/event-form', { title: 'New Event', event: null, error: err.message, currentAdmin, isSuperAdmin });
  }
};

exports.getEditEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.redirect('/mee-admin');
    const currentAdmin = getCurrentAdmin(req);
    const isSuperAdmin = req.session.superAdminLoggedIn || (req.session.staffLoggedIn && req.session.staffUser?.role === 'superadmin');
    res.render('mee-admin/event-form', { title: 'Edit Event — Admin', event, error: null, currentAdmin, isSuperAdmin });
  } catch (err) { res.redirect('/mee-admin'); }
};

exports.postUpdateEvent = async (req, res) => {
  try {
    const parsed = parseEventBody(req.body);

    // Fetch existing event to preserve paidSeatCount + releasedSeats
    const existing = await Event.findById(req.params.id).lean();
    if (existing) {
      parsed.ticketTypes = parsed.ticketTypes.map(newTt => {
        // Match by category since _id may not be in form body
        const oldTt = existing.ticketTypes.find(
          o => o.category === newTt.category
        );
        if (oldTt) {
          newTt.paidSeatCount = oldTt.paidSeatCount || 0;
          newTt.releasedSeats = oldTt.releasedSeats || [];
        }
        return newTt;
      });
    }

    await Event.findByIdAndUpdate(req.params.id, parsed, { new: true });
    return res.redirect('/mee-admin?success=Event+updated');
  } catch (err) {
    const event = await Event.findById(req.params.id).catch(() => null);
    const currentAdmin = getCurrentAdmin(req);
    const isSuperAdmin = req.session.superAdminLoggedIn || (req.session.staffLoggedIn && req.session.staffUser?.role === 'superadmin');
    return res.render('mee-admin/event-form', { title: 'Edit Event', event, error: err.message, currentAdmin, isSuperAdmin });
  }
};

exports.deleteEvent = async (req, res) => {
  try {
    await Event.findByIdAndDelete(req.params.id);
    res.redirect('/mee-admin?success=Event deleted');
  } catch (err) { res.redirect('/mee-admin'); }
};

exports.toggleEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (event) { event.isActive = !event.isActive; await event.save(); }
    res.redirect('/mee-admin');
  } catch (err) { res.redirect('/mee-admin'); }
};

exports.getBookings = async (req, res) => {
  try {
    const bookings = await Booking.find()
      .populate('user', 'firstName lastName phone email')
      .populate('event', 'name date')
      .sort({ createdAt: -1 })
      .limit(200);
    const currentAdmin = getCurrentAdmin(req);
    const isSuperAdmin = req.session.superAdminLoggedIn || (req.session.staffLoggedIn && req.session.staffUser?.role === 'superadmin');
    res.render('mee-admin/bookings', { title: 'Bookings — Admin', bookings, currentAdmin, isSuperAdmin });
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
};

// ── Seat Map ────────────────────────────────────────────────────────────────
const SeatMap = require('../models/SeatMap');

exports.getSeatMap = async (req, res) => {
  try {
    const event   = await Event.findById(req.params.eventId);
    if (!event) return res.redirect('/mee-admin');
    const seatMap = await SeatMap.findOne({ event: req.params.eventId }).lean() || null;
    res.render('mee-admin/seatmap', { title: 'Seat Map Builder', event, seatMap });
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
};

exports.postSeatMap = async (req, res) => {
  try {
    const { eventId, stage, sections, overlays, isActive, canvasWidth, canvasHeight, previewImage } = req.body;

    const cleanSections = (sections || []).map(s => ({
      name:        String(s.name     || ''),
      category:    String(s.category || ''),
      zoneShape:   s.zoneShape || 'rect',
      zoneW:       Number(s.zoneW)   || 200,
      zoneH:       Number(s.zoneH)   || 100,
      zoneRot:     s.zoneRot != null ? Number(s.zoneRot) : 0,
      x:           Number(s.x)       || 0,
      y:           Number(s.y)       || 0,
      totalSeats:  Number(s.totalSeats)  || 0,
      bookedSeats: Number(s.bookedSeats) || 0,
      rows:        1,
      seatsPerRow: 1,
      seats:       [],
    }));

    const cleanStage = {
      shape:  stage?.shape  || 'rectangle',
      label:  stage?.label  || 'STAGE',
      x:      Number(stage?.x)      || 80,
      y:      Number(stage?.y)      || 30,
      width:  Number(stage?.width)  || 500,
      height: Number(stage?.height) || 100,
    };

    const cleanOverlays = (overlays || []).map(o => ({
      type:  String(o.type  || 'reserved'),
      label: String(o.label || ''),
      note:  String(o.note  || ''),
      icon:  String(o.icon  || ''),
      color: String(o.color || '#9D4EDD'),
      shape: String(o.shape || 'rect'),
      x:     Number(o.x)   || 0,
      y:     Number(o.y)   || 0,
      w:     Number(o.w)   || 160,
      h:     Number(o.h)   || 80,
      rot:   o.rot != null ? Number(o.rot) : 0,
    }));

    const updateDoc = {
      event:        eventId,
      stage:        cleanStage,
      sections:     cleanSections,
      overlays:     cleanOverlays,
      isActive:     !!isActive,
      canvasWidth:  Number(canvasWidth)  || 960,
      canvasHeight: Number(canvasHeight) || 760,
    };

    if (previewImage && previewImage.startsWith('data:image')) {
      updateDoc.previewImage = previewImage;
    }

    await SeatMap.findOneAndUpdate(
      { event: eventId },
      updateDoc,
      { upsert: true, new: true, runValidators: false }
    );

    try {
      const event = await Event.findById(eventId);
      if (event) {
        const bookedMap = {};
        cleanSections.forEach(s => {
          bookedMap[s.category] = (bookedMap[s.category] || 0) + (s.bookedSeats || 0);
        });
        let changed = false;
        event.ticketTypes.forEach(t => {
          if (bookedMap[t.category] !== undefined && t.bookedSeats !== bookedMap[t.category]) {
            t.bookedSeats = bookedMap[t.category];
            changed = true;
          }
        });
        if (changed) await event.save();
      }
    } catch (e) {
      console.warn('SeatMap bookedSeats writeback warning:', e.message);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('SeatMap save error:', err);
    res.json({ success: false, message: err.message });
  }
};

exports.getEventQuota = async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId).lean();
    if (!event) return res.json({ success: false, message: 'Event not found' });
    res.json({
      success: true,
      categories: event.ticketTypes.map(t => ({
        category:   t.category,
        name:       t.name || t.category,
        totalSeats: t.totalSeats || 0,
        color:      t.color || '#6A0DAD',
        price:      t.price || 0,
      })),
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
};

exports.toggleSeatMap = async (req, res) => {
  try {
    const map = await SeatMap.findOne({ event: req.params.eventId });
    if (map) { map.isActive = !map.isActive; await map.save(); }
    res.json({ success: true, isActive: map?.isActive });
  } catch (err) {
    res.json({ success: false });
  }
};