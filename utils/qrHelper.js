// const QRCode = require('qrcode');
// const { v4: uuidv4 } = require('uuid');

// // Generate a unique ticket ID
// const generateTicketId = (idx = 0) => {
//   const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
//   let id = 'MEE-';
//   for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
//   id += '-';
//   for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
//   id += `-T${idx + 1}`;
//   return id;
// };

// // Generate QR code as base64 PNG
// const generateQRCode = async (data) => {
//   try {
//     const qrDataURL = await QRCode.toDataURL(JSON.stringify(data), {
//       width: 300,
//       margin: 2,
//       color: { dark: '#000000', light: '#ffffff' },
//       errorCorrectionLevel: 'H',
//     });
//     return qrDataURL;
//   } catch (err) {
//     console.error('QR generation error:', err);
//     throw err;
//   }
// };

// // Build QR payload for a single-entry ticket
// const buildQRPayload = ({ ticketId, bookingRef, eventId, paymentId, attendeeName, ticketType, seatNumber }) => {
//   return {
//     t: ticketId,        // ticket ID
//     b: bookingRef,      // booking reference
//     e: eventId,         // event ID
//     p: paymentId,       // payment ID
//     n: attendeeName,    // attendee name
//     ty: ticketType,     // ticket type
//     sn: seatNumber || null,  // seat number e.g. "gold_s1"
//     v: 1,               // version
//     ts: Date.now(),     // timestamp
//   };
// };

// // Build QR payload for a GROUP (multiple-entry) ticket — one QR for all attendees
// // Scanned once at gate, grants entry to the whole group
// const buildGroupQRPayload = ({ bookingRef, eventId, paymentId, ticketType, attendees, groupSize, seatNumbers }) => {
//   return {
//     grp: true,                          // flag: this is a group QR
//     b:   bookingRef,                    // booking reference
//     e:   eventId,                       // event ID
//     p:   paymentId,                     // payment ID
//     ty:  ticketType,                    // ticket type
//     gs:  groupSize,                     // number of people in group
//     ns:  attendees.map(a => a.name),   // all attendee names
//     sns: seatNumbers || [],             // seat numbers e.g. ["family_s1","family_s2"]
//     v:   1,
//     ts:  Date.now(),
//   };
// };

// module.exports = { generateTicketId, generateQRCode, buildQRPayload, buildGroupQRPayload };






'use strict';

const QRCode = require('qrcode');

// ─────────────────────────────────────────────────────────────
// Generate a unique ticket ID
// ─────────────────────────────────────────────────────────────
const generateTicketId = (idx = 0) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'MEE-';
  for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  id += '-';
  for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  id += `-T${idx + 1}`;
  return id;
};

// ─────────────────────────────────────────────────────────────
// Generate QR code as base64 PNG data URL
// ─────────────────────────────────────────────────────────────
const generateQRCode = async (data) => {
  try {
    const qrDataURL = await QRCode.toDataURL(JSON.stringify(data), {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'H',
    });
    return qrDataURL;
  } catch (err) {
    console.error('QR generation error:', err);
    throw err;
  }
};

// ─────────────────────────────────────────────────────────────
// Build SHARED QR payload for a booking (one QR for ALL tickets)
//
// Flow:
//   - One booking  → one QR code generated once
//   - All attendee tickets share this same QR image
//   - QR payload contains ALL ticket IDs + seat numbers
//   - Scanner reads QR → lists all attendees → staff checks in each individually
//
// Payload shape:
// {
//   v:  2,                    // version (2 = shared-QR format)
//   b:  "MEE-XXXXXXXX",       // bookingRef
//   e:  "eventId",            // event ObjectId string
//   p:  "pay_XXXXX",          // paymentId
//   ty: "FANFIT",             // ticket category
//   ts: 1234567890,           // timestamp
//   tickets: [
//     { t: "MEE-XXXX-T1", sn: "fanfit_s1", n: "Name 1" },
//     { t: "MEE-XXXX-T2", sn: "fanfit_s2", n: "Name 2" },
//   ]
// }
// ─────────────────────────────────────────────────────────────
const buildSharedQRPayload = ({ bookingRef, eventId, paymentId, ticketType, tickets }) => {
  return {
    v:  2,
    b:  bookingRef,
    e:  String(eventId),
    p:  paymentId,
    ty: ticketType,
    ts: Date.now(),
    tickets: tickets.map(t => ({
      t:  t.ticketId,
      sn: t.seatNumber || null,
      n:  t.attendee?.name || 'Guest',
    })),
  };
};

// ─────────────────────────────────────────────────────────────
// Generate ONE shared QR for the entire booking and assign it
// to every ticket in booking.tickets.
//
// Usage (replaces generateIndividualQRs):
//   await generateSharedQR(booking.tickets, { bookingRef, eventId, paymentId, ticketType });
// ─────────────────────────────────────────────────────────────
const generateSharedQR = async (tickets, { bookingRef, eventId, paymentId, ticketType }) => {
  const payload = buildSharedQRPayload({
    bookingRef,
    eventId,
    paymentId,
    ticketType,
    tickets,
  });

  let qrDataURL = '';
  let qrDataStr = JSON.stringify(payload);

  try {
    qrDataURL = await generateQRCode(payload);
  } catch (e) {
    console.error('Shared QR generation failed:', e.message);
    qrDataURL = '';
  }

  // Assign the SAME qrCode and qrData to every ticket
  for (const t of tickets) {
    t.qrCode = qrDataURL;
    t.qrData = qrDataStr;
  }

  return { qrDataURL, qrDataStr, payload };
};

// ─────────────────────────────────────────────────────────────
// LEGACY — kept for backward compatibility
// Single-ticket QR payload (v1 format)
// ─────────────────────────────────────────────────────────────
const buildQRPayload = ({ ticketId, bookingRef, eventId, paymentId, attendeeName, ticketType, seatNumber }) => {
  return {
    v:  1,
    t:  ticketId,
    b:  bookingRef,
    e:  String(eventId),
    p:  paymentId,
    n:  attendeeName,
    ty: ticketType,
    sn: seatNumber || null,
    ts: Date.now(),
  };
};

// LEGACY — group QR payload (v1 group format)
const buildGroupQRPayload = ({ bookingRef, eventId, paymentId, ticketType, attendees, groupSize, seatNumbers }) => {
  return {
    v:   1,
    grp: true,
    b:   bookingRef,
    e:   String(eventId),
    p:   paymentId,
    ty:  ticketType,
    gs:  groupSize,
    ns:  attendees.map(a => a.name),
    sns: seatNumbers || [],
    ts:  Date.now(),
  };
};

module.exports = {
  generateTicketId,
  generateQRCode,
  generateSharedQR,
  buildSharedQRPayload,
  // legacy exports kept so nothing else breaks
  buildQRPayload,
  buildGroupQRPayload,
};