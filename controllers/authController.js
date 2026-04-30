  'use strict';

  const User     = require('../models/User');
  const Referral = require('../models/Referral');
  const { createAndSendOTP, createAndSendEmailOTP, verifyOTP } = require('../utils/otpHelper');
  const { signToken } = require('../middleware/auth');

  // ─────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────
  const redirectPage = (res, url, name, subtitle, color = '#9500ff') => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"/>
    <title>Please wait...</title>
    <style>
      body{background:#08080e;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;}
      .w{text-align:center;}
      .s{width:40px;height:40px;border:3px solid rgba(255,255,255,0.08);border-top-color:${color};border-radius:50%;animation:spin 0.7s linear infinite;margin:0 auto 1rem;}
      @keyframes spin{to{transform:rotate(360deg)}}
      .n{color:${color};font-size:1rem;font-weight:600;margin-bottom:0.3rem;}
      .sub{color:#555;font-size:0.8rem;}
    </style></head>
    <body><div class="w"><div class="s"></div><div class="n">${name}</div><div class="sub">${subtitle}</div></div>
    <script>try{window.history.replaceState(null,'','/');window.location.replace('${url}');}catch(e){window.location.href='${url}';}<\/script>
    </body></html>`);
  };

  // ─────────────────────────────────────────────
  // PAGES
  // ─────────────────────────────────────────────

  exports.getLogin = (req, res) => {
    if (req.query.next) req.session.redirectAfterLogin = req.query.next;
    const error   = req.session.error   || null;
    const success = req.session.success || null;
    delete req.session.error; delete req.session.success;
    req.session.save(() => res.render('pages/login', { title: 'Login — MEE', error, success }));
  };

  exports.getSignup = (req, res) => {
    if (req.query.next) req.session.redirectAfterLogin = req.query.next;
    const error = req.session.error || null;
    delete req.session.error;
    req.session.save(() => res.render('pages/signup', { title: 'Sign Up — MEE', error }));
  };

  exports.getOTP = (req, res) => {
    if (!req.session.otpPhone) return res.redirect('/auth/login');
    res.render('pages/otp', {
      title: 'Verify OTP — MEE',
      phone: req.session.otpPhone,
      mode:  req.session.otpMode || 'login',
    });
  };

  exports.getVerifyEmail = (req, res) => {
    if (!req.session.pendingEmailVerify) return res.redirect('/');
    res.render('pages/verify-email', {
      title:       'Verify Email — MEE',
      email:       req.session.pendingEmailVerify.email,
      // ✅ FIX: pass redirectAfterLogin to the view so skip can use it
      redirectUrl: req.session.redirectAfterLogin || '/',
    });
  };

  exports.getVerifyPhone = (req, res) => {
    if (!req.session.userId) return res.redirect('/auth/login');
    res.render('pages/verify-phone', { title: 'Verify Phone — MEE' });
  };

  // ─────────────────────────────────────────────
  // SEND LOGIN OTP
  // ─────────────────────────────────────────────
  exports.sendLoginOTP = async (req, res) => {
    try {
      const { phone, next } = req.body;
      if (!phone || !/^[6-9]\d{9}$/.test(phone))
        return res.json({ success: false, message: 'Enter a valid 10-digit Indian mobile number.' });

      const fullPhone = '+91' + phone;
      const user = await User.findOne({ phone: fullPhone });
      if (!user)
        return res.json({
          success:  false,
          message:  'No account found. Please sign up first.',
          redirect: '/auth/signup',
        });

      const result = await createAndSendOTP(fullPhone, 'login');
      if (!result.success)
        return res.json({ success: false, message: result.message || 'Failed to send OTP.' });

      req.session.otpPhone = fullPhone;
      req.session.otpMode  = 'login';
      if (next && !req.session.redirectAfterLogin) {
        req.session.redirectAfterLogin = next;
      }

      req.session.save((err) => {
        if (err) {
          console.error('Session save error in sendLoginOTP:', err);
          return res.json({ success: false, message: 'Session error. Please try again.' });
        }
        return res.json({ success: true, message: 'OTP sent!', redirect: '/auth/otp' });
      });

    } catch (err) {
      console.error('sendLoginOTP error:', err);
      res.json({ success: false, message: 'Server error.' });
    }
  };

  // ─────────────────────────────────────────────
  // SIGNUP
  // ───────────────────────

  // Key change: accepts emailVerified flag from client — if true, saves email
// and sets emailVerified=true on the new User doc directly (no second OTP step).
// ─────────────────────────────────────────────────────────────────────────────
 
exports.postSignup = async (req, res) => {
  try {
    const { firstName, email, emailVerified: clientEmailVerified, phone, whatsapp, gender, place, district, next } = req.body;
 
    if (!firstName || !phone || !gender || !place || !district)
      return res.json({ success: false, message: 'Please fill in all required fields.' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.json({ success: false, message: 'Enter a valid email address.' });
    if (!/^[6-9]\d{9}$/.test(phone))
      return res.json({ success: false, message: 'Enter a valid 10-digit Indian mobile number.' });
 
    // If email provided, it must have been verified via OTP modal
    // (clientEmailVerified is a hint, but we also trust the OTP model on server)
    if (email && !clientEmailVerified)
      return res.json({ success: false, message: 'Please verify your email address before signing up.' });
 
    const fullPhone = '+91' + phone;
 
    if (await User.findOne({ phone: fullPhone }))
      return res.json({
        success:  false,
        message:  'Phone already registered. Please log in.',
        redirect: '/auth/login',
      });
 
    const emailLower = email ? email.trim().toLowerCase() : '';
 
    if (emailLower && await User.findOne({ email: emailLower }))
      return res.json({ success: false, message: 'Email already registered with another account.' });
 
    const fullWhatsapp = whatsapp && /^[6-9]\d{9}$/.test(whatsapp.trim())
      ? '+91' + whatsapp.trim()
      : fullPhone;
 
    req.session.pendingUser = {
      firstName,
      email:         emailLower,
      emailVerified: emailLower ? true : false,   // ← mark verified if present (OTP was done on client)
      phone:         fullPhone,
      whatsapp:      fullWhatsapp,
      gender, place, district,
    };
    req.session.otpPhone = fullPhone;
    req.session.otpMode  = 'signup';
    if (next && !req.session.redirectAfterLogin) {
      req.session.redirectAfterLogin = next;
    }
 
    const result = await createAndSendOTP(fullPhone, 'signup');
    if (!result.success)
      return res.json({ success: false, message: result.message || 'Failed to send OTP.' });
 
    req.session.save((err) => {
      if (err) {
        console.error('Session save error in postSignup:', err);
        return res.json({ success: false, message: 'Session error. Please try again.' });
      }
      return res.json({ success: true, redirect: '/auth/otp' });
    });
 
  } catch (err) {
    console.error('postSignup error:', err);
    res.json({ success: false, message: 'Server error.' });
  }
};
 

  // ─────────────────────────────────────────────
  // RESEND OTP
  // ─────────────────────────────────────────────
  exports.resendOTP = async (req, res) => {
    try {
      const phone = req.session.otpPhone;
      if (!phone) return res.json({ success: false, message: 'Session expired.' });
      const result = await createAndSendOTP(phone, req.session.otpMode || 'login');
      if (!result.success) return res.json({ success: false, message: 'Failed to resend OTP.' });
      return res.json({ success: true, message: 'OTP resent!' });
    } catch (err) {
      res.json({ success: false, message: 'Server error.' });
    }
  };

  // ─────────────────────────────────────────────
  // VERIFY PHONE OTP (signup + login)
  // ─────────────────────────────────────────────
  exports.verifyOTPHandler = async (req, res) => {
    try {
      const { otp } = req.body;
      const phone   = req.session.otpPhone;
      const mode    = req.session.otpMode;

      if (!phone) return res.json({ success: false, message: 'Session expired.', redirect: '/auth/login' });

      const result = await verifyOTP(phone, otp);
      if (!result.success) return res.json({ success: false, message: result.message });

      // ── SIGNUP ──
      if (mode === 'signup') {
        const pending = req.session.pendingUser;
        if (!pending) return res.json({ success: false, message: 'Session expired.', redirect: '/auth/signup' });

        const refCode = req.session.referralCode || '';
        // const user = await User.create({
        //   firstName:    pending.firstName,
        //   email:        pending.email,
        //   phone:        pending.phone,
        //   whatsapp:     pending.whatsapp || '',
        //   gender:       pending.gender   || '',
        //   place:        pending.place    || '',
        //   district:     pending.district || '',
        //   isVerified:   true,
        //   referralCode: refCode,
        // });

            const user = await User.create({
        firstName:     pending.firstName,
        email:         pending.email,
        emailVerified: pending.emailVerified || false,   // ← NEW
        phone:         pending.phone,
        whatsapp:      pending.whatsapp || '',
        gender:        pending.gender   || '',
        place:         pending.place    || '',
        district:      pending.district || '',
        isVerified:    true,
        referralCode:  refCode,
      });

        if (refCode) {
          Referral.findOneAndUpdate({ code: refCode }, { $inc: { signups: 1 } }).catch(() => {});
        }

        const token = signToken(user._id);
        req.session.token  = token;
        req.session.userId = user._id.toString();
        delete req.session.pendingUser;
        delete req.session.otpPhone;
        delete req.session.otpMode;

        // ✅ FIX: capture redirectAfterLogin BEFORE email verify flow
        // so it survives into email verify and is used by skip/verify
        const finalRedirect = req.session.redirectAfterLogin || '/';

        
  delete req.session.redirectAfterLogin;
  await new Promise(r => req.session.save(r));
  return res.json({ success: true, redirect: finalRedirect });

      }

      // ── LOGIN ──
      const user = await User.findOne({ phone });
      if (!user) return res.json({ success: false, message: 'User not found.', redirect: '/auth/login' });

      user.isVerified = true;
      await user.save();

      const token = signToken(user._id);
      req.session.token  = token;
      req.session.userId = user._id.toString();
      delete req.session.otpPhone;
      delete req.session.otpMode;

      const redirectTo = req.session.redirectAfterLogin || '/';
      delete req.session.redirectAfterLogin;
      await new Promise(r => req.session.save(r));
      return res.json({ success: true, redirect: redirectTo });

    } catch (err) {
      console.error('verifyOTPHandler error:', err);
      res.json({ success: false, message: 'Server error.' });
    }
  };

  // ─────────────────────────────────────────────
  // VERIFY EMAIL OTP
  // ─────────────────────────────────────────────
  exports.verifyEmailOTP = async (req, res) => {
    try {
      const { otp } = req.body;
      const pending  = req.session.pendingEmailVerify;
      if (!pending) return res.json({ success: false, message: 'Session expired.', redirect: '/' });

      const result = await verifyOTP(pending.email, otp);
      if (!result.success) return res.json({ success: false, message: result.message });

      await User.findByIdAndUpdate(pending.userId, { emailVerified: true });
      delete req.session.pendingEmailVerify;

      // ✅ FIX: consume redirectAfterLogin here (the correct final destination)
      const redirectTo = req.session.redirectAfterLogin || '/';
      delete req.session.redirectAfterLogin;
      await new Promise(r => req.session.save(r));
      return res.json({ success: true, redirect: redirectTo });
    } catch (err) {
      console.error('verifyEmailOTP error:', err);
      res.json({ success: false, message: 'Server error.' });
    }
  };

  exports.resendEmailOTP = async (req, res) => {
    try {
      const pending = req.session.pendingEmailVerify;
      if (!pending) return res.json({ success: false, message: 'Session expired.' });
      const result = await createAndSendEmailOTP(pending.email, 'email-verify');
      if (!result.success) return res.json({ success: false, message: result.message });
      return res.json({ success: true, message: 'OTP resent to your email!' });
    } catch (err) {
      res.json({ success: false, message: 'Server error.' });
    }
  };

  // ─────────────────────────────────────────────
  // PHONE VERIFY (Google users)
  // ─────────────────────────────────────────────
  exports.sendPhoneOTP = async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone || !/^[6-9]\d{9}$/.test(phone))
        return res.json({ success: false, message: 'Enter a valid 10-digit Indian mobile number.' });

      const fullPhone = '+91' + phone;
      const userId = req.session.userId;
      if (!userId) return res.json({ success: false, message: 'Session expired. Please log in again.', redirect: '/auth/login' });

      const existing = await User.findOne({ phone: fullPhone });
      if (existing && existing._id.toString() !== userId.toString())
        return res.json({ success: false, message: 'This number is already registered with another account.' });

      const result = await createAndSendOTP(fullPhone, 'phone-verify');
      if (!result.success) return res.json({ success: false, message: result.message || 'Failed to send OTP.' });

      req.session.pendingPhoneVerify = { userId, phone: fullPhone };
      await new Promise(r => req.session.save(r));
      return res.json({ success: true, message: 'OTP sent!' });
    } catch (err) {
      console.error('sendPhoneOTP error:', err);
      res.json({ success: false, message: 'Server error.' });
    }
  };

  exports.verifyPhoneOTP = async (req, res) => {
    try {
      const { otp } = req.body;
      const pending  = req.session.pendingPhoneVerify;
      if (!pending) return res.json({ success: false, message: 'Session expired.', redirect: '/auth/verify-phone' });

      const result = await verifyOTP(pending.phone, otp);
      if (!result.success) return res.json({ success: false, message: result.message });

      await User.findByIdAndUpdate(pending.userId, { phone: pending.phone, isVerified: true });
      delete req.session.pendingPhoneVerify;

      const redirectTo = req.session.redirectAfterLogin || '/';
      delete req.session.redirectAfterLogin;
      await new Promise(r => req.session.save(r));
      return res.json({ success: true, redirect: redirectTo });
    } catch (err) {
      console.error('verifyPhoneOTP error:', err);
      res.json({ success: false, message: 'Server error.' });
    }
  };

  exports.resendPhoneOTP = async (req, res) => {
    try {
      const pending = req.session.pendingPhoneVerify;
      if (!pending) return res.json({ success: false, message: 'Session expired.' });
      const result = await createAndSendOTP(pending.phone, 'phone-verify');
      if (!result.success) return res.json({ success: false, message: result.message });
      return res.json({ success: true, message: 'OTP resent!' });
    } catch (err) {
      res.json({ success: false, message: 'Server error.' });
    }
  };

  // ─────────────────────────────────────────────
  // GOOGLE CALLBACK
  // ─────────────────────────────────────────────
  exports.googleCallback = async (req, res) => {
    try {
      const user = req.user;
      if (!user) return res.redirect('/auth/login?error=google_failed');

      const token = signToken(user._id);
      req.session.token  = token;
      req.session.userId = user._id.toString();

      const redirectTo = req.session.redirectAfterLogin || '/';

      const needsPhone = !user.phone || user.phone.trim() === '' || !user.isVerified;
      if (needsPhone) {
        req.session.redirectAfterLogin = redirectTo;
        await new Promise(r => req.session.save(r));
        return redirectPage(res, '/auth/verify-phone',
          `Welcome, ${user.firstName}! 👋`, 'One more step — add your phone number', '#9500ff');
      }

      delete req.session.redirectAfterLogin;
      await new Promise(r => req.session.save(r));
      return redirectPage(res, redirectTo,
        `Welcome back, ${user.firstName}! 👋`, 'Setting up your session...', '#c8ff00');

    } catch (err) {
      console.error('Google callback error:', err);
      res.redirect('/auth/login?error=google_failed');
    }
  };

  // ─────────────────────────────────────────────
  // LOGOUT
  // ✅ FIX: clear 'mee.sid' (the actual session cookie name set in server.js)
  // The old code cleared 'connect.sid' which was wrong — session never actually died,
  // causing back-button to still show protected pages.
  // ─────────────────────────────────────────────
  exports.logout = (req, res) => {
    const clearAndRedirect = () => {
      res.clearCookie('mee.sid');        // ✅ matches name: 'mee.sid' in server.js
      res.clearCookie('np_token');       // JWT cookie cleanup
      res.clearCookie('connect.sid');    // belt-and-suspenders for any old sessions
      res.redirect('/');
    };

    if (req.logout) {
      req.logout((err) => {
        if (err) console.error('Passport logout error:', err);
        req.session.destroy(() => clearAndRedirect());
      });
    } else {
      req.session.destroy(() => clearAndRedirect());
    }
  };

  // ─────────────────────────────────────────────
  // SAVE EMAIL (from popup after signup)
  // ─────────────────────────────────────────────
  exports.saveEmail = async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.json({ success: false, message: 'Not logged in.' });
      const { email } = req.body;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return res.json({ success: false, message: 'Invalid email.' });
      const existing = await User.findOne({ email: email.trim().toLowerCase(), _id: { $ne: userId } });
      if (existing) return res.json({ success: false, message: 'Email already in use.' });
      await User.findByIdAndUpdate(userId, { email: email.trim().toLowerCase() });
      return res.json({ success: true });
    } catch (err) {
      console.error('saveEmail error:', err);
      return res.json({ success: false, message: 'Server error.' });
    }
  };


  // ─────────────────────────────────────────────────────────────────────────────
// ADD THESE TWO HANDLERS to authController.js
// These are INLINE email OTP endpoints — no session-redirect flow needed.
// They work standalone on signup, booking-details, and profile pages.
// ─────────────────────────────────────────────────────────────────────────────

// POST /auth/send-email-otp
// Body: { email }
// Sends an OTP to the given email address.
// No auth required — caller just needs a valid email.
exports.sendEmailOTPInline = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.json({ success: false, message: 'Enter a valid email address.' });

    const emailLower = email.trim().toLowerCase();

    // If user is logged in, check this email isn't already taken by someone else
    if (req.session?.userId) {
      const User = require('../models/User');
      const existing = await User.findOne({
        email: emailLower,
        _id: { $ne: req.session.userId },
      });
      if (existing)
        return res.json({ success: false, message: 'This email is already registered with another account.' });
    }

    const result = await createAndSendEmailOTP(emailLower, 'email-verify');
    if (!result.success)
      return res.json({ success: false, message: result.message || 'Failed to send OTP. Please try again.' });

    return res.json({ success: true, message: 'OTP sent to ' + emailLower });
  } catch (err) {
    console.error('sendEmailOTPInline error:', err);
    return res.json({ success: false, message: 'Server error.' });
  }
};

// POST /auth/verify-email-otp
// Body: { email, otp }
// Verifies the OTP.
// If user is logged in → also marks emailVerified=true and saves email in DB.
// If not logged in (signup flow) → just returns success; caller saves on signup.
exports.verifyEmailOTPInline = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp)
      return res.json({ success: false, message: 'Email and OTP are required.' });

    const emailLower = email.trim().toLowerCase();
    const result = await verifyOTP(emailLower, otp);
    if (!result.success)
      return res.json({ success: false, message: result.message });

    // If a logged-in user is verifying (profile / booking flow) → update DB now
    if (req.session?.userId) {
      const User = require('../models/User');

      // Final duplicate check before saving
      const conflict = await User.findOne({
        email: emailLower,
        _id: { $ne: req.session.userId },
      });
      if (conflict)
        return res.json({ success: false, message: 'This email is already registered with another account.' });

      await User.findByIdAndUpdate(req.session.userId, {
        email: emailLower,
        emailVerified: true,
      });
    }

    return res.json({ success: true, email: emailLower });
  } catch (err) {
    console.error('verifyEmailOTPInline error:', err);
    return res.json({ success: false, message: 'Server error.' });
  }
};