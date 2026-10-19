// tests/scripts/lineage/upgrade.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UPGRADE } from '../../../scripts/lib/build-loop.js';
import { run } from '../../../scripts/lib/run.js';
import { buildManifest } from '../../../scripts/lineage/manifest.js';
import { fingerprintFile } from '../../../scripts/lineage/fingerprint.js';
import {
  describePlan, isLicenceFile, land, nextRegisterVersion, parseTo, planFromPins, planUpgrade, resolvePins, resolveTag, upgradeDue,
} from '../../../scripts/lineage/upgrade.js';
import { g } from '../../helpers/git-fixture.js';
import { tempFolder } from '../../helpers/homes.js';
import { writeFiles } from '../../helpers/lineage.js';

const SCRIPT = fileURLToPath(new URL('../../../scripts/lineage/upgrade.js', import.meta.url));
const MANIFEST_SOURCE = fileURLToPath(new URL('../../../scripts/lineage/manifest.js', import.meta.url));
const OLD_SHA = 'a'.repeat(40);
const NEW_SHA = 'b'.repeat(40);
const KIT = {
  name: 'superpowers',
  plugin: 'superpowers',
  repo: 'https://example.invalid/superpowers.git',
  ref: 'v1.0.0',
  sha: OLD_SHA,
  folders: ['skills/brainstorming', 'skills/writing-plans'],
  files: ['LICENSE', 'hooks/session-start'],
};
const COPY = {
  'skills/brainstorming/SKILL.md': 'Ask one question at a time.\nWrite the spec to a file.\n',
  'skills/writing-plans/SKILL.md': 'Plans are small.\nlink it for your human partner\n',
  'skills/writing-plans/notes.md': 'carried line\n',
  LICENSE: 'Licence text\n',
  'hooks/session-start': 'echo start\n',
};
const iso = (days, from = '2026-10-01T00:00:00Z') => new Date(Date.parse(from) + days * 86400000).toISOString();

// The register: one override with an anchor, one carried text, three assumptions.
function registerFor(dir) {
  return {
    v: 1,
    version: '0.4.2',
    overrides: [{
      id: 'nothing-waits', upstream: 'superpowers', skill: 'writing-plans', rule: 'Nothing waits.', why: 'Because.', scenario: 32,
      anchors: [{ file: 'skills/writing-plans/SKILL.md', text: 'link it for your human partner' }],
    }],
    carried: [{
      id: 'carried-line', upstream: 'superpowers', file: 'skills/writing-plans/notes.md', text: 'carried line',
      hash: fingerprintFile(path.join(dir, 'skills', 'writing-plans', 'notes.md')).hash,
    }],
    assumptions: [
      { id: 'no-model-start', says: 'Claude cannot start a skill marked disable-model-invocation.', check: 6, retest: 'script', feature: 'disable-model-invocation' },
      { id: 'monitor-30-minutes', says: 'A Monitor-tool watch ends after 30 minutes.', check: 26, retest: 'person', feature: 'Monitor' },
      { id: 'hooks-run', says: 'Hooks run.', check: 3, retest: 'script', feature: 'SessionStart' },
    ],
  };
}

function current() {
  const dir = tempFolder('wh-current-');
  writeFiles(dir, COPY);
  return { dir, manifest: buildManifest({ roots: { superpowers: dir }, version: '1.2.3', upstreams: [KIT] }), register: registerFor(dir) };
}

// A candidate: the current copy with `files` laid over it and `removed` taken away.
function candidate(files = {}, removed = []) {
  const dir = tempFolder('wh-candidate-');
  writeFiles(dir, { ...COPY, ...files });
  for (const name of removed) fs.rmSync(path.join(dir, ...name.split('/')), { force: true });
  return { dir, ref: 'v1.1.0', sha: NEW_SHA };
}

// --- Waiting ---

