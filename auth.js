'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// APPLIANZO AUTH FUNCTION
// Routes (all POST unless noted):
//   POST /auth/register          { email, password, full_name, city, country, pincode }
//   POST /auth/login             { email, password }
//   POST /auth/logout            { token }
//   GET  /auth/verify-email?token=xxx
//   POST /auth/resend-verification { email }
//   POST /auth/forgot-password   { email }
//   POST /auth/reset-password    { token, password }
//   GET  /auth/me                (requires Authorization: Bearer <token>)
//   POST /auth/oauth             { provider, provider_id, email, full_name, avatar_url }
// ─────────────────────────────────────────────────────────────────────────────

const { neon } = require('@neondatabase/serverless');
const crypto   = require('crypto');

const ALLOWED_ORIGIN  = process.env.ALLOWED_ORIGIN  || '*';
const SUPER_EMAIL     = 'esraigroup@gmail.com';
const SUPER_PASSWORD  = 'super123';
const SESSION_DAYS    = 30;
const VERIFY_HOURS    = 24;
const RESET_HOURS     = 2;
const APP_URL         = process.env.APP_URL || process.env.ALLOWED_ORIGIN || 'https://applianzo.netlify.app';

// ── Helpers ────────────────────────────────────────────────────────────────────
function getDb() {
  if (!process.env.NEON_DATABASE_URL) throw new Error('Missing NEON_DATABASE_URL');
  return neon(process.env.NEON_DATABASE_URL);
}

