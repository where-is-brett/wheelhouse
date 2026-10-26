// tests/helpers/foreman.js
// A project for the foreman's tests: its record, a main checkout (a real git
// repository when asked), feature worktrees with their files, the views as
// the helper gives them, and a stand-in helper that keeps what is written and
// lays it over the views, as the real one would after its next rebuild, and
// puts it in the state clone.
import fs from 'node:fs';
import path from 'node:path';
import { featurePaths } from '../../scripts/feature/files.js';
import { stateDir } from '../../scripts/lib/paths.js';
import { writeProject } from '../../scripts/lib/projects.js';
import { eventPath, makeEvent } from '../../scripts/state/events.js';
import { readHandled } from '../../scripts/watcher/handled.js';
import { tempFolder } from './homes.js';
import { g } from './git-fixture.js';

export const P = 'o__p';
export const T0 = Date.parse('2026-10-19T09:00:00.000Z');
export const HASH = 'a'.repeat(64);

// The project's configuration as the helper reads it from the default branch.
export const config = (over = {}) => ({
  v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [],
  routing: { foreman: 'model-a', builder: 'model-b', reviewer: 'model-c' },
  ...over,
});

// The project's record and its main checkout. With `git`, the checkout is a
// repository with one commit on main, whose origin/HEAD names origin/main.
export async function project({ git = false } = {}) {
  const checkout = fs.realpathSync.native(tempFolder('wh-main-'));
  if (git) {
    await g(checkout, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(checkout, 'README.md'), 'The product.\n');
    await g(checkout, 'add', 'README.md');
    await g(checkout, 'commit', '-q', '-m', 'First');
    await g(checkout, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    await g(checkout, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  } else {
    fs.mkdirSync(path.join(checkout, '.git', 'info'), { recursive: true });
  }
  writeProject(P, {
    folder: checkout, remoteUrl: 'https://github.com/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
  });
  return checkout;
}

export const briefFields = (work, over = {}) => ({
  v: 1, work, lane: 'small', version: 1, goal: 'The goal.', done: ['It works.'], appetite: { sessions: 1, tokens: 100000 },
  rulings: [], routing: {}, shownFirst: false, ...over,
});

export const briefText = (fields) => `\`\`\`json\n${JSON.stringify(fields, null, 2)}\n\`\`\`\n\n# The Wheelhouse override\n\nThe override.\n\n# The goal\n\n${fields.goal}\n`;

// A plan whose one task names `files` under **Files:**.
export const planText = (files) => `# A plan\n\n### Task 1: The task\n\n**Files:**\n${files.map((f) => `- Modify: \`${f}\``).join('\n')}\n\n- [ ] Step 1\n`;

// A feature worktree in the checkout's .claude/worktrees/ (a plain folder, not a git
// worktree), with its brief and, when given, its plan, questions, report and pr.json.
export function worktree(checkout, work, { brief = {}, plan = null, questions = [], report = null, pr = null, rulings = [] } = {}) {
  const dir = path.join(checkout, '.claude', 'worktrees', work);
  const p = featurePaths(dir);
  fs.mkdirSync(p.dir, { recursive: true });
  const fields = briefFields(work, { ...(plan ? { plan: plan.path } : {}), ...brief });
  fs.writeFileSync(p.brief, briefText(fields));
  if (plan) {
    fs.mkdirSync(path.dirname(path.join(dir, plan.path)), { recursive: true });
    fs.writeFileSync(path.join(dir, plan.path), planText(plan.files));
  }
  if (questions.length > 0) fs.writeFileSync(p.questions, questions.map((q) => `${JSON.stringify(q)}\n`).join(''));
  if (report !== null) fs.writeFileSync(p.report, report);
  if (pr !== null) fs.writeFileSync(p.pr, `${JSON.stringify(typeof pr === 'number' ? { pr } : pr)}\n`);
  if (rulings.length > 0) fs.writeFileSync(p.rulings, rulings.map((r) => `${JSON.stringify(r)}\n`).join(''));
  return dir;
}

export const reportText = (work, over = {}, body = 'Shipped the export. Tests pass.') => `\`\`\`json\n${JSON.stringify({
  v: 1, work, status: 'done', tests: 'npm test: 12 pass', assumptions: [], concerns: [], rulings: [], ...over,
}, null, 2)}\n\`\`\`\n\n${body}\n`;

