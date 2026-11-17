const mongoose = require('mongoose');

const seatSchema = new mongoose.Schema({
  seatId:      { type: String },
  row:         { type: String },
  number:      { type: Number },
  category:    { type: String },
  status:      { type: String, enum: ['available','booked','blocked'], default: 'available' },
  bookedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
  x:           { type: Number, default: 0 },
  y:           { type: Number, default: 0 },
}, { _id: false });

const sectionSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  category:    { type: String, required: true },

  // ─ Zone visual properties saved by zone-builder ─
  zoneShape:   { type: String, enum: ['rect', 'round', 'triangle'], default: 'rect' },
  zoneW:       { type: Number, default: 200 },
  zoneH:       { type: Number, default: 100 },
  zoneRot:     { type: Number, default: 0 },   // degrees; 0 IS a valid saved value
  color:       { type: String, default: '' },   // custom hex color (overrides category default)

  // Canvas position
  x:           { type: Number, default: 0 },
  y:           { type: Number, default: 0 },

  // Seat capacity
  totalSeats:  { type: Number, default: 0 },
  bookedSeats: { type: Number, default: 0 },

  // Legacy grid fields
  rows:        { type: Number, default: 1 },
  seatsPerRow: { type: Number, default: 1 },
  seats:       { type: [seatSchema], default: [] },
});

// ── Stage ──
const stageSchema = new mongoose.Schema({
  shape:  { type: String, enum: ['rectangle','semicircle','thrust','intheround'], default: 'rectangle' },
  color:  { type: String, default: '#74a2ed' },
  label:  { type: String, default: 'STAGE' },
  x:      { type: Number, default: 100 },
  y:      { type: Number, default: 30 },
  width:  { type: Number, default: 500 },
  height: { type: Number, default: 120 },
}, { _id: false });

// ── Overlay (reserved area or POI marker) ──
const overlaySchema = new mongoose.Schema({
  type:    { type: String, enum: ['reserved', 'poi'], required: true },
  label:   { type: String, required: true },
  note:    { type: String, default: '' },
  icon:    { type: String, default: '' },
  color:   { type: String, default: '#9D4EDD' },

  // ─ Visual shape — same options as zone shapes ─
  shape:   { type: String, enum: ['rect', 'round', 'triangle'], default: 'rect' },

  // Geometry
  x:       { type: Number, default: 100 },
  y:       { type: Number, default: 100 },
  w:       { type: Number, default: 160 },
  h:       { type: Number, default: 80 },
  rot:     { type: Number, default: 0 },
}, { _id: true });

// ── SeatMap ──
const seatMapSchema = new mongoose.Schema({
  event:        { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, unique: true },
  stage:        { type: stageSchema, default: () => ({}) },
  sections:     [sectionSchema],
  overlays:     { type: [overlaySchema], default: [] },
  canvasWidth:  { type: Number, default: 960 },
  canvasHeight: { type: Number, default: 760 },
  isActive:     { type: Boolean, default: false },

  // PNG snapshot of the venue map — shown to users on the booking/seatpicker page
  previewImage: { type: String, default: null },
}, { timestamps: true });

seatMapSchema.virtual('allSeats').get(function () {
  return this.sections.flatMap(s => s.seats);
});

module.exports = mongoose.model('SeatMap', seatMapSchema);