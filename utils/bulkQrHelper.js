'use strict';

const QRCode = require('qrcode');

async function generateBulkQR(data) {
  const qrString = JSON.stringify(data);
  const dataUrl  = await QRCode.toDataURL(qrString, {
    errorCorrectionLevel: 'M',
    type:   'image/png',
    width:  300,
    margin: 2,
    color:  { dark: '#000000', light: '#FFFFFF' },
  });
  return { qrCode: dataUrl, qrData: qrString };
}

async function generateBulkQRBatch(tickets, meta) {
  const { eventId, ticketType, gateNumber } = meta;

  const CHUNK = 100;
  for (let i = 0; i < tickets.length; i += CHUNK) {
    const chunk = tickets.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (ticket) => {
        const payload = {
          v:  1,
          t:  ticket.ticketId,
          g:  gateNumber || '',
          bk: 'bulk',            // scanner uses this to distinguish bulk vs online
          ts: Date.now(),
        };
        const { qrCode, qrData } = await generateBulkQR(payload);
        ticket.qrCode = qrCode;
        ticket.qrData = qrData;
      })
    );
  }
}

module.exports = { generateBulkQR, generateBulkQRBatch };