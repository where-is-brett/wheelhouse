// tests/scripts/watcher/resume.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findLostSessions, resumeLost, resumePrompt, RESUME_LIMIT, CARRY_ON } from '../../../scripts/watcher/resume.js';
import { runningFile, sessionFile, lostFile, watcherDir } from '../../../scripts/watcher/waker.js';
import { featurePaths } from '../../../scripts/feature/files.js';
import { withHome, tempFolder } from '../../helpers/homes.js';

const P = 'o__p';
const WORK = 'todo-cli';
const DEAD = 999001;
const LIVE = 999002;
const alive = (pid) => pid === LIVE;
const at = (minutes) => new Date(Date.parse('2026-11-07T09:00:00Z') + minutes * 60000).toISOString();
const now = () => new Date(at(60));
// The computer started well before any record, so no record is older than the boot.
const bootAt = Date.parse('2026-11-01T00:00:00Z');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// A feature worktree on its own branch: a base commit on main, two commits of the piece's own,
// and a plan with two tasks ticked and one not.
function featureWorktree() {
  const dir = tempFolder('wh-resume-');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Base of the project');
  git(dir, 'checkout', '-q', '-b', 'feature/todo-cli');
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plan.md'), [
    '# Plan', '', '### Task 1', '- [x] Write the parser test', '- [x] Build the parser', '', '### Task 2', '- [ ] Build the printer', '',
  ].join('\n'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Add the parser test');
  fs.writeFileSync(path.join(dir, 'parser.js'), '// parser.js\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Build the parser');
  const paths = featurePaths(dir);
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.writeFileSync(paths.plan, `${JSON.stringify({ plan: 'docs/plan.md' })}\n`);
  return dir;
}

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
};

// The waker's records for one started piece: its session file and a running record.
function started(worktree, { pid = DEAD, runAt = at(0), work = WORK } = {}) {
  writeJson(sessionFile(P, work), { sessionId: 'sess-1', worktree, at: at(0) });
  writeJson(runningFile(P, `feature-${work}`), { state: 'running', pid, startTime: 'x', at: runAt, file: null, entries: [] });
}

// A stand-in for the waker's resume and the helper's state, counting what each was asked.
function fakes({ cards = [], answers = [] } = {}) {
  const resumed = [];
  const writes = [];
  const resume = async ({ work, prompt }) => { resumed.push({ work, prompt }); return { pid: LIVE, sessionId: 'sess-1' }; };
  const client = {
    state: {
      write: async (body) => { writes.push(body); cards.push({ at: now().toISOString(), kind: 'card', data: body.data }); return { ok: true }; },
      views: async () => ({ ok: true, cards, answers }),
    },
  };
  return { resumed, writes, resume, client };
}

const tick = async (f) => resumeLost({ project: P, lost: await findLostSessions({ project: P, now, alive, bootAt }), now, resume: f.resume, client: f.client });

test('a session whose process still runs is not lost', () => withHome(async () => {
  started(featureWorktree(), { pid: LIVE });
  assert.deepEqual(await findLostSessions({ project: P, now, alive, bootAt }), []);
}));

test('a session that wrote its report is not lost, even when its process has gone', () => withHome(async () => {
  const worktree = featureWorktree();
  started(worktree);
  fs.writeFileSync(featurePaths(worktree).report, '# Report\n');
  assert.deepEqual(await findLostSessions({ project: P, now, alive, bootAt }), []);
}));

test('a session with neither is lost, and is resumed by its session id with the ticked tasks and the commits', () => withHome(async () => {
  const worktree = featureWorktree();
  started(worktree);
  const lost = await findLostSessions({ project: P, now, alive, bootAt });
  assert.equal(lost.length, 1);
  assert.equal(lost[0].work, WORK);
  assert.equal(lost[0].sessionId, 'sess-1');
  assert.equal(lost[0].branch, 'feature/todo-cli');
  assert.equal(fs.realpathSync(lost[0].worktree), fs.realpathSync(worktree));
  const f = fakes();
  assert.deepEqual(await resumeLost({ project: P, lost, now, resume: f.resume, client: f.client }), [{ work: WORK, outcome: 'resumed' }]);
  assert.equal(f.resumed.length, 1);
  const { prompt } = f.resumed[0];
  assert.ok(prompt.startsWith(CARRY_ON), prompt);
  assert.match(prompt, /Write the parser test/);
  assert.match(prompt, /Build the parser/);
  assert.doesNotMatch(prompt, /Build the printer/, 'an unticked task is not named');
  assert.match(prompt, /Add the parser test/);
  assert.doesNotMatch(prompt, /Base of the project/, 'commits before the branch began are not named');
}));

test('a process that ended while the watcher was away, before the computer restarted, counts as gone', () => withHome(async () => {
  started(featureWorktree(), { pid: LIVE, runAt: '2026-10-30T00:00:00Z' });
  assert.equal((await findLostSessions({ project: P, now, alive, bootAt })).length, 1);
}));

test('a session that died while the watcher ran leaves a lost marker that is found the same way', () => withHome(async () => {
  const worktree = featureWorktree();
  writeJson(sessionFile(P, WORK), { sessionId: 'sess-1', worktree, at: at(0) });
  writeJson(lostFile(P, WORK), { at: at(5), why: 'exited', code: 1 });
  const lost = await findLostSessions({ project: P, now, alive, bootAt });
  assert.equal(lost.length, 1);
  assert.equal(lost[0].runAt, at(5));
}));

