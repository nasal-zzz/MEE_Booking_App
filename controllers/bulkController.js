'use strict';

const BulkEvent   = require('../models/BulkEvent');
const BulkBooking = require('../models/BulkBooking');
const { generateBulkQRBatch } = require('../utils/bulkQrHelper');
const { generateBundlePdf, generateSingleTicketPdf } = require('../utils/bulkPdfHelper');
// const BulkTicket  = require('../models/BulkTicket');

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function generateRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ref = 'MEE-PB-';
  for (let i = 0; i < 8; i++) ref += chars[Math.floor(Math.random() * chars.length)];
  return ref;
}

function generateTicketId(idx = 0) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'MEE-PT-';
  for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  id += '-';
  for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  id += `-T${idx + 1}`;
  return id;
}

function normalizeTickets(ticketDocs, batchBookingRef) {
  return ticketDocs.map(t => ({
    ...t,
    bookingRef: (t.bookingRef && t.bookingRef !== batchBookingRef)
      ? t.bookingRef
      : generateRef(),
    ticketId: t.ticketId || '',
  }));
}

function buildTicketTypeFromBody(raw) {
  return {
    category:    (raw.name || '').toLowerCase().replace(/\s+/g, '_'),
    name:        raw.name        || '',
    color:       raw.color       || '#9500ff',
    price:       Number(raw.price)      || 0,
    totalSeats:  Number(raw.totalSeats) || 0,
    bookedSeats: Number(raw.bookedSeats)|| 0,
    seatType:    raw.seatType    || 'standing',
    seatPrefix:  (raw.seatPrefix || '').toLowerCase().replace(/\s+/g, ''),
    seatStart:   Number(raw.seatStart)  || 1,
    gateNumber:  raw.gateNumber  || '',
    maxPerBatch: Number(raw.maxPerBatch)|| 500,
    discountTiers: Array.isArray(raw.discountTiers)
      ? raw.discountTiers.filter(d => d.minQty > 0 && d.discount > 0)
      : [],
    terms:    raw.terms    || '',
    isActive: raw.isActive !== false && raw.isActive !== 'false',
  };
}

// ─────────────────────────────────────────────────────────────
// LIST  GET /superadmin/bulk-events
// ─────────────────────────────────────────────────────────────
exports.listBulkEvents = async (req, res) => {
  try {
    const events = await BulkEvent.find().sort({ createdAt: -1 }).lean();

    const ids = events.map(e => e._id);
    const batchCounts = await BulkBooking.aggregate([
      { $match: { bulkEvent: { $in: ids } } },
      { $group: { _id: '$bulkEvent', batches: { $sum: 1 }, tickets: { $sum: '$quantity' } } },
    ]);
    const countMap = {};
    batchCounts.forEach(b => { countMap[b._id.toString()] = b; });

    const enriched = events.map(e => ({
      ...e,
      batchCount:  countMap[e._id.toString()]?.batches || 0,
      ticketCount: countMap[e._id.toString()]?.tickets || 0,
    }));

    res.render('superadmin/bulk-tickets', {
      title:   'Bulk Ticket Events — Admin',
      events:  enriched,
      user:    req.user,
      success: req.query.success || '',
    });
  } catch (err) {
    console.error('listBulkEvents error:', err);
    res.status(500).render('pages/error', { message: err.message, code: 500 });
  }
};

// ─────────────────────────────────────────────────────────────
// NEW FORM  GET /superadmin/bulk-events/new
// ─────────────────────────────────────────────────────────────
exports.newBulkEventForm = (req, res) => {
  res.render('superadmin/bulk-event-form', {
    title: 'New Bulk Event — Admin',
    event: null,
    user:  req.user,
    error: null,
  });
};

