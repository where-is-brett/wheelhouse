// tests/scripts/survey/take.test.js
// Taking the survey for the state (design section 15, ruling A1; plan rulings P1 and P3): it only
// reads, never throws, leaves out Wheelhouse's own feature lines and anything that looks like a
// secret, and fits the state's shape; a survey that can't be taken at all is one that missed the host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { takeSurvey, shapedSurvey, missedSurvey, ownLines, recordSurvey } from '../../../scripts/survey/take.js';
import { makeEvent, writeEvent } from '../../../scripts/state/events.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { makeBareRemote, g, push, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { tempFolder } from '../../helpers/homes.js';

const SECRET = ['gh', 'p_', 'a1B2'.repeat(10)].join('');

async function withHome(fn) {
  const home = tempFolder('wh-take-');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    return await fn(home);
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
}

const change = async (dir, file, words) => {
  fs.writeFileSync(path.join(dir, file), words);
  await g(dir, 'add', file);
  await g(dir, 'commit', '-q', '-m', words);
  return g(dir, 'rev-parse', 'HEAD');
};

// A project on main with origin, a line of its own one commit ahead, and Wheelhouse's feature line.
async function aProject() {
  const remote = await makeBareRemote();
  const dir = tempFolder('wh-take-project ');
  await g(dir, 'init', '-q', '-b', 'main');
  await g(dir, 'remote', 'add', 'origin', remote.url);
  await change(dir, 'README.md', 'Start');
  await g(dir, 'push', '-q', 'origin', 'main');
  await g(dir, 'switch', '-q', '-c', 'prices');
  await change(dir, 'prices.txt', 'Prices');
  await g(dir, 'switch', '-q', '-c', 'feature/export-csv', 'main');
  await change(dir, 'export.txt', 'Export');
  await g(dir, 'switch', '-q', 'main');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Agents\n');
  return { dir, remote };
}

const record = (dir) => ({ folder: dir, host: 'github', repo: 'o/p', remoteUrl: 'https://example.invalid/o/p.git' });
const adapterWith = (requests) => async () => ({ defaultBranch: async () => 'main', openRequests: async () => requests });

test('the survey taken for the state reads the project, leaving out Wheelhouse\'s own feature lines', async () => {
  const { dir, remote } = await aProject();
  try {
    const before = await g(dir, 'for-each-ref', '--format=%(refname) %(objectname)');
    const got = await takeSurvey({ record: record(dir), adapter: adapterWith([{ number: 7, title: 'Add a request', draft: false, head: 'c'.repeat(40), branch: 'x', fork: false }]), own: ['feature/export-csv'] });
    assert.equal(got.hostReached, true);
    assert.deepEqual(got.requests, [{ number: 7, title: 'Add a request', draft: false }]);
    assert.deepEqual(got.local.map((i) => i.name), ['prices']);
    assert.deepEqual(got.instructions.files, ['AGENTS.md']);
    assert.ok(makeEvent({ kind: 'survey', data: got }), 'it fits the state\'s shape');
    assert.equal(await g(dir, 'for-each-ref', '--format=%(refname) %(objectname)'), before, 'nothing moved');
  } finally { remote.cleanup(); }
});

test('a host that can\'t be reached, or an adapter that can\'t be made, gives hostReached false, never a throw', async () => {
  const { dir, remote } = await aProject();
  try {
    const down = await takeSurvey({ record: record(dir), adapter: async () => ({ defaultBranch: async () => { throw new Error('unreachable'); }, openRequests: async () => { throw new Error('unreachable'); } }), own: [] });
    assert.equal(down.hostReached, false);
    assert.deepEqual(down.local.map((i) => i.name), ['feature/export-csv', 'prices'], 'the default branch is read from git when the host can\'t say');
    const none = await takeSurvey({ record: record(dir), adapter: async () => { throw new Error('no sign-in'); }, own: [] });
    assert.equal(none.hostReached, false);
    // A folder that isn't there, or no project at all: a survey that missed.
    assert.deepEqual(await takeSurvey({ record: record(path.join(dir, 'gone')), adapter: adapterWith([]) }), missedSurvey());
    assert.deepEqual(await takeSurvey({ record: null }), missedSurvey());
    assert.deepEqual(await takeSurvey({ record: record(dir), look: async () => { throw new Error('git refused'); } }), missedSurvey());
  } finally { remote.cleanup(); }
});

