// tests/scripts/lineage/manifest.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLAUDE_CODE_FLOOR } from '../../../scripts/lib/build-loop.js';
import { skillCopyNames } from '../../../scripts/lineage/copies.js';
import { COPILOT_VERSION } from '../../../scripts/lib/copilot-numbers.js';
import {
  MANIFEST_PATH, MODELS, UPSTREAMS, buildManifest, checkInstalled, claudeHome, fetchUpstream, locateInstalled, readManifest, verifyManifest, writeManifest,
} from '../../../scripts/lineage/manifest.js';
import { fingerprintFile, fingerprintTree } from '../../../scripts/lineage/fingerprint.js';
import { ENGINE_PINS, manifestPins } from '../../../scripts/engine/pins.js';
import { g } from '../../helpers/git-fixture.js';
import { tempFolder } from '../../helpers/homes.js';

function write(dir, files) {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, ...name.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

// A made-up upstream: two folders and a file, in a copy under a temporary folder.
const TINY = {
  name: 'kit',
  plugin: 'kit',
  repo: 'https://example.invalid/kit.git',
  ref: 'v1.0.0',
  sha: 'a'.repeat(40),
  folders: ['skills/one', 'skills/two'],
  files: ['LICENSE'],
};
const COPY = { 'skills/one/SKILL.md': 'one\n', 'skills/one/lib/x.js': 'x\n', 'skills/two/SKILL.md': 'two\n', LICENSE: 'licence\n' };

function tiny() {
  const dir = tempFolder('wh-kit-');
  write(dir, COPY);
  const manifest = buildManifest({ roots: { kit: dir }, version: '1.2.3', upstreams: [TINY] });
  return { dir, manifest };
}

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

test('the manifest fingerprints each of Wheelhouse\'s own skill copies', () => {
  const { manifest } = tiny();
  assert.deepEqual(manifest.copies.map((c) => c.path), skillCopyNames().map((name) => `skills/${name}`));
  for (const copy of manifest.copies) assert.equal(copy.hash, fingerprintTree(path.join(REPO_ROOT, ...copy.path.split('/'))).hash);
});

test('the manifest names each upstream folder and file with its fingerprint, and the floor and the models', () => {
  const { dir, manifest } = tiny();
  assert.deepEqual(manifest, {
    v: 1,
    wheelhouse: { version: '1.2.3' },
    upstreams: [{
      ...TINY,
      folders: [
        { path: 'skills/one', hash: fingerprintTree(path.join(dir, 'skills', 'one')).hash },
        { path: 'skills/two', hash: fingerprintTree(path.join(dir, 'skills', 'two')).hash },
      ],
      files: [{ path: 'LICENSE', hash: fingerprintFile(path.join(dir, 'LICENSE')).hash }],
    }],
    copies: manifest.copies,
    claudeCode: { floor: CLAUDE_CODE_FLOOR },
    agents: { copilot: { cli: COPILOT_VERSION } },
    engine: manifestPins(),
    models: MODELS,
  });
  assert.equal(CLAUDE_CODE_FLOOR, '2.1.299');
  assert.equal(MODELS, 'the routing table in .claude/wheelhouse.json');
});

test('checkInstalled passes a copy that matches, whatever its line endings', () => {
  const { dir, manifest } = tiny();
  const crlf = tempFolder('wh-kit-crlf-');
  write(crlf, Object.fromEntries(Object.entries(COPY).map(([name, text]) => [name, text.replace(/\n/g, '\r\n')])));
  for (const installed of [dir, crlf]) {
    assert.deepEqual(checkInstalled({ manifest, locate: () => ({ dir: installed, sha: TINY.sha }) }), { ok: true, mismatches: [] });
  }
});

test('checkInstalled names each folder that differs, and a missing install', () => {
  const { manifest } = tiny();
  const changed = tempFolder('wh-kit-changed-');
  write(changed, { ...COPY, 'skills/one/lib/x.js': 'changed\n', LICENSE: 'another licence\n' });
  fs.rmSync(path.join(changed, 'skills', 'two'), { recursive: true });
  const [one, two] = manifest.upstreams[0].folders;
  const [licence] = manifest.upstreams[0].files;
  const result = checkInstalled({ manifest, locate: () => ({ dir: changed, sha: TINY.sha }) });
  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [
    { upstream: 'kit', path: 'skills/one', want: one.hash, got: fingerprintTree(path.join(changed, 'skills', 'one')).hash },
    { upstream: 'kit', path: 'skills/two', want: two.hash, got: null },
    { upstream: 'kit', path: 'LICENSE', want: licence.hash, got: fingerprintFile(path.join(changed, 'LICENSE')).hash },
  ]);
  assert.notEqual(result.mismatches[0].got, one.hash);

  // No install at all is one mismatch, whatever else is listed.
  assert.deepEqual(checkInstalled({ manifest, locate: () => null }), {
    ok: false,
    mismatches: [{ upstream: 'kit', path: '*', want: TINY.sha, got: null }],
  });
});

