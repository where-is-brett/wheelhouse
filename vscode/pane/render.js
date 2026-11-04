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
const FIRST_READING = 'Reading how the project stands…';
const NOTHING_NEEDS_YOU = 'Nothing needs you.';
const OFFER = 'Put Wheelhouse on the right';
const UNTRUSTED = 'Wheelhouse runs only in a folder you trust, since it signs your clicks with this computer\'s key.';
const DRAG_PICTURE = '<svg viewBox="0 0 260 90" role="img" aria-label="Drag the Wheelhouse wheel to the right-hand side of the window" fill="none" stroke="currentColor" stroke-width="1.5">'
  + '<rect x="4" y="4" width="252" height="82" rx="6"/><line x1="30" y1="4" x2="30" y2="86"/><line x1="190" y1="4" x2="190" y2="86"/>'
  + '<circle cx="17" cy="22" r="6"/><path d="M28 30 L178 30 M170 24 L178 30 L170 36" stroke-linecap="round"/>'
  + '<rect x="198" y="12" width="48" height="10" rx="2"/><rect x="198" y="30" width="48" height="10" rx="2"/></svg>';

// The words of the pane's own controls (All stop, Lift All stop, Board, Settings, Briefing, Done) come from scripts/desk/pane-labels.js,
// which the mod's words are held equal to (tests/mod/pane.test.ts). The add-on hands them over with setLabels once it has loaded
// the scripts; until then, and if they can't be loaded, the pane draws the plain fallback words below and still works.
const LABEL_KEYS = ['stop', 'lift', 'board', 'settings', 'briefing', 'done'];
const capital = (words) => words.charAt(0).toUpperCase() + words.slice(1);
const FALLBACK_LABELS = Object.freeze(Object.fromEntries(LABEL_KEYS.map((key) => [key, capital(key === 'lift' ? 'lift stop' : key)])));
let labels = FALLBACK_LABELS;

// setLabels(given) -> void: uses the labels given when every key is a non-empty string; otherwise keeps the words in use.
function setLabels(given) {
  if (given === null || typeof given !== 'object') return;
  if (!LABEL_KEYS.every((key) => typeof given[key] === 'string' && given[key] !== '')) return;
  labels = Object.freeze(Object.fromEntries(LABEL_KEYS.map((key) => [key, given[key]])));
}

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
      if (el.dataset.alt) { const was = el.textContent; el.textContent = el.dataset.alt; el.dataset.alt = was; }
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

// A raised group with the quiet line, and a group name above it.
const panel = (inner) => `<div class="panel">${inner}</div>`;
const group = (heading, inner) => `<h2>${esc(heading)}</h2>${panel(inner)}`;
// A row: the name on the left, the value on the right.
const row = (name, value) => `<p class="rows"><span class="row-name">${esc(name)}</span><span class="row-value">${esc(value)}</span></p>`;

// The launch bar's fill, in steps of five: a class, since the page allows no inline style.
function fillClass(done, total) {
  const d = Number(done);
  const t = Number(total);
  if (!Number.isFinite(d) || !Number.isFinite(t) || t <= 0 || d <= 0) return 'w-0';
  return `w-${Math.min(100, Math.round((d / t) * 20) * 5)}`;
}

// "Nothing needs you." once: the verdict may already say it.
function drawQuiet(model) {
  const none = waitingCards(model).length === 0 && !(isRecord(model?.held) && text(model.held.line));
  return none && !text(model?.verdict).startsWith(NOTHING_NEEDS_YOU) ? `<p class="status ok">${esc(NOTHING_NEEDS_YOU)}</p>` : '';
}

// The lines that say the reading is incomplete or old.
const drawMissing = (model) => list(model?.missing).map(text).filter(Boolean).map((line) => `<p class="band warn" role="status">${esc(line)}</p>`).join('');

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

// The words the mod's cards use for what it adds to a card (hooks/mod/numbers.ts).
const RECORDING = 'Recording…';
const HIDE_WHY = 'Hide why';
const WHAT_CHANGED = 'What changed:';
const OPEN_IN_CHAT = 'Also open in the chat.';
const SHOW_ME = 'Show me';
const suggestedAt = (hhmm) => `You suggested a change at ${hhmm}. A new proposal is on its way, and nothing goes live meanwhile.`;

// A button that can't be pressed just now (another press is being recorded): its word, as plain text.
const plain = (label) => `<span class="plain">${esc(label)}</span>`;

