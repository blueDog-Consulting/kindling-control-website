# AGENTS.md

Guidance for AI coding agents and human contributors working on this repository. `CLAUDE.md` imports this file.

## Documentation rule (required)

**Any material change to how the site works must, in the same change, update both:**

1. **The docs that describe it:** `README.md` and/or `docs/PRESETS.md`.
2. **This file** (`AGENTS.md`), so the next agent has an accurate picture.

"Material" means the API, sign-in, moderation, the database schema, security headers, build/deploy config, npm scripts, CI or tools. Content and styling changes (landing page copy, CSS, screenshots, a vendor sync) aren't material.

**Enforcement:** `tools/check-docs.js` (`npm run check:docs`) runs in CI. The material paths are listed in `MATERIAL` in that file. To skip for a genuinely non-material change, add the commit trailer `Docs-Not-Needed: <reason>` or the PR label `docs-not-needed`. Don't use the opt-out to dodge real doc updates.

## What this is

The website for **KindlingControl**, an open controller for Positive Grid Spark amps: **https://kindlingcontrol.app**.

- © 2026 **blueDog Consulting and Jeremy Meiss** (blueDog Consulting builds and maintains it).
- Licence **GPL-3.0-or-later**, the same as the app. `LICENSE` is the verbatim GPLv3 text; never edit it.
- **The app is a separate repository:** https://github.com/bluedog-consulting/kindling-control-spark-amps. It was split out so the app can be forked without the website.
- This is an independent interoperability project. Never add Positive Grid's code, assets, logos or branding, and never present this as an official site.

| Path | What | Source |
|---|---|---|
| `/` | landing page | `site/index.html`, `site/site.css`, `site/screenshots/` |
| `/guide/` | the app's user guide | `vendor/app/guide/` (header link patched by `tools/build.js`) |
| `/presets/` | presets hub pages | `site/presets/` |
| `/api/*` | presets API | `worker/` + D1 (`migrations/`) |

One Cloudflare Worker serves it all (`wrangler.jsonc`). Static files come from `dist/` (`tools/build.js`), and the Worker script only runs for `/api/*`. The `www.` → apex redirect is a Cloudflare **Redirect Rule** on the zone (dashboard, not code), because static requests never reach the Worker; the Worker's own www check is only a fallback for `/api/*`. A daily cron cleans up expired rows.

**The app is never published here.** The build fails if `dist/app/` exists, the landing page never links to an app URL, and `site/_redirects` sends old `/app/…` links home. The landing page's main action is **Download** (the app repo's GitHub Releases).

## Layout

```
site/                 landing page, presets hub pages (presets/), _headers, _redirects, screenshots/
worker/               index.js (routing, www fallback, cron), api.js (routes), auth.js (magic link + sessions),
                      mail.js (Email Service / dev), preset.js (upload validation), util.js
migrations/           D1 schema, numbered; never edit one that has been applied
vendor/app/           files copied unchanged from the app repo; SOURCE.json = commit + hashes
tools/                build.js, serve.js (local site + API), d1-sqlite.js (D1 on node:sqlite),
                      app-source.js + sync-app.js + check-vendor.js (vendor/app/), check-docs.js
test/                 presets-hub.test.js (API end to end against SQLite), check-docs.test.js
docs/PRESETS.md       hub design, API, privacy, Cloudflare setup
.github/workflows/    ci.yml (tests, vendor check, build, docs rule), deploy.yml (push to main -> Cloudflare),
                      app-updates.yml (weekly: warn if the app changed a shared file)
```

## Commands

```sh
npm test                 # all tests (Node 24+: node:sqlite)
npm run dev              # build + serve site and API on http://localhost:8788 (in-memory DB)
npm run build            # dist/
npm run sync:app [-- <ref> | --from <checkout>] [--screenshots]   # refresh vendor/app/ from the app repo
npm run check:vendor [-- --upstream [ref]]                        # verify vendor/app/; compare with the app
npm run check:docs       # the documentation rule, against origin/main
npm run deploy           # build + D1 migrations + wrangler deploy (needs the setup in docs/PRESETS.md)
```

## Files shared with the app (`vendor/app/`)

