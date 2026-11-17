'use strict';

const mongoose = require('mongoose');

const attendeeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  age: { type: Number, required: true },
  gender: { type: String, enum: ['male', 'female', 'other', ''], default: '' },
  special: { type: String, default: '' },
});

const ticketSchema = new mongoose.Schema({
  ticketId: { type: String, required: true },
  attendee: attendeeSchema,
  qrCode: { type: String, default: '' },
  qrData: { type: String, default: '' },
  isUsed: { type: Boolean, default: false },
  usedAt: { type: Date, default: null },
  usedByDevice: { type: String, default: null },
  scannedById: { type: String, default: null },
  scannedBy: { type: String, default: null },
  seatId: { type: String, default: null },
  sectionName: { type: String, default: null },
  seatNumber: { type: String, default: null },
});

function generateRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ref = 'MEE-';
  for (let i = 0; i < 8; i++) ref += chars[Math.floor(Math.random() * chars.length)];
  return ref;
}

const bookingSchema = new mongoose.Schema({
  bookingRef: { type: String, unique: true, default: generateRef },

  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  ticketType: { type: String, required: true },
  pricePerTicket: { type: Number, required: true },
  quantity: { type: Number, required: true },
  subtotal: { type: Number, required: true },
  discount: { type: Number, default: 0 },
  couponCode: { type: String, default: null },
  convenienceFee: { type: Number, default: 0 },
  totalAmount: { type: Number, required: true },
  tickets: [ticketSchema],
  gateNumber: { type: String, default: '' },
  zone: { type: String, default: '' },
  qrFailed: { type: Boolean, default: false },

  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  paymentId: { type: String, default: null },
  paymentMethod: { type: String, enum: ['online', 'cash'], default: 'online' },
  soldBy: { type: String, default: '' },
  orderId: { type: String, default: null },
  signature: { type: String, default: null },

  contactPhone: { type: String, default: '' },
  contactEmail: { type: String, default: '' },
  contactName: { type: String, default: '' },
  seatsReleased: { type: Boolean, default: false },
  failedNotified: { type: Boolean, default: false },


  reminderImmediateSentAt: { type: Date, default: null },
  reminder24SentAt: { type: Date, default: null },
  notifiedFailedAt: { type: Date, default: null },
  confirmationResentAt: { type: Date, default: null },
}, { timestamps: true });

bookingSchema.index({ qrFailed: 1, paymentStatus: 1 });

module.exports = mongoose.model('Booking', bookingSchema);