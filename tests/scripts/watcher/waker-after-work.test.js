// tests/scripts/watcher/waker-after-work.test.js
// What the waker does with an adapter's `afterWork` once a feature's run has been read: it is asked with the feature's
// worktree and the run's output, the records it gives are raised before the run settles, a throw is reported and the run
// still settles, and a foreman's run is never asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeWaker } from '../../../scripts/watcher/waker.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { featurePaths } from '../../../scripts/feature/files.js';
import { readProject, writeProject } from '../../../scripts/lib/projects.js';
import { tempFolder, withHome } from '../../helpers/homes.js';
import { readBaseline, writeBaseline } from '../../../scripts/watcher/control-files.js';

const P = 'o__p';
const T0 = Date.parse('2026-10-19T09:00:00.000Z');
const BIN = `${path.dirname(process.execPath)}:/bin`;
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

function worktree() {
  let main = readProject(P)?.folder;
  if (!main) {
    main = tempFolder('wh-main-');
    fs.mkdirSync(path.join(main, '.git', 'info'), { recursive: true });
    writeProject(P, { folder: main, remoteUrl: 'https://github.com/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
  }
  const parent = path.join(main, '.claude', 'worktrees');
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, 'wt-'));
  fs.mkdirSync(featurePaths(dir).dir, { recursive: true });
  fs.writeFileSync(featurePaths(dir).brief, 'The brief.\n');
  return dir;
}

// A part that reads a run as finished, and keeps what afterWork is asked.
function partWith({ afterWork }) {
  const output = path.join(tempFolder('wh-run-'), 'run.jsonl');
  const asked = [];
  const part = {
    checkForeman: () => {},
    checkFeature: () => {},
    foremanCall: () => ({ file: 'agent', args: [], env: {}, input: '', output }),
    featureStartCall: () => ({ file: 'agent', args: [], env: {}, input: '', output, sessionId: 's1' }),
    featureResumeCall: () => ({ file: 'agent', args: [], env: {}, input: '', output, sessionId: 's1' }),
    finalAnswer: () => null,
    afterRun: () => ({ ok: true, why: null, sessionId: 's1', records: [{ kind: 'activity', data: { role: 'builder' } }] }),
    afterWork: async (options) => { asked.push(options); return afterWork(options); },
  };
  return { part, output, asked };
}

function driven({ afterWork, raise, onError = () => {} }) {
  const dir = worktree();
  writeBaseline(P, 'login-page', dir);
  const { part, output, asked } = partWith({ afterWork });
  const live = new Set();
  let end;
  const run = () => ({ pid: 200, exited: new Promise((resolve) => { live.add(200); end = (code) => { live.delete(200); resolve(code); }; }) });
  const w = makeWaker({
    shape: 1, project: P, config: readConfig(JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], routing: {} })),
    sessions: part, run, alive: (pid) => live.has(pid), startTimeOf: async () => null, now: () => new Date(T0), bootedAt: () => 0,
    claude: { kind: 'direct', file: 'claude' }, baseEnv: { PATH: BIN }, print: () => {}, locate: () => dir, raise, onError, platform: 'darwin',
  });
  const start = () => {
    if (readBaseline(P, 'login-page', dir) === null) writeBaseline(P, 'login-page', dir);
    return w.startFeature({ work: 'login-page', worktree: dir, briefFile: featurePaths(dir).brief });
  };
  return { dir, output, asked, start, end: (code = 0) => end(code) };
}

test('the adapter is asked, with the worktree and the run\'s output, once a feature\'s run ends, and its notes are raised', () => withHome(async () => {
  const raised = [];
  const h = driven({
    afterWork: async () => ({ records: [{ kind: 'note', data: { text: 'A note.' } }] }),
    raise: async (record) => { raised.push(record.kind); },
  });
  await h.start();
  fs.appendFileSync(h.output, 'the run\n');
  h.end(0);
  await flush();
  assert.equal(h.asked.length, 1);
  assert.equal(h.asked[0].target, 'feature-login-page');
  assert.equal(h.asked[0].worktree, h.dir);
  assert.equal(h.asked[0].project, P);
  assert.match(h.asked[0].stdout, /the run/);
  assert.deepEqual(raised, ['activity', 'note'], 'the run\'s own records first, then the work\'s');
}));

test('an afterWork that throws is reported, and the run still settles', () => withHome(async () => {
  const errors = [];
  const raised = [];
  const h = driven({ afterWork: async () => { throw new Error('boom'); }, raise: async (record) => { raised.push(record.kind); }, onError: (e) => errors.push(e) });
  await h.start();
  h.end(0);
  await flush();
  assert.deepEqual(raised, ['activity']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /login-page session left in its worktree couldn't be settled: boom/);
}));
