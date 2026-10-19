// scripts/lineage/upgrade.js
// The monthly upgrade of the upstream kits Wheelhouse pins (design section 14.4): is a
// release due, what did it change, do the register's anchors and carried text still
// hold, and which assumptions need a second look. `land` writes the new pins on a new
// branch of Wheelhouse's own repository, for a pull request; it never pushes.
//   node scripts/lineage/upgrade.js due --published <time> [--last <time>] [--security]
//   node scripts/lineage/upgrade.js plan --to <upstream>=<tag>[@<sha>] ... [--changelog <file>]
//   node scripts/lineage/upgrade.js land --to <upstream>=<tag>[@<sha>] ... [--changelog <file>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UPGRADE } from '../lib/build-loop.js';
import { run as defaultRun, withoutGitVars } from '../lib/run.js';
import { fingerprintFile, fingerprintTree } from './fingerprint.js';
import { MANIFEST_PATH, MARKETPLACE_PATH, buildManifest, fetchUpstream, readManifest } from './manifest.js';
import { REGISTER_PATH, checkAnchors, checkCarried, readRegister } from './register.js';
import { startedAsScript } from '../lib/started-as-script.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const SOURCE_PATH = 'scripts/lineage/manifest.js';
// The files an upgrade changes, all in Wheelhouse's own repository.
export const LANDED_FILES = Object.freeze([MARKETPLACE_PATH, MANIFEST_PATH, REGISTER_PATH, SOURCE_PATH]);

const repoRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// --- Waiting (step 1) ---

const time = (value) => Date.parse(value instanceof Date ? value.toISOString() : value);

// Whether a release is due for the monthly upgrade. `lastUpgrade` is the time of the last
// upgrade (null when there has not been one), `now` and the times are UTC ISO 8601. A release
// is due when it has been out at least UPGRADE.minAgeDays and the last upgrade was at least
// UPGRADE.everyDays ago; a security fix is due at once. `why` is always one of a few set phrases.
export function upgradeDue({ lastUpgrade = null, release, now, security = false } = {}) {
  if (security === true) return { due: true, why: 'a security fix comes at once' };
  const current = time(now);
  const published = time(release?.publishedAt);
  const last = lastUpgrade === null || lastUpgrade === undefined ? null : time(lastUpgrade);
  if (!Number.isFinite(current) || !Number.isFinite(published) || (last !== null && !Number.isFinite(last))) {
    return { due: false, why: 'a time could not be read' };
  }
  if (current - published < UPGRADE.minAgeDays * DAY_MS) return { due: false, why: `the release is under ${UPGRADE.minAgeDays} days old` };
  if (last !== null && current - last < UPGRADE.everyDays * DAY_MS) return { due: false, why: `the last upgrade was under ${UPGRADE.everyDays} days ago` };
  return { due: true, why: `the release is at least ${UPGRADE.minAgeDays} days old and the last upgrade was at least ${UPGRADE.everyDays} days ago` };
}

// --- Sorting and testing (steps 2 and 3, the deterministic part) ---

// A licence file is named LICENSE, LICENCE or COPYING, in any case, with or without an extension.
export const isLicenceFile = (relative) => /^(licen[cs]e|copying)(\.[a-z0-9]+)?$/i.test(String(relative).split('/').pop());

// The fingerprint of `relative` under `dir` (a folder or a file), or null when it is not there.
// A candidate is untrusted: a path that leaves the folder, or passes through a link, is not there.
function hashIn(dir, relative, hasher) {
  const parts = relative.split('/');
  if (relative === '' || path.isAbsolute(relative) || parts.includes('..')) return null;
  try {
    let at = dir;
    for (const part of parts) {
      at = path.join(at, part);
      if (fs.lstatSync(at).isSymbolicLink()) return null;
    }
    return hasher(at).hash;
  } catch {
    return null;
  }
}

