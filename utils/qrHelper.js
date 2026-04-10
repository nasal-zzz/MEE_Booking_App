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