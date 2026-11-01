// scripts/desk/views.js
// The desk's views (spec 5.2), each finished here by the builder that makes it today, so no front
// end composes words of its own. readView gives `{ ok, view, data, lines }`: `data` is what the view
// is built from, which today's front ends read, and `lines` the finished words in Calm's voice.
import { glanceLine, renderBoard } from '../board/render.js';
import { heldByNotNow, numberedWaiting } from '../board/model.js';
import { effectiveSettings, settingsText } from '../settings/effective.js';
import { KNOWN, SETTINGS } from '../settings/catalogue.js';
import { glossaryOf, knownConcepts, plainWords, termPattern } from '../frontdesk/glossary.js';
import { endedBy, since, NO_PLAN, STARTS_UNAPPROVED } from '../foreman/queue.js';
import { cardTextOf, hashOf } from '../mod/status.js';
import { cardButtons } from '../mod/buttons.js';
import { dataHash } from '../state/events.js';
import { contextText } from './context.js';
import { readStatus } from '../safekeeping/readings.js';
import { paneFrom } from './mod-pane.js';
import { answeredLines, buildLines, runningLines, shippedLines } from '../engine/words.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const flat = (x) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : x);
const LABELS = [...Object.values(SETTINGS), KNOWN].map((setting) => setting.label);
export const NO_RECORD = 'This project has no record to show yet';

// Whether `id` names open work, as the queue reads it: no report has ended it, and its feature
// hasn't closed since it was queued (scripts/foreman/queue.js).
export function isOpen(views, id) {
  const entry = isPlain(views.work) ? views.work[id] : undefined;
  if (!isPlain(entry)) return false;
  const feature = isPlain(views.features) ? views.features[id] : undefined;
  const closed = feature?.data?.step === 'closed' && since(feature, entry.work);
  return !closed && !endedBy(views.reports, id, entry.work);
}

// The survey taken when setup finished, as short lines: what it counted, the requests by number
// and title, each piece of unfinished work by its name (for `carry-on --line`), its newest subject
// and how many changes it holds, the other setup's files, and the rules found, numbered, each with
// its source, so the front desk can confirm one when it first matters. A part with nothing in it
// is left out.
export function surveyLines(survey) {
  const data = isPlain(survey?.data) ? survey.data : null;
  if (data === null) return ['No survey has been taken.'];
  const list = (value) => (Array.isArray(value) ? value.filter(isPlain) : []);
  const count = (label, n, more) => `${label}: ${more ? 'at least ' : ''}${n}`;
  const requests = list(data.requests);
  const pushed = list(data.pushed).length;
  const local = list(data.local).length;
  const files = Array.isArray(data.instructions?.files) ? data.instructions.files.filter((f) => typeof f === 'string') : [];
  const sections = list(data.instructions?.sections).length;
  const rules = list(data.rules);
  const out = [];
  if (data.hostReached === false) out.push('The host could not be looked at.');
  if (requests.length > 0) {
    out.push(`Changes waiting to be merged: ${requests.length}`);
    for (const r of requests) out.push(`- number ${r.number}: ${flat(r.title)}${r.draft === true ? ' (a draft)' : ''}`);
  }
  const pieces = (items) => items.map((i) => {
    const saved = Number.isInteger(i.commits) && i.commits > 0 ? ` (${i.commits} ${i.commits === 1 ? 'change' : 'changes'} saved)` : '';
    return `- ${flat(i.name)}${flat(i.subject) ? `: ${flat(i.subject)}` : ''}${saved}`;
  });
  if (pushed > 0) out.push(count('Unfinished work pushed', pushed, data.more?.pushed === true), ...pieces(list(data.pushed)));
  if (local > 0) out.push(count('Unfinished work on this computer', local, data.more?.local === true), ...pieces(list(data.local)));
  if (files.length > 0) out.push(`Another agent setup's files: ${files.map(flat).join(', ')}`);
  if (sections > 0) out.push(`Parts of CLAUDE.md: ${sections}`);
  if (rules.length > 0) {
    out.push(`Rules found: ${rules.length}`);
    rules.forEach((r, i) => out.push(`${i + 1}. ${flat(r.words)} (${flat(r.source?.file)}, line ${r.source?.line})`));
  }
  return out.length > 0 ? out : ['The survey found nothing under way, no other instructions and no rules.'];
}

