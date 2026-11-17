const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  label: { type: String, required: true, trim: true },  
  description: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  visits: { type: Number, default: 0 },
  signups: { type: Number, default: 0 },
  bookings: { type: Number, default: 0 },
  createdBy: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Referral', referralSchema);