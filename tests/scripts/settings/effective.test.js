// tests/scripts/settings/effective.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveSettings, settingsText, settingWords, sayValue } from '../../../scripts/settings/effective.js';
import { buildViews } from '../../../scripts/state/views.js';

const entry = (key, value, extra = {}) => ({ key, id: `id-${key}`, at: '2026-10-18T08:00:00.000Z', value, before: null, ...extra });
const view = (...entries) => Object.fromEntries(entries.map((e) => [e.key, e]));
const NOON = '2026-10-18T12:00:00.000Z';
const SEVEN_PM = '2026-10-18T19:00:00.000Z';
const SIX_PM = '2026-10-18T18:00:00.000Z';

test('away until six reverts to the value before it once six has passed', () => {
  const profile = view(entry('presence', 'away', { until: SIX_PM, before: { value: 'dnd' } }));
  const before = effectiveSettings({ project: {}, profile, now: NOON });
  assert.deepEqual(before.presence, { value: 'away', from: 'profile', until: SIX_PM });
  const after = effectiveSettings({ project: {}, profile, now: SEVEN_PM });
  assert.deepEqual(after.presence, { value: 'dnd', from: 'profile' });
  const noPrior = view(entry('presence', 'away', { until: SIX_PM }));
  assert.deepEqual(effectiveSettings({ project: {}, profile: noPrior, now: SEVEN_PM }).presence, { value: 'here', from: 'default' });
});

test('a temporary change over a temporary change falls back to the default when both have ended', () => {
  const profile = view(entry('presence', 'dnd', { until: SIX_PM, before: { value: 'away', until: '2026-10-18T15:00:00.000Z' } }));
  assert.deepEqual(effectiveSettings({ project: {}, profile, now: SEVEN_PM }).presence, { value: 'here', from: 'default' });
  // The earlier one still has time: it is the value in force, with its own end time.
  const longer = view(entry('presence', 'dnd', { until: SIX_PM, before: { value: 'away', until: '2026-10-18T21:00:00.000Z' } }));
  assert.deepEqual(effectiveSettings({ project: {}, profile: longer, now: SEVEN_PM }).presence,
    { value: 'away', from: 'profile', until: '2026-10-18T21:00:00.000Z' });
});

test('the project wins over the profile; the profile wins over the default', () => {
  const project = view(entry('briefing', 'short'), entry('autonomy', 'cautious'));
  const profile = view(entry('briefing', 'detailed'), entry('explanations', 'some-terms'));
  const e = effectiveSettings({ project, profile, now: NOON });
  assert.deepEqual(e.briefing, { value: 'short', from: 'project' });
  assert.deepEqual(e.explanations, { value: 'some-terms', from: 'profile' });
  assert.deepEqual(e.autonomy, { value: 'cautious', from: 'project' });
  assert.deepEqual(e.pace, { value: 3, from: 'default' });
  assert.deepEqual(e.notifications, { value: { channels: ['claude'] }, from: 'default' });
  // An ended project value doesn't hold the key: the profile's shows through.
  const ended = view(entry('briefing', 'short', { until: SIX_PM }));
  assert.deepEqual(effectiveSettings({ project: ended, profile, now: SEVEN_PM }).briefing, { value: 'detailed', from: 'profile' });
});

test('known concepts appear only when set; unknown or invalid entries are ignored', () => {
  const profile = view(entry('known:git', true), entry('known:Bad Name', true), entry('nonsense', 1), entry('budget', 'weekly-share'));
  const e = effectiveSettings({ project: {}, profile, now: NOON });
  assert.deepEqual(e['known:git'], { value: true, from: 'profile' });
  assert.equal('known:Bad Name' in e, false);
  assert.equal('nonsense' in e, false);
  assert.deepEqual(e.budget, { value: 'report', from: 'default' });
  assert.equal(Object.keys(effectiveSettings({ project: {}, profile: {}, now: NOON })).some((k) => k.startsWith('known:')), false);
});

test('the defaults handed out are copies', () => {
  const a = effectiveSettings({ project: {}, profile: {}, now: NOON });
  a.notifications.value.channels.push('ntfy');
  assert.deepEqual(effectiveSettings({ project: {}, profile: {}, now: NOON }).notifications.value, { channels: ['claude'] });
});

