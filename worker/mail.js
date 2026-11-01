// Sends the sign-in and Android test confirmation emails through Cloudflare Email Service: the
// `send_email` binding named EMAIL in wrangler.jsonc. The sender (MAIL_FROM) must be on a domain
// onboarded to Email Service. There's no third-party provider.
//
// Development only: DEV_SHOW_LINKS = "1" logs the link and returns it to the caller instead of
// sending anything. Never set this in production.
//
// Without either, the request answers 503. A failed send is logged (never the recipient) and also
// answers 503. See docs/PRESETS.md#email.

import { HttpError } from './util.js';

export async function sendSignInEmail(env, to, link) {
  const text = [
    'Use this link to sign in to the KindlingControl presets hub:',
    '',
    link,
    '',
    'It works once and expires in 15 minutes.',
    "If you didn't ask for it, you can ignore this email.",
  ].join('\n');
  const html = `<p>Use this link to sign in to the KindlingControl presets hub:</p>
<p><a href="${escapeHtml(link)}">Sign in to KindlingControl</a></p>
<p>It works once and expires in 15 minutes. If you didn't ask for it, you can ignore this email.</p>`;
  return sendEmail(env, {
    to,
    subject: 'Your KindlingControl sign-in link',
    text,
    html,
    link,
    what: 'sign-in',
    failed: "Couldn't send the sign-in email. Please try again later.",
    unavailable: "Signing in isn't available right now: email sending isn't set up.",
  });
}

export async function sendTesterConfirmEmail(env, to, name, link) {
  const text = [
    `Hi ${name},`,
    '',
    'Someone (hopefully you) asked for an invite to the KindlingControl Android test on Google Play with this address.',
    'Open this link and press "Confirm my request" to send it:',
    '',
    link,
    '',
    'The link expires in 24 hours. Until you confirm, the request is not passed on, and it is deleted after a day.',
    "If you didn't ask for this, ignore this email.",
  ].join('\n');
  const html = `<p>Hi ${escapeHtml(name)},</p>
<p>Someone (hopefully you) asked for an invite to the KindlingControl Android test on Google Play with this address.
Open this link and press <strong>Confirm my request</strong> to send it:</p>
<p><a href="${escapeHtml(link)}">Confirm my Android test request</a></p>
<p>The link expires in 24 hours. Until you confirm, the request is not passed on, and it is deleted after a day.
If you didn't ask for this, ignore this email.</p>`;
  return sendEmail(env, {
    to,
    subject: 'Confirm your KindlingControl Android test request',
    text,
    html,
    link,
    what: 'invite confirmation',
    failed: "Couldn't send the confirmation email. Please try again later.",
    unavailable: "Invite requests aren't available right now: email sending isn't set up.",
  });
}

async function sendEmail(env, { to, subject, text, html, link, what, failed, unavailable }) {
  if (env.EMAIL && typeof env.EMAIL.send === 'function') {
    const from = parseAddress(env.MAIL_FROM || 'KindlingControl <presets@kindlingcontrol.app>');
    try {
      // EmailAddress objects need both email and name as strings, so the recipient goes as a
      // plain address, and so does the sender when MAIL_FROM has no display name.
      await env.EMAIL.send({ to, from: from.name ? from : from.email, subject, text, html });
    } catch (err) {
      // Log what Email Service said (never the recipient) so the Worker logs show why,
      // e.g. an unverified sender domain.
      console.error('Email Service send failed:', describeError(err), `(${what} email)`);
      throw new HttpError(503, failed);
    }
    return { provider: 'cloudflare' };
  }
  if (env.DEV_SHOW_LINKS === '1') {
    console.log(`[dev] ${what} link for ${to}: ${link}`);
    return { provider: 'dev', devLink: link };
  }
  throw new HttpError(503, unavailable);
}

function describeError(err) {
  if (!(err instanceof Error)) return String(err);
  return [err.name, err.code, err.message].filter(Boolean).join(': ');
}

function parseAddress(s) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(s);
  return m && m[1] ? { email: m[2], name: m[1] } : { email: m ? m[2] : s.trim() };
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