// One card, part by part in the mod's order (hooks/mod/cards.tsx): its kind and place with the corner button, the ask,
// what it is, the small line, the recommendation, what changed, the reasons when Why? is open, the suggestion's
// confirmation, the note, the answers, the suggestion box, then the links. `o.recording` is the id of the card whose press
// is being recorded: its filled button reads "Recording…" and every other button is plain text until it answers.
function drawCard(card, o = {}) {
  const buttons = list(card.buttons).filter(isRecord);
  const id = text(card.id);
  const hash = text(card.hash);
  const own = { card: id, hash };
  const parts = isRecord(card.parts) ? card.parts : null;
  const recording = typeof o.recording === 'string' && o.recording !== '' ? o.recording : null;
  const open = o.open === 'why' || o.open === 'suggest' ? o.open : null;
  const corner = buttons.find((b) => b.corner === true);
  const filled = buttons.find((b) => b !== corner && b.shape === 'filled' && text(b.label) !== '') ?? buttons.find((b) => b !== corner && text(b.label) !== '' && !(b.shape === 'link' && typeof b.href === 'string'));
  const draw = (b, make) => {
    const label = text(b.label);
    if (recording === null || (b.shape === 'link' && typeof b.href === 'string')) return make(label);
    return recording === id && b === filled ? `<span class="recording" role="status">${esc(RECORDING)}</span>` : plain(label);
  };
  const top = [];
  const links = [];
  const actions = [];
  for (const b of buttons) {
    const label = text(b.label);
    if (label === '') continue;
    if (b === corner) top.push(draw(b, () => button(label, 'quiet', { act: 'press', ...own, choice: label })));
    else if (b.does === 'why') links.push(draw(b, () => button(open === 'why' ? HIDE_WHY : label, 'link', { act: 'why-toggle', ...own, alt: open === 'why' ? label : HIDE_WHY })));
    else if (b.does === 'suggest') actions.push(draw(b, () => button(label, b.shape === 'filled' ? 'filled' : 'outlined', { act: 'suggest-open', ...own })));
    else if (b.shape === 'link' && typeof b.href === 'string') links.push(draw(b, () => button(`${label} ↗`, 'link', { act: 'open', card: id })));
    else if (b.shape === 'small') links.push(draw(b, () => button(label, 'link', { act: b.does === 'pull' ? 'pull' : 'press', ...own, choice: label })));
    else actions.push(draw(b, () => button(label, b.shape === 'filled' ? 'filled' : 'outlined', { act: 'press', ...own, choice: label })));
  }
  const suggest = buttons.some((b) => b.does === 'suggest') && recording === null
    ? `<div class="suggest-box${open === 'suggest' ? '' : ' hidden'}"><p class="note">What would you change?</p><textarea rows="3" aria-label="What would you change?"></textarea><div class="row">${button('Send', 'filled', { act: 'suggest', ...own })}${button('Cancel', 'outlined', { act: 'suggest-open', ...own })}</div></div>`
    : '';
  const options = parts ? list(parts.options).filter(isRecord).filter((x) => text(x.label)).map((x) => `${x.label}: ${text(x.says)}`.replace(/: $/, '')) : [];
  const reasons = parts ? [text(parts.why), ...options, text(parts.meanwhile)].filter(Boolean) : [];
  const why = reasons.length > 0 ? `<div class="why-box${open === 'why' ? '' : ' hidden'}">${reasons.map((p) => `<p>${esc(p)}</p>`).join('')}</div>` : '';
  const header = (parts && text(parts.header)) || text(card.header);
  const where = card.revised === true ? 'revised' : text(o.place);
  const minutes = parts && typeof parts.optional === 'number' && parts.optional > 0 ? `optional · ${parts.optional} min` : '';
  const small = parts ? [text(parts.small), text(card.waited), minutes, card.openInChat === true ? OPEN_IN_CHAT : ''].filter(Boolean).join(' · ') : '';
  const ask = parts ? text(parts.ask) : '';
  const what = parts ? text(parts.what) : '';
  const changed = parts ? text(parts.changed) : '';
  const words = parts && (ask || what) ? '' : `<p class="text">${esc(cardWords(card))}</p>`;
  return `<section class="card panel" data-card-box="1">`
    + `<div class="card-top"><span class="kind">${esc([header, where].filter(Boolean).join(' · '))}</span>${top.join('')}</div>`
    + (ask ? `<p class="text ask">${esc(ask)}</p>` : '')
    + (what && what !== ask ? `<p class="text">${esc(what)}</p>` : '')
    + words
    + (small ? `<p class="note">${esc(small)}</p>` : '')
    + (parts && text(parts.recommendation) ? `<p class="band">${esc(parts.recommendation)}</p>` : '')
    + (card.revised === true && changed ? `<p class="text">${esc(`${WHAT_CHANGED} ${changed}`)}</p>` : '')
    + why
    + (text(card.steered) ? `<p class="note">${esc(suggestedAt(card.steered))}</p>` : '')
    + (text(card.note) ? `<p class="note">${esc(card.note)}</p>` : '')
    + (actions.length > 0 ? `<div class="actions">${actions.join('')}</div>` : '')
    + suggest
    + (links.length > 0 ? `<div class="links">${links.join('')}</div>` : '')
    + `</section>`;
}