// ─────────────────────────────────────────────────────────────
// CREATE  POST /superadmin/bulk-events
// ─────────────────────────────────────────────────────────────
exports.createBulkEvent = async (req, res) => {
  try {
    let ticketTypes = [];
    if (req.body.ticketTypesJson) {
      try { ticketTypes = JSON.parse(req.body.ticketTypesJson); } catch (_) {}
    }

    const event = await BulkEvent.create({
      name:             (req.body.name || '').trim(),
      shortDescription: (req.body.shortDescription || '').trim(),
      date:             req.body.date,
      doorsOpen:        req.body.doorsOpen  || '8:00 PM',
      endTime:          req.body.endTime    || '4:00 AM',
      venue:            (req.body.venue || '').trim(),
      venueAddress:     (req.body.venueAddress || '').trim(),
      googleMapLink:    (req.body.googleMapLink || '').trim(),
      isActive:   req.body.isActive   === 'true' || req.body.isActive   === true,
      isFeatured: req.body.isFeatured === 'true' || req.body.isFeatured === true,
      ticketTypes: ticketTypes.map(buildTicketTypeFromBody),
    });

    return res.redirect(`/superadmin/bulk-events/${event._id}?success=Event+created`);
  } catch (err) {
    console.error('createBulkEvent error:', err);
    return res.render('superadmin/bulk-event-form', {
      title: 'New Bulk Event — Admin',
      event: null,
      user:  req.user,
      error: err.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────
// VIEW  GET /superadmin/bulk-events/:id
// ─────────────────────────────────────────────────────────────
exports.viewBulkEvent = async (req, res) => {
  try {
    const event = await BulkEvent.findById(req.params.id).lean();
    if (!event) return res.redirect('/superadmin/bulk-events');

    const batches = await BulkBooking.find({ bulkEvent: event._id })
      .sort({ createdAt: -1 })
      .select('-tickets')
      .lean();

    res.render('superadmin/bulk-event-view', {
      title:   `${event.name} — Bulk Events`,
      event,
      batches,
      user:    req.user,
      success: req.query.success || '',
    });
  } catch (err) {
    console.error('viewBulkEvent error:', err);
    res.redirect('/superadmin/bulk-events');
  }
};

// ─────────────────────────────────────────────────────────────
// EDIT FORM  GET /superadmin/bulk-events/:id/edit
// ─────────────────────────────────────────────────────────────
exports.editBulkEventForm = async (req, res) => {
  try {
    const event = await BulkEvent.findById(req.params.id).lean();
    if (!event) return res.redirect('/superadmin/bulk-events');
    res.render('superadmin/bulk-event-form', {
      title: `Edit ${event.name} — Admin`,
      event,
      user:  req.user,
      error: null,
    });
  } catch (err) {
    res.redirect('/superadmin/bulk-events');
  }
};

// ─────────────────────────────────────────────────────────────
// UPDATE  POST /superadmin/bulk-events/:id
// ─────────────────────────────────────────────────────────────
exports.updateBulkEvent = async (req, res) => {
  try {
    const event = await BulkEvent.findById(req.params.id);
    if (!event) return res.redirect('/superadmin/bulk-events');

    let ticketTypes = [];
    if (req.body.ticketTypesJson) {
      try { ticketTypes = JSON.parse(req.body.ticketTypesJson); } catch (_) {}
    }

    const existingMap = {};
    event.ticketTypes.forEach(t => { existingMap[t.category] = t.bookedSeats || 0; });

    const mapped = ticketTypes.map(raw => {
      const built = buildTicketTypeFromBody(raw);
      built.bookedSeats = existingMap[built.category] ?? 0;
      return built;
    });

    event.set({
      name:             (req.body.name || '').trim(),
      shortDescription: (req.body.shortDescription || '').trim(),
      date:             req.body.date,
      doorsOpen:        req.body.doorsOpen  || '8:00 PM',
      endTime:          req.body.endTime    || '4:00 AM',
      venue:            (req.body.venue || '').trim(),
      venueAddress:     (req.body.venueAddress || '').trim(),
      googleMapLink:    (req.body.googleMapLink || '').trim(),
      isActive:   req.body.isActive   === 'true' || req.body.isActive   === true,
      isFeatured: req.body.isFeatured === 'true' || req.body.isFeatured === true,
      ticketTypes: mapped,
    });
    await event.save();

    return res.redirect(`/superadmin/bulk-events/${event._id}?success=Event+updated`);
  } catch (err) {
    console.error('updateBulkEvent error:', err);
    const event = await BulkEvent.findById(req.params.id).lean().catch(() => null);
    return res.render('superadmin/bulk-event-form', {
      title: 'Edit Event — Admin',
      event,
      user:  req.user,
      error: err.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────
// TOGGLE ACTIVE  POST /superadmin/bulk-events/:id/deactivate
// ─────────────────────────────────────────────────────────────
exports.toggleBulkEventActive = async (req, res) => {
  try {
    const event = await BulkEvent.findById(req.params.id);
    if (!event) return res.json({ success: false, message: 'Not found' });
    event.isActive = !event.isActive;
    await event.save();
    return res.json({ success: true, isActive: event.isActive });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GENERATE TICKETS  POST /superadmin/bulk-events/:id/generate
// ─────────────────────────────────────────────────────────────
exports.generateTickets = async (req, res) => {
  try {
    const { ticketType, quantity, notes } = req.body;
    const qty = parseInt(quantity, 10);

    if (!qty || qty < 1 || qty > 5000) {
      return res.json({ success: false, message: 'Quantity must be between 1 and 5000.' });
    }

    const event = await BulkEvent.findById(req.params.id);
    if (!event)          return res.json({ success: false, message: 'Event not found.' });
    if (!event.isActive) return res.json({ success: false, message: 'Event is not active.' });

    const ttype = event.ticketTypes.find(
      t => t.category === (ticketType || '').trim().toLowerCase()
    );
    if (!ttype)          return res.json({ success: false, message: 'Invalid ticket category.' });
    if (!ttype.isActive) return res.json({ success: false, message: `${ttype.name} category is disabled.` });

    const available = ttype.totalSeats - ttype.bookedSeats;
    if (qty > available) {
      return res.json({
        success: false,
        message: `Only ${available} seat(s) available in ${ttype.name}. Requested ${qty}.`,
      });
    }

    // ── Atomic seat reservation ──
    const reserved = await BulkEvent.findOneAndUpdate(
      {
        _id: event._id,
        ticketTypes: {
          $elemMatch: {
            category:    ttype.category,
            isActive:    true,
            bookedSeats: { $gte: 0, $lte: ttype.totalSeats - qty },
          },
        },
      },
      { $inc: { 'ticketTypes.$.bookedSeats': qty } },
      { new: true }
    );

    if (!reserved) {
      return res.json({ success: false, message: 'Seats no longer available — please refresh.' });
    }

    // ── Create BulkBooking shell ──
    const booking = new BulkBooking({
      bulkEvent:        event._id,
      ticketType:       ttype.category,
      categoryName:     ttype.name,
      categoryColor:    ttype.color,
      gateNumber:       ttype.gateNumber || '',
      seatType:         ttype.seatType,
      pricePerTicket:   ttype.price,
      quantity:         qty,
      totalAmount:      ttype.price * qty,
      notes:            notes || '',
      createdBy:        req.user?._id,
      generationStatus: 'generating',
    });
    await booking.save();

    // ── Seat start offset for sitting categories ──
    const isSitting = ttype.seatType === 'sitting';
    const seatBase  = ttype.seatStart || 1;
    let nextSeatNum = seatBase;

    if (isSitting) {
      const prevBatches = await BulkBooking.find({
        bulkEvent:        event._id,
        ticketType:       ttype.category,
        generationStatus: 'completed',
        _id:              { $ne: booking._id },
      }).select('quantity').lean();
      const prevQty = prevBatches.reduce((s, b) => s + (b.quantity || 0), 0);
      nextSeatNum = seatBase + prevQty;
    }

    // ── Build ticket sub-documents (each with its own unique ref + id) ──
    const tickets = [];
    for (let i = 0; i < qty; i++) {
      tickets.push({
        ticketId:   generateTicketId(i),   // MEE-PT-XXXX-XXXX-T1, T2 ...
        serialNo:   i + 1,
        seatNumber: isSitting
          ? `${ttype.seatPrefix || ttype.category}_${nextSeatNum + i}`
          : 'N/A',
        qrData: '',
        qrCode: '',
      });
    }

    // ── Generate QR codes — reads ticket.ticketId + ticket.bookingRef ──
    await generateBulkQRBatch(tickets, {
      eventId:    event._id,
      ticketType: ttype.category,
      gateNumber: ttype.gateNumber || '',
    });

    booking.tickets          = tickets;
    booking.generationStatus = 'completed';
    booking.generatedAt      = new Date();
    await booking.save();

    console.log(`✅ Bulk: ${qty} × ${ttype.name} | ${booking.bookingRef}`);

    // ── Write individual BulkTicket docs ──

booking.tickets          = tickets;
booking.generationStatus = 'completed';
booking.generatedAt      = new Date();
await booking.save();

console.log(`✅ Bulk: ${qty} × ${ttype.name} | ${booking.bookingRef}`);

    return res.json({
      success:    true,
      bookingRef: booking.bookingRef,
      batchId:    booking._id,
      quantity:   qty,
      message:    `${qty} tickets generated successfully.`,
    });
  } catch (err) {
    console.error('generateTickets error:', err);
    return res.json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// VIEW BATCH  GET /superadmin/bulk-bookings/:batchId
// ─────────────────────────────────────────────────────────────
exports.viewBatch = async (req, res) => {
  try {
    const batch = await BulkBooking.findById(req.params.batchId)
      .populate('bulkEvent')
      .lean();
    if (!batch) return res.redirect('/superadmin/bulk-events');

    res.render('superadmin/bulk-batch-view', {
      title: `Batch ${batch.bookingRef} — Admin`,
      batch,
      event: batch.bulkEvent,
      user:  req.user,
    });
  } catch (err) {
    console.error('viewBatch error:', err);
    res.redirect('/superadmin/bulk-events');
  }
};

// ─────────────────────────────────────────────────────────────
// DOWNLOAD BUNDLE PDF  GET /superadmin/bulk-bookings/:batchId/download-bundle
// ─────────────────────────────────────────────────────────────
exports.downloadBundle = async (req, res) => {
  try {
    const batch = await BulkBooking.findById(req.params.batchId)
      .populate('bulkEvent')
      .lean();
    if (!batch || batch.generationStatus !== 'completed') {
      return res.status(404).send('Batch not found or not ready.');
    }

    const event = batch.bulkEvent;
    const ttype = event.ticketTypes?.find(t => t.category === batch.ticketType);
    const meta  = {
      eventName:      event.name,
      eventDate:      event.date,
      doorsOpen:      event.doorsOpen || '',
      venue:          event.venue,
      venueAddress:   event.venueAddress || '',
      categoryName:   batch.categoryName,
      categoryColor:  batch.categoryColor,
      gateNumber:     batch.gateNumber || '',
      seatType:       batch.seatType,
      pricePerTicket: batch.pricePerTicket,
      bookingRef:     batch.bookingRef,
      totalInBatch:   batch.quantity,
      terms:          ttype?.terms || '',
    };

    // ── Fetch from BulkTicket first (new batches), fallback to subdocs (old batches) ──
  

    const rawTickets = (batch.tickets || []).sort((a, b) => a.serialNo - b.serialNo);
if (!rawTickets.length) return res.status(404).send('No tickets found for this batch.');
const ticketDocs = normalizeTickets(rawTickets, batch.bookingRef);


    console.log(`📄 Bundle PDF: ${batch.bookingRef} (${ticketDocs.length} tickets)…`);
    const pdfBuffer = await generateBundlePdf(ticketDocs, meta);
    const filename  = `bulk_${batch.bookingRef}_bundle.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);
  } catch (err) {
    console.error('downloadBundle error:', err);
    return res.status(500).send('PDF generation failed: ' + err.message);
  }
};

// ─────────────────────────────────────────────────────────────
// DOWNLOAD SINGLE TICKET  GET /superadmin/bulk-bookings/:batchId/download-ticket/:serialNo
// ─────────────────────────────────────────────────────────────
exports.downloadSingleTicket = async (req, res) => {
  try {
    const serialNo = parseInt(req.params.serialNo, 10);
    const batch = await BulkBooking.findById(req.params.batchId)
      .populate('bulkEvent')
      .lean();
    if (!batch) return res.status(404).send('Batch not found.');

    const event = batch.bulkEvent;
    const ttype = event.ticketTypes?.find(t => t.category === batch.ticketType);
    const meta  = {
      eventName:      event.name,
      eventDate:      event.date,
      doorsOpen:      event.doorsOpen || '',
      venue:          event.venue,
      venueAddress:   event.venueAddress || '',
      categoryName:   batch.categoryName,
      categoryColor:  batch.categoryColor,
      gateNumber:     batch.gateNumber || '',
      seatType:       batch.seatType,
      pricePerTicket: batch.pricePerTicket,
      bookingRef:     batch.bookingRef,
      totalInBatch:   batch.quantity,
      terms:          ttype?.terms || '',
    };

    // ── Fetch from BulkTicket first, fallback to subdoc ──

    const rawTicket = (batch.tickets || []).find(t => t.serialNo === serialNo);
if (!rawTicket) return res.status(404).send(`Ticket #${serialNo} not found.`);
const [ticket] = normalizeTickets([rawTicket], batch.bookingRef);

    const pdfBuffer = await generateSingleTicketPdf(ticket, meta);
    const filename  = `ticket_${ticket.ticketId}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);
  } catch (err) {
    console.error('downloadSingleTicket error:', err);
    return res.status(500).send('PDF generation failed: ' + err.message);
  }
};

// ─────────────────────────────────────────────────────────────
// DELETE BATCH  DELETE /superadmin/bulk-bookings/:batchId
// ─────────────────────────────────────────────────────────────
exports.deleteBatch = async (req, res) => {
  try {
    const batch = await BulkBooking.findById(req.params.batchId);
    if (!batch) return res.json({ success: false, message: 'Batch not found.' });

    await BulkEvent.findOneAndUpdate(
      { _id: batch.bulkEvent, 'ticketTypes.category': batch.ticketType },
      { $inc: { 'ticketTypes.$.bookedSeats': -batch.quantity } }
    ).catch(() => {});


    await BulkBooking.findByIdAndDelete(batch._id);
    console.log(`🗑️  Deleted batch ${batch.bookingRef} — released ${batch.quantity} seats`);

    return res.json({ success: true, message: 'Batch deleted and seats released.' });
  } catch (err) {
    console.error('deleteBatch error:', err);
    return res.json({ success: false, message: err.message });
  }
};