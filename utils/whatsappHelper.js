'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

// ── Helpers ──────────────────────────────────────────────────────────────

const APP_URL = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const MSG91_AUTH_KEY = () => process.env.MSG91_AUTH_KEY || '';
const MSG91_WA_SENDER = () => process.env.MSG91_WA_SENDER || '';

/** Normalise any Indian phone number to 91XXXXXXXXXX */
const normPhone = (phone) => {
  const raw = String(phone || '').replace(/\D/g, '');
  return raw.startsWith('91') ? raw : '91' + raw;
};

/** Format a Date to "Mon, 27 Mar 2026" */
const fmtDate = (date) => {
  try {
    return new Date(date).toLocaleDateString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch (e) { return String(date); }
};

const saveTicketFile = (buffer, bookingRef) => {
  try {
    const dir = path.join(__dirname, '..', 'public', 'ticket');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // ✅ Unique filename each time — busts MSG91/WhatsApp CDN cache
    const filename = `${bookingRef}_${Date.now()}_ticket.pdf`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, buffer);

    // Also clean up old PDFs for this booking ref
    try {
      fs.readdirSync(dir)
        .filter(f => f.startsWith(bookingRef) && f !== filename)
        .forEach(f => fs.unlinkSync(path.join(dir, f)));
    } catch (_) { }

    setTimeout(() => {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (e) {
        console.warn('PDF cleanup error:', e.message);
      }
    }, 5 * 60 * 1000);

    return `${APP_URL()}/ticket/${filename}`;
  } catch (e) {
    console.error('saveTicketFile error:', e.message);
    return null;
  }
};


const isConfigured = () => !!(MSG91_AUTH_KEY() && MSG91_WA_SENDER());

const devLog = (label, phone, data) => {
  console.log('\n' + '='.repeat(64));
  console.log(`📱 [DEV MSG91 WA] ${label} → ${phone}`);
  console.log(JSON.stringify(data, null, 2));
  console.log('='.repeat(64) + '\n');
};

/**
 * Returns true when the booking is for a sitting (numbered-seat) category.
 * Checks ticket seatNumbers — if they look like real assigned seats
 * (not empty, not 'general', not 'standing') then it's a sitting category.
 */
const isSittingBooking = (booking) => {
  if (!booking.tickets || booking.tickets.length === 0) return false;
  return booking.tickets.some(t => {
    const sn = (t.seatNumber || '').trim().toLowerCase();
    return sn && sn !== 'general' && sn !== 'standing' && sn !== 'n/a';
  });
};

/**
 * @param {string} to           - recipient phone (will be normalised)
 * @param {string} templateName - MSG91 template name
 * @param {Object} components   - key/value map matching MSG91 component keys exactly
 */
const sendMsg91WA = (to, templateName, components = {}) => {
  const authKey = MSG91_AUTH_KEY();
  const sender = MSG91_WA_SENDER();

  if (!authKey || !sender) {
    return Promise.reject(new Error('MSG91_AUTH_KEY or MSG91_WA_SENDER not set'));
  }

  const builtComponents = {};

  Object.entries(components).forEach(([key, val]) => {
    if (val === null || val === undefined) return;

    if (key === 'button_1') {
      builtComponents['button_1'] = {
        subtype: 'url',
        type: 'text',
        value: String(val),
      };
    } else if (key === 'header_document') {



      builtComponents['header_1'] = {   // ✅ changed 'header' → 'header_1'
        type: 'document',
        filename: `ticket_${Date.now()}.pdf`,   // ✅ add filename at top level
        value: String(val),
      };


    } else {
      const paramName = key.replace(/^body_/, '');
      builtComponents[key] = {
        type: 'text',
        value: String(val),
        parameter_name: paramName,
      };
    }
  });

  const payload = JSON.stringify({
    integrated_number: sender,
    content_type: 'template',
    payload: {
      messaging_product: 'whatsapp',
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en', policy: 'deterministic' },
        namespace: process.env.MSG91_WA_NAMESPACE || '',
        to_and_components: [
          {
            to: [normPhone(to)],
            components: builtComponents,
          },
        ],
      },
    },
  });

  console.log('   📤 MSG91 raw payload:', payload);
  console.log('📤 Full MSG91 payload being sent:');


  console.log(JSON.stringify(JSON.parse(payload), null, 2));
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.msg91.com',
        path: '/api/v5/whatsapp/whatsapp-outbound-message/bulk/',
        method: 'POST',
        headers: {
          authkey: authKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.type === 'success' || res.statusCode === 200) resolve(json);
            else reject(new Error(`MSG91 error: ${JSON.stringify(json)}`));
          } catch (e) {
            reject(new Error('MSG91 parse error: ' + data.substring(0, 300)));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
};

// ── Helper ─────────────────────────────────────────────────────────────────
const buildSeatsString = (tickets) => {
  if (!tickets || tickets.length === 0) return 'N/A';
  return tickets
    .map(t => t.seatNumber || t.seatId || 'General')
    .join(', ');
};

