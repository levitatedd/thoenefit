import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./guide-revision-scope.mjs', import.meta.url));

test('the guide scope guard accepts the requested pose and rejects unrelated changes', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'guide-scope-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const run = (file, ...args) => execFileSync(file, args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  const git = (...args) => run('git', ...args);
  const write = (path, data) => {
    mkdirSync(join(cwd, dirname(path)), { recursive: true });
    writeFileSync(join(cwd, path), typeof data === 'string' ? data : JSON.stringify(data));
  };
  const commit = () => {
    git('add', '-A');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };

  const guide = 'web/guides/hammer-curl.json';
  const manifest = 'web/guides/renders.json';
  const before = { legacy: { 'hammer-curl': 'a'.repeat(64) }, renders: { 'hammer-curl': 'a'.repeat(64), 'deadlift': 'b'.repeat(64) } };
  git('init', '-q');
  write('web/guides/index.json', { guides: { 'hammer-curl': 'hammer-curl.json', 'deadlift': 'deadlift.json' } });
  write(guide, { exercise: 'hammer-curl', poses: [] });
  write(manifest, before);
  const base = commit();
  const verify = (head, slug = 'hammer-curl') => run(process.execPath, script, base, head, slug);
  write(guide, { exercise: 'hammer-curl', poses: ['setup'] });
  write('docs/guides/hammer-curl/setup.svg', '<svg/>');
  const after = structuredClone(before);
  after.renders['hammer-curl'] = 'c'.repeat(64);
  write(manifest, after);
  const valid = commit();
  assert.match(verify(valid), /verified \(3 files\)/);
  assert.throws(() => verify(valid, '../hammer-curl'), /Invalid movement guide slug/);
  assert.throws(() => verify(valid, 'not-in-index'), /already have a guide/);

  write('web/js/guides.js', '// unrelated');
  assert.throws(() => verify(commit()), /Unexpected change/);
  git('reset', '--hard', valid);
  after.renders.deadlift = 'd'.repeat(64);
  write(manifest, after);
  assert.throws(() => verify(commit()), /Only the fingerprint/);
  git('reset', '--hard', valid);
  symlinkSync('/tmp/sheet.svg', join(cwd, 'docs/guides/hammer-curl/sheet.svg'));
  assert.throws(() => verify(commit()), /ordinary, non-executable/);
});
