import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { handleApi, cleanup } from '../worker/api.js';
import { normalisePreset } from '../worker/preset.js';
import { blankPreset } from '../vendor/app/spark/effects.js';
import { presetToJson, presetFromJson } from '../vendor/app/spark/messages.js';
import { createD1 } from '../tools/d1-sqlite.js';

const ORIGIN = 'https://kindlingcontrol.app';

function setup() {
  const env = {
    DB: createD1(),
    DEV_SHOW_LINKS: '1',
    SITE_ORIGIN: ORIGIN,
    ADMIN_EMAILS: 'mod@example.com',
    ASSETS: { fetch: (req) => new Response(`asset ${new URL(req.url).pathname}`) },
  };
  const ctx = { waitUntil() {} };
  async function call(method, path, { body, cookie, ip = '203.0.113.1', origin = ORIGIN, type = 'application/json' } = {}) {
    const headers = { 'cf-connecting-ip': ip };
    if (cookie) headers.cookie = cookie;
    if (method !== 'GET') {
      if (origin) headers.origin = origin;
      if (type) headers['content-type'] = type;
    }
    const res = await worker.fetch(
      new Request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      env,
      ctx,
    );
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers };
  }
  async function signIn(email, ip) {
    const r = await call('POST', '/api/auth/request', { body: { email }, ip });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const token = new URL(r.data.devLink).hash.slice('#token='.length);
    const v = await call('POST', '/api/auth/verify', { body: { token } });
    assert.equal(v.status, 200, JSON.stringify(v.data));
    return v.headers.get('set-cookie').split(';')[0];
  }
  return { env, ctx, call, signIn };
}

function samplePreset(name = 'Glassy Clean') {
  const p = blankPreset(name);
  return presetToJson({ ...p, uuid: '12345678-ABCD-4ABC-8ABC-1234567890AB' });
}

async function upload(h, cookie, extra = {}) {
  return h.call('POST', '/api/presets', { cookie, body: { preset: samplePreset(), description: 'Bright and clean', license: true, ...extra } });
}

test('magic-link sign-in: link in the URL fragment, single use, HttpOnly session cookie', async () => {
  const h = setup();
  const r = await h.call('POST', '/api/auth/request', { body: { email: ' Player@Example.com ' } });
  assert.equal(r.status, 200);
  const link = new URL(r.data.devLink);
  assert.equal(link.origin + link.pathname, `${ORIGIN}/presets/signin.html`);
  assert.match(link.hash, /^#token=[\w-]{40,}$/);

  const token = link.hash.slice(7);
  const v = await h.call('POST', '/api/auth/verify', { body: { token } });
  assert.equal(v.status, 200);
  const cookie = v.headers.get('set-cookie');
  assert.match(cookie, /^kc_session=[\w-]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/);

  assert.equal((await h.call('POST', '/api/auth/verify', { body: { token } })).status, 400, 'a link works once');

  const me = await h.call('GET', '/api/me', { cookie: cookie.split(';')[0] });
  assert.equal(me.data.user.email, 'player@example.com');
  assert.match(me.data.user.displayName, /^Player /);

  const out = await h.call('POST', '/api/auth/logout', { cookie: cookie.split(';')[0] });
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await h.call('GET', '/api/me', { cookie: cookie.split(';')[0] })).data.user, null);
});

test('sign-in links expire, and the database only holds hashes', async () => {
  const h = setup();
  const now = Date.now();
  const req = (method, path, body) =>
    new Request(ORIGIN + path, { method, headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify(body) });
  const r = await (await handleApi(req('POST', '/api/auth/request', { email: 'a@example.com' }), h.env, h.ctx, now)).json();
  const token = new URL(r.devLink).hash.slice(7);
  const stored = h.env.DB.raw.prepare('SELECT token_hash FROM login_tokens').get().token_hash;
  assert.notEqual(stored, token);
  assert.match(stored, /^[0-9a-f]{64}$/);
  const late = await handleApi(req('POST', '/api/auth/verify', { token }), h.env, h.ctx, now + 16 * 60 * 1000);
  assert.equal(late.status, 400);
});

