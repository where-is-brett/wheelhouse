// tests/vscode/render.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { render, statusText, STATES } = require('../../vscode/pane/render.js');

const NONCE = 'a'.repeat(32);
const fixtures = Object.fromEntries(fs.readdirSync(path.join(here, 'fixtures')).filter((f) => f.endsWith('.json'))
  .map((f) => [f.replace(/\.json$/, ''), JSON.parse(fs.readFileSync(path.join(here, 'fixtures', f), 'utf8'))]));
const draw = (name) => render(fixtures[name], { nonce: NONCE });

test('every state has a fixture and draws from it', () => {
  for (const state of STATES) {
    const own = Object.values(fixtures).find((f) => f.state === state);
    assert.ok(own, `a fixture for ${state}`);
    assert.ok(render(own, { nonce: NONCE }).includes('<h1>Wheelhouse</h1>'), state);
  }
});

test('every fixture draws with a nonce on its policy, body, every script and every button', () => {
  for (const name of Object.keys(fixtures)) {
    const html = draw(name);
    assert.ok(html.includes(`script-src 'nonce-${NONCE}'`), name);
    assert.ok(html.includes("default-src 'none'") && !/unsafe-inline|unsafe-eval/.test(html), name);
    assert.ok(html.includes(`data-nonce="${NONCE}"`), name);
    const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
    assert.ok(scripts.length > 0 && scripts.every((s) => s.includes(`nonce="${NONCE}"`)), name);
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    assert.ok(buttons.every((b) => b.includes(`data-nonce="${NONCE}"`)), name);
    assert.ok(!/\sstyle=|\sonclick=|javascript:/i.test(html.slice(html.lastIndexOf('</style>'))), name);
  }
});

test('the colours are VS Code\'s theme variables, with no hex colour in the page', () => {
  const html = draw('live');
  assert.ok(html.includes('var(--vscode-'));
  assert.ok(!/(?<![&\w])#[0-9a-fA-F]{3,8}\b/.test(html));
});

test('a card offers its options with the recommended one marked, Not now and Ask in the chat', () => {
  const html = draw('live');
  assert.match(html, /data-act="press"[^>]*data-card="c1"[^>]*data-hash="abc123def456"[^>]*data-option="Dark grey"/);
  assert.match(html, /data-act="press"[^>]*data-option="Brand blue"/);
  assert.match(html, /class="option filled"[^>]*data-option="Dark grey"/);
  assert.match(html, /class="option outlined"[^>]*data-option="Brand blue"/);
  assert.equal((html.match(/class="mark"/g) ?? []).length, 1);
  assert.match(html, /data-act="not-now"[^>]*data-card="c1"/);
  assert.match(html, /data-act="ask-here"[^>]*data-card="c1"[^>]*>Ask in the chat<\/button>/);
  assert.ok(!html.includes('Ask me here'));
  assert.ok(html.includes('Which footer colour should the site use?'));
});

test('a merge card on a project with no real users offers Approve', () => {
  const html = draw('merge-no-users');
  assert.match(html, /data-act="press"[^>]*data-option="Approve"/);
});

test('a merge card on a project with real users says to approve in the window', () => {
  const html = draw('merge-real-users');
  assert.ok(html.includes('real users') && html.includes('window'));
  assert.ok(!html.includes('data-option="Approve"'));
  assert.match(html, /data-option="Send it back"/);
});

test('a confirmed step says to answer in the window and offers no deciding button', () => {
  const html = draw('confirmed-step');
  assert.ok(html.includes('in Wheelhouse&#39;s window'));
  assert.ok(!html.includes('data-act="press"'));
  assert.ok(!html.includes('data-option='));
});

test('a signing option on a card that is not a merge card is not drawn as a button', () => {
  const state = structuredClone(fixtures.live);
  state.cards[0].options.push({ label: 'Confirm', signs: true });
  const html = render(state, { nonce: NONCE });
  assert.ok(!html.includes('data-option="Confirm"'));
  assert.ok(html.includes('window'));
});

test('no state draws a Lift All stop, settings or safekeeping button', () => {
  for (const name of Object.keys(fixtures)) {
    const buttons = (draw(name).match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).map((b) => b.replace(/<[^>]*>/g, ' ')).join('\n');
    assert.ok(!/lift|setting|safekeeping/i.test(buttons), name);
  }
});

test('the one panel-wide acts are All stop, Pull cards, Unpair and Pair, each only where it belongs', () => {
  assert.ok(draw('live').includes('data-act="all-stop"') && draw('live').includes('data-act="unpair"'));
  assert.ok(!draw('live').includes('data-act="pull-cards"') && draw('live-held').includes('data-act="pull-cards"'));
  assert.ok(draw('unpaired').includes('data-act="pair"') && !draw('unpaired').includes('data-act="unpair"'));
  assert.ok(!draw('pairing').includes('data-act='));
  assert.ok(!draw('stopped').includes('data-act="all-stop"') && draw('stopped').includes('All stop is on'));
  for (const name of ['no-helper', 'update']) assert.ok(!draw(name).includes('data-act='), name);
});

test('the unpaired and pairing states show the key\'s fingerprint', () => {
  for (const name of ['unpaired', 'pairing']) assert.ok(draw(name).includes(fixtures[name].fingerprint), name);
});

test('the empty panel says nothing needs the director', () => {
  assert.ok(draw('live-empty').includes('Nothing needs you.'));
  assert.ok(!draw('live').includes('Nothing needs you.'));
});

test('text from the record is escaped everywhere', () => {
  const html = draw('escaped');
  for (const raw of ['<script>alert(1)', '<img src=x', '<svg onload', '<b>x</b>', '<i>g</i>', '<u>n</u>', '<h>', '<w>', '<m>', '<t>', '<s>', '<wk>', '<q>', '<k>']) {
    assert.ok(!html.includes(raw), raw);
  }
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('data-option="&quot;&gt;&lt;svg onload=x&gt;"'));
  assert.equal((html.match(/<script\b/g) ?? []).length, 1);
});

