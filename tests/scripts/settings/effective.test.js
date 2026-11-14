// tests/scripts/settings/effective.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveSettings, settingsText, settingWords, sayValue, storedEngine } from '../../../scripts/settings/effective.js';
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

test('retired concept keys, unknown keys and invalid entries are never in force', () => {
  const profile = view(entry('known:git', true), entry('known:Bad Name', true), entry('nonsense', 1), entry('budget', 'weekly-share'), entry('blindCards', false), entry('delegationReviewDays', 30));
  const e = effectiveSettings({ project: {}, profile, now: NOON });
  for (const key of ['known:git', 'known:Bad Name', 'nonsense', 'blindCards', 'delegationReviewDays']) assert.equal(key in e, false, key);
  assert.deepEqual(e.budget, { value: 'report', from: 'default' });
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
  assert.ok(lines.every((l) => l.trim() !== '' && !l.includes('\n')));
  // Everyday settings come before advanced ones.
  assert.ok(lines.findIndex((l) => /autonomy/i.test(l)) < lines.findIndex((l) => /review round/i.test(l)));
  assert.ok(lines.findIndex((l) => /pace/i.test(l)) < lines.findIndex((l) => /compact/i.test(l)));
});

test('settingWords names a setting and its value in plain words, on one line', () => {
  assert.equal(settingWords('boardTab', 'build'), 'Logbook opens on: build');
  assert.equal(settingWords('explanations', 'plain'), 'Explanations: plain');
  assert.equal(settingWords('presence', 'away', SIX_PM), 'Availability: away, until 18 October 2026, 18:00 UTC');
  assert.equal(settingWords('pace', 2), 'Crew at once: 2');
  // The settings list says each the same way.
  assert.match(settingsText(effectiveSettings({ project: {}, profile: view(entry('explanations', 'plain')), now: NOON })), /^Explanations: plain \(yours\)$/m);
});

test('the Thoroughness, premium and usage nudge values are said in plain words', () => {
  assert.deepEqual(['lightest', 'lean', 'balanced', 'thorough'].map((v) => sayValue('efficiency', v)), ['Lightest', 'Lean', 'Balanced', 'Thorough']);
  assert.deepEqual(['off', 'within-plan', 'paid-too'].map((v) => sayValue('premium', v)), ['off', 'on, within your plan', 'on, paid credits too']);
  assert.deepEqual(['off', 50, 75, 90].map((v) => sayValue('usageMark', v)), ['off', 'at 50%', 'at 75%', 'at 90%']);
  assert.equal(settingWords('usageMark', 75), 'Usage nudge: at 75%');
});

// Retired keys are kept in old records but never in force or shown (design section 4.1).
const RETIRED_LISTS = {
  RETIRED: Object.freeze({ capRequests: 'copilot' }),
  RETIRED_PATTERNS: Object.freeze([{ pattern: /^known:[a-z0-9-]{1,40}$/, piece: 'delegation' }]),
};

test('effective settings leave retired keys out, from the project and from the profile', () => {
  const project = view(entry('capRequests', 5), entry('briefing', 'short'));
  const profile = view(entry('known:git', true), entry('explanations', 'some-terms'));
  const e = effectiveSettings({ project, profile, now: NOON, retired: RETIRED_LISTS });
  assert.equal(Object.hasOwn(e, 'capRequests'), false);
  assert.equal(Object.hasOwn(e, 'known:git'), false);
  assert.deepEqual(e.briefing, { value: 'short', from: 'project' });
  assert.deepEqual(e.explanations, { value: 'some-terms', from: 'profile' });
});

test('a live setting retired by a lift-out is not shown, even before its default is deleted', () => {
  const e = effectiveSettings({ project: {}, profile: {}, now: NOON, retired: { RETIRED: Object.freeze({ presence: 'x' }), RETIRED_PATTERNS: Object.freeze([]) } });
  assert.equal(Object.hasOwn(e, 'presence'), false);
  assert.ok(Object.hasOwn(e, 'briefing'));
});

test('the settings list never shows a retired key', () => {
  const profile = view(entry('known:git', true));
  const e = effectiveSettings({ project: view(entry('capRequests', 5)), profile, now: NOON, retired: RETIRED_LISTS });
  assert.equal(/capRequests|known/i.test(settingsText(e)), false);
  // text built from an effective map that still holds a retired key (an old caller) leaves it out too
  assert.equal(/Knows/.test(settingsText({ 'known:git': { value: true, from: 'profile' } }, RETIRED_LISTS)), false);
});

test('a key that is neither live nor retired is still ignored', () => {
  const e = effectiveSettings({ project: view(entry('nonsense', 1)), profile: {}, now: NOON, retired: RETIRED_LISTS });
  assert.equal(Object.hasOwn(e, 'nonsense'), false);
});

test('a stored Archon engine loads without an error, reads as Wheelhouse in force, and storedEngine still names it', () => {
  const project = { engine: { key: 'engine', value: 'archon' } };
  const got = effectiveSettings({ project, profile: {}, now: '2026-11-07T00:00:00Z' });
  assert.deepEqual(got.engine, { value: 'wheelhouse', from: 'default' });
  assert.match(settingsText(got), /Wheelhouse/);
  assert.equal(storedEngine({ project, profile: {}, now: '2026-11-07T00:00:00Z' }), 'archon');
  assert.equal(storedEngine({ project: {}, profile: { engine: { key: 'engine', value: 'archon' } } }), 'archon');
  assert.equal(storedEngine({}), null);
});

test('an older project record holding capRequests loads, and the setting is not in force or shown', () => {
  const e = effectiveSettings({ project: view(entry('capRequests', 5), entry('briefing', 'short')), profile: {}, now: NOON });
  assert.equal(Object.hasOwn(e, 'capRequests'), false);
  assert.deepEqual(e.briefing, { value: 'short', from: 'project' });
  assert.equal(/credits/i.test(settingsText(e)), false);
});

test('the settings kept for another agent follow the others only where the computer runs that agent', () => {
  const effective = effectiveSettings({ project: {}, profile: {}, now: NOON });
  assert.equal(/Copilot/.test(settingsText(effective)), false);
  assert.equal(/Copilot/.test(settingsText(effective, undefined, { agent: 'claude-code' })), false);
  const text = settingsText(effective, undefined, { agent: 'copilot' });
  assert.match(text, /^Copilot plan: Auto only, counted in requests \(the default\)$/m);
  assert.match(text, /^Copilot allowance a month: 200 requests \(the default\)$/m);
  assert.match(text, /^Copilot ceiling a month \(US dollars\): US\$20 \(the default\)$/m);
});