test('sign-in rejects bad emails and rate-limits per address', async () => {
  const h = setup();
  for (const email of ['', 'nope', 'a@b', 'x y@example.com', 42]) {
    assert.equal((await h.call('POST', '/api/auth/request', { body: { email } })).status, 400, String(email));
  }
  for (let i = 0; i < 5; i++) {
    assert.equal((await h.call('POST', '/api/auth/request', { body: { email: 'spam@example.com' }, ip: `198.51.100.${i}` })).status, 200);
  }
  assert.equal((await h.call('POST', '/api/auth/request', { body: { email: 'spam@example.com' }, ip: '198.51.100.99' })).status, 429);
});

test('without an email provider, sign-in fails clearly instead of pretending', async () => {
  const h = setup();
  delete h.env.DEV_SHOW_LINKS;
  const r = await h.call('POST', '/api/auth/request', { body: { email: 'a@example.com' } });
  assert.equal(r.status, 503);
});

test('the Cloudflare Email Service binding is used when configured', async () => {
  const h = setup();
  const sent = [];
  h.env.EMAIL = strictEmailBinding(sent);
  h.env.MAIL_FROM = 'KindlingControl <presets@kindlingcontrol.app>';
  const r = await h.call('POST', '/api/auth/request', { body: { email: 'a@example.com' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.devLink, undefined, 'the link is never returned when real email is configured');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'a@example.com');
  assert.deepEqual(sent[0].from, { email: 'presets@kindlingcontrol.app', name: 'KindlingControl' });
  assert.match(sent[0].text, /https:\/\/kindlingcontrol\.app\/presets\/signin\.html#token=/);
});

test('a MAIL_FROM without a display name is sent as a plain address', async () => {
  const h = setup();
  const sent = [];
  h.env.EMAIL = strictEmailBinding(sent);
  h.env.MAIL_FROM = 'presets@kindlingcontrol.app';
  const r = await h.call('POST', '/api/auth/request', { body: { email: 'a@example.com' } });
  assert.equal(r.status, 200);
  assert.equal(sent[0].from, 'presets@kindlingcontrol.app');
});

test('an Email Service failure is a clear 503, not a 500', async () => {
  const h = setup();
  delete h.env.DEV_SHOW_LINKS;
  h.env.EMAIL = { send: async () => { throw Object.assign(new Error('sender not verified'), { code: 'E_SENDER' }); } };
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    const r = await h.call('POST', '/api/auth/request', { body: { email: 'a@example.com' } });
    assert.equal(r.status, 503);
  } finally {
    console.error = orig;
  }
  assert.ok(logged.some((l) => /Email Service send failed: Error: E_SENDER: sender not verified/.test(l)));
  assert.ok(!logged.some((l) => l.includes('a@example.com')), 'the recipient is never logged');
});

test('uploading needs a session and the CC0 agreement, and validates the file', async () => {
  const h = setup();
  assert.equal((await upload(h, undefined)).status, 401);
  const cookie = await h.signIn('maker@example.com');
  assert.equal((await upload(h, cookie, { license: false })).status, 400);
  const broken = samplePreset();
  broken.Pedals = broken.Pedals.slice(0, 3);
  assert.equal((await upload(h, cookie, { preset: broken })).status, 400);
  assert.equal((await upload(h, cookie, { preset: [samplePreset()] })).status, 400);
  const ok = await upload(h, cookie);
  assert.equal(ok.status, 201);
  assert.match(ok.data.id, /^[\w-]{12}$/);
});

test('shared presets are listed with the display name, never the email', async () => {
  const h = setup();
  const cookie = await h.signIn('maker@example.com');
  await h.call('PATCH', '/api/me', { cookie, body: { displayName: 'Strat Cat' } });
  const { data: up } = await upload(h, cookie);

  const list = await h.call('GET', '/api/presets');
  assert.equal(list.status, 200);
  assert.equal(list.data.items.length, 1);
  const [item] = list.data.items;
  assert.equal(item.id, up.id);
  assert.equal(item.author, 'Strat Cat');
  assert.equal(item.chain.length, 7);
  assert.ok(item.amp, 'amp model is extracted for filtering');
  assert.doesNotMatch(JSON.stringify(list.data), /maker@example\.com/);

  const detail = await h.call('GET', `/api/presets/${up.id}`);
  assert.doesNotMatch(JSON.stringify(detail.data), /maker@example\.com/);
  assert.equal(detail.data.canManage, false);
  assert.equal((await h.call('GET', `/api/presets/${up.id}`, { cookie })).data.canManage, true);
});

test('downloads are normalised, importable by the app, and counted', async () => {
  const h = setup();
  const cookie = await h.signIn('maker@example.com');
  const preset = { ...samplePreset('  Lead\u0000 Tone  '), Evil: '<script>', PresetNumber: 3 };
  preset.Pedals[0].Extra = 'x';
  const { data: up } = await upload(h, cookie, { preset });

  const dl = await h.call('GET', `/api/presets/${up.id}/download`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /attachment; filename="Lead_Tone\.json"/);
  assert.equal(dl.headers.get('access-control-allow-origin'), '*');
  assert.equal(dl.data.Name, 'Lead Tone');
  assert.equal(dl.data.Evil, undefined);
  assert.equal(dl.data.PresetNumber, undefined);
  assert.equal(dl.data.Pedals[0].Extra, undefined);

  const back = presetFromJson(dl.data);
  const original = presetFromJson(samplePreset());
  assert.deepEqual(back.pedals, original.pedals, 'parameters survive exactly');

  const list = await h.call('GET', '/api/presets');
  assert.equal(list.data.items[0].downloads, 1);
});

test('search, amp filter and sorting', async () => {
  const h = setup();
  const cookie = await h.signIn('maker@example.com');
  await upload(h, cookie, { preset: samplePreset('Glassy Clean'), description: 'sparkly' });
  const { data: b } = await upload(h, cookie, { preset: samplePreset('Crunch 100%'), description: 'rock' });
  await h.call('GET', `/api/presets/${b.id}/download`);

  assert.deepEqual((await h.call('GET', '/api/presets?q=sparkly')).data.items.map((i) => i.name), ['Glassy Clean']);
  assert.deepEqual((await h.call('GET', '/api/presets?q=100%25')).data.items.map((i) => i.name), ['Crunch 100%'], '% is literal');
  assert.deepEqual((await h.call('GET', '/api/presets?q=_')).data.items, [], '_ is literal');
  assert.equal((await h.call('GET', '/api/presets?sort=popular')).data.items[0].name, 'Crunch 100%');
  const amp = (await h.call('GET', '/api/presets')).data.items[0].amp;
  assert.equal((await h.call('GET', `/api/presets?amp=${encodeURIComponent(amp)}`)).data.items.length, 2);
  assert.equal((await h.call('GET', '/api/presets?amp=Nope')).data.items.length, 0);
});

test('writes must be same-origin JSON', async () => {
  const h = setup();
  const cookie = await h.signIn('maker@example.com');
  const evil = await h.call('POST', '/api/presets', { cookie, origin: 'https://evil.example', body: { preset: samplePreset(), license: true } });
  assert.equal(evil.status, 403);
  const form = await h.call('POST', '/api/presets', { cookie, type: 'text/plain', body: { preset: samplePreset(), license: true } });
  assert.equal(form.status, 415);
});

test('three reports hide a preset until a moderator restores it', async () => {
  const h = setup();
  const cookie = await h.signIn('maker@example.com');
  const { data: up } = await upload(h, cookie);
  for (const ip of ['192.0.2.1', '192.0.2.1', '192.0.2.2']) {
    assert.equal((await h.call('POST', `/api/presets/${up.id}/report`, { ip, body: { reason: 'spam' } })).status, 200);
  }
  assert.equal((await h.call('GET', '/api/presets')).data.items.length, 1, 'repeat reports from one person count once');
  await h.call('POST', `/api/presets/${up.id}/report`, { ip: '192.0.2.3', body: { reason: 'spam' } });
  assert.equal((await h.call('GET', '/api/presets')).data.items.length, 0);
  assert.equal((await h.call('GET', `/api/presets/${up.id}`)).status, 404);
  assert.equal((await h.call('GET', `/api/presets/${up.id}/download`)).status, 404);
  assert.equal((await h.call('GET', `/api/presets/${up.id}`, { cookie })).data.hidden, true, 'the owner still sees it');

  assert.equal((await h.call('GET', '/api/admin/hidden', { cookie })).status, 403);
  const mod = await h.signIn('mod@example.com', '192.0.2.50');
  const hidden = await h.call('GET', '/api/admin/hidden', { cookie: mod });
  assert.equal(hidden.data.items[0].reports, 3);
  assert.equal((await h.call('POST', `/api/presets/${up.id}/restore`, { cookie: mod, body: {} })).status, 200);
  assert.equal((await h.call('GET', '/api/presets')).data.items.length, 1);
});

test('only the owner or a moderator can delete', async () => {
  const h = setup();
  const owner = await h.signIn('maker@example.com');
  const other = await h.signIn('other@example.com', '192.0.2.9');
  const { data: up } = await upload(h, owner);
  assert.equal((await h.call('DELETE', `/api/presets/${up.id}`, { cookie: other, body: {} })).status, 403);
  assert.equal((await h.call('GET', '/api/me/presets', { cookie: owner })).data.items.length, 1);
  assert.equal((await h.call('DELETE', `/api/presets/${up.id}`, { cookie: owner, body: {} })).status, 200);
  assert.equal((await h.call('GET', '/api/presets')).data.items.length, 0);
});

test('www redirects to the apex domain; other paths are static assets', async () => {
  const h = setup();
  const r = await worker.fetch(new Request('https://www.kindlingcontrol.app/guide/?x=1'), h.env, h.ctx);
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), 'https://kindlingcontrol.app/guide/?x=1');
  assert.equal(await (await worker.fetch(new Request(`${ORIGIN}/presets/`), h.env, h.ctx)).text(), 'asset /presets/');
  assert.equal((await h.call('GET', '/api/nope')).status, 404);
});

