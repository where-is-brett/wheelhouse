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
import { switchDue, engineReady, SWITCH_SETTING, SWITCH_NAME, SWITCH_WORK } from '../../../scripts/engine/switch.js';
import { gateInput } from '../../../scripts/cards/build-loop.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { mirrorRulesFile } from '../../../scripts/setup/engine-parts.js';
import { engineForProject } from '../../../scripts/host/helper-main.js';
import { settingCard } from '../../../scripts/frontdesk/cli.js';
import { settingWords } from '../../../scripts/settings/effective.js';
import { tempFolder, withHome } from '../../helpers/homes.js';
import { visitLearning } from '../../../scripts/desk/visit.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { makeEvent, eventPath, confirmationFor } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { writeViews } from '../../../scripts/state/views.js';

const NOW = new Date('2026-10-30T12:00:00.000Z');
const QUEUED = '2026-10-30T08:00:00.000Z';
const piece = (id, lane = 'quick') => ({ work: { key: id, id: `w-${id}`, at: QUEUED, data: { id, title: id, lane, visible: false, dependsOn: [] } }, approved: true, since: QUEUED });
const ON_ARCHON = { engine: { key: 'engine', id: 's1', at: '2026-10-30T09:00:00.000Z', value: 'archon', before: null, confirmedAt: '2026-10-30T09:01:00.000Z' } };
// `engineOn` is the helper's word that the engine can build the project: true once the switch's pull request merged.
const views = (settings = {}, { engineOn = Object.hasOwn(settings, 'engine') } = {}) => ({
  work: { old: piece('old'), fresh: piece('fresh'), planned: piece('planned', 'small') },
  // The old engine started `old` before the switch: its feature is building.
  features: { old: { key: 'old', at: '2026-10-30T08:30:00.000Z', data: { step: 'building' } } },
  reports: {}, runs: {}, settings, engineOn,
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

test('a switched project stays on the old engine until its pull request merges', () => {
  // Confirmed, but the engine can't build the project yet: the old engine takes new quick work, and the new one has
  // none to start, since the helper gives the dispatcher no engine for the project before then.
  const waiting = views(ON_ARCHON, { engineOn: false });
  assert.equal(onNewEngine(waiting, 'fresh', { now: NOW }), false);
  assert.ok(queueToStart(waiting, { now: NOW }).start.includes('fresh'));
  // Views that don't say (kept ones, when the helper gave none) are the old engine's too.
  assert.equal(onNewEngine({ ...waiting, engineOn: undefined }, 'fresh', { now: NOW }), false);
  const on = views(ON_ARCHON, { engineOn: true });
  assert.equal(onNewEngine(on, 'fresh', { now: NOW }), true);
  assert.ok(!queueToStart(on, { now: NOW }).start.includes('fresh'));
});

test('the engine is on for a project once its fetch-mirror rule is in the engine folder\'s list', () => {
  const engine = tempFolder('wh-engine ');
  assert.equal(engineReady('o__p', { engine }), false);
  fs.mkdirSync(path.join(engine, 'mirrors'), { recursive: true });
  fs.writeFileSync(mirrorRulesFile(engine), `${JSON.stringify({ o__q: 'https://github.com/o/q.git' })}\n`);
  assert.equal(engineReady('o__p', { engine }), false);
  fs.writeFileSync(mirrorRulesFile(engine), `${JSON.stringify({ o__p: 'git@github.com:o/p.git' })}\n`);
  assert.equal(engineReady('o__p', { engine }), false, 'only an https address can be read from the mirror');
  fs.writeFileSync(mirrorRulesFile(engine), `${JSON.stringify({ o__p: 'https://github.com/o/p.git' })}\n`);
  assert.equal(engineReady('o__p', { engine }), true);
  // The real helper gives Archon to the project only from then.
  const engineFor = (ready) => engineForProject({ adapter: () => ({ name: 'archon' }), views: () => ({ project: ON_ARCHON, profile: {} }), ready: () => ready })('o__p');
  assert.equal(engineFor(false), null);
  assert.equal(engineFor(true).name, 'archon');
});

// A project set up before, on GitHub, with the engine installed here: no policy file in its folder yet.
const before = () => ({ settings: {}, unconfirmed: [], cards: [], record: { host: 'github' }, platform: 'darwin', installed: () => true });

test('the switch is offered to a project set up before, with no policy file yet', () => {
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
});

test('the switch card is level 3, its one option recommended, and says what switching does', () => {
  const { card } = settingCard({ kind: 'setting', id: 'e1', data: { ...SWITCH_SETTING, words: settingWords('engine', 'archon') } }, { glossary: {} });
  assert.equal(card.level, 3);
  assert.equal(card.recommend, 'Confirm');
  assert.deepEqual(card.options.slice(0, 1), ['Confirm']);
  assert.match(card.descriptions[0], /^Recommended: .*new quick changes are then built by the new engine, Archon, once you approve the pull request that adds its files/);
  assert.match(card.question, /Build engine: Archon/);
});

test("the switch's approval card is the merge gate's own, naming the switch", () => {
  const entry = { data: { work: SWITCH_WORK, pr: 8, ask: 'approval', sha: 'a'.repeat(40) } };
  const { card } = composeCard({ ...gateInput(entry, SWITCH_NAME), glossary: {} });
  assert.equal(card.level, 3);
  assert.equal(card.recommend, 'Approve');
  assert.match(card.question, /Pull request #8 for the switch to the new build engine has everything else it needs to merge/);
});

test("each visit asks the helper for the switch's next step, until the engine can build the project", async () => {
  await withHome(async () => {
    writeProject('o__p', { folder: tempFolder('wh-p '), remoteUrl: 'https://github.com/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-30T00:00:00.000Z' });
    const put = (kind, data) => {
      const event = makeEvent({ kind, data, now: () => NOW });
      const file = path.join(stateDir('o__p'), eventPath(event));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
      return event;
    };
    const asked = [];
    const client = {
      engineSwitch: async (body) => { asked.push(body); return { ok: true, step: 'opened' }; },
      state: { write: async () => ({ ok: true, id: 'x' }) },
      profile: { write: async () => ({ ok: true, id: 'x' }) },
    };
    const visit = async () => {
      await writeViews('o__p', { now: () => NOW });
      await visitLearning({ project: 'o__p', cwd: '/w', client, at: NOW, boardAsks: [], platform: 'darwin' });
    };
    // Not confirmed yet: nothing is asked of the helper.
    await visit();
    assert.deepEqual(asked, []);
    const setting = put('setting', { key: SWITCH_SETTING.key, value: SWITCH_SETTING.value });
    put('confirmation', confirmationFor(setting).data);
    await visit();
    assert.deepEqual(asked, [{ cwd: '/w' }]);
    // Once the engine can build the project, no more.
    fs.mkdirSync(path.dirname(mirrorRulesFile()), { recursive: true });
    fs.writeFileSync(mirrorRulesFile(), `${JSON.stringify({ o__p: 'https://github.com/o/p.git' })}\n`);
    await visit();
    assert.equal(asked.length, 1);
  });
});
