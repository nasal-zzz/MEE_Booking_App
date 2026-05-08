'use strict';
const mongoose = require('mongoose');

// ── Ticket Category Schema (mirrors Event ticketTypeSchema) ──
const bulkTicketTypeSchema = new mongoose.Schema({
  category:    { type: String, required: true },   // lowercased key e.g. "vip"
  name:        { type: String, default: '' },       // display name e.g. "VIP"
  color:       { type: String, default: '#9500ff' },
  price:       { type: Number, required: true },
  totalSeats:  { type: Number, required: true, min: 1 },
  bookedSeats: { type: Number, default: 0, min: 0 }, // tracks how many bulk tickets generated
  seatType:    { type: String, enum: ['standing', 'sitting'], default: 'standing' },
  seatPrefix:  { type: String, default: '' },        // e.g. "vip", used for seat numbering
  seatStart:   { type: Number, default: 1 },
  gateNumber:  { type: String, default: '' },
  maxPerBatch: { type: Number, default: 500 },       // max tickets per generation run
  discountTiers: [{ minQty: { type: Number }, discount: { type: Number } }],
  terms:       { type: String, default: '' },
  isActive:    { type: Boolean, default: true },
});

bulkTicketTypeSchema.virtual('availableSeats').get(function () {
  return this.totalSeats - this.bookedSeats;
});
bulkTicketTypeSchema.virtual('isSoldOut').get(function () {
  return this.bookedSeats >= this.totalSeats;
});

// ── Main BulkEvent Schema ──
const bulkEventSchema = new mongoose.Schema({
  name:         { type: String, required: true },
  shortDescription: { type: String, default: '' },

  // Date & Time
  date:         { type: Date, required: true },
  doorsOpen:    { type: String, default: '8:00 PM' },
  endTime:      { type: String, default: '4:00 AM' },

  // Location
  venue:        { type: String, required: true },
  venueAddress: { type: String, default: '' },
  googleMapLink:{ type: String, default: '' },

  // Ticket Categories
  ticketTypes:  [bulkTicketTypeSchema],

  // Meta
  isActive:     { type: Boolean, default: true },
  isFeatured:   { type: Boolean, default: false },
}, {
  timestamps: true,
  toJSON:  { virtuals: true },
  toObject:{ virtuals: true },
});

bulkEventSchema.virtual('totalTicketsGenerated').get(function () {
  return this.ticketTypes.reduce((sum, t) => sum + t.bookedSeats, 0);
});

module.exports = mongoose.model('BulkEvent', bulkEventSchema);