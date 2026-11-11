// tests/probes/haiku-trial/sessions.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { recordedFeatureSessions, liveFeatureSessions } from '../../../probes/haiku-trial/sessions.js';
import { tempFolder } from '../../helpers/homes.js';

const put = (dir, file, obj) => {
  fs.mkdirSync(path.join(dir, 'running'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'running', file), typeof obj === 'string' ? obj : JSON.stringify(obj));
};

test('recorded feature sessions are the running records whose process is alive', () => {
  const dir = tempFolder('wh-sessions-');
  put(dir, 'feature-import-csv.json', { state: 'running', pid: 11, at: '2026-11-09T01:00:00Z' });
  put(dir, 'feature-gone.json', { state: 'running', pid: 12, at: '2026-11-09T01:00:00Z' });
  put(dir, 'feature-ended.json', { state: 'ended', pid: 13, at: '2026-11-09T01:00:00Z' });
  put(dir, 'foreman.json', { state: 'running', pid: 14, at: '2026-11-09T01:00:00Z' });
  put(dir, 'feature-broken.json', '{not json');
  put(dir, 'feature-nopid.json', { state: 'running', at: '2026-11-09T01:00:00Z' });
  const got = recordedFeatureSessions('owner__repo', { dir, alive: (pid) => pid !== 12 });
  assert.deepEqual(got, [{ work: 'import-csv', pid: 11, at: '2026-11-09T01:00:00Z' }]);
});

test('no records folder means no sessions', () => {
  assert.deepEqual(recordedFeatureSessions('owner__repo', { dir: path.join(tempFolder('wh-sessions-none-'), 'nothing') }), []);
});

test('live feature sessions lists the works that are running, for every project', () => {
  const home = tempFolder('wh-sessions-home-');
  for (const [project, work, pid] of [['a__one', 'p1-import', 21], ['b__two', 'p2-export', 22]]) {
    put(path.join(home, 'projects', project, 'watcher'), `feature-${work}.json`, { state: 'running', pid, at: '2026-11-09T01:00:00Z' });
  }
  const got = liveFeatureSessions({ projectsRoot: path.join(home, 'projects'), alive: () => true });
  assert.deepEqual(got.map((s) => `${s.project}/${s.work}`).sort(), ['a__one/p1-import', 'b__two/p2-export']);
  assert.deepEqual(liveFeatureSessions({ projectsRoot: path.join(home, 'projects'), alive: () => false }), []);
});

test('recorded feature worktrees are the watcher session records whose worktree is there, newest first', async () => {
  const { recordedFeatureWorktrees } = await import('../../../probes/haiku-trial/sessions.js');
  const dir = tempFolder('wh-sessions-wt-');
  const put2 = (file, obj) => {
    fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sessions', file), typeof obj === 'string' ? obj : JSON.stringify(obj));
  };
  put2('month-page.json', { sessionId: 'a', worktree: '/w/month-page', at: '2026-11-11T01:36:32.872Z' });
  put2('refund.json', { sessionId: 'b', worktree: '/w/refund', at: '2026-11-11T01:36:22.000Z' });
  put2('removed.json', { sessionId: 'c', worktree: '/w/removed', at: '2026-11-11T02:00:00.000Z' });
  put2('broken.json', '{not json');
  put2('noworktree.json', { sessionId: 'd' });
  const got = recordedFeatureWorktrees('owner__repo', { dir, exists: (p) => p !== '/w/removed' });
  assert.deepEqual(got.map((s) => `${s.work}:${s.worktree}`), ['month-page:/w/month-page', 'refund:/w/refund']);
  assert.deepEqual(recordedFeatureWorktrees('owner__repo', { dir: path.join(dir, 'nothing') }), []);
});
