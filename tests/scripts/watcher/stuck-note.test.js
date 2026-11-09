// tests/scripts/watcher/stuck-note.test.js
// A feature session's one plain "stuck" message (cli.js stuck, a line in questions.jsonl) is read by the watcher, turned into one
// state note by the foreman, and shown once by board-context (design section 6.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { diff, route, step } from '../../../scripts/watcher/core.js';
import { observe } from '../../../scripts/watcher/sources.js';
import { featurePaths } from '../../../scripts/feature/files.js';
import { readProject, writeProject } from '../../../scripts/lib/projects.js';
import { makeEvent, eventPath } from '../../../scripts/state/events.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

const P = 'o__p';
const T0 = Date.parse('2026-11-08T09:00:00.000Z');
const NOTE = { at: '2026-11-08T08:00:00.000Z', why: 'The meanwhile line keeps failing' };
const feature = (over = {}) => ({
  status: null, questions: [], extraPlans: [], skipped: 0, briefHash: 'b1', recordedBrief: 'b1', recordedBefore: null, appetite: 400000, report: false, ...over,
});
const observation = (over = {}) => ({ at: '2026-11-08T09:00:00.000Z', awake: 0, events: [], features: { 'w-tide-1': feature() }, prs: {}, testMerges: [], stop: false, ...over });

test('a stuck line becomes one event for the foreman, once', () => {
  const next = observation({ features: { 'w-tide-1': feature({ stuckNotes: [NOTE] }) } });
  const events = diff(observation(), next, { handled: new Set() }).filter((e) => e.type === 'stuck-note');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { type: 'stuck-note', work: 'w-tide-1', id: `stuck-note:w-tide-1:${NOTE.at}`, detail: { at: NOTE.at, why: NOTE.why } });
  assert.deepEqual(route(events, { handled: new Set() }).foreman.map((e) => e.type), ['stuck-note']);
  // The same note seen again is nothing new, and a later note is one more.
  assert.deepEqual(diff(next, next, { handled: new Set() }), []);
  const later = { at: '2026-11-08T08:30:00.000Z', why: 'Still failing' };
  const more = diff(next, observation({ features: { 'w-tide-1': feature({ stuckNotes: [NOTE, later] }) } }), { handled: new Set() });
  assert.deepEqual(more.map((e) => e.id), [`stuck-note:w-tide-1:${later.at}`]);
});

test('observe reads the stuck lines of a session\'s questions file, and a passing ask later adds none', () => withHome(async () => {
  const main = tempFolder('wh-main-');
  writeProject(P, { folder: main, remoteUrl: 'https://github.com/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
  const dir = path.join(readProject(P).folder, '.claude', 'worktrees', 'wt-1');
  const p = featurePaths(dir);
  fs.mkdirSync(p.dir, { recursive: true });
  const brief = `\`\`\`json\n${JSON.stringify({ v: 1, work: 'w-tide-1', lane: 'feature', version: 1, goal: 'g', done: ['d'], appetite: { sessions: 1, tokens: 1 }, rulings: [], routing: {}, shownFirst: false })}\n\`\`\`\n\nB.\n`;
  fs.writeFileSync(p.brief, brief);
  fs.writeFileSync(p.questions, `${JSON.stringify({ sentBack: true, at: NOTE.at, problems: ['x'] })}\n${JSON.stringify({ stuck: true, ...NOTE })}\n`);
  const event = makeEvent({ kind: 'feature', data: { work: 'w-tide-1', step: 'building', worktree: dir, branch: 'feature/w-tide-1' }, now: () => new Date(T0 - 1000) });
  const file = path.join(stateDir(P), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(event));
  const client = { state: { sync: async () => ({ ok: true }) }, prState: async () => ({ ok: false, refused: 'none' }), ci: async () => ({ ok: false }), testMerge: async () => ({ ok: false }) };
  const seen = await observe({ project: P, client, now: () => new Date(T0), awake: 0 });
  assert.deepEqual(seen.features['w-tide-1'].stuckNotes, [NOTE]);
  assert.equal(seen.features['w-tide-1'].skipped, 0, 'the lines are not malformed');
  // A later ask that passes is a question line: the note stays as it was, and is no new one.
  fs.appendFileSync(p.questions, `${JSON.stringify({ id: 'q-w-tide-1-1', kind: 'question', what: 'w', why: 'y', options: [{ label: 'A', says: 'a' }, { label: 'B', says: 'b' }], recommendation: 'A', level: 3 })}\n`);
  const again = await observe({ project: P, client, now: () => new Date(T0 + 1000), awake: 0 });
  assert.deepEqual(again.features['w-tide-1'].stuckNotes, [NOTE]);
  assert.deepEqual(diff(seen, again, { handled: new Set() }).filter((e) => e.type === 'stuck-note'), []);
}));

test('one note, one wake across passes', () => {
  const next = observation({ features: { 'w-tide-1': feature({ stuckNotes: [NOTE] }) } });
  const first = step({}, next);
  assert.equal(first.events.filter((e) => e.type === 'stuck-note').length, 1);
  const again = step(first.cursor, next);
  assert.deepEqual(again.events.filter((e) => e.type === 'stuck-note'), []);
  // A restart that lost `prev` but kept `seen` wakes nobody twice.
  const restarted = step({ ...first.cursor, prev: null }, next);
  assert.deepEqual(restarted.events.filter((e) => e.type === 'stuck-note'), []);
});
