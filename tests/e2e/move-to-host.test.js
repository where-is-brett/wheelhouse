// tests/e2e/move-to-host.test.js
// A project in git alone moves to a host with one card (spec 9): the real helper, the fake engine, a real home and a bare
// repository standing for the host. An open change arrives intact, its passed check isn't run again, and the next merge is the
// host's merge queue, not the local one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL_COMMAND, LOCAL_P as P, gitAloneWorld } from '../helpers/engine-e2e.js';
import { until, waitLongerOnTheHelper } from '../helpers/until.js';
import { g } from '../helpers/git-fixture.js';
import { tempFolder } from '../helpers/homes.js';
import { commandDigest } from '../../scripts/checks/record.js';
import { workOrder } from '../../scripts/engine/order.js';
import { withTicket } from '../../scripts/engine/ticket.js';
import { localChanges } from '../../scripts/host/local/changes.js';
import { homeDir } from '../../scripts/host/local/home.js';
import { MOVE_NOW, unlockHome } from '../../scripts/host/local/move.js';
import { stateDir } from '../../scripts/lib/paths.js';
import { readProject } from '../../scripts/lib/projects.js';
import { run } from '../../scripts/lib/run.js';
import { dataHash, eventPath, listEvents, makeEvent } from '../../scripts/state/events.js';

waitLongerOnTheHelper();

const DIGEST = commandDigest(LOCAL_COMMAND);
const OWNER = 'owner/shop';
const ARCHON = '# .archon/config.yaml\nworktree:\n  path: .wheelhouse/worktrees\n  remote: wheelhouse\n  baseBranch: main\n';
const records = (kind) => listEvents(stateDir(P), { report: () => {} }).filter((e) => e.kind === kind);
const headOf = async (repo, ref) => (await run('git', ['rev-parse', '--verify', '-q', ref], { cwd: repo })).stdout.trim();
const verdictsFile = () => path.join(stateDir(P), '..', 'engine', 'verdicts.json');

// The host, as the helper's adapter sees it: pull requests over the bare repository, numbered from 41 so they differ from the
// project's changes, and statuses as they are set.
function hostOver(bare) {
  const prs = new Map();
  const statuses = new Map();
  const merges = [];
  const headIn = async (branch) => {
    const got = await run('git', ['rev-parse', '--verify', '-q', `refs/heads/${branch}`], { cwd: bare });
    if (got.code !== 0) throw new Error(`There is no branch ${branch}`);
    return got.stdout.trim();
  };
  const adapter = {
    defaultBranch: async () => 'main',
    branchHead: headIn,
    login: async () => 'owner',
    openRequests: async () => [...prs.values()].filter((p) => p.state === 'open').map((p) => ({ number: p.number, branch: p.head, head: p.sha, title: p.title, body: p.body, fork: false, draft: false })),
    async openPr({ head, base, title, body }) {
      const number = 41 + prs.size;
      prs.set(number, { number, head, base, title, body, state: 'open', sha: await headIn(head) });
      await g(bare, 'update-ref', `refs/pull/${number}/head`, prs.get(number).sha);
      return { number, url: null };
    },
    updatePr: async ({ number }) => ({ number }),
    async prState(number) {
      const p = prs.get(number);
      return { number, headSha: p.sha, headRef: p.head, baseRef: p.base, mergeable: 'yes', state: p.state, title: p.title, body: p.body };
    },
    setStatus: async ({ sha, state }) => { statuses.set(sha, state); return { ok: true }; },
    ciState: async (sha) => ({ sha, state: statuses.get(sha) ?? 'none' }),
    checkContexts: async (sha) => (statuses.has(sha) ? [{ name: 'wheelhouse/checks', state: statuses.get(sha), startedAt: '2026-11-01T00:00:00.000Z', app: 'wheelhouse' }] : []),
    requiredChecks: async () => [],
    hasCi: async () => false,
    pullRef: (number) => `refs/pull/${number}/head`,
    previewUrl: async () => null,
    verdictComment: async ({ id }) => ({ id: id ?? 500 }),
    async merge({ number, sha }) {
      const p = prs.get(number);
      const base = await headIn(p.base);
      const tree = (await g(bare, 'merge-tree', '--write-tree', base, sha)).trim();
      const commit = (await g(bare, '-c', 'user.name=Host', '-c', 'user.email=host@example.com', 'commit-tree', tree, '-p', base, '-m', p.title)).trim();
      await g(bare, 'update-ref', `refs/heads/${p.base}`, commit);
      p.state = 'merged';
      merges.push({ number, commit });
      return { merged: true, commit };
    },
    protectionEvents: async () => ({ source: 'none', compared: false, events: [] }),
    openPullRequests: async () => [],
    issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
  };
  return { adapter, prs, merges, statuses };
}

