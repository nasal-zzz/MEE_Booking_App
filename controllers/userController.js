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
  exports.updateProfile = async (req, res) => {
    try {
      const { firstName, lastName, email, whatsapp, gender, place, district } = req.body;

      if (!firstName || firstName.trim().length < 2)
        return res.json({ success: false, message: 'First name must be at least 2 characters.' });

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return res.json({ success: false, message: 'Enter a valid email address.' });

      const fullWa = whatsapp && /^[6-9]\d{9}$/.test(whatsapp.trim()) ? '+91' + whatsapp.trim() : '';

      await User.findByIdAndUpdate(req.user._id, {
        firstName: firstName.trim(),
        lastName:  (lastName || '').trim(),
        email:     (email || '').trim().toLowerCase(),
        whatsapp:  fullWa || req.user.whatsapp || '',
        gender:    gender || '',
        place:     (place || '').trim(),
        district:  district || '',
      });

      return res.json({ success: true, message: 'Profile updated successfully!' });
    } catch (err) {
      console.error('updateProfile error:', err);
      res.json({ success: false, message: 'Failed to update profile.' });
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

  // ── GET /admin/users  &  GET /superadmin/users ──
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

      const viewPath = isSuperAdmin ? 'superadmin/users' : 'admin/users';

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

  // ── POST /admin/users/:id/block  &  POST /superadmin/users/:id/block ──
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

  // ── POST /admin/users/:id/unblock  &  POST /superadmin/users/:id/unblock ──
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