const Staff = require('../models/Staff');

// Re-usable DB check — returns null if account is gone/blocked
const verifyStaffSession = async (req) => {
  const staffId = req.session.staffUser?.id;
  if (!staffId) return 'hardcoded'; // hardcoded superadmin — no DB record needed

  const member = await Staff.findById(staffId).select('isActive role').lean();
  if (!member) return 'deleted';
  if (!member.isActive) return 'blocked';
  return 'ok';
};

const killSession = (req, res, redirectTo = '/staff/login') => {
  req.session.destroy(() => {
    res.clearCookie('mee.sid', { path: '/' });
    const isJson = req.headers['content-type']?.includes('application/json') || req.xhr;
    if (isJson) return res.status(401).json({ success: false, message: 'Session expired.' });
    res.redirect(redirectTo);
  });
};

const adminAuth = async (req, res, next) => {
  const isAdmin = req.session.adminLoggedIn ||
    (req.session.staffLoggedIn && ['admin', 'superadmin'].includes(req.session.staffUser?.role));

  if (!isAdmin) {
    if (req.method === 'POST' && req.path === '/login') return next();
    const isJson = req.headers['content-type']?.includes('application/json') || req.xhr;
    if (isJson) return res.status(401).json({ success: false, message: 'Not authenticated.' });
    return res.redirect('/staff/login#admin');
  }

  // DB check for DB-backed staff (not hardcoded admin)
  if (req.session.staffUser?.id) {
    try {
      const status = await verifyStaffSession(req);
      if (status === 'deleted' || status === 'blocked') {
        return killSession(req, res, '/staff/login');
      }
    } catch (err) {
      console.error('adminAuth DB check error:', err.message);
    }
  }

  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
};

const superAuth = async (req, res, next) => {
  const isSuperAdmin = req.session.superAdminLoggedIn ||
    (req.session.staffLoggedIn && req.session.staffUser?.role === 'superadmin');

  if (!isSuperAdmin) {
    if (req.method === 'POST' && req.path === '/login') return next();
    const isJson = req.headers['content-type']?.includes('application/json') || req.xhr;
    if (isJson) return res.status(401).json({ success: false, message: 'Not authenticated.' });
    return res.redirect('/staff/login');
  }

  // DB check for DB-backed superadmin
  if (req.session.staffUser?.id) {
    try {
      const status = await verifyStaffSession(req);
      if (status === 'deleted' || status === 'blocked') {
        return killSession(req, res, '/staff/login');
      }
    } catch (err) {
      console.error('superAuth DB check error:', err.message);
    }
  }

  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
};

module.exports = { adminAuth, superAuth };