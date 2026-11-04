// tests/vscode/render.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { require, model, card } from './helpers.js';
import { PANE_LABELS } from '../../scripts/desk/pane-labels.js';
import fs from 'node:fs';
import { loadState } from '../fixtures/pane-states/index.js';

const { renderPane, statusText, needsYou, PANE_MOVES, setLabels } = require('../../vscode/pane/render.js');

setLabels(PANE_LABELS);

const NONCE = 'a'.repeat(64);
const draw = (m, over = {}) => renderPane(m, { nonce: NONCE, ...over });

test('card text with markup is shown as text', () => {
  const html = draw(model({ cards: [card({ text: '<script>alert(1)</script> & <img src=x onerror=y>', header: '<b>Approval</b>', parts: null })] }));
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<b>Approval</b>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;img src=x onerror=y&gt;'));
});

test('a button label with markup is shown as text', () => {
  const html = draw(model({ cards: [card({ buttons: [{ label: '"><svg onload=x>', does: 'record', shape: 'filled' }] })] }));
  assert.ok(!html.includes('<svg onload'));
  assert.ok(html.includes('&quot;&gt;&lt;svg onload=x&gt;'));
});

test('the page names the nonce in its policy and allows no other script', () => {
  const html = draw(model({ cards: [card()] }));
  assert.match(html, /Content-Security-Policy/);
  assert.ok(html.includes(`script-src 'nonce-${NONCE}'`));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(!/unsafe-inline|unsafe-eval/.test(html));
  assert.ok(html.includes(`data-nonce="${NONCE}"`));
});