- The list is `FILES` in `tools/app-source.js`: the preset code (`spark/messages.js` and its imports `codec.js` and `constants.js`, plus `effects.js`), the user guide and the icons. Keep it as short as possible.
- **Never edit vendored files.** Change them in the app repo, then `npm run sync:app`. `check-vendor` (in CI and deploy) fails on hand edits, and `app-updates.yml` warns weekly when the app has moved on.
- Syncing is a reviewed change like any other. After syncing, run `npm test` and `npm run dev`. The guide's header patch in `tools/build.js` fails loudly if the app changes that link.
- Screenshots in `site/screenshots/` come from the app's own screenshot tool (`npm run sync:app -- <ref> --screenshots`, which needs Playwright). Don't hand-edit them.

## Presets hub (details in `docs/PRESETS.md`)

- **Accounts:** browse and download need no account. Sharing uses an **email magic link**. The token travels in the URL fragment to `/presets/signin.html` and is redeemed by a POST, so mail scanners can't spend it. Sessions use `HttpOnly; Secure; SameSite=Lax` cookies, and tokens and session ids are stored only as SHA-256 hashes.
- **Uploads:** validated and **re-serialised** by `worker/preset.js` using the app's `presetToJson` and effects catalog. Uploaders must confirm the **CC0** dedication. The downloaded file is exactly what the app's **Import JSON…** reads, so keep that format.
- **Privacy:** public endpoints return display names, never emails. Keep it that way, and keep the landing page's privacy FAQ accurate.
- **Security:**
  - Writes must be same-origin `application/json` (the CSRF defence), so don't add CORS to write endpoints. Downloads allow `*`, so the apps can fetch presets.
  - Hub pages are plain DOM ES modules under a strict CSP (`site/_headers`): no inline script or style on `/presets/*`. Render user content with `textContent` only, never `innerHTML`.
  - `[hidden]` is forced to `display: none` in `presets.css`, because component rules set `display`.
- **Moderation:** 3 reports hide a preset; moderators (`ADMIN_EMAILS` secret) restore or delete it. Rate limits live in D1 (`rate_events`).
- **Email:** Cloudflare Email Service (`send_email` binding `EMAIL`) only; Resend and other providers aren't used. Dev mode (`DEV_SHOW_LINKS=1`) is local only, never in production. The call is `env.EMAIL.send({ to: '<address>', from: { email, name }, subject, text, html })`. Cloudflare's `EmailAddress` objects need both `email` and `name` as strings, so keep the recipient a plain address string; `to: [{ email }]` throws a `TypeError` (that broke the first live sign-in). The fake binding in `test/presets-hub.test.js` applies the same check. If a send throws, `mail.js` logs `Email Service send failed: …` (never the recipient) and sign-in answers 503, never a bare 500. Troubleshooting steps are in `docs/PRESETS.md#email`.
- **Schema changes** go in a **new** numbered migration. Deploys apply them before `wrangler deploy`.

## Landing page

- Its only JS is the inline back-to-top script (IntersectionObserver; without JS the button stays hidden). It uses the same dark palette as the app.
- Its actions are **Download** (the app's GitHub Releases), **Browse shared presets** and the yellow **Buy me a coffee** link (https://www.buymeacoffee.com/jerdog, a plain link, not BMC's embed script).
- The footer carries the copyright line (blueDog Consulting and Jeremy Meiss).
- Keep the copy honest:
  - Say what has actually been tested (a Spark 2) versus what follows the documented protocol.
  - Mark plans as plans (the iPad app).
  - Don't disparage the official app.
  - Keep the credits to Paul Hamshere's protocol work and Ignitron (see `NOTICE`).
- Check phone widths (320 and 390px) for horizontal overflow after layout changes.

## Verifying changes

- `npm test` must pass. API changes come with tests in `test/presets-hub.test.js`, which run the real Worker against SQLite.
- For UI changes, run `npm run dev` and go through the flow: sign in (the link appears on the page), upload a preset exported from the app, browse, search, download, and report. Check the browser console for CSP errors; `tools/serve.js` applies `site/_headers` locally.
- Nothing here runs against Cloudflare in CI before deploy. Say clearly what was only tested locally.

## Conventions

- No runtime dependencies and no framework: plain ES modules, DOM and Workers APIs. Wrangler is pinned in the scripts (`wrangler@4.156.0`) rather than installed.
- Formatting: 2-space indent, single quotes, semicolons, trailing commas, lines up to about 120 characters.
- Git: `main` is the primary branch. Keep commits focused, and explain *why* in the message.
