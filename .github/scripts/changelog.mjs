#!/usr/bin/env node
// Builds the "What's new" notes shown from the version line in Settings.
//
//   node .github/scripts/changelog.mjs main     > web/changelog.json
//   node .github/scripts/changelog.mjs staging  > web/changelog.json
//
// Nothing is written by hand. Every deploy of main is a release, numbered the
// same way as .github/scripts/app-version.sh. A release's notes are the titles
// of the pull requests it brought in, taken from their merge commits
// ("Merge pull request #66 from owner/feature/..." with the title below):
//   feature/... branches are listed under New, improve/... under Improved
//   (polish and style: a new look, clearer wording, things moved), fix/...
//   under Fixed.
// Everything else (chore/..., syncs between main and staging, the release pull
// requests themselves) is left out, and a release with nothing to list is
// left out too, so only releases worth noting appear.
//
// On staging, pull requests merged into staging but not yet released are
// listed first as the upcoming release.
//
// Needs the full history of main (actions/checkout with fetch-depth: 0).

import { execFileSync } from 'node:child_process';

const branch = process.argv[2];
if (branch !== 'main' && branch !== 'staging') {
  console.error('usage: changelog.mjs main|staging');
  process.exit(1);
}
const mainRef = branch === 'main' ? 'HEAD' : process.env.MAIN_REF || 'origin/main';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (...args) => {
  try {
    return git(...args);
  } catch {
    return null;
  }
};

const startOf = (ref) => { // VERSION as of a commit, or null before there was one
  const v = tryGit('show', `${ref}:VERSION`);
  return v && /^\d+\.\d+\.\d+$/.test(v.trim()) ? v.trim() : null;
};
const releasedAs = (ref) => { // same as released() in app-version.sh
  const start = startOf(ref);
  if (!start) return null;
  const base = git('log', '--first-parent', '-1', '--format=%H', ref, '--', 'VERSION');
  const count = Number(git('rev-list', '--count', '--first-parent', `${base}..${ref}`));
  const [major, minor, patch] = start.split('.').map(Number);
  return `${major}.${minor}.${patch + count}`;
};

// Pull requests merged in a range, oldest first. The same work can be merged
// twice (straight to main, then into staging too); both merges bring in the
// same branch tip, so it is listed once, under the release that shipped it first.
const MERGE = /^Merge pull request #(\d+) from [^/\s]+\/(feature|improve|fix)\/\S+$/;
// Pull requests merged from feature/ branches before improve/ existed that are
// really polish, so they are listed under Improved. Merge commits can't be
// renamed, so this list does it. TF_IMPROVED_PRS (comma-separated) replaces it.
const IMPROVED_PRS = new Set((process.env.TF_IMPROVED_PRS ?? '5,105,108,109,116,139,151,165,180,182,183,185,190,203,204,205')
  .split(',').map((s) => Number(s.trim())).filter(Boolean));
const SECTION = { feature: 'new', improve: 'improved', fix: 'fixed' };
const seen = new Set();
const any = (c) => c.new.length || c.improved.length || c.fixed.length;
const changesIn = (range) => {
  const out = { new: [], improved: [], fixed: [] };
  const log = tryGit('log', '--merges', '--reverse', '--format=%P%x1f%s%x1f%b%x1e', range) || '';
  for (const entry of log.split('\x1e')) {
    const [parents = '', subject = '', body = ''] = entry.trim().split('\x1f');
    const m = MERGE.exec(subject.trim());
    const tip = parents.trim().split(' ')[1];
    if (!m || !tip || seen.has(tip)) continue;
    seen.add(tip);
    const title = body.split('\n').map((l) => l.trim()).find(Boolean);
    if (!title) continue;
    const pr = Number(m[1]);
    const section = m[2] === 'feature' && IMPROVED_PRS.has(pr) ? 'improved' : SECTION[m[2]];
    out[section].push({ title, pr });
  }
  return out;
};

const releases = [];
const line = (tryGit('rev-list', '--first-parent', '--reverse', mainRef) || '').split('\n').filter(Boolean);
for (let i = 0; i < line.length; i++) {
  const sha = line[i];
  const prev = i > 0 ? line[i - 1] : null;
  const changes = changesIn(prev ? `${prev}..${sha}` : sha); // also for early releases, so their work counts as shipped
  const version = releasedAs(sha);
  if (!version) continue; // released before versions existed
  if (!any(changes)) continue;
  releases.push({ version, date: git('show', '-s', '--format=%cs', sha), ...changes });
}
releases.reverse();

let upcoming = null;
if (branch === 'staging') {
  const changes = changesIn(`${mainRef}..HEAD`);
  if (any(changes)) upcoming = { version: process.env.APP_VERSION || 'next', ...changes };
}

process.stdout.write(`${JSON.stringify({ upcoming, releases }, null, 1)}\n`);
