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
import { P, NOW, now, CARD, writeRecord, upClient } from './fixture.js';

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
