// tests/scripts/desk/views.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readView, deskWords } from '../../../scripts/desk/views.js';
import { fileSource } from '../../../scripts/desk/file-source.js';
import { loadBoardInputs } from '../../../scripts/board/inputs.js';
import { glanceLine, renderBoard } from '../../../scripts/board/render.js';
import { numberedWaiting } from '../../../scripts/board/model.js';
import { decide, HEADINGS } from '../../../scripts/hooks/board-context.js';
import { workLines, surveyLines } from '../../../scripts/frontdesk/cli.js';
import { effectiveSettings, settingsText } from '../../../scripts/settings/effective.js';
import { cardButtons } from '../../../scripts/mod/buttons.js';
import { hashOf, cardTextOf } from '../../../scripts/mod/status.js';
import { dataHash } from '../../../scripts/state/events.js';
import { localViews } from '../../../scripts/hooks/session-start.js';
import { readProfileViews } from '../../../scripts/profile/store.js';
import { as, shortHome } from '../../helpers/homes.js';
import path from 'node:path';
import { P, NOW, now, CARD, writeRecord, upClient, put, viewsDir } from './fixture.js';

function withRecord(fn) {
  const home = shortHome();
  return as(home, async () => {
    const repo = writeRecord(home);
    return fn({ repo, source: fileSource(P, { cwd: repo, client: upClient, now }) });
  });
}

test('glance matches the status line\'s text for the same record', () => withRecord(async ({ repo, source }) => {
  const got = await readView('glance', {}, source, { now });
  const inputs = await loadBoardInputs({ cwd: repo, now, offline: true });
  assert.equal(got.ok, true);
  assert.deepEqual(got.lines, [glanceLine(inputs.model)]);
}));

test('briefing matches what board-context gives today for the same record', () => withRecord(async ({ repo, source }) => {
  const prompt = { cwd: repo, session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: '/wheelhouse:briefing' };
  const given = (await decide(prompt, { now, env: {}, client: upClient, writeVia: 'helper' }))?.hookSpecificOutput?.additionalContext;
  const got = await readView('briefing', { reserve: 0 }, source, { now });
  assert.equal(got.ok, true);
  assert.ok(got.data.text.startsWith(HEADINGS.briefing));
  assert.ok(given.endsWith(got.data.text), 'the desk\'s briefing is the hook\'s');
}));

test('waiting numbers cards as the Logbook does', () => withRecord(async ({ source }) => {
  const got = await readView('waiting', {}, source, { now });
  assert.deepEqual(got.data.numbered, numberedWaiting(localViews(P, null), []));
  assert.deepEqual(got.lines, got.data.numbered.map((item) => `${item.n}. ${item.what}`));
  assert.equal(got.data.numbered.length, 1);
}));

test('card carries its buttons, its pane hash and its data hash', () => withRecord(async ({ source }) => {
  const got = await readView('card', { id: 'c1' }, source, { now });
  assert.equal(got.ok, true);
  assert.deepEqual(got.data.buttons, cardButtons(CARD, { preview: null }).buttons);
  assert.equal(got.data.hash, hashOf(cardTextOf(CARD)));
  assert.equal(got.data.hash.length, 12);
  assert.equal(got.data.dataHash, dataHash(CARD));
  assert.equal(got.data.n, 1);
}));

test('logbook build tab matches renderBoard', () => withRecord(async ({ repo, source }) => {
  const got = await readView('logbook', { tab: 'build' }, source, { now });
  const inputs = await loadBoardInputs({ cwd: repo, now, client: upClient });
  assert.equal(got.data.text, renderBoard(inputs.model, { tab: 'build' }));
}));

test('work matches the front desk\'s work lines', () => withRecord(async ({ source }) => {
  const got = await readView('work', {}, source, { now });
  const views = localViews(P, null);
  assert.deepEqual(got.lines, workLines(views, [], deskWords(views, readProfileViews().settings, now(), ['name'])));
  assert.match(got.lines[0], /^export-csv: /);
}));

test('settings matches settingsText', () => withRecord(async ({ source }) => {
  const got = await readView('settings', {}, source, { now });
  const effective = effectiveSettings({ project: localViews(P, ['settings']).settings, profile: readProfileViews().settings, now });
  assert.deepEqual(got.lines, settingsText(effective).split('\n'));
}));

test('survey matches surveyLines', () => withRecord(async ({ source }) => {
  const got = await readView('survey', {}, source, { now });
  assert.deepEqual(got.lines, surveyLines(localViews(P, ['survey']).survey));
  assert.ok(got.lines.some((line) => line.includes('Tidy the footer')));
}));

test('a view for a project with no record refuses in plain words', () => as(shortHome(), async () => {
  const source = fileSource('nobody__here', { now });
  for (const view of ['waiting', 'card', 'work', 'settings', 'survey']) {
    const got = await readView(view, { id: 'c1' }, source, { now });
    assert.equal(got.ok, false, view);
    assert.match(got.refused, /no record/, view);
  }
}));

