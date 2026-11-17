'use strict';

const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code:        { type: String, required: true, unique: true, uppercase: true, trim: true },
  type:        { type: String, enum: ['fixed', 'percent'], default: 'fixed' },
  value:       { type: Number, required: true },   
  minOrder:    { type: Number, default: 0 },       
  minTickets:  { type: Number, default: 0 },        
  maxUses:     { type: Number, default: 0 },        
  usedCount:   { type: Number, default: 0 },
  usedBy:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  validFrom:   { type: Date, default: null },
  validUntil:  { type: Date, default: null },
  isActive:    { type: Boolean, default: true },
  isFeatured:  { type: Boolean, default: false },
  description: { type: String, default: '' },
  applicableCategories: { type: [String], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('Coupon', couponSchema);