test('settingsText says where each value comes from', () => {
  const project = view(entry('autonomy', 'cautious'));
  const profile = view(
    entry('presence', 'away', { until: SIX_PM }),
    entry('known:git', true),
    entry('notifications', { channels: ['claude', 'ntfy'], quiet: { from: '22:00', to: '07:00' } }),
  );
  const text = settingsText(effectiveSettings({ project, profile, now: NOON }));
  const lines = text.split('\n');
  const line = (word) => lines.find((l) => l.toLowerCase().includes(word));
  assert.match(line('autonomy'), /cautious/);
  assert.match(line('autonomy'), /this project/);
  assert.match(line('availability'), /away/);
  assert.match(line('availability'), /until 18 October 2026, 18:00 UTC/);
  assert.match(line('availability'), /yours/);
  assert.match(line('crew at once'), /the default/);
  assert.match(line('notifications'), /claude, ntfy/);
  assert.match(line('notifications'), /22:00/);
  assert.match(line('git'), /yours/);
  assert.ok(lines.every((l) => l.trim() !== '' && !l.includes('\n')));
  // Everyday settings come before advanced ones.
  assert.ok(lines.findIndex((l) => /autonomy/i.test(l)) < lines.findIndex((l) => /review round/i.test(l)));
  assert.ok(lines.findIndex((l) => /pace/i.test(l)) < lines.findIndex((l) => /compact/i.test(l)));
});

test('known set to false counts at once and is not listed as unconfirmed; known set to true waits', () => {
  // Plain setting events, as learning writes them, with no confirmation of either.
  const event = (id, key, value, n) => ({ v: 1, id, at: `2026-10-18T0${n}:00:00.000Z`, computer: 'aaaaaaaa', kind: 'setting', data: { key, value, words: settingWords(key, value) } });
  const views = buildViews([
    event('s1', 'known:pull-request', false, 1),
    event('s2', 'known:ci', true, 2),
    event('s3', 'explanations', 'some-terms', 3),
  ], [], { now: () => new Date(NOON) });
  const e = effectiveSettings({ project: {}, profile: views.settings, now: NOON });
  assert.deepEqual(e['known:pull-request'], { value: false, from: 'profile' });
  assert.equal('known:ci' in e, false);
  assert.deepEqual(e.explanations, { value: 'plain', from: 'default' });
  assert.deepEqual(views.unconfirmed.map((u) => u.id), ['s2', 's3']);

  // Known, confirmed: a later false takes it back at once and remembers what it replaced.
  const confirmedTrue = buildViews([event('s1', 'known:ci', true, 1), event('s2', 'known:ci', false, 2)], [], { now: () => new Date(NOON) });
  assert.equal(confirmedTrue.settings['known:ci'].value, false);
  assert.deepEqual(confirmedTrue.unconfirmed, []);
  // A true proposed after a false waits, and the false stays in force.
  const back = buildViews([event('s1', 'known:ci', false, 1), event('s2', 'known:ci', true, 2)], [], { now: () => new Date(NOON) });
  assert.equal(back.settings['known:ci'].value, false);
  assert.deepEqual(back.unconfirmed.map((u) => u.id), ['s2']);
});

test('settingWords names a setting and its value in plain words, on one line', () => {
  assert.equal(settingWords('boardTab', 'build'), 'Logbook opens on: build');
  assert.equal(settingWords('known:pull-request', true), 'Knows "pull request": yes');
  assert.equal(settingWords('known:ci', false), 'Knows "ci": no');
  assert.equal(settingWords('explanations', 'plain'), 'Explanations: plain');
  assert.equal(settingWords('presence', 'away', SIX_PM), 'Availability: away, until 18 October 2026, 18:00 UTC');
  assert.equal(settingWords('pace', 2), 'Crew at once: 2');
  // The settings list says each the same way.
  assert.match(settingsText(effectiveSettings({ project: {}, profile: view(entry('known:pull-request', true)), now: NOON })), /^Knows "pull request": yes \(yours\)$/m);
});

test('the Thoroughness, premium and usage nudge values are said in plain words', () => {
  assert.deepEqual(['lightest', 'lean', 'balanced', 'thorough'].map((v) => sayValue('efficiency', v)), ['Lightest', 'Lean', 'Balanced', 'Thorough']);
  assert.deepEqual(['off', 'within-plan', 'paid-too'].map((v) => sayValue('premium', v)), ['off', 'on, within your plan', 'on, paid credits too']);
  assert.deepEqual(['off', 50, 75, 90].map((v) => sayValue('usageMark', v)), ['off', 'at 50%', 'at 75%', 'at 90%']);
  assert.equal(settingWords('usageMark', 75), 'Usage nudge: at 75%');
});