// The engine's records for the sale banner: one run that finished, merged, with its cost.
function withRuns(fn) {
  return withRecord(async (ctx) => {
    const views = viewsDir();
    const runId = '7f3c2a10-1111-4222-8333-444455556666';
    put(path.join(views, 'work.json'), { 'sale-banner': { work: { id: 'w2', at: '2026-10-29T08:00:00.000Z', data: { title: 'The sale banner', lane: 'quick' } }, approved: true } });
    put(path.join(views, 'runs.json'), { 'sale-banner': [
      { id: 'r1', at: '2026-10-29T09:00:00.000Z', data: { work: 'sale-banner', lane: 'quick', engine: 'archon', runId, state: 'started' } },
      { id: 'r2', at: '2026-10-29T09:20:00.000Z', data: { work: 'sale-banner', lane: 'quick', engine: 'archon', runId, state: 'ended', outcome: 'completed', pr: 9 } },
    ] });
    put(path.join(views, 'costs.json'), { 'sale-banner': [{ id: 'k1', at: '2026-10-29T09:20:00.000Z', data: { work: 'sale-banner', runId, tokens: 200000, dollars: 0.4, premiumRequests: 0, minutes: 20, source: 'reported', byRole: { implement: { dollars: 0.3 }, 'review-spec': { dollars: 0.1 } } } }] });
    put(path.join(views, 'reports.json'), { 'sale-banner': { id: 'p1', at: '2026-10-29T10:00:00.000Z', data: { outcome: 'merged', pr: 9 } } });
    return fn({ ...ctx, runId });
  });
}

test('the logbook build tab shows each run\'s steps in plain words and its cost', () => withRuns(async ({ source, runId }) => {
  const got = await readView('logbook', { tab: 'build' }, source, { now });
  assert.match(got.data.text, /Runs\nThe sale banner: finished, about \$0\.40\.\n {2}Steps: building it; checking it does what was asked\./);
  assert.doesNotMatch(got.data.text, new RegExp(runId));
}));

test('the briefing names a shipped change with its cost', () => withRuns(async ({ source }) => {
  const got = await readView('briefing', { reserve: 0 }, source, { now });
  assert.match(got.data.text, /Shipped: the sale banner, for about \$0\.40\./);
}));

test('the briefing says what was answered for the director', () => withRuns(async ({ source }) => {
  put(path.join(viewsDir(), 'engineNotes.json'), [{ id: 'n1', at: '2026-10-29T11:00:00.000Z', data: { about: 'engine', words: 'The build\'s question was answered as recommended.', level: 2 } }]);
  const got = await readView('briefing', { reserve: 0 }, source, { now });
  assert.match(got.data.text, /Answered for you: The build's question was answered as recommended\./);
}));

// A project switched to the new engine: an old feature still building on the old engine beside a new run.
function withBoth(fn) {
  return withRuns(async (ctx) => {
    const views = viewsDir();
    put(path.join(views, 'work.json'), {
      'sale-banner': { work: { id: 'w2', at: '2026-10-29T08:00:00.000Z', data: { title: 'The sale banner', lane: 'quick' } }, approved: true },
      'menu-photos': { work: { id: 'w3', at: '2026-10-28T08:00:00.000Z', data: { title: 'Photos on the menu', lane: 'quick' } }, approved: true },
    });
    put(path.join(views, 'features.json'), { 'menu-photos': { key: 'menu-photos', id: 'f1', at: '2026-10-28T09:00:00.000Z', data: { work: 'menu-photos', step: 'building' } } });
    put(path.join(views, 'reports.json'), {});
    put(path.join(views, 'runs.json'), { 'sale-banner': [{ id: 'r1', at: '2026-10-29T09:00:00.000Z', data: { work: 'sale-banner', lane: 'quick', engine: 'archon', runId: ctx.runId, state: 'started' } }] });
    return fn(ctx);
  });
}

test('the Logbook shows an old feature and a new run together', () => withBoth(async ({ source }) => {
  const work = await readView('work', {}, source, { now });
  assert.ok(work.lines.some((l) => /^menu-photos: Photos on the menu \(quick work\): running, building/.test(l)), work.lines.join('\n'));
  assert.ok(work.lines.some((l) => /^sale-banner: The sale banner \(quick work\): running, building on the new engine/.test(l)), work.lines.join('\n'));
  const logbook = await readView('logbook', { tab: 'build' }, source, { now });
  assert.match(logbook.data.text, /Photos on the menu/);
  assert.match(logbook.data.text, /Runs\nThe sale banner/);
}));

test('open work says what its run came to: only a finished run built anything', () => {
  const at = '2026-10-29T06:00:00.000Z';
  const stateOf = (data) => workLines({
    work: { 'sale-banner': { work: { id: 'w', at: '2026-10-29T05:00:00.000Z', data: { id: 'sale-banner', title: 'The sale banner', lane: 'quick', visible: false } }, approved: true } },
    runs: { 'sale-banner': [{ at, data: { work: 'sale-banner', lane: 'quick', runId: 'r', ...data } }] },
  }, [], {}).join('\n');
  assert.match(stateOf({ state: 'ended', outcome: 'completed' }), /built by the new engine/);
  assert.match(stateOf({ state: 'ended', outcome: 'failed', failure: 'other' }), /stopped by a problem on the new engine/);
  assert.doesNotMatch(stateOf({ state: 'ended', outcome: 'failed', failure: 'other' }), /built by/);
  assert.match(stateOf({ state: 'ended', outcome: 'cancelled' }), /cancelled on the new engine/);
  assert.match(stateOf({ state: 'started', resume: 1 }), /building on the new engine/);
});

test('the briefing says the line once', () => withRuns(async ({ source }) => {
  put(path.join(viewsDir(), 'settings.json'), { engine: { key: 'engine', id: 's2', at: '2026-10-29T06:00:00.000Z', value: 'archon', before: null, confirmedAt: '2026-10-29T06:05:00.000Z' } });
  const first = await readView('briefing', { reserve: 0, since: '2026-10-29T05:00:00.000Z' }, source, { now });
  assert.equal(first.data.text.split('\n').filter((l) => l === 'New quick changes are built by the new engine.').length, 1);
  const next = await readView('briefing', { reserve: 0, since: '2026-10-29T07:00:00.000Z' }, source, { now });
  assert.doesNotMatch(next.data.text, /New quick changes are built by the new engine\./);
}));
