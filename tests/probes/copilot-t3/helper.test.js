// tests/probes/copilot-t3/helper.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTrialHelper } from '../../../probes/copilot-t3/helper.js';
import { helperAddress } from '../../../scripts/lib/paths.js';
import { helperClient } from '../../../scripts/host/helper-client.js';

// A plugin folder whose helper-main.js answers /health and /helper/retire on the socket of the home it is given.
function fakePlugin(dir) {
  const file = path.join(dir, 'scripts', 'host', 'helper-main.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}\n');
  fs.writeFileSync(file, `import http from 'node:http';
import path from 'node:path';
const server = http.createServer((req, res) => {
  res.end(JSON.stringify(req.url === '/helper/retire' ? { ok: true, retired: true } : { ok: true }));
  if (req.url === '/helper/retire') setTimeout(() => process.exit(0), 20);
});
server.listen(path.join(process.env.WHEELHOUSE_HOME, 'helper.sock'));
process.on('SIGTERM', () => process.exit(0));
`);
  return dir;
}

const shortDir = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-h-')));

test('the helper is started in the trial\'s own home, answers there, and is gone after stop', async (t) => {
  const dir = shortDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home');
  const helper = await startTrialHelper({ home, pluginRoot: fakePlugin(path.join(dir, 'plugin')), waitMs: 5000, pollMs: 50 });
  const client = helperClient({ address: helperAddress({ home }), timeout: 1000 });
  assert.equal(helper.spawned, true);
  assert.equal((await client.health()).ok, true);
  await helper.stop();
  assert.equal((await client.health()).ok, false);
  await helper.stop();
});

test('a helper already answering in the home is reused and asked to close, not signalled', async (t) => {
  const dir = shortDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home');
  const plugin = fakePlugin(path.join(dir, 'plugin'));
  const first = await startTrialHelper({ home, pluginRoot: plugin, waitMs: 5000, pollMs: 50 });
  const second = await startTrialHelper({ home, pluginRoot: plugin, waitMs: 5000, pollMs: 50 });
  assert.equal(second.spawned, false);
  await second.stop();
  const client = helperClient({ address: helperAddress({ home }), timeout: 1000 });
  for (let i = 0; i < 40 && (await client.health()).ok; i += 1) await new Promise((r) => setTimeout(r, 50));
  assert.equal((await client.health()).ok, false);
  await first.stop();
});

test('it never starts a helper for the real Wheelhouse home', async () => {
  let spawned = false;
  await assert.rejects(startTrialHelper({ home: path.join(os.homedir(), '.wheelhouse'), spawn: () => { spawned = true; } }), /real Wheelhouse home/);
  assert.equal(spawned, false);
});

test('a helper that never answers fails the start, in words', async (t) => {
  const dir = shortDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const plugin = path.join(dir, 'plugin');
  fs.mkdirSync(path.join(plugin, 'scripts', 'host'), { recursive: true });
  fs.writeFileSync(path.join(plugin, 'scripts', 'host', 'helper-main.js'), 'setTimeout(() => {}, 100);\n');
  await assert.rejects(startTrialHelper({ home: path.join(dir, 'home'), pluginRoot: plugin, waitMs: 300, pollMs: 50 }), /did not answer/);
});
