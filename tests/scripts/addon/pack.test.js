// tests/scripts/addon/pack.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { pack, vsixName } from '../../../scripts/addon/pack.js';
import { tempFolder } from '../../helpers/homes.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const pluginVersion = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;

// The files of a stored zip, by name: the central directory read, each file's CRC checked.
function unzip(file) {
  const buf = fs.readFileSync(file);
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'the end of the central directory');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = new Map();
  for (let i = 0; i < count; i += 1) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    assert.equal(buf.readUInt16LE(at + 10), 0, 'stored, not compressed');
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    assert.equal(zlibCrc(data), crc, `the CRC of ${name}`);
    out.set(name, data);
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
const zlibCrc = (data) => {
  let c = 0xffffffff;
  for (const byte of data) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
};

const filesBelow = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesBelow(path.join(dir, e.name)).map((f) => `${e.name}/${f}`) : [e.name]));

test('the .vsix is named for the version', () => {
  assert.equal(vsixName('0.3.0'), 'wheelhouse-panel-0.3.0.vsix');
});

test('pack holds only vscode/ files, no scripts/ copy', async () => {
  const out = path.join(tempFolder('wh-vsix-'), vsixName(pluginVersion));
  const { file, sha256 } = await pack({ root: ROOT, out });
  assert.equal(file, out);
  assert.match(sha256, /^[0-9a-f]{64}$/);
  const files = unzip(file);
  const names = [...files.keys()];
  const carried = names.filter((n) => n.startsWith('extension/') && n !== 'extension/package.json');
  const expected = filesBelow(path.join(ROOT, 'vscode')).filter((f) => f !== 'package.json' && f !== 'vsix.sha256' && !f.startsWith('.')).map((f) => `extension/${f}`).sort();
  assert.deepEqual(carried.sort(), expected);
  for (const name of ['[Content_Types].xml', 'extension.vsixmanifest', 'extension/package.json', 'extension/extension.cjs', 'extension/press.cjs', 'extension/nonce.cjs', 'extension/pane/render.js', 'extension/media/wheel.svg']) {
    assert.ok(files.has(name), name);
  }
  assert.ok(names.every((n) => !n.includes('wheelhouse/scripts') && !n.startsWith('extension/scripts') && !n.includes('node_modules') && !n.includes('..')), 'no packed core script');
  assert.ok(!files.has('extension/vsix.sha256'), 'the recorded hash is not packed');
  const listed = spawnSync('unzip', ['-t', file], { encoding: 'utf8' });
  if (!listed.error) {
    assert.equal(listed.status, 0, listed.stdout);
    assert.match(listed.stdout, /No errors detected/);
  }
});

test('the same sources pack to the same hash', async () => {
  const dir = tempFolder('wh-vsix-');
  const a = await pack({ root: ROOT, out: path.join(dir, 'a.vsix') });
  const b = await pack({ root: ROOT, out: path.join(dir, 'b.vsix') });
  assert.equal(a.sha256, b.sha256);
  assert.ok(fs.readFileSync(a.file).equals(fs.readFileSync(b.file)));
});

test('the version in the add-on\'s package.json is the plugin\'s', async () => {
  const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'vscode', 'package.json'), 'utf8'));
  assert.equal(source.version, pluginVersion);
  const { file } = await pack({ root: ROOT, out: path.join(tempFolder('wh-vsix-'), 'v.vsix') });
  const files = unzip(file);
  assert.equal(JSON.parse(files.get('extension/package.json')).version, pluginVersion);
  const manifest = files.get('extension.vsixmanifest').toString('utf8');
  assert.match(manifest, new RegExp(`Version="${pluginVersion.replaceAll('.', '\\.')}"`));
  assert.match(manifest, /ExtensionKind" Value="workspace"/);
});

test('the pack takes the plugin\'s version even when the add-on\'s package.json differs', async () => {
  const root = tempFolder('wh-pack-');
  fs.mkdirSync(path.join(root, '.claude-plugin'));
  fs.mkdirSync(path.join(root, 'vscode'));
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '9.8.7' }));
  fs.writeFileSync(path.join(root, 'vscode', 'package.json'), JSON.stringify({ name: 'x', displayName: 'X', description: 'd', publisher: 'p', version: '0.0.1', engines: { vscode: '^1.100.0' } }));
  fs.writeFileSync(path.join(root, 'vscode', 'a.cjs'), 'module.exports = 1;\n');
  const { file } = await pack({ root, out: path.join(root, 'out', 'x.vsix') });
  assert.equal(JSON.parse(unzip(file).get('extension/package.json')).version, '9.8.7');
});

