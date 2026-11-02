// tests/scripts/addon/pack.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { closureOf, reportOf, pack, ENTRIES, RUN_ONLY, vsixName } from '../../../scripts/addon/pack.js';
import { installAddon } from '../../../scripts/addon/install.js';
import { tempFolder } from '../../helpers/homes.js';
import { require } from '../../vscode/helpers.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// A tree of files under a temporary folder.
function tree(files) {
  const dir = tempFolder('wh-pack-');
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

// The files of a zip, by name: the central directory read, each file inflated, its CRC checked.
function unzip(file) {
  const buf = fs.readFileSync(file);
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'the end of the central directory');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = new Map();
  for (let i = 0; i < count; i += 1) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const localName = buf.readUInt16LE(local + 26);
    const localExtra = buf.readUInt16LE(local + 28);
    const start = local + 30 + localName + localExtra;
    const raw = buf.subarray(start, start + size);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    assert.equal(zlib.crc32 ? zlib.crc32(data) : crc, crc, `the CRC of ${name}`);
    out.set(name, data);
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

test('the closure holds everything the entries import, statically and dynamically', () => {
  const root = tree({
    'scripts/a.js': 'import { b } from \'./b.js\';\nimport fs from \'node:fs\';\nexport const a = async () => (await import(\'./c.js\')).c + b;',
    'scripts/b.js': 'export { d } from \'./lib/d.js\';\nexport const b = 1;',
    'scripts/c.js': 'import \'./lib/side.js\';\nexport const c = 2;',
    'scripts/lib/d.js': 'export const d = 3;',
    'scripts/lib/side.js': '// import \'./never.js\'\nexport {};',
    'scripts/unused.js': 'export const u = 1;',
  });
  assert.deepEqual(closureOf({ root, entries: ['scripts/a.js'] }), ['scripts/a.js', 'scripts/b.js', 'scripts/c.js', 'scripts/lib/d.js', 'scripts/lib/side.js']);
});

test('a file named beside a module is carried with it', () => {
  const root = tree({ 'adapters/x/sheet.js': 'import fs from \'node:fs\';\nexport default fs.readFileSync(new URL(\'./sheet.md\', import.meta.url), \'utf8\');', 'adapters/x/sheet.md': 'text', 'adapters/x/other.js': 'new URL(\'./gone.md\', import.meta.url);' });
  assert.deepEqual(closureOf({ root, entries: ['adapters/x/sheet.js'] }), ['adapters/x/sheet.js', 'adapters/x/sheet.md']);
  assert.deepEqual(closureOf({ root, entries: ['adapters/x/other.js'] }), ['adapters/x/other.js']);
});

test('a bare import refuses the pack', () => {
  const root = tree({ 'scripts/a.js': 'import zod from \'zod\';' });
  assert.throws(() => closureOf({ root, entries: ['scripts/a.js'] }), /zod/);
  const dynamic = tree({ 'scripts/a.js': 'export const x = () => import(\'left-pad\');' });
  assert.throws(() => closureOf({ root: dynamic, entries: ['scripts/a.js'] }), /left-pad/);
});

test('an import chosen at run time is reported, and not followed', () => {
  const root = tree({ 'scripts/a.js': 'export const load = (p) => import(p);\nexport const ok = () => import(\'./b.js\');', 'scripts/b.js': 'export {};' });
  assert.deepEqual(reportOf({ root, entries: ['scripts/a.js'] }), { files: ['scripts/a.js', 'scripts/b.js'], computed: ['scripts/a.js'] });
});

test('only setup\'s step loader chooses its import at run time, and the add-on never reaches it', () => {
  assert.deepEqual(reportOf({ root: ROOT, entries: ENTRIES }).computed, ['scripts/setup/engine.js']);
});

test('an import of a file that isn\'t there refuses the pack', () => {
  const root = tree({ 'scripts/a.js': 'import \'./missing.js\';' });
  assert.throws(() => closureOf({ root, entries: ['scripts/a.js'] }), /missing\.js/);
});

test('an import that leaves the folder refuses the pack', () => {
  const root = tree({ 'scripts/a.js': 'import \'../../outside.js\';' });
  assert.throws(() => closureOf({ root, entries: ['scripts/a.js'] }), /outside/);
});

test('the closure holds everything the add-on loads', () => {
  const closure = closureOf({ root: ROOT, entries: ENTRIES });
  const { LOADS, START_HELPER } = require('../../vscode/desk.cjs');
  for (const rel of [...Object.values(LOADS), START_HELPER]) assert.ok(closure.includes(rel), rel);
  assert.ok(RUN_ONLY.includes(START_HELPER));
  assert.ok(closure.every((f) => !f.startsWith('tests/') && !f.startsWith('docs/')), 'no test or document');
});

test('the .vsix lists every file and opens with unzip', () => {
  const out = path.join(tempFolder('wh-vsix-'), vsixName('0.2.0'));
  const file = pack({ root: ROOT, out });
  assert.equal(file, out);
  const files = unzip(file);
  for (const name of ['[Content_Types].xml', 'extension.vsixmanifest', 'extension/package.json', 'extension/extension.cjs', 'extension/press.cjs', 'extension/desk.cjs', 'extension/nonce.cjs', 'extension/versions.cjs',
    'extension/pane/render.js', 'extension/pane/style.css', 'extension/media/wheel.svg', 'extension/wheelhouse/package.json', 'extension/wheelhouse/scripts/mod/press.js', 'extension/wheelhouse/scripts/agents/copilot/start-helper.js']) {
    assert.ok(files.has(name), name);
  }
  assert.deepEqual(JSON.parse(files.get('extension/wheelhouse/package.json')), { type: 'module' });
  const manifest = files.get('extension.vsixmanifest').toString('utf8');
  assert.match(manifest, /Id="wheelhouse"/);
  assert.match(manifest, /ExtensionKind" Value="workspace"/);
  const pkg = JSON.parse(files.get('extension/package.json'));
  assert.equal(pkg.version, JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version);
  assert.match(manifest, new RegExp(`Version="${pkg.version.replaceAll('.', '\\.')}"`));
  // No file of the project, a plugin folder or a test is carried beyond the closure.
  assert.ok([...files.keys()].every((n) => !n.includes('/tests/') && !n.includes('node_modules') && !n.includes('..')));
  const listed = spawnSync('unzip', ['-t', file], { encoding: 'utf8' });
  if (!listed.error) {
    assert.equal(listed.status, 0, listed.stdout);
    assert.match(listed.stdout, /No errors detected/);
  }
});

test('packing twice gives the same file', () => {
  const dir = tempFolder('wh-vsix-');
  const a = pack({ root: ROOT, out: path.join(dir, 'a.vsix') });
  const b = pack({ root: ROOT, out: path.join(dir, 'b.vsix') });
  assert.ok(fs.readFileSync(a).equals(fs.readFileSync(b)));
});

test('a packed add-on loads its scripts from its own folder', () => {
  const dir = tempFolder('wh-vsix-');
  const files = unzip(pack({ root: ROOT, out: path.join(dir, 'w.vsix') }));
  const out = path.join(dir, 'unpacked');
  for (const [name, data] of files) {
    if (!name.startsWith('extension/')) continue;
    fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
    fs.writeFileSync(path.join(out, name), data);
  }
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  const script = `
    const path = require('node:path');
    const ext = require(path.join(${JSON.stringify(path.join(out, 'extension'))}, 'extension.cjs'));
    const desk = require(path.join(${JSON.stringify(path.join(out, 'extension'))}, 'desk.cjs'));
    (async () => {
      const real = await desk.realDeps({ root: desk.wheelhouseRoot(${JSON.stringify(path.join(out, 'extension'))}), cwd: ${JSON.stringify(dir)} });
      if (typeof real.press.pressCard !== 'function' || typeof real.press.keepEarned !== 'function' || typeof real.desk.read !== 'function') throw new Error('the scripts did not load');
      console.log('loaded', typeof ext.activate);
    })().catch((e) => { console.error(e); process.exit(1); });
  `;
  const run = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, WHEELHOUSE_HOME: home }, encoding: 'utf8', cwd: dir });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /loaded function/);
  // The helper's starter, run from the packed copy, gets as far as its usage line: every import of it resolves there.
  const starter = spawnSync(process.execPath, [path.join(out, 'extension', 'wheelhouse', 'scripts', 'agents', 'copilot', 'start-helper.js')], { env: { ...process.env, WHEELHOUSE_HOME: home }, encoding: 'utf8', cwd: dir });
  assert.equal(starter.status, 1, starter.stderr);
  assert.match(starter.stdout, /^Usage: start-helper\.js/);
});