// ── 1. Booking Confirmed ───────────────────────────────────────────────────
const sendWhatsAppTickets = async ({ phone, name, booking, event }) => {
  if (!phone) return { success: false };
  console.log('📱 MSG91 WA sendWhatsAppTickets →', phone);

  // Generate PDF
  let pdfUrl = null;
  try {
    const { generateTicketPDF } = require('./pdfHelper');
    const buf = await generateTicketPDF({ booking, event });
    pdfUrl = saveTicketFile(buf, booking.bookingRef);
    console.log("pdf generated success");
    console.log('📎 PDF URL being sent to MSG91:', pdfUrl);
    console.log('🌐 APP_URL is:', process.env.APP_URL);
  } catch (e) {
    console.warn('⚠ PDF generation failed:', e.message);
  }

  // ✅ Only pass seat numbers for sitting (numbered seat) categories
  const sitting = isSittingBooking(booking);
  const seats = sitting ? buildSeatsString(booking.tickets) : 'N/A';

  const eventDate = fmtDate(event.date);
  const eventTime = event.doorsOpen || '';
  const venue = event.venue || '';
  const bookingId = booking.bookingRef || String(booking._id);
  const buttonVal = String(booking._id || booking.bookingRef);

  if (!isConfigured()) {
    devLog('Confirmed', phone, {
      name, bookingId,
      category: booking.ticketType,
      qty: booking.quantity,
      seats, eventDate, eventTime, venue, pdfUrl, buttonVal,
    });
    return { success: true, dev: true };
  }

  const templateName = process.env.MSG91_WA_TEMPLATE_CONFIRM || '';
  if (!templateName) {
    console.warn('⚠ MSG91_WA_TEMPLATE_CONFIRM not set');
    return { success: false };
  }

  try {
    console.log('🧪 Template name:', templateName);
    console.log('🧪 PDF URL:', pdfUrl);
    console.log('🧪 Is URL reachable externally?', pdfUrl?.startsWith('https://'));


    await sendMsg91WA(phone, templateName, {
      body_name: name,
      body_booking_id: bookingId,
      body_category_name: booking.ticketType || '',
      body_ticket_count: String(booking.quantity),
      body_seats: seats,
      body_event_date: eventDate,
      body_event_time: eventTime,
      body_event_venue: venue,
      button_1: buttonVal,
      header_document: pdfUrl,
    });
    console.log('   ✅ MSG91 WA confirmed sent');
    return { success: true };
  } catch (err) {
    console.error('   ❌ MSG91 WA confirmed error:', err.message);
    return { success: false, error: err.message };
  }
};

const sendWhatsAppConfirmation = sendWhatsAppTickets;

// ── 2. Payment Pending ───────────────────────────────────────────────────
const sendWhatsAppPending = async ({ phone, name, booking, event }) => {
  if (!phone) return { success: false };
  console.log('📱 MSG91 WA sendWhatsAppPending →', phone);

  const bookingId = booking.bookingRef || String(booking._id);
  const totalAmount = `${(booking.totalAmount || 0).toLocaleString('en-IN')}`;

  if (!isConfigured()) {
    devLog('Pending', phone, { name, bookingId, category: booking.ticketType, qty: booking.quantity, totalAmount });
    return { success: true, dev: true };
  }

  const templateName = process.env.MSG91_WA_TEMPLATE_PENDING || '';
  if (!templateName) { console.warn('⚠ MSG91_WA_TEMPLATE_PENDING not set'); return { success: false }; }

  try {
    await sendMsg91WA(phone, templateName, {
      body_name: name,
      body_booking_id: bookingId,
      body_category_name: booking.ticketType || '',
      body_ticket_count: String(booking.quantity),
      body_total_amount: totalAmount,
    });
    console.log('   ✅ MSG91 WA pending sent');
    return { success: true };
  } catch (err) {
    console.error('   ❌ MSG91 WA pending error:', err.message);
    return { success: false, error: err.message };
  }
};

// ── 3. Payment Failed ────────────────────────────────────────────────────
const sendWhatsAppPaymentFailed = async ({ phone, name, booking, event }) => {
  if (!phone) return { success: false };
  console.log('📱 MSG91 WA sendWhatsAppPaymentFailed →', phone);

  const bookingId = booking.bookingRef || String(booking._id);
  const totalAmount = `${(booking.totalAmount || 0).toLocaleString('en-IN')}`;
  const buttonVal = String(booking._id || booking.bookingRef);

  if (!isConfigured()) {
    devLog('Failed', phone, { name, bookingId, totalAmount, buttonVal });
    return { success: true, dev: true };
  }

  const templateName = process.env.MSG91_WA_TEMPLATE_FAILED || '';
  if (!templateName) { console.warn('⚠ MSG91_WA_TEMPLATE_FAILED not set'); return { success: false }; }

  try {
    await sendMsg91WA(phone, templateName, {
      body_name: name,
      body_booking_id: bookingId,
      body_total_amount: totalAmount,
      button_1: buttonVal,
    });
    console.log('   ✅ MSG91 WA failed sent');
    return { success: true };
  } catch (err) {
    console.error('   ❌ MSG91 WA failed error:', err.message);
    return { success: false, error: err.message };
  }
};


