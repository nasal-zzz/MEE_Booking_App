


// /**
//  * otpHelper.js
//  *
//  * CURRENT:  Twilio SMS (active)
//  * FUTURE:   MSG91 SMS (commented below — switch when ready)
//  *
//  * Email OTP is always via SMTP (Nodemailer) — unchanged for both providers.
//  */

// 'use strict';

// const OTP        = require('../models/OTP');
// const twilio     = require('twilio');
// const nodemailer = require('nodemailer');

// // ─────────────────────────────────────────────────────────────
// // TWILIO SMS (ACTIVE)
// // ─────────────────────────────────────────────────────────────
// const getTwilioClient = () => {
//   const sid   = process.env.TWILIO_ACCOUNT_SID;
//   const token = process.env.TWILIO_AUTH_TOKEN;
//   if (!sid || !token || sid.startsWith('ACxxxx')) return null;
//   return twilio(sid, token);
// };

// const SMS_FROM = () => process.env.TWILIO_PHONE_NUMBER || '';

// const sendSmsOTP = async (phone, otp) => {
//   console.log('📱 SMS OTP →', phone);
//   console.log('   TWILIO_ACCOUNT_SID:', process.env.TWILIO_ACCOUNT_SID ? '✅' : '❌ MISSING');
//   console.log('   TWILIO_PHONE_NUMBER:', SMS_FROM() || '❌ MISSING');

//   const client = getTwilioClient();

//   if (!client) {
//     console.log('\n' + '='.repeat(50));
//     console.log(`📱 [DEV] SMS OTP to: ${phone}`);
//     console.log(`🔑 OTP: ${otp}`);
//     console.log('='.repeat(50) + '\n');
//     return { success: true, dev: true };
//   }

//   try {
//     const msg = await client.messages.create({
//       from: SMS_FROM(),
//       to:   phone,
//       body: `Your Melattur Entertainment Events OTP is: ${otp}\nValid for 5 minutes. Do not share.\n— MEE`,
//     });
//     console.log(`   ✅ SMS sent | SID: ${msg.sid}`);
//     return { success: true, sid: msg.sid };
//   } catch (err) {
//     console.error('   ❌ SMS error:', err.message, '| code:', err.code);
//     if (err.code === 21211) return { success: false, message: 'Invalid phone number.' };
//     return { success: false, message: 'Failed to send OTP. Please try again.' };
//   }
// };

// // ─────────────────────────────────────────────────────────────
// // EMAIL OTP (SMTP — same for both providers)
// // ─────────────────────────────────────────────────────────────
// const getMailer = () => nodemailer.createTransport({
//   host:   process.env.SMTP_HOST  || 'smtp.gmail.com',
//   port:   parseInt(process.env.SMTP_PORT || '587'),
//   secure: false,
//   auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
//   tls:    { rejectUnauthorized: false },
// });

// const sendEmailOTP = async (email, otp) => {
//   console.log('\n' + '='.repeat(50));
//   console.log(`📧 Email OTP to: ${email}`);
//   console.log(`🔑 OTP: ${otp}`);
//   console.log('='.repeat(50) + '\n');

//   if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
//     return { success: true, dev: true };
//   }

