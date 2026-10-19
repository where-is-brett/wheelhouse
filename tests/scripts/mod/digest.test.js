// tests/scripts/mod/digest.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { digestText, FIRST_LINE, UNBUILT } from '../../../scripts/mod/digest.js';
import { handle } from '../../../scripts/mod/bridge.js';
import { NOT_A_PROJECT } from '../../../scripts/board/inputs.js';
import { readSeen, markSeen, seenFile } from '../../../scripts/briefing/seen.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { profileViewsDir, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { as, shortHome } from '../../helpers/homes.js';

const P = 'owner__name';
const NOW = '2026-10-19T12:00:00.000Z';
const at = (iso) => () => new Date(iso);
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
  const plain = await digestText({ cwd: repo, now: at(NOW) });
  assert.equal(plain.ok, true);
  assert.equal(plain.text.split('\n')[0], FIRST_LINE);
  assert.equal(FIRST_LINE, 'Wheelhouse\'s briefing');
  assert.match(plain.text, /Waiting on you:\n1\. Approve the sign-in page/);

  // The glossary's plain words, as the briefing the hook adds is given in.
  fs.rmSync(path.join(wheelhouseHome(), 'projects', P, 'views', 'waiting.json'));
  put(path.join(wheelhouseHome(), 'projects', P, 'views', 'waiting.json'), [{ id: 'c1', at: '2026-10-18T09:00:00.000Z', data: { title: 'The PR\'s CI is red on slice 2' }, asked: ASKED }]);
  const words = await digestText({ cwd: repo, now: at(NOW) });
  assert.match(words.text, /The proposed change's automatic check run is red on piece 2/);
  assert.doesNotMatch(words.text, /PR's CI/);

  // The briefing setting gives the words.
  put(path.join(wheelhouseHome(), 'projects', P, 'views', 'waiting.json'), Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, at: '2026-10-18T09:00:00.000Z', data: { title: `Question number ${i} about the page` }, asked: ASKED })));
  setProfile({ briefing: 'short' });
  const short = await digestText({ cwd: repo, now: at(NOW) });
  assert.ok(short.text.slice(FIRST_LINE.length).split(/\s+/).filter(Boolean).length <= 80, short.text);
  assert.match(short.text, /and \d+ more/);
}));

test('/digest marks the briefing given, so the next gap starts from it', () => withProject(async ({ repo }) => {
  markSeen(P, { promptAt: new Date('2026-10-19T11:30:00.000Z'), briefedAt: new Date('2026-10-18T09:00:00.000Z') });
  const raised = [];
  const briefing = () => ({ first: [], waiting: [], changed: [], progress: [], watch: ['Unusual use: a lot'], usage: null, raise: ['u1', 'u2'] });
  const got = await digestText({ cwd: repo, now: at(NOW), briefingModel: briefing, markRaised: (ids) => raised.push(...ids) });
  assert.equal(got.ok, true);
  // The briefing time moves; the director's last message is not a command's to move.
  assert.deepEqual(readSeen(P, { now: at(NOW) }), { promptAt: '2026-10-19T11:30:00.000Z', briefedAt: NOW });
  assert.deepEqual(raised, ['u1']);

  // The next briefing is measured from it: what was given is not given again.
  const since = [];
  await digestText({ cwd: repo, now: at('2026-10-19T14:00:00.000Z'), briefingModel: (input) => { since.push(input.since); return { first: [], waiting: [], changed: [], progress: [], watch: [], usage: null, raise: [] }; } });
  assert.deepEqual(since, [NOW]);
}));

test('outside a project /digest says so', () => as(shortHome(), async () => {
  const elsewhere = shortHome();
  const got = await digestText({ cwd: elsewhere, now: at(NOW) });
  assert.deepEqual(got, { ok: false, text: NOT_A_PROJECT });
  assert.equal(fs.existsSync(seenFile(P)), false);
  assert.deepEqual(await digestText({ cwd: 'not/absolute', now: at(NOW) }), { ok: false, text: NOT_A_PROJECT });
}));

test('a briefing that can\'t be built says so, and is not marked given', () => withProject(async ({ repo }) => {
  const got = await digestText({ cwd: repo, now: at(NOW), load: async () => { throw new Error('no'); } });
  assert.deepEqual(got, { ok: false, text: UNBUILT });
  assert.equal(readSeen(P, { now: at(NOW) }).briefedAt, null);
}));

test('the bridge gives /digest to any origin, as { ok, text }', () => withProject(async ({ repo }) => {
  for (const origin of ['composer', 'bridge', 'pane', 'sdk', 'peer', undefined]) {
    const got = await handle({ cmd: 'digest', origin, cwd: repo }, { now: () => new Date(NOW) });
    assert.equal(got.ok, true, String(origin));
    assert.ok(got.text.startsWith(`${FIRST_LINE}\n`), String(origin));
  }
  assert.deepEqual(await handle({ cmd: 'digest', cwd: shortHome() }, { now: () => new Date(NOW) }), { ok: false, text: NOT_A_PROJECT });
}));
