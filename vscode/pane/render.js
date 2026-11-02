// vscode/pane/render.js
// The add-on's pane, drawn as one page of HTML from the desk's pane model (scripts/desk/mod-pane.js), and the
// status bar's words. Every word that came from a record is escaped and shown as text. The page names one
// nonce, in its content security policy and on its body: its one script posts that nonce with every message,
// and the add-on takes a message only with the nonce of the last draw (vscode/press.cjs).
//
// The page holds no address and no instruction of its own: a card's preview is named by the card's id, and the
// add-on looks the address up in the model it drew.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Whether VS Code lets an extension move its view to the secondary sidebar for the person (check 67). Until it
// says so the first-run offer shows the picture of the drag, once.
const PANE_MOVES = false;
const OFFER = 'Put Wheelhouse on the right';
const DRAG_PICTURE = '<svg viewBox="0 0 260 90" role="img" aria-label="Drag the Wheelhouse wheel to the right-hand side of the window" fill="none" stroke="currentColor" stroke-width="1.5">'
  + '<rect x="4" y="4" width="252" height="82" rx="6"/><line x1="30" y1="4" x2="30" y2="86"/><line x1="190" y1="4" x2="190" y2="86"/>'
  + '<circle cx="17" cy="22" r="6"/><path d="M28 30 L178 30 M170 24 L178 30 L170 36" stroke-linecap="round"/>'
  + '<rect x="198" y="12" width="48" height="10" rx="2"/><rect x="198" y="30" width="48" height="10" rx="2"/></svg>';

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
  const nonce = document.body.dataset.nonce;
  const send = (message) => api.postMessage({ nonce, ...message });
  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const card = el.closest('[data-card-box]');
    if (act === 'why-toggle') {
      const box = card && card.querySelector('.why-box');
      if (box) box.classList.toggle('hidden');
      if (box && !box.classList.contains('hidden') && el.dataset.noted !== '1') {
        el.dataset.noted = '1';
        send({ type: 'why', card: el.dataset.card, hash: el.dataset.hash });
      }
      return;
    }
    if (act === 'suggest-open') {
      const box = card && card.querySelector('.suggest-box');
      if (box) box.classList.toggle('hidden');
      return;
    }
    const message = { type: act };
    for (const key of ['card', 'hash', 'choice', 'key', 'since', 'view']) if (el.dataset[key] !== undefined) message[key] = el.dataset[key];
    if (act === 'suggest') {
      const words = card && card.querySelector('textarea');
      message.words = words ? words.value : '';
    }
    send(message);
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

const attrs = (data) => Object.entries(data).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
const button = (label, cls, data) => `<button type="button" class="${cls}"${attrs(data)}>${esc(label)}</button>`;

// The cards that wait on the director now: not the ones held back past the day's budget.
const waitingCards = (model) => list(model?.cards).filter((c) => isRecord(c) && c.heldBack !== true);

function needsYou(model) {
  return waitingCards(model).length;
}

// The status bar item's words.
function statusText(model) {
  const n = needsYou(model);
  return n === 0 ? 'Wheelhouse' : `Wheelhouse · ${n} ${n === 1 ? 'needs' : 'need'} you`;
}

function drawVerdict(model) {
  const sentences = text(model?.verdict).split(/(?<=\.)\s+/).filter(Boolean);
  if (sentences.length === 0) return '';
  const [first, ...rest] = sentences;
  const state = rest.map((s) => `<span class="${/^Nothing is broken/.test(s) ? 'ok' : 'bad'}">${esc(s)}</span>`).join('');
  return `<p class="verdict">${esc(first)}${state}</p>`;
}

// The words a card shows: its parts' what-line when it has parts (the set line and the reply code are the record's,
// not the page's), else its text.
function cardWords(card) {
  const parts = isRecord(card.parts) ? card.parts : null;
  const what = parts ? [text(parts.ask), parts.what !== parts.ask ? text(parts.what) : ''].filter(Boolean).join('\n') : '';
  return what !== '' ? what : text(card.text);
}

