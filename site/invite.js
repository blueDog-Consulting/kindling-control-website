// "Request an invite" dialog for the invite-only Android test on Google Play.
// The triggers stay hidden without JS, because the form can only be sent as JSON (see docs/PRESETS.md).

const dialog = document.getElementById('invite');
const form = document.getElementById('invite-form');
const done = document.getElementById('invite-done');
const status = document.getElementById('invite-status');

if (dialog && form && typeof dialog.showModal === 'function') {
  for (const cta of document.querySelectorAll('.invite-cta')) cta.hidden = false;
  for (const btn of document.querySelectorAll('[data-invite]')) btn.addEventListener('click', () => dialog.showModal());
  for (const btn of dialog.querySelectorAll('[data-invite-close]')) btn.addEventListener('click', () => dialog.close());

  const say = (text, kind = '') => {
    status.textContent = text;
    status.dataset.kind = kind;
  };

  dialog.addEventListener('close', () => {
    // After a sent request, the next opening starts with a fresh form.
    if (!done.hidden) {
      form.reset();
      form.hidden = false;
      done.hidden = true;
      dialog.setAttribute('aria-labelledby', 'invite-title');
    }
    say('');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.elements.name.value.trim();
    const email = form.elements.email.value.trim();
    const consent = form.elements.consent.checked;
    if (name.length < 2) return say('Enter your name.', 'error'), form.elements.name.focus();
    if (!form.elements.email.checkValidity() || !email) return say('Enter a valid email address.', 'error'), form.elements.email.focus();
    if (!consent) return say('Please tick the box so we can use your details to send the invite.', 'error'), form.elements.consent.focus();

    const button = e.submitter ?? form.querySelector('[type=submit]');
    button.disabled = true;
    say('Sending…');
    try {
      const res = await fetch('/api/testers/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, consent, website: form.elements.website.value }),
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      say('');
      form.hidden = true;
      done.hidden = false;
      dialog.setAttribute('aria-labelledby', 'invite-done-title');
      done.querySelector('[data-invite-close]').focus();
    } catch (err) {
      say(err instanceof TypeError ? "Couldn't reach the server. Check your connection and try again." : err.message, 'error');
    } finally {
      button.disabled = false;
    }
  });
}