test('cleanup drops expired tokens, sessions and old rate-limit rows', async () => {
  const h = setup();
  await h.signIn('maker@example.com');
  const later = Date.now() + 40 * 24 * 60 * 60 * 1000;
  await cleanup(h.env.DB, later);
  for (const t of ['login_tokens', 'sessions', 'rate_events']) {
    assert.equal(h.env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, t);
  }
});

async function requestInvite(h, body, opts = {}) {
  return h.call('POST', '/api/testers/request', { body: { consent: true, ...body }, ...opts });
}
const inviteToken = (r) => new URL(r.data.devLink).hash.slice('#invite-token='.length);
const testerRows = (h) => h.env.DB.raw.prepare('SELECT * FROM tester_requests').all().map((r) => ({ ...r }));

test('Android test invite requests: validated, and only queued once the address owner confirms', async () => {
  const h = setup();
  const ok = { name: 'Pat Player', email: ' Pat@Example.com ' };
  assert.equal((await requestInvite(h, { ...ok, consent: false })).status, 400, 'consent is required');
  assert.equal((await requestInvite(h, { ...ok, consent: 'yes' })).status, 400, 'consent must be a real true');
  assert.equal((await requestInvite(h, { ...ok, email: 'not-an-email' })).status, 400);
  assert.equal((await requestInvite(h, { ...ok, name: ' ' })).status, 400);
  assert.equal((await requestInvite(h, ok, { origin: 'https://evil.example' })).status, 403);

  // Honeypot: same answer, nothing stored or sent. A field called "website" no longer counts.
  const bot = await requestInvite(h, { ...ok, email: 'bot@example.com', kc_hp: 'x' });
  assert.equal(bot.status, 200);
  assert.equal(bot.data.devLink, undefined);
  assert.equal((await requestInvite(h, { ...ok, email: 'human@example.com', website: 'https://me.example' })).status, 200);

  const r = await requestInvite(h, ok);
  assert.equal(r.status, 200);
  const link = new URL(r.data.devLink);
  assert.equal(link.origin + link.pathname, `${ORIGIN}/`);
  assert.match(link.hash, /^#invite-token=[\w-]{40,}$/);
  const pat = testerRows(h).find((row) => row.email === 'pat@example.com');
  assert.equal(pat.confirmed_at, null);
  assert.equal(pat.pending_name, 'Pat Player');
  assert.notEqual(pat.token_hash, inviteToken(r), 'only a hash of the token is stored');

  const mod = await h.signIn('mod@example.com');
  assert.equal((await h.call('GET', '/api/admin/testers', { cookie: mod })).data.items.length, 0, 'unconfirmed requests are not shown');

  assert.equal((await h.call('POST', '/api/testers/confirm', { body: { token: 'x'.repeat(43) } })).status, 400);
  assert.equal((await h.call('POST', '/api/testers/confirm', { body: { token: inviteToken(r) } })).status, 200);
  assert.equal((await h.call('POST', '/api/testers/confirm', { body: { token: inviteToken(r) } })).status, 400, 'a link works once');
  const list = await h.call('GET', '/api/admin/testers', { cookie: mod });
  assert.deepEqual(list.data.items.map((i) => [i.name, i.email]), [['Pat Player', 'pat@example.com']]);

  // A stranger re-requesting the address can't rename the confirmed request.
  await requestInvite(h, { name: 'Rude Name', email: 'pat@example.com' }, { ip: '203.0.113.9' });
  assert.equal((await h.call('GET', '/api/admin/testers', { cookie: mod })).data.items[0].name, 'Pat Player');
});

test('Android test invites: the confirmation goes through Email Service, and a failed send is a clear 503', async () => {
  const h = setup();
  const sent = [];
  h.env.EMAIL = strictEmailBinding(sent);
  h.env.MAIL_FROM = 'KindlingControl <presets@kindlingcontrol.app>';
  const r = await requestInvite(h, { name: 'Pat <b>', email: 'pat@example.com' });
  assert.equal(r.status, 200);
  assert.equal(r.data.devLink, undefined, 'the link is never returned when real email is configured');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'pat@example.com');
  assert.match(sent[0].subject, /Android test/);
  assert.match(sent[0].text, /https:\/\/kindlingcontrol\.app\/#invite-token=[\w-]{40,}/);
  assert.match(sent[0].html, /Hi Pat &lt;b&gt;,/, 'the name is escaped in the HTML part');

  h.env.EMAIL = { send: async () => { throw new Error('sender not verified'); } };
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    const failed = await requestInvite(h, { name: 'Sam', email: 'sam@example.com' }, { ip: '203.0.113.50' });
    assert.equal(failed.status, 503);
    assert.match(failed.data.error, /confirmation email/);
  } finally {
    console.error = orig;
  }
  assert.ok(logged.some((l) => /Email Service send failed: Error: sender not verified \(invite confirmation email\)/.test(l)));
  assert.ok(!logged.some((l) => l.includes('sam@example.com')), 'the recipient is never logged');
});

