#!/usr/bin/env node
// Builds kindlingspark.app into dist/ (served by the Worker as static assets, see wrangler.jsonc):
//   /                  landing page and presets hub pages (site/)
//   /guide/            the app's user guide (vendor/app/guide/, synced from the app repo)
//   /icon.svg, /icons/ app icons (vendor/app/)
// The app itself is never published here: people install the desktop or Android app.
//
//   npm run build      # then: npm run dev  (site + presets API on http://localhost:8788)

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}dist`;
const app = `${root}vendor/app`;

rmSync(out, { recursive: true, force: true });
cpSync(`${root}site`, out, { recursive: true });
cpSync(`${app}/guide`, `${out}/guide`, { recursive: true });
cpSync(`${app}/icon.svg`, `${out}/icon.svg`);
cpSync(`${app}/icons`, `${out}/icons`, { recursive: true });

// The guide's header links "back to the app"; on the website it goes home instead.
const guide = `${out}/guide/index.html`;
const html = readFileSync(guide, 'utf8');
const patched = html.replace('<a class="back" href="../">Open the app →</a>', '<a class="back" href="../">← Home</a>');
if (patched === html) throw new Error('build: guide header link not found; update tools/build.js');
writeFileSync(guide, patched);

for (const f of ['index.html', 'guide/index.html', 'presets/index.html']) {
  if (!existsSync(`${out}/${f}`)) throw new Error(`build: missing ${f}`);
}
if (existsSync(`${out}/app`)) throw new Error('build: the app must not be published on the website');
console.log('build: dist/ = site/ + guide at /guide/ + icons');