//   try {
//     await getMailer().sendMail({
//       from:    `"Melattur Entertainment Events" <${process.env.SMTP_USER}>`,
//       to:      email,
//       subject: `${otp} is your MEE verification code`,
//       html: `<!DOCTYPE html>
// <html><head><meta charset="UTF-8"/></head>
// <body style="margin:0;padding:0;background:#0B0B0F;font-family:Arial,sans-serif;">
//   <table width="100%" cellpadding="0" cellspacing="0" style="background:#0B0B0F;padding:40px 20px;">
//     <tr><td align="center">
//       <table width="480" cellpadding="0" cellspacing="0" style="background:#14141C;border-radius:12px;overflow:hidden;border:1px solid rgba(106,13,173,0.3);">
//         <tr><td style="background:#6A0DAD;padding:24px;text-align:center;">
//           <img src="${process.env.APP_URL}/images/brandings/logo.webp" alt="MEE" style="height:44px;width:auto;" onerror="this.style.display='none'"/>
//         </td></tr>
//         <tr><td style="padding:32px 36px;">
//           <p style="color:#B3B3B3;font-size:14px;margin:0 0 8px;">Hi there,</p>
//           <p style="color:#fff;font-size:15px;line-height:1.6;margin:0 0 28px;">Your verification code for Melattur Entertainment Events:</p>
//           <div style="text-align:center;margin:0 0 28px;">
//             <div style="display:inline-block;background:#0B0B0F;border:2px solid rgba(106,13,173,0.5);border-radius:10px;padding:24px 32px;">
//               <span style="font-family:monospace;font-size:38px;letter-spacing:12px;color:#9D4EDD;font-weight:700;">${otp}</span>
//             </div>
//           </div>
//           <p style="color:#666;font-size:13px;margin:0 0 6px;">⏱ Valid for <strong style="color:#fff;">5 minutes</strong></p>
//           <p style="color:#666;font-size:13px;margin:0;">🔒 Never share this code with anyone.</p>
//         </td></tr>
//         <tr><td style="background:#0B0B0F;padding:16px 36px;border-top:1px solid rgba(255,255,255,0.06);">
//           <p style="color:#444;font-size:12px;margin:0;text-align:center;">
//             If you didn't request this, you can safely ignore this email.
//           </p>
//         </td></tr>
//       </table>
//     </td></tr>
//   </table>
// </body></html>`,
//     });
//     console.log(`✅ Email OTP sent to ${email}`);
//     return { success: true };
//   } catch (err) {
//     console.error('❌ Email send failed:', err.message);
//     return { success: true, dev: true, warning: err.message };
//   }
// };

// // ─────────────────────────────────────────────────────────────
// // PUBLIC API
// // ─────────────────────────────────────────────────────────────
// const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// const createAndSendOTP = async (phone, purpose = 'login') => {
//   await OTP.deleteMany({ phone });
//   const otp = generateOTP();
//   await OTP.create({ phone, otp, purpose, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
//   return sendSmsOTP(phone, otp);
// };

// const createAndSendEmailOTP = async (email, purpose = 'email-verify') => {
//   await OTP.deleteMany({ phone: email });
//   const otp = generateOTP();
//   await OTP.create({ phone: email, otp, purpose, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
//   return sendEmailOTP(email, otp);
// };

// const verifyOTP = async (key, otp) => {
//   const record = await OTP.findOne({ phone: key, verified: false });
//   if (!record) return { success: false, message: 'OTP not found or already used. Please request a new one.' };
//   if (record.attempts >= 5) {
//     await OTP.deleteMany({ phone: key });
//     return { success: false, message: 'Too many attempts. Please request a new OTP.' };
//   }
//   if (new Date() > record.expiresAt) {
//     await OTP.deleteMany({ phone: key });
//     return { success: false, message: 'OTP has expired. Please request a new one.' };
//   }
//   if (record.otp !== otp) {
//     record.attempts += 1;
//     await record.save();
//     const remaining = 5 - record.attempts;
//     return { success: false, message: `Incorrect OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` };
//   }
//   await OTP.deleteMany({ phone: key });
//   return { success: true };
// };

// module.exports = { createAndSendOTP, createAndSendEmailOTP, verifyOTP };


// // ═══════════════════════════════════════════════════════════════════
// //  MSG91 SMS — UNCOMMENT THIS ENTIRE BLOCK WHEN SWITCHING
// //  1. Comment out the Twilio block above (from 'use strict' to module.exports)
// //  2. Uncomment this block
// //  3. Add MSG91_AUTH_KEY, MSG91_SENDER_ID, MSG91_TEMPLATE_ID to .env
// // ═══════════════════════════════════════════════════════════════════
// /*

// 'use strict';

// const https      = require('https');
// const OTP        = require('../models/OTP');
// const nodemailer = require('nodemailer');

// // ── MSG91 SMS ──
// // Required .env:
// //   MSG91_AUTH_KEY      — your MSG91 auth key
// //   MSG91_SENDER_ID     — 6-char DLT approved sender ID (e.g. MEEEVT)
// //   MSG91_TEMPLATE_ID   — Flow ID from MSG91 dashboard (OTP SMS flow)
// //                         Your DLT template must include {{OTP}} as a variable.

// const MSG91_AUTH_KEY    = () => process.env.MSG91_AUTH_KEY    || '';
// const MSG91_SENDER_ID   = () => process.env.MSG91_SENDER_ID   || 'MEEEVT';
// const MSG91_TEMPLATE_ID = () => process.env.MSG91_TEMPLATE_ID || '';