test('a release under seven days old is not due; a security fix is', () => {
  assert.equal(UPGRADE.minAgeDays, 7);
  const release = { tag: 'v1.1.0', publishedAt: '2026-10-10T00:00:00Z' };
  const young = upgradeDue({ lastUpgrade: null, release, now: '2026-10-16T23:59:59Z' });
  assert.equal(young.due, false);
  assert.match(young.why, /under 7 days old/);
  assert.equal(upgradeDue({ lastUpgrade: null, release, now: '2026-10-17T00:00:00Z' }).due, true);
  const security = upgradeDue({ lastUpgrade: iso(-2), release, now: '2026-10-11T00:00:00Z', security: true });
  assert.deepEqual(security, { due: true, why: 'a security fix comes at once' });
});

test('an upgrade is not due until the monthly gap has passed, and the time passed in is the one used', () => {
  const release = { tag: 'v1.1.0', publishedAt: '2026-09-01T00:00:00Z' };
  const soon = upgradeDue({ lastUpgrade: '2026-10-01T00:00:00Z', release, now: '2026-10-30T23:59:59Z' });
  assert.equal(soon.due, false);
  assert.match(soon.why, /under 30 days ago/);
  assert.equal(upgradeDue({ lastUpgrade: '2026-10-01T00:00:00Z', release, now: '2026-10-31T00:00:00Z' }).due, true);
  assert.equal(upgradeDue({ lastUpgrade: null, release, now: '2026-10-02T00:00:00Z' }).due, true);
  assert.equal(upgradeDue({ lastUpgrade: null, release, now: '2026-09-07T23:59:59Z' }).due, false);
  assert.equal(upgradeDue({ lastUpgrade: null, release, now: '2026-09-08T00:00:00Z' }).due, true);
});

test('times that cannot be read are never due', () => {
  const result = upgradeDue({ lastUpgrade: 'soon', release: { tag: 'v1', publishedAt: '2026-01-01T00:00:00Z' }, now: '2026-10-01T00:00:00Z' });
  assert.deepEqual(result, { due: false, why: 'a time could not be read' });
  assert.equal(upgradeDue({ release: { tag: 'v1' }, now: '2026-10-01T00:00:00Z' }).due, false);
});

// --- Sorting and testing ---

test('an upgrade that changes no listed folder is plumbing', () => {
  const { manifest, register } = current();
  const same = candidate({ 'README.md': 'not listed, and changed\n', 'skills/other/SKILL.md': 'not listed\n' });
  const plan = planUpgrade({ manifest, register, candidates: { superpowers: same }, changelog: [] });
  assert.deepEqual(plan, { kind: 'plumbing', changed: [], broken: [], carriedChanged: [], licenceChanged: false, retest: [] });
});

test('line endings alone do not make an upgrade a change', () => {
  const { manifest, register } = current();
  const crlf = candidate(Object.fromEntries(Object.entries(COPY).map(([name, text]) => [name, text.replace(/\n/g, '\r\n')])));
  assert.equal(planUpgrade({ manifest, register, candidates: { superpowers: crlf } }).kind, 'plumbing');
});

test('a changed folder makes the upgrade "changed" and names the folder', () => {
  const { manifest, register } = current();
  const next = candidate({ 'skills/brainstorming/SKILL.md': 'Ask two questions at a time.\n' });
  const plan = planUpgrade({ manifest, register, candidates: { superpowers: next } });
  assert.equal(plan.kind, 'changed');
  assert.deepEqual(plan.changed, [{ upstream: 'superpowers', path: 'skills/brainstorming' }]);
  assert.equal(plan.licenceChanged, false);
});

test('an upgrade where an anchor sentence has gone stops before landing', () => {
  const { manifest, register } = current();
  const next = candidate({ 'skills/writing-plans/SKILL.md': 'Plans are small.\nshow it to the user\n' });
  const plan = planUpgrade({ manifest, register, candidates: { superpowers: next } });
  assert.equal(plan.kind, 'stopped');
  assert.deepEqual(plan.broken, [{ id: 'nothing-waits', file: 'skills/writing-plans/SKILL.md', text: 'link it for your human partner' }]);
  assert.deepEqual(plan.changed, [{ upstream: 'superpowers', path: 'skills/writing-plans' }]);
});

