// vscode/pane/render.js
// The panel, drawn as one page of HTML from the state the add-on holds: what desk/1 last said (the glance, the
// waiting cards, the work) and which of the shell's states it is in. It imports nothing from scripts/, because the
// add-on is packed alone. Every word that came from a record is escaped and shown as text.
//
// The state it draws (every key is optional; an unknown shape is drawn as little as possible, never thrown on):
//   { state: 'no-helper' | 'update' | 'unpaired' | 'pairing' | 'live' | 'stopped',
//     project, fingerprint, glance, notice, answered,
//     realUsers,                  // the project has real users: a merge is approved in the window
//     held,                       // how many cards wait out of sight, for Pull cards
//     cards: [{ id, hash, kind, header, question, what, why, meanwhile, recommendation, waited,
//               merge, confirmed, decision, options: [{ label, says, recommended, signs }] }],
//     work: [{ title, state }] }
//
// The page names one nonce, in its content security policy, on its body and on every button. Its one script posts
// that nonce with every message, and the add-on takes a message only with the nonce of the last draw.
//
// The page holds no address and no instruction of its own, and draws no button for Lift All stop, settings or
// safekeeping: those say where they happen.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STATES = ['no-helper', 'update', 'unpaired', 'pairing', 'live', 'stopped'];
const NOT_NOW = 'Not now';
const ASK_HERE = 'Ask in the chat';
const RECOMMENDED = 'Recommended';
const IN_WINDOW = 'Answer this one in Wheelhouse\'s window. It can\'t be decided from here.';
const MERGE_WINDOW = 'This project has real users, so a merge is approved in Wheelhouse\'s window or on the code host, not here.';
const STOP_ON = 'All stop is on. Every agent is stopped until you lift it in the chat or in Wheelhouse\'s window.';
const NOTHING = 'Nothing needs you.';

const STYLE = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  } catch {
    return '';
  }
})();

const SCRIPT = `
(function () {
  const api = acquireVsCodeApi();
  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-act]');
    if (!el) return;
    const message = { type: el.dataset.act, nonce: el.dataset.nonce || document.body.dataset.nonce };
    for (const key of ['card', 'hash', 'option']) if (el.dataset[key] !== undefined) message[key] = el.dataset[key];
    api.postMessage(message);
  });
})();
`;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (typeof value === 'string' ? value : '');

// Text made safe to put in a page, in an element or in an attribute.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
}

// A button: every one carries the nonce, and says what it does and for which card, in data attributes.
function button(label, cls, nonce, data) {
  const attrs = Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
  return `<button type="button" class="${cls}" data-nonce="${esc(nonce)}"${attrs}>${esc(label)}</button>`;
}

const cardsOf = (state) => list(state?.cards).filter((c) => isRecord(c) && text(c.id) !== '');

// The status bar's words: "Wheelhouse" and, with cards waiting, how many need the director.
function statusText(state) {
  const n = cardsOf(state).length;
  return n === 0 ? 'Wheelhouse' : `Wheelhouse · ${n} ${n === 1 ? 'needs' : 'need'} you`;
}

// A card's options that the panel may offer as buttons, and whether the card must be answered in the window.
// A card that is a confirmed step or a decision offers no deciding button. A signing option on any card but a
// merge card offers none either. A merge card on a project with real users offers none for its signing option.
function answersOf(card, realUsers) {
  const options = list(card.options).filter((o) => isRecord(o) && text(o.label) !== '' && text(o.label) !== NOT_NOW);
  const merge = card.merge === true;
  const closed = card.confirmed === true || card.decision === true;
  const usable = closed ? [] : options.filter((o) => o.signs !== true || (merge && realUsers !== true));
  const hidden = options.length - usable.length;
  const note = closed || (hidden > 0 && !(merge && realUsers === true)) ? IN_WINDOW : (hidden > 0 ? MERGE_WINDOW : '');
  return { usable, note };
}

// One card: a clear title, a short body, the options as plain buttons with the recommended one marked, then
// Not now and Ask in the chat. The reasons wait behind "Why this comes to you", closed.
function drawCard(card, nonce, realUsers) {
  const id = text(card.id);
  const own = { card: id, hash: text(card.hash) };
  const { usable, note } = answersOf(card, realUsers);
  const recommended = usable.find((o) => o.recommended === true) ?? null;
  const title = text(card.header) || text(card.kind) || 'Question';
  const body = [text(card.question), text(card.what) !== text(card.question) ? text(card.what) : ''].filter(Boolean);
  const reasons = [text(card.why), text(card.meanwhile)].filter(Boolean);
  const buttons = usable.map((o) => {
    const mark = o === recommended ? `<span class="mark">${esc(RECOMMENDED)}</span>` : '';
    const says = text(o.says) !== '' ? `<span class="says">${esc(o.says)}</span>` : '';
    const label = esc(o.label);
    return `<button type="button" class="${o === recommended ? 'option filled' : 'option outlined'}" data-nonce="${esc(nonce)}" data-act="press" data-card="${esc(id)}" data-hash="${esc(own.hash)}" data-option="${esc(o.label)}">`
      + `<span class="label">${label}</span>${mark}${says}</button>`;
  });
  return `<section class="card" data-card-box="1" aria-label="${esc(title)}">`
    + `<h2 class="title">${esc(title)}</h2>`
    + body.map((p) => `<p class="body">${esc(p)}</p>`).join('')
    + (text(card.waited) ? `<p class="note">${esc(card.waited)}</p>` : '')
    + (text(card.recommendation) && recommended === null ? `<p class="band">${esc(`${RECOMMENDED}: ${card.recommendation}`)}</p>` : '')
    + (note ? `<p class="band warn" role="status">${esc(note)}</p>` : '')
    + (buttons.length > 0 ? `<div class="options">${buttons.join('')}</div>` : '')
    + `<div class="more">${button(NOT_NOW, 'quiet', nonce, { act: 'not-now', ...own })}${button(ASK_HERE, 'quiet', nonce, { act: 'ask-here', ...own })}</div>`
    + (reasons.length > 0 ? `<details class="why"><summary>Why this comes to you</summary>${reasons.map((p) => `<p>${esc(p)}</p>`).join('')}</details>` : '')
    + `</section>`;
}

