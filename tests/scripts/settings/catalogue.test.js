// tests/scripts/settings/catalogue.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS, WINDOWS_BUILD_COMMANDS, checkSetting, definitionOf } from '../../../scripts/settings/catalogue.js';
import { PACE, paceOf } from '../../../scripts/lib/build-loop.js';
import { BRIEFING_GAP_HOURS, UNUSUAL } from '../../../scripts/lib/core-numbers.js';
import { DEFAULT_SOURCES } from '../../../scripts/sources/list.js';

test('every setting in design section 14 is in the catalogue, with its default', () => {
  const expected = {
    autonomy: ['project', 'balanced'],
    showFirst: ['project', 'visual'],
    milestones: ['project', 'ask'],
    efficiency: ['project', 'balanced'],
    premium: ['project', 'off'],
    budget: ['project', 'report'],
    pace: ['project', 3],
    phase: ['project', 'before-launch'],
    presence: ['profile', 'here'],
    briefing: ['profile', 'standard'],
    briefingGapHours: ['profile', BRIEFING_GAP_HOURS],
    explanations: ['profile', 'plain'],
    usageMark: ['profile', 75],
    notifications: ['profile', { channels: ['claude'] }],
    boardTab: ['profile', 'director'],
    hours: ['profile', null],
    roundCap: ['project', 3],
    compactPrepare: ['project', 200000],
    delegationReviewDays: ['project', 14],
    unusualFactor: ['project', UNUSUAL.factor],
    sources: ['project', DEFAULT_SOURCES.map((source) => source.url)],
    engine: ['project', 'wheelhouse'],
    engineLanes: ['project', ['quick']],
    cardsPerDay: ['project', 3],
    capMinutes: ['project', { quick: 20, small: 60, slice: 120, bug: 30 }],
    capTokens: ['project', { quick: 1000000, small: 4000000, slice: 10000000, bug: 2000000 }],
    capRequests: ['project', 0],
    bundleApprovals: ['project', false],
    engineRoom: ['project', false],
  };
  assert.deepEqual(Object.keys(SETTINGS).sort(), Object.keys(expected).sort());
  for (const [key, [home, def]] of Object.entries(expected)) {
    assert.equal(SETTINGS[key].home, home, key);
    assert.deepEqual(SETTINGS[key].default, def, key);
    assert.doesNotThrow(() => checkSetting(key, SETTINGS[key].default), `${key}'s own default is allowed`);
  }
  assert.equal(SETTINGS.presence.temporary, true);
  assert.deepEqual(SETTINGS.autonomy.levels, ['cautious', 'balanced', 'trusting']);
  assert.deepEqual(SETTINGS.pace.levels, [1, 2, 3]);
  assert.deepEqual(SETTINGS.presence.levels, ['here', 'away', 'dnd']);
  assert.doesNotThrow(() => checkSetting('known:feature-flags', true));
  assert.doesNotThrow(() => checkSetting('known:feature-flags', false));
});

