import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDocs, findOptOut } from '../tools/check-docs.js';

test('content-only changes pass without docs', () => {
  assert.equal(checkDocs(['site/index.html', 'site/site.css', 'site/presets/presets.css', 'vendor/app/guide/index.html', 'test/presets-hub.test.js']).ok, true);
});

test('material change needs both AGENTS.md and a doc', () => {
  const code = 'worker/api.js';
  assert.deepEqual(checkDocs([code]).missing, ['AGENTS.md', 'README.md or docs/*.md']);
  assert.deepEqual(checkDocs([code, 'docs/PRESETS.md']).missing, ['AGENTS.md']);
  assert.deepEqual(checkDocs([code, 'AGENTS.md']).missing, ['README.md or docs/*.md']);
  assert.equal(checkDocs([code, 'AGENTS.md', 'README.md']).ok, true);
});

test('API, schema, config, tools and CI count as material', () => {
  for (const f of ['worker/auth.js', 'migrations/0002_x.sql', 'site/presets/presets.js', 'site/_headers', 'tools/build.js', 'wrangler.jsonc', 'package.json', '.github/workflows/deploy.yml']) {
    assert.equal(checkDocs([f]).ok, false, f);
  }
});

test('opt-out trailer skips the check', () => {
  const reason = findOptOut('Fix typo\n\nDocs-Not-Needed: wording only\n');
  assert.equal(reason, 'wording only');
  assert.equal(checkDocs(['worker/api.js'], { optOut: reason }).skipped, 'wording only');
  assert.equal(findOptOut('Normal commit\n\nCo-Authored-By: x'), undefined);
});
