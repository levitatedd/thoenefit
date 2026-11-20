import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const readJson = (sha, path) => JSON.parse(git('show', `${sha}:${path}`));

export function checkGuideRevisionScope(base, head, slug) {
  if (![base, head].every((sha) => /^[0-9a-f]{40}$/.test(sha))) {
    throw new Error('Use full Git commit SHAs for base and head.');
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error('Invalid movement guide slug.');
  }

  const guide = `web/guides/${slug}.json`;
  const manifest = 'web/guides/renders.json';
  const { guides } = readJson(base, 'web/guides/index.json');
  if (!Object.hasOwn(guides, slug) || guides[slug] !== `${slug}.json`) {
    throw new Error('The exercise must already have a guide on the target branch.');
  }

  const entries = git('diff', '--raw', '-z', '--no-renames', '--no-abbrev', base, head, '--').split('\0');
  entries.pop();
  const changed = new Set();
  for (let i = 0; i < entries.length; i += 2) {
    const [oldMode, newMode] = entries[i].slice(1).split(' ');
    const path = entries[i + 1];
    const preview = path.startsWith(`docs/guides/${slug}/`)
      && /^[a-z0-9]+(?:-[a-z0-9]+)*\.svg$/.test(path.slice(`docs/guides/${slug}/`.length));
    if (!(path === guide || path === manifest || preview)) throw new Error(`Unexpected change: ${path}`);
    if (![oldMode, newMode].every((mode) => mode === '100644' || mode === '000000')) {
      throw new Error(`Only ordinary, non-executable files are allowed: ${path}`);
    }
    changed.add(path);
  }
  if (!changed.has(guide) || readJson(head, guide).exercise !== slug) {
    throw new Error('The revision must modify the existing guide for this exercise.');
  }

  if (changed.has(manifest)) {
    const before = readJson(base, manifest);
    const after = readJson(head, manifest);
    const hash = after.renders?.[slug];
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
      throw new Error('The guide render fingerprint is invalid.');
    }
    before.renders[slug] = hash;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error('Only the fingerprint for this exercise may change.');
    }
  }
  return [...changed];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const changed = checkGuideRevisionScope(...process.argv.slice(2));
    console.log(`Guide revision scope verified (${changed.length} files).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
