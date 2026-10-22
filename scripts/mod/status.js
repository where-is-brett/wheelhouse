// scripts/mod/status.js
// The pane's model, and its keeping as projects/<project>/status.json so what the pane shows can
// be read without the mod. The model is built from the board's inputs, read from files alone,
// and numbers the cards as the board and the front desk do. The file is written whole through a
// temporary file, so a reader never sees half of it. The file functions are named apart from the
// feature files' readStatus and writeStatus.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../lib/paths.js';
import { loadBoardInputs } from '../board/inputs.js';
import { boardModel, numberedWaiting, oneLine, NO_SETTINGS, NO_SOURCES } from '../board/model.js';
import { glanceLine } from '../board/render.js';
import { NO_HELPER } from '../hooks/session-start.js';
import { sayTime } from '../settings/effective.js';
import { briefingModel } from '../briefing/model.js';
import { HEADERS } from '../cards/compose.js';
import { glossaryOf, plainWords } from '../frontdesk/glossary.js';
import { localViews } from '../hooks/session-start.js';
import { stopState } from '../lib/stop.js';
import { listEvents } from '../state/events.js';
import { CARD_HASH_CHARS, PANE_LINES } from '../lib/mod-numbers.js';
import { importanceOf, IMPORTANCE } from '../cards/visit.js';
import { answerLine } from '../state/card-lines.js';
import { STOP_LINE } from '../board/health.js';
import { cardButtons, kindOf } from './buttons.js';
import { previewFor } from './previews.js';
import { readSeen } from '../briefing/seen.js';
import { SHOW_ME, verdict, sinceLine } from '../lib/calm-words.js';

const VERSION = 1;
export const QUESTION_WAITS = 'A question from the build waits; the front desk will ask it';
// The views the pane reads: the glance's, the reports and glossary, and the open incidents.
const PANE_VIEWS = ['waiting', 'questions', 'work', 'features', 'reports', 'glossary', 'status', 'incidents', 'blockers', 'ideas'];
// The line of an approval card's set line, from which its preview is asked for.
const APPROVAL_LINE = /^Approve pull request #([1-9][0-9]*) at commit ([0-9a-f]{12})$/;
// What the pane says of a piece of work the director sees only when it is done, or before it merges.
const SEE_BEFORE_MERGE = 'Before it merges';
const SEE_IN_BRIEFING = 'In your briefing when it is done';
const NEVER_SYNCED = 'Nothing has been synced to this computer yet, so nothing below is current';
const NO_INPUTS = 'The board\'s inputs couldn\'t be read this time';
const NO_CLOCK = 'The pane\'s clock couldn\'t be read';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Whose own line a health line is, read before its words are made plain: STOP's, as the glance
// reads it, an open incident's, by the incident the board names on it, or neither (null).
function ownLineOf(line) {
  if (typeof line.incident === 'string') return 'incident';
  const text = String(line.text);
  return text === STOP_LINE || text.startsWith(`${STOP_LINE}, `) ? 'stop' : null;
}
const list = (value) => (Array.isArray(value) ? value.filter(isRecord) : []);

function attempt(read, fallback) {
  try {
    return read();
  } catch {
    return fallback;
  }
}

// projects/<project>/status.json; stateDir refuses a name that is not a folder name.
export function paneStatusFile(project) {
  return path.join(stateDir(project), '..', 'status.json');
}

// Keeps the model as the project's status.json. Throws when it can't be kept.
export function writePaneStatus(project, model) {
  if (!isRecord(model) || model.v !== VERSION) throw new Error('The pane\'s model must be a version 1 model');
  const file = paneStatusFile(project);
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, `${JSON.stringify(model)}\n`);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

// The model as last kept, or null when there is none, it is damaged or it is of another version.
export function readPaneStatus(project) {
  try {
    const kept = JSON.parse(fs.readFileSync(paneStatusFile(project), 'utf8'));
    return isRecord(kept) && kept.v === VERSION ? kept : null;
  } catch {
    return null;
  }
}

// The text the pane draws for a card's data, and a press names it by: its question, or its title
// when it has none.
export const cardTextOf = (data) => (typeof data?.question === 'string' ? data.question : typeof data?.title === 'string' ? data.title : '');

