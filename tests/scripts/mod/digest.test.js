// tests/scripts/mod/digest.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeEvent, eventPath } from '../../../scripts/state/events.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { digestText, UNBUILT } from '../../../scripts/mod/digest.js';
import { loadBoardInputs } from '../../../scripts/board/inputs.js';
import { briefingIn, reviewOf, INPUTS_WAIT_MS } from '../../../scripts/hooks/board-context.js';
import { CONTEXT_CHARS } from '../../../scripts/lib/core-numbers.js';
import { handle, BRIDGE_MS } from '../../../scripts/mod/bridge.js';
import { NOT_A_PROJECT } from '../../../scripts/board/inputs.js';
import { readSeen, markSeen, seenFile } from '../../../scripts/briefing/seen.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { profileViewsDir, sourcesDir, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { as, shortHome } from '../../helpers/homes.js';
import { beforeTimer } from '../../helpers/until.js';

const P = 'owner__name';
const NOW = '2026-10-19T12:00:00.000Z';
const at = (iso) => () => new Date(iso);
// A helper client that is up and holds no lock, so nothing waits on a real helper.
const upClient = { health: async () => ({ ok: true }), lock: { read: async () => ({ ok: true, result: null }) } };
const ASKED = { at: '2026-10-18T09:05:00.000Z', label: null };

const put = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};

// A registered project with the waiting cards given.
function register(home, titles = ['Approve the sign-in page']) {
  const repo = path.join(home, 'repo');
  put(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeProject(P, { folder: repo, remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {} });
  put(path.join(wheelhouseHome(), 'projects', P, 'views', 'waiting.json'), titles.map((title, i) => ({ id: `c${i}`, at: '2026-10-18T09:00:00.000Z', data: { title }, asked: ASKED })));
  return repo;
}

function setProfile(settings) {
  const views = Object.fromEntries(Object.entries(settings).map(([key, value], i) => [key, { key, id: `s${i}`, at: '2026-10-01T00:00:00.000Z', value, before: null }]));
  put(path.join(profileViewsDir(), 'settings.json'), views);
}

const withProject = (fn, titles) => {
  const home = shortHome();
  return as(home, () => fn({ home, repo: register(home, titles) }));
};

test('/digest gives the briefing since the last one, within its words, in plain words', () => withProject(async ({ repo }) => {
  const plain = await digestText({ cwd: repo, now: at(NOW), client: upClient });
  assert.equal(plain.ok, true);
  // The verdict opens it, the same sentence as the pane's; there is no title before it.
  assert.equal(plain.text.split('\n')[0], 'One thing needs you. Nothing is broken.');
  assert.match(plain.text, /Waiting on you:\n1\. Approve the sign-in page/);
  assert.match(plain.text, /\n\nAsk me anything\. For the full Logbook, type \/wheelhouse:logbook\.$/);

  // The glossary's plain words, as the briefing the hook adds is given in.
  fs.rmSync(path.join(wheelhouseHome(), 'projects', P, 'views', 'waiting.json'));
  put(path.join(wheelhouseHome(), 'projects', P, 'views', 'waiting.json'), [{ id: 'c1', at: '2026-10-18T09:00:00.000Z', data: { title: 'The PR\'s CI is red on slice 2' }, asked: ASKED }]);
  const words = await digestText({ cwd: repo, now: at(NOW), client: upClient });
  assert.match(words.text, /The proposed change's automatic check run is red on piece 2/);
  assert.doesNotMatch(words.text, /PR's CI/);

  // The briefing setting gives the words.
  put(path.join(wheelhouseHome(), 'projects', P, 'views', 'waiting.json'), Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, at: '2026-10-18T09:00:00.000Z', data: { title: `Question number ${i} about the page` }, asked: ASKED })));
  setProfile({ briefing: 'short' });
  const short = await digestText({ cwd: repo, now: at(NOW), client: upClient });
  assert.ok(short.text.split(/\s+/).filter(Boolean).length <= 80, short.text);
  assert.match(short.text, /and \d+ more/);
}));

