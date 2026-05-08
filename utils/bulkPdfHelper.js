'use strict';

const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────
// BACKGROUND IMAGE
// ─────────────────────────────────────────────────────────────
async function loadBgBase64() {
  const candidates = [
    path.join(__dirname, '..', 'public', 'images', 'brandings', 'ticket_print.webp'),
    path.join(__dirname, '..', 'public', 'images', 'brandings', 'ticket_BG.webp'),
    path.join(__dirname, '..', 'public', 'images', 'brandings', 'ticket_BG.jpg'),
  ];

  for (const p of candidates) {
    if (!fs.existsSync(p)) {
      console.log(`[bulkPdfHelper] Not found: ${p}`);
      continue;
    }
    console.log(`[bulkPdfHelper] Loading bg from: ${p}`);
    try {
      const sharp = require('sharp');
      const buf   = await sharp(p).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      console.log(`[bulkPdfHelper] BG loaded via sharp, size=${buf.length}`);
      return `data:image/jpeg;base64,${buf.toString('base64')}`;
    } catch (sharpErr) {
      console.warn(`[bulkPdfHelper] sharp failed (${sharpErr.message}), reading raw`);
      const ext  = path.extname(p).toLowerCase();
      const mime = ext === '.webp' ? 'image/webp'
                 : ext === '.png'  ? 'image/png'
                 :                   'image/jpeg';
      const data = fs.readFileSync(p);
      console.log(`[bulkPdfHelper] BG loaded raw, mime=${mime}, size=${data.length}`);
      return `data:${mime};base64,${data.toString('base64')}`;
    }
  }

  console.warn('[bulkPdfHelper] Background image NOT found');
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
// ONE TICKET STRIP  210mm × 98.8mm
//
// LEFT ZONE (0 → 73%):
//   • bg image fills the full ticket (object-fit:fill)
//   • category name + price: top-right of left zone
//   • date / time / venue:   vertically centred, left-aligned
//   • bg image's sponsor/social strip sits in the bottom ~20% of the
//     LEFT ZONE — the right panel must stop before that strip so it
//     never overlaps. We achieve this by giving .rp bottom:20% so the
//     right panel ends at the same height as the top of the sponsor strip.
//
// RIGHT PANEL (73% → 100%):
//   • starts at top:0, ends at bottom:20% — clears the social strip area
//   • TICKET DETAILS header, large QR, Ticket ID, divider, grid, valid badge
// ─────────────────────────────────────────────────────────────
function buildTicketStrip(ticket, meta, bgBase64) {
  const accentGreen = '#e4ff00';
  const accentPink  = '#ff00a2';

  const seatNum   = ticket.seatNumber && ticket.seatNumber !== 'N/A'
    ? esc(ticket.seatNumber.toUpperCase()) : null;
  const dateStr   = fmtDate(meta.eventDate);
  const doorsOpen = meta.doorsOpen || '';
  const venue     = esc(meta.venue || '');
  const venueAddr = esc(meta.venueAddress || '');
  const qrSrc     = ticket.qrCode || '';
  const ticketId  = esc(ticket.ticketId || '');

  return `
<div class="ticket">

  <!-- FULL-TICKET BACKGROUND -->
  ${bgBase64
    ? `<img class="ticket-bg" src="${bgBase64}" alt=""/>`
    : `<div class="ticket-bg-fallback"></div>`}

  <!-- ░░ LEFT ZONE OVERLAYS ░░ -->

  <!-- Category + Price — top-right corner of left zone -->
  <div class="evinfo">
    <div class="ev-name">${esc((meta.categoryName || '').toUpperCase())}</div>
    <div class="ev-price" style="color:${accentPink};">&#8377;&nbsp;${(meta.pricePerTicket || 0).toLocaleString('en-IN')}</div>
  </div>

  <!-- Date / Time / Venue — vertically centred in the artist/content area
       (top:8% to bottom:22% = the non-sponsor zone of the left side)
       Uses flex column + justify-content:center to sit naturally in the middle -->
  <div class="evmeta">
    <div class="em-item">
      <span class="em-lbl">DATE</span>
      <span class="em-val" style="color:${accentGreen};">${dateStr}</span>
    </div>
    ${doorsOpen ? `<div class="em-item" style="margin-top:2mm;">
      <span class="em-lbl">TIME</span>
      <span class="em-val" style="color:${accentGreen};">${esc(doorsOpen)}</span>
    </div>` : ''}
    <div class="em-divider"></div>
    <div class="em-venue-block">
      <span class="em-venue" style="color:${accentGreen};">${venue}</span>
      ${venueAddr ? `<span class="em-addr">${venueAddr}</span>` : ''}
    </div>
  </div>

  <!-- ░░ RIGHT PANEL ░░
       Stops at bottom:20% so the sponsor/social strip in the bg image
       (which spans the full ticket width at the bottom) remains fully visible -->
  <div class="rp">

    <div class="rp-hdr">TICKET DETAILS</div>

    <!-- Large QR -->
    <div class="rp-qr">
      ${qrSrc
        ? `<img src="${qrSrc}" alt="QR" class="rp-qr-img"/>`
        : `<div class="rp-qr-ph">QR</div>`}
    </div>

    <!-- Ticket ID -->
    <div class="rp-ticketid-block">
      <div class="rp-lbl">TICKET ID</div>
      <div class="rp-ticketid">${ticketId}</div>
    </div>

    <div class="rp-divider"></div>

    <!-- Grid: Category | Seat · Gate | Amount -->
    <div class="rp-grid">
      <div class="rp-cell">
        <div class="rp-lbl">CATEGORY</div>
        <div class="rp-big rp-green">${esc((meta.categoryName || '').toUpperCase())}</div>
      </div>
      ${seatNum ? `<div class="rp-cell">
        <div class="rp-lbl">SEAT NO.</div>
        <div class="rp-big rp-green">${seatNum}</div>
      </div>` : ''}
      ${meta.gateNumber ? `<div class="rp-cell">
        <div class="rp-lbl">GATE NO.</div>
        <div class="rp-val rp-green">${esc(meta.gateNumber)}</div>
      </div>` : ''}
      <div class="rp-cell">
        <div class="rp-lbl">AMOUNT</div>
        <div class="rp-val rp-green">&#8377;&nbsp;${(meta.pricePerTicket || 0).toLocaleString('en-IN')}/-</div>
      </div>
    </div>

    <div class="rp-valid">&#10003;&ensp;VALID &nbsp;&middot;&nbsp; ONE TIME ENTRY</div>

  </div>

</div>`;
}

// ─────────────────────────────────────────────────────────────
// GROUP tickets → A4 pages of 3
// ─────────────────────────────────────────────────────────────
function buildPages(tickets, meta, bgBase64) {
  const pages = [];
  for (let i = 0; i < tickets.length; i += 3) {
    const group = tickets.slice(i, i + 3);
    while (group.length < 3) group.push(null);

    let inner = '';
    group.forEach((t, idx) => {
      inner += t
        ? buildTicketStrip(t, meta, bgBase64)
        : `<div class="ticket ticket-empty"></div>`;
      if (idx < 2) {
        inner += `<div class="cut-gap"></div>`;
      }
    });

    pages.push(`<div class="a4-page">${inner}</div>`);
  }
  return pages.join('\n');
}

// ─────────────────────────────────────────────────────────────
// HTML WRAPPER
// ─────────────────────────────────────────────────────────────
function buildHtml(pagesHtml, bookingRef) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>MEE Tickets — ${esc(bookingRef)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}

body{
  background:#1a1a1a;
  font-family:Arial,Helvetica,sans-serif;
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
}

/* ═══ A4 PAGE ═══ */
.a4-page{
  width:210mm;
  height:297mm;
  overflow:hidden;
  display:flex;
  flex-direction:column;
  background:#0a0a14;
  page-break-after:always;
}
.a4-page:last-child{page-break-after:avoid;}

/* ═══ CUT LINE — plain solid grey ═══ */
.cut-gap{
  width:100%;
  height:1px;
  flex-shrink:0;
  background:rgba(180,180,180,0.28);
}

/* ═══ TICKET STRIP  210 × 98.8mm ═══ */
.ticket{
  width:210mm;
  height:98.8mm;
  flex-shrink:0;
  position:relative;
  overflow:hidden;
  background:#0a0a14;
}
.ticket-empty{ background:#0a0a14; }

/* Background fills full ticket — the bg image already contains
   the sponsor/social strip baked into its bottom portion */
.ticket-bg{
  position:absolute;
  inset:0;
  width:100%;
  height:100%;
  object-fit:fill;
  object-position:center;
  display:block;
  z-index:0;
}
.ticket-bg-fallback{
  position:absolute;
  inset:0;
  background:#0d0d18;
  z-index:0;
}

/* All overlays above bg */
.evinfo,.evmeta,.rp{ position:absolute; z-index:10; }

/* ──────────────────────────────────────────────────────
   Category + Price
   Sits in the top-right area of the left zone.
   left:3%  right:28%  text-align:right
────────────────────────────────────────────────────── */
.evinfo{
  left:3%;
  right:28%;
  top:4mm;
  text-align:right;
}
.ev-name{
  font-size:20pt;
  font-weight:900;
  letter-spacing:2px;
  color:#fff;
  line-height:1;
  text-shadow:0 2px 16px rgba(0,0,0,0.95);
}
.ev-price{
  font-size:17pt;
  font-weight:900;
  letter-spacing:1px;
  text-shadow:0 2px 8px rgba(0,0,0,0.8);
  margin-top:1mm;
}

/* ──────────────────────────────────────────────────────
   Date / Time / Venue block
   Vertically centred in the usable content area of the left zone.
   The bg image's sponsor strip occupies roughly the bottom 20% (~20mm).
   So usable area = top:0 to bottom:20%.  We centre inside top:5% → bottom:22%.
   Using top + transform keeps it truly centred regardless of content height.
────────────────────────────────────────────────────── */
.evmeta{
  left:38%;
  right:10%;
  top:60%;
  transform:translateY(-55%);   /* shift slightly above true centre — matches reference */
}
.em-item{
  display:flex;
  flex-direction:column;
  gap:0.4mm;
}
.em-lbl{
  font-size:4.5pt;
  letter-spacing:2.5px;
  color:rgb(248, 245, 245);
  text-transform:uppercase;
  line-height:1;
}
.em-val{
  font-size:9.5pt;
  font-weight:800;
  letter-spacing:0.4px;
  line-height:1.1;
}
.em-divider{
  width:40mm;
  height:0.7px;
  background:rgba(255,255,255,0.25);
  margin:2mm 0;
}
.em-venue-block{
  display:flex;
  flex-direction:column;
  gap:0.5mm;
}
.em-venue{
  font-size:11.5pt;
  font-weight:900;
  color:#fff;
  letter-spacing:0.3px;
  line-height:1.1;
}
.em-addr{
  font-size:5.2pt;
  color:rgba(222, 230, 228, 0.94);
  text-transform:uppercase;
  letter-spacing:0.9px;
  margin-top:0.3mm;
}

/* ══════════════════════════════════════════════════════
   RIGHT PANEL
   Runs from top:0 to bottom:20% so it sits entirely
   above the bg image's sponsor/social strip, keeping
   those icons fully visible at the bottom.
══════════════════════════════════════════════════════ */
.rp{
  left:73%;
  right:0;
  top:0;
  bottom:15%;           /* ← key: stops before the social strip */
  display:flex;
  flex-direction:column;
  align-items:center;
  padding:2.5mm 3mm 2mm;
  background:rgb(8,8,20);
  border-left:1px solid rgba(255,255,255,0.12);
  overflow:hidden;
}

/* Header */
.rp-hdr{
  font-size:4.5pt;
  letter-spacing:3px;
  color:rgb(232, 239, 232);
  text-transform:uppercase;
  text-align:center;
  width:100%;
  margin-bottom:1.5mm;
  flex-shrink:0;
}

/* Large QR */
.rp-qr{
  width:100%;
  display:flex;
  justify-content:center;
  flex-shrink:0;
  margin-bottom:1.5mm;
}
.rp-qr-img{
  width:38mm;
  height:38mm;
  border-radius:3px;
  border:2px solid rgba(255,255,255,0.22);
  display:block;
  background:#fff;
}
.rp-qr-ph{
  width:38mm;height:38mm;
  background:rgba(255,255,255,0.04);
  border-radius:3px;
  display:flex;align-items:center;justify-content:center;
  font-size:7pt;color:#666;
}

/* Ticket ID */
.rp-ticketid-block{
  text-align:center;
  width:100%;
  flex-shrink:0;
  margin-bottom:2.5mm;
}
.rp-lbl{
  font-size:4pt;
  letter-spacing:2px;
  color:rgba(239, 243, 244, 0.92);
  text-transform:uppercase;
  line-height:1;
  margin-bottom:0.7mm;
}
.rp-ticketid{
  font-size:7.5pt;
  font-weight:900;
  color:#ffffff;
  letter-spacing:1.5px;
  line-height:1;
  word-break:break-all;
  text-shadow:0 0 10px rgba(228,255,0,0.45);
}

.rp-divider{
  width:100%;
  height:0.7px;
  background:rgba(255,255,255,0.18);
  margin-bottom:1.5mm;
  flex-shrink:0;
}

/* Grid */
.rp-grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:1.8mm 1.5mm;
  width:100%;
  flex-shrink:0;
}
.rp-cell{
  display:flex;
  flex-direction:column;
  gap:0.4mm;
}
.rp-big{
  font-size:8.5pt;
  font-weight:900;
  line-height:1.2;
}
.rp-val{
  font-size:7.5pt;
  font-weight:700;
  line-height:1.2;
}

/* Explicit colour helpers — inline style on category was being
   overridden in some Puppeteer builds; class-based is more reliable */
.rp-pink  { color:#ff00a2 !important; }
.rp-green { color:#e4ff00 !important; }
.rp-white { color:#ffffff !important; }

/* Valid badge — pinned to bottom of panel via margin-top:auto */
.rp-valid{
  width:100%;
  margin-top:auto;
  flex-shrink:0;
  background:rgba(76,220,128,0.10);
  border:0.8px solid rgba(76,220,128,0.38);
  color:#4cdc80;
  font-size:4pt;
  font-weight:700;
  letter-spacing:1px;
  padding:1.8mm 2mm;
  border-radius:2px;
  text-align:center;
  line-height:1.4;
}

@page{size:210mm 297mm;margin:0;}
@media print{
  body{background:#fff;}
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
}
</style>
</head>
<body>
${pagesHtml}
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// PUPPETEER RENDER
// ─────────────────────────────────────────────────────────────
async function renderHtmlToPdf(html) {
  const puppeteer = require('puppeteer');
  const browser   = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
    const pdfBuffer = await page.pdf({
      width:           '210mm',
      height:          '297mm',
      printBackground: true,
      margin:          { top: 0, right: 0, bottom: 0, left: 0 },
    });
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

// ─────────────────────────────────────────────────────────────
// PUBLIC API — reads from BulkBooking.tickets subdocs
// ─────────────────────────────────────────────────────────────
async function generateSingleTicketPdf(ticket, meta) {
  const bgBase64  = await loadBgBase64();
  const pagesHtml = buildPages([ticket], meta, bgBase64);
  const html      = buildHtml(pagesHtml, ticket.ticketId || meta.bookingRef);
  return renderHtmlToPdf(html);
}

async function generateBundlePdf(tickets, meta) {
  const bgBase64  = await loadBgBase64();
  const pagesHtml = buildPages(tickets, meta, bgBase64);
  const html      = buildHtml(pagesHtml, meta.bookingRef);
  return renderHtmlToPdf(html);
}

module.exports = { generateSingleTicketPdf, generateBundlePdf };