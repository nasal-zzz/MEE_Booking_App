  const User    = require('../models/User');
  const Booking = require('../models/Booking');

  // ════════════════════════════════════════════════════════════
  // ── USER-FACING ROUTES ──
  // ════════════════════════════════════════════════════════════

  // ── GET /user/profile ──
  exports.getProfile = async (req, res) => {
    try {
      const bookings = await Booking.find({ user: req.user._id })
        .populate('event')
        .sort({ createdAt: -1 });

      const totalSpent = bookings
        .filter(b => b.paymentStatus === 'paid')
        .reduce((sum, b) => sum + b.totalAmount, 0);

      const totalTickets = bookings
        .filter(b => b.paymentStatus === 'paid')
        .reduce((sum, b) => sum + b.quantity, 0);

      res.render('pages/profile', {
        title: 'My Profile — MEE',
        user: req.user,
        bookings,
        stats: {
          totalBookings: bookings.filter(b => b.paymentStatus === 'paid').length,
          totalTickets,
          totalSpent,
        },
      });
    } catch (err) {
      console.error('getProfile error:', err);
      res.status(500).render('pages/error', { message: err.message, code: 500 });
    }
  };

  // ── POST /user/profile/update ──


  // Key change: email is no longer accepted here — it is managed exclusively via
// the /auth/send-email-otp + /auth/verify-email-otp modal flow.
// ─────────────────────────────────────────────────────────────────────────────
 
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.session.userId || req.user?._id;
    if (!userId) return res.json({ success: false, message: 'Not logged in.' });
 
    // NOTE: 'email' is intentionally excluded — use the email OTP modal to change it.
    const { firstName, lastName, whatsapp, gender, place, district } = req.body;
 
    const updates = {};
 
    if (firstName !== undefined) {
      const fn = firstName.trim();
      if (!fn) return res.json({ success: false, message: 'First name cannot be empty.' });
      updates.firstName = fn;
    }
    if (lastName  !== undefined) updates.lastName  = lastName.trim();
    if (gender    !== undefined) updates.gender    = gender;
    if (place     !== undefined) updates.place     = place.trim();
    if (district  !== undefined) updates.district  = district;
 
    if (whatsapp !== undefined) {
      const wa = whatsapp.trim().replace(/\D/g, '');
      if (wa && !/^[6-9]\d{9}$/.test(wa))
        return res.json({ success: false, message: 'Enter a valid 10-digit WhatsApp number.' });
      updates.whatsapp = wa ? '+91' + wa : '';
    }
 
    await User.findByIdAndUpdate(userId, updates);
    return res.json({ success: true, message: 'Profile updated successfully!' });
  } catch (err) {
    console.error('updateProfile error:', err);
    return res.json({ success: false, message: 'Server error. Please try again.' });
  }
};
 

  // ── DELETE /user/delete-booking/:bookingId ──
  exports.deleteBooking = async (req, res) => {
    try {
      const booking = await Booking.findOne({
        _id:  req.params.bookingId,
        user: req.user._id,
      });

      if (!booking) return res.json({ success: false, message: 'Booking not found.' });

      if (booking.paymentStatus === 'paid')
        return res.json({ success: false, message: 'Paid bookings cannot be deleted.' });

      await booking.deleteOne();
      return res.json({ success: true });
    } catch (err) {
      console.error('deleteBooking error:', err);
      res.json({ success: false, message: 'Server error.' });
    }
  };


  // ════════════════════════════════════════════════════════════
  // ── ADMIN / SUPERADMIN USER MANAGEMENT ──
  // ════════════════════════════════════════════════════════════

  // ── GET /mee-admin/users  &  GET /superadmin/users ──
  exports.getUsers = async (req, res) => {
    try {
      const users = await User.aggregate([
        {
          $lookup: {
            from:         'bookings',
            localField:   '_id',
            foreignField: 'user',
            as:           'bookings',
          },
        },
        {
          $addFields: {
            bookings: {
              $filter: {
                input: '$bookings',
                as:    'b',
                cond:  { $eq: ['$$b.paymentStatus', 'paid'] },
              },
            },
          },
        },
        { $sort: { createdAt: -1 } },
      ]);

      const isSuperAdmin =
        req.session.superAdminLoggedIn ||
        (req.session.staffLoggedIn && req.session.staffUser?.role === 'superadmin');

      const currentAdmin =
        req.session.staffUser ||
        (req.session.adminLoggedIn
          ? { username: req.session.adminUser, name: req.session.adminUser, role: 'admin' }
          : { username: 'admin', name: 'Admin', role: 'admin' });

      const viewPath = isSuperAdmin ? 'superadmin/users' : 'mee-admin/users';

      res.render(viewPath, {
        title: isSuperAdmin ? 'All Users — Super Admin' : 'All Users — Admin',
        users,
        currentAdmin,
        isSuperAdmin,
      });
    } catch (err) {
      console.error('getUsers error:', err.message);
      res.status(500).send('Error loading users: ' + err.message);
    }
  };

  // ── POST /mee-admin/users/:id/block  &  POST /superadmin/users/:id/block ──
  exports.blockUser = async (req, res) => {
    try {
      const user = await User.findByIdAndUpdate(
        req.params.id,
        { isActive: false },
        { new: true }
      );
      if (!user) return res.json({ success: false, message: 'User not found.' });
      res.json({ success: true, message: 'User blocked.' });
    } catch (err) {
      console.error('blockUser error:', err.message);
      res.json({ success: false, message: err.message });
    }
  };

  // ── POST /mee-admin/users/:id/unblock  &  POST /superadmin/users/:id/unblock ──
  exports.unblockUser = async (req, res) => {
    try {
      const user = await User.findByIdAndUpdate(
        req.params.id,
        { isActive: true },
        { new: true }
      );
      if (!user) return res.json({ success: false, message: 'User not found.' });
      res.json({ success: true, message: 'User unblocked.' });
    } catch (err) {
      console.error('unblockUser error:', err.message);
      res.json({ success: false, message: err.message });
    }
  };

  // ── DELETE /superadmin/users/:id  (SuperAdmin only — hard delete) ──
  exports.deleteUser = async (req, res) => {
    try {
      const user = await User.findByIdAndDelete(req.params.id);
      if (!user) return res.json({ success: false, message: 'User not found.' });

      // Soft-orphan bookings — keeps revenue history intact
      await Booking.updateMany({ user: req.params.id }, { $unset: { user: '' } });

      res.json({ success: true, message: 'User permanently deleted.' });
    } catch (err) {
      console.error('deleteUser error:', err.message);
      res.json({ success: false, message: err.message });
    }
  };