test('Android test invites: moderators list and delete them, in one query', async () => {
  const h = setup();
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const r = await requestInvite(h, { name: `Player ${i}`, email: `p${i}@example.com` }, { ip: `203.0.113.${10 + i}` });
    await h.call('POST', '/api/testers/confirm', { body: { token: inviteToken(r) } });
  }
  assert.equal((await h.call('GET', '/api/admin/testers')).status, 401);
  const player = await h.signIn('player@example.com');
  assert.equal((await h.call('GET', '/api/admin/testers', { cookie: player })).status, 403);
  assert.equal((await h.call('POST', '/api/admin/testers/invited', { cookie: player, body: { ids: ['x'] } })).status, 403);
  assert.doesNotMatch(JSON.stringify((await h.call('GET', '/api/presets')).data), /p0@example/);

  const mod = await h.signIn('mod@example.com');
  const list = await h.call('GET', '/api/admin/testers', { cookie: mod });
  for (const item of list.data.items) ids.push(item.id);
  assert.equal(ids.length, 4);
  assert.equal((await h.call('POST', '/api/admin/testers/invited', { cookie: mod, body: { ids: [] } })).status, 400);

  let queries = 0;
  const prepare = h.env.DB.prepare.bind(h.env.DB);
  h.env.DB.prepare = (sql) => (queries++, prepare(sql));
  const done = await h.call('POST', '/api/admin/testers/invited', { cookie: mod, body: { ids: ids.slice(0, 3) } });
  h.env.DB.prepare = prepare;
  assert.equal(done.status, 200);
  assert.ok(queries <= 2, `session lookup + one delete, got ${queries} queries`);
  assert.deepEqual(testerRows(h).map((r) => r.email), ['p3@example.com']);
});