// const normPhone = (phone) => {
//   const raw = String(phone).replace(/\D/g, '');
//   return raw.startsWith('91') ? raw : '91' + raw;
// };

// const sendMsg91SMS = ({ phone, otp }) => {
//   const authKey    = MSG91_AUTH_KEY();
//   const templateId = MSG91_TEMPLATE_ID();
//   const senderId   = MSG91_SENDER_ID();
//   if (!authKey) return Promise.reject(new Error('MSG91_AUTH_KEY not set'));

//   const payload = JSON.stringify({
//     flow_id: templateId,
//     sender:  senderId,
//     mobiles: normPhone(phone),
//     OTP:     otp,          // variable name in your MSG91 DLT template — must match exactly
//   });

//   return new Promise((resolve, reject) => {
//     const req = https.request({
//       hostname: 'api.msg91.com',
//       path:     '/api/v5/flow/',
//       method:   'POST',
//       headers:  {
//         'authkey':        authKey,
//         'Content-Type':   'application/json',
//         'Content-Length': Buffer.byteLength(payload),
//       },
//     }, (res) => {
//       let data = '';
//       res.on('data', c => data += c);
//       res.on('end', () => {
//         try {
//           const json = JSON.parse(data);
//           if (json.type === 'success') resolve(json);
//           else reject(new Error(`MSG91 error: ${JSON.stringify(json)}`));
//         } catch (e) {
//           reject(new Error('MSG91 parse error: ' + data.substring(0, 200)));
//         }
//       });
//     });
//     req.on('error', reject);
//     req.write(payload);
//     req.end();
//   });
// };

// const sendSmsOTP = async (phone, otp) => {
//   console.log('📱 SMS OTP (MSG91) →', phone);
//   console.log('   MSG91_AUTH_KEY:', MSG91_AUTH_KEY() ? '✅' : '❌ MISSING');
//   console.log('   MSG91_TEMPLATE_ID:', MSG91_TEMPLATE_ID() || '⚠ not set');

//   if (!MSG91_AUTH_KEY()) {
//     console.log('\n' + '='.repeat(50));
//     console.log(`📱 [DEV] SMS OTP to: ${phone}`);
//     console.log(`🔑 OTP: ${otp}`);
//     console.log('='.repeat(50) + '\n');
//     return { success: true, dev: true };
//   }

//   try {
//     await sendMsg91SMS({ phone, otp });
//     console.log(`   ✅ MSG91 SMS sent to ${phone}`);
//     return { success: true };
//   } catch (err) {
//     console.error('   ❌ MSG91 SMS error:', err.message);
//     return { success: false, message: 'Failed to send OTP. Please try again.' };
//   }
// };

// // ── Email OTP (SMTP — identical to Twilio version above) ──
// const getMailer = () => require('nodemailer').createTransport({
//   host: process.env.SMTP_HOST || 'smtp.gmail.com',
//   port: parseInt(process.env.SMTP_PORT || '587'),
//   secure: false,
//   auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
//   tls: { rejectUnauthorized: false },
// });

// const sendEmailOTP = async (email, otp) => {
//   console.log('\n' + '='.repeat(50));
//   console.log(`📧 Email OTP to: ${email}`);
//   console.log(`🔑 OTP: ${otp}`);
//   console.log('='.repeat(50) + '\n');
//   if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return { success: true, dev: true };
//   try {
//     await getMailer().sendMail({
//       from:    `"Melattur Entertainment Events" <${process.env.SMTP_USER}>`,
//       to:      email,
//       subject: `${otp} is your MEE verification code`,
//       html:    `<div style="font-family:Arial;background:#0B0B0F;padding:40px;text-align:center;"><div style="display:inline-block;background:#0B0B0F;border:2px solid rgba(106,13,173,0.5);border-radius:10px;padding:24px 32px;"><span style="font-family:monospace;font-size:38px;letter-spacing:12px;color:#9D4EDD;font-weight:700;">${otp}</span></div><p style="color:#666;font-size:13px;margin-top:16px;">Valid for 5 minutes. Never share.</p></div>`,
//     });
//     console.log(`✅ Email OTP sent to ${email}`);
//     return { success: true };
//   } catch (err) {
//     console.error('❌ Email OTP failed:', err.message);
//     return { success: true, dev: true, warning: err.message };
//   }
// };

// const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// const createAndSendOTP = async (phone, purpose = 'login') => {
//   await OTP.deleteMany({ phone });
//   const otp = generateOTP();
//   await OTP.create({ phone, otp, purpose, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
//   return sendSmsOTP(phone, otp);
// };

