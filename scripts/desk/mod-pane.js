// scripts/desk/mod-pane.js
// The pane's model (the mod's front desk pane, scripts/mod/status.js keeps it as status.json), built
// on the desk's side: from a desk source (paneFrom, which the glance view gives with `pane: true`),
// or from the files themselves (paneModel's own readers). It is built from the board's inputs, read
// offline, and numbers the cards as the board and the front desk do.
import crypto from 'node:crypto';
import { stateDir } from '../lib/paths.js';
import { loadBoardInputs } from '../board/inputs.js';
import { boardModel, numberedWaiting, oneLine, seeOf, NO_SETTINGS, NO_SOURCES } from '../board/model.js';
import { glanceLine } from '../board/render.js';
import { NO_HELPER, localViews } from '../hooks/session-start.js';
import { sayTime } from '../settings/effective.js';
import { briefingModel } from '../briefing/model.js';
import { HEADERS } from '../cards/compose.js';
import { glossaryOf, plainWords } from '../frontdesk/glossary.js';
import { stopState } from '../lib/stop.js';
import { listEvents } from '../state/events.js';
import { CARD_HASH_CHARS, PANE_LINES } from '../lib/mod-numbers.js';
import { importanceOf, IMPORTANCE } from '../cards/visit.js';
import { answerLine } from '../state/card-lines.js';
import { controlFilesDue, gateAsksDue, holdsDue, premiumFailuresDue } from '../cards/build-loop.js';
import { ownLineOf, brokenCount } from '../board/health.js';
import { cardButtons, kindOf } from '../mod/buttons.js';
import { previewFor } from '../mod/previews.js';
import { readSeen } from '../briefing/seen.js';
import { SHOW_ME, verdict, sinceLine, askedSince } from '../lib/calm-words.js';

export const PANE_VERSION = 1;
export const QUESTION_WAITS = 'A question from the build waits; the First Mate will ask it';
export const CARD_TO_MAKE = 'A card from the build waits; the First Mate will make it and ask it';
// The views the pane reads: the glance's, the reports and glossary, the open incidents, and the
// build's records the front desk makes cards from.
const PANE_VIEWS = ['waiting', 'questions', 'work', 'features', 'reports', 'glossary', 'status', 'incidents', 'blockers', 'ideas',
  'gateAsks', 'lineageHolds', 'controlFiles', 'premiumFailures'];
// The line of an approval card's set line, from which its preview is asked for.
const APPROVAL_LINE = /^Approve pull request #([1-9][0-9]*) at commit ([0-9a-f]{12})$/;
const NEVER_SYNCED = 'Nothing has been synced to this computer yet, so nothing below is current';
const NO_INPUTS = 'The Logbook\'s inputs couldn\'t be read this time';
const NO_CLOCK = 'The pane\'s clock couldn\'t be read';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const list = (value) => (Array.isArray(value) ? value.filter(isRecord) : []);