test('an anchor file that has gone, or carried text whose source changed, also stops the upgrade', () => {
  const { manifest, register } = current();
  const gone = candidate({}, ['skills/writing-plans/SKILL.md']);
  const missing = planUpgrade({ manifest, register, candidates: { superpowers: gone } });
  assert.equal(missing.kind, 'stopped');
  assert.equal(missing.broken.length, 1);

  const moved = candidate({ 'skills/writing-plans/notes.md': 'a different line\n' });
  const plan = planUpgrade({ manifest, register, candidates: { superpowers: moved } });
  assert.equal(plan.kind, 'stopped');
  assert.deepEqual(plan.carriedChanged, ['carried-line']);
  assert.deepEqual(plan.broken, []);
});

test('a changed licence file is named, and an upgrade with only that change is not plumbing', () => {
  const { manifest, register } = current();
  const next = candidate({ LICENSE: 'A different licence\n' });
  const plan = planUpgrade({ manifest, register, candidates: { superpowers: next } });
  assert.equal(plan.licenceChanged, true);
  assert.equal(plan.kind, 'changed');
  assert.deepEqual(plan.changed, [{ upstream: 'superpowers', path: 'LICENSE' }]);
  assert.ok(describePlan({ plan, pins: [] }).some((line) => /licence file changed/.test(line)));

  const other = candidate({ 'hooks/session-start': 'echo different\n' });
  const second = planUpgrade({ manifest, register, candidates: { superpowers: other } });
  assert.equal(second.licenceChanged, false);
  assert.equal(second.kind, 'changed');

  const removed = planUpgrade({ manifest, register, candidates: { superpowers: candidate({}, ['LICENSE']) } });
  assert.equal(removed.licenceChanged, true);
});

test('only the licence files the manifest lists count: LICENSE, LICENCE and COPYING in any case', () => {
  for (const name of ['LICENSE', 'licence', 'Copying', 'LICENSE.md', 'vendor/COPYING.txt']) assert.equal(isLicenceFile(name), true, name);
  for (const name of ['hooks/session-start', 'skills/licensing', 'LICENSES-notes/x', 'README.md']) assert.equal(isLicenceFile(name), false, name);
});

test('assumptions whose feature the changelog mentions are listed for re-testing', () => {
  const { manifest, register } = current();
  const same = candidate();
  const plan = planUpgrade({
    manifest, register, candidates: { superpowers: same },
    changelog: ['A crash when a skill sets DISABLE-MODEL-INVOCATION', 'The monitor tool now streams', 'Unrelated line'],
  });
  assert.deepEqual(plan.retest, ['no-model-start', 'monitor-30-minutes']);
  assert.deepEqual(planUpgrade({ manifest, register, candidates: { superpowers: same } }).retest, []);
  assert.deepEqual(planUpgrade({ manifest, register, candidates: { superpowers: same }, changelog: ['nothing relevant'] }).retest, []);
});

test('the plan says whether a script can re-test an assumption or a person must', () => {
  const { manifest, register } = current();
  const plan = planUpgrade({ manifest, register, candidates: { superpowers: candidate() }, changelog: ['disable-model-invocation', 'Monitor'] });
  const lines = describePlan({ plan, pins: [{ name: 'superpowers', ref: 'v1.1.0', sha: NEW_SHA }], assumptions: register.assumptions });
  assert.ok(lines.some((line) => /^re-test: no-model-start \(a script can re-test it\)/.test(line)));
  assert.ok(lines.some((line) => /^re-test: monitor-30-minutes \(needs a person\)/.test(line)));
  assert.match(lines.at(-1), /pins only/);
});