// Sorts an upgrade. `candidates` maps an upstream's name to { dir, ref, sha }, a copy of its
// new release; an upstream with no candidate stays as it is.
//   plumbing  no folder or file the manifest lists has changed: only the pins move
//   changed   something listed changed, a licence file included: the changed files go to the reviewer
//   stopped   an anchor sentence is gone, or carried text's source changed: nothing lands
// `licenceChanged` is true when a licence file among the manifest's listed files changed or went; the card comes
// for it, so it makes the upgrade `changed`, never `plumbing`. `retest` lists the assumptions whose
// `feature` any `changelog` line mentions, case-insensitively.
export function planUpgrade({ manifest, register, candidates, changelog = [] }) {
  const known = new Set(manifest.upstreams.map((u) => u.name));
  for (const name of Object.keys(candidates)) if (!known.has(name)) throw new Error(`${name} is not an upstream in the manifest`);
  const changed = [];
  let licenceChanged = false;
  const roots = {};
  for (const upstream of manifest.upstreams) {
    const candidate = candidates[upstream.name];
    if (!candidate) continue;
    roots[upstream.name] = candidate.dir;
    for (const [list, hasher] of [[upstream.folders, fingerprintTree], [upstream.files, fingerprintFile]]) {
      for (const { path: relative, hash } of list) {
        if (hashIn(candidate.dir, relative, hasher) === hash) continue;
        changed.push({ upstream: upstream.name, path: relative });
        if (list === upstream.files && isLicenceFile(relative)) licenceChanged = true;
      }
    }
  }
  const broken = checkAnchors({ register, roots });
  const carriedChanged = checkCarried({ register, roots });
  const lines = changelog.map((line) => String(line).toLowerCase());
  const retest = register.assumptions
    .filter((assumption) => lines.some((line) => line.includes(assumption.feature.toLowerCase())))
    .map((assumption) => assumption.id);
  let kind = 'changed';
  if (broken.length > 0 || carriedChanged.length > 0) kind = 'stopped';
  else if (changed.length === 0) kind = 'plumbing';
  return { kind, changed, broken, carriedChanged, licenceChanged, retest };
}

// --- Resolving and fetching the candidates ---

// The `--to` words: ['superpowers=v7.1.0', 'mattpocock-skills=v1.4.0@<sha>'] as
// [{ name, tag, sha }]. A tag is plain, so it can't pass for an option or leave a branch name.
export function parseTo(words) {
  if (!Array.isArray(words) || words.length === 0) throw new Error('give at least one --to <upstream>=<tag>');
  const seen = new Set();
  return words.map((word) => {
    const match = /^([a-z0-9][a-z0-9-]*)=([A-Za-z0-9][A-Za-z0-9._-]*)(?:@([0-9a-f]{40}))?$/.exec(word);
    if (!match) throw new Error(`"${word}" isn't --to <upstream>=<tag>[@<sha>]`);
    if (seen.has(match[1])) throw new Error(`${match[1]} is given twice`);
    seen.add(match[1]);
    return { name: match[1], tag: match[2], sha: match[3] ?? null };
  });
}

// The commit a tag of an upstream's repository points at, by `git ls-remote` through `run`.
// An annotated tag gives its commit, not the tag object's own id.
export async function resolveTag(upstream, tag, { run = defaultRun } = {}) {
  const result = await run('git', ['ls-remote', '--tags', upstream.repo, `refs/tags/${tag}`, `refs/tags/${tag}^{}`], {
    baseEnv: withoutGitVars(), env: { GIT_TERMINAL_PROMPT: '0' }, timeoutMs: 120000,
  });
  if (result.code !== 0) throw new Error(`${upstream.name}: git ls-remote failed: ${result.stderr.trim().split('\n').pop()}`);
  const found = {};
  for (const line of result.stdout.split('\n')) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (/^[0-9a-f]{40}$/.test(sha ?? '')) found[ref] = sha;
  }
  const sha = found[`refs/tags/${tag}^{}`] ?? found[`refs/tags/${tag}`];
  if (!sha) throw new Error(`${upstream.name} has no tag ${tag}`);
  return sha;
}

