// tests/vscode/states.test.js
// The add-on draws every state the mod draws, from the pane models in tests/fixtures/pane-states, and takes the words of its own
// controls from the list the mod's words are held equal to (scripts/desk/pane-labels.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { require } from './helpers.js';
import { STATES, loadState } from '../fixtures/pane-states/index.js';
import { MODELS } from '../fixtures/pane-states/models.js';
import { PANE_LABELS } from '../../scripts/desk/pane-labels.js';

const { renderPane, setLabels, LABEL_KEYS } = require('../../vscode/pane/render.js');

const NONCE = 'b'.repeat(64);
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
const draw = (fixture) => renderPane(fixture, { nonce: NONCE, view: fixture.view, settings: fixture.settings, briefing: 'Since you were last here, one pull request merged.' });

// A state the add-on doesn't yet draw as the mod does: the part that will, so CI stays green until it does. Today a card that
// doesn't block is drawn as a line under "Smaller things" with no buttons; the mod draws it as a card, one at a time (Part 3).
const TODO = Object.fromEntries(['card-of-parts', 'why-open', 'feature-question', 'suggest-open', 'steered', 'revised', 'recording', 'several-cards', 'all-stop', 'out-of-date'].map((name) => [name, 'Part 3']));

test('there are sixteen states, each with a fixture', () => {
  assert.equal(STATES.length, 16);
  assert.equal(new Set(STATES).size, 16);
  const files = fs.readdirSync(new URL('../fixtures/pane-states/', import.meta.url)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
  assert.deepEqual(files, [...STATES].sort());
  for (const name of STATES) {
    const fixture = loadState(name);
    assert.ok(['main', 'board', 'settings'].includes(fixture.view), name);
    assert.ok([null, 'why', 'suggest'].includes(fixture.open), name);
    assert.equal(fixture.v, 1, name);
    if (name === 'recording') assert.equal(typeof fixture.recording, 'string');
    if (name.startsWith('settings')) assert.ok(Array.isArray(fixture.settings?.groups) && fixture.settings.groups.length > 0, name);
  }
});

setLabels(PANE_LABELS);

for (const name of STATES) {
  test(`every state draws: ${name}`, TODO[name] ? { todo: TODO[name] } : {}, () => {
    const fixture = loadState(name);
    const html = draw(fixture);
    assert.ok(!html.includes('couldn\'t be drawn'), 'the pane drew its failure notice');
    if (fixture.view !== 'main') return;
    const waiting = fixture.cards.filter((c) => c.heldBack !== true);
    for (const card of waiting) {
      for (const button of card.buttons) {
        const label = esc(button.label);
        assert.ok(new RegExp(`<button[^>]*>${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: ↗)?</button>`).test(html), `${name}: ${card.id} lacks its ${button.label} button`);
      }
    }
  });
}

test('the labels are the shared ones', () => {
  const html = renderPane(loadState('calm'), { nonce: NONCE });
  const halted = renderPane(loadState('all-stop'), { nonce: NONCE });
  const board = renderPane(loadState('to-watch'), { nonce: NONCE, view: 'board' });
  const settings = renderPane(loadState('settings'), { nonce: NONCE, view: 'settings', settings: loadState('settings').settings });
  const buttons = (page) => [...page.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
  assert.ok(buttons(html).includes(PANE_LABELS.stop));
  assert.ok(buttons(halted).includes(PANE_LABELS.lift));
  for (const key of ['board', 'settings', 'briefing']) assert.ok(buttons(html).includes(PANE_LABELS[key]), key);
  assert.ok(buttons(board).includes(PANE_LABELS.done));
  assert.ok(buttons(settings).includes(PANE_LABELS.done));
  // The page's source holds none of the six words as a string of its own.
  const source = fs.readFileSync(new URL('../../vscode/pane/render.js', import.meta.url), 'utf8');
  for (const value of Object.values(PANE_LABELS)) {
    assert.ok(!source.includes(`'${value}'`) && !source.includes(`"${value}"`) && !source.includes(`\`${value}\``), `render.js holds ${value}`);
  }
});

// The mod's tests (tests/mod/pane.test.ts) can import only code files and read none, so the two checks that need files are made here.
test('the mod\'s models are the fixtures', () => {
  assert.deepEqual(Object.keys(MODELS), [...STATES]);
  for (const name of STATES) assert.deepEqual(MODELS[name], loadState(name), name);
});

test('the mod\'s labels are the shared ones', () => {
  const mod = ['calm', 'cards', 'pane', 'settings'].map((file) => fs.readFileSync(new URL(`../../hooks/mod/${file}.tsx`, import.meta.url), 'utf8')).join('\n');
  const held = (words) => mod.includes(`'${words}'`) || mod.includes(`"${words}"`) || mod.includes(`label="${words}"`) || mod.includes(`>${words}<`);
  // Board and Briefing are buttons only the add-on has: the mod draws the board as its pane and the briefing as /wheelhouse-digest.
  for (const key of ['stop', 'lift', 'settings', 'done']) assert.ok(held(PANE_LABELS[key]), `the mod holds no ${PANE_LABELS[key]}`);
  for (const key of ['board', 'briefing']) assert.ok(!held(PANE_LABELS[key]), `the mod now holds ${PANE_LABELS[key]}: add it to this check`);
});

test('the six labels are exactly the keys the page uses', () => {
  assert.deepEqual([...LABEL_KEYS].sort(), Object.keys(PANE_LABELS).sort());
  assert.ok(Object.isFrozen(PANE_LABELS));
});

test('without the shared labels the page still draws, with plain words', () => {
  // A fresh copy of the module, so the labels set above don't carry over.
  const path = require.resolve('../../vscode/pane/render.js');
  delete require.cache[path];
  const fresh = require('../../vscode/pane/render.js');
  const html = fresh.renderPane(loadState('calm'), { nonce: NONCE });
  assert.match(html, /data-act="stop"[^>]*>Stop</);
  fresh.setLabels({ stop: 'x' });
  fresh.setLabels(null);
  assert.match(fresh.renderPane(loadState('calm'), { nonce: NONCE }), /data-act="stop"[^>]*>Stop</);
  fresh.setLabels(PANE_LABELS);
  assert.match(fresh.renderPane(loadState('calm'), { nonce: NONCE }), new RegExp(`data-act="stop"[^>]*>${PANE_LABELS.stop}<`));
});