test('the colours are VS Code\'s theme variables', () => {
  const html = draw(model({ cards: [card()] }));
  assert.ok(html.includes('var(--vscode-'));
  // No hex colour anywhere in the page, its stylesheet included.
  assert.ok(!/(?<![&\w])#[0-9a-fA-F]{3,8}\b/.test(html));
});

test('the pane holds the name, All stop, the verdict, the cards and the foot', () => {
  const html = draw(model({ cards: [card()], verdict: 'One thing needs you. Nothing is broken.' }));
  for (const text of ['Wheelhouse', PANE_LABELS.stop, 'One thing needs you.', 'Nothing is broken.', 'Approve', 'Not now', 'Why?', 'Suggest a change…', 'Show me', PANE_LABELS.board, PANE_LABELS.settings, PANE_LABELS.briefing]) {
    assert.ok(html.includes(text), text);
  }
  assert.ok(html.includes('data-act="stop"'));
});

test('a press button carries the card, its hash and its choice, and nothing else decides', () => {
  const html = draw(model({ cards: [card()] }));
  assert.match(html, /data-act="press"[^>]*data-card="c1"[^>]*data-hash="abc123def456"[^>]*data-choice="Approve"/);
});

test('a preview link is shown by the card, and the page holds no address of its own', () => {
  const html = draw(model({ cards: [card()] }));
  assert.match(html, /data-act="open"[^>]*data-card="c1"/);
  assert.ok(!html.includes('preview.example.test'));
});

test('all stop leads the pane and offers Lift All stop with the stop it drew', () => {
  const html = draw(model({ stop: true }));
  assert.match(html, /data-act="lift"[^>]*data-since="2026-11-02T04:00:00.000Z"/);
  assert.ok(!html.includes('data-act="stop"'));
});

test('a card the pane can\'t answer shows its note and no buttons', () => {
  const html = draw(model({ cards: [card({ buttons: [], note: 'This card can\'t be answered here: answer it in the chat where setup asked it.' })] }));
  assert.ok(html.includes('answer it in the chat where setup asked it'));
  assert.ok(!html.includes('data-act="press"'));
});

test('a card that does not block is a full card, shown one at a time', () => {
  const html = draw(model({ cards: [card(), card({ id: 'c2', n: 2, blocking: false, hash: 'ff00ff00ff00', text: 'Pick a colour for the footer.', parts: { ask: 'Which footer colour?', what: 'Pick one.', optional: 3 } })] }));
  assert.ok(!html.includes('Smaller things'));
  assert.ok(html.includes('data-card="c1"') && !html.includes('data-card="c2"'));
  assert.ok(html.includes('Next: Which footer colour? · optional · 3 min'));
  const second = draw(model({ cards: [card(), card({ id: 'c2', n: 2, blocking: false, hash: 'ff00ff00ff00', parts: null, text: 'Pick a colour for the footer.' })] }), { at: 1 });
  assert.ok(second.includes('data-card="c2"') && !second.includes('data-card="c1"'));
  assert.ok(second.includes('data-act="back"') && !second.includes('data-act="next"'));
  assert.ok(second.includes('Card 2 of 2'));
  const past = draw(model({ cards: [card(), card({ id: 'c2', n: 2, hash: 'ff00ff00ff00' })] }), { at: 9 });
  assert.ok(past.includes('data-card="c2"'));
});

test('a press in progress turns the filled button into Recording… and the others into plain words', () => {
  const html = draw(model({ cards: [card()] }), { recording: 'c1' });
  assert.ok(html.includes('Recording…'));
  assert.ok(!html.includes('data-act="press"') && !html.includes('data-act="why-toggle"') && !html.includes('data-act="suggest-open"'));
  assert.ok(html.includes('data-act="stop"'));
  // Another card's press holds this card's buttons too, with no Recording… of its own.
  const other = draw(model({ cards: [card()] }), { recording: 'c9' });
  assert.ok(!other.includes('Recording…') && !other.includes('data-act="press"'));
});

test('a revised card names it, shows what changed and a steered card says when', () => {
  const html = draw(model({ cards: [card({ revised: true, steered: '14:10', parts: { what: 'It changes the wording.', changed: 'The date moved.' } })] }));
  assert.ok(html.includes('Approval · revised'));
  assert.ok(html.includes('What changed: The date moved.'));
  assert.ok(html.includes('You suggested a change at 14:10.'));
  assert.ok(!draw(model({ cards: [card({ revised: false, parts: { what: 'x', changed: 'The date moved.' } })] })).includes('What changed:'));
});

test('words from a record are escaped in every part of a card', () => {
  const bad = '<img src=x onerror=alert(1)>';
  const html = draw(model({ cards: [card({ steered: bad, revised: true, note: bad, waited: bad, parts: { header: bad, ask: bad, what: bad, small: bad, recommendation: bad, changed: bad, why: bad, meanwhile: bad, options: [{ label: bad, says: bad }] } })] }), { answered: bad });
  assert.ok(!html.includes('<img'));
});

test('the status text counts needs-you items', () => {
  assert.equal(statusText(model({ cards: [card(), card({ id: 'c2', n: 2 })] })), 'Wheelhouse · 2 need you');
  assert.equal(statusText(model({ cards: [card()] })), 'Wheelhouse · 1 needs you');
  assert.equal(statusText(model()), 'Wheelhouse');
  assert.equal(statusText(model({ cards: [card({ heldBack: true })] })), 'Wheelhouse');
  assert.equal(statusText(null), 'Wheelhouse');
  assert.equal(needsYou(model({ cards: [card(), card({ id: 'c2', heldBack: true })] })), 1);
});

test('with nothing to read the pane says so and shows the last view', () => {
  const html = draw(model({ cards: [card({ text: 'Last card text.', parts: null })] }), { notice: 'Wheelhouse\'s helper isn\'t running, so this is the last view it could read.' });
  assert.ok(html.includes('helper isn&#39;t running'));
  assert.ok(html.includes('Last card text.'));
  const empty = draw(null, { notice: 'Wheelhouse\'s helper isn\'t running.' });
  assert.ok(empty.includes('helper isn&#39;t running'));
});

test('the offer to move the pane is a button, since VS Code allows the move (check 67)', () => {
  assert.equal(PANE_MOVES, true);
  const html = draw(model(), { offer: true });
  assert.ok(html.includes('Put Wheelhouse on the right'));
  assert.match(html, /data-act="move"/);
  assert.ok(!html.includes('<svg'));
  assert.ok(!draw(model()).includes('Put Wheelhouse on the right'));
});

test('the settings view shows rows and presses by key and choice', () => {
  const settings = { groups: [{ id: 'you', title: 'You, in every project', note: 'Yours.', rows: [{ key: 'briefing', label: 'Briefing', value: 'daily', kind: 'select', options: [{ value: 'daily', label: 'Daily' }, { value: 'off', label: 'Off' }] }, { key: 'budget', label: 'Budget', value: 'Normal', kind: 'value' }] }] };
  const html = draw(model(), { view: 'settings', settings });
  assert.match(html, /data-act="setting"[^>]*data-key="briefing"[^>]*data-choice="off"/);
  assert.ok(html.includes('Budget') && html.includes('Normal'));
  assert.ok(html.includes('Done'));
});

test('the briefing view shows the briefing as text', () => {
  const html = draw(model(), { view: 'briefing', briefing: 'Since you were here:\n<b>one</b> thing.' });
  assert.ok(html.includes('&lt;b&gt;one&lt;/b&gt; thing.'));
});

test('a pane draws without a model\'s optional parts', () => {
  assert.doesNotThrow(() => draw({ cards: [{ id: 'x', text: 'Plain.', buttons: 'wrong' }] }));
  assert.doesNotThrow(() => draw({}));
  assert.doesNotThrow(() => draw(undefined));
});

test('a card with parts shows what it is, not the record\'s set line', () => {
  const html = draw(model({ cards: [card({ text: 'Set line text\nReply code: ABC', parts: { what: 'It changes the wording.', why: 'Yours to decide.', meanwhile: 'Nothing is released.' } })] }));
  assert.ok(html.includes('It changes the wording.'));
  assert.ok(!html.includes('Reply code'));
  assert.ok(html.includes('Yours to decide.'));
});

// The Inset look.
const drawFixture = (name) => { const f = loadState(name); return renderPane(f, { nonce: NONCE, view: f.view, settings: f.settings }); };
const CSS = fs.readFileSync(new URL('../../vscode/pane/style.css', import.meta.url), 'utf8');

test('the card is the first panel', () => {
  const html = draw(model({ cards: [card({ text: 'Put the sign-in wording live?', parts: null })] }));
  const first = html.search(/class="(?:card )?panel/);
  assert.ok(first > -1);
  const end = html.indexOf('</section>', first);
  assert.ok(html.slice(first, end).includes('Put the sign-in wording live?'));
  assert.match(html.slice(first), /^class="card panel" data-card-box/);
});

test('group names sit above their panels', () => {
  assert.match(drawFixture('to-watch'), /<h2>To watch<\/h2><(?:div|section) class="panel[^"]*">/);
});

test('rows put the name left and the value right', () => {
  assert.match(drawFixture('to-watch'), /<span class="row-name">CI is failing on main<\/span><span class="row-value">[^<]+<\/span>/);
  assert.match(drawFixture('settings'), /<span class="row-name">Crew<\/span><span class="row-value">Working<\/span>/);
});

test('the launch bar is drawn', () => {
  const bar = (launch) => draw(model({ over: { launch } }), { view: 'board' });
  assert.match(bar({ gained: 3, total: 4, next: [] }), /class="launch-bar"[^>]*><span class="launch-fill w-75"/);
  assert.match(bar({ gained: 9, total: 4, next: [] }), /launch-fill w-100"/);
  assert.match(bar({ gained: -2, total: 4, next: [] }), /launch-fill w-0"/);
  assert.match(bar({ gained: 1, total: 0, next: [] }), /launch-fill w-0"/);
  for (let n = 0; n <= 100; n += 5) assert.ok(CSS.includes(`.w-${n} `), `w-${n}`);
  assert.ok(!bar({ gained: 1, total: 2 }).includes(' style="'));
});

test('the verdict doesn\'t repeat', () => {
  const count = (html, words) => html.split(words).length - 1;
  assert.equal(count(draw(model()), 'Nothing needs you.'), 1);
  assert.equal(count(draw(model({ verdict: 'The shop page is down.' })), 'Nothing needs you.'), 1);
  assert.equal(count(draw(model({ cards: [card()], verdict: 'One thing needs you.' })), 'Nothing needs you.'), 0);
});

test('out of date shows the warning and no figures', () => {
  const f = loadState('out-of-date');
  const html = drawFixture('out-of-date');
  for (const line of f.missing) assert.ok(html.includes(line.replace(/'/g, '&#39;')), line);
  assert.match(html, /class="band[^"]*"[^>]*role="status"/);
  // No digit in the verdict's text: look only between tags, so no markup is stripped.
  const verdict = html.match(/<p class="verdict">(.*?)<\/p>/)[1];
  assert.ok(!/(^|>)[^<]*\d/.test(verdict));
});

test('out of date does not claim that nothing is broken', () => {
  const stale = drawFixture('out-of-date');
  assert.ok(!stale.includes('Nothing is broken'));
  assert.ok(stale.includes('One thing needs you.'));
  assert.ok(!stale.includes('class="ok"'));
  assert.ok(draw(model({ cards: [card()], verdict: 'One thing needs you. Nothing is broken.' })).includes('Nothing is broken.'));
  assert.ok(draw(model({ missing: ['Old.'], verdict: 'One thing needs you. The shop page is down.' })).includes('The shop page is down.'));
});

test('first reading draws the mod\'s line', () => {
  for (const html of [draw(null), drawFixture('first-reading')]) {
    assert.ok(html.includes('Reading how the project stands…'));
    assert.ok(!html.includes('Nothing to show yet'));
  }
});

test('high contrast has borders and no fills', () => {
  assert.match(CSS, /body\.vscode-high-contrast[^{]*\.panel[^{]*\{[^}]*background: transparent/);
  assert.match(CSS, /body\.vscode-high-contrast[^{]*\.band[^{]*\{[^}]*background: transparent/);
  assert.ok(CSS.includes('--vscode-contrastBorder'));
});