// "Next: how files are named · optional · 3 min": the next card's subject.
function nextLine(card) {
  const parts = isRecord(card.parts) ? card.parts : {};
  const minutes = typeof parts.optional === 'number' && parts.optional > 0 ? ` · optional · ${parts.optional} min` : '';
  return `Next: ${text(parts.ask) || text(card.header) || text(card.text).split('\n')[0]}${minutes}`;
}

// One card at a time, as the mod shows them: the one at `at` (the last when `at` is past the end), the next card's subject,
// and Back and Next. A card with no parts says its place above it.
function drawCards(model, { at = 0, recording = null, open = null } = {}) {
  const waiting = waitingCards(model).filter((c) => typeof c.text === 'string' || isRecord(c.parts));
  const index = Math.min(Math.max(0, Number.isInteger(at) ? at : 0), waiting.length - 1);
  const card = waiting[index];
  let shown = '';
  if (card !== undefined) {
    const place = `${index + 1} of ${waiting.length}`;
    const nav = waiting.length > 1
      ? `<div class="nav">${index + 1 < waiting.length ? `<p class="note">${esc(nextLine(waiting[index + 1]))}</p>` : '<span></span>'}<span class="row">${index > 0 ? button('Back', 'link', { act: 'back' }) : ''}${index + 1 < waiting.length ? button('Next', 'link', { act: 'next' }) : ''}</span></div>`
      : '';
    shown = (isRecord(card.parts) ? '' : `<p class="note">Card ${esc(place)}</p>`) + drawCard(card, { place, recording, open }) + nav;
  }
  return shown
    + (isRecord(model?.held) && text(model.held.line) ? `<p class="note">${esc(model.held.line)} ${button(text(model.held.button?.label) || 'Show them', 'link', { act: 'pull' })}</p>` : '');
}

function drawHeader(model) {
  const on = model?.stop?.on === true;
  const head = `<header><h1>Wheelhouse</h1>${on ? '' : button(labels.stop, 'stop', { act: 'stop' })}</header>`;
  if (!on) return head;
  const since = text(model.stop.since);
  return `${head}<div class="halted"><p>All stop is on. Every agent is stopped, and nothing moves until you say.</p>${button(labels.lift, 'lift', { act: 'lift', since })}</div>`;
}

function drawOffer(offer) {
  if (!offer) return '';
  return `<div class="offer"><p>${esc(OFFER)}</p>${PANE_MOVES ? button(OFFER, 'filled', { act: 'move' }) : `<p class="note">Drag the wheel to the right-hand side of the window, and VS Code will remember it.</p>${DRAG_PICTURE}`}</div>`;
}

function drawFoot(model) {
  const views = [['board', labels.board], ['settings', labels.settings], ['briefing', labels.briefing]].map(([view, label]) => button(label, 'link', { act: 'view', view })).join('');
  return `<footer>${views}${text(model?.updated) ? `<span class="updated">Updated ${esc(model.updated)}</span>` : ''}</footer>`;
}

function drawBoard(model) {
  const lines = [];
  const add = (heading, inner) => { if (inner !== '') lines.push(group(heading, inner)); };
  const plain = (items) => items.map((r) => `<p class="item"><span>${esc(r)}</span></p>`).join('');
  const launch = isRecord(model?.launch) ? model.launch : null;
  if (launch) {
    const done = typeof launch.resolved === 'number' ? launch.resolved : (launch.gained ?? 0);
    const bar = `<div class="launch-bar" role="img" aria-label="${esc(done)} of ${esc(launch.total)}"><span class="launch-fill ${fillClass(done, launch.total)}"></span></div>`;
    add('Progress to launch', row(`${done} of ${launch.total}`, 'cleared') + bar + plain(list(launch.next).map((n) => text(n?.text)).filter(Boolean)));
  }
  add('Building', plain(list(model?.building).map((b) => text(b?.text)).filter(Boolean)));
  add('To watch', list(model?.health).filter(isRecord).filter((h) => text(h.text)).map((h) => row(text(h.text), h.level === 'stop' ? 'Urgent' : 'Watch')).join(''));
  if (isRecord(model?.safekeeping) && text(model.safekeeping.line)) add('Safekeeping', plain([text(model.safekeeping.line)]));
  if (text(model?.usage)) add('This week', plain([model.usage]));
  if (lines.length === 0) lines.push('<p class="note">Nothing to show on the board yet.</p>');
  return `${lines.join('')}<footer>${button(labels.done, 'filled', { act: 'view', view: 'main' })}</footer>`;
}

