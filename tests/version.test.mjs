// Version number checks: builds a small throwaway git history shaped like this
// repository's (features merged into staging, releases merged into main) and
// checks the numbers .github/scripts/app-version.sh gives each deploy.
//   node tests/version.test.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'scripts', 'app-version.sh');
const dir = mkdtempSync(join(tmpdir(), 'tf-version-'));
const env = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.com', MAIN_REF: 'main' };
const git = (...args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' }).trim();
const version = (branch) => {
  git('checkout', '-q', branch);
  try {
    return execFileSync('bash', [script, branch], { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return `error: ${String(e.stderr).trim()}`;
  }
};
let n = 0;
const commit = (file = `f${++n}.txt`, text = String(n)) => {
  writeFileSync(join(dir, file), `${text}\n`);
  git('add', file);
  git('commit', '-q', '-m', `change ${n}`);
};
const feature = (name) => { // a feature branch merged into staging with a merge commit
  git('checkout', '-q', '-b', name, 'staging');
  commit();
  commit();
  git('checkout', '-q', 'staging');
  git('merge', '-q', '--no-ff', '-m', `merge ${name}`, name);
};
const release = () => { // staging merged into main with a merge commit, then main synced back
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '-m', 'release', 'staging');
  git('checkout', '-q', 'staging');
  git('merge', '-q', '--no-ff', '-m', 'sync main back', 'main');
};

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'ok   ' : 'FAIL '} ${name}${ok ? '' : `  (got ${got}, want ${want})`}`);
};

try {
  git('init', '-q', '-b', 'main');
  commit();
  commit();
  git('checkout', '-q', '-b', 'staging');

  console.log('First release with a version');
  git('checkout', '-q', '-b', 'feature/version', 'staging');
  commit('VERSION', '0.1.100');
  git('checkout', '-q', 'staging');
  git('merge', '-q', '--no-ff', '-m', 'merge version', 'feature/version');
  check('staging shows the first number before it is released', version('staging'), '0.1.100-staging');
  feature('feature/a'); // another feature rides along in the same release
  release();
  check('the release that adds VERSION is 0.1.100', version('main'), '0.1.100');
  check('staging then shows the next number', version('staging'), '0.1.101-staging');

  console.log('Later releases');
  feature('feature/b');
  feature('feature/c');
  check('staging still shows one more than main, however many features wait', version('staging'), '0.1.101-staging');
  release();
  check('a release with several features and many commits adds exactly one', version('main'), '0.1.101');
  check('redeploying the same commit gives the same number', version('main'), '0.1.101');
  git('checkout', '-q', 'main');
  commit('README.md', 'docs'); // a direct commit to main is deployed too, so it counts
  check('a direct commit to main counts as a deploy', version('main'), '0.1.102');
  git('checkout', '-q', 'staging');
  git('merge', '-q', '--no-ff', '-m', 'sync main back', 'main');
  feature('feature/d');
  release();
  check('releases keep counting up', version('main'), '0.1.103');

  console.log('Starting a new minor version');
  git('checkout', '-q', 'staging');
  commit('VERSION', '0.2.0');
  check('staging shows the new starting number', version('staging'), '0.2.0-staging');
  release();
  check('the release that changes VERSION starts the new count', version('main'), '0.2.0');
  feature('feature/e');
  release();
  check('the next release after that is .1', version('main'), '0.2.1');

  console.log('Bad input');
  git('checkout', '-q', 'staging');
  commit('VERSION', 'v0.3');
  check('a malformed VERSION stops the deploy', version('staging').startsWith('error: VERSION must look like 0.1.100'), true);
  git('checkout', '-q', '-b', 'feature/x', 'main');
  check('an unknown branch stops the deploy', version('feature/x').startsWith('error: Unknown branch'), true);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
