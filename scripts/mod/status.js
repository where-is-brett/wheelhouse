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
import { numberedWaiting, oneLine, NO_SETTINGS, NO_SOURCES } from '../board/model.js';
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

const VERSION = 1;
export const QUESTION_WAITS = 'A question from the build waits; the front desk will ask it';
// The views the pane reads: the glance's, the reports and glossary, and the open incidents.
const PANE_VIEWS = ['waiting', 'questions', 'work', 'features', 'reports', 'glossary', 'status', 'incidents'];
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

function clockOf(now) {
  const value = attempt(() => (typeof now === 'function' ? now() : now), null);
  const time = value instanceof Date ? value : new Date(value ?? Number.NaN);
  return Number.isNaN(time.getTime()) ? null : time;
}

// paneModel({ project, cwd, now }) -> Promise<PaneModel>. Reads files only and never throws: what
// can't be read becomes a line of `missing`. A card's text is kept exactly as written, for the
// mod to draw as plain text; every other line from an event is one line of plain words.
// `helperUp` is whether the host helper answered the caller (true, false, or undefined when it
// wasn't asked). The inputs are read from files alone, so the cards and lines come from the last
// sync; when the helper is down the model says so, and when that sync was, so old figures are
// never taken for current ones. `loadInputs` is for tests.
export async function paneModel({ project, cwd, now = () => new Date(), helperUp, loadInputs = loadBoardInputs } = {}) {
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
  // The board's own numbering: a card is shown by the number the board and the front desk give it.
  const cards = part('cards', () => numberedWaiting(views, cardEvents).flatMap((item) => {
    // A question from the build no card asks yet: the front desk asks it when it makes its card,
    // so it is never asked, and it ranks as that card will.
    if (item.card === undefined) {
      return [{
        id: item.id, n: item.n, header: HEADERS.question, kind: 'question', text: QUESTION_WAITS, hash: hashOf(QUESTION_WAITS), buttons: [], note: null, blocking: blocks(answerCardFor(item.question, views), views), asked: false,
      }];
    }
    const card = waiting.get(item.card);
    const data = card?.data;
    if (!isRecord(data)) return [];
    const text = cardTextOf(data);
    const { buttons, note } = cardButtons(data);
    // Asked: the front desk has handed the card out, or it was put off with no answer.
    const asked = card.asked !== null && card.asked !== undefined;
    return [{ id: item.id, n: item.n, header: plain(data.header) || HEADERS[kindOf(data)], kind: kindOf(data), text, hash: hashOf(text), buttons, note, blocking: blocks(card, views), asked }];
  }), []);

  const building = part('list of what is building', () => {
    const lines = list(model?.build?.features).filter((f) => f.step === 'building').map((f) => {
      const slice = isRecord(f.slice) && Number.isInteger(f.slice.n) && Number.isInteger(f.slice.m) ? `, slice ${f.slice.n} of ${f.slice.m}` : '';
      return plain(`Building ${oneLine(f.title) || oneLine(f.work) || 'untitled work'}${slice}`);
    });
    return lines.length <= PANE_LINES ? lines : [...lines.slice(0, PANE_LINES - 1), `and ${lines.length - PANE_LINES + 1} more building`];
  }, []);

  const health = part('health lines', () => list(model?.director?.health)
    .filter((l) => l.level === 'watch' || l.level === 'stop')
    .map((l) => ({ level: l.level, text: plain(l.text), of: ownLineOf(l) }))
    .filter((l) => l.text !== ''), []);

  const usage = part('usage line', () => (model === null ? null
    : briefingModel({ model, usage: inputs.usage, sources: inputs.sources, now: clock ?? undefined }).usage), null);

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

  return {
    v: VERSION,
    project,
    at: clock === null ? null : clock.toISOString(),
    glance: model === null ? 'Wheelhouse' : glanceLine(model),
    stop: { on: stop.on === true, since: typeof stop.at === 'string' ? stop.at : null },
    cards,
    building,
    health,
    usage: typeof usage === 'string' ? usage : null,
    finished,
    incidents,
    watcher: null,
    missing: [...new Set(missing)],
  };
}
