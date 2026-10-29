// tests/scripts/host/helper-preview.test.js
// The preview step through the helper (Archon design, section 9.1): the helper names the host's preview of the run's
// head, and copies the pictures and notes from the run's own artefacts folder (one it finds from the run's id, never
// one the step names) into `previews/<work>/<head>/`, writing a `preview` event.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { engineRoutes } from '../../../scripts/engine/routes.js';
import { ticketedRoutes } from '../../helpers/engine-tickets.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { tempFolder } from '../../helpers/homes.js';

const HEAD = '1111111a2b3c4d5e6f708192a3b4c5d6e7f80912';
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function setup({ visible = true, previewUrl = async () => 'https://pr-14.preview.example.com' } = {}) {
  const dir = tempFolder('wh-preview-');
  const calls = [];
  const artefacts = (runId) => path.join(dir, 'archon', 'artifacts', 'runs', runId);
  const engine = {
    name: 'archon',
    artefactsOf: (runId) => path.join(dir, 'art', runId),
    start: async () => ({ ok: true, runId: 'run-1', branch: 'wh/card-1' }),
    outputs: async () => ({ 'open-pr': JSON.stringify({ branch: 'wh/card-1', pr: 14, head: HEAD }) }),
    artefactsOf: (runId, repo) => (repo === 'acme/web' ? artefacts(runId) : null),
  };
  const { routes } = ticketedRoutes(engineRoutes({
    projects: () => [{ project: 'p', folder: path.join(dir, 'project') }],
    engineFor: () => engine,
    ordersDir: () => path.join(dir, 'engine', 'orders'),
    filesDir: () => path.join(dir, 'engine'),
    write: async (project, kind, data) => { calls.push({ kind, data }); },
    host: { repo: () => 'acme/web', previewUrl: async (project, sha) => previewUrl(sha) },
  }), engine, 'acme/web');
  const order = workOrder({ work: { id: 'card-1', lane: 'quick', goal: 'A goal', done: [{ test: 'x' }], visible }, config: { pages: ['/', '/prices'] } });
  const plant = (runId, name, body = PNG) => {
    const folder = path.join(artefacts(runId), 'preview');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, name), body);
  };
  return { dir, routes, calls, plant, start: () => routes['/engine/start']({ project: 'p', order }) };
}

test('the host\'s preview of the run\'s head is named, with the order\'s pages', async () => {
  const { routes, start } = setup();
  await start();
  assert.deepEqual(await routes['/engine/preview/find']({ runId: 'run-1' }), {
    ok: true, visible: true, pages: ['/', '/prices'], url: 'https://pr-14.preview.example.com', pr: 14, head: HEAD,
  });
  const none = setup({ previewUrl: async () => null });
  await none.start();
  assert.equal((await none.routes['/engine/preview/find']({ runId: 'run-1' })).url, null);
  const failing = setup({ previewUrl: async () => { throw new Error('host down'); } });
  await failing.start();
  assert.equal((await failing.routes['/engine/preview/find']({ runId: 'run-1' })).url, null, 'a host that fails is no preview');
});

test('work that isn\'t visible has nothing to look at', async () => {
  const { routes, start } = setup({ visible: false });
  await start();
  assert.deepEqual(await routes['/engine/preview/find']({ runId: 'run-1' }), { ok: true, visible: false, pages: [], url: null, pr: 14, head: HEAD });
  assert.match((await routes['/engine/preview/find']({ runId: 'run-9' })).refused, /no work order/);
});

test('the helper copies the pictures into the record, so a planted picture in another run\'s folder isn\'t taken', async () => {
  const { dir, routes, calls, plant, start } = setup();
  await start();
  plant('run-1', 'home-1280x800.png');
  plant('run-1', 'prices-390x844.png');
  plant('run-1', 'notes.json', JSON.stringify({ pages: ['/', '/prices'], taken: ['home-1280x800.png', 'prices-390x844.png'], summary: null }));
  plant('run-1', 'run.sh', 'echo not a picture');
  plant('run-2', 'planted-1280x800.png');
  fs.symlinkSync(path.join(dir, 'archon', 'artifacts', 'runs', 'run-2', 'preview', 'planted-1280x800.png'), path.join(dir, 'archon', 'artifacts', 'runs', 'run-1', 'preview', 'linked-1280x800.png'));

  const got = await routes['/engine/preview']({ runId: 'run-1', folder: path.join(dir, 'archon', 'artifacts', 'runs', 'run-2', 'preview') });
  const kept = path.join(dir, 'engine', 'previews', 'card-1', HEAD);
  assert.deepEqual(got, { ok: true, folder: kept, pictures: 2 });
  assert.deepEqual(fs.readdirSync(kept).sort(), ['home-1280x800.png', 'notes.json', 'prices-390x844.png']);
  assert.deepEqual(calls.find((c) => c.kind === 'preview').data, { work: 'card-1', head: HEAD, folder: kept, pages: ['/', '/prices'] });
});

test('only the pictures the step took, of the run\'s own pages at its two sizes, are kept, and only once', async () => {
  const { dir, routes, plant, start } = setup();
  await start();
  plant('run-1', 'home-1280x800.png');
  plant('run-1', 'home-390x844.png');
  plant('run-1', 'checkout-1280x800.png');
  plant('run-1', 'prices-1280x800.png');
  plant('run-1', 'home-1024x768.png');
  const touched = ['/a', '/b', '/c', '/d', '/e', '/f'].map((p) => `${p.slice(1)}-1280x800.png`);
  for (const name of touched) plant('run-1', name);
  plant('run-1', 'notes.json', JSON.stringify({
    pages: ['/', '/prices', '/checkout', '/a', '/b', '/c', '/d', '/e', '/f'],
    taken: ['home-1280x800.png', 'home-390x844.png', 'checkout-1280x800.png', 'home-1024x768.png', ...touched],
  }));
  const got = await routes['/engine/preview']({ runId: 'run-1' });
  const kept = fs.readdirSync(got.folder).sort();
  // `prices` is the order's but wasn't taken; touched pages count to five; another size is no picture of the step's.
  assert.deepEqual(kept, ['a-1280x800.png', 'b-1280x800.png', 'c-1280x800.png', 'checkout-1280x800.png', 'd-1280x800.png', 'home-1280x800.png', 'home-390x844.png', 'notes.json']);
  assert.match((await routes['/engine/preview']({ runId: 'run-1' })).refused, /already kept/);
  const linked = setup();
  await linked.start();
  linked.plant('run-elsewhere', 'home-1280x800.png');
  const runs = path.join(linked.dir, 'archon', 'artifacts', 'runs');
  fs.mkdirSync(path.join(runs, 'run-1'), { recursive: true });
  fs.symlinkSync(path.join(runs, 'run-elsewhere', 'preview'), path.join(runs, 'run-1', 'preview'));
  assert.match((await linked.routes['/engine/preview']({ runId: 'run-1' })).refused, /made no preview/, 'a linked preview folder is no preview');
});

test('a run with no preview folder keeps nothing and says so', async () => {
  const { routes, calls, start } = setup();
  await start();
  assert.match((await routes['/engine/preview']({ runId: 'run-1' })).refused, /no preview/);
  assert.equal(calls.some((c) => c.kind === 'preview'), false);
});