test('a level outside a setting\'s list is refused in plain words', () => {
  assert.throws(() => checkSetting('autonomy', 'reckless'), { message: 'autonomy can\'t be reckless' });
  assert.throws(() => checkSetting('pace', 4), { message: 'pace can\'t be 4' });
  assert.throws(() => checkSetting('pace', '2'), /pace can't be 2/);
  assert.throws(() => checkSetting('nonsense', 'x'), { message: 'Wheelhouse has no setting called nonsense' });
  assert.throws(() => checkSetting('constructor', 'x'), /no setting called constructor/);
  assert.throws(() => checkSetting('known:Bad Name', true), /no setting called known:Bad Name/);
  assert.throws(() => checkSetting('known:git', 'yes'), /known:git can't be yes/);
  assert.throws(() => checkSetting('briefingGapHours', 0), /can't be 0/);
  assert.throws(() => checkSetting('briefingGapHours', 25), /can't be 25/);
  assert.throws(() => checkSetting('briefingGapHours', 1.5), /can't be 1.5/);
  assert.doesNotThrow(() => checkSetting('briefingGapHours', 24));
  assert.throws(() => checkSetting('roundCap', 6), /roundCap can't be 6/);
  assert.throws(() => checkSetting('compactPrepare', 99999), /can't be 99999/);
  assert.throws(() => checkSetting('compactPrepare', 290001), /can't be 290001/);
  assert.throws(() => checkSetting('delegationReviewDays', 6), /can't be 6/);
  assert.throws(() => checkSetting('unusualFactor', 11), /can't be 11/);
  assert.throws(() => checkSetting('unusualFactor', 1), /can't be 1/);
});

test('notifications, hours and sources are checked by their shape', () => {
  assert.doesNotThrow(() => checkSetting('notifications', { channels: ['claude', 'ntfy'], quiet: { from: '22:00', to: '07:00' } }));
  assert.doesNotThrow(() => checkSetting('notifications', { channels: [] }));
  assert.throws(() => checkSetting('notifications', { channels: ['sms'] }), /notifications can't be/);
  assert.throws(() => checkSetting('notifications', { channels: ['claude'], quiet: { from: '25:00', to: '07:00' } }), /notifications can't be/);
  assert.throws(() => checkSetting('notifications', { channels: ['claude'], extra: 1 }), /notifications can't be/);
  assert.throws(() => checkSetting('notifications', 'claude'), /notifications can't be claude/);
  assert.doesNotThrow(() => checkSetting('hours', null));
  assert.doesNotThrow(() => checkSetting('hours', { days: [1, 2, 3, 4, 5], from: '09:00', to: '17:30' }));
  assert.throws(() => checkSetting('hours', { days: [7], from: '09:00', to: '17:30' }), /hours can't be/);
  assert.throws(() => checkSetting('hours', { days: [1], from: '9:00', to: '17:30' }), /hours can't be/);
  assert.doesNotThrow(() => checkSetting('sources', ['https://docs.example.com/a']));
  assert.doesNotThrow(() => checkSetting('sources', []));
  assert.throws(() => checkSetting('sources', ['http://docs.example.com/a']), /sources can't be/);
  assert.throws(() => checkSetting('sources', 'https://docs.example.com/a'), /sources can't be/);
});

test('budget accepts only report while budget allocation is in the backlog', () => {
  assert.doesNotThrow(() => checkSetting('budget', 'report'));
  assert.throws(() => checkSetting('budget', 'weekly-share'), { message: 'budget can\'t be weekly-share' });
  assert.throws(() => checkSetting('budget', 'per-feature'), /budget can't be per-feature/);
  assert.deepEqual(SETTINGS.budget.levels, ['report', 'weekly-share', 'per-feature']);
  assert.deepEqual(SETTINGS.budget.only, ['report']);
});

test('until is refused on a setting that is not temporary', () => {
  assert.doesNotThrow(() => checkSetting('presence', 'away', '2026-10-18T18:00:00.000Z'));
  assert.throws(() => checkSetting('autonomy', 'cautious', '2026-10-18T18:00:00.000Z'), { message: 'autonomy can\'t have an end time' });
  assert.throws(() => checkSetting('presence', 'away', 'six o\'clock'), /presence can't end at six o'clock/);
  assert.doesNotThrow(() => checkSetting('autonomy', 'cautious', undefined));
});

test('build commands on Windows is a setting per computer, kept in the project, Ask by default', () => {
  const def = definitionOf('windowsBuildCommands:0a1b2c3d');
  assert.equal(def, WINDOWS_BUILD_COMMANDS);
  assert.deepEqual(def.levels, ['ask', 'guarded', 'unattended']);
  assert.equal(def.default, 'ask');
  assert.equal(def.home, 'project');
  assert.equal(def.group, 'everyday');
  assert.equal(def.label, 'Build commands on Windows');
  for (const value of ['ask', 'guarded', 'unattended']) assert.doesNotThrow(() => checkSetting('windowsBuildCommands:0a1b2c3d', value));
  assert.throws(() => checkSetting('windowsBuildCommands:0a1b2c3d', 'always'), /can't be always/);
  assert.throws(() => checkSetting('windowsBuildCommands:0a1b2c3d', 'ask', '2026-10-19T18:00:00.000Z'), /can't have an end time/);
  for (const key of ['windowsBuildCommands', 'windowsBuildCommands:', 'windowsBuildCommands:0A1B2C3D', 'windowsBuildCommands:0a1b2c3', 'windowsBuildCommands:0a1b2c3d4']) {
    assert.throws(() => checkSetting(key, 'ask'), /no setting called/, key);
  }
});

test('Thoroughness has four levels, Premium model three and Usage nudge five', () => {
  assert.deepEqual(SETTINGS.efficiency.levels, ['lightest', 'lean', 'balanced', 'thorough']);
  assert.deepEqual([SETTINGS.premium.label, SETTINGS.premium.levels], ['Premium model', ['off', 'within-plan', 'paid-too']]);
  assert.deepEqual([SETTINGS.usageMark.label, SETTINGS.usageMark.levels], ['Usage nudge', ['off', 50, 65, 75, 90]]);
  for (const level of ['lightest', 'lean', 'balanced', 'thorough']) assert.doesNotThrow(() => checkSetting('efficiency', level));
  assert.throws(() => checkSetting('efficiency', 'max'));
  assert.doesNotThrow(() => checkSetting('usageMark', 90));
  assert.throws(() => checkSetting('usageMark', 80));
  assert.throws(() => checkSetting('premium', 'on'));
});

test('engine accepts wheelhouse and archon only', () => {
  assert.deepEqual(SETTINGS.engine.levels, ['wheelhouse', 'archon']);
  assert.equal(SETTINGS.engine.group, 'advanced');
  for (const value of ['wheelhouse', 'archon']) assert.doesNotThrow(() => checkSetting('engine', value));
  assert.throws(() => checkSetting('engine', 'bun'), /engine can't be bun/);
});

test('engineLanes refuses an unknown lane', () => {
  assert.doesNotThrow(() => checkSetting('engineLanes', []));
  assert.doesNotThrow(() => checkSetting('engineLanes', ['quick', 'small', 'bug', 'feature']));
  assert.throws(() => checkSetting('engineLanes', ['quick', 'huge']), /engineLanes can't be/);
  assert.throws(() => checkSetting('engineLanes', 'quick'), /engineLanes can't be quick/);
});

test('cardsPerDay refuses 0 and 11', () => {
  assert.equal(SETTINGS.cardsPerDay.group, 'everyday');
  for (const value of [1, 10]) assert.doesNotThrow(() => checkSetting('cardsPerDay', value));
  for (const value of [0, 11, 2.5, '3']) assert.throws(() => checkSetting('cardsPerDay', value), /cardsPerDay can't be/);
});

test('the caps take positive whole numbers for each kind of work and nothing else', () => {
  assert.doesNotThrow(() => checkSetting('capMinutes', { quick: 1, small: 2, slice: 3, bug: 4 }));
  assert.throws(() => checkSetting('capMinutes', { quick: 0, small: 60, slice: 120, bug: 30 }), /capMinutes can't be/);
  assert.throws(() => checkSetting('capMinutes', { quick: 20, small: 60, slice: 120 }), /capMinutes can't be/);
  assert.throws(() => checkSetting('capTokens', { quick: 1, small: 2, slice: 3, bug: 4, feature: 5 }), /capTokens can't be/);
  assert.throws(() => checkSetting('capTokens', { quick: 1.5, small: 2, slice: 3, bug: 4 }), /capTokens can't be/);
  assert.doesNotThrow(() => checkSetting('capRequests', 50));
  assert.throws(() => checkSetting('capRequests', -1), /capRequests can't be/);
  assert.throws(() => checkSetting('capRequests', 2.5), /capRequests can't be/);
  assert.throws(() => checkSetting('bundleApprovals', 'yes'), /bundleApprovals can't be yes/);
  assert.throws(() => checkSetting('engineRoom', 1), /engineRoom can't be 1/);
});

test('paceOf reads the pace setting and falls back to three', () => {
  assert.deepEqual(paceOf({ pace: { value: 2 } }), { building: 2, featureLane: PACE.featureLane });
  assert.deepEqual(paceOf({ pace: { value: 1 } }), { building: 1, featureLane: 1 });
  for (const settings of [undefined, null, {}, { pace: { value: 7 } }, { pace: { value: 'many' } }]) assert.deepEqual(paceOf(settings), PACE);
  assert.equal(PACE.building, 3);
});
