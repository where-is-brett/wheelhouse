// tests/scripts/settings/catalogue.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS, checkSetting } from '../../../scripts/settings/catalogue.js';
import { BRIEFING_GAP_HOURS, UNUSUAL } from '../../../scripts/lib/core-numbers.js';

test('every setting in design section 14 is in the catalogue, with its default', () => {
  const expected = {
    autonomy: ['project', 'balanced'],
    showFirst: ['project', 'visual'],
    milestones: ['project', 'ask'],
    efficiency: ['project', 'balanced'],
    budget: ['project', 'report'],
    pace: ['project', 3],
    phase: ['project', 'before-launch'],
    presence: ['profile', 'here'],
    briefing: ['profile', 'standard'],
    briefingGapHours: ['profile', BRIEFING_GAP_HOURS],
    explanations: ['profile', 'plain'],
    notifications: ['profile', { channels: ['claude'] }],
    boardTab: ['profile', 'director'],
    hours: ['profile', null],
    roundCap: ['project', 3],
    compactPrepare: ['project', 200000],
    delegationReviewDays: ['project', 14],
    unusualFactor: ['project', UNUSUAL.factor],
    sources: ['project', []],
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
