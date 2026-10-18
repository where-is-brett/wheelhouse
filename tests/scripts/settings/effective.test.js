// tests/scripts/settings/effective.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveSettings, settingsText } from '../../../scripts/settings/effective.js';

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
  assert.match(line('presence'), /away/);
  assert.match(line('presence'), /until 18 October 2026, 18:00 UTC/);
  assert.match(line('presence'), /yours/);
  assert.match(line('pace'), /the default/);
  assert.match(line('notifications'), /claude, ntfy/);
  assert.match(line('notifications'), /22:00/);
  assert.match(line('git'), /yours/);
  assert.ok(lines.every((l) => l.trim() !== '' && !l.includes('\n')));
  // Everyday settings come before advanced ones.
  assert.ok(lines.findIndex((l) => /autonomy/i.test(l)) < lines.findIndex((l) => /review round/i.test(l)));
  assert.ok(lines.findIndex((l) => /pace/i.test(l)) < lines.findIndex((l) => /compact/i.test(l)));
});