// const createAndSendEmailOTP = async (email, purpose = 'email-verify') => {
//   await OTP.deleteMany({ phone: email });
//   const otp = generateOTP();
//   await OTP.create({ phone: email, otp, purpose, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
//   return sendEmailOTP(email, otp);
// };

// const verifyOTP = async (key, otp) => {
//   const record = await OTP.findOne({ phone: key, verified: false });
//   if (!record) return { success: false, message: 'OTP not found or already used. Please request a new one.' };
//   if (record.attempts >= 5) {
//     await OTP.deleteMany({ phone: key });
//     return { success: false, message: 'Too many attempts. Please request a new OTP.' };
//   }
//   if (new Date() > record.expiresAt) {
//     await OTP.deleteMany({ phone: key });
//     return { success: false, message: 'OTP has expired. Please request a new one.' };
//   }
//   if (record.otp !== otp) {
//     record.attempts += 1;
//     await record.save();
//     const remaining = 5 - record.attempts;
//     return { success: false, message: `Incorrect OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` };
//   }
//   await OTP.deleteMany({ phone: key });
//   return { success: true };
// };

// module.exports = { createAndSendOTP, createAndSendEmailOTP, verifyOTP };

// */
// // ═══════════════════════════════════════════════════════════════════
// //  END MSG91 BLOCK
// // ═══════════════════════════════════════════════════════════════════




/**
 * otpHelper.js
 *
 * OTP via MSG91 WhatsApp (Authentication template)
 * Email OTP via SMTP (Nodemailer) — unchanged
 *
 * Required .env variables:
 *   MSG91_AUTH_KEY        — your MSG91 auth key
 *   MSG91_WA_SENDER       — 918138805703
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS  (for email OTP)
 */

'use strict';

const https      = require('https');
const OTP        = require('../models/OTP');
const nodemailer = require('nodemailer');

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

const normPhone = (phone) => {
  // Strip leading + and non-digits, ensure 91XXXXXXXXXX format
  const raw = String(phone).replace(/\D/g, '');
  return raw.startsWith('91') ? raw : '91' + raw;
};

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// ─────────────────────────────────────────────────────────────
// WHATSAPP OTP (MSG91 — Authentication Template)
// ─────────────────────────────────────────────────────────────

const sendWhatsappOTP = async (phone, otp) => {
  const authKey        = process.env.MSG91_AUTH_KEY        || '';
  const integratedNum  = process.env.MSG91_WA_SENDER       || '918138805703';
  const namespace      = 'f7cdac1d_be09_4edf_8d12_1cd2ac75b31e';
  const templateName   = 'otp_whatsapp';

  console.log('📲 WhatsApp OTP (MSG91) →', phone);
  console.log('   MSG91_AUTH_KEY:', authKey ? '✅' : '❌ MISSING');

  // Dev fallback — no auth key
  if (!authKey) {
    console.log('\n' + '='.repeat(50));
    console.log(`📲 [DEV] WhatsApp OTP to: ${phone}`);
    console.log(`🔑 OTP: ${otp}`);
    console.log('='.repeat(50) + '\n');
    return { success: true, dev: true };
  }

  const payload = JSON.stringify({
    integrated_number: integratedNum,
    content_type: 'template',
    payload: {
      messaging_product: 'whatsapp',
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: 'en',
          policy: 'deterministic',
        },
        namespace,
        to_and_components: [
          {
            to: [normPhone(phone)],
            components: {
              body_1: {
                type: 'text',
                value: otp,
              },
              button_1: {
                subtype: 'url',
                type: 'text',
                value: otp,
              },
            },
          },
        ],
      },
    },
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.msg91.com',
        path: '/api/v5/whatsapp/whatsapp-outbound-message/bulk/',
        method: 'POST',
        headers: {
          authkey: authKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            console.log('   MSG91 WA response:', JSON.stringify(json));
            // MSG91 returns { "type": "success" } on success
            if (json.type === 'success' || res.statusCode === 200) {
              console.log(`   ✅ WhatsApp OTP sent to ${phone}`);
              resolve({ success: true });
            } else {
              console.error('   ❌ MSG91 WA error:', JSON.stringify(json));
              resolve({ success: false, message: 'Failed to send OTP via WhatsApp. Please try again.' });
            }
          } catch (e) {
            console.error('   ❌ MSG91 WA parse error:', data.substring(0, 200));
            resolve({ success: false, message: 'Failed to send OTP. Please try again.' });
          }
        });
      }
    );

    req.on('error', (err) => {
      console.error('   ❌ MSG91 WA request error:', err.message);
      resolve({ success: false, message: 'Network error sending OTP. Please try again.' });
    });

    req.write(payload);
    req.end();
  });
};