// --- The views ---

export const workView = (id, {
  lane = 'small', approved = true, since = '2026-10-19T08:00:00.000Z', dependsOn = [], visible = false, shownFirst = false, place, doc,
} = {}) => ({
  work: {
    key: id, id: `w-${id}`, at: since, data: { id, title: `Title of ${id}`, lane, visible, dependsOn, ...(place === undefined ? {} : { place }), ...(doc ? { doc } : {}) },
  },
  since,
  approved,
  ...(approved ? { approval: { hash: HASH, shownFirst, lane } } : {}),
});

export const featureView = (work, data, at = '2026-10-19T08:30:00.000Z') => ({ key: work, id: `f-${work}`, at, data: { work, ...data } });

export const emptyViews = () => ({ work: {}, features: {}, reports: {}, questions: {}, rulebook: [] });

// A stand-in helper. `views` is laid over by each write, as the helper's
// rebuilt views would be. Each write notes whether its id was already handled.
export function fakeClient({ views = emptyViews(), cfg = config(), answers = {} } = {}) {
  const writes = [];
  const calls = [];
  let tick = 0;
  const at = () => new Date(T0 + 1000 * (tick += 1)).toISOString();
  const lay = (kind, data, id) => {
    const t = at();
    if (kind === 'feature') views.features[data.work] = { key: data.work, id, at: t, data };
    else if (kind === 'report') views.reports[data.work] = { key: data.work, id, at: t, data };
    else if (kind === 'question') views.questions[data.id] = { question: { key: data.id, id, at: t, data }, answer: null };
    else if (kind === 'work') views.work[data.id] = { work: { key: data.id, id, at: t, data }, since: views.work[data.id]?.since ?? t, approved: false };
  };
  const client = {
    config: async () => (cfg === null ? { ok: false, refused: 'the helper could not be reached' } : { ok: true, config: cfg }),
    state: {
      views: async () => ({ ok: true, views: structuredClone(views) }),
      write: async ({ project: p, kind, data, id }) => {
        writes.push({ project: p, kind, data, id, handledFirst: readHandled(P, { now: () => new Date(T0 + 1000 * tick) }).has(id) });
        lay(kind, data, id);
        putInState({ ...makeEvent({ kind, data, now: () => new Date(T0 + 1000 * tick) }), id });
        return { ok: true, id, pushed: true };
      },
    },
    prState: async (body) => { calls.push(['prState', body]); return answers.prState ?? { ok: true, result: { state: 'open', headSha: 'b'.repeat(40) } }; },
    updateBranch: async (body) => { calls.push(['updateBranch', body]); return answers.updateBranch ?? { ok: false, refused: 'unknown request' }; },
    merge: async (body) => { calls.push(['merge', body]); return answers.merge ?? { ok: true, merged: true, sha: 'c'.repeat(40) }; },
    review: async (body) => { calls.push(['review', body]); return answers.review ?? { ok: true, started: true }; },
    fetchBase: async (body) => { calls.push(['fetchBase', body]); return answers.fetchBase ? answers.fetchBase(body) : { ok: false, refused: 'unknown request' }; },
  };
  return { client, writes, calls, views };
}

// An event put straight into the project's state clone, as the helper's write leaves it.
export function putInState(event) {
  const file = path.join(stateDir(P), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(event));
  return event;
}

// A plain event recorded in the state clone at `at` (milliseconds).
export const recordInState = (kind, data, at) => putInState(makeEvent({ kind, data, now: () => new Date(at) }));

// A wake record as the watcher writes it, at `file`.
export function wakeFile(dir, name, { events = [], digest = [], dropped = 0, note = 'A wake may repeat.' } = {}) {
  const file = path.join(dir, `${name}.json`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ v: 1, to: 'foreman', at: new Date(T0).toISOString(), note, events, digest, dropped }, null, 2)}\n`);
  return file;
}
