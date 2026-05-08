'use strict';

const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────
// BACKGROUND IMAGE — cached in memory so we don't re-read disk
// on every request, and so the base64 string is embedded ONCE
// in the HTML (as a CSS variable) instead of once per ticket.
// ─────────────────────────────────────────────────────────────
let _bgBase64Cache = null;

async function loadBgBase64() {
  if (_bgBase64Cache) return _bgBase64Cache;

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
      _bgBase64Cache = `data:image/jpeg;base64,${buf.toString('base64')}`;
      return _bgBase64Cache;
    } catch (sharpErr) {
      console.warn(`[bulkPdfHelper] sharp failed (${sharpErr.message}), reading raw`);
      const ext  = path.extname(p).toLowerCase();
      const mime = ext === '.webp' ? 'image/webp'
                 : ext === '.png'  ? 'image/png'
                 :                   'image/jpeg';
      const data = fs.readFileSync(p);
      console.log(`[bulkPdfHelper] BG loaded raw, mime=${mime}, size=${data.length}`);
      _bgBase64Cache = `data:${mime};base64,${data.toString('base64')}`;
      return _bgBase64Cache;
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
// Background is now rendered via .ticket::before (CSS variable)
// instead of a per-ticket <img> — this keeps the HTML small
// regardless of how many tickets are in the bundle.
// ─────────────────────────────────────────────────────────────
function buildTicketStrip(ticket, meta) {
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

  <!-- Category + Price — top-right of left zone -->
  <div class="evinfo">
    <div class="ev-name">${esc((meta.categoryName || '').toUpperCase())}</div>
    <div class="ev-price" style="color:${accentPink};">&#8377;&nbsp;${(meta.pricePerTicket || 0).toLocaleString('en-IN')}</div>
  </div>

  <!-- Date / Time / Venue — vertically centred in artist area -->
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
      <span class="em-venue">${venue}</span>
      ${venueAddr ? `<span class="em-addr">${venueAddr}</span>` : ''}
    </div>
  </div>

  <!-- RIGHT PANEL — stops at bottom:20% to keep social strip visible -->
  <div class="rp">

    <div class="rp-hdr">TICKET DETAILS</div>

    <div class="rp-qr">
      ${qrSrc
        ? `<img src="${qrSrc}" alt="QR" class="rp-qr-img"/>`
        : `<div class="rp-qr-ph">QR</div>`}
    </div>

    <div class="rp-ticketid-block">
      <div class="rp-lbl">TICKET ID</div>
      <div class="rp-ticketid">${ticketId}</div>
    </div>

    <div class="rp-divider"></div>

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
function buildPages(tickets, meta) {
  const pages = [];
  for (let i = 0; i < tickets.length; i += 3) {
    const group = tickets.slice(i, i + 3);
    while (group.length < 3) group.push(null);

    let inner = '';
    group.forEach((t, idx) => {
      inner += t
        ? buildTicketStrip(t, meta)
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
// bgBase64 is injected ONCE as a CSS custom property on :root.
// Every .ticket picks it up via .ticket::before — so a 100-ticket
// bundle has the base64 string in the HTML exactly once (~165KB)
// instead of 100 times (~16MB), which is what caused the timeout.
// ─────────────────────────────────────────────────────────────
function buildHtml(pagesHtml, bookingRef, bgBase64) {
  const bgCss = bgBase64
    ? `--ticket-bg-url: url("${bgBase64}");`
    : `--ticket-bg-url: none;`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>MEE Tickets — ${esc(bookingRef)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}

:root{
  ${bgCss}
}

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

/* Background rendered via ::before — single CSS variable, not per-ticket <img> */
.ticket::before{
  content:'';
  position:absolute;
  inset:0;
  width:100%;
  height:100%;
  background-image:var(--ticket-bg-url);
  background-size:100% 100%;   /* equivalent to object-fit:fill */
  background-position:center;
  background-repeat:no-repeat;
  display:block;
  z-index:0;
}

.evinfo,.evmeta,.rp{ position:absolute; z-index:10; }

/* Category + Price */
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

/* Date / Time / Venue — vertically centred in artist area */
.evmeta{
  left:40%;
  right:28%;
  top:59%;
  transform:translateY(-75%);
}
.em-item{
  display:flex;
  flex-direction:column;
  gap:0.4mm;
}
.em-lbl{
  font-size:4.5pt;
  letter-spacing:2.5px;
  color:rgba(255,255,255,0.65);
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
  color:rgba(255,255,255,0.60);
  text-transform:uppercase;
  letter-spacing:0.9px;
  margin-top:0.3mm;
}

/* RIGHT PANEL — stops at bottom:20% to keep social strip visible */
.rp{
  left:73%;
  right:0;
  top:0;
  bottom:20%;
  display:flex;
  flex-direction:column;
  align-items:center;
  padding:2.5mm 3mm 2mm;
  background:rgb(8,8,20);
  border-left:1px solid rgba(255,255,255,0.12);
  overflow:hidden;
}

.rp-hdr{
  font-size:4.5pt;
  letter-spacing:3px;
  color:rgba(255,255,255,0.70);
  text-transform:uppercase;
  text-align:center;
  width:100%;
  margin-bottom:1.5mm;
  flex-shrink:0;
}

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

.rp-ticketid-block{
  text-align:center;
  width:100%;
  flex-shrink:0;
  margin-bottom:1.5mm;
}
.rp-lbl{
  font-size:4pt;
  letter-spacing:2px;
  color:rgba(255,255,255,0.72);
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

.rp-pink  { color:#ff00a2 !important; }
.rp-green { color:#e4ff00 !important; }
.rp-white { color:#ffffff !important; }

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
//
// WHY NOT networkidle0:
//   Large base64 strings embedded in HTML confuse Puppeteer's
//   network tracker — it never reaches "idle" and times out.
//
// FIX:
//   1. waitUntil:'domcontentloaded' — fires as soon as DOM is parsed.
//   2. waitForFunction — polls until every <img> is decoded.
//      QR code <img> tags are the only real images now (bg is CSS).
//   3. Small 300ms settle before PDF capture.
// ─────────────────────────────────────────────────────────────
async function renderHtmlToPdf(html) {
  const puppeteer = require('puppeteer');
  const browser   = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });
  try {
    const page = await browser.newPage();

    // Step 1 — load DOM only, never waits on network activity
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Step 2 — wait until every <img> (QR codes) reports complete
    await page.waitForFunction(
      () => Array.from(document.images).every(img => img.complete),
      { timeout: 30000 }
    );

    // Step 3 — small paint settle
    await new Promise(r => setTimeout(r, 300));

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
// PUBLIC API
// ─────────────────────────────────────────────────────────────
async function generateSingleTicketPdf(ticket, meta) {
  const bgBase64  = await loadBgBase64();
  const pagesHtml = buildPages([ticket], meta);
  const html      = buildHtml(pagesHtml, ticket.ticketId || meta.bookingRef, bgBase64);
  return renderHtmlToPdf(html);
}

async function generateBundlePdf(tickets, meta) {
  const bgBase64  = await loadBgBase64();
  const pagesHtml = buildPages(tickets, meta);
  const html      = buildHtml(pagesHtml, meta.bookingRef, bgBase64);
  return renderHtmlToPdf(html);
}

module.exports = { generateSingleTicketPdf, generateBundlePdf };