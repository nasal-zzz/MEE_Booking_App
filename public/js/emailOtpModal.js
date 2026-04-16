/**
 * emailOtpModal.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Drop this ONCE into a shared partial (e.g. partials/scripts.ejs) or load it
 * on every page that needs email-OTP verification.
 *
 * Usage:
 *   EmailOTPModal.open({
 *     email      : 'user@example.com',
 *     purpose    : 'signup' | 'booking' | 'profile',   // cosmetic only
 *     onVerified : (email) => { /* do your thing *\/ },
 *   });
 *
 * Backend endpoints consumed:
 *   POST /auth/send-email-otp    { email }
 *   POST /auth/verify-email-otp  { email, otp }
 * ─────────────────────────────────────────────────────────────────────────────
 */
;(function (global) {
  'use strict';

  // ── inject styles once ────────────────────────────────────────────────────
  if (!document.getElementById('_eotpStyles')) {
    const s = document.createElement('style');
    s.id = '_eotpStyles';
    s.textContent = `
      #_eotpOverlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.78);
        z-index: 9800;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        backdrop-filter: blur(8px);
      }
      #_eotpOverlay.open { display: flex; }
      #_eotpBox {
        background: #14141C;
        border: 1px solid rgba(106,13,173,0.35);
        border-radius: 16px;
        width: 100%;
        max-width: 420px;
        overflow: hidden;
        box-shadow: 0 40px 80px rgba(0,0,0,0.6);
        animation: _eotpIn 0.25s cubic-bezier(.4,0,.2,1);
      }
      @keyframes _eotpIn {
        from { opacity:0; transform: scale(.95) translateY(12px); }
        to   { opacity:1; transform: scale(1)  translateY(0);     }
      }
      #_eotpBar { height:3px; background:linear-gradient(90deg,transparent,#6A0DAD,transparent); }
      #_eotpInner { padding: 2rem; }
      #_eotpTitle {
        font-family: 'Poppins', sans-serif;
        font-size: 1.35rem;
        letter-spacing: 2px;
        color: #fff;
        margin-bottom: .25rem;
      }
      #_eotpSub {
        font-size: .82rem;
        color: #B3B3B3;
        margin-bottom: 1.6rem;
        line-height: 1.55;
      }
      #_eotpSub strong { color: #c8a0ff; }
      ._eotpOtpRow {
        display: flex;
        gap: .5rem;
        justify-content: center;
        margin-bottom: 1rem;
      }
      ._eotpDigit {
        width: 52px;
        height: 60px;
        background: rgba(255,255,255,0.04);
        border: 2px solid rgba(255,255,255,0.1);
        border-radius: 10px;
        color: #fff;
        font-family: 'Space Mono', monospace;
        font-size: 1.5rem;
        text-align: center;
        outline: none;
        transition: border-color .18s, box-shadow .18s;
        caret-color: transparent;
      }
      ._eotpDigit:focus {
        border-color: #6A0DAD;
        box-shadow: 0 0 0 3px rgba(106,13,173,.18);
      }
      ._eotpDigit.filled { border-color: rgba(106,13,173,.55); }
      ._eotpDigit.err    { border-color: #FF4444 !important; animation: _eotpShake .35s; }
      ._eotpDigit.ok     { border-color: #00FF88 !important; }
      @keyframes _eotpShake {
        0%,100%{transform:translateX(0)}
        20%    {transform:translateX(-5px)}
        60%    {transform:translateX(5px)}
        80%    {transform:translateX(-3px)}
      }
      #_eotpErrMsg {
        text-align: center;
        font-size: .76rem;
        color: #FF4444;
        min-height: 1.1rem;
        margin-bottom: .85rem;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: .35rem;
      }
      #_eotpVerifyBtn {
        width: 100%;
        padding: .9rem;
        background: #6A0DAD;
        color: #fff;
        font-family: 'Outfit', sans-serif;
        font-weight: 700;
        font-size: .9rem;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: .5rem;
        transition: box-shadow .18s, transform .15s;
        box-shadow: 0 0 22px rgba(106,13,173,.2);
        letter-spacing: .5px;
      }
      #_eotpVerifyBtn:hover:not(:disabled) {
        box-shadow: 0 0 40px rgba(106,13,173,.45);
        transform: translateY(-1px);
      }
      #_eotpVerifyBtn:disabled { opacity:.45; cursor:not-allowed; transform:none; }
      #_eotpVerifyBtn .spin {
        width:16px;height:16px;
        border:2px solid rgba(255,255,255,.25);
        border-top-color:#fff;
        border-radius:50%;
        animation:_eotpSpin .7s linear infinite;
        display:none;
      }
      @keyframes _eotpSpin { to{transform:rotate(360deg)} }
      #_eotpResendRow {
        text-align: center;
        margin-top: .9rem;
        font-size: .76rem;
        color: #666;
      }
      #_eotpResendBtn {
        background: none;
        border: none;
        color: #6A0DAD;
        font-size: .76rem;
        cursor: pointer;
        font-weight: 600;
        padding: 0;
        font-family: inherit;
      }
      #_eotpResendBtn:disabled { color: #555; cursor: not-allowed; }
      #_eotpTimer { color: #888; font-family: 'Space Mono', monospace; font-size: .7rem; }
      #_eotpCloseBtn {
        position: absolute;
        top: 1rem; right: 1rem;
        background: none;
        border: none;
        color: #555;
        font-size: 1.3rem;
        cursor: pointer;
        line-height: 1;
        transition: color .18s;
      }
      #_eotpCloseBtn:hover { color: #fff; }
      #_eotpSuccessBanner {
        display: none;
        text-align: center;
        padding: .8rem;
        background: rgba(0,255,136,.07);
        border: 1px solid rgba(0,255,136,.25);
        border-radius: 8px;
        color: #00FF88;
        font-size: .82rem;
        margin-bottom: 1rem;
        align-items: center;
        justify-content: center;
        gap: .45rem;
      }
      #_eotpSuccessBanner.show { display: flex; }
    `;
    document.head.appendChild(s);
  }

  // ── inject DOM once ───────────────────────────────────────────────────────
  if (!document.getElementById('_eotpOverlay')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="_eotpOverlay">
        <div id="_eotpBox" style="position:relative;">
          <div id="_eotpBar"></div>
          <button id="_eotpCloseBtn" onclick="EmailOTPModal.close()">×</button>
          <div id="_eotpInner">
            <div id="_eotpTitle">VERIFY EMAIL</div>
            <div id="_eotpSub">A 6-digit code was sent to <strong id="_eotpEmailDisplay"></strong></div>

            <div id="_eotpSuccessBanner">
              <i class="bi bi-check-circle-fill"></i>
              <span>Email verified successfully!</span>
            </div>

            <div class="_eotpOtpRow" id="_eotpDigits">
              <input class="_eotpDigit" maxlength="1" inputmode="numeric" type="text" autocomplete="one-time-code"/>
              <input class="_eotpDigit" maxlength="1" inputmode="numeric" type="text"/>
              <input class="_eotpDigit" maxlength="1" inputmode="numeric" type="text"/>
              <input class="_eotpDigit" maxlength="1" inputmode="numeric" type="text"/>
              <input class="_eotpDigit" maxlength="1" inputmode="numeric" type="text"/>
              <input class="_eotpDigit" maxlength="1" inputmode="numeric" type="text"/>
            </div>

            <div id="_eotpErrMsg"></div>

            <button id="_eotpVerifyBtn" onclick="EmailOTPModal._doVerify()">
              <i class="bi bi-shield-check" id="_eotpBtnIcon"></i>
              <span id="_eotpBtnTxt">Verify Email</span>
              <div class="spin" id="_eotpSpinner"></div>
            </button>

            <div id="_eotpResendRow">
              Didn't receive it?
              <button id="_eotpResendBtn" onclick="EmailOTPModal._resend()" disabled>
                Resend OTP
              </button>
              <span id="_eotpTimer"></span>
            </div>
          </div>
        </div>
      </div>
    `);

    // wire up digit inputs
    const digits = document.querySelectorAll('._eotpDigit');
    digits.forEach((inp, idx) => {
      inp.addEventListener('input', (e) => {
        const v = inp.value.replace(/\D/g, '');
        inp.value = v.slice(-1);
        if (v && idx < digits.length - 1) digits[idx + 1].focus();
        inp.classList.toggle('filled', !!inp.value);
        inp.classList.remove('err');
        document.getElementById('_eotpErrMsg').textContent = '';
        // auto-submit when all 6 filled
        if (idx === digits.length - 1 && inp.value) {
          const all = Array.from(digits).map(d => d.value).join('');
          if (all.length === 6) EmailOTPModal._doVerify();
        }
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !inp.value && idx > 0) {
          digits[idx - 1].focus();
          digits[idx - 1].value = '';
          digits[idx - 1].classList.remove('filled');
        }
        if (e.key === 'Enter') EmailOTPModal._doVerify();
      });
      inp.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        if (!text) return;
        digits.forEach((d, i) => {
          d.value = text[i] || '';
          d.classList.toggle('filled', !!d.value);
        });
        (digits[Math.min(text.length, 5)] || digits[5]).focus();
        if (text.length >= 6) setTimeout(() => EmailOTPModal._doVerify(), 80);
      });
    });
  }

  // ── state ─────────────────────────────────────────────────────────────────
  let _email = '';
  let _onVerified = null;
  let _timerInterval = null;
  let _timerSecs = 60;
  let _sending = false;

  // ── helpers ───────────────────────────────────────────────────────────────
  function _setLoading(on) {
    const btn = document.getElementById('_eotpVerifyBtn');
    const icon = document.getElementById('_eotpBtnIcon');
    const txt = document.getElementById('_eotpBtnTxt');
    const spin = document.getElementById('_eotpSpinner');
    btn.disabled = on;
    icon.style.display = on ? 'none' : 'inline';
    spin.style.display = on ? 'block' : 'none';
    txt.textContent = on ? 'Verifying…' : 'Verify Email';
  }

  function _startTimer() {
    _timerSecs = 60;
    const resendBtn = document.getElementById('_eotpResendBtn');
    const timerEl = document.getElementById('_eotpTimer');
    resendBtn.disabled = true;
    clearInterval(_timerInterval);
    _timerInterval = setInterval(() => {
      _timerSecs--;
      if (_timerSecs <= 0) {
        clearInterval(_timerInterval);
        resendBtn.disabled = false;
        timerEl.textContent = '';
      } else {
        timerEl.textContent = `(${_timerSecs}s)`;
      }
    }, 1000);
  }

  function _clearDigits() {
    document.querySelectorAll('._eotpDigit').forEach(d => {
      d.value = '';
      d.classList.remove('filled', 'err', 'ok');
    });
  }

  function _showErr(msg) {
    const el = document.getElementById('_eotpErrMsg');
    el.innerHTML = `<i class="bi bi-exclamation-circle"></i> ${msg}`;
    document.querySelectorAll('._eotpDigit').forEach(d => d.classList.add('err'));
    setTimeout(() => document.querySelectorAll('._eotpDigit').forEach(d => d.classList.remove('err')), 700);
  }

  // ── public API ────────────────────────────────────────────────────────────
  const EmailOTPModal = {
    open({ email, onVerified }) {
      _email = email;
      _onVerified = onVerified;

      document.getElementById('_eotpEmailDisplay').textContent = email;
      document.getElementById('_eotpErrMsg').textContent = '';
      document.getElementById('_eotpSuccessBanner').classList.remove('show');
      document.getElementById('_eotpVerifyBtn').style.display = 'flex';
      _clearDigits();

      document.getElementById('_eotpOverlay').classList.add('open');
      setTimeout(() => {
        const first = document.querySelector('._eotpDigit');
        if (first) first.focus();
      }, 200);
      _startTimer();
    },

    close() {
      document.getElementById('_eotpOverlay').classList.remove('open');
      clearInterval(_timerInterval);
    },

    async _send(email) {
      if (_sending) return;
      _sending = true;
      try {
        const r = await fetch('/auth/send-email-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email }),
        });
        const d = await r.json();
        _sending = false;
        return d;
      } catch (e) {
        _sending = false;
        return { success: false, message: 'Network error. Try again.' };
      }
    },

    async _resend() {
      document.getElementById('_eotpResendBtn').disabled = true;
      _clearDigits();
      document.getElementById('_eotpErrMsg').textContent = '';
      const d = await this._send(_email);
      if (d.success) {
        _startTimer();
      } else {
        _showErr(d.message || 'Failed to resend OTP.');
      }
    },

    async _doVerify() {
      const digits = document.querySelectorAll('._eotpDigit');
      const otp = Array.from(digits).map(d => d.value).join('');
      if (otp.length < 6) {
        _showErr('Please enter the complete 6-digit code.');
        return;
      }
      _setLoading(true);
      try {
        const r = await fetch('/auth/verify-email-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: _email, otp }),
        });
        const d = await r.json();
        if (d.success) {
          document.querySelectorAll('._eotpDigit').forEach(dd => dd.classList.add('ok'));
          document.getElementById('_eotpSuccessBanner').classList.add('show');
          document.getElementById('_eotpVerifyBtn').style.display = 'none';
          document.getElementById('_eotpErrMsg').textContent = '';
          clearInterval(_timerInterval);
          setTimeout(() => {
            this.close();
            if (_onVerified) _onVerified(_email);
          }, 900);
        } else {
          _showErr(d.message || 'Incorrect OTP. Please try again.');
        }
      } catch (e) {
        _showErr('Network error. Please try again.');
      }
      _setLoading(false);
    },
  };

  global.EmailOTPModal = EmailOTPModal;
})(window);