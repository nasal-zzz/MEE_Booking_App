'use strict';

const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code:        { type: String, required: true, unique: true, uppercase: true, trim: true },
  type:        { type: String, enum: ['fixed', 'percent'], default: 'fixed' },
  value:       { type: Number, required: true },   // ₹ amount or % off
  minOrder:    { type: Number, default: 0 },        // minimum order amount (₹) to apply
  minTickets:  { type: Number, default: 0 },        // minimum ticket quantity to apply
  maxUses:     { type: Number, default: 0 },        // 0 = unlimited
  usedCount:   { type: Number, default: 0 },
  usedBy:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  validFrom:   { type: Date, default: null },
  validUntil:  { type: Date, default: null },
  isActive:    { type: Boolean, default: true },
  isFeatured:  { type: Boolean, default: false },
  description: { type: String, default: '' },
  // [] = all categories allowed; non-empty = only these categories
  applicableCategories: { type: [String], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('Coupon', couponSchema);