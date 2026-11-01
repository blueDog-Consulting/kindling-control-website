<p align="center"><img src="vendor/app/icons/apple-touch-icon.png" width="96" height="96" alt="KindlingControl logo: a guitar pick holding a flame over kindling"></p>

# KindlingControl website

[![CI](https://github.com/bluedog-consulting/kindling-control-website/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bluedog-consulting/kindling-control-website/actions/workflows/ci.yml)
[![Deploy](https://github.com/bluedog-consulting/kindling-control-website/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/bluedog-consulting/kindling-control-website/actions/workflows/deploy.yml)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](LICENSE)

The source of **[kindlingcontrol.app](https://kindlingcontrol.app)**, the home of [KindlingControl](https://github.com/bluedog-consulting/kindling-control-spark-amps), an open controller for Positive Grid Spark amps. The app lives in its own repository, so anyone can fork it without inheriting the website.

| Path | What |
|---|---|
| `/` | landing page: what the app does, screenshots, how to get it, credits |
| `/guide/` | the app's user guide |
| `/presets/` | **presets hub**: browse, search and download presets other players made; share yours after an email sign-in |
| `/api/` | the presets API |

It runs on **Cloudflare Workers** (static assets plus a small Worker) with a **D1** database. It has no runtime dependencies and no framework.

## Develop

Needs Node 24+.

```sh
npm test            # node:test: the presets API against SQLite, plus the docs check
npm run dev         # build dist/ and serve site + API on http://localhost:8788
                    #   in-memory database; sign-in links appear on the page; moderator: admin@localhost.test
npm run build       # just build dist/
```

## Layout

| Path | |
|---|---|
| `site/` | landing page (`index.html`, `site.css`, `screenshots/`), presets hub pages (`presets/`), `_headers` (CSP and other security headers), `_redirects` |
| `worker/` | the Worker: presets API (`api.js`), magic-link sign-in (`auth.js`), email (`mail.js`), upload checks (`preset.js`) |
| `migrations/` | D1 schema, applied in order |
| `vendor/app/` | files copied **unchanged** from the app repo (see below) |
| `tools/` | build, local server, D1 stand-in on `node:sqlite`, app sync, checks |
| `test/` | `node:test` suites |
| `docs/PRESETS.md` | how the hub works: API, sign-in, moderation, privacy, Cloudflare setup |

## Files shared with the app

The website needs a few things from the app: the preset code that checks uploads, the user guide, and the icons. They're copied into `vendor/app/`, and `vendor/app/SOURCE.json` records the exact app commit and a hash of each file. Never edit them here; change them in the app repo, then sync:

```sh
npm run sync:app                    # copy from the app's main branch
npm run sync:app -- v0.3.0          # …or a tag, branch or commit
npm run sync:app -- --from ../kindling-control-spark-amps   # …or a local checkout
npm run sync:app -- main --screenshots   # also re-capture site/screenshots/ with the app's screenshot tool (needs Playwright)
npm run check:vendor                # vendored files match SOURCE.json
npm run check:vendor -- --upstream  # …and report anything newer in the app repo
```

CI fails if a vendored file was edited by hand. A weekly workflow (`app-updates.yml`) warns when the app has changed a shared file since the last sync.

## Deploy

Pushes to `main` deploy through `.github/workflows/deploy.yml`: tests, then build, then D1 migrations, then `wrangler deploy`. `npm run deploy` does the same by hand. It needs a one-time Cloudflare setup (the domain, a D1 database, email for sign-in links, and secrets), described in [docs/PRESETS.md](docs/PRESETS.md#setting-up-cloudflare-once). Without the `CLOUDFLARE_API_TOKEN` secret, the workflow tests and builds but skips the deploy.

## Contributing

Read [AGENTS.md](AGENTS.md) first; it applies to people as well as AI agents. CI enforces one rule: **a change to how the site works must update the docs and `AGENTS.md` in the same change.**

## License

Copyright © 2026 blueDog Consulting and Jeremy Meiss. The KindlingControl website is designed, built and maintained by blueDog Consulting, and is free software under the [GNU General Public License v3.0 or later](LICENSE). Third-party notices are in [NOTICE](NOTICE). Presets shared on the hub are dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) by the people who share them.

This is an independent project. It is not affiliated with or endorsed by Positive Grid. "Spark" and "Positive Grid" are their trademarks.