test('/digest marks the briefing given, so the next gap starts from it', () => withProject(async ({ repo }) => {
  markSeen(P, { promptAt: new Date('2026-10-19T11:30:00.000Z'), briefedAt: new Date('2026-10-18T09:00:00.000Z') });
  const raised = [];
  const briefing = () => ({ first: [], waiting: [], changed: [], progress: [], watch: ['Unusual use: a lot'], usage: null, raise: ['u1', 'u2'] });
  const got = await digestText({ cwd: repo, now: at(NOW), client: upClient, briefingModel: briefing, markRaised: (ids) => raised.push(...ids) });
  assert.equal(got.ok, true);
  // The briefing time moves; the director's last message is not a command's to move.
  assert.deepEqual(readSeen(P, { now: at(NOW) }), { promptAt: '2026-10-19T11:30:00.000Z', briefedAt: NOW, weeklyAt: null });
  assert.deepEqual(raised, ['u1']);

  // The next briefing is measured from it: what was given is not given again.
  const since = [];
  await digestText({ cwd: repo, now: at('2026-10-19T14:00:00.000Z'), client: upClient, briefingModel: (input) => { since.push(input.since); return { first: [], waiting: [], changed: [], progress: [], watch: [], usage: null, raise: [] }; } });
  assert.deepEqual(since, [NOW]);
}));

test('/digest carries the weekly lines and the delegation review as the hook does, and marks the weekly lines given only when shown', () => withProject(async ({ repo }) => {
  markSeen(P, { briefedAt: new Date('2026-10-18T09:00:00.000Z'), weeklyAt: new Date('2026-10-12T09:00:00.000Z') });
  const inputs = [];
  const raised = [];
  const weekly = (watch) => (input) => {
    inputs.push(input);
    return { first: [], waiting: [], changed: [], progress: [], watch, usage: null, raise: ['u1'], weekly: 1 };
  };
  await digestText({ cwd: repo, now: at(NOW), client: upClient, briefingModel: weekly(['Unattended is on for build commands', 'Unusual use: a lot']), markRaised: (ids) => raised.push(...ids) });
  assert.equal(inputs[0].weeklySince, '2026-10-12T09:00:00.000Z');
  assert.deepEqual(inputs[0].review, { due: false, days: 14 });
  // The weekly line opens what to watch, so the unusual use after it is the one raised.
  assert.deepEqual(raised, ['u1']);
  assert.equal(readSeen(P, { now: at(NOW) }).weeklyAt, NOW);

  // A briefing that shows no weekly line leaves the last one that did.
  const later = '2026-10-19T14:00:00.000Z';
  await digestText({ cwd: repo, now: at(later), client: upClient, briefingModel: weekly([]) });
  assert.equal(inputs[1].weeklySince, NOW);
  assert.deepEqual(readSeen(P, { now: at(later) }), { promptAt: null, briefedAt: later, weeklyAt: NOW });
}));

test('outside a project /digest says so', () => as(shortHome(), async () => {
  const elsewhere = shortHome();
  const got = await digestText({ cwd: elsewhere, now: at(NOW), client: upClient });
  assert.deepEqual(got, { ok: false, text: NOT_A_PROJECT });
  assert.equal(fs.existsSync(seenFile(P)), false);
  assert.deepEqual(await digestText({ cwd: 'not/absolute', now: at(NOW), client: upClient }), { ok: false, text: NOT_A_PROJECT });
}));

test('a briefing that can\'t be built says so, and is not marked given', () => withProject(async ({ repo }) => {
  const got = await digestText({ cwd: repo, now: at(NOW), client: upClient, load: async () => { throw new Error('no'); } });
  assert.deepEqual(got, { ok: false, text: UNBUILT });
  assert.equal(readSeen(P, { now: at(NOW) }).briefedAt, null);
}));