test('Android test invites: rate limits, and cleanup of unconfirmed and stale requests', async () => {
  const h = setup();
  for (let i = 0; i < 5; i++) assert.equal((await requestInvite(h, { name: 'Pat', email: `p${i}@example.com` })).status, 200);
  assert.equal((await requestInvite(h, { name: 'Pat', email: 'p9@example.com' })).status, 429, 'per IP');
  for (let i = 0; i < 3; i++) await requestInvite(h, { name: 'Pat', email: 'same@example.com' }, { ip: `198.51.100.${i}` });
  assert.equal((await requestInvite(h, { name: 'Pat', email: 'same@example.com' }, { ip: '198.51.100.9' })).status, 429, 'per address');

  const h2 = setup();
  const day = 24 * 60 * 60 * 1000;
  const t0 = Date.now();
  const confirmed = await requestInvite(h2, { name: 'Kept', email: 'kept@example.com' });
  await h2.call('POST', '/api/testers/confirm', { body: { token: inviteToken(confirmed) } });
  await requestInvite(h2, { name: 'Never confirmed', email: 'ghost@example.com' });
  await cleanup(h2.env.DB, t0 + 2 * day);
  assert.deepEqual(testerRows(h2).map((r) => r.email), ['kept@example.com'], 'unconfirmed requests go after a day');

  // Re-requesting and confirming again restarts the 90 days.
  const again = await handleApi(
    new Request(`${ORIGIN}/api/testers/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1' },
      body: JSON.stringify({ name: 'Kept', email: 'kept@example.com', consent: true }),
    }),
    h2.env,
    h2.ctx,
    t0 + 80 * day,
  );
  const token = new URL((await again.json()).devLink).hash.slice('#invite-token='.length);
  const ok = await handleApi(
    new Request(`${ORIGIN}/api/testers/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }),
    h2.env,
    h2.ctx,
    t0 + 80 * day,
  );
  assert.equal(ok.status, 200);
  await cleanup(h2.env.DB, t0 + 100 * day);
  assert.equal(testerRows(h2).length, 1, 'still there 20 days after the latest confirmation');
  await cleanup(h2.env.DB, t0 + 171 * day);
  assert.equal(testerRows(h2).length, 0, 'gone 90 days after it');
});