function drawSettings(settings) {
  const groups = list(settings?.groups).filter(isRecord);
  const rows = (group_) => list(group_.rows).filter(isRecord).map((r) => {
    if (r.kind === 'select') {
      const options = list(r.options).filter(isRecord).map((o) => button(text(o.label), `pick${o.value === r.value ? ' chosen' : ''}`, { act: 'setting', key: r.key, choice: o.value }));
      const undo = isRecord(r.changed) && r.changed.undo ? button('Undo', 'link', { act: 'setting', key: r.key, choice: 'undo' }) : '';
      return `<div class="rows select"><span class="row-name">${esc(r.label)}</span><span class="row-value">${options.join('')}${undo}</span></div>`;
    }
    return row(r.label, r.value);
  }).join('');
  const body = groups.length === 0
    ? '<p class="note">The settings can\'t be read just now.</p>'
    : groups.map((g) => group(g.title, `${text(g.note) ? `<p class="about">${esc(g.note)}</p>` : ''}${rows(g)}`)).join('');
  return `${body}<footer>${button(labels.done, 'filled', { act: 'view', view: 'main' })}</footer>`;
}

function drawBriefing(briefing) {
  return `<h2>Briefing</h2><p class="briefing">${esc(briefing)}</p><footer>${button(labels.done, 'filled', { act: 'view', view: 'main' })}</footer>`;
}

// renderPane(model, { nonce, view, settings, briefing, notice, offer, at, recording, open, answered }) -> string
// `model` is the desk's pane model (or the last one read, or null); `view` is 'main' (the default), 'board',
// 'settings' or 'briefing'; `notice` is a line to put above the cards, such as that the helper isn't running; `offer`
// is whether to show the first-run offer to put the pane on the right; `trusted` false (an untrusted folder) draws
// STOP and the reason and no cards. `at` is the index of the card shown, `recording` the id of a card whose press is being
// recorded, `open` whether the shown card's Why? ('why') or Suggest a change… ('suggest') box is open, and `answered` the line
// that says a press was counted. Never throws.
function renderPane(model, { nonce, view = 'main', settings, briefing, notice, offer = false, trusted = true, at = 0, recording = null, open = null, answered } = {}) {
  let body;
  try {
    const m = isRecord(model) ? model : null;
    const alert = (text(notice) ? `<p class="notice" role="status">${esc(notice)}</p>` : '') + (text(answered) ? `<p class="band" role="status">${esc(answered)}</p>` : '');
    // An untrusted folder gets no cards: STOP and the reason, nothing that could press.
    if (trusted === false) body = drawHeader(null) + `<p class="notice" role="status">${esc(UNTRUSTED)}</p>`;
    else if (view === 'settings') body = drawHeader(m) + alert + drawSettings(settings);
    else if (view === 'briefing') body = drawHeader(m) + alert + drawBriefing(text(briefing));
    else if (view === 'board') body = drawHeader(m) + alert + drawBoard(m);
    else body = drawHeader(m) + alert + drawOffer(offer) + (m && m.at !== null ? drawMissing(m) + drawVerdict(m) + drawCards(m, { at, recording, open }) + drawQuiet(m) : `<p class="note">${esc(FIRST_READING)}</p>`) + drawFoot(m);
  } catch {
    body = '<header><h1>Wheelhouse</h1></header><p class="notice">The pane couldn\'t be drawn just now.</p>';
  }
  const n = esc(nonce);
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${n}'; script-src 'nonce-${n}'; img-src data:;">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1"><title>Wheelhouse</title><style nonce="${n}">${STYLE}</style></head>`
    + `<body data-nonce="${n}">${body}<script nonce="${n}">${SCRIPT}</script></body></html>`;
}

module.exports = { renderPane, setLabels, LABEL_KEYS, statusText, needsYou, waitingCards, PANE_MOVES, OFFER, esc };