test('checkInstalled reports a different commit beside the hashes, and a path that leaves the install as missing', () => {
  const { dir, manifest } = tiny();
  assert.deepEqual(checkInstalled({ manifest, locate: () => ({ dir, sha: 'b'.repeat(40) }) }), {
    ok: false,
    mismatches: [{ upstream: 'kit', path: '@commit', want: TINY.sha, got: 'b'.repeat(40) }],
  });
  const outside = structuredClone(manifest);
  outside.upstreams[0].files.push({ path: '../LICENSE', hash: manifest.upstreams[0].files[0].hash });
  assert.deepEqual(checkInstalled({ manifest: outside, locate: () => ({ dir, sha: TINY.sha }) }).mismatches, [
    { upstream: 'kit', path: '../LICENSE', want: manifest.upstreams[0].files[0].hash, got: null },
  ]);
});

test('locateInstalled reads the project-scope install of the upstream for this project', () => {
  const claudeHome = tempFolder('wh-claude-');
  const project = tempFolder('wh-project-');
  const entry = (over) => ({ scope: 'project', projectPath: project, installPath: '/cache/kit/1', version: '1', gitCommitSha: 'c'.repeat(40), ...over });
  write(claudeHome, {
    'plugins/installed_plugins.json': JSON.stringify({
      version: 2,
      plugins: {
        'kit@wheelhouse': [
          entry({ scope: 'user', projectPath: undefined, installPath: '/cache/user', gitCommitSha: 'd'.repeat(40) }),
          entry({ projectPath: path.join(project, 'other'), installPath: '/cache/other' }),
          entry({ projectPath: project.toUpperCase() === project ? project.toLowerCase() : project.toUpperCase() }),
        ],
        'kit@claude-plugins-official': [entry({ installPath: '/cache/official' })],
        'second@wheelhouse': [entry({ installPath: '/cache/second' })],
      },
    }),
  });
  assert.deepEqual(locateInstalled(TINY, { projectDir: project, claudeHome }), { dir: '/cache/kit/1', sha: 'c'.repeat(40) });
  assert.deepEqual(locateInstalled({ plugin: 'second' }, { projectDir: project, claudeHome }), { dir: '/cache/second', sha: 'c'.repeat(40) });
  assert.equal(locateInstalled({ plugin: 'absent' }, { projectDir: project, claudeHome }), null);
  assert.equal(locateInstalled(TINY, { projectDir: path.join(project, 'nowhere'), claudeHome }), null);
  assert.equal(locateInstalled(TINY, { projectDir: project, claudeHome: tempFolder('wh-claude-empty-') }), null, 'no record');
  write(claudeHome, { 'plugins/installed_plugins.json': '{not json' });
  assert.equal(locateInstalled(TINY, { projectDir: project, claudeHome }), null, 'an unreadable record');
});