test('normalisePreset rejects junk effect names and parameters', () => {
  const p = samplePreset();
  assert.throws(() => normalisePreset({ ...p, Name: '' }), /no name/);
  const badName = structuredClone(p);
  badName.Pedals[2].Name = '<img src=x>';
  assert.throws(() => normalisePreset(badName), /Block 3/);
  const badParam = structuredClone(p);
  badParam.Pedals[1].Parameters = [1e9];
  assert.throws(() => normalisePreset(badParam), /out-of-range/);
  const noUuid = { ...p, UUID: 'nope' };
  assert.match(normalisePreset(noUuid).preset.UUID, /^[0-9A-F-]{36}$/);
});

// Mirrors the live binding's checks: an address is a string, or an EmailAddress object whose
// email and name are both strings (a missing name throws a TypeError on Cloudflare).
function strictEmailBinding(sent) {
  const check = (field, v) => {
    if (typeof v === 'string') return;
    if (v && typeof v === 'object' && typeof v.email === 'string' && typeof v.name === 'string') return;
    throw new TypeError(`Incorrect type for '${field}'`);
  };
  return {
    async send(msg) {
      check('from', msg.from);
      for (const t of Array.isArray(msg.to) ? msg.to : [msg.to]) check('to', t);
      sent.push(msg);
    },
  };
}