test('a candidate for an upstream the manifest does not list is refused; an upstream with no candidate stays as it is', () => {
  const { manifest, register } = current();
  assert.throws(() => planUpgrade({ manifest, register, candidates: { other: candidate() } }), /not an upstream/);
  assert.equal(planUpgrade({ manifest, register, candidates: {} }).kind, 'plumbing');
});

test('a candidate cannot reach outside its folder or pass off a link as a listed folder', () => {
  const { manifest, register } = current();
  const next = candidate();
  fs.rmSync(path.join(next.dir, 'skills', 'brainstorming'), { recursive: true });
  const elsewhere = tempFolder('wh-elsewhere-');
  writeFiles(elsewhere, { 'SKILL.md': COPY['skills/brainstorming/SKILL.md'] });
  try {
    fs.symlinkSync(elsewhere, path.join(next.dir, 'skills', 'brainstorming'), 'dir');
  } catch {
    return;
  }
  const plan = planUpgrade({ manifest, register, candidates: { superpowers: next } });
  assert.deepEqual(plan.changed, [{ upstream: 'superpowers', path: 'skills/brainstorming' }]);
});

// --- Resolving and fetching ---

test('--to words name one candidate per upstream, with a plain tag', () => {
  assert.deepEqual(parseTo(['superpowers=v7.1.0', `mattpocock-skills=v1.4.0@${NEW_SHA}`]), [
    { name: 'superpowers', tag: 'v7.1.0', sha: null },
    { name: 'mattpocock-skills', tag: 'v1.4.0', sha: NEW_SHA },
  ]);
  for (const bad of [[], ['superpowers'], ['superpowers=--upload-pack=x'], ['superpowers=v1', 'superpowers=v2'], ['Superpowers=v1'], ['superpowers=v1@abc']]) {
    assert.throws(() => parseTo(bad), undefined, JSON.stringify(bad));
  }
});

test('a tag is resolved to a commit by git ls-remote through run, an annotated tag to its commit', async () => {
  const calls = [];
  const lsRemote = (stdout, code = 0) => async (file, args, options) => {
    calls.push({ file, args, options });
    return { code, stdout, stderr: code === 0 ? '' : 'fatal: no\n' };
  };
  const tagObject = 'c'.repeat(40);
  const upstream = { name: 'superpowers', repo: KIT.repo };
  const sha = await resolveTag(upstream, 'v1.1.0', { run: lsRemote(`${tagObject}\trefs/tags/v1.1.0\n${NEW_SHA}\trefs/tags/v1.1.0^{}\n`) });
  assert.equal(sha, NEW_SHA);
  assert.equal(calls[0].file, 'git');
  assert.deepEqual(calls[0].args.slice(0, 3), ['ls-remote', '--tags', KIT.repo]);
  assert.equal(await resolveTag(upstream, 'v1.1.0', { run: lsRemote(`${NEW_SHA}\trefs/tags/v1.1.0\n`) }), NEW_SHA);
  await assert.rejects(resolveTag(upstream, 'v9', { run: lsRemote('') }), /no tag v9/);
  await assert.rejects(resolveTag(upstream, 'v9', { run: lsRemote('', 128) }), /ls-remote failed/);
});

test('resolvePins gives each pin, and refuses a sha that is not where the tag points', async () => {
  const { manifest } = current();
  const run = async () => ({ code: 0, stdout: `${NEW_SHA}\trefs/tags/v1.1.0\n`, stderr: '' });
  const pins = await resolvePins({ manifest, to: ['superpowers=v1.1.0'], run });
  assert.deepEqual(pins, [{ name: 'superpowers', plugin: 'superpowers', repo: KIT.repo, ref: 'v1.1.0', sha: NEW_SHA }]);
  await assert.rejects(resolvePins({ manifest, to: [`superpowers=v1.1.0@${'d'.repeat(40)}`], run }), /now points at/);
  await assert.rejects(resolvePins({ manifest, to: ['nothing=v1'], run }), /not an upstream/);
});

