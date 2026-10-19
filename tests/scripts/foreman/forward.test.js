// tests/scripts/foreman/forward.test.js
// The foreman's command line forwards to the host helper (ruling R156): `node act.js …` and
// `node wake.js …` send their folder, their name and their arguments to /foreman/run, print
// what the helper's run printed and end with its exit code. They read nothing themselves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { forward } from '../../../scripts/foreman/forward.js';
import { run } from '../../../scripts/lib/run.js';
import { tempFolder } from '../../helpers/homes.js';

const FOREMAN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'foreman');

function io() {
  const said = { out: '', err: '' };
  return { said, out: (t) => { said.out += t; }, err: (t) => { said.err += t; } };
}

test('forward sends the folder, the script and its arguments, and gives back what the helper ran', async () => {
  const asked = [];
  const client = { foreman: { run: async (body) => { asked.push(body); return { ok: true, code: 3, stdout: 'Merged.\n', stderr: 'A warning.\n' }; } } };
  const { said, out, err } = io();
  assert.equal(await forward('act', ['merge', 'export'], { cwd: '/the/checkout', client, out, err }), 3);
  assert.deepEqual(asked, [{ folder: '/the/checkout', script: 'act', argv: ['merge', 'export'] }]);
  assert.deepEqual(said, { out: 'Merged.\n', err: 'A warning.\n' });
});

test('a refusal, an odd answer or a throw from the client is one line and exit code 1', async () => {
  for (const [answer, line] of [
    [{ ok: false, refused: 'the foreman\'s commands run only in the project\'s main checkout' }, 'the foreman\'s commands run only in the project\'s main checkout\n'],
    [{ ok: true, stdout: 'no code' }, 'The host helper gave no answer\n'],
    [undefined, 'The host helper gave no answer\n'],
  ]) {
    const { said, out, err } = io();
    const client = { foreman: { run: async () => answer } };
    assert.equal(await forward('wake', ['read', 'x.json'], { cwd: '/c', client, out, err }), 1);
    assert.deepEqual(said, { out: '', err: line });
  }
  const { said, out, err } = io();
  assert.equal(await forward('wake', [], { cwd: '/c', client: { foreman: { run: async () => { throw new Error('boom'); } } }, out, err }), 1);
  assert.equal(said.err, 'The host helper gave no answer\n');
});

test('act.js and wake.js run as commands forward to the helper, and touch nothing in the Wheelhouse home', { skip: process.platform === 'win32' }, async () => {
  // A stand-in helper at the address a command finds from WHEELHOUSE_HOME.
  const home = path.join(tempFolder('wh-'), 'home');
  fs.mkdirSync(home);
  const asked = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      asked.push({ path: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, code: 4, stdout: 'from the helper\n', stderr: '' }));
    });
  });
  await new Promise((resolve) => server.listen(path.join(home, 'helper.sock'), resolve));
  const checkout = fs.realpathSync.native(tempFolder('wh-main-'));
  const before = fs.readdirSync(home).sort();
  try {
    for (const script of ['act', 'wake']) {
      const ran = await run(process.execPath, [path.join(FOREMAN, `${script}.js`), 'merge', 'export'], { cwd: checkout, env: { WHEELHOUSE_HOME: home } });
      assert.deepEqual([ran.code, ran.stdout, ran.stderr], [4, 'from the helper\n', ''], script);
    }
    assert.deepEqual(asked.map((a) => a.path), ['/foreman/run', '/foreman/run']);
    assert.deepEqual(asked.map((a) => a.body), [
      { folder: checkout, script: 'act', argv: ['merge', 'export'] },
      { folder: checkout, script: 'wake', argv: ['merge', 'export'] },
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.deepEqual(fs.readdirSync(home).filter((n) => n !== 'helper.sock').sort(), before.filter((n) => n !== 'helper.sock'), 'nothing written in the home');

  // With no helper answering, the command says so and does nothing else.
  const ran = await run(process.execPath, [path.join(FOREMAN, 'wake.js'), 'measures'], { cwd: checkout, env: { WHEELHOUSE_HOME: path.join(home, 'absent') } });
  assert.equal(ran.code, 1);
  assert.match(ran.stderr, /could not be reached/);
  assert.equal(fs.existsSync(path.join(home, 'absent')), false);
});
