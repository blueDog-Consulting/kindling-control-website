// Sends the sign-in email. Providers, in order of preference:
//
//   1. Cloudflare Email Service: a `send_email` binding named EMAIL in wrangler.jsonc.
//      The sender (MAIL_FROM) must be on a domain onboarded to Email Service.
//   2. Resend (https://resend.com): set the secret RESEND_API_KEY.
//   3. Development only: DEV_SHOW_LINKS = "1" logs the link and returns it to the caller
//      instead of sending anything. Never set this in production.
//
// The Email Service call shape follows Cloudflare's published examples; it hasn't been
// exercised against a live account from this repo yet (see docs/PRESETS.md).

import { HttpError } from './util.js';

export async function sendSignInEmail(env, to, link) {
  const from = parseAddress(env.MAIL_FROM || 'KindlingControl <presets@kindlingcontrol.app>');
  const subject = 'Your KindlingControl sign-in link';
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

  if (env.EMAIL && typeof env.EMAIL.send === 'function') {
    try {
      // EmailAddress objects need both email and name as strings, so the recipient goes as a
      // plain address, and so does the sender when MAIL_FROM has no display name.
      await env.EMAIL.send({ to, from: from.name ? from : from.email, subject, text, html });
    } catch (err) {
      // Log what Email Service said (never the recipient) so the Worker logs show why,
      // e.g. an unverified sender domain.
      console.error('Email Service send failed:', describeError(err));
      throw new HttpError(503, "Couldn't send the sign-in email. Please try again later.");
    }
    return { provider: 'cloudflare' };
  }
  if (env.DEV_SHOW_LINKS === '1') {
    console.log(`[dev] sign-in link for ${to}: ${link}`);
    return { provider: 'dev', devLink: link };
  }
  throw new HttpError(503, "Signing in isn't available right now: email sending isn't set up.");
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