test('plan fetches each candidate into a new, empty temporary folder and removes it after', async () => {
  const root = tempFolder('wh-root-');
  const { manifest, register } = current();
  writeFiles(root, { 'lineage/manifest.json': JSON.stringify(manifest), 'lineage/register.json': JSON.stringify(register) });
  const seen = [];
  const fetchTo = async (pin, dir) => {
    assert.deepEqual(fs.readdirSync(dir), []);
    seen.push(dir);
    writeFiles(dir, { ...COPY, 'skills/brainstorming/SKILL.md': 'changed\n' });
  };
  const pins = [{ name: 'superpowers', plugin: 'superpowers', repo: KIT.repo, ref: 'v1.1.0', sha: NEW_SHA }];
  const plan = await planFromPins({ root, pins, fetchTo });
  assert.equal(plan.kind, 'changed');
  assert.equal(seen.length, 1);
  assert.equal(fs.existsSync(seen[0]), false);

  const failing = async (pin, dir) => { seen.push(dir); throw new Error('network down'); };
  await assert.rejects(planFromPins({ root, pins, fetchTo: failing }), /network down/);
  assert.equal(fs.existsSync(seen[1]), false);
});

// --- Landing ---

// A made-up Wheelhouse repository, committed on `main`: the files an upgrade changes, with the real
// manifest script's own pin text.
async function wheelhouseRepo() {
  const { dir, manifest, register } = current();
  const root = tempFolder('wh-repo-');
  writeFiles(root, {
    'lineage/manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'lineage/register.json': `${JSON.stringify(register, null, 2)}\n`,
    '.claude-plugin/marketplace.json': `${JSON.stringify({
      name: 'wheelhouse',
      plugins: [
        { name: 'wheelhouse', source: './' },
        { name: 'superpowers', source: { source: 'url', url: KIT.repo, ref: KIT.ref, sha: OLD_SHA }, description: 'pinned' },
      ],
    }, null, 2)}\n`,
    'scripts/lineage/manifest.js': fs.readFileSync(MANIFEST_SOURCE, 'utf8'),
  });
  await g(root, 'init', '--quiet', '-b', 'main');
  await g(root, 'add', '.');
  await g(root, 'commit', '--quiet', '-m', 'start');
  return { root, dir, manifest };
}

const PINS = [{ name: 'superpowers', plugin: 'superpowers', repo: KIT.repo, ref: 'v1.1.0', sha: NEW_SHA }];
const fetchCopy = (files = {}) => async (pin, dir) => { writeFiles(dir, { ...COPY, ...files }); };