test('the bridge gives /digest to any origin, as { ok, text }', () => withProject(async ({ repo }) => {
  for (const origin of ['composer', 'bridge', 'pane', 'sdk', 'peer', undefined]) {
    const got = await handle({ cmd: 'digest', origin, cwd: repo }, { now: () => new Date(NOW), client: upClient });
    assert.equal(got.ok, true, String(origin));
    assert.ok(got.text.startsWith('One thing needs you. Nothing is broken.\n'), String(origin));
  }
  assert.deepEqual(await handle({ cmd: 'digest', cwd: shortHome() }, { now: () => new Date(NOW), client: upClient }), { ok: false, text: NOT_A_PROJECT });
}));

const putMerge = (when, forUsers) => {
  const merge = makeEvent({ kind: 'merge', data: { pr: 7, commit: 'abc', forUsers }, now: () => new Date(when) });
  const file = path.join(stateDir(P), eventPath(merge));
  put(file, JSON.stringify(merge));
};

test('/digest reads the events and sources too: what changed for users since the last briefing, and a changed source', () => withProject(async ({ repo }) => {
  putMerge('2026-10-18T10:00:00.000Z', 'New: dark mode');
  putMerge('2026-10-19T09:00:00.000Z', 'New: saved searches');
  put(path.join(sourcesDir(), 'report.json'), { at: '2026-10-19T08:00:00.000Z', sources: [{ id: 'models', ok: true, changed: true }], newModels: [], newLinks: [], retiring: [], releases: [], advisories: [] });
  markSeen(P, { briefedAt: new Date('2026-10-18T12:00:00.000Z') });
  const got = await digestText({ cwd: repo, now: at(NOW), client: upClient });
  assert.equal(got.ok, true);
  // Only what is after the last briefing.
  assert.match(got.text, /Changed for users \(\+1\):\n- New: saved searches/);
  assert.doesNotMatch(got.text, /dark mode/);
  assert.match(got.text, /- Anthropic's models overview page changed/);
}));

test('a helper that never answers still leaves the briefing, inside the bridge\'s limit', () => withProject(async ({ repo }) => {
  putMerge('2026-10-19T09:00:00.000Z', 'New: saved searches');
  const never = () => new Promise(() => {});
  const hung = { health: never, lock: { read: never } };
  const given = await beforeTimer(() => digestText({ cwd: repo, now: at(NOW), client: hung }), BRIDGE_MS);
  assert.equal(given.inTime, true, 'still waiting on the helper');
  const got = given.value;
  assert.equal(got.ok, true);
  assert.match(got.text, /Approve the sign-in page/);
  assert.match(got.text, /New: saved searches/);

  // The same through the bridge, whose own client is the one that hangs (the first briefing was marked given).
  fs.rmSync(seenFile(P));
  const handled = await beforeTimer(() => handle({ cmd: 'digest', origin: 'composer', cwd: repo }, { now: () => new Date(NOW), client: hung }), BRIDGE_MS);
  assert.equal(handled.inTime, true, 'still waiting on the helper');
  const viaBridge = handled.value;
  assert.equal(viaBridge.ok, true);
  assert.match(viaBridge.text, /New: saved searches/);
}));

test('/digest gives the same briefing the hook builds after a gap', () => withProject(async ({ repo }) => {
  putMerge('2026-10-19T09:00:00.000Z', 'New: saved searches');
  markSeen(P, { briefedAt: new Date('2026-10-18T12:00:00.000Z') });
  const at12 = new Date(NOW);
  const inputs = await loadBoardInputs({ cwd: repo, now: () => at12, client: upClient, waitMs: INPUTS_WAIT_MS });
  const seen = readSeen(P, { now: at12 });
  const hook = briefingIn({
    project: inputs.project, model: inputs.model, usage: inputs.usage, sources: inputs.sources, settings: inputs.settings,
    since: seen.briefedAt, weeklySince: seen.weeklyAt, review: reviewOf(inputs.project, inputs.settings, at12), at: at12, room: CONTEXT_CHARS,
  });
  const got = await digestText({ cwd: repo, now: at(NOW), client: upClient });
  assert.equal(got.text, hook.text);
  // It opens with the verdict and when the last briefing was.
  assert.match(got.text, /^One thing needs you\. Nothing is broken\.\n\nSince \d\d:\d\d, about \d+ hours\n\n/);
}));