function res(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function token(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function hashPassword(password) {
  // Simple SHA-256 + salt (use bcrypt in production if possible)
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHmac('sha256', salt).update(password).digest('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  // Super admin special check
  if (stored && stored.startsWith('$2b$')) {
    // bcrypt placeholder — for super admin we verify directly
    return false; // handled separately
  }
  const [salt, hash] = stored.split(':');
  const attempt = crypto.createHmac('sha256', salt).update(password).digest('hex');
  return attempt === hash;
}

function isSuperAdmin(email, password) {
  return email.toLowerCase().trim() === SUPER_EMAIL &&
         password === SUPER_PASSWORD;
}

function safeUser(u) {
  return {
    id:             u.id,
    email:          u.email,
    full_name:      u.full_name,
    city:           u.city,
    country:        u.country,
    pincode:        u.pincode,
    role:           u.role,
    provider:       u.provider,
    email_verified: u.email_verified,
    avatar_url:     u.avatar_url,
    created_at:     u.created_at,
  };
}

// ── Email sender (uses Netlify-compatible fetch to Resend/SendGrid) ────────────
async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[EMAIL SKIPPED — no RESEND_API_KEY] To: ${to} | Subject: ${subject}`);
    return; // Gracefully skip — log only
  }
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    process.env.EMAIL_FROM || 'Applianzo <noreply@applianzo.com>',
      to:      [to],
      subject,
      html,
    }),
  });
}

function verifyEmailHtml(name, verifyUrl) {
  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#22c55e;padding:28px 32px;">
        <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;">✦ Applianzo</div>
        <div style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:4px;">Amazon kitchen discovery</div>
      </div>
      <div style="padding:32px;">
        <h2 style="margin:0 0 8px;font-size:20px;color:#111;">Verify your email address</h2>
        <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 24px;">
          Hi ${name || 'there'}, thanks for joining Applianzo. Click below to verify your email and start discovering kitchen products.
        </p>
        <a href="${verifyUrl}" style="display:inline-block;background:#22c55e;color:#000;font-weight:700;font-size:14px;padding:13px 28px;border-radius:8px;text-decoration:none;">
          Verify email address
        </a>
        <p style="color:#9ca3af;font-size:12px;margin:24px 0 0;">This link expires in 24 hours. If you didn't create an account, ignore this email.</p>
      </div>
    </div>`;
}

function resetPasswordHtml(name, resetUrl) {
  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#111827;padding:28px 32px;">
        <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;">✦ Applianzo</div>
        <div style="color:rgba(255,255,255,0.6);font-size:13px;margin-top:4px;">Amazon kitchen discovery</div>
      </div>
      <div style="padding:32px;">
        <h2 style="margin:0 0 8px;font-size:20px;color:#111;">Reset your password</h2>
        <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 24px;">
          Hi ${name || 'there'}, we received a request to reset your Applianzo password. Click below to choose a new one.
        </p>
        <a href="${resetUrl}" style="display:inline-block;background:#111827;color:#fff;font-weight:700;font-size:14px;padding:13px 28px;border-radius:8px;text-decoration:none;">
          Reset password
        </a>
        <p style="color:#9ca3af;font-size:12px;margin:24px 0 0;">This link expires in 2 hours. If you didn't request this, ignore it — your password won't change.</p>
      </div>
    </div>`;
}

// ── Auth handlers ──────────────────────────────────────────────────────────────

async function handleRegister(body) {
  const { email, password, full_name, city, country, pincode } = body || {};
  if (!email || !password) return res(400, { message: 'Email and password are required' });
  if (password.length < 8)  return res(400, { message: 'Password must be at least 8 characters' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res(400, { message: 'Invalid email address' });

  const sql = getDb();
  const existing = await sql`select id from users where email=${email.toLowerCase()} limit 1`;
  if (existing.length) return res(409, { message: 'An account with this email already exists' });

  const hash = hashPassword(password);
  const rows = await sql`
    insert into users (email, password_hash, full_name, city, country, pincode, provider, email_verified)
    values (${email.toLowerCase()}, ${hash}, ${full_name||null}, ${city||null}, ${country||null}, ${pincode||null}, 'email', false)
    returning *`;
  const user = rows[0];

  // Create verification token
  const vToken = token();
  const exp    = new Date(Date.now() + VERIFY_HOURS * 3600 * 1000);
  await sql`insert into email_verifications (user_id, token, expires_at) values (${user.id}, ${vToken}, ${exp})`;

  const verifyUrl = `${APP_URL}/verify-email.html?token=${vToken}`;
  await sendEmail({
    to:      email,
    subject: 'Verify your Applianzo account',
    html:    verifyEmailHtml(full_name, verifyUrl),
  });

  return res(201, {
    message:   'Account created. Please check your email to verify your address before signing in.',
    user_id:   user.id,
    verify_url: process.env.NODE_ENV === 'development' ? verifyUrl : undefined,
  });
}

async function handleLogin(body) {
  const { email, password } = body || {};
  if (!email || !password) return res(400, { message: 'Email and password are required' });

  const lEmail = email.toLowerCase().trim();

  // Super admin shortcut — works even before auth-schema.sql is run
  if (isSuperAdmin(lEmail, password)) {
    try {
      const sql  = getDb();
      let rows   = await sql`select * from users where email=${lEmail} limit 1`;

      // Auto-create super admin row if it doesn't exist yet
      if (!rows.length) {
        const sa_hash = 'applianzo_superadmin_salt_fixed:b67d17e692d349dad746543644af0294ab021cad47d882be11b57935d8dbf225';
        rows = await sql`
          insert into users (email, password_hash, full_name, role, provider, email_verified, city, country, pincode)
          values (${SUPER_EMAIL}, ${sa_hash}, 'ESRAI Group', 'superadmin', 'email', true, 'Mumbai', 'India', '400001')
          on conflict (email) do update set role='superadmin', email_verified=true, updated_at=now()
          returning *`;
      }

      const user   = rows[0];
      const sToken = token();
      const exp    = new Date(Date.now() + SESSION_DAYS * 86400 * 1000);
      await sql`insert into sessions (user_id, token, expires_at) values (${user.id}, ${sToken}, ${exp})`;
      return res(200, { token: sToken, user: safeUser(user) });
    } catch (dbErr) {
      // DB not configured yet — return a minimal in-memory session
      console.error('[super-admin] DB error:', dbErr.message);
      const fakeUser = {
        id: 0, email: SUPER_EMAIL, full_name: 'ESRAI Group',
        city: 'Mumbai', country: 'India', pincode: '400001',
        role: 'superadmin', provider: 'email', email_verified: true,
        avatar_url: null, created_at: new Date().toISOString(),
      };
      return res(200, { token: 'superadmin-' + token(16), user: fakeUser });
    }
  }

  const sql  = getDb();
  const rows = await sql`select * from users where email=${lEmail} limit 1`;
  if (!rows.length) return res(401, { message: 'Invalid email or password' });
  const user = rows[0];

  if (!user.password_hash) return res(401, { message: 'This account uses social login. Sign in with Google or Facebook.' });
  if (!verifyPassword(password, user.password_hash)) return res(401, { message: 'Invalid email or password' });
  if (!user.email_verified) return res(403, {
    message: 'Please verify your email address before signing in. Check your inbox.',
    code: 'EMAIL_NOT_VERIFIED',
  });
  if (!user.is_active) return res(403, { message: 'This account has been disabled.' });

  const sToken = token();
  const exp    = new Date(Date.now() + SESSION_DAYS * 86400 * 1000);
  await sql`insert into sessions (user_id, token, expires_at) values (${user.id}, ${sToken}, ${exp})`;
  return res(200, { token: sToken, user: safeUser(user) });
}

async function handleLogout(body) {
  const { token: t } = body || {};
  if (!t) return res(400, { message: 'Token required' });
  const sql = getDb();
  await sql`delete from sessions where token=${t}`;
  return res(200, { message: 'Signed out successfully' });
}

async function handleVerifyEmail(params) {
  const { token: t } = params;
  if (!t) return res(400, { message: 'Verification token missing' });

  const sql  = getDb();
  const rows = await sql`
    select ev.*, u.email from email_verifications ev
    join users u on u.id = ev.user_id
    where ev.token=${t} limit 1`;

  if (!rows.length)         return res(404, { message: 'Invalid or expired verification link' });
  const ev = rows[0];
  if (ev.used)              return res(410, { message: 'This verification link has already been used' });
  if (new Date() > new Date(ev.expires_at)) return res(410, { message: 'Verification link expired. Request a new one.' });

  await sql`update users set email_verified=true, updated_at=now() where id=${ev.user_id}`;
  await sql`update email_verifications set used=true where id=${ev.id}`;

  return res(200, { message: 'Email verified successfully! You can now sign in.' });
}

async function handleResendVerification(body) {
  const { email } = body || {};
  if (!email) return res(400, { message: 'Email required' });

  const sql  = getDb();
  const rows = await sql`select * from users where email=${email.toLowerCase()} limit 1`;
  if (!rows.length) return res(200, { message: 'If that email exists, a new verification link has been sent.' });

  const user = rows[0];
  if (user.email_verified) return res(200, { message: 'Your email is already verified. You can sign in.' });

  // Invalidate old tokens
  await sql`update email_verifications set used=true where user_id=${user.id} and used=false`;

  const vToken = token();
  const exp    = new Date(Date.now() + VERIFY_HOURS * 3600 * 1000);
  await sql`insert into email_verifications (user_id, token, expires_at) values (${user.id}, ${vToken}, ${exp})`;

  const verifyUrl = `${APP_URL}/verify-email.html?token=${vToken}`;
  await sendEmail({ to: email, subject: 'Verify your Applianzo account', html: verifyEmailHtml(user.full_name, verifyUrl) });

  return res(200, {
    message: 'A new verification link has been sent to your email.',
    verify_url: process.env.NODE_ENV === 'development' ? verifyUrl : undefined,
  });
}

async function handleForgotPassword(body) {
  const { email } = body || {};
  if (!email) return res(400, { message: 'Email required' });

  const sql  = getDb();
  const rows = await sql`select * from users where email=${email.toLowerCase()} limit 1`;

  // Always respond the same way to prevent email enumeration
  if (!rows.length || rows[0].provider !== 'email') {
    return res(200, { message: 'If that email has an account, a reset link has been sent.' });
  }
  const user = rows[0];

  // Invalidate old reset tokens
  await sql`update password_resets set used=true where user_id=${user.id} and used=false`;

  const rToken = token();
  const exp    = new Date(Date.now() + RESET_HOURS * 3600 * 1000);
  await sql`insert into password_resets (user_id, token, expires_at) values (${user.id}, ${rToken}, ${exp})`;

  const resetUrl = `${APP_URL}/reset-password.html?token=${rToken}`;
  await sendEmail({ to: email, subject: 'Reset your Applianzo password', html: resetPasswordHtml(user.full_name, resetUrl) });

  return res(200, {
    message: 'A password reset link has been sent to your email. It expires in 2 hours.',
    reset_url: process.env.NODE_ENV === 'development' ? resetUrl : undefined,
  });
}

async function handleResetPassword(body) {
  const { token: t, password } = body || {};
  if (!t || !password) return res(400, { message: 'Token and new password are required' });
  if (password.length < 8)    return res(400, { message: 'Password must be at least 8 characters' });

  const sql  = getDb();
  const rows = await sql`select * from password_resets where token=${t} limit 1`;
  if (!rows.length)                      return res(404, { message: 'Invalid or expired reset link' });
  const pr = rows[0];
  if (pr.used)                           return res(410, { message: 'This reset link has already been used' });
  if (new Date() > new Date(pr.expires_at)) return res(410, { message: 'Reset link expired. Request a new one.' });

  const hash = hashPassword(password);
  await sql`update users set password_hash=${hash}, updated_at=now() where id=${pr.user_id}`;
  await sql`update password_resets set used=true where id=${pr.id}`;
  // Invalidate all sessions for security
  await sql`delete from sessions where user_id=${pr.user_id}`;

  return res(200, { message: 'Password reset successfully. You can now sign in with your new password.' });
}

async function handleMe(event) {
  const auth = (event.headers || {})['authorization'] || '';
  const t    = auth.replace('Bearer ', '').trim();
  if (!t) return res(401, { message: 'Authentication required' });

  const sql  = getDb();
  const rows = await sql`
    select u.* from sessions s
    join users u on u.id = s.user_id
    where s.token=${t} and s.expires_at > now() limit 1`;

  if (!rows.length) return res(401, { message: 'Session expired or invalid. Please sign in again.' });
  return res(200, { user: safeUser(rows[0]) });
}

async function handleOAuth(body) {
  const { provider, provider_id, email, full_name, avatar_url, city, country, pincode } = body || {};
  if (!provider || !provider_id || !email) return res(400, { message: 'provider, provider_id and email required' });

  const sql  = getDb();
  let rows   = await sql`select * from users where email=${email.toLowerCase()} limit 1`;
  let user;

  if (rows.length) {
    // Update existing user
    user = rows[0];
    await sql`update users set
      provider_id=${provider_id}, avatar_url=${avatar_url||user.avatar_url},
      full_name=coalesce(${full_name||null}, full_name),
      email_verified=true, updated_at=now()
      where id=${user.id}`;
    const updated = await sql`select * from users where id=${user.id} limit 1`;
    user = updated[0];
  } else {
    // Create new OAuth user (auto-verified)
    const { country_code: cc2 } = body || {};
    const created = await sql`
      insert into users (email, full_name, avatar_url, role, provider, provider_id,
        email_verified, city, country, country_code, pincode)
      values (${email.toLowerCase()}, ${full_name||null}, ${avatar_url||null},
        'user', ${provider}, ${provider_id}, true,
        ${city||null}, ${country||null}, ${cc2||null}, ${pincode||null})
      returning *`;
    user = created[0];
  }

  if (!user.is_active) return res(403, { message: 'This account has been disabled.' });

  const sToken = token();
  const exp    = new Date(Date.now() + SESSION_DAYS * 86400 * 1000);
  await sql`insert into sessions (user_id, token, expires_at) values (${user.id}, ${sToken}, ${exp})`;
  return res(200, { token: sToken, user: safeUser(user) });
}

// ── Main handler ───────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  // Netlify can pass the path as the full URL or just the suffix after the function name
  const rawPath   = (event.path || '');
  const pathParts = rawPath.split('/').filter(Boolean);
  // Try to find route after 'auth' segment; fall back to last segment
  const authIdx   = pathParts.indexOf('auth');
  const route     = authIdx >= 0 ? (pathParts[authIdx + 1] || '') : (pathParts[pathParts.length - 1] || '');
  const params    = event.queryStringParameters || {};
  let body = {};
  try { if (event.body) body = JSON.parse(event.body); } catch {}

  try {
    switch (route) {
      case 'register':            return await handleRegister(body);
      case 'login':               return await handleLogin(body);
      case 'logout':              return await handleLogout(body);
      case 'verify-email':        return await handleVerifyEmail(params);
      case 'resend-verification': return await handleResendVerification(body);
      case 'forgot-password':     return await handleForgotPassword(body);
      case 'reset-password':      return await handleResetPassword(body);
      case 'me':                  return await handleMe(event);
      case 'oauth':               return await handleOAuth(body);
      default:
        return res(404, { message: `Unknown auth route: ${route}` });
    }
  } catch (err) {
    console.error(`[auth/${route}]`, err.message);
    return res(500, { message: 'Auth service error', error: err.message });
  }
};