test('land writes the new pins, manifest and register version on a new branch and commits, without pushing', async () => {
  const { root } = await wheelhouseRepo();
  const before = await g(root, 'rev-parse', 'HEAD');
  const gitCalls = [];
  const spy = (file, args, options) => { gitCalls.push(args[0]); return run(file, args, options); };
  const next = { 'skills/brainstorming/SKILL.md': 'Ask two questions at a time.\n' };
  const result = await land({ root, pins: PINS, changelog: [], fetchTo: fetchCopy(next), run: spy });

  assert.equal(result.plan.kind, 'changed');
  assert.equal(result.branch, 'upgrade/superpowers-v1.1.0');
  assert.equal(await g(root, 'rev-parse', '--abbrev-ref', 'HEAD'), result.branch);
  assert.equal(await g(root, 'rev-parse', 'HEAD'), result.commit);
  assert.equal(await g(root, 'rev-parse', 'HEAD~1'), before);
  assert.equal(await g(root, 'rev-parse', 'main'), before);
  assert.equal(await g(root, 'status', '--porcelain'), '');
  assert.ok(!gitCalls.includes('push'));
  assert.deepEqual((await g(root, 'diff', '--name-only', 'main', result.branch)).split('\n').sort(), [
    '.claude-plugin/marketplace.json', 'lineage/manifest.json', 'lineage/register.json', 'scripts/lineage/manifest.js',
  ]);
  assert.match(await g(root, 'log', '-1', '--format=%s'), /^Move the upstream pins: superpowers to v1.1.0$/);

  const read = (name) => JSON.parse(fs.readFileSync(path.join(root, ...name.split('/')), 'utf8'));
  const pin = read('.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'superpowers').source;
  assert.deepEqual(pin, { source: 'url', url: KIT.repo, ref: 'v1.1.0', sha: NEW_SHA });
  const manifest = read('lineage/manifest.json');
  const moved = candidate(next);
  const expected = buildManifest({ roots: { superpowers: moved.dir }, version: '1.2.3', upstreams: [{ ...KIT, ref: 'v1.1.0', sha: NEW_SHA }] });
  assert.deepEqual(manifest.upstreams, expected.upstreams);
  assert.equal(manifest.wheelhouse.version, '1.2.3');
  assert.equal(read('lineage/register.json').version, '0.4.3');
  assert.match(fs.readFileSync(path.join(root, 'scripts', 'lineage', 'manifest.js'), 'utf8'), new RegExp(`ref: 'v1.1.0',\\s+sha: '${NEW_SHA}'`));
});

test('land refuses a stopped upgrade and leaves the repository as it was', async () => {
  const { root } = await wheelhouseRepo();
  const head = await g(root, 'rev-parse', 'HEAD');
  const broken = { 'skills/writing-plans/SKILL.md': 'show it to the user\n' };
  await assert.rejects(land({ root, pins: PINS, fetchTo: fetchCopy(broken) }), /stopped/);
  assert.equal(await g(root, 'rev-parse', 'HEAD'), head);
  assert.equal(await g(root, 'branch', '--list', 'upgrade/*'), '');
  assert.equal(await g(root, 'status', '--porcelain'), '');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8')).plugins[1].source.sha, OLD_SHA);
});

test('land refuses a dirty working tree and a branch that already exists', async () => {
  const { root } = await wheelhouseRepo();
  fs.appendFileSync(path.join(root, 'lineage', 'register.json'), ' ');
  await assert.rejects(land({ root, pins: PINS, fetchTo: fetchCopy() }), /changes/);
  await g(root, 'checkout', '--', '.');
  await g(root, 'branch', 'upgrade/superpowers-v1.1.0');
  await assert.rejects(land({ root, pins: PINS, fetchTo: fetchCopy() }), /already exists/);
});

test('a failed fetch changes nothing, and a pins-only upgrade lands as plumbing', async () => {
  const { root } = await wheelhouseRepo();
  const head = await g(root, 'rev-parse', 'HEAD');
  await assert.rejects(land({ root, pins: PINS, fetchTo: async () => { throw new Error('network down'); } }), /network down/);
  assert.equal(await g(root, 'rev-parse', 'HEAD'), head);
  assert.equal(await g(root, 'branch', '--show-current'), 'main');
  const result = await land({ root, pins: PINS, fetchTo: fetchCopy({ 'README.md': 'unlisted\n' }) });
  assert.equal(result.plan.kind, 'plumbing');
});

test('the register version rises by one patch', () => {
  assert.equal(nextRegisterVersion('0.0.0'), '0.0.1');
  assert.equal(nextRegisterVersion('1.2.9'), '1.2.10');
  assert.throws(() => nextRegisterVersion('1.2'), /major.minor.patch/);
});

// --- Command line ---

test('the command line answers "due" and refuses words it does not know', async () => {
  const due = await run(process.execPath, [SCRIPT, 'due', '--published', '2020-01-01T00:00:00Z']);
  assert.equal(due.code, 0);
  assert.match(due.stdout, /^due:/);
  const young = await run(process.execPath, [SCRIPT, 'due', '--published', new Date().toISOString()]);
  assert.equal(young.code, 1);
  assert.match(young.stdout, /^not due: /);
  const unknown = await run(process.execPath, [SCRIPT, 'push']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /usage/);
  const noTo = await run(process.execPath, [SCRIPT, 'plan']);
  assert.equal(noTo.code, 2);
});
