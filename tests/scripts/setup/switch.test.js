// tests/scripts/setup/switch.test.js
// The switch to the new engine, per project (Archon design, section 17, step 2): which engine builds each piece once a
// project switches, and the one card that offers the switch to a project set up before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dispatch } from '../../../scripts/engine/dispatcher.js';
import { queueToStart } from '../../../scripts/foreman/wake.js';
import { onNewEngine } from '../../../scripts/engine/lanes.js';
import { switchDue, SWITCH_SETTING } from '../../../scripts/setup/switch.js';
import { POLICY_FILE } from '../../../scripts/setup/engine-parts.js';
import { settingCard } from '../../../scripts/frontdesk/cli.js';
import { settingWords } from '../../../scripts/settings/effective.js';
import { tempFolder } from '../../helpers/homes.js';

const NOW = new Date('2026-10-30T12:00:00.000Z');
const QUEUED = '2026-10-30T08:00:00.000Z';
const piece = (id, lane = 'quick') => ({ work: { key: id, id: `w-${id}`, at: QUEUED, data: { id, title: id, lane, visible: false, dependsOn: [] } }, approved: true, since: QUEUED });
const ON_ARCHON = { engine: { key: 'engine', id: 's1', at: '2026-10-30T09:00:00.000Z', value: 'archon', before: null, confirmedAt: '2026-10-30T09:01:00.000Z' } };
const views = (settings = {}) => ({
  work: { old: piece('old'), fresh: piece('fresh'), planned: piece('planned', 'small') },
  // The old engine started `old` before the switch: its feature is building.
  features: { old: { key: 'old', at: '2026-10-30T08:30:00.000Z', data: { step: 'building' } } },
  reports: {}, runs: {}, settings,
});
const toDispatch = (v) => dispatch({ work: v.work, runs: v.runs, reports: v.reports, features: v.features, settings: { engineLanes: ['quick'] }, now: NOW });

test('a piece mid-build on the old engine finishes there after the switch', () => {
  const v = views(ON_ARCHON);
  assert.equal(onNewEngine(v, 'old', { now: NOW }), false);
  assert.ok(!toDispatch(v).start.some((s) => s.work === 'old'), 'the new engine never starts it');
  assert.ok(!toDispatch(v).hold.some((h) => h.work === 'old'));
  // It keeps its slot on the old engine, which builds it on.
  assert.ok(!queueToStart(v, { now: NOW }).hold.some((h) => h.work === 'old'));
});

test('new quick work goes to the new engine after the switch', () => {
  const before = views();
  assert.equal(onNewEngine(before, 'fresh', { now: NOW }), false);
  assert.ok(queueToStart(before, { now: NOW }).start.includes('fresh'), 'before the switch the old engine takes it');
  const after = views(ON_ARCHON);
  assert.equal(onNewEngine(after, 'fresh', { now: NOW }), true);
  assert.ok(!queueToStart(after, { now: NOW }).start.includes('fresh'), 'the old engine leaves it');
  assert.deepEqual(toDispatch(after).start.map((s) => s.work), ['fresh']);
  // A lane not on the new engine stays with the old one.
  assert.equal(onNewEngine(after, 'planned', { now: NOW }), false);
});

// A project set up before, on GitHub, with the policy file in its folder and the engine installed here.
function before({ policy = true } = {}) {
  const folder = tempFolder('wh-switch ');
  if (policy) {
    fs.mkdirSync(path.join(folder, path.dirname(POLICY_FILE)), { recursive: true });
    fs.writeFileSync(path.join(folder, POLICY_FILE), '["o"]\n');
  }
  return { settings: {}, unconfirmed: [], cards: [], record: { host: 'github' }, folder, platform: 'darwin', installed: () => true };
}

test('the switch card is offered once, to a project set up before, where the switch can work', () => {
  assert.equal(switchDue(before()), true);
  // Once its card is written, or its setting proposed, or the project already chose an engine, it isn't again.
  const { card } = settingCard({ kind: 'setting', id: 'e1', data: { ...SWITCH_SETTING, words: settingWords('engine', 'archon') } }, { glossary: {} });
  assert.equal(switchDue({ ...before(), cards: [card] }), false);
  assert.equal(switchDue({ ...before(), unconfirmed: [{ kind: 'setting', data: { key: 'engine', value: 'archon' } }] }), false);
  assert.equal(switchDue({ ...before(), settings: ON_ARCHON }), false);
  assert.equal(switchDue({ ...before(), settings: { engine: { ...ON_ARCHON.engine, value: 'wheelhouse' } } }), false);
  // Not where it can't work.
  assert.equal(switchDue({ ...before(), platform: 'win32' }), false);
  assert.equal(switchDue({ ...before(), record: { host: 'gitlab' } }), false);
  assert.equal(switchDue({ ...before(), installed: () => false }), false);
  assert.equal(switchDue(before({ policy: false })), false);
});

test('the switch card is level 3, its one option recommended, and says what switching does', () => {
  const { card } = settingCard({ kind: 'setting', id: 'e1', data: { ...SWITCH_SETTING, words: settingWords('engine', 'archon') } }, { glossary: {} });
  assert.equal(card.level, 3);
  assert.equal(card.recommend, 'Confirm');
  assert.deepEqual(card.options.slice(0, 1), ['Confirm']);
  assert.match(card.descriptions[0], /^Recommended: .*new quick changes are then built by the new engine/);
  assert.match(card.question, /Build engine: Archon/);
});
