const mongoose = require('mongoose');

const sponsorSchema = new mongoose.Schema({
  name:      { type: String, required: true, trim: true },
  logo:      { type: String, required: true },  // base64 data URL
  website:   { type: String, default: '' },
  tier:      { type: String, enum: ['title', 'gold', 'silver', 'partner'], default: 'partner' },
  // Which events this sponsor appears on (empty = all events)
  events:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'Event' }],
  // Show on tickets/PDF
  showOnTicket: { type: Boolean, default: true },
  // Show on website homepage
  showOnSite:   { type: Boolean, default: true },
  isActive:     { type: Boolean, default: true },
  order:        { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Sponsor', sponsorSchema);
