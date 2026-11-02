// tests/vscode/render.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { require, model, card } from './helpers.js';

const { renderPane, statusText, needsYou, PANE_MOVES } = require('../../vscode/pane/render.js');

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
  assert.ok(!/#[0-9a-fA-F]{3,8}\b(?![^<]*<\/style>)/.test(html.replace(/<style[\s\S]*?<\/style>/, '')));
});

test('the pane holds the name, STOP, the verdict, the cards and the foot', () => {
  const html = draw(model({ cards: [card()], verdict: 'One thing needs you. Nothing is broken.' }));
  for (const text of ['Wheelhouse', 'STOP', 'One thing needs you.', 'Nothing is broken.', 'Approve', 'Not now', 'Why?', 'Suggest a change…', 'Show me', 'Board', 'Settings', 'Briefing']) {
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

test('all stop leads the pane and offers Lift STOP with the stop it drew', () => {
  const html = draw(model({ stop: true }));
  assert.match(html, /data-act="lift"[^>]*data-since="2026-11-02T04:00:00.000Z"/);
  assert.ok(!html.includes('data-act="stop"'));
});

test('a card the pane can\'t answer shows its note and no buttons', () => {
  const html = draw(model({ cards: [card({ buttons: [], note: 'This card can\'t be answered here: answer it in the chat where setup asked it.' })] }));
  assert.ok(html.includes('answer it in the chat where setup asked it'));
  assert.ok(!html.includes('data-act="press"'));
});

test('the smaller items carry an amber dot', () => {
  const html = draw(model({ cards: [card(), card({ id: 'c2', n: 2, blocking: false, text: 'Pick a colour for the footer.', parts: null })] }));
  assert.match(html, /class="item"[^>]*>[\s\S]*class="dot"[\s\S]*Pick a colour for the footer\./);
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

test('the offer to move the pane shows the picture of the drag until VS Code allows the move', () => {
  assert.equal(PANE_MOVES, false);
  const html = draw(model(), { offer: true });
  assert.ok(html.includes('Put Wheelhouse on the right'));
  assert.ok(html.includes('<svg'));
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
