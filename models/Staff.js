const mongoose = require('mongoose');

const staffSchema = new mongoose.Schema({
  firstName:  { type: String, required: true, trim: true },
  lastName:   { type: String, default: '', trim: true },
  email:      { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:      { type: String, default: '', trim: true },
  username:   { type: String, required: true, unique: true, trim: true },
  password:   { type: String, required: true },
  plainPassword: { type: String, default: '' },
  role:       { type: String, enum: ['superadmin', 'admin', 'staff'], default: 'staff' },
  isActive:   { type: Boolean, default: true },

  // Permissions
  canScanQR:       { type: Boolean, default: false },
  canViewBookings: { type: Boolean, default: false },
  canManageEvents: { type: Boolean, default: false },
  canSellTickets:  { type: Boolean, default: false },

  // Gate assignment — only used when canScanQR is true
  gateNo:           { type: String, default: '' },   
  assignedCategory: { type: String, default: '' },  
  assignedEventId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null },

createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null },
createdByEmail: { type: String, default: null }, 
createdByName:  { type: String, default: null },

}, { timestamps: true });

staffSchema.virtual('fullName').get(function () {
  return (this.firstName + ' ' + this.lastName).trim();
});

staffSchema.pre('save', function (next) {
  if (this.isModified('password') && !this.password.startsWith('$2')) {
    this.plainPassword = this.password;
  }
  next();
});

module.exports = mongoose.model('Staff', staffSchema);