test('the prompt names what is done even with no plan or commits to show', () => {
  assert.equal(resumePrompt({ ticked: [], commits: [] }), CARRY_ON);
  assert.match(resumePrompt({ ticked: ['Do a'], commits: ['Add a'] }), /Do a[\s\S]*Add a/);
});

test('the resume count is kept on disk, so it survives a watcher restart, and one death counts once', () => withHome(async () => {
  const worktree = featureWorktree();
  started(worktree, { runAt: at(0) });
  const f = fakes();
  await tick(f);
  // The resumed run has not yet written its record when the watcher stops and starts again:
  // the same run is not counted twice.
  await tick(fakes());
  const counts = JSON.parse(fs.readFileSync(path.join(watcherDir(P), 'resumes.json'), 'utf8'));
  assert.equal(counts[WORK].count, 1);
  started(worktree, { runAt: at(10) });
  await tick(fakes());
  assert.equal(JSON.parse(fs.readFileSync(path.join(watcherDir(P), 'resumes.json'), 'utf8'))[WORK].count, 2);
}));

test(`the ${RESUME_LIMIT === 3 ? 'third' : 'last'} death makes exactly one card across further ticks, and no resume`, () => withHome(async () => {
  const worktree = featureWorktree();
  const f = fakes();
  for (let death = 1; death <= RESUME_LIMIT; death += 1) {
    started(worktree, { runAt: at(death * 10) });
    const out = await tick(f);
    assert.deepEqual(out, [{ work: WORK, outcome: death < RESUME_LIMIT ? 'resumed' : 'card' }], `death ${death}`);
  }
  assert.equal(f.resumed.length, RESUME_LIMIT - 1);
  assert.equal(f.writes.length, 1);
  const card = f.writes[0];
  assert.equal(card.kind, 'card');
  assert.match(card.data.question, /stopped three times/);
  assert.deepEqual(card.data.options, ['Try again', 'Set it aside']);
  for (let more = 0; more < 3; more += 1) assert.deepEqual(await tick(f), [{ work: WORK, outcome: 'card' }]);
  // A new death after the card does not raise a second one either.
  started(worktree, { runAt: at(99) });
  await tick(f);
  assert.equal(f.writes.length, 1, 'still one card');
  assert.equal(f.resumed.length, RESUME_LIMIT - 1, 'and no resume');
}));

test('a card already in the state is not raised again, even when the count file was lost', () => withHome(async () => {
  const worktree = featureWorktree();
  const f = fakes();
  for (let death = 1; death <= RESUME_LIMIT; death += 1) { started(worktree, { runAt: at(death * 10) }); await tick(f); }
  fs.rmSync(path.join(watcherDir(P), 'resumes.json'));
  for (let death = 1; death <= RESUME_LIMIT; death += 1) { started(worktree, { runAt: at(100 + death * 10) }); await tick(f); }
  assert.equal(f.writes.length, 1);
}));

test('"Try again" on the card resumes the piece and starts its count afresh; "Set it aside" leaves it', () => withHome(async () => {
  const worktree = featureWorktree();
  const answers = [];
  const f = fakes({ answers });
  for (let death = 1; death <= RESUME_LIMIT; death += 1) { started(worktree, { runAt: at(death * 10) }); await tick(f); }
  const question = f.writes[0].data.question;
  answers.push({ id: 'a1', at: at(45), kind: 'card-answer', data: { question, label: 'Try again', where: 'panel' } });
  assert.deepEqual(await tick(f), [{ work: WORK, outcome: 'resumed' }]);
  assert.equal(f.resumed.length, RESUME_LIMIT);
  assert.equal(JSON.parse(fs.readFileSync(path.join(watcherDir(P), 'resumes.json'), 'utf8'))[WORK].count, 0);

  for (let death = 1; death <= RESUME_LIMIT; death += 1) { started(worktree, { runAt: at(200 + death * 10) }); await tick(f); }
  assert.equal(f.writes.length, 2, 'a second round of three makes a second card');
  const resumes = f.resumed.length;
  answers.push({ id: 'a2', at: at(300), kind: 'card-answer', data: { question: f.writes[1].data.question, label: 'Set it aside', where: 'panel' } });
  assert.deepEqual(await tick(f), [{ work: WORK, outcome: 'aside' }]);
  started(worktree, { runAt: at(400) });
  assert.deepEqual(await tick(f), [{ work: WORK, outcome: 'aside' }]);
  assert.equal(f.resumed.length, resumes, 'set aside: not resumed');
}));

test('a resume the waker can not start is not counted, and is tried at the next tick', () => withHome(async () => {
  started(featureWorktree());
  let fail = true;
  const f = fakes();
  const resume = async (args) => { if (fail) throw new Error('STOP is on'); return f.resume(args); };
  const lost = async () => findLostSessions({ project: P, now, alive, bootAt });
  const out = await resumeLost({ project: P, lost: await lost(), now, resume, client: f.client, log: () => {} });
  assert.deepEqual(out, [{ work: WORK, outcome: 'held' }]);
  fail = false;
  assert.deepEqual(await resumeLost({ project: P, lost: await lost(), now, resume, client: f.client }), [{ work: WORK, outcome: 'resumed' }]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(watcherDir(P), 'resumes.json'), 'utf8'))[WORK].count, 1);
}));