test('readManifest reads lineage/manifest.json and refuses anything that is not a manifest', () => {
  const { manifest } = tiny();
  const root = tempFolder('wh-root-');
  assert.throws(() => readManifest(root), /can't be read/);
  write(root, { [MANIFEST_PATH]: JSON.stringify(manifest) });
  assert.deepEqual(readManifest(root), manifest);
  write(root, { [MANIFEST_PATH]: JSON.stringify({ ...manifest, v: 2 }) });
  assert.throws(() => readManifest(root), /isn't in the form/);
  write(root, { [MANIFEST_PATH]: JSON.stringify({ ...manifest, upstreams: [{ ...manifest.upstreams[0], folders: [{ path: 3 }] }] }) });
  assert.throws(() => readManifest(root), /isn't in the form/);
  // A null hash would pass whatever is installed, even nothing, so it is refused.
  for (const list of ['folders', 'files']) {
    const upstream = { ...manifest.upstreams[0], [list]: [{ path: 'LICENSE', hash: null }] };
    write(root, { [MANIFEST_PATH]: JSON.stringify({ ...manifest, upstreams: [upstream] }) });
    assert.throws(() => readManifest(root), /isn't in the form/, list);
  }
});

test('checkInstalled finds the install for the project it is given, through the record in the Claude folder it is given', () => {
  const { dir, manifest } = tiny();
  const claudeHome = tempFolder('wh-claude-');
  const project = tempFolder('wh-project-');
  write(claudeHome, {
    'plugins/installed_plugins.json': JSON.stringify({
      version: 2,
      plugins: { 'kit@wheelhouse': [{ scope: 'project', projectPath: project, installPath: dir, version: '1', gitCommitSha: TINY.sha }] },
    }),
  });
  assert.deepEqual(checkInstalled({ manifest, projectDir: project, claudeHome }), { ok: true, mismatches: [] });
  assert.deepEqual(checkInstalled({ manifest, projectDir: tempFolder('wh-other-'), claudeHome }).mismatches, [{ upstream: 'kit', path: '*', want: TINY.sha, got: null }]);
  const seen = [];
  checkInstalled({ manifest, projectDir: project, claudeHome, locate: (upstream, where) => { seen.push([upstream.name, where]); return null; } });
  assert.deepEqual(seen, [['kit', { projectDir: project, claudeHome }]]);
});

test('the Claude folder is CLAUDE_CONFIG_DIR when it is set, else .claude in the home folder', () => {
  assert.equal(claudeHome({ CLAUDE_CONFIG_DIR: '/elsewhere/claude' }), '/elsewhere/claude');
  assert.equal(claudeHome({}), path.join(os.homedir(), '.claude'));
});

test('the manifest in the repository lists Superpowers and Matt\'s skills at check 24\'s commits', () => {
  const manifest = readManifest();
  assert.equal(manifest.wheelhouse.version, JSON.parse(fs.readFileSync(new URL('../../../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version);
  assert.deepEqual(manifest.claudeCode, { floor: '2.1.299' });
  assert.equal(manifest.models, MODELS);
  assert.deepEqual(manifest.upstreams.map(({ name, plugin, repo, ref, sha }) => ({ name, plugin, repo, ref, sha })), [
    { name: 'superpowers', plugin: 'superpowers', repo: 'https://github.com/obra/superpowers.git', ref: 'v7.0.0', sha: 'bb92a77741419a4ab5f06e711a283343f1ada0c3' },
    { name: 'mattpocock-skills', plugin: 'mattpocock-skills', repo: 'https://github.com/mattpocock/skills.git', ref: 'v1.3.1', sha: '24fe0ef7737efae15c87225755e9f6f5965e4888' },
  ]);
  const [superpowers, matt] = manifest.upstreams;
  assert.deepEqual(superpowers.folders.map((f) => f.path), [
    'brainstorming', 'using-git-worktrees', 'writing-plans', 'subagent-driven-development', 'executing-plans', 'test-driven-development',
    'systematic-debugging', 'dispatching-parallel-agents', 'requesting-code-review', 'receiving-code-review', 'verification-before-completion',
    'finishing-a-development-branch', 'using-superpowers',
  ].map((skill) => `skills/${skill}`));
  assert.deepEqual(superpowers.files.map((f) => f.path), ['hooks/session-start', 'hooks/hooks.json', 'LICENSE']);
  assert.deepEqual(matt.folders.map((f) => f.path), ['tdd', 'code-review', 'prototype', 'domain-modeling', 'implement'].map((s) => `skills/engineering/${s}`));
  assert.deepEqual(matt.files.map((f) => f.path), ['LICENSE']);
  for (const upstream of manifest.upstreams) for (const { hash } of [...upstream.folders, ...upstream.files]) assert.match(hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(UPSTREAMS.map((u) => u.sha), manifest.upstreams.map((u) => u.sha));
});

// Points HOME and XDG_CONFIG_HOME at a scratch folder whose .gitconfig sends `from` to a place that
// holds nothing, for the length of `body`; never the real home.
async function withGlobalRewrite(from, body) {
  const home = tempFolder('wh-gitconfig-home-');
  fs.writeFileSync(path.join(home, '.gitconfig'), `[url "${tempFolder('wh-nowhere-').replace(/\\/g, '/')}"]\n\tinsteadOf = ${from.replace(/\\/g, '/')}\n`);
  const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = home;
  process.env.USERPROFILE = home;
  try { return await body(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('fetchUpstream fetches the pinned commit shallow into the folder it is given', async () => {
  const origin = tempFolder('wh-origin-');
  await g(origin, 'init', '--quiet', '-b', 'main');
  write(origin, { 'skills/one/SKILL.md': 'first\n' });
  await g(origin, 'add', '.');
  await g(origin, 'commit', '--quiet', '-m', 'first');
  const pinned = await g(origin, 'rev-parse', 'HEAD');
  write(origin, { 'skills/one/SKILL.md': 'second\n' });
  await g(origin, 'commit', '--quiet', '-am', 'second');

  const into = tempFolder('wh-fetched-');
  await fetchUpstream({ ...TINY, repo: pathToFileURL(origin).href, sha: pinned }, into);
  assert.equal(fs.readFileSync(path.join(into, 'skills', 'one', 'SKILL.md'), 'utf8'), 'first\n');
  assert.equal(await g(into, 'rev-parse', 'HEAD'), pinned);
  assert.equal(await g(into, 'rev-list', '--count', 'HEAD'), '1', 'shallow');

  await assert.rejects(fetchUpstream({ ...TINY, repo: pathToFileURL(origin).href, sha: 'f'.repeat(40) }, tempFolder('wh-fetched-')), /failed for kit/);
});

test('fetchUpstream never reads the director\'s global git config', async () => {
  const origin = tempFolder('wh-origin-');
  await g(origin, 'init', '--quiet', '-b', 'main');
  await g(origin, 'commit', '--quiet', '--allow-empty', '-m', 'first');
  const pinned = await g(origin, 'rev-parse', 'HEAD');
  const repo = pathToFileURL(origin).href;
  await withGlobalRewrite(repo, async () => {
    const into = tempFolder('wh-fetched-');
    await fetchUpstream({ ...TINY, repo, sha: pinned }, into);
    assert.equal(await g(into, 'rev-parse', 'HEAD'), pinned);
  });
});

test('write fetches each upstream into a new empty folder, fingerprints it and removes the folder', async () => {
  const root = tempFolder('wh-release-');
  write(root, { '.claude-plugin/plugin.json': JSON.stringify({ version: '9.9.9' }) });
  const seen = [];
  const manifest = await writeManifest({
    root,
    fetchTo: async (upstream, dir) => {
      assert.deepEqual(fs.readdirSync(dir), [], 'a new, empty folder');
      assert.ok(path.basename(dir).startsWith('wh-lineage-'));
      seen.push(dir);
      for (const folder of upstream.folders) write(dir, { [`${folder}/SKILL.md`]: `${upstream.name} ${folder}\r\n` });
      for (const file of upstream.files) write(dir, { [file]: `${upstream.name} ${file}\n` });
    },
  });
  assert.equal(seen.length, UPSTREAMS.length);
  assert.equal(new Set(seen).size, seen.length, 'a folder each');
  for (const dir of seen) assert.equal(fs.existsSync(dir), false, 'removed afterwards');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, MANIFEST_PATH), 'utf8')), manifest);
  assert.equal(manifest.wheelhouse.version, '9.9.9');
  assert.equal(manifest.upstreams[0].sha, UPSTREAMS[0].sha);
});

// A made-up Wheelhouse root whose manifest, register and marketplace all name TINY as `dir` holds it.
function verifiable() {
  const { dir, manifest } = tiny();
  const root = tempFolder('wh-verify-');
  write(root, {
    'lineage/manifest.json': JSON.stringify(manifest),
    'lineage/register.json': JSON.stringify({
      v: 1, version: '0.1.0',
      overrides: [{ id: 'one', upstream: 'kit', skill: 'one', anchors: [{ file: 'skills/one/SKILL.md', text: 'one' }], rule: 'r', why: 'w', scenario: 1 }],
      carried: [{ id: 'two', upstream: 'kit', file: 'skills/two/SKILL.md', hash: fingerprintFile(path.join(dir, 'skills', 'two', 'SKILL.md')).hash, text: 'two' }],
      assumptions: [],
    }),
    '.claude-plugin/marketplace.json': JSON.stringify({ name: 'wheelhouse', plugins: [{ name: 'kit', source: { source: 'url', url: TINY.repo, ref: TINY.ref, sha: TINY.sha } }] }),
  });
  return { dir, root };
}

test('verify fetches each upstream afresh and finds the manifest, the register and the pins as they are', async () => {
  const { dir, root } = verifiable();
  const fetched = [];
  const copy = (files = {}) => async (upstream, into) => {
    assert.deepEqual(fs.readdirSync(into), [], 'a new, empty folder');
    fetched.push(into);
    fs.cpSync(dir, into, { recursive: true });
    write(into, files);
  };
  const lines = [];
  const found = await verifyManifest({ root, fetchTo: copy(), upstreams: [TINY], log: (line) => lines.push(line) });
  assert.deepEqual(found, { ok: true, broken: [] });
  assert.deepEqual(lines, [
    `kit v1.0.0 (${TINY.sha}): 2 folders and 1 file, all as the manifest has them`,
    'register 0.1.0: 1 of 1 anchor found, 1 of 1 carried text unchanged',
    `.claude-plugin/marketplace.json pins kit at v1.0.0 (${TINY.sha})`,
    'lineage ok',
  ]);

  // A changed upstream breaks the fingerprint, the anchor and the carried text, and each is named.
  const changed = await verifyManifest({ root, fetchTo: copy({ 'skills/one/SKILL.md': 'changed\n', 'skills/two/SKILL.md': 'changed\n' }), upstreams: [TINY] });
  assert.equal(changed.ok, false);
  assert.equal(changed.broken.length, 4);
  assert.match(changed.broken[0], /^kit skills\/one: fingerprint/);
  assert.match(changed.broken[1], /^kit skills\/two: fingerprint/);
  assert.equal(changed.broken[2], 'anchor gone: one: skills/one/SKILL.md: one');
  assert.equal(changed.broken[3], 'carried text\'s source changed: two');
  const gone = await verifyManifest({ root, fetchTo: async (u, into) => { fs.cpSync(dir, into, { recursive: true }); fs.rmSync(path.join(into, 'LICENSE')); }, upstreams: [TINY] });
  assert.deepEqual(gone.broken, ['kit LICENSE: not there']);

  // A fetch that fails, a pin that moved, and pins in the script that are not the manifest's.
  const failed = await verifyManifest({ root, fetchTo: async () => { throw new Error('no such commit'); }, upstreams: [TINY] });
  assert.deepEqual(failed.broken, [
    `kit could not be fetched at ${TINY.sha}: no such commit`,
    'the register\'s kit entries could not be checked: no copy of kit was fetched',
  ]);
  write(root, { '.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'kit', source: { source: 'url', url: TINY.repo, ref: TINY.ref, sha: 'b'.repeat(40) } }] }) });
  const moved = await verifyManifest({ root, fetchTo: copy(), upstreams: [{ ...TINY, sha: 'c'.repeat(40) }] });
  assert.deepEqual(moved.broken, [
    `.claude-plugin/marketplace.json does not pin kit at the manifest's ${TINY.repo} v1.0.0 (${TINY.sha})`,
    'the pins in scripts/lineage/manifest.js are not the manifest\'s: write the manifest again',
  ]);
  for (const into of fetched) assert.equal(fs.existsSync(into), false, 'removed afterwards');
});

test('the manifest carries the engine pins and verifyManifest catches a changed one', async () => {
  const { dir, root } = verifiable();
  const copy = async (upstream, into) => fs.cpSync(dir, into, { recursive: true });
  assert.deepEqual(readManifest(root).engine, manifestPins());
  assert.equal(readManifest(root).engine.archon.tag, ENGINE_PINS.archon.tag);
  assert.deepEqual((await verifyManifest({ root, fetchTo: copy, upstreams: [TINY] })).broken, []);
  const moved = { ...ENGINE_PINS, bun: { ...ENGINE_PINS.bun, version: '9.9.9' } };
  assert.deepEqual((await verifyManifest({ root, fetchTo: copy, upstreams: [TINY], engine: moved })).broken, [
    'the engine\'s pins in scripts/engine/pins.js are not the manifest\'s: write the manifest again',
  ]);
});

test('the manifest in the repository carries the engine pins', () => {
  assert.deepEqual(readManifest().engine, manifestPins());
});