async function moved(fn, { files = { '.archon/config.yaml': ARCHON } } = {}) {
  const bare = path.join(tempFolder('wh-stand-in-host-'), 'owner', 'shop.git');
  fs.mkdirSync(bare, { recursive: true });
  await g(bare, 'init', '-q', '--bare', '-b', 'main');
  const host = hostOver(bare);
  const protections = [];
  const check = async ({ commit, main }) => ({ commit, command: DIGEST, result: 'passed', minutes: 0, tail: '', ...(main ? { clean: true } : {}) });
  await gitAloneWorld(async (world) => {
    try {
      await fn({ ...world, bare, host, protections });
    } finally {
      unlockHome(P);
    }
  }, {
    check, files, onHost: () => host.adapter,
    helperOptions: {
      connectHost: async ({ folder, made }) => {
        made(OWNER);
        return { folder, remoteUrl: bare, host: 'github', repo: OWNER, connection: { host: 'github', mode: 'quick', project: OWNER } };
      },
      protectHost: async (args) => { protections.push(args); return {}; },
    },
  });
}

const orderOf = (id) => workOrder({ work: { id, lane: 'quick', goal: 'Show prices with two decimals', done: [{ test: 'prices' }], visible: false }, config: { pages: [] } });

// An open local change from a run, reviewed clean and marked ready, with its check passed.
async function openChange({ helper, client, engine, worktreeWith }, id) {
  const started = await helper.engine.start({ project: P, order: orderOf(id) });
  assert.equal(started.ok, true, started.refused);
  const { worktree, head } = await worktreeWith(`wh/${id}`, 'export const price = (c) => (c / 100).toFixed(2);\n');
  const opened = await withTicket(client, ['--artefacts', engine.artefactsOf(started.runId)]).engine.openPr({ runId: started.runId, cwd: worktree, title: `Change ${id}`, body: 'Prices show two decimals.' });
  assert.equal(opened.ok, true, opened.refused);
  const signed = await client.state.record({ project: P, event: makeEvent({ kind: 'review', data: { pr: opened.pr, commit: head, verdict: 'CLEAN' } }) });
  assert.equal(signed.ok, true, JSON.stringify(signed));
  return { n: opened.pr, head, runId: started.runId };
}