// Whether a card ranks above level 3 in the front desk's own order: STOP or an incident, level 4,
// or holding up all work.
const blocks = (card, views) => importanceOf(card, views) > IMPORTANCE.LEVEL_3;

// The answer card the front desk would compose for a question from the build, as far as its rank
// reads it: its kind, the question's answer line and the question's level (compose.js).
const answerCardFor = (id, views) => ({ data: { kind: 'answer', line: answerLine(id), level: views?.questions?.[id]?.question?.data?.level } });

// The first CARD_HASH_CHARS of the SHA-256 of a card's whole text: what a press names the card by.
export const hashOf = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, CARD_HASH_CHARS);

// A time as HH:MM in the computer's own time, or null when it isn't a time.
function clockTime(value) {
  const time = typeof value === 'string' ? new Date(value) : null;
  if (time === null || Number.isNaN(time.getTime())) return null;
  return `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
}

// "asked 2 hours ago", from the time a card was made to now; null when either can't be read or
// the card is from after now.
function waitedWords(at, clock) {
  const then = typeof at === 'string' ? Date.parse(at) : Number.NaN;
  if (Number.isNaN(then) || clock === null || then > clock.getTime()) return null;
  const minutes = Math.floor((clock.getTime() - then) / 60000);
  const unit = (n, name) => `asked ${n} ${name}${n === 1 ? '' : 's'} ago`;
  if (minutes < 1) return 'asked just now';
  if (minutes < 60) return unit(minutes, 'minute');
  if (minutes < 60 * 24) return unit(Math.floor(minutes / 60), 'hour');
  return unit(Math.floor(minutes / (60 * 24)), 'day');
}

function clockOf(now) {
  const value = attempt(() => (typeof now === 'function' ? now() : now), null);
  const time = value instanceof Date ? value : new Date(value ?? Number.NaN);
  return Number.isNaN(time.getTime()) ? null : time;
}

// paneModel({ project, cwd, now, helperUp, client, previews }) -> Promise<PaneModel>. Reads files only and never throws: what
// can't be read becomes a line of `missing`. A card's text is kept exactly as written, for the
// mod to draw as plain text; every other line from an event is one line of plain words.
// `helperUp` is whether the host helper answered the caller (true, false, or undefined when it
// wasn't asked). The inputs are read from files alone, so the cards and lines come from the last
// sync; when the helper is down the model says so, and when that sync was, so old figures are
// never taken for current ones. `client` is the helper's, asked for an approval card's preview
// address; `previews` (previewFor by default) and `loadInputs` are for tests.
export async function paneModel({ project, cwd, now = () => new Date(), helperUp, client, previews = previewFor, loadInputs = loadBoardInputs } = {}) {
  const clock = clockOf(now);
  const missing = [];
  if (clock === null) missing.push(NO_CLOCK);
  const inputs = await Promise.resolve().then(() => loadInputs({ cwd, now: () => clock ?? new Date(Number.NaN), offline: true })).catch(() => null);
  const model = isRecord(inputs?.model) ? inputs.model : null;
  if (model === null) missing.push(oneLine(inputs?.none) || NO_INPUTS);
  // A board built offline never reads the settings or the sources, so it can't have them.
  for (const line of Array.isArray(model?.missing) ? model.missing : []) {
    if (typeof line === 'string' && line !== NO_SETTINGS && line !== NO_SOURCES) missing.push(oneLine(line));
  }

  const views = attempt(() => localViews(project, PANE_VIEWS), null);
  if (helperUp === false) {
    missing.push(NO_HELPER);
    const builtAt = views?.status?.builtAt;
    missing.push(typeof builtAt === 'string' && !Number.isNaN(Date.parse(builtAt))
      ? `The state shown was last synced on ${sayTime(builtAt)}` : NEVER_SYNCED);
  }
  const glossary = attempt(() => glossaryOf(views?.glossary), glossaryOf({}));
  // One line of plain words, whatever it was written as.
  const plain = (text) => oneLine(plainWords(oneLine(text), glossary).text);
  const part = (name, build, fallback) => {
    try {
      return build();
    } catch {
      missing.push(`The pane's ${name} couldn't be built`);
      return fallback;
    }
  };

  const stop = attempt(() => stopState(), { on: true });
  const cardEvents = attempt(() => listEvents(stateDir(project), { report: () => {}, skipped: [] }).filter((e) => e.kind === 'card'), []);
  const waiting = new Map(list(views?.waiting).map((card) => [card.id, card]));
  const seen = attempt(() => readSeen(project, clock === null ? {} : { now: () => clock }), { briefedAt: null });
  const sinceAt = seen.briefedAt;
  const sinceMs = sinceAt === null ? Number.NaN : Date.parse(sinceAt);
  const after = (at) => !Number.isNaN(sinceMs) && typeof at === 'string' && Date.parse(at) > sinceMs;

  // An approval card's preview address, asked for once a tick at most. Only a card that offers
  // Show me, with the set line of an approval, is asked about.
  const tick = { asked: false };
  const previewOf = new Map();
  for (const item of attempt(() => numberedWaiting(views, cardEvents), [])) {
    const data = waiting.get(item.card)?.data;
    const found = isRecord(data) && data.kind === 'approval' && Array.isArray(data.options) && data.options.includes(SHOW_ME)
      ? APPROVAL_LINE.exec(String(data.line)) : null;
    if (found === null) continue;
    const address = await Promise.resolve().then(() => previews({
      project, pr: Number(found[1]), sha: found[2], client: helperUp === false ? undefined : client, now: () => clock ?? new Date(), tick,
    })).catch(() => null);
    previewOf.set(item.card, typeof address === 'string' && address.startsWith('https:') ? address : null);
  }
  // The board's own numbering: a card is shown by the number the board and the front desk give it.
  const cards = part('cards', () => numberedWaiting(views, cardEvents).flatMap((item) => {
    // A question from the build no card asks yet: the front desk asks it when it makes its card,
    // so it is never asked, and it ranks as that card will.
    if (item.card === undefined) {
      return [{
        id: item.id, n: item.n, header: HEADERS.question, kind: 'question', text: QUESTION_WAITS, hash: hashOf(QUESTION_WAITS), buttons: [], note: null, blocking: blocks(answerCardFor(item.question, views), views), asked: false,
        parts: null, steered: null, waited: null, revised: false,
      }];
    }
    const card = waiting.get(item.card);
    const data = card?.data;
    if (!isRecord(data)) return [];
    const text = cardTextOf(data);
    const { buttons, note } = cardButtons(data, { preview: previewOf.get(item.card) ?? null });
    // Asked: the front desk has handed the card out, or it was put off with no answer.
    const asked = card.asked !== null && card.asked !== undefined;
    return [{
      id: item.id,
      n: item.n,
      header: plain(data.header) || HEADERS[kindOf(data)],
      kind: kindOf(data),
      text,
      hash: hashOf(text),
      buttons,
      note,
      blocking: blocks(card, views),
      asked,
      // The card's parts as the composer kept them, already in plain words; null for a card with none, which is drawn as its text.
      parts: isRecord(data.parts) ? data.parts : null,
      steered: clockTime(card.steered),
      waited: waitedWords(card.at, clock),
      revised: typeof data.revises === 'string',
    }];
  }), []);

  // When the director sees a piece of work: before it merges where it is shown first, else in the briefing.
  const seeOf = (work) => {
    const entry = isRecord(views?.work) && isRecord(views.work[work]) ? views.work[work] : {};
    return entry.work?.data?.shownFirst === true || entry.approval?.shownFirst === true ? SEE_BEFORE_MERGE : SEE_IN_BRIEFING;
  };
  const building = part('list of what is building', () => {
    const lines = list(model?.build?.features).filter((f) => f.step === 'building').map((f) => {
      const slice = isRecord(f.slice) && Number.isInteger(f.slice.n) && Number.isInteger(f.slice.m) ? `, slice ${f.slice.n} of ${f.slice.m}` : '';
      return { text: plain(`Building ${oneLine(f.title) || oneLine(f.work) || 'untitled work'}${slice}`), see: seeOf(f.work) };
    });
    return lines.length <= PANE_LINES ? lines : [...lines.slice(0, PANE_LINES - 1), { text: `and ${lines.length - PANE_LINES + 1} more building`, see: null }];
  }, []);

  const healthLines = list(model?.director?.health);
  const health = part('health lines', () => healthLines
    .filter((l) => l.level === 'watch' || l.level === 'stop')
    .map((l) => ({ level: l.level, text: plain(l.text), of: ownLineOf(l) }))
    .filter((l) => l.text !== ''), []);

  const usage = part('usage line', () => (model === null ? null
    : briefingModel({ model, usage: inputs.usage, sources: inputs.sources, now: clock ?? undefined }).usage), null);

  // The pane's health group: whether all is well, the protection level and the week's share line.
  const healthNote = part('health note', () => ({
    allWell: model !== null && !healthLines.some((l) => l.level === 'watch' || l.level === 'stop'),
    protection: /^Protection: (Locked|Standard)$/.exec(healthLines.map((l) => String(l.text)).find((t) => t.startsWith('Protection: ')) ?? '')?.[1] ?? null,
    week: typeof usage === 'string' ? usage : null,
  }), { allWell: false, protection: null, week: null });

  // The offline model leaves out the blockers and the ideas, which the glance doesn't need and its
  // reading may not open; the pane has them in its own views, so the board model is built again
  // from those for its launch and ideas.
  const fuller = part('launch and ideas', () => (clock === null ? null : boardModel({ project, views, events: [], now: () => clock })?.director), null);

  const launch = part('progress to launch', () => {
    const progress = fuller?.launch;
    if (!isRecord(progress) || !Number.isInteger(progress.total) || progress.total < 1) return null;
    const mine = new Set(Array.isArray(fuller.ideas?.now) ? fuller.ideas.now : []);
    const gained = Object.values(isRecord(views?.blockers) ? views.blockers : {}).filter((b) => isRecord(b) && isRecord(b.data) && b.data.resolved === true && after(b.at)).length;
    const next = (Array.isArray(progress.next) ? progress.next : []).filter((t) => typeof t === 'string' && t !== '').slice(0, PANE_LINES)
      .map((t) => ({ text: plain(t), yours: mine.has(t) }));
    return { resolved: Number.isInteger(progress.resolved) ? progress.resolved : 0, total: progress.total, gained: Math.min(gained, progress.total), next };
  }, null);

  const ideas = part('ideas', () => {
    const given = isRecord(fuller?.ideas) ? fuller.ideas : {};
    const count = ['now', 'next', 'later'].reduce((sum, when) => sum + (Array.isArray(given[when]) ? given[when].length : 0), 0);
    const fresh = Object.values(isRecord(views?.ideas) ? views.ideas : {}).filter((i) => isRecord(i) && isRecord(i.data) && after(i.at)).length;
    return { count, fresh: Math.min(fresh, count) };
  }, { count: 0, fresh: 0 });

  const finished = part('list of finished work', () => Object.entries(isRecord(views?.reports) ? views.reports : {})
    .filter(([, report]) => isRecord(report) && report.data?.outcome === 'merged')
    .map(([work]) => work)
    .sort(), []);

  // The open incidents' ids, for the courier. No incidents view means none is open.
  const incidents = part('list of open incidents', () => {
    if (views?.incidents === undefined) return [];
    if (!Array.isArray(views.incidents?.open)) throw new Error('unreadable');
    return list(views.incidents.open).map((i) => i.id).filter((id) => typeof id === 'string' && id !== '');
  }, []);

  // Broken is a line at stop level that isn't STOP's own: STOP is the director's doing, not a fault.
  const broken = health.filter((l) => l.level === 'stop' && l.of !== 'stop').length;
  const sinceHour = clockTime(sinceAt);

  return {
    v: VERSION,
    project,
    at: clock === null ? null : clock.toISOString(),
    glance: model === null ? 'Wheelhouse' : glanceLine(model),
    stop: { on: stop.on === true, since: typeof stop.at === 'string' ? stop.at : null },
    cards,
    verdict: verdict({ waiting: cards.length, broken }),
    since: sinceHour === null ? null : sinceLine(sinceHour),
    launch,
    building,
    health,
    healthNote,
    ideas,
    updated: clockTime(clock === null ? null : clock.toISOString()),
    usage: typeof usage === 'string' ? usage : null,
    finished,
    incidents,
    watcher: null,
    missing: [...new Set(missing)],
  };
}