// What the new engine's run came to, for open work: only a finished run has built anything.
const RUN_ENDED_WORDS = { completed: 'built by the new engine', failed: 'stopped by a problem on the new engine', cancelled: 'cancelled on the new engine' };

// Open work's step or state in words, and whether a feature runs for it: one that is writing its
// plan or building. A quick or bug feature has no plan, so it builds from its start. A planned one
// waits for the go-ahead, and one the director's Not now to its build commands holds (`held`, as the
// board reads it) waits on them. Work whose feature closed before a `work` event queued it again
// hasn't started this time.
function workState(entry, feature, held, run) {
  const { lane, visible } = entry.work?.data ?? {};
  // The new engine's run for it, since it was queued: its records sit beside the old engine's features.
  if (isPlain(run?.data) && since(run, entry.work) && !isPlain(feature?.data)) {
    if (run.data.state !== 'ended') return { running: true, state: 'building on the new engine' };
    return { running: false, state: RUN_ENDED_WORDS[run.data.outcome] ?? 'stopped on the new engine' };
  }
  const step = isPlain(feature?.data) && !(feature.data.step === 'closed' && !since(feature, entry.work)) ? feature.data.step : null;
  if (step !== null && step !== 'closed' && held) return { running: false, state: 'waiting for the director to allow its build commands' };
  if (step === 'building' || (step === 'started' && NO_PLAN.includes(lane))) return { running: true, state: 'building' };
  if (step === 'started') return { running: true, state: 'writing its plan' };
  if (step === 'planned') return { running: false, state: 'planned, waiting for the go-ahead to build' };
  if (step === 'paused') {
    const why = { director: 'for the director\'s change to it', 'five-hour': 'until the five-hour usage window has room' }[feature.data.pausedFor];
    return { running: false, state: why ? `paused ${why}` : 'paused' };
  }
  const approval = (!STARTS_UNAPPROVED.includes(lane) || visible === true) && entry.approved !== true;
  return { running: false, state: approval ? 'waiting for the director\'s approval' : 'queued, not started yet' };
}

// The latest record of the new engine's runs for `id`, or undefined.
const latestRun = (views, id) => (isPlain(views.runs) && Array.isArray(views.runs[id]) ? views.runs[id].at(-1) : undefined);

// What each lane is, in words a sentence takes.
const LANE_WORDS = { quick: 'quick work', small: 'small work', feature: 'a feature', bug: 'a bug fix' };

// The open work, running work first, each oldest first (then by id): its id, title and lane, whether a feature
// runs for it, its step or state, the slice in hand and the pull request the gate waits on or its
// latest report names, either since the work was queued. `answers` are the card-answer events, for
// the director's Not now. In the glossary's plain words, but for the titles, kept as written: the
// front desk reads this to tell the director how things stand.
export function workLines(views, answers, words) {
  const features = isPlain(views.features) ? views.features : {};
  const questions = isPlain(views.questions) ? views.questions : {};
  const reports = Object.values(isPlain(views.reports) ? views.reports : {}).filter((r) => isPlain(r?.data));
  const held = (id) => {
    try {
      return heldByNotNow(id, questions, answers.filter(isPlain), reports);
    } catch {
      return false;
    }
  };
  const asks = Object.values(isPlain(views.gateAsks) ? views.gateAsks : {}).filter((a) => isPlain(a?.data));
  const open = Object.entries(isPlain(views.work) ? views.work : {}).filter(([id, entry]) => isPlain(entry?.work?.data) && isOpen(views, id))
    .map(([id, entry]) => ({ id, entry, ...workState(entry, features[id], held(id), latestRun(views, id)) }))
    .sort((a, b) => Number(b.running) - Number(a.running) || String(a.entry.since ?? a.entry.work.at).localeCompare(String(b.entry.since ?? b.entry.work.at))
      || a.id.localeCompare(b.id));
  if (open.length === 0) return ['No work is open: nothing is running or waiting.'];
  const lines = open.map(({ id, entry, running, state }) => {
    const { title, lane } = entry.work.data;
    const slice = running ? features[id]?.data?.slice : undefined;
    const report = views.reports?.[id];
    const pr = asks.filter((a) => a.data.work === id && since(a, entry.work)).sort((a, b) => String(a.at).localeCompare(String(b.at))).at(-1)?.data.pr
      ?? (since(report, entry.work) ? report?.data?.pr : undefined);
    return [
      `${id}: ${flat(title) || id}${Object.hasOwn(LANE_WORDS, lane) ? ` (${LANE_WORDS[lane]})` : ''}: ${running ? 'running' : 'not running'}`,
      state,
      ...(isPlain(slice) && Number.isInteger(slice.n) && Number.isInteger(slice.m) ? [`slice ${slice.n} of ${slice.m}`] : []),
      ...(Number.isSafeInteger(pr) && pr > 0 ? [`pull request #${pr}`] : []),
    ].join(', ');
  });
  // Labels, ids and work titles stay as written, as the board keeps titles (design section 21).
  const protect = [...LABELS, ...open.map(({ id }) => `${id}:`), ...open.map(({ entry }) => flat(entry.work.data.title)).filter((t) => t !== '')];
  return plainWords(lines.join('\n'), words.glossary, { ...words, protect }).text.split('\n');
}