function keepEvent(event) {
  const file = path.join(stateDir(P), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
}

const answer = (question, label) => keepEvent(makeEvent({ kind: 'action', data: { action: 'answer', question: 'the card as shown', questionId: question.data.id, questionHash: dataHash(question.data), label } }));

async function move({ helper, client }) {
  const asked = await client.local.move({ project: P, host: 'github' });
  assert.equal(asked.ok, true, JSON.stringify(asked));
  const card = records('question').find((e) => e.data.work === 'move');
  assert.match(card.data.what, /online/);
  answer(card, MOVE_NOW);
  await helper.move.tick();
}

test('a project moves with an open change intact, and its next merge goes through the hosted path', { timeout: 120000 }, () => moved(async (world) => {
  const { helper, folder, bare, host, protections } = world;
  const { n, head, runId } = await openChange(world, 'card-1');
  await until(async () => {
    await helper.engine.tick();
    return records('check').some((e) => e.data.commit === head);
  }, { what: 'the check of the change', within: 30000 });
  const marked = JSON.parse(fs.readFileSync(verdictsFile(), 'utf8'));
  fs.writeFileSync(verdictsFile(), `${JSON.stringify({ ...marked, ready: { ...marked.ready, [n]: { head, runId, showFirst: false, work: 'card-1' } } }, null, 2)}\n`);
  const was = await headOf(homeDir(P), 'refs/heads/main');
  await move(world);

  const record = readProject(P);
  assert.equal(record.host, 'github', JSON.stringify(records('question').map((q) => q.data.what)));
  assert.equal(record.repo, OWNER);
  assert.equal(await headOf(bare, 'refs/heads/wh/card-1'), head);
  const pr = [...host.prs.values()].find((p) => p.head === 'wh/card-1');
  assert.equal(pr.body, 'Prices show two decimals.');
  assert.equal(localChanges({ project: P }).changeOf(n).state, 'closed');
  const verdicts = JSON.parse(fs.readFileSync(verdictsFile(), 'utf8'));
  assert.equal(verdicts.opened[pr.number].head, head);
  assert.equal(verdicts.opened[n], undefined);
  assert.equal(verdicts.ready[pr.number].head, head);

  // The project's files, by one pull request the helper merged.
  assert.equal(host.merges.length, 1);
  assert.equal(await g(bare, 'show', 'refs/heads/main:.archon/sdlc/policy/maintainers.json'), '["owner"]');
  assert.ok(!(await g(bare, 'show', 'refs/heads/main:.archon/config.yaml')).includes('remote:'));

  assert.equal((await g(folder, 'remote')).trim(), 'origin');
  assert.equal(await headOf(folder, 'refs/heads/main'), await headOf(bare, 'refs/heads/main'));
  assert.ok(!fs.readFileSync(path.join(folder, '.archon', 'config.yaml'), 'utf8').includes('remote:'));
  assert.deepEqual(protections, [{ host: 'github', repo: OWNER }]);
  assert.notEqual(await headOf(bare, 'refs/heads/wheelhouse-lock'), '');
  assert.equal(await headOf(homeDir(P), 'refs/heads/main'), was);

  // Nothing runs twice: the commit's passed check is reported, and the hosted gate merges on it.
  await helper.engine.tick();
  assert.equal(records('check').filter((e) => e.data.commit === head).length, 1);
  assert.equal(host.statuses.get(head), 'success');
  const queue = () => JSON.parse(fs.readFileSync(path.join(stateDir(P), '..', 'engine', 'dispatch.json'), 'utf8'));
  await until(async () => {
    await helper.engine.tick();
    return queue().mergeRun !== null;
  }, { what: 'the merge queue', within: 30000 });
  assert.deepEqual(queue().seenReady, [String(pr.number)]);
  assert.deepEqual(world.engine.calls.find((c) => c.call === 'start' && c.order.lane === 'merge').order.repo, { host: 'github.com', path: OWNER });
  assert.equal(await headOf(homeDir(P), 'refs/heads/main'), was);
  assert.equal(localChanges({ project: P }).mergedChanges().length, 0);
}));

test('a move waits for a run that is going, holds new work, and goes once the run has stopped', { timeout: 120000 }, () => moved(async (world) => {
  const { helper, client, folder } = world;
  const started = await helper.engine.start({ project: P, order: orderOf('card-2') });
  assert.equal(started.ok, true, started.refused);
  await move(world);
  assert.equal(readProject(P).host, 'local');
  const refused = await helper.engine.start({ project: P, order: orderOf('card-3') });
  assert.equal(refused.ok, false);
  assert.match(refused.refused, /moving to a host/);
  const pushed = await client.push({ project: P, dir: folder, refspec: 'main' }).catch((error) => ({ refused: error.message }));
  assert.equal(pushed.ok, false, JSON.stringify(pushed));
  keepEvent(makeEvent({ kind: 'run', data: { work: 'card-2', lane: 'quick', engine: 'fake', runId: started.runId, state: 'ended' } }));
  await helper.move.tick();
  assert.equal(readProject(P).host, 'github');
}));
