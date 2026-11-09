// tests/scripts/hooks/board-context-orphans.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decide, orphanedApprovals, orphanLine } from '../../../scripts/hooks/board-context.js';
import { approveWorkLine } from '../../../scripts/state/card-lines.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { markSeen } from '../../../scripts/briefing/seen.js';
import { wheelhouseHome } from '../../../scripts/lib/paths.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { inHome, P } from '../../helpers/decisions-world.js';

const NOW = '2026-11-08T12:00:00.000Z';
const HASH = 'a'.repeat(64);
const at = (iso) => () => new Date(iso);
const put = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};

// A work as the work view holds it.
const workView = (id, lane, { approved = false, visible, from, when = '2026-11-08T08:00:00.000Z' } = {}) => ({
  work: { key: id, id: `e-${id}`, at: when, data: { id, lane, doc: { hash: HASH }, ...(visible === undefined ? {} : { visible }), ...(from === undefined ? {} : { from }) } },
  since: when,
  approved,
});
const card = (work, asked = null) => ({ id: `c-${work}`, asked, data: { kind: 'approve-work', line: approveWorkLine(work, 'small', HASH) } });

test('an unapproved small-lane work with no card is orphaned', () => {
  assert.deepEqual(orphanedApprovals({ work: { 'a-1': workView('a-1', 'small') }, features: {}, reports: {}, waiting: [] }), ['a-1']);
});

test('a card for the work, asked or not, leaves it out', () => {
  const views = (waiting) => ({ work: { 'a-1': workView('a-1', 'small') }, features: {}, reports: {}, waiting });
  assert.deepEqual(orphanedApprovals(views([card('a-1')])), []);
  assert.deepEqual(orphanedApprovals(views([card('a-1', '2026-11-08T09:00:00.000Z')])), []);
});

test('approved, ended and invisible quick works are not orphaned', () => {
  assert.deepEqual(orphanedApprovals({ work: { 'a-1': workView('a-1', 'small', { approved: true }) }, features: {}, reports: {}, waiting: [] }), []);
  const ended = { 'a-1': { at: '2026-11-08T10:00:00.000Z', data: { outcome: 'merged' } } };
  assert.deepEqual(orphanedApprovals({ work: { 'a-1': workView('a-1', 'small') }, features: {}, reports: ended, waiting: [] }), []);
  assert.deepEqual(orphanedApprovals({ work: { 'a-1': workView('a-1', 'quick', { visible: false }) }, features: {}, reports: {}, waiting: [] }), []);
});

test('a card for a-10 does not hide a-1', () => {
  const views = { work: { 'a-1': workView('a-1', 'small') }, features: {}, reports: {}, waiting: [card('a-10')] };
  assert.deepEqual(orphanedApprovals(views), ['a-1']);
});

test('views it cannot read give none', () => {
  assert.deepEqual(orphanedApprovals(undefined), []);
  assert.deepEqual(orphanedApprovals({}), []);
  assert.deepEqual(orphanedApprovals({ work: 'x', waiting: 3 }), []);
});

test('the line names at most three and counts the rest', () => {
  assert.equal(
    orphanLine(['a', 'b', 'c', 'd', 'e']),
    'Waiting for the director\'s approval with no card: a, b, c and 2 more. Run `cli.js cards`: it makes each one\'s approval card. Ask the cards it hands out this turn.',
  );
  assert.equal(orphanLine(['a']), 'Waiting for the director\'s approval with no card: a. Run `cli.js cards`: it makes each one\'s approval card. Ask the cards it hands out this turn.');
  assert.equal(orphanLine([]), null);
});

function register(home, { waiting = [] } = {}) {
  const repo = path.join(home, 'repo');
  put(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeProject(P, { folder: repo, remoteUrl: 'https://example.com/owner/harbour-demo.git', host: 'github', repo: 'owner/harbour-demo', connection: {} });
  const views = path.join(wheelhouseHome(), 'projects', P, 'views');
  put(path.join(views, 'waiting.json'), waiting);
  put(path.join(views, 'work.json'), { 'a-1': workView('a-1', 'small') });
  put(path.join(views, 'features.json'), {});
  put(path.join(views, 'reports.json'), {});
  markSeen(P, { promptAt: new Date('2026-11-08T11:59:00.000Z') });
  return repo;
}
const client = { health: async () => ({ ok: true }), lock: { read: async () => ({ ok: true, result: null }) } };
const ask = (repo, text) => decide({ cwd: repo, session_id: 's-desk', hook_event_name: 'UserPromptSubmit', prompt: text }, { now: at(NOW), env: {}, client });
const contextOf = (out) => out?.hookSpecificOutput?.additionalContext;

test('the turn carries the line on every prompt while the work has no card', async () => {
  await inHome(async (home) => {
    const repo = register(home);
    assert.match(contextOf(await ask(repo, 'Hello')), /Waiting for the director's approval with no card: a-1\. Run `cli\.js cards`/);
    assert.match(contextOf(await ask(repo, 'And again')), /Waiting for the director's approval with no card: a-1\./);
  });
});

test('no line under All stop, or with the card waiting', async () => {
  await inHome(async (home) => {
    const repo = register(home);
    setStop({ by: 'prompt' });
    assert.ok(!String(contextOf(await ask(repo, 'Hello')) ?? '').includes('no card'));
  });
  await inHome(async (home) => {
    const repo = register(home, { waiting: [card('a-1')] });
    assert.ok(!String(contextOf(await ask(repo, 'Hello')) ?? '').includes('no card'));
  });
});