function drawHeader(state, nonce) {
  const stop = state?.state === 'live' ? button('All stop', 'stop', nonce, { act: 'all-stop' }) : '';
  return `<header><h1>Wheelhouse</h1>${text(state?.project) ? `<span class="project">${esc(state.project)}</span>` : ''}${stop}</header>`;
}

function drawWork(state) {
  const items = list(state?.work).filter(isRecord).filter((w) => text(w.title) !== '');
  if (items.length === 0) return '';
  return `<h2 class="group">Work in progress</h2><div class="panel">${items.map((w) => `<p class="rows"><span class="row-name">${esc(w.title)}</span>${text(w.state) ? `<span class="row-value">${esc(w.state)}</span>` : ''}</p>`).join('')}</div>`;
}

// The states with no cards: what is wrong, and the one thing to do about it.
function drawOther(state, nonce) {
  const fingerprint = text(state.fingerprint);
  const print = fingerprint ? `<p class="print"><span class="note">This panel's key</span><code>${esc(fingerprint)}</code></p>` : '';
  if (state.state === 'no-helper') {
    return `<div class="panel"><h2 class="title">Wheelhouse isn't running</h2><p class="body">The panel can't reach Wheelhouse on this computer. Start Wheelhouse for this project, and the panel fills in by itself.</p></div>`;
  }
  if (state.state === 'update') {
    return `<div class="panel"><h2 class="title">Update Wheelhouse</h2><p class="body">This panel and Wheelhouse speak different versions, so the panel decides nothing. Update Wheelhouse, then reopen the panel.</p></div>`;
  }
  if (state.state === 'unpaired') {
    return `<div class="panel"><h2 class="title">Pair this panel</h2><p class="body">Pairing lets your clicks here count. Wheelhouse will show a card with the same key. Check that it matches, then choose Pair it in Wheelhouse's window.</p>${print}${button('Pair', 'option filled', nonce, { act: 'pair' })}</div>`;
  }
  return `<div class="panel"><h2 class="title">Waiting for Pair it</h2><p class="body">Choose Pair it in Wheelhouse's window, once the key on its card matches this one.</p>${print}</div>`;
}

function drawLive(state, nonce) {
  const cards = cardsOf(state);
  const held = Number.isInteger(state.held) && state.held > 0 ? state.held : 0;
  const pull = held > 0
    ? `<p class="band">${esc(`${held} ${held === 1 ? 'card is' : 'cards are'} waiting out of sight.`)} ${button('Pull cards', 'link', nonce, { act: 'pull-cards' })}</p>`
    : '';
  const quiet = cards.length === 0 && held === 0 ? `<p class="status ok">${esc(NOTHING)}</p>` : '';
  const stopped = state.state === 'stopped' ? `<p class="band stopped" role="status">${esc(STOP_ON)}</p>` : '';
  return stopped + (text(state.glance) ? `<p class="glance">${esc(state.glance)}</p>` : '') + cards.map((c) => drawCard(c, nonce, state.realUsers === true)).join('') + pull + quiet + drawWork(state);
}

function drawFoot(state, nonce) {
  const paired = state.state === 'live' || state.state === 'stopped';
  return `<footer>${paired ? button('Unpair', 'link', nonce, { act: 'unpair' }) : ''}</footer>`;
}

// render(state, { nonce }) -> string: the page for the webview. Never throws.
function render(state, { nonce } = {}) {
  const n = String(nonce ?? '');
  let body;
  try {
    const s = isRecord(state) && STATES.includes(state.state) ? state : { state: 'no-helper' };
    const alert = (text(s.notice) ? `<p class="band warn" role="status">${esc(s.notice)}</p>` : '') + (text(s.answered) ? `<p class="band" role="status">${esc(s.answered)}</p>` : '');
    const inner = s.state === 'live' || s.state === 'stopped' ? drawLive(s, n) : drawOther(s, n);
    body = drawHeader(s, n) + alert + inner + drawFoot(s, n);
  } catch {
    body = '<header><h1>Wheelhouse</h1></header><p class="band warn">The panel couldn\'t be drawn just now.</p>';
  }
  const e = esc(n);
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${e}'; script-src 'nonce-${e}'; img-src data:;">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1"><title>Wheelhouse</title><style nonce="${e}">${STYLE}</style></head>`
    + `<body data-nonce="${e}">${body}<script nonce="${e}">${SCRIPT}</script></body></html>`;
}

module.exports = { render, statusText, esc, STATES, NOT_NOW, ASK_HERE };
