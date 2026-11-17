// "What's new" checks: builds a small throwaway git history shaped like this
// repository's (pull requests merged into staging, releases merged into main)
// and checks the notes .github/scripts/changelog.mjs builds from it.
//   node tests/changelog.test.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'scripts');
const dir = mkdtempSync(join(tmpdir(), 'tf-changelog-'));
const env = { ...process.env, TF_IMPROVED_PRS: '', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.com', MAIN_REF: 'main' };
const git = (...args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' }).trim();
const notes = (branch, extra = {}) => {
  git('checkout', '-q', branch);
  let version = 'dev';
  try {
    version = execFileSync('bash', [join(scripts, 'app-version.sh'), branch], { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    // no VERSION yet
  }
  return JSON.parse(execFileSync('node', [join(scripts, 'changelog.mjs'), branch], { cwd: dir, env: { ...env, APP_VERSION: version, ...extra }, encoding: 'utf8' }));
};
let n = 0;
let pr = 0;
const commit = (file = `f${++n}.txt`, text = String(n)) => {
  writeFileSync(join(dir, file), `${text}\n`);
  git('add', file);
  git('commit', '-q', '-m', `change ${n}`);
};
// A pull request merged the way GitHub does it: a merge commit whose subject
// names the branch and whose body starts with the pull request's title.
const pull = (branch, title, into = 'staging', file, text) => {
  git('checkout', '-q', '-B', branch, into);
  commit(file, text);
  git('checkout', '-q', into);
  git('merge', '-q', '--no-ff', '-m', `Merge pull request #${++pr} from owner/${branch}`, '-m', title, branch);
  return pr;
};
const release = () => {
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '-m', `Merge pull request #${++pr} from owner/staging`, '-m', 'Release: things', 'staging');
  git('checkout', '-q', 'staging');
  git('merge', '-q', '--no-ff', '-m', 'Sync main back into staging after release', 'main');
};

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a === b) pass++;
  else fail++;
  console.log(`  ${a === b ? 'ok   ' : 'FAIL '} ${name}${a === b ? '' : `\n          got  ${a}\n          want ${b}`}`);
};
const titles = (r) => r && { version: r.version, new: r.new.map((c) => c.title), fixed: r.fixed.map((c) => c.title) };
const improvedTitles = (r) => r && r.improved.map((c) => c.title);

try {
  git('init', '-q', '-b', 'main');
  commit();
  git('checkout', '-q', '-b', 'staging');

  console.log('Before versions');
  pull('feature/old', 'Something from before versions');
  release();
  check('releases from before VERSION existed are not listed', notes('main').releases, []);

  console.log('A release');
  pull('feature/version', 'Show the app version', 'staging', 'VERSION', '0.1.100');
  pull('feature/templates', 'Save and reuse workout templates');
  pull('fix/graph', 'Fix graph labels being cut off');
  pull('chore/ci', 'Speed up the checks');
  check('on staging, unreleased work is listed as coming next, with the next number', titles(notes('staging').upcoming), { version: '0.1.100-staging', new: ['Show the app version', 'Save and reuse workout templates'], fixed: ['Fix graph labels being cut off'] });
  release();
  const first = notes('main');
  check('features are New and fixes are Fixed, in the order they were merged; chores are left out', first.releases.map(titles), [{ version: '0.1.100', new: ['Show the app version', 'Save and reuse workout templates'], fixed: ['Fix graph labels being cut off'] }]);
  check('each note keeps its pull request number and the release its date', [first.releases[0].new[1].pr, /^\d{4}-\d{2}-\d{2}$/.test(first.releases[0].date)], [4, true]);
  check('nothing is coming next on main', first.upcoming, null);
  check('after the release, staging has nothing coming next', notes('staging').upcoming, null);

  console.log('Releases worth noting');
  pull('chore/workflow', 'Merge main back into staging automatically');
  release();
  check('a release with only behind-the-scenes changes is left out', notes('main').releases.map((r) => r.version), ['0.1.100']);
  pull('fix/scrub', 'Keep graphs still while scrubbing');
  release();
  check('the next release with something to say gets its own number', notes('main').releases.map((r) => r.version), ['0.1.102', '0.1.100']);

  console.log('Shortcuts to main');
  git('checkout', '-q', 'staging');
  git('checkout', '-q', '-b', 'feature/cardio');
  commit();
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '-m', `Merge pull request #${++pr} from owner/feature/cardio`, '-m', 'Log cardio', 'feature/cardio');
  git('checkout', '-q', 'staging');
  git('merge', '-q', '--no-ff', '-m', 'Sync main back into staging after release', 'main');
  git('merge', '-q', '--no-ff', '-m', `Merge pull request #${++pr} from owner/feature/cardio`, '-m', 'Log cardio', 'feature/cardio');
  pull('feature/calories', 'Estimate calories');
  release();
  const after = notes('main').releases.map(titles);
  check('work released straight to main is listed under that release', after[1], { version: '0.1.103', new: ['Log cardio'], fixed: [] });
  check('merging the same work into staging later does not list it again', after[0], { version: '0.1.104', new: ['Estimate calories'], fixed: [] });

  console.log('Improved');
  pull('improve/mint', 'Highlight selected options in mint');
  const oldStyle = pull('feature/old-style', 'Finish button matches Quick Start');
  pull('fix/gap', 'Close the gap at the top of History');
  check('improve/ branches are listed under Improved on staging, before the release', improvedTitles(notes('staging').upcoming), ['Highlight selected options in mint']);
  release();
  const r = notes('main').releases[0];
  check('a release lists New, Improved and Fixed separately', [titles(r).new, improvedTitles(r), titles(r).fixed], [['Finish button matches Quick Start'], ['Highlight selected options in mint'], ['Close the gap at the top of History']]);
  const moved = notes('main', { TF_IMPROVED_PRS: String(oldStyle) }).releases[0];
  check('a feature/ pull request on the Improved list moves from New to Improved', [titles(moved).new, improvedTitles(moved)], [[], ['Highlight selected options in mint', 'Finish button matches Quick Start']]);
  check('every release has an improved list, even when empty', notes('main').releases.every((x) => Array.isArray(x.improved)), true);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