test('the add-on imports nothing from outside its folder', () => {
  const folder = path.join(ROOT, 'vscode');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(?:cjs|js)$/.test(e.name) ? [path.join(dir, e.name)] : []));
  for (const file of walk(folder)) {
    const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of text.matchAll(/(?:require|import)\(\s*(['"`])([^'"`]+)\1/g)) {
      const spec = m[2];
      const ok = spec.startsWith('node:') || spec === 'vscode' || (spec.startsWith('./') && !spec.includes('..'));
      assert.ok(ok, `${path.relative(ROOT, file)} loads ${spec}`);
    }
    // The only dynamic import is the loader's, from the root it was given.
    for (const m of text.matchAll(/import\(/g)) assert.ok(text.slice(m.index).startsWith('import(pathToFileURL(path.join(root, rel)).href)'), `${path.relative(ROOT, file)} has an import() that isn't the loader's`);
  }
});

test('the install packs the add-on and hands it to VS Code\'s command line', async () => {
  const calls = [];
  const out = await installAddon({
    root: ROOT,
    tmp: tempFolder('wh-install-'),
    run: async (file, args) => { calls.push([file, args]); return { code: 0, stdout: 'Extension \'wheelhouse-0.2.0.vsix\' was successfully installed.\n', stderr: '' }; },
    platform: 'darwin',
    env: {},
  });
  assert.equal(out.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'code');
  assert.equal(calls[0][1][0], '--install-extension');
  assert.match(calls[0][1][1], /wheelhouse-.*\.vsix$/);
  assert.ok(fs.existsSync(calls[0][1][1]));
  // No update is switched off or on: a local install takes none.
  assert.ok(!calls[0][1].some((a) => /autoUpdate|update/i.test(a)));
});

test('the install says so when VS Code\'s command line isn\'t there or refuses', async () => {
  const none = await installAddon({ root: ROOT, tmp: tempFolder('wh-install-'), run: async () => { throw new Error('spawn code ENOENT'); }, platform: 'darwin', env: {} });
  assert.equal(none.ok, false);
  assert.match(none.line, /VS Code/);
  const refused = await installAddon({ root: ROOT, tmp: tempFolder('wh-install-'), run: async () => ({ code: 1, stdout: '', stderr: 'bad' }), platform: 'darwin', env: {} });
  assert.equal(refused.ok, false);
});