test('a changed source packs to another hash', async () => {
  const root = tempFolder('wh-pack-');
  fs.mkdirSync(path.join(root, '.claude-plugin'));
  fs.mkdirSync(path.join(root, 'vscode'));
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '1.0.0' }));
  fs.writeFileSync(path.join(root, 'vscode', 'package.json'), JSON.stringify({ name: 'x', displayName: 'X', description: 'd', publisher: 'p', engines: { vscode: '^1.100.0' } }));
  fs.writeFileSync(path.join(root, 'vscode', 'a.cjs'), 'module.exports = 1;\n');
  const before = await pack({ root, out: path.join(root, 'a.vsix') });
  fs.writeFileSync(path.join(root, 'vscode', 'a.cjs'), 'module.exports = 2;\n');
  const after = await pack({ root, out: path.join(root, 'b.vsix') });
  assert.notEqual(before.sha256, after.sha256);
});

test('run as a script, it packs into the file named', () => {
  const out = path.join(tempFolder('wh-vsix-'), 'named.vsix');
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'addon', 'pack.js'), out], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(fs.existsSync(out));
});

// A scratch root with a plugin version and a minimal add-on, for the refusals.
function scratchRoot(pkg = { name: 'x', displayName: 'X', description: 'd', publisher: 'p', engines: { vscode: '^1.100.0' } }) {
  const root = tempFolder('wh-pack-');
  fs.mkdirSync(path.join(root, '.claude-plugin'));
  fs.mkdirSync(path.join(root, 'vscode'));
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '1.0.0' }));
  fs.writeFileSync(path.join(root, 'vscode', 'package.json'), JSON.stringify(pkg));
  fs.writeFileSync(path.join(root, 'vscode', 'a.cjs'), 'module.exports = 1;\n');
  return root;
}

test('a file of a type the add-on doesn\'t ship refuses the pack, naming it', async () => {
  for (const stray of ['key.pem', 'extension.js.map', 'fixture.txt', 'LICENSE', '.env', '.DS_Store', 'pane/notes.ts']) {
    const root = scratchRoot();
    fs.mkdirSync(path.dirname(path.join(root, 'vscode', stray)), { recursive: true });
    fs.writeFileSync(path.join(root, 'vscode', stray), 'x');
    await assert.rejects(pack({ root, out: path.join(root, 'o.vsix') }), (error) => error.message.includes(`vscode/${stray}`), stray);
  }
});

test('every file type the add-on ships today is allowed', async () => {
  const { file } = await pack({ root: ROOT, out: path.join(tempFolder('wh-vsix-'), 'a.vsix') });
  assert.ok(fs.existsSync(file));
});

test('a symbolic link anywhere under vscode/ refuses the pack, naming it', async (t) => {
  for (const [name, target] of [['link.cjs', 'a.cjs'], ['pane/dirlink', '..']]) {
    const root = scratchRoot();
    fs.mkdirSync(path.join(root, 'vscode', 'pane'), { recursive: true });
    try {
      fs.symlinkSync(target, path.join(root, 'vscode', name));
    } catch {
      t.skip('this computer will not make a symbolic link');
      return;
    }
    await assert.rejects(pack({ root, out: path.join(root, 'o.vsix') }), (error) => error.message.includes(`vscode/${name}`) && /symbolic link/.test(error.message), name);
  }
});

test('no publisher fails the pack, and no categories gives an empty list', async () => {
  const noPublisher = scratchRoot({ name: 'x', displayName: 'X', description: 'd', engines: { vscode: '^1.100.0' } });
  await assert.rejects(pack({ root: noPublisher, out: path.join(noPublisher, 'o.vsix') }), /publisher/);
  const root = scratchRoot();
  const { file } = await pack({ root, out: path.join(root, 'o.vsix') });
  assert.match(unzip(file).get('extension.vsixmanifest').toString('utf8'), /<Categories><\/Categories>/);
});