// One pin for each `--to` entry: { name, plugin, repo, ref, sha }. A sha given with the tag must be
// the one the tag points at now.
export async function resolvePins({ manifest, to, run = defaultRun }) {
  const pins = [];
  for (const entry of parseTo(to)) {
    const upstream = manifest.upstreams.find((u) => u.name === entry.name);
    if (!upstream) throw new Error(`${entry.name} is not an upstream in the manifest`);
    const sha = await resolveTag(upstream, entry.tag, { run });
    if (entry.sha !== null && entry.sha !== sha) throw new Error(`${entry.name} ${entry.tag} now points at ${sha}, not ${entry.sha}`);
    pins.push({ name: upstream.name, plugin: upstream.plugin, repo: upstream.repo, ref: entry.tag, sha });
  }
  return pins;
}

// Fetches each pin into its own new, empty temporary folder, runs `work(candidates)` and removes
// the folders after, whatever happens. `fetchTo(pin, dir)` is manifest.js's shallow fetch by default.
export async function withCandidates(pins, fetchTo, work) {
  const made = [];
  try {
    const candidates = {};
    for (const pin of pins) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wh-upgrade-${pin.name}-`));
      made.push(dir);
      await fetchTo(pin, dir);
      candidates[pin.name] = { dir, ref: pin.ref, sha: pin.sha };
    }
    return await work(candidates);
  } finally {
    for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Fetches the candidates and plans the upgrade from the manifest and register under `root`.
export async function planFromPins({ root = repoRoot(), pins, changelog = [], fetchTo = fetchUpstream }) {
  const manifest = readManifest(root);
  const register = readRegister(root);
  return withCandidates(pins, fetchTo, (candidates) => planUpgrade({ manifest, register, candidates, changelog }));
}

// --- Landing (step 5) ---

// The register's version with its patch number raised by one.
export function nextRegisterVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`the register's version "${version}" isn't major.minor.patch`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// manifest.js names the pins it checks the manifest against; this moves one upstream's to the new tag.
export function repinSource(source, pin) {
  const pattern = new RegExp(`(name: '${escapeRegExp(pin.name)}',\\s+plugin: '[^']*',\\s+repo: '[^']*',\\s+ref: ')[^']*(',\\s+sha: ')[0-9a-f]{40}(')`, 'g');
  if ([...source.matchAll(pattern)].length !== 1) throw new Error(`${SOURCE_PATH} doesn't name ${pin.name}'s pins once, in the form expected`);
  return source.replace(pattern, (_all, before, middle, after) => `${before}${pin.ref}${middle}${pin.sha}${after}`);
}

// The marketplace file's text with each pinned plugin's `ref` and `sha` moved.
export function repinMarketplace(text, pins) {
  const marketplace = JSON.parse(text);
  for (const pin of pins) {
    const source = (marketplace.plugins ?? []).find((p) => p?.name === pin.plugin)?.source;
    if (!isObject(source) || source.source !== 'url' || source.url !== pin.repo) throw new Error(`${MARKETPLACE_PATH} doesn't pin ${pin.plugin} from ${pin.repo}`);
    source.ref = pin.ref;
    source.sha = pin.sha;
  }
  return `${JSON.stringify(marketplace, null, 2)}\n`;
}

// The register file's text with its top-level version replaced; every other byte stays.
export function setRegisterVersion(text, version) {
  const changed = text.replace(/^(  "version": ")[^"]*(")/m, (_all, before, after) => `${before}${version}${after}`);
  if (JSON.parse(changed).version !== version) throw new Error(`${REGISTER_PATH}'s version couldn't be set`);
  return changed;
}

// The manifest with each pinned upstream fingerprinted afresh from its candidate copy; the others,
// the Wheelhouse version, the Claude Code floor and the models stay as they were.
export function movedManifest({ manifest, pins, candidates }) {
  const moved = buildManifest({
    roots: Object.fromEntries(pins.map((pin) => [pin.name, candidates[pin.name].dir])),
    version: manifest.wheelhouse.version,
    upstreams: pins.map((pin) => {
      const upstream = manifest.upstreams.find((u) => u.name === pin.name);
      return { ...upstream, ref: pin.ref, sha: pin.sha, folders: upstream.folders.map((f) => f.path), files: upstream.files.map((f) => f.path) };
    }),
  });
  return { ...manifest, upstreams: manifest.upstreams.map((u) => moved.upstreams.find((m) => m.name === u.name) ?? u) };
}

// Each reason a plan is stopped, one line each: an anchor sentence that has gone, or carried
// text whose source changed.
export function stopReasons(plan) {
  return [
    ...plan.broken.map((a) => `anchor gone: ${a.id}: ${a.file}: ${a.text}`),
    ...plan.carriedChanged.map((id) => `carried text's source changed: ${id}`),
  ];
}

// The refusal of a stopped upgrade. Its message names each broken override and anchor, and it
// carries the plan and the pins, so the command can say the whole plan.
export class UpgradeStopped extends Error {
  constructor(plan, pins) {
    super(`the upgrade is stopped, so nothing lands: ${stopReasons(plan).join('; ')}. Rewrite or drop the broken override first`);
    this.plan = plan;
    this.pins = pins;
  }
}

// Plans the upgrade and, unless it is stopped, writes the new pins, manifest and register version
// on a new branch of the repository at `root` and commits them. It never pushes: the branch goes
// out as a pull request, by hand. The working tree must be clean, and nothing changes if the plan
// is stopped (UpgradeStopped, naming what broke) or anything fails. Resolves with { plan, branch, commit }.
export async function land({ root = repoRoot(), pins, changelog = [], fetchTo = fetchUpstream, run = defaultRun, registerVersion } = {}) {
  const git = async (...args) => {
    const result = await run('git', args, { cwd: root, baseEnv: withoutGitVars(), env: { GIT_TERMINAL_PROMPT: '0' }, timeoutMs: 120000 });
    if (result.code !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim().split('\n').pop()}`);
    return result.stdout.trim();
  };
  const manifest = readManifest(root);
  const register = readRegister(root);
  const read = (relative) => fs.readFileSync(path.join(root, ...relative.split('/')), 'utf8');
  const write = (relative, text) => fs.writeFileSync(path.join(root, ...relative.split('/')), text);
  if (await git('status', '--porcelain') !== '') throw new Error('the working tree has changes: land from a clean copy');
  const branch = `upgrade/${pins.map((pin) => `${pin.name}-${pin.ref}`).join('_')}`;
  await git('check-ref-format', '--branch', branch);
  const taken = await run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: root, baseEnv: withoutGitVars() });
  if (taken.code === 0) throw new Error(`the branch ${branch} already exists`);

  return withCandidates(pins, fetchTo, async (candidates) => {
    const plan = planUpgrade({ manifest, register, candidates, changelog });
    if (plan.kind === 'stopped') throw new UpgradeStopped(plan, pins);
    const files = {
      [MARKETPLACE_PATH]: repinMarketplace(read(MARKETPLACE_PATH), pins),
      [MANIFEST_PATH]: `${JSON.stringify(movedManifest({ manifest, pins, candidates }), null, 2)}\n`,
      [REGISTER_PATH]: setRegisterVersion(read(REGISTER_PATH), registerVersion ?? nextRegisterVersion(register.version)),
      [SOURCE_PATH]: pins.reduce((source, pin) => repinSource(source, pin), read(SOURCE_PATH)),
    };
    const before = await git('rev-parse', '--abbrev-ref', 'HEAD');
    const origin = before === 'HEAD' ? await git('rev-parse', 'HEAD') : before;
    await git('switch', '-c', branch);
    try {
      for (const [relative, text] of Object.entries(files)) write(relative, text);
      await git('add', '--', ...LANDED_FILES);
      await git('commit', '--quiet', '-m', `Move the upstream pins: ${pins.map((pin) => `${pin.name} to ${pin.ref}`).join(', ')}`);
    } catch (error) {
      await run('git', ['reset', '--hard', '--quiet'], { cwd: root, baseEnv: withoutGitVars() });
      await run('git', ['switch', '--quiet', '--detach', origin], { cwd: root, baseEnv: withoutGitVars() });
      await run('git', ['branch', '-D', '--quiet', branch], { cwd: root, baseEnv: withoutGitVars() });
      if (before !== 'HEAD') await run('git', ['switch', '--quiet', before], { cwd: root, baseEnv: withoutGitVars() });
      throw error;
    }
    return { plan, branch, commit: await git('rev-parse', 'HEAD') };
  });
}

// --- Command line ---

// The words of a plan, one line each, for the person doing the release work.
export function describePlan({ plan, pins, assumptions = [] }) {
  const lines = [];
  for (const pin of pins) lines.push(`${pin.name}: ${pin.ref} (${pin.sha})`);
  for (const item of plan.changed) lines.push(`changed: ${item.upstream} ${item.path}`);
  lines.push(...stopReasons(plan));
  if (plan.licenceChanged) lines.push('a licence file changed: the director gets a card');
  for (const id of plan.retest) {
    const assumption = assumptions.find((a) => a.id === id);
    lines.push(`re-test: ${id}${assumption ? ` (${assumption.retest === 'person' ? 'needs a person' : 'a script can re-test it'}): ${assumption.says}` : ''}`);
  }
  lines.push({
    plumbing: 'upgrade is plumbing: only the pins move; the release notes say "pins only"',
    changed: 'upgrade changed files: the independent reviewer reads them as untrusted text, then the evaluation scenarios run',
    stopped: 'upgrade stopped: an override or carried text breaks; rewrite or drop it before the upgrade goes on',
  }[plan.kind]);
  return lines;
}

const USAGE = [
  'usage: node scripts/lineage/upgrade.js due --published <time> [--last <time>] [--security]',
  '       node scripts/lineage/upgrade.js plan --to <upstream>=<tag>[@<sha>] ... [--changelog <file>]',
  '       node scripts/lineage/upgrade.js land --to <upstream>=<tag>[@<sha>] ... [--changelog <file>]',
  '',
].join('\n');

// { to: [...], changelog, published, last, security } from the words after the command.
function parseOptions(words) {
  const options = { to: [], changelog: null, published: null, last: null, security: false };
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const value = () => {
      i += 1;
      if (i >= words.length) throw new Error(USAGE);
      return words[i];
    };
    if (word === '--to') options.to.push(value());
    else if (word === '--changelog') options.changelog = value();
    else if (word === '--published') options.published = value();
    else if (word === '--last') options.last = value();
    else if (word === '--security') options.security = true;
    else throw new Error(USAGE);
  }
  return options;
}

if (startedAsScript(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const out = (line) => process.stdout.write(`${line}\n`);
  try {
    if (!['due', 'plan', 'land'].includes(command)) throw new Error(USAGE);
    const options = parseOptions(rest);
    if (command === 'due') {
      if (options.published === null) throw new Error(USAGE);
      const result = upgradeDue({ lastUpgrade: options.last, release: { publishedAt: options.published }, now: new Date().toISOString(), security: options.security });
      out(`${result.due ? 'due' : 'not due'}: ${result.why}`);
      process.exitCode = result.due ? 0 : 1;
    } else {
      const root = repoRoot();
      const manifest = readManifest(root);
      const assumptions = readRegister(root).assumptions;
      const changelog = options.changelog === null ? [] : fs.readFileSync(options.changelog, 'utf8').split(/\r?\n/).filter((line) => line.trim() !== '');
      const pins = await resolvePins({ manifest, to: options.to });
      const result = command === 'plan'
        ? { plan: await planFromPins({ root, pins, changelog }) }
        : await land({ root, pins, changelog });
      for (const line of describePlan({ plan: result.plan, pins, assumptions })) out(line);
      if (command === 'land') out(`landed on branch ${result.branch} (${result.commit}); nothing was pushed: open a pull request from it`);
      process.exitCode = result.plan.kind === 'stopped' ? 1 : 0;
    }
  } catch (error) {
    // A stopped land says its whole plan first, as `plan` would.
    if (error instanceof UpgradeStopped) for (const line of describePlan({ plan: error.plan, pins: error.pins })) out(line);
    process.stderr.write(`${error.message.replace(/\n$/, '')}\n`);
    process.exit(command === 'land' ? 1 : 2);
  }
}
