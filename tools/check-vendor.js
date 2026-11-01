#!/usr/bin/env node
// Checks the files shared with the app (vendor/app/, see tools/app-source.js).
//
//   npm run check:vendor                      # every vendored file matches SOURCE.json (nobody hand-edited it)
//   npm run check:vendor -- --upstream [ref]  # also report files that changed in the app repo since the
//                                             # last sync (default ref: main). Warns; --strict makes it fail.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILES, VENDOR_DIR, fetchApp, readSource, sha256 } from './app-source.js';

const args = process.argv.slice(2);
const upstream = args.includes('--upstream');
const strict = args.includes('--strict');
const ref = args.find((a) => !a.startsWith('--')) || 'main';
const inCI = !!process.env.GITHUB_ACTIONS;
const vendor = fileURLToPath(VENDOR_DIR);

const source = readSource();
const problems = [];
for (const dest of Object.values(FILES)) {
  const file = join(vendor, dest);
  if (!existsSync(file)) problems.push(`missing vendor/app/${dest}`);
  else if (sha256(readFileSync(file)) !== source.files[dest]) problems.push(`vendor/app/${dest} was edited by hand (run npm run sync:app instead)`);
}
for (const dest of Object.keys(source.files)) if (!Object.values(FILES).includes(dest)) problems.push(`SOURCE.json lists unknown file ${dest}`);
if (problems.length) {
  for (const p of problems) console.error(inCI ? `::error::${p}` : `check-vendor: ${p}`);
  process.exit(1);
}
console.log(`check-vendor: vendor/app/ matches app commit ${source.commit.slice(0, 12)} ✓`);

if (upstream) {
  const app = fetchApp(ref);
  try {
    const changed = Object.entries(FILES)
      .filter(([src, dest]) => sha256(readFileSync(join(app.dir, src))) !== source.files[dest])
      .map(([src]) => src);
    if (!changed.length) console.log(`check-vendor: up to date with app ${ref} (${app.commit.slice(0, 12)}) ✓`);
    else {
      const msg = `app ${ref} (${app.commit.slice(0, 12)}) has changes the website hasn't picked up: ${changed.join(', ')}. Run: npm run sync:app -- ${ref}`;
      console.log(inCI ? `::warning::${msg}` : `check-vendor: ${msg}`);
      if (strict) process.exitCode = 1;
    }
  } finally {
    app.cleanup();
  }
}