function attempt(read, fallback) {
  try {
    return read();
  } catch {
    return fallback;
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

// A time as HH:MM in the time zone given, or the computer's own time without one, or null when it
// isn't a time. A zone that can't be read is the computer's own.
function clockTime(value, timeZone) {
  const time = typeof value === 'string' ? new Date(value) : null;
  if (time === null || Number.isNaN(time.getTime())) return null;
  if (typeof timeZone === 'string' && timeZone !== '') {
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone })
        .formatToParts(time).map((p) => [p.type, p.value]));
      return `${parts.hour}:${parts.minute}`;
    } catch {
      // The computer's own time, below.
    }
  }
  return `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
}

// The pane's own views of a record's views: null when it has none of them, as localViews gives it.
function paneViewsOf(views) {
  if (!isRecord(views)) return null;
  const out = Object.fromEntries(PANE_VIEWS.filter((name) => Object.hasOwn(views, name)).map((name) => [name, views[name]]));
  return Object.keys(out).length > 0 ? out : null;
}

// The record as the files hold it: the pane's views, and the card events, each read on its own.
function filesRecord(project) {
  return {
    views: attempt(() => localViews(project, PANE_VIEWS), null),
    cardEvents: attempt(() => listEvents(stateDir(project), { report: () => {}, skipped: [] }).filter((e) => e.kind === 'card'), []),
  };
}

// The record as a desk source gives it, the same way: the views and their card events, or the
// events alone when the views can't be given.
async function sourceRecord(source) {
  const got = await Promise.resolve().then(() => source.views({ cards: true })).catch(() => null);
  if (got?.ok === true) return { views: paneViewsOf(got.views), cardEvents: list(got.cards).filter((e) => e.kind === 'card') };
  const events = await Promise.resolve().then(() => source.events?.() ?? []).catch(() => []);
  return { views: null, cardEvents: list(events).filter((e) => e.kind === 'card') };
}

function clockOf(now) {
  const value = attempt(() => (typeof now === 'function' ? now() : now), null);
  const time = value instanceof Date ? value : new Date(value ?? Number.NaN);
  return Number.isNaN(time.getTime()) ? null : time;
}

// paneModel({ project, cwd, now, helperUp, client, previews, timeZone }) -> Promise<PaneModel>. Reads files only and never throws: what
// can't be read becomes a line of `missing`. A card's text is kept exactly as written, for the
// mod to draw as plain text; every other line from an event is one line of plain words.
// `helperUp` is whether the host helper answered the caller (true, false, or undefined when it
// wasn't asked). The inputs are read from files alone, so the cards and lines come from the last
// sync; when the helper is down the model says so, and when that sync was, so old figures are
// never taken for current ones. `client` is the helper's, asked for an approval card's preview
// address; `previews` (previewFor by default) and `loadInputs` are for tests. `timeZone` is the one
// the pane's clock times are given in (the computer's own without one). `readRecord` and `readStop`
// read the record's views and card events, and STOP, from a desk source (paneFrom) instead of the files.
export async function paneModel({
  project, cwd, now = () => new Date(), helperUp, client, previews = previewFor, loadInputs = loadBoardInputs, timeZone,
  readRecord = async () => filesRecord(project), readStop = async () => stopState(),
} = {}) {
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

  const record = await Promise.resolve().then(() => readRecord()).catch(() => null);
  const views = isRecord(record?.views) ? record.views : null;
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

  const stop = await Promise.resolve().then(() => readStop()).then((got) => (isRecord(got) ? got : { on: true }), () => ({ on: true }));
  const cardEvents = Array.isArray(record?.cardEvents) ? record.cardEvents : [];
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
      steered: clockTime(card.steered, timeZone),
      waited: askedSince(card.at, clock),
      revised: typeof data.revises === 'string',
    }];
  }), []);
  // The build's records that wait on the director with no card yet, as the session start counts
  // them (cardsDue): a click the merge gate waits for, a hold, a control-file record and a premium
  // model's failed evaluation. The front desk makes and asks each card when it next runs `cards`,
  // so each is one line with no buttons, after the cards waiting, and is never asked; the courier
  // wakes the front desk for it. A hold holds all work, so it blocks.
  cards.push(...part('cards to make', () => {
    const make = (record, kind, blocking = false) => ({ id: `make:${record.id}`, at: record.at, kind, blocking });
    const due = [
      ...gateAsksDue(views, clock ?? new Date()).filter((d) => d.make).map(({ entry }) => make(entry, entry.data.ask === 'ci-push' ? 'ci-push' : 'approval')),
      ...holdsDue(views).map((h) => make(h, 'question', true)),
      ...controlFilesDue(views).map((r) => make(r, 'keep-control-files')),
      ...premiumFailuresDue(views).map((r) => make(r, 'premium')),
    ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return due.map((d, i) => ({
      id: d.id, n: cards.length + i + 1, header: HEADERS[d.kind], kind: d.kind, text: CARD_TO_MAKE, hash: hashOf(CARD_TO_MAKE), buttons: [], note: null, blocking: d.blocking, asked: false,
      parts: null, steered: null, waited: null, revised: false,
    }));
  }, []));

  const building = part('list of what is building', () => {
    const lines = list(model?.build?.features).filter((f) => f.step === 'building').map((f) => {
      const slice = isRecord(f.slice) && Number.isInteger(f.slice.n) && Number.isInteger(f.slice.m) ? `, slice ${f.slice.n} of ${f.slice.m}` : '';
      return { text: plain(`Building ${oneLine(f.title) || oneLine(f.work) || 'untitled work'}${slice}`), see: seeOf(isRecord(views?.work) ? views.work[f.work] : undefined) };
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
  const fuller = part('launch and ideas', () => (clock === null ? null : boardModel({ project, views, events: [], now: () => clock, since: sinceAt })?.director), null);

  const launch = part('progress to launch', () => {
    const progress = fuller?.launch;
    if (!isRecord(progress) || !Number.isInteger(progress.total) || progress.total < 1) return null;
    const mine = new Set(Array.isArray(fuller.ideas?.now) ? fuller.ideas.now : []);
    const gained = Number.isInteger(progress.gained) ? progress.gained : 0;
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
  const broken = brokenCount(healthLines);
  const sinceHour = clockTime(sinceAt, timeZone);

  return {
    v: PANE_VERSION,
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
    updated: clockTime(clock === null ? null : clock.toISOString(), timeZone),
    usage: typeof usage === 'string' ? usage : null,
    finished,
    incidents,
    watcher: null,
    missing: [...new Set(missing)],
  };
}

// paneFrom(source, { now, helperUp, timeZone }) -> Promise<PaneModel>: the pane's model from a desk
// source, as paneModel builds it from the files: the board's inputs offline, the record's views and
// card events, STOP, and an approval card's preview asked of the source's helper client.
export function paneFrom(source, { now = () => new Date(), helperUp, timeZone } = {}) {
  return paneModel({
    project: source.project,
    cwd: source.cwd,
    now,
    helperUp,
    client: source.client,
    timeZone,
    loadInputs: (options) => source.board({ offline: true, now: options.now }),
    readRecord: () => sourceRecord(source),
    readStop: () => source.stop(),
  });
}