const sendWhatsAppEventReminder = async ({ phone, name, booking, event }) => {
  if (!phone) return { success: false };
  console.log('📱 MSG91 WA sendWhatsAppEventReminder →', phone);

  if (!isConfigured()) {
    devLog('EventReminder', phone, { name });
    return { success: true, dev: true };
  }

  const templateName = process.env.MSG91_WA_TEMPLATE_REMINDER || '';
  if (!templateName) {
    console.warn('⚠ MSG91_WA_TEMPLATE_REMINDER not set');
    return { success: false };
  }

  try {
    await sendMsg91WA(phone, templateName, {
      body_name: name,
    });
    console.log('   ✅ MSG91 WA event reminder sent');
    return { success: true };
  } catch (err) {
    console.error('   ❌ MSG91 WA event reminder error:', err.message);
    return { success: false, error: err.message };
  }
};

// const sendWhatsAppPromo = async ({ phone, name, categories = [], eventName = '' }) => {
//   if (!phone) return { success: false };
//   console.log('📱 MSG91 WA sendWhatsAppPromo →', phone);

//    // ADD THIS TEMPORARILY
//   console.log('   categories received:', JSON.stringify(categories.map(c => ({
//     category: c.category,
//     isActive: c.isActive,
//     bookedSeats: c.bookedSeats,
//     totalSeats: c.totalSeats,
//   })), null, 2));

//   // Filter only categories with available seats
//   const availableCats = categories
//     .filter(c => c.isActive !== false && (c.bookedSeats ?? 0) < (c.totalSeats ?? 0))
//     .slice(0, 5);

//   if (availableCats.length === 0) {
//     console.warn('⚠ No available categories — skipping promo for', phone);
//     return { success: false, reason: 'no_available_seats' };
//   }

//   if (!isConfigured()) {
//     devLog('Promo', phone, { name, eventName, categories: availableCats });
//     return { success: true, dev: true };
//   }

//   const templateName = process.env.MSG91_WA_TEMPLATE_PROMO || '';
//   if (!templateName) {
//     console.warn('⚠ MSG91_WA_TEMPLATE_PROMO not set');
//     return { success: false };
//   }

//   // Build one clean category string — no slot padding needed
//   const categoryLines = availableCats
//     .map(c => `• ${c.category || c.name} – ₹${(c.price || 0).toLocaleString('en-IN')}`);

//   const components = {
//     body_name:        name       || '',
//     body_event_name:  eventName  || '',
//     body_categories:  categoryLines,
//   };

//   try {
//     await sendMsg91WA(phone, templateName, components);
//     console.log(`   ✅ MSG91 WA promo sent → ${phone} (${availableCats.length} categories)`);
//     return { success: true };
//   } catch (err) {
//     console.error('   ❌ MSG91 WA promo error:', err.message);
//     return { success: false, error: err.message };
//   }
// };



const sendWhatsAppPromo = async ({ phone, name, categories = [], eventName = '' }) => {
  if (!phone) return { success: false };
  console.log('📱 MSG91 WA sendWhatsAppPromo →', phone);

  const availableCats = categories
    .filter(c => c.isActive !== false && (c.bookedSeats ?? 0) < (c.totalSeats ?? 0))
    .sort((a, b) => a.price - b.price)  // cheapest first
    .slice(0, 5);

  if (availableCats.length === 0) {
    console.warn('⚠ No available categories — skipping promo for', phone);
    return { success: false, reason: 'no_available_seats' };
  }

  if (!isConfigured()) {
    devLog('Promo', phone, { name, eventName, categories: availableCats });
    return { success: true, dev: true };
  }

  const templateName = process.env.MSG91_WA_TEMPLATE_PROMO || '';
  if (!templateName) {
    console.warn('⚠ MSG91_WA_TEMPLATE_PROMO not set');
    return { success: false };
  }

  const EMPTY = '\u200B';  // zero-width space — renders as blank in WhatsApp

  const components = {
    body_name: name || '',
    body_event_name: eventName || '',
  };

  // Fill available slots
  availableCats.forEach((c, i) => {
    components[`cat${i + 1}`] = `• ${c.category || c.name} – ₹${(c.price || 0).toLocaleString('en-IN')}`;
  });

  // Pad remaining slots with zero-width space
  for (let i = availableCats.length; i < 5; i++) {
    components[`cat${i + 1}`] = EMPTY;
  }

  try {
    await sendMsg91WA(phone, templateName, components);
    console.log(`   ✅ MSG91 WA promo sent → ${phone} (${availableCats.length} categories)`);
    return { success: true };
  } catch (err) {
    console.error('   ❌ MSG91 WA promo error:', err.message);
    return { success: false, error: err.message };
  }
};



// ── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  sendWhatsAppTickets,
  sendWhatsAppEventReminder,
  sendWhatsAppConfirmation,
  sendWhatsAppPromo,
  sendWhatsAppPending,
  sendWhatsAppPaymentFailed,
};