test('anything that looks like a secret is left out of the survey, and the rest fits the state', () => {
  const head = 'a'.repeat(40);
  const got = shapedSurvey({
    ...missedSurvey(),
    hostReached: true,
    requests: [{ number: 7, title: `Key ${SECRET}`, draft: false }, { number: 8, title: 'x'.repeat(500), draft: 'yes' }, { number: 'nine', title: 'odd' }],
    pushed: [{ name: `leak-${SECRET}`, head, commits: 1, subject: 'a', at: '' }, { name: 'ok', head, commits: 1, subject: `has ${SECRET}`, at: '' }],
    local: [{ name: 'here', head, commits: 2, subject: 'Here', at: '2026-10-20T01:00:00Z' }],
    instructions: { files: ['AGENTS.md', `.claude/agents/${SECRET}.md`], sections: [{ heading: `Agents ${SECRET}`, line: 3 }] },
    rules: [{ words: `Use ${SECRET}`, source: { file: 'CLAUDE.md', line: 1 } }, { words: 'Use British English.', source: { file: 'CLAUDE.md', line: 2 } }],
    extra: 'left out',
  });
  assert.equal(JSON.stringify(got).includes(SECRET), false);
  assert.deepEqual(got.requests, [{ number: 7, title: '', draft: false }, { number: 8, title: 'x'.repeat(200), draft: false }]);
  assert.deepEqual(got.pushed.map((i) => [i.name, i.subject]), [['ok', '']]);
  assert.deepEqual(got.local.map((i) => i.name), ['here']);
  assert.deepEqual(got.instructions, { files: ['AGENTS.md'], sections: [{ heading: '', line: 3 }] });
  assert.deepEqual(got.rules.map((r) => r.words), ['Use British English.']);
  assert.equal(got.extra, undefined);
  assert.ok(makeEvent({ kind: 'survey', data: got }));
});

test('Wheelhouse\'s own lines are the feature lines its state records', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      assert.deepEqual(ownLines('o__p'), []);
      for (const data of [{ work: 'export-csv', step: 'building', branch: 'feature/export-csv' }, { work: 'login', step: 'started' }, { work: 'odd', step: 'building', branch: 'their-name' }]) {
        await writeEvent({ env: LOCAL_PATHS, project: 'o__p', event: makeEvent({ kind: 'feature', data }), push });
      }
      assert.deepEqual(ownLines('o__p'), ['feature/export-csv', 'feature/login', 'feature/odd', 'their-name']);
      assert.deepEqual(ownLines('o__nowhere'), []);
    });
  } finally { remote.cleanup(); }
});

test('recording the survey never throws: a refused one is recorded as a survey that missed', async () => {
  const writes = [];
  const writer = (answers) => async (data) => { writes.push(data); return answers.shift() ?? { ok: true, id: 'x' }; };
  const data = { ...missedSurvey(), hostReached: true };
  assert.deepEqual(await recordSurvey({ write: writer([]), take: async () => data }), { ok: true, id: 'x' });
  assert.deepEqual(writes.splice(0), [data]);
  // Refused (a secret the scan found, say): recorded again as a survey that missed the host.
  await recordSurvey({ write: writer([{ ok: false, refused: 'matched: github-token' }]), take: async () => data });
  assert.deepEqual(writes.splice(0), [data, missedSurvey()]);
  // Under STOP nothing more is tried.
  await recordSurvey({ write: writer([{ ok: false, refused: 'STOP is on' }]), take: async () => data });
  assert.equal(writes.splice(0).length, 1);
  // A take that throws, or a writer that throws, still gives an answer.
  await recordSurvey({ write: writer([]), take: async () => { throw new Error('no'); } });
  assert.deepEqual(writes.splice(0), [missedSurvey()]);
  const thrown = await recordSurvey({ write: async () => { throw new Error('gone'); }, take: async () => data });
  assert.equal(thrown.ok, false);
  // With `again`, the survey says it was taken again.
  await recordSurvey({ write: writer([]), take: async () => data, again: true });
  assert.deepEqual(writes.splice(0), [{ ...data, again: true }]);
});
