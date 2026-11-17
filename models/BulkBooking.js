'use strict';
const mongoose = require('mongoose');

const bulkTicketSchema = new mongoose.Schema({
  ticketId:   { type: String, required: true },
  serialNo:   { type: Number, required: true },
  seatNumber: { type: String, default: 'N/A' },
  qrData:     { type: String, default: '' },
  qrCode:     { type: String, default: '' },
  isUsed: { type: Boolean, default: false },
  usedAt: { type: Date, default: null },
  usedByDevice: { type: String, default: null },
  scannedById: { type: String, default: null },
  scannedBy: { type: String, default: null },
}, { _id: false });

const bulkBookingSchema = new mongoose.Schema({
  bulkEvent:     { type: mongoose.Schema.Types.ObjectId, ref: 'BulkEvent', required: true },
  ticketType:    { type: String, required: true },
  categoryName:  { type: String, default: '' },
  categoryColor: { type: String, default: '#9500ff' },
  gateNumber:    { type: String, default: '' },
  seatType:      { type: String, enum: ['standing', 'sitting'], default: 'standing' },
  pricePerTicket:{ type: Number, required: true },
  bookingRef:    { type: String, unique: true },
  quantity:      { type: Number, required: true },
  totalAmount:   { type: Number, default: 0 },
  tickets:       [bulkTicketSchema],   
  generationStatus: {
    type: String,
    enum: ['pending', 'generating', 'completed', 'failed'],
    default: 'pending',
  },
  generatedAt:  { type: Date },
  bundlePdfUrl: { type: String, default: '' },
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  notes:        { type: String, default: '' },
}, {
  timestamps: true,
  toJSON:  { virtuals: true },
  toObject:{ virtuals: true },
});

bulkBookingSchema.pre('save', async function (next) {
  if (this.bookingRef) return next();
  try {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix  = `MEE-P-${dateStr}-`;
    const last    = await this.constructor
      .findOne({ bookingRef: new RegExp('^' + prefix) })
      .sort({ bookingRef: -1 })
      .select('bookingRef')
      .lean();
    let seq = 1;
    if (last?.bookingRef) {
      const parts = last.bookingRef.split('-');
      seq = (parseInt(parts[parts.length - 1], 10) || 0) + 1;
    }
    this.bookingRef = `${prefix}${String(seq).padStart(5, '0')}`;
    next();
  } catch (err) { next(err); }
});

bulkBookingSchema.index({ bulkEvent: 1, ticketType: 1 });
bulkBookingSchema.index({ bookingRef: 1 }, { unique: true });

module.exports = mongoose.model('BulkBooking', bulkBookingSchema);