// The one sentence the front desk says before card n on a Why?, word for word: the everyday example
// of the first term the card uses that the glossary gives one for, then what the card asks
// (scenario 36). With no such term, the sentence's form, for the front desk to fill.
export function whyNext(views, question, n) {
  const glossary = glossaryOf(views.glossary);
  const term = Object.keys(glossary).find((t) => glossary[t].example && termPattern(t).test(question));
  const like = term === undefined ? null : glossary[term].example.trim().replace(/^like\s+/i, '').replace(/[.!]+$/, '');
  const asks = String(question).split('\n')[0].trim();
  const how = `then card ${n} from \`again ${n}\` in your clickable-question tool, in the same message:`;
  if (like) return [`Say this one sentence, word for word, and nothing else, ${how}`, `It's like ${like}: card ${n} asks "${asks}"`];
  return [`Say one sentence and nothing else, ${how}`, `It's like <an everyday comparison>: <what card ${n} decides, in plain words>.`];
}

// The words the front desk's lines go through: the glossary, the explanations setting, the concepts
// the director knows, and what stays as written: the settings' names, the titles of the work and the
// `names` the project goes by. `own` is the director's own settings view.
export function deskWords(views, own, now, names = []) {
  const settings = effectiveSettings({ project: isPlain(views.settings) ? views.settings : {}, profile: isPlain(own) ? own : {}, now });
  const titles = Object.values(isPlain(views.work) ? views.work : {}).map((w) => flat(w?.work?.data?.title)).filter((t) => typeof t === 'string' && t !== '');
  return { glossary: glossaryOf(views.glossary), explanations: settings.explanations?.value, known: knownConcepts(settings), protect: [...LABELS, ...titles], names };
}

// The record's views as the helper gives them ({ views, names, stop, cards, answers, review }), or a refusal.
async function recordOf(source, args) {
  const got = await source.views(args);
  if (got?.ok !== true || !isPlain(got.views)) return { refused: got?.refused ?? NO_RECORD };
  return got;
}

// The director's own settings view, or none when it can't be read.
async function ownSettings(source) {
  try {
    const profile = await source.profile();
    return isPlain(profile?.settings) ? profile.settings : {};
  } catch {
    return {};
  }
}

// The board's inputs (loadBoardInputs'), or a refusal.
async function boardOf(source, options) {
  const inputs = await source.board(options);
  if (!isPlain(inputs) || inputs.none !== undefined || !isPlain(inputs.model)) return { refused: inputs?.none ?? NO_RECORD };
  return inputs;
}

const lined = (text) => String(text).split('\n');
const DAY_MS = 24 * 60 * 60 * 1000;

// The briefing's lines from the engine: what shipped since `since`.
async function engineBriefing(source, { since }) {
  let views = {};
  try { views = (await source.views({}))?.views ?? {}; } catch { views = {}; }
  if (!isPlain(views)) return [];
  return [...switchedLines(views, { since }), ...shippedLines(views, { since }), ...answeredLines(views, { since })];
}

