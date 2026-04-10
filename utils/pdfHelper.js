'use strict';

const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────
// BACKGROUND IMAGE — load as base64 for reliable rendering
// Place ticket_BG.webp (or .jpg) in the same folder as this file,
// or in an assets/ subfolder.
// ─────────────────────────────────────────────────────────────
async function loadBgBase64() {
  const candidates = [
    path.join(__dirname, '..', 'public', 'images', 'brandings', 'ticket_BG.webp'),
    path.join(__dirname, '..', 'public', 'images', 'brandings', 'ticket_BG.jpg'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      // Try sharp first (fastest, best compression)
      const sharp = require('sharp');
      const buf = await sharp(p)
        .jpeg({ quality: 72, mozjpeg: true })
        .toBuffer();
      return `data:image/jpeg;base64,${buf.toString('base64')}`;
    } catch (_) {
      // sharp not available — return raw file as-is
      const ext = path.extname(p).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
      const data = fs.readFileSync(p);
      return `data:${mime};base64,${data.toString('base64')}`;
    }
  }
  console.warn('[pdfHelper] ticket_BG image not found — rendering without background');
  return null;
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(d) {
  try {
    return new Date(d).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
  } catch { return String(d); }
}

// ─────────────────────────────────────────────────────────────
// Resolve single shared QR for the whole booking
// ─────────────────────────────────────────────────────────────
async function resolveSharedQR(tickets) {
  for (const t of tickets) {
    if (t.qrCode && t.qrCode.startsWith('data:image')) return t.qrCode;
  }
  for (const t of tickets) {
    if (t.qrData) {
      try {
        const payload = JSON.parse(t.qrData);
        return await QRCode.toDataURL(JSON.stringify(payload), {
          width: 400, margin: 1,
          color: { dark: '#000000', light: '#ffffff' },
          errorCorrectionLevel: 'H',
        });
      } catch (e) { /* try next */ }
    }
  }
  return '';
}

// ─────────────────────────────────────────────────────────────
// MAIN — generateTicketPDF
// One page per attendee.
//
// LAYOUT (A4 landscape = 297 × 210 mm, bg image = 2000 × 1416 px):
//   Left section  (0 → 216.8 mm wide)  → concert photo + Malayalam logo
//                                          sponsors + contact + terms
//                                          (all baked into bg image)
//   Right section (216.8 mm → 297 mm)  → dark panel, "TICKET DETAILES"
//                                          header + dividers baked in bg
//                                          → we overlay: QR, booking id,
//                                            attendee, ticket grid, badge
//
//   Event name + price: overlaid top-right of left area (~36–73% x, 3–18% y)
//   Date/Time/Venue:    overlaid lower-left area (~23–73% x, 47–60% y)
// ─────────────────────────────────────────────────────────────
const generateTicketPDF = async ({ booking, event, sponsors = [] }) => {

  const bgBase64 = await loadBgBase64();

  const gateNumber = (booking.gateNumber || 'GATE - 1').toUpperCase();
  const sharedQRSrc = await resolveSharedQR(booking.tickets);
  const eventDateLong = fmtDate(event.date);
  const doorsOpen = event.doorsOpen || '8:00 PM';
  const venue = event.venue || '';
  const venueAddr = event.venueAddress || '';
  const pricePerTicket = Math.round(booking.subtotal / booking.quantity);

  // ── Resolve seatType from event.ticketTypes matching booking.ticketType ──
  const matchedTicketType = (event.ticketTypes || []).find(
    tt => tt.category === booking.ticketType || tt.name === booking.ticketType
  );
  const categorySeatType = (matchedTicketType?.seatType || 'standing').toLowerCase();

  // ── One page per ticket / attendee ──
  const pages = booking.tickets.map((t, i) => {

    const rawSeat = (t.seatNumber || '').trim().toLowerCase();
    const isStanding = categorySeatType === 'standing'
      || rawSeat === 'standing'
      || rawSeat === 'general';
    const isSitting = !isStanding && rawSeat && rawSeat !== 'n/a';
    const seatDisp = isStanding ? 'N/A' : isSitting ? esc(t.seatNumber.toUpperCase()) : 'N/A';

    const attendee = t.attendee || {};
    const genderStr = attendee.gender
      ? attendee.gender.charAt(0).toUpperCase() + attendee.gender.slice(1)
      : '';

    return `
      <div class="page">

        <!-- BACKGROUND (applied via CSS .page class) -->
        <div class="bg-fallback"></div>

        <!-- ═══════════════════════════════════════
            DYNAMIC DATA OVERLAYS
            ═══════════════════════════════════════ -->

        <!-- 0. LEFT QR — top-left corner of concert photo -->
        <div class="left-qr">
          ${sharedQRSrc
        ? `<img class="left-qr-img" src="${sharedQRSrc}" alt="QR"/>`
        : `<div class="left-qr-ph">QR</div>`}
        </div>

        <!-- 1. EVENT NAME + PRICE
                Top-center, right-aligned, well away from right panel
                x: 33% → 70%  (98mm → 208mm)
                y: 3%
            -->
        <div class="ev-info">
          <div class="ev-name">${esc((booking.ticketType || '').toUpperCase())}</div>
          <div class="ev-price">&#8377; ${pricePerTicket.toLocaleString('en-IN')}</div>
        </div>

        <!-- 2. DATE / TIME / VENUE
                Lower-left of concert photo (above sponsor strip)
                x: 23% → 72.9%  (68mm → 216mm)
                y: 47% → 59%    (98.7mm → 123.9mm)
            -->
        <div class="ev-meta">
          <!-- DATE + TIME side by side -->
          <div class="em-row-top">
            <div class="em-item">
              <div class="em-lbl">DATE</div>
              <div class="em-val">${eventDateLong}</div>
            </div>
            <div class="em-item">
              <div class="em-lbl">TIME</div>
              <div class="em-val">${doorsOpen}</div>
            </div>
          </div>
          <!-- divider line -->
          <div class="em-divider"></div>
          <!-- VENUE full width below -->
          <div class="em-item">
            <div class="em-val-venue">${esc(venue)}</div>
            ${venueAddr ? `<div class="em-addr">${esc(venueAddr)}</div>` : ''}
          </div>
        </div>

        <!-- 3. RIGHT PANEL CONTENT
                Inside the dark right panel
                x: 73% → 100%   (216.8mm → 297mm)
                y: 8%  → 61%    (16.8mm → 128.1mm)
                (header "TICKET DETAILES" + top divider are in bg image ~0–8%)
                (second divider at ~50% is also in bg image ~50.5% = ~106mm)
                (Follow Us row in bg ~61.5% = ~129mm)
            -->

            <div class="right-panel">
          <div class="qr-zone">
            ${sharedQRSrc
        ? `<img class="qr-img" src="${sharedQRSrc}" alt="QR"/>`
        : `<div class="qr-ph">QR CODE</div>`}
          </div>
          <div class="bid-block">
            <div class="bid-lbl">BOOKING ID</div>
            <div class="bid-val">${esc(booking.bookingRef)}</div>
          </div>
          <div class="att-name">${esc(attendee.name || 'Guest')}</div>
          <div class="att-meta">${attendee.age ? `AGE - ${attendee.age}` : ''}${genderStr ? ` &nbsp;|&nbsp; GENDER - ${esc(genderStr)}` : ''}</div>
          <div class="dg">
            <div class="dg-c"><div class="dg-l">Ticket ID</div><div class="dg-v mono">${esc(t.ticketId)}</div></div>
            <div class="dg-c"><div class="dg-l">Ticket No.</div><div class="dg-v">${i + 1} of ${booking.quantity}</div></div>
            <div class="dg-c"><div class="dg-l">Category</div><div class="dg-v acc">${esc((booking.ticketType || '').toUpperCase())}</div></div>
            <div class="dg-c"><div class="dg-l">Seat No.</div><div class="dg-v acc">${seatDisp}</div></div>
            <div class="dg-c"><div class="dg-l">Gate No.</div><div class="dg-v">${esc(gateNumber)}</div></div>
            <div class="dg-c"><div class="dg-l">Amount</div><div class="dg-v">&#8377; ${pricePerTicket.toLocaleString('en-IN')}/-</div></div>
          </div>
          <div class="v-badge">&#10003;&nbsp;VALID &nbsp;&middot;&nbsp; ONE TIME ENTRY</div>
        </div>

        
        <!-- end right-panel -->

      </div>`;
  }).join('\n');

  // ── Full HTML document ──
  const html = `<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="UTF-8"/>
  <title>MEE Ticket — ${esc(booking.bookingRef)}</title>
  <style>
  :root {
    --ticket-bg: ${bgBase64 ? `url("${bgBase64}")` : 'none'};
  }
  // @import url('https://fonts.googleapis.com/css2?family=Anton&family=Barlow+Condensed:wght@400;600;700;800&family=Space+Mono:wght@400;700&family=Outfit:wght@400;500;600;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: #111;
    font-family: 'Outfit', Arial, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ──────────────────────────
    PAGE  (A4 Landscape)
    297 × 210 mm
  ────────────────────────── */
  .page {
    width:  297mm;
    height: 210mm;
    position: relative;
    overflow: hidden;
  }
  .page:last-child { page-break-after: avoid; }

  /* BACKGROUND — set once on .page via injected CSS var */
  .page {
    background-image: var(--ticket-bg, none);
    background-size: 100% 100%;
    background-repeat: no-repeat;
  }
  .bg-fallback {
    position: absolute;
    inset: 0;
    background: #0d0d18;
    z-index: -1;
  }

  /* ──────────────────────────
    1. EVENT NAME + PRICE
    Top-right of concert photo
    (right-aligned before the right panel begins)
  ────────────────────────── */
  .ev-info {
    position: absolute;
    left:  33%;      /* ~98mm — more to the left */
    right: 30%;      /* ends at 70% = 207.9mm — clear gap before right panel at 73% */
    top:   3%;       /* ~6.3mm */
    text-align: right;
  }
  .ev-name {
    font-family: 'Anton', Impact, sans-serif;
    font-size: 22pt;
    letter-spacing: 2px;
    color: #ffffff;
    line-height: 1;
    text-shadow: 0 2px 12px rgba(0,0,0,0.85);
  }
  .ev-price {
    font-family: 'Anton', Impact, sans-serif;
    font-size: 20pt;
    color: #ff2d78;
    letter-spacing: 1px;
    text-shadow: 0 2px 8px rgba(255,45,120,0.55);
    margin-top: 0.8mm;
  }

  /* ──────────────────────────
    2. DATE / TIME / VENUE
    Lower-left above sponsor strip
    Demo: x ~23% = 68mm, y ~46% = 96mm
    DATE + TIME in a row, then divider, then VENUE
  ────────────────────────── */
  .ev-meta {
    position: absolute;
    left:  23%;     /* 68.3mm */
    right: 28%;     /* ends at 72% — clear of right panel */
    top:   46%;     /* ~96.6mm */
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .em-row-top {
    display: flex;
    flex-direction: row;
    gap: 8mm;
    margin-bottom: 2mm;
  }
  .em-item { display: flex; flex-direction: column; }
  .em-divider {
    width: 100%;
    height: 1px;
    background: rgba(255,255,255,0.25);
    margin-bottom: 2mm;
  }
  .em-lbl {
    font-family: 'Space Mono', monospace;
    font-size: 4.8pt;
    letter-spacing: 2.5px;
    color: rgba(255,255,255,0.42);
    text-transform: uppercase;
    line-height: 1;
    margin-bottom: 0.5mm;
  }
  .em-val {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 9.5pt;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: 0.5px;
    line-height: 1.15;
  }
  .em-val-venue {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 12pt;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: 0.5px;
    line-height: 1.1;
  }
  .em-addr {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 6.5pt;
    font-weight: 400;
    color: rgba(255,255,255,0.55);
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  /* ──────────────────────────
    3. RIGHT PANEL
    x: 73% → 100%  (216.8mm → 297mm)
    y: 8%  → 61.5% (16.8mm → 129.2mm)
    
    "TICKET DETAILES" header (y 0–8%) is in bg image.
    Second horizontal line (~y 50.5% = ~106mm) is in bg.
    "Follow Us" row (y ~61.5%) is in bg.
  ────────────────────────── */

  .right-panel {
    position: absolute;
    left:   73%;
    right:  0;
    top:    8%;
    bottom: 38.5%;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 2mm 4mm 2mm 4mm;
    justify-content: space-between;
    overflow: hidden;
  }

  .qr-zone {
    width: 100%;
    display: flex;
    justify-content: center;
    flex-shrink: 0;
  }
  .qr-img {
    width:  34mm;
    height: 34mm;
    border-radius: 3px;
    border: 2px solid rgba(255,255,255,0.12);
    display: block;
  }
  .qr-ph {
    width:  34mm;
    height: 34mm;
    background: rgba(255,255,255,0.04);
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 7pt;
    color: #6b6b8a;
  }

  .bid-block {
    text-align: center;
    width: 100%;
    flex-shrink: 0;
  }
  .bid-lbl {
    font-family: 'Space Mono', monospace;
    font-size: 4.5pt;
    letter-spacing: 2px;
    color: #6b6b8a;
    text-transform: uppercase;
    line-height: 1;
    margin-bottom: 0.5mm;
  }
  .bid-val {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11pt;
    font-weight: 800;
    color: #ffffff;
    letter-spacing: 2px;
    line-height: 1;
  }

  .att-name {
    font-family: 'Anton', Impact, sans-serif;
    font-size: 14pt;
    letter-spacing: 1px;
    color: #ffffff;
    line-height: 1;
    width: 100%;
    text-align: center;
    border-top: 1px solid rgba(255,255,255,0.12);
    padding-top: 6.5mm;
    flex-shrink: 0;
  }
  .att-meta {
    font-family: 'Space Mono', monospace;
    font-size: 4.5pt;
    color: #6b6b8a;
    letter-spacing: 0.8px;
    width: 100%;
    text-align: center;
    flex-shrink: 0;
  }

  .dg {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.8mm 1.5mm;
    width: 100%;
    border-top: 1px solid rgba(255,255,255,0.12);
    padding-top: 1.5mm;
    flex-shrink: 0;
  }
  .dg-c {
    display: flex;
    flex-direction: column;
    gap: 0.3mm;
  }
  .dg-l {
    font-family: 'Space Mono', monospace;
    font-size: 4.5pt;
    letter-spacing: 1px;
    color: #6b6b8a;
    text-transform: uppercase;
    line-height: 1;
  }
  .dg-v {
    font-family: 'Outfit', sans-serif;
    font-size: 7.5pt;
    font-weight: 600;
    color: rgba(255,255,255,0.85);
    line-height: 1.2;
  }
  .dg-v.acc  { color: #c8ff00; }
  .dg-v.mono {
    font-family: 'Space Mono', monospace;
    font-size: 5pt;
    word-break: break-all;
  }

  .v-badge {
    width: 100%;
    background: rgba(76,220,128,0.10);
    border: 1px solid rgba(76,220,128,0.28);
    color: #4cdc80;
    font-family: 'Space Mono', monospace;
    font-size: 4pt;
    letter-spacing: 0.4px;
    padding: 1.5mm 1.5mm;
    border-radius: 3px;
    text-align: center;
    line-height: 1.3;
    flex-shrink: 0;
  }


  /* ──────────────────────────
    0. LEFT QR (top-left of concert photo)
    x: 1.5% = ~4.5mm   y: 2% = ~4.2mm
    size: ~22mm × 22mm
  ────────────────────────── */
  .left-qr {
    position: absolute;
    left:  1.5%;   /* ~4.5mm */
    top:   2%;     /* ~4.2mm */
  }
  .left-qr-img {
    width:  22mm;
    height: 22mm;
    display: block;
    border-radius: 2px;
    border: 2px solid rgba(255,255,255,0.20);
  }
  .left-qr-ph {
    width:  22mm;
    height: 22mm;
    background: rgba(255,255,255,0.06);
    border-radius: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 6pt;
    color: #6b6b8a;
  }

  /* ── PRINT ── */
  @media print {
    body { background: white; }
    .bg-img, .qr-img {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
  @page {
    size: 297mm 210mm; 
    margin: 0;
  }
  </style>
  </head>
  <body>
  ${pages}
  </body>
  </html>`;

  // return Buffer.from(html, 'utf8');


  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const pdfBuffer = await page.pdf({
      width: '297mm',
      height: '210mm',
      landscape: false,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    return pdfBuffer;
  } finally {
    await browser.close();
  }


};

module.exports = { generateTicketPDF };