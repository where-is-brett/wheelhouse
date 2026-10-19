// tests/scripts/lineage/manifest.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLAUDE_CODE_FLOOR } from '../../../scripts/lib/build-loop.js';
import {
  MANIFEST_PATH, MODELS, UPSTREAMS, buildManifest, checkInstalled, claudeHome, fetchUpstream, locateInstalled, readManifest, writeManifest,
} from '../../../scripts/lineage/manifest.js';
import { fingerprintFile, fingerprintTree } from '../../../scripts/lineage/fingerprint.js';
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
    claudeCode: { floor: CLAUDE_CODE_FLOOR },
    models: MODELS,
  });
  assert.equal(CLAUDE_CODE_FLOOR, '2.1.295');
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
  assert.deepEqual(manifest.claudeCode, { floor: '2.1.295' });
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
