// tests/scripts/delegation/reader.test.js
// The reader: when one may start, what counts as its reply, the fixed shape of its workflow, and a start of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mayRead, readerFolderOf, readerResult, prepareReaderFolder, READER_WORK } from '../../../scripts/delegation/reader.js';
import { READING_MOST_BYTES } from '../../../scripts/delegation/limits.js';
import { VIEW_FILE } from '../../../scripts/delegation/view-copy.js';
import { engineRoutes } from '../../../scripts/engine/routes.js';
import { orderStore } from '../../../scripts/engine/order.js';
import { PACK_DIR, readWorkflow } from '../../../scripts/engine/pack-check.js';
import { TICKET_FILE } from '../../../scripts/engine/ticket.js';
import { tempFolder } from '../../helpers/homes.js';

const reading = { frame: 'sound', why: 'The options fit.', kind: 'can-see', fits: 'no-rule', pick: 'Export', tags: [{ label: 'Export', leans: ['keep'] }, { label: 'Save', leans: [] }] };
const LABELS = ['Export', 'Save'];

test('one reader at a time, and only under pace + 2 runs', () => {
  assert.equal(mayRead({ running: 4, pace: 3, live: 0, counted: false }), true);
  assert.equal(mayRead({ running: 5, pace: 3, live: 0, counted: false }), false);
  assert.equal(mayRead({ running: 0, pace: 3, live: 1, counted: false }), false);
});

test('on a plan\'s counted requests no reader runs at stage 0', () => {
  assert.equal(mayRead({ running: 0, pace: 3, live: 0, counted: true }), false);
});

test('a reading is the read step\'s output in its fixed shape', () => {
  assert.deepEqual(readerResult({ read: JSON.stringify(reading) }, LABELS), reading);
});

test('anything missing, oversized, unparseable or out of shape is no reading', () => {
  const said = (over) => JSON.stringify({ ...reading, ...over });
  assert.equal(readerResult({}, LABELS), null);
  assert.equal(readerResult({ read: '' }, LABELS), null);
  assert.equal(readerResult({ read: 'I think Export.' }, LABELS), null);
  assert.equal(readerResult({ read: said({ frame: 'fine' }) }, LABELS), null);
  assert.equal(readerResult({ read: said({ why: '' }) }, LABELS), null);
  assert.equal(readerResult({ read: said({ kind: 'easy' }) }, LABELS), null);
  assert.equal(readerResult({ read: said({ fits: true }) }, LABELS), null);
  assert.equal(readerResult({ read: said({ pick: 'Neither' }) }, LABELS), null);
  assert.equal(readerResult({ read: said({ tags: [{ label: 'Export', leans: ['better'] }] }) }, LABELS), null);
  assert.equal(readerResult({ read: said({ why: 'x'.repeat(READING_MOST_BYTES) }) }, LABELS), null);
});

test('the reader\'s folder holds nothing a run left, and only the project\'s own', () => {
  const engine = tempFolder('wh-reader-folder-');
  const folder = readerFolderOf('shop', engine);
  assert.notEqual(folder, readerFolderOf('other', engine));
  assert.match(path.basename(folder), /^[a-z0-9-]+$/);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, VIEW_FILE), 'the last card\'s view');
  assert.deepEqual(prepareReaderFolder({ project: 'shop', engine }), { ok: true, folder });
  assert.deepEqual(fs.readdirSync(folder), []);
});

function routesWith({ held = () => false, start, views = () => ({ question: 'Which?' }) } = {}) {
  const dir = tempFolder('wh-reader-route-');
  const calls = [];
  const engine = {
    name: 'fake',
    artefactsOf: (runId, _repo, place) => path.join(dir, place?.folder ? 'folder' : 'mirror', runId),
    start: start ?? (async (order) => { calls.push(order); return { ok: true, runId: 'reader-1' }; }),
    act: async (runId, action) => { calls.push({ runId, action }); return { ok: true }; },
  };
  const orders = path.join(dir, 'orders');
  const routes = engineRoutes({
    projects: () => [{ project: 'p', folder: path.join(dir, 'project') }],
    engineFor: () => engine, ordersDir: () => orders, filesDir: () => path.join(dir, 'engine'), held,
    write: async (project, kind) => { calls.push(kind); },
    readerViewOf: (project, card) => (card === 'q-w-1' ? views() : null),
  });
  return { routes, calls, dir, orders };
}

