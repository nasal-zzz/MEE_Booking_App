/* ticket-success.js  —  place in /public/js/ticket-success.js */

var BOOKING_REF = window.BOOKING_REF || '';

async function captureTicket(idx) {
  var el = document.getElementById('ticket-' + idx);
  var canvas = await html2canvas(el, {
    scale: 3,
    useCORS: true,
    allowTaint: false,
    backgroundColor: null,
    logging: false,
  });
  return canvas;
}

async function buildPdfBlob() {
  var jsPDF = window.jspdf.jsPDF;
  var pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  var tickets = document.querySelectorAll('.ticket');
  for (var i = 0; i < tickets.length; i++) {
    if (i > 0) pdf.addPage();
    var canvas = await captureTicket(i);
    var imgData = canvas.toDataURL('image/jpeg', 0.92);
    pdf.addImage(imgData, 'JPEG', 0, 0, 297, 210);
  }
  return pdf.output('blob');
}

function downloadBlob(blob, fileName) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function canShareFiles(file) {
  try {
    return !!(navigator.canShare && navigator.canShare({ files: [file] }));
  } catch (e) {
    return false;
  }
}

async function sendToWhatsApp() {
  var btn = document.getElementById('waBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Preparing...';

  try {
    var blob = await buildPdfBlob();
    var fileName = 'MEE_' + BOOKING_REF + '_Tickets.pdf';
    var file = new File([blob], fileName, { type: 'application/pdf' });

    if (canShareFiles(file)) {
      try {
        await navigator.share({
          title: 'MEE Ticket - ' + BOOKING_REF,
          text: 'Your event ticket. Booking Ref: ' + BOOKING_REF,
          files: [file],
        });
      } catch (shareErr) {
        if (shareErr.name !== 'AbortError') {
          downloadBlob(blob, fileName);
          var msg = encodeURIComponent('Your MEE ticket PDF is ready. Booking Ref: ' + BOOKING_REF);
          setTimeout(function () { window.open('https://wa.me/?text=' + msg, '_blank'); }, 800);
        }
      }
    } else {
      downloadBlob(blob, fileName);
      var waMsg = encodeURIComponent(
        'Your MEE ticket PDF has been downloaded. Booking Ref: ' + BOOKING_REF +
        '. Please attach it to WhatsApp.'
      );
      setTimeout(function () { window.open('https://wa.me/?text=' + waMsg, '_blank'); }, 800);
    }
  } catch (e) {
    alert('Failed: ' + e.message);
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="bi bi-whatsapp"></i> Send to WhatsApp';
}

async function downloadSingle(idx, ref) {
  var btn = document.getElementById('dl-' + idx);
  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Generating...';
  try {
    var jsPDF = window.jspdf.jsPDF;
    var canvas = await captureTicket(idx);
    var pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    var imgData = canvas.toDataURL('image/jpeg', 0.92);
    pdf.addImage(imgData, 'JPEG', 0, 0, 297, 210);
    pdf.save('MEE_Ticket_' + (idx + 1) + '_' + ref + '.pdf');
  } catch (e) {
    alert('Download failed: ' + e.message);
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="bi bi-file-earmark-pdf-fill"></i> Download Ticket ' + (idx + 1) + ' as PDF';
}

async function downloadAll() {
  var btn = document.getElementById('dlAllBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Generating PDF...';
  try {
    var blob = await buildPdfBlob();
    downloadBlob(blob, 'MEE_' + BOOKING_REF + '_AllTickets.pdf');
  } catch (e) {
    alert('Download failed: ' + e.message);
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="bi bi-download"></i> Download All Tickets (PDF)';
}

if (window.history && window.history.replaceState) {
  window.history.replaceState(null, '', window.location.href);
  window.history.pushState(null, '', '/');
  window.history.pushState(null, '', window.location.href);
  window.addEventListener('popstate', function () { window.location.replace('/'); });
}