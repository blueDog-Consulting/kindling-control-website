#!/usr/bin/env node
// Copies the files the website shares with the app (protocol code for checking
// preset uploads, the user guide, icons) from the KindlingControl app repo into
// vendor/app/, and records exactly where they came from in vendor/app/SOURCE.json.
//
//   npm run sync:app                                   # the app repo's main branch
//   npm run sync:app -- v0.3.0                         # a tag, branch or commit
//   npm run sync:app -- --from ../kindling-control-spark-amps   # a local checkout (its HEAD; must be clean)
//   add --screenshots to also re-capture site/screenshots/ with the app's own
//   screenshot tool (needs Playwright: npm i --no-save playwright && npx playwright install chromium)
//
// Never edit files in vendor/app/ by hand: change them in the app repo and sync.

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_REPO, FILES, SOURCE_FILE, VENDOR_DIR, fetchApp, git, sha256 } from './app-source.js';

let from;
let screenshots = false;
let ref = 'main';
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--from') from = args[++i];
  else if (args[i] === '--screenshots') screenshots = true;
  else ref = args[i];
}

let app;
if (from) {
  const dir = resolve(from);
  const dirty = git(dir, 'status', '--porcelain', '--', ...Object.keys(FILES));
  if (dirty) throw new Error(`sync-app: ${dir} has uncommitted changes to shared files:\n${dirty}`);
  app = { dir, commit: git(dir, 'rev-parse', 'HEAD'), cleanup() {} };
} else {
  app = fetchApp(ref);
}

try {
  const vendor = fileURLToPath(VENDOR_DIR);
  const files = {};
  for (const [src, dest] of Object.entries(FILES)) {
    const out = join(vendor, dest);
    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(join(app.dir, src), out);
    files[dest] = sha256(readFileSync(out));
  }
  const source = { repo: APP_REPO, ref: from ? 'local checkout' : ref, commit: app.commit, files };
  writeFileSync(SOURCE_FILE, `${JSON.stringify(source, null, 2)}\n`);
  console.log(`sync-app: vendor/app/ now matches ${APP_REPO} @ ${app.commit.slice(0, 12)} (${Object.keys(files).length} files)`);

  if (screenshots) {
    const out = fileURLToPath(new URL('../site/screenshots/', import.meta.url));
    execFileSync(process.execPath, ['tools/screenshots.js', '--out', out], { cwd: app.dir, stdio: 'inherit' });
  }
} finally {
  app.cleanup();
}