test('an unknown state or a broken shape still draws a page', () => {
  assert.ok(render(null, { nonce: NONCE }).includes('Wheelhouse'));
  assert.ok(render({ state: 'live', cards: 7, work: 'x', options: {} }, { nonce: NONCE }).includes('<h1>'));
  assert.ok(render({ state: 'live', cards: [null, { id: 'c', options: [null, 3] }] }, { nonce: NONCE }).includes('data-card="c"'));
});

test('the status text counts the cards waiting', () => {
  assert.equal(statusText(fixtures.live), 'Wheelhouse · 1 needs you');
  assert.equal(statusText({ cards: [{ id: 'a' }, { id: 'b' }] }), 'Wheelhouse · 2 need you');
  assert.equal(statusText(fixtures['live-empty']), 'Wheelhouse');
  assert.equal(statusText(null), 'Wheelhouse');
});

test('the add-on\'s picture is a plain svg that follows the theme colour', () => {
  const svg = fs.readFileSync(path.join(here, '..', '..', 'vscode', 'media', 'wheel.svg'), 'utf8');
  assert.ok(svg.startsWith('<!-- vscode/media/wheel.svg -->') && svg.includes('currentColor') && !svg.includes('<script'));
});

test('a card that has moved to the chat says so and offers no button', () => {
  const html = render({ state: 'live', cards: [{ id: 'c1', hash: 'abc123def456', question: 'Which colour?', moved: true, options: [{ label: 'Blue' }] }] }, { nonce: NONCE });
  assert.ok(html.includes('Moved to the chat'));
  assert.ok(!html.includes('data-card="c1"'));
});

test('the question is drawn once, and not again as what it is about', () => {
  const html = render({ state: 'live', cards: [{ id: 'c1', hash: 'abc123def456', question: 'Trial A: Hi or Hello?\nA throwaway question.', what: 'Trial A: Hi or Hello?', options: [] }] }, { nonce: NONCE });
  assert.equal(html.split('Trial A: Hi or Hello?').length - 1, 1);
});

test('the header lets the All stop button keep its width at the narrowest sidebar', () => {
  const css = fs.readFileSync(path.join(here, '..', '..', 'vscode', 'pane', 'style.css'), 'utf8');
  assert.match(css, /header \{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.stop \{[^}]*white-space: nowrap/);
  assert.match(css, /\.stop \{[^}]*flex: none/);
});
