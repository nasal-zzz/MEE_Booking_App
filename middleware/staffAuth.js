const Staff = require('../models/Staff');

const staffAuth = async (req, res, next) => {
  if (!req.session?.staffLoggedIn || !req.session?.staffUser) {
    const isJson = req.headers['accept']?.includes('application/json') ||
                   req.headers['content-type']?.includes('application/json') || req.xhr;
    if (isJson) return res.status(401).json({ success: false, message: 'Not authenticated.' });
    return res.redirect('/staff/login');
  }

  try {
    // Always re-fetch from DB — never trust the session-cached object alone
    const staffId = req.session.staffUser?.id;

    // Hardcoded superadmin has no DB id — let them through directly
    if (!staffId) {
      req.staffUser = req.session.staffUser;
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      return next();
    }

    const member = await Staff.findById(staffId).select('-__v').lean();

    if (!member) {
      // Deleted — kill session
      return req.session.destroy(() => {
        res.clearCookie('mee.sid', { path: '/' });
        const isJson = req.headers['accept']?.includes('application/json') || req.xhr;
        if (isJson) return res.status(401).json({ success: false, message: 'Account not found.' });
        res.redirect('/staff/login');
      });
    }

    if (!member.isActive) {
      // Blocked — kill session
      return req.session.destroy(() => {
        res.clearCookie('mee.sid', { path: '/' });
        const isJson = req.headers['accept']?.includes('application/json') || req.xhr;
        if (isJson) return res.status(401).json({ success: false, message: 'Account is blocked.' });
        res.redirect('/staff/login?blocked=1');
      });
    }

    // Sync session with fresh DB values (role/permissions may have changed)
    req.session.staffUser = {
      id:              member._id.toString(),
      username:        member.username,
      name:            (member.firstName + ' ' + (member.lastName || '')).trim(),
      role:            member.role,
      canScanQR:       !!member.canScanQR,
      canViewBookings: !!member.canViewBookings,
      canManageEvents: !!member.canManageEvents,
      canSellTickets:  !!member.canSellTickets,
    };
    req.staffUser = req.session.staffUser;

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();

  } catch (err) {
    console.error('staffAuth DB check error:', err.message);
    const isJson = req.headers['accept']?.includes('application/json') || req.xhr;
    if (isJson) return res.status(500).json({ success: false, message: 'Auth error.' });
    res.redirect('/staff/login');
  }
};

module.exports = staffAuth;