function drawCard(card) {
  const buttons = list(card.buttons).filter(isRecord);
  const id = text(card.id);
  const hash = text(card.hash);
  const own = { card: id, hash };
  const parts = isRecord(card.parts) ? card.parts : null;
  const corner = buttons.find((b) => b.corner === true);
  const top = [];
  const links = [];
  const actions = [];
  let suggest = '';
  for (const b of buttons) {
    const label = text(b.label);
    if (label === '') continue;
    if (b === corner) top.push(button(label, 'quiet', { act: 'press', ...own, choice: label }));
    else if (b.does === 'why') links.push(button(label, 'link', { act: 'why-toggle', ...own }));
    else if (b.does === 'suggest') actions.push(button(label, 'outlined', { act: 'suggest-open', ...own }));
    else if (b.shape === 'link' && typeof b.href === 'string') links.push(button(`${label} ↗`, 'link', { act: 'open', card: id }));
    else if (b.shape === 'small') links.push(button(label, 'link', { act: b.does === 'pull' ? 'pull' : 'press', ...own, choice: label }));
    else actions.push(button(label, b.shape === 'filled' ? 'filled' : 'outlined', { act: 'press', ...own, choice: label }));
  }
  if (buttons.some((b) => b.does === 'suggest')) {
    suggest = `<div class="suggest-box hidden"><textarea rows="3" aria-label="What would you change?"></textarea><div class="row">${button('Send', 'filled', { act: 'suggest', ...own })}</div></div>`;
  }
  const why = parts && (text(parts.why) || text(parts.meanwhile))
    ? `<div class="why-box hidden">${[parts.why, parts.meanwhile].filter((p) => text(p)).map((p) => `<p>${esc(p)}</p>`).join('')}</div>`
    : '';
  return `<section class="card" data-card-box="1">`
    + `<div class="card-top"><span class="kind">${esc(card.header)}</span>${top.join('')}</div>`
    + `<p class="text">${esc(cardWords(card))}</p>`
    + (text(card.note) ? `<p class="note">${esc(card.note)}</p>` : '')
    + (links.length > 0 ? `<div class="links">${links.join('')}</div>` : '')
    + why
    + (actions.length > 0 ? `<div class="actions">${actions.join('')}</div>` : '')
    + suggest
    + `</section>`;
}

function drawItem(card) {
  return `<p class="item"><span class="dot" aria-hidden="true"></span><span>${esc(cardWords(card))} <span class="small">· optional</span></span></p>`;
}

function drawCards(model) {
  const waiting = waitingCards(model);
  const big = waiting.filter((c) => c.blocking !== false);
  const small = waiting.filter((c) => c.blocking === false);
  return big.map(drawCard).join('')
    + (small.length > 0 ? `<h2>Smaller things</h2>${small.map(drawItem).join('')}` : '')
    + (isRecord(model?.held) && text(model.held.line) ? `<p class="note">${esc(model.held.line)} ${button(text(model.held.button?.label) || 'Show them', 'link', { act: 'pull' })}</p>` : '');
}

function drawHeader(model) {
  const on = model?.stop?.on === true;
  const head = `<header><h1>Wheelhouse</h1>${on ? '' : button('STOP', 'stop', { act: 'stop' })}</header>`;
  if (!on) return head;
  const since = text(model.stop.since);
  return `${head}<div class="halted"><p>All stop is on. Every agent is stopped, and nothing moves until you say.</p>${button('Lift STOP', 'lift', { act: 'lift', since })}</div>`;
}

function drawOffer(offer) {
  if (!offer) return '';
  return `<div class="offer"><p>${esc(OFFER)}</p>${PANE_MOVES ? button(OFFER, 'filled', { act: 'move' }) : `<p class="note">Drag the wheel to the right-hand side of the window, and VS Code will remember it.</p>${DRAG_PICTURE}`}</div>`;
}

function drawFoot(model) {
  const views = ['Board', 'Settings', 'Briefing'].map((v) => button(v, 'link', { act: 'view', view: v.toLowerCase() })).join('');
  return `<footer>${views}${text(model?.updated) ? `<span class="updated">Updated ${esc(model.updated)}</span>` : ''}</footer>`;
}

function drawBoard(model) {
  const lines = [];
  const add = (heading, rows) => { if (rows.length > 0) lines.push(`<h2>${esc(heading)}</h2>${rows.map((r) => `<p class="item"><span>${esc(r)}</span></p>`).join('')}`); };
  const launch = isRecord(model?.launch) ? model.launch : null;
  if (launch) add('Progress to launch', [`${launch.gained ?? 0} of ${launch.total} done`, ...list(launch.next).map((n) => text(n?.text)).filter(Boolean)]);
  add('Building', list(model?.building).map((b) => text(b?.text)).filter(Boolean));
  add('To watch', list(model?.health).map((h) => text(h?.text)).filter(Boolean));
  if (isRecord(model?.safekeeping) && text(model.safekeeping.line)) add('Safekeeping', [text(model.safekeeping.line)]);
  if (text(model?.usage)) add('This week', [model.usage]);
  if (lines.length === 0) lines.push('<p class="note">Nothing to show on the board yet.</p>');
  return `${lines.join('')}<footer>${button('Done', 'filled', { act: 'view', view: 'main' })}</footer>`;
}

function drawSettings(settings) {
  const groups = list(settings?.groups).filter(isRecord);
  const rows = (group) => list(group.rows).filter(isRecord).map((row) => {
    const label = `<span class="label">${esc(row.label)}</span>`;
    if (row.kind === 'select') {
      const options = list(row.options).filter(isRecord).map((o) => button(text(o.label), `pick${o.value === row.value ? ' chosen' : ''}`, { act: 'setting', key: row.key, choice: o.value }));
      const undo = isRecord(row.changed) && row.changed.undo ? button('Undo', 'link', { act: 'setting', key: row.key, choice: 'undo' }) : '';
      return `<div class="row-line">${label}${options.join('')}${undo}</div>`;
    }
    return `<div class="row-line">${label}<span class="value">${esc(row.value)}</span></div>`;
  }).join('');
  const body = groups.length === 0
    ? '<p class="note">The settings can\'t be read just now.</p>'
    : groups.map((g) => `<div class="group"><h2>${esc(g.title)}</h2>${text(g.note) ? `<p class="about">${esc(g.note)}</p>` : ''}${rows(g)}</div>`).join('');
  return `${body}<footer>${button('Done', 'filled', { act: 'view', view: 'main' })}</footer>`;
}

function drawBriefing(briefing) {
  return `<h2>Briefing</h2><p class="briefing">${esc(briefing)}</p><footer>${button('Done', 'filled', { act: 'view', view: 'main' })}</footer>`;
}

// renderPane(model, { nonce, view, settings, briefing, notice, offer }) -> string
// `model` is the desk's pane model (or the last one read, or null); `view` is 'main' (the default), 'board',
// 'settings' or 'briefing'; `notice` is a line to put above the cards, such as that the helper isn't running; `offer`
// is whether to show the first-run offer to put the pane on the right. Never throws.
function renderPane(model, { nonce, view = 'main', settings, briefing, notice, offer = false } = {}) {
  let body;
  try {
    const m = isRecord(model) ? model : null;
    const alert = text(notice) ? `<p class="notice" role="status">${esc(notice)}</p>` : '';
    if (view === 'settings') body = drawHeader(m) + alert + drawSettings(settings);
    else if (view === 'briefing') body = drawHeader(m) + alert + drawBriefing(text(briefing));
    else if (view === 'board') body = drawHeader(m) + alert + drawBoard(m);
    else body = drawHeader(m) + alert + drawOffer(offer) + (m ? drawVerdict(m) + drawCards(m) : '<p class="note">Nothing to show yet.</p>') + drawFoot(m);
  } catch {
    body = '<header><h1>Wheelhouse</h1></header><p class="notice">The pane couldn\'t be drawn just now.</p>';
  }
  const n = esc(nonce);
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${n}'; script-src 'nonce-${n}'; img-src data:;">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1"><title>Wheelhouse</title><style nonce="${n}">${STYLE}</style></head>`
    + `<body data-nonce="${n}">${body}<script nonce="${n}">${SCRIPT}</script></body></html>`;
}

module.exports = { renderPane, statusText, needsYou, waitingCards, PANE_MOVES, OFFER, esc };