// ─────────────────────────────────────────────────────────────
// EMAIL OTP (SMTP — unchanged)
// ─────────────────────────────────────────────────────────────

const getMailer = () =>
  nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls:    { rejectUnauthorized: false },
  });

const sendEmailOTP = async (email, otp) => {
  console.log('\n' + '='.repeat(50));
  console.log(`📧 Email OTP to: ${email}`);
  console.log(`🔑 OTP: ${otp}`);
  console.log('='.repeat(50) + '\n');

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return { success: true, dev: true };
  }

  try {
    await getMailer().sendMail({
      from:    `"Melattur Entertainment Events" <${process.env.SMTP_USER}>`,
      to:      email,
      subject: `${otp} is your MEE verification code`,
      html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0B0B0F;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0B0B0F;padding:40px 20px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#14141C;border-radius:12px;overflow:hidden;border:1px solid rgba(106,13,173,0.3);">
        <tr><td style="background:#6A0DAD;padding:24px;text-align:center;">
          <img src="${process.env.APP_URL}/images/brandings/logo.webp" alt="MEE" style="height:44px;width:auto;" onerror="this.style.display='none'"/>
        </td></tr>
        <tr><td style="padding:32px 36px;">
          <p style="color:#B3B3B3;font-size:14px;margin:0 0 8px;">Hi there,</p>
          <p style="color:#fff;font-size:15px;line-height:1.6;margin:0 0 28px;">Your verification code for Melattur Entertainment Events:</p>
          <div style="text-align:center;margin:0 0 28px;">
            <div style="display:inline-block;background:#0B0B0F;border:2px solid rgba(106,13,173,0.5);border-radius:10px;padding:24px 32px;">
              <span style="font-family:monospace;font-size:38px;letter-spacing:12px;color:#9D4EDD;font-weight:700;">${otp}</span>
            </div>
          </div>
          <p style="color:#666;font-size:13px;margin:0 0 6px;">⏱ Valid for <strong style="color:#fff;">5 minutes</strong></p>
          <p style="color:#666;font-size:13px;margin:0;">🔒 Never share this code with anyone.</p>
        </td></tr>
        <tr><td style="background:#0B0B0F;padding:16px 36px;border-top:1px solid rgba(255,255,255,0.06);">
          <p style="color:#444;font-size:12px;margin:0;text-align:center;">
            If you didn't request this, you can safely ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
    });
    console.log(`✅ Email OTP sent to ${email}`);
    return { success: true };
  } catch (err) {
    console.error('❌ Email send failed:', err.message);
    return { success: true, dev: true, warning: err.message };
  }
};

// ─────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────

const createAndSendOTP = async (phone, purpose = 'login') => {
  await OTP.deleteMany({ phone });
  const otp = generateOTP();
  await OTP.create({ phone, otp, purpose, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
  return sendWhatsappOTP(phone, otp);
};

const createAndSendEmailOTP = async (email, purpose = 'email-verify') => {
  await OTP.deleteMany({ phone: email });
  const otp = generateOTP();
  await OTP.create({ phone: email, otp, purpose, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
  return sendEmailOTP(email, otp);
};

const verifyOTP = async (key, otp) => {
  const record = await OTP.findOne({ phone: key, verified: false });
  if (!record) return { success: false, message: 'OTP not found or already used. Please request a new one.' };
  if (record.attempts >= 5) {
    await OTP.deleteMany({ phone: key });
    return { success: false, message: 'Too many attempts. Please request a new OTP.' };
  }
  if (new Date() > record.expiresAt) {
    await OTP.deleteMany({ phone: key });
    return { success: false, message: 'OTP has expired. Please request a new one.' };
  }
  if (record.otp !== otp) {
    record.attempts += 1;
    await record.save();
    const remaining = 5 - record.attempts;
    return { success: false, message: `Incorrect OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` };
  }
  await OTP.deleteMany({ phone: key });
  return { success: true };
};

module.exports = { createAndSendOTP, createAndSendEmailOTP, verifyOTP };