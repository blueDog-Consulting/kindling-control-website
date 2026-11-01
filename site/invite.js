// "Request an invite" dialog for the invite-only Android test on Google Play (docs/PRESETS.md).
// Steps: the form -> "check your inbox" -> (from the emailed link, /#invite-token=…) confirm -> done.
// The triggers stay hidden without JS, because requests can only be sent as JSON.

import { api } from './api-client.js';

const dialog = document.getElementById('invite');
const form = document.getElementById('invite-form');

if (dialog && form && typeof dialog.showModal === 'function') {
  const step = (id) => document.getElementById(id);
  let pending = null; // AbortController for the request in flight

  // Show one step; it names the dialog, and its first button gets focus unless a field has autofocus.
  const show = (id, focus = true) => {
    for (const s of dialog.querySelectorAll('.invite-step')) s.hidden = s.id !== id;
    dialog.setAttribute('aria-labelledby', step(id).querySelector('h2').id);
    for (const s of dialog.querySelectorAll('.invite-status')) say(s, '');
    if (focus && id !== 'invite-form') step(id).querySelector('button').focus();
  };
  const say = (el, text, kind = '') => {
    el.textContent = text;
    el.dataset.kind = kind;
  };
  // Runs a request that is abandoned (not reported) if the dialog closes while it's in flight.
  const send = async (button, statusEl, path, body, onOk) => {
    pending = new AbortController();
    const { signal } = pending;
    button.disabled = true;
    say(statusEl, 'Sending…');
    try {
      const data = await api(path, { method: 'POST', body, signal });
      if (!signal.aborted && dialog.open) onOk(data);
    } catch (err) {
      if (signal.aborted || !dialog.open) return;
      say(statusEl, err instanceof TypeError ? "Couldn't reach the server. Check your connection and try again." : err.message, 'error');
    } finally {
      button.disabled = false;
      if (pending?.signal === signal) pending = null;
    }
  };

  for (const cta of document.querySelectorAll('.invite-cta')) cta.hidden = false;
  for (const btn of document.querySelectorAll('[data-invite]')) {
    btn.addEventListener('click', () => {
      show('invite-form', false);
      dialog.showModal();
    });
  }
  for (const btn of dialog.querySelectorAll('[data-invite-close]')) btn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    pending?.abort();
    pending = null;
    if (!form.hidden) return; // keep what they typed if they just cancelled the form
    form.reset();
    show('invite-form', false);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const statusEl = form.querySelector('.invite-status');
    const { name, email, consent, kc_hp: hp } = form.elements;
    if (name.value.trim().length < 2) return say(statusEl, 'Enter your name.', 'error'), name.focus();
    if (!email.value.trim() || !email.checkValidity()) return say(statusEl, 'Enter a valid email address.', 'error'), email.focus();
    if (!consent.checked) return say(statusEl, 'Please tick the box so we can use your details to send the invite.', 'error'), consent.focus();
    const body = { name: name.value.trim(), email: email.value.trim(), consent: true, kc_hp: hp.value };
    send(e.submitter ?? form.querySelector('[type=submit]'), statusEl, '/testers/request', body, (data) => {
      step('invite-sent-email').textContent = body.email;
      const dev = step('invite-dev-link');
      dev.hidden = !data.devLink;
      if (data.devLink) {
        // Local development only (DEV_SHOW_LINKS=1): no email is sent, so show the link.
        const a = Object.assign(document.createElement('a'), { href: data.devLink, textContent: 'open the confirmation link' });
        dev.replaceChildren('Development mode: ', a);
      }
      show('invite-sent');
    });
  });

  // Arriving from the confirmation email. The token is in the fragment, so it never reaches the server
  // in a GET (mail scanners can't spend it); it's only sent when the person presses Confirm.
  // hashchange covers the link opening in a tab that already shows this page.
  let token = null;
  const confirmBtn = step('invite-confirm-btn');
  confirmBtn.addEventListener('click', () =>
    send(confirmBtn, step('invite-confirm').querySelector('.invite-status'), '/testers/confirm', { token }, () => show('invite-done')),
  );
  const fromLink = () => {
    const t = new URLSearchParams(location.hash.slice(1)).get('invite-token');
    if (!t) return;
    token = t;
    history.replaceState(null, '', location.pathname + location.search); // keep it out of history
    pending?.abort();
    if (dialog.open) {
      show('invite-confirm'); // switch in place: close() fires its event later and would reset the step
    } else {
      show('invite-confirm', false);
      dialog.showModal();
    }
  };
  addEventListener('hashchange', fromLink);
  fromLink();
}