// The briefing's one line for the switch to the new engine (Archon design, section 17, step 2): said in the first
// briefing after the engine setting took effect, and so once, as the next briefing's `since` is after it.
export const SWITCHED_LINE = 'New quick changes are built by the new engine.';
function switchedLines(views, { since }) {
  const engine = isPlain(views.settings) ? views.settings.engine : undefined;
  const at = engine?.confirmedAt;
  return engine?.value === 'archon' && typeof at === 'string' && (!since || at >= since) ? [SWITCHED_LINE] : [];
}

// One card of the waiting list by its id: its numbered item, the card event, its text and the
// buttons a press offers, the 12-character hash a pane press names and the sha256 of its data.
function cardOf(got, id, preview) {
  const item = numberedWaiting(got.views, got.cards ?? []).find((i) => i.id === id || i.card === id);
  const card = Array.isArray(got.views.waiting) ? got.views.waiting.find((c) => c.id === (item?.card ?? id)) : undefined;
  if (!isPlain(card?.data)) return null;
  const text = cardTextOf(card.data);
  const { buttons, note } = cardButtons(card.data, { preview });
  return { n: item?.n ?? null, card, text, buttons, note, hash: hashOf(text), dataHash: dataHash(card.data) };
}

const VIEWS = {
  // With `pane` (and `helperUp`, `at`, `timeZone`), data.pane is the mod's pane model (mod-pane.js), built
  // at `at` (now without one), whose glance is the view's line; it is given even when the inputs can't be read.
  async glance(args, source, { now }) {
    if (args.pane === true) {
      const at = typeof args.at === 'string' && Number.isFinite(Date.parse(args.at)) ? new Date(args.at) : now();
      const pane = await paneFrom(source, { now: () => at, helperUp: typeof args.helperUp === 'boolean' ? args.helperUp : undefined, timeZone: args.timeZone });
      return { ok: true, data: { glance: pane.glance, pane }, lines: [pane.glance] };
    }
    const inputs = await boardOf(source, { offline: true });
    if (inputs.refused) return { ok: false, refused: inputs.refused };
    const glance = glanceLine(inputs.model);
    return { ok: true, data: { glance, model: inputs.model, safekeeping: readStatus(source.project) }, lines: [glance] };
  },

  // `context` (with `reserve`, `since`, `weeklySince`, `survey`, `surveyAt`, `leaveOut`, `earlier`)
  // is the board-context hook's: the briefing with its heading, cut to the context's room.
  async briefing(args, source, { now }) {
    const inputs = await boardOf(source, { offline: false });
    if (inputs.refused) return { ok: false, refused: inputs.refused };
    const at = args.at ? new Date(args.at) : now();
    // The survey the briefing mentions is the record's latest, unless the caller took one again.
    const survey = args.survey !== undefined ? args.survey : ((await source.views({}))?.views?.survey ?? null);
    const given = contextText('briefing', inputs, { ...args, survey, project: source.project, at });
    // The engine's shipped work since the briefing's last, with its cost (Archon design, section 4.1).
    const extra = await engineBriefing(source, { since: args.since ?? new Date(at.getTime() - DAY_MS).toISOString() });
    if (extra.length > 0) given.text = `${given.text}\n${extra.join('\n')}`;
    return { ok: true, data: given, lines: lined(given.text) };
  },

  // `tab` 'director' or 'build'; with `context`, as the board-context hook adds it (heading, room, plain words).
  async logbook(args, source, { now }) {
    const inputs = await boardOf(source, { offline: false });
    if (inputs.refused) return { ok: false, refused: inputs.refused };
    if (args.context) {
      const given = contextText('board', inputs, { project: source.project, at: now(), tab: args.tab, reserve: args.reserve ?? 0 });
      return { ok: true, data: given, lines: lined(given.text) };
    }
    const tab = args.tab ?? inputs.settings?.boardTab?.value;
    let text = renderBoard(inputs.model, { tab, ...(args.limit ? { limit: args.limit } : {}) });
    // The build tab shows each run's steps in plain words and its cost.
    if (tab === 'build') {
      const runs = buildLines((await source.views({}))?.views ?? {}, { now: now() });
      if (runs.length > 0) text = `${text}\n\n${runs.join('\n')}`;
    }
    return { ok: true, data: { text }, lines: lined(text) };
  },

  // `cards`, `answers` and `review` ask for what the helper's views give with them. The record's
  // other views come with it, for the front desk's own lists (the rulebook, ideas, glossary, levels).
  async waiting(args, source) {
    const got = await recordOf(source, { cards: true, answers: args.answers === true, review: args.review === true });
    if (got.refused) return { ok: false, refused: got.refused };
    const numbered = numberedWaiting(got.views, got.cards ?? []);
    const lines = numbered.length === 0 ? ['Nothing is waiting for the director.'] : numbered.map((item) => `${item.n}. ${item.what}`);
    return { ok: true, data: { ...got, numbered }, lines };
  },

  async card(args, source) {
    const got = await recordOf(source, { cards: true });
    if (got.refused) return { ok: false, refused: got.refused };
    const found = cardOf(got, args.id, args.preview ?? null);
    if (found === null) return { ok: false, refused: `Card ${args.id} isn't waiting` };
    return { ok: true, data: found, lines: lined(found.text) };
  },

  async work(args, source, { now }) {
    const got = await recordOf(source, { answers: true });
    if (got.refused) return { ok: false, refused: got.refused };
    const lines = workLines(got.views, got.answers ?? [], deskWords(got.views, await ownSettings(source), now(), got.names ?? []));
    return { ok: true, data: got, lines: [...lines, ...runningLines(got.views, { now: now() })] };
  },

  // With `context`, `part: 'settings'` or `'sources'` as the board-context hook adds them.
  async settings(args, source, { now }) {
    if (args.context) {
      const inputs = await boardOf(source, { offline: false });
      if (inputs.refused) return { ok: false, refused: inputs.refused };
      const given = contextText(args.part === 'sources' ? 'sources' : 'settings', inputs, { project: source.project, at: now(), reserve: args.reserve ?? 0 });
      return { ok: true, data: given, lines: lined(given.text) };
    }
    const got = await recordOf(source, {});
    if (got.refused) return { ok: false, refused: got.refused };
    const own = await ownSettings(source);
    const effective = effectiveSettings({ project: isPlain(got.views.settings) ? got.views.settings : {}, profile: own, now });
    return { ok: true, data: { effective, project: got.views.settings ?? {}, profile: own, stop: got.stop === true }, lines: lined(settingsText(effective)) };
  },

  async usage(args, source) {
    const usage = await source.usage();
    if (!isPlain(usage)) return { ok: false, refused: 'Usage couldn\'t be read this time' };
    return { ok: true, data: usage, lines: [] };
  },

  async preview(args, source) {
    const address = await source.preview(args.card);
    return { ok: true, data: { card: args.card, address: typeof address === 'string' ? address : null }, lines: typeof address === 'string' ? [address] : [] };
  },

  // `n` is the number the card is shown by.
  async why(args, source) {
    const got = await recordOf(source, { cards: true });
    if (got.refused) return { ok: false, refused: got.refused };
    const found = cardOf(got, args.card, null);
    if (found === null) return { ok: false, refused: `Card ${args.card} isn't waiting` };
    const question = found.card.data.question;
    const lines = whyNext(got.views, question, args.n ?? found.n);
    return { ok: true, data: { question, n: args.n ?? found.n }, lines };
  },

  async survey(args, source) {
    const got = await recordOf(source, {});
    if (got.refused) return { ok: false, refused: got.refused };
    return { ok: true, data: { survey: got.views.survey ?? null }, lines: surveyLines(got.views.survey) };
  },
};

// readView(view, args, source, { now }) -> { ok, view, data, lines } | { ok: false, refused }.
export async function readView(view, args, source, { now = () => new Date() } = {}) {
  const answer = await VIEWS[view](args ?? {}, source, { now });
  return answer.ok ? { ...answer, view } : answer;
}

// The readers deskCore takes, one per view.
export const READERS = Object.fromEntries(Object.keys(VIEWS).map((view) => [view, (args, source, opts) => readView(view, args, source, opts)]));