test('a reader has a start of its own: a stand-in order, a ticket, and no run record', async () => {
  const { routes, calls, dir, orders } = routesWith();
  const got = await routes.startReader({ project: 'p', card: 'q-w-1', folder: '/engine/readers/x', bindings: { tiers: {} } });
  assert.deepEqual(got, { ok: true, runId: 'reader-1' });
  assert.deepEqual(calls, [{ work: READER_WORK, lane: 'reader', card: 'q-w-1', project: '/engine/readers/x', bindings: { tiers: {} } }]);
  assert.equal(orderStore(orders).load('reader-1').card, 'q-w-1');
  assert.ok(fs.existsSync(path.join(dir, 'folder', 'reader-1', TICKET_FILE)));
});

test('no reader starts under All stop, and a refused start is said back', async () => {
  const stopped = routesWith({ held: () => true });
  assert.equal((await stopped.routes.startReader({ project: 'p', card: 'q-w-1', folder: '/f', bindings: {} })).ok, false);
  assert.deepEqual(stopped.calls, []);
  const refused = routesWith({ start: async () => ({ ok: false, refused: 'no' }) });
  assert.deepEqual(await refused.routes.startReader({ project: 'p', card: 'q-w-1', folder: '/f', bindings: {} }), { ok: false, refused: 'no' });
});

test('the view goes to the run named by its ticket and to no other', async () => {
  const { routes, dir } = routesWith();
  await routes.startReader({ project: 'p', card: 'q-w-1', folder: '/f', bindings: {} });
  const view = routes.routes['/engine/reader-view'];
  const ticket = fs.readFileSync(path.join(dir, 'folder', 'reader-1', TICKET_FILE), 'utf8').trim();
  assert.deepEqual(await view({ runId: 'reader-1', ticket }), { ok: true, view: { question: 'Which?' } });
  assert.equal((await view({ runId: 'reader-1', ticket: 'f'.repeat(64) })).ok, false);
  assert.equal((await view({ runId: 'reader-1' })).ok, false);
  assert.equal((await view({ runId: 'someone-else', ticket })).ok, false);
});

test('a view that has gone, or a run that isn\'t a reader, gets nothing', async () => {
  const { routes, dir } = routesWith({ views: () => null });
  await routes.startReader({ project: 'p', card: 'q-w-1', folder: '/f', bindings: {} });
  const ticket = fs.readFileSync(path.join(dir, 'folder', 'reader-1', TICKET_FILE), 'utf8').trim();
  assert.equal((await routes.routes['/engine/reader-view']({ runId: 'reader-1', ticket })).ok, false);
});

test('the reader\'s step reads its own folder and nothing else', () => {
  const workflow = readWorkflow(fs.readFileSync(path.join(PACK_DIR, 'wheelhouse-reader.yaml'), 'utf8'));
  const read = workflow.nodes.find((n) => n.id === 'read');
  assert.deepEqual(read.allowed_tools, ['Read', 'Grep', 'Glob']);
  assert.deepEqual(read.settingSources, ['project']);
  assert.equal(read.plugins, undefined);
  assert.equal(workflow.nodes.some((n) => n.wait !== undefined), false);
  assert.deepEqual(Object.keys(read.output_format.properties).slice(0, 2), ['frame', 'why']);
  const prompt = fs.readFileSync(path.join(PACK_DIR, read.prompt_file), 'utf8');
  assert.ok(!/builder|recommend|approve|merge/i.test(prompt));
});
