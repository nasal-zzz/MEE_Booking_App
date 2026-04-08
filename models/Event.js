const mongoose = require('mongoose');

// ── Artist Schema ──
const artistSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  designation: { type: String, default: '' },
  photo:       { type: String, default: '' },
});

// ── Ticket Category Schema ──
const ticketTypeSchema = new mongoose.Schema({
  category:    { type: String, required: true },
  name:        { type: String, default: '' },
  color:       { type: String, default: '#6A0DAD' },
  price:       { type: Number, required: true },
  ageLimit:    { type: Number, default: 0 },
  ticketType:  { type: String, enum: ['single', 'multiple'], default: 'single' },
  isCombo:     { type: Boolean, default: false },
  comboCount:  { type: Number, default: 1 },
  comboOfferMinQty:   { type: Number, default: 0 },
  comboOfferDiscount: { type: Number, default: 0 },
  totalSeats:  { type: Number, required: true },
  bookedSeats: { type: Number, default: 0 },
  releasedSeats: { type: [Number], default: [] },

  // ─────────────────────────────────────────────────────────────
  // ✅ seatCounter — monotonically increasing, NEVER decremented.
  //
  // bookedSeats tracks current occupancy (goes up on reserve, down on cancel).
  // seatCounter tracks how many seats have EVER been assigned — only goes up.
  //
  // Why two fields?
  //   If A and B both reserve seats (seatCounter: 2, 3 respectively),
  //   and A cancels, bookedSeats decrements but seatCounter stays at 3.
  //   The next booking gets seatCounter=4 — unique, no collision with B's seat 3.
  //   Without this: the next booking would re-use seatCounter=3, duplicating B's seat.
  //
  // Rule: ALWAYS increment seatCounter when seats are reserved.
  //       NEVER decrement seatCounter for any reason.
  // ─────────────────────────────────────────────────────────────
  paidSeatCount: { type: Number, default: 0 },

  maxPerOrder: { type: Number, default: 10 },
  seatType:    { type: String, enum: ['standing','sitting'], default: 'standing' },
  seatPrefix:  { type: String, default: '' },
  seatStart:   { type: Number, default: 1 },
  gateNumber:  { type: String, default: '' },   // ✅ Gate number for this category
  discountTiers: [{ minQty: { type: Number }, discount: { type: Number } }],
  terms:       { type: String, default: '' },
  isActive:    { type: Boolean, default: true },
});

ticketTypeSchema.virtual('availableSeats').get(function() {
  return this.totalSeats - this.bookedSeats;
});
ticketTypeSchema.virtual('isSoldOut').get(function() {
  return this.bookedSeats >= this.totalSeats;
});

// ── Main Event Schema ──
const eventSchema = new mongoose.Schema({
  name:              { type: String, required: true },
  shortDescription:  { type: String, default: '' },
  about:             { type: String, default: '' },
  instructions:      { type: String, default: '' },

  // Banners
  bannerDesktop:      { type: String, default: '' },
  bannerMobile:       { type: String, default: '' },
  bannerDetail:       { type: String, default: '' },
  bannerDetailMobile: { type: String, default: '' },
  slideDesktop:       { type: String, default: '' },
  slideMobile:        { type: String, default: '' },

  // Artists
  artists:           [artistSchema],

  // Date & Time
  date:              { type: Date, required: true },
  doorsOpen:         { type: String, default: '8:00 PM' },
  endTime:           { type: String, default: '4:00 AM' },

  // Location
  venue:             { type: String, required: true },
  venueAddress:      { type: String, default: '' },
  googleMapLink:     { type: String, default: '' },

  // Tickets
  ticketTypes:       [ticketTypeSchema],
  convenienceFee:    { type: Number, default: 0 },

  // Meta
  isActive:          { type: Boolean, default: true },
  isFeatured:        { type: Boolean, default: false },

}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

eventSchema.virtual('isEventSoldOut').get(function() {
  return this.ticketTypes.length > 0 &&
         this.ticketTypes.every(t => t.bookedSeats >= t.totalSeats);
});
eventSchema.virtual('minPrice').get(function() {
  const active = this.ticketTypes.filter(t => t.isActive && t.bookedSeats < t.totalSeats);
  if (!active.length) return null;
  return Math.min(...active.map(t => t.price));
});

module.exports = mongoose.model('Event', eventSchema);

