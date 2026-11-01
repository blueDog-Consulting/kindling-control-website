// Where the website's shared files come from: the KindlingControl app repository.
// Used by tools/sync-app.js (copy them in) and tools/check-vendor.js (verify them).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const APP_REPO = 'https://github.com/bluedog-consulting/kindling-control-spark-amps';

/** App repo path -> path under vendor/app/. Keep this list as short as possible. */
export const FILES = {
  'src/spark/messages.js': 'spark/messages.js', // preset JSON format (presetToJson / presetFromJson)
  'src/spark/codec.js': 'spark/codec.js', // imported by messages.js
  'src/spark/constants.js': 'spark/constants.js', // imported by messages.js and codec.js
  'src/spark/effects.js': 'spark/effects.js', // effect catalog: model names and signal-chain slots
  'src/guide/index.html': 'guide/index.html', // the user guide, served at /guide/
  'src/guide/guide.css': 'guide/guide.css',
  'src/icon.svg': 'icon.svg',
  'src/icons/apple-touch-icon.png': 'icons/apple-touch-icon.png',
};

export const VENDOR_DIR = new URL('../vendor/app/', import.meta.url);
export const SOURCE_FILE = new URL('SOURCE.json', VENDOR_DIR);

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Shallow-fetches `ref` (branch, tag or commit) of the app repo into a temp dir. */
export function fetchApp(ref = 'main', repo = APP_REPO) {
  const dir = mkdtempSync(join(tmpdir(), 'kindling-app-'));
  try {
    git(dir, 'init', '-q');
    git(dir, 'remote', 'add', 'origin', repo);
    git(dir, 'fetch', '-q', '--depth', '1', 'origin', ref);
    git(dir, 'checkout', '-q', 'FETCH_HEAD');
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`could not fetch ${ref} from ${repo}: ${err.stderr || err.message}`);
  }
  return { dir, commit: git(dir, 'rev-parse', 'HEAD'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function readSource() {
  return JSON.parse(readFileSync(SOURCE_FILE, 'utf8'));
}
