const mongoose = require('mongoose');

const scanLogSchema = new mongoose.Schema({
  bookingId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: false },
  bookingRef:     { type: String, required: false },
  ticketId:       { type: String, required: true },
  eventId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  attendeeName:   { type: String, default: '' },
  attendeeGender: { type: String, default: '' },   // ← added back
  scannedAt:      { type: Date, default: Date.now },
  scannedBy: {
    staffId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    staffName: { type: String, default: '' },
  },
  platform:   { type: String, default: '' },
  location: {
    gate: { type: String, default: '' },
    zone: { type: String, default: '' },
  },
  qrSnapshot: {
    bookingRef: { type: String, default: '' },
    ticketId:   { type: String, default: '' },
  },
}, { timestamps: true });

module.exports = mongoose.model('ScanLog', scanLogSchema);