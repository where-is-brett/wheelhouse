// scripts/engine/goal-report.js
// The report on a goal (unattended goals design, section 10), made by a script from the record alone, with no model anywhere, so it
// can't flatter and costs nothing. `goalReport` reads the views; `goalReportText` puts its answer in Calm's voice. It reads live,
// so a piece that merges after the end moves from Waits to Added and the report says so when next read. It stays in the private
// record: the desk's `goal` view, the briefing's opening and the Logbook show it, and it never reaches a pull request.
//
//   goalReport -> { id, title, verdict, added, decided?, waits: { top: [card], rest: [name] }, wrong: [line], spent }
//   verdict: { ending, time, done, switchOn, left: [name], closed: [name], stopped: [name], failed: [check], unrun: [check], said, checkedAgain, within }
//   added: { pieces: [name], flag, checks, walked }. `decided` is left out when empty, and is 'Nothing' when the sheet has ticks.
//
// A piece's name is its work's title as it stands. Facts that aren't in a view's own kind come from `views.goalNotes`: a slice added
// behind its switch, a run that lost its process and the merge queue's spend after the end. `goal-end.spent` holds what the meter
// last read and `goal-end.words` how often the main line went red: `dispatch.json` is never read here.
import { numberedWaiting, oneLine } from '../board/model.js';
import { importanceOf } from '../cards/visit.js';
import { answerLine } from '../state/card-lines.js';
import { checkKey } from './order.js';
import { goalInForce, lastCheckHolds, lastEnded, pieceCovered, unfinishedOf } from './goal.js';
import { goalRuns } from './goal-meter.js';
import { ALLOW_ONCE } from './areas.js';
import { REPORT_CARDS_SHOWN } from './goal-limits.js';
import {
  goalHeadlineWords, goalLineWords, leftUndoneWords, closedPiecesWords, pieceWaitsWords, checksFailedWords, checksUnrunWords, checkedAgainWords, addedTailWords, WALKED_WORDS, moreWaitingWords,
  sleptWords, sleptOftenWords, limitHeldWords, retriedWords, lostCarriedOnWords, goalStoppedAtEndWords, goalPieceFailedWords, goalPieceLeftWords, allowedOnceWords,
  goalSpentWords, goalReportLinkWords, shareWords, goalPaneWords,
} from './words.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const records = (x) => (Array.isArray(x) ? x.filter(isPlain) : []);
const MINUTE = 60000;
// The endings that didn't stop short: all the goal could do by itself is done, whatever then waits on the director.
const FINISHED = Object.freeze(['done', 'waiting-for-you']);

const nameOf = (views, work) => oneLine(views?.work?.[work]?.work?.data?.title) || work;
const isMerged = (views, work) => views?.reports?.[work]?.data?.outcome === 'merged';
const runsOf = (views, work) => records(views?.runs?.[work]);
const notesOf = (views) => records(views?.goalNotes);

// The time of day as "4:40 PM", in `timeZone` (the computer's own without one, or with one that can't be read).
function clockOf(at, timeZone) {
  const format = (zone) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: zone }).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  let parts;
  try {
    parts = format(timeZone);
  } catch {
    parts = format(undefined);
  }
  return `${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
}

// The slices of `work` added behind its switch since `goal` started, each once, by the notes that said so. One from before is an
// earlier goal's to claim, and the goal's own count of slices comes from any of them.
function slicesOf(goal, views, work) {
  const seen = new Map();
  for (const { at, data } of notesOf(views)) if (data?.work === work && Number.isInteger(data.slice?.n) && Date.parse(at) >= Date.parse(goal.startedAt)) seen.set(data.slice.n, data.slice);
  return [...seen.values()].sort((a, b) => a.n - b.n);
}

// The latest last check of this sheet, its own word on each result, by what the sheet says each check proves.
function lastCheckOf(goal, views) {
  const last = records(views?.goalChecks?.[goal.id]).filter((c) => c.when === 'last' && c.hash === goal.hash).at(-1) ?? null;
  const says = new Map(goal.sheet.done.map((check, i) => [checkKey(check), goal.sheet.checksSay?.[i]]));
  const label = ({ check }) => says.get(checkKey(check)) ?? check?.command ?? check?.test ?? check?.page ?? 'a check';
  const results = records(last?.results);
  return {
    last,
    failed: results.filter((r) => r.ok === false && r.unrun !== true).map(label),
    unrun: results.filter((r) => r.unrun === true).map(label),
    walked: results.some((r) => r.walked === true),
  };
}

function spentOf(goal, ending, views, timeZone) {
  const given = ending.spent;
  const after = [...new Map(notesOf(views).filter(({ data }) => data?.about === 'goal-queue-after' && data.goal === goal.id).map((note) => [note.data.run, note])).values()];
  return {
    tokens: given.tokens, allowed: goal.sheet.spend, points: typeof given.points === 'number' ? Math.round(given.points * 10) / 10 : null,
    requests: given.requests ?? null, unknown: given.unknown === true, readAt: typeof given.readAt === 'string' ? clockOf(given.readAt, timeZone) : null,
    afterEnd: after.length === 0 ? null : { tokens: after.reduce((sum, { data }) => sum + (data.tokens ?? 0), 0), unknown: after.some(({ data }) => data.unknown === true) },
  };
}

// Whether the goal ended inside what it was given: its spend `unknown` where any of it was.
// A limit on the sheet that couldn't be read leaves only the tokens to go by: `tokens`, never `inside`. The figures are the record's,
// before any rounding for the words.
function withinOf(goal, ending, spent) {
  const { allowed } = spent;
  const given = ending.spent;
  const over = (figure, limit) => typeof figure === 'number' && limit !== undefined && figure > limit;
  const unread = (figure, limit) => typeof figure !== 'number' && limit !== undefined;
  const beyond = over(given.tokens, allowed.tokens) || over(given.points, allowed.points) || over(given.requests, allowed.requests);
  const spend = spent.unknown ? 'unknown' : beyond ? 'over' : unread(given.points, allowed.points) || unread(given.requests, allowed.requests) ? 'tokens' : 'inside';
  return { time: Date.parse(ending.at) <= Date.parse(goal.sheet.until), spend };
}

// The question a card asks, an answer card's or a blind card's, or undefined.
const questionOfCard = (card) => /^(?:Answer question|First pick on question) (\S+)$/.exec(String(card?.data?.line ?? ''))?.[1];

// The work a waiting card or question speaks for, or null. An approval's card names only its pull request, and a run's record has
// that only once the run ends: a run paused at its approval is found by `pausedOn`.
function workOfCard(card, views) {
  if (typeof card?.data?.work === 'string') return card.data.work;
  const asked = views?.questions?.[questionOfCard(card)]?.question?.data?.work;
  if (typeof asked === 'string') return asked;
  const pr = /^Approve pull request #([1-9][0-9]*) /.exec(String(card?.data?.line ?? ''))?.[1];
  if (pr === undefined) return null;
  const gate = Object.values(isPlain(views?.gateAsks) ? views.gateAsks : {}).find((a) => a?.data?.pr === Number(pr));
  if (typeof gate?.data?.work === 'string') return gate.data.work;
  return Object.entries(isPlain(views?.runs) ? views.runs : {}).find(([, list]) => records(list).some((r) => r.data?.pr === Number(pr)))?.[0] ?? null;
}

const isAreaQuestion = (entry) => records(entry?.question?.data?.options).some((o) => o.label === ALLOW_ONCE);

// The area cards a new head has left behind: each stays open and decides nothing, so it is no one's to settle.
function supersededOf(views) {
  const newest = new Map();
  const old = new Set();
  const areaOnes = Object.entries(isPlain(views?.questions) ? views.questions : {}).filter(([, entry]) => isAreaQuestion(entry))
    .sort(([, a], [, b]) => String(a.question.at).localeCompare(String(b.question.at)));
  for (const [id, entry] of areaOnes) {
    const { work } = entry.question.data;
    if (newest.has(work)) old.add(newest.get(work));
    newest.set(work, id);
  }
  return old;
}

// The ask a piece's run is paused on now that waits on the director, or null. A usage limit waits on no one.
function pausedOn(views, work) {
  const run = runsOf(views, work).at(-1)?.data;
  if (run?.state !== 'paused') return null;
  const ask = records(views?.asks?.[work]).filter((a) => a.data?.runId === run.runId).at(-1);
  return ask === undefined || ask.data.kind === 'usage-limit' ? null : ask;
}

// What of the goal waits on the director, most important first and then oldest, as a visit's cards are ranked: the top few as cards,
// and the rest by name, with the `works` they hold up. A card of work that has merged, ended or isn't the goal's isn't counted. A
// piece paused on an ask with no card tied to it is still a thing that waits, so it stands in by name.
function waitsOf(goal, views, cards) {
  const open = new Set(unfinishedOf(goal, views));
  const old = supersededOf(views);
  const waiting = new Map(records(views?.waiting).map((card) => [card.id, card]));
  const items = numberedWaiting(views, cards).flatMap((item) => {
    const isQuestion = typeof item.question === 'string';
    const card = isQuestion ? { data: { kind: 'answer', line: answerLine(item.question), level: views.questions[item.question]?.question?.data?.level } } : waiting.get(item.card);
    const work = isQuestion ? views.questions[item.question]?.question?.data?.work : workOfCard(card, views);
    const asks = isQuestion ? item.question : questionOfCard(card);
    if (!open.has(work) || old.has(asks)) return [];
    return [{ n: item.n, title: item.what, work, rank: importanceOf(card, views), since: item.since }];
  });
  const named = new Set(items.map((item) => item.work));
  for (const work of open) {
    const ask = named.has(work) ? null : pausedOn(views, work);
    if (ask === null) continue;
    const kind = ask.data.kind !== 'approval' ? 'other' : views.work?.[work]?.work?.data?.lane === 'feature' ? 'switch' : 'approval';
    items.push({ title: pieceWaitsWords(nameOf(views, work), kind), work, rank: importanceOf({ data: { level: ask.data.level } }, views), since: ask.at });
  }
  items.sort((a, b) => b.rank - a.rank || String(a.since).localeCompare(String(b.since)));
  return {
    top: items.slice(0, REPORT_CARDS_SHOWN).map(({ n, title, work }) => ({ ...(n === undefined ? {} : { n }), title, work })), rest: items.slice(REPORT_CARDS_SHOWN).map((item) => item.title),
    works: items.map((item) => item.work),
  };
}

const spanIn = (from, to, start, end) => {
  const a = Math.max(Date.parse(from), start);
  const b = Math.min(Date.parse(to), end);
  return b > a ? { from: a, to: b } : null;
};
const minutesOf = (spans) => spans.reduce((sum, s) => sum + (s.to - s.from) / MINUTE, 0);

function sleepLines(views, start, end, timeZone) {
  const spans = records(views?.slept).map((s) => spanIn(s.from, s.to, start, end)).filter(Boolean);
  if (spans.length === 0) return [];
  return spans.length === 1 ? [sleptWords(minutesOf(spans), clockOf(spans[0].from, timeZone))] : [sleptOftenWords(spans.length, minutesOf(spans))];
}

// How long a usage limit held work: each limit's time, from its ask to the run's next word, overlaps counted once.
function limitLines(views, start, end) {
  const spans = [];
  for (const [work, asks] of Object.entries(isPlain(views?.asks) ? views.asks : {})) {
    for (const ask of records(asks).filter((a) => a.data?.kind === 'usage-limit')) {
      const next = runsOf(views, work).find((r) => r.data?.runId === ask.data.runId && r.at > ask.at && r.data.state !== 'paused');
      const span = spanIn(ask.at, next?.at ?? new Date(end).toISOString(), start, end);
      if (span !== null) spans.push(span);
    }
  }
  const merged = [];
  for (const span of spans.sort((a, b) => a.from - b.from)) {
    const last = merged.at(-1);
    if (last !== undefined && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }
  return merged.length === 0 ? [] : [limitHeldWords(minutesOf(merged))];
}

// Each run tried again after it failed, by what failed. A resume after anything but a failure is the director's own Give it more.
function retryLines(goal, views, end) {
  const kinds = new Map();
  for (const { work, runId } of goalRuns(goal, views)) {
    const own = runsOf(views, work).filter((r) => r.data?.runId === runId);
    own.forEach((r, i) => {
      const before = own[i - 1]?.data;
      if (Number.isInteger(r.data.resume) && before?.outcome === 'failed' && Date.parse(r.at) <= end) kinds.set(before.failure ?? 'other', (kinds.get(before.failure ?? 'other') ?? 0) + 1);
    });
  }
  return [...kinds].map(([kind, n]) => retriedWords(n, kind));
}

function lostLines(views, start, end) {
  const names = notesOf(views).filter(({ at, data }) => data?.lost === true && spanIn(at, new Date(end).toISOString(), start, end) !== null).map(({ data }) => nameOf(views, data.work));
  return names.length === 0 ? [] : [lostCarriedOnWords(names)];
}

function allowedLines(goal, views) {
  const listed = new Set(goal.sheet.pieces.map((p) => p.work));
  const since = Date.parse(goal.startedAt);
  const works = Object.values(isPlain(views?.questions) ? views.questions : {})
    .filter((entry) => isAreaQuestion(entry) && entry.answer?.label === ALLOW_ONCE && listed.has(entry.question.data.work) && Date.parse(entry.answer.at) >= since).map((entry) => entry.question.data.work);
  return [...new Set(works)].map((work) => allowedOnceWords(nameOf(views, work)));
}

// goalReport({ goal, views, ending, decisions, cards, timeZone }) -> the report. `goal` is an ended entry with its id (`lastEnded`'s),
// `ending` its `ended` by default. `decisions` waits for delegated decisions' stage 1. `cards` are the card events, which number the
// waiting list as the board does. Times are read out in `timeZone`, the computer's own without one.
export function goalReport({ goal, views, ending = goal.ended, decisions = [], cards = [], timeZone }) {
  const start = Date.parse(goal.startedAt);
  const end = Date.parse(ending.at);
  const unfinished = unfinishedOf(goal, views);
  const finished = ending.ending === 'done';
  // How a piece's run stood at the end, so a later run doesn't erase it: its last record by then, and the ending that leg came to,
  // which the stream may bring a moment after the goal's own record.
  const latest = (work) => {
    const own = runsOf(views, work);
    const at = own.findLastIndex((r) => Date.parse(r.at) <= end);
    return own[at]?.data?.state === 'ended' ? own[at].data : own[at + 1]?.data?.state === 'ended' && own[at + 1].data.runId === own[at]?.data?.runId ? own[at + 1].data : own[at]?.data;
  };

  const { last, failed, unrun, walked } = lastCheckOf(goal, views);
  const after = last !== null && Date.parse(last.at) > end;
  const checkedAgain = after ? lastCheckHolds(views.goalChecks, { id: goal.id, hash: goal.hash, head: last.head }) : null;

  const spent = spentOf(goal, ending, views, timeZone);
  const slices = goal.sheet.pieces.map((p) => p.work).filter((work) => !isMerged(views, work)).flatMap((work) => slicesOf(goal, views, work));
  const pieces = [...goal.sheet.pieces.map((p) => p.work).filter((work) => isMerged(views, work)).map((work) => nameOf(views, work)), ...slices.map((s) => s.title)];
  const flags = [...new Set(slices.map((s) => s.flag).filter((f) => typeof f === 'string'))];

  const stopped = unfinished.filter((work) => latest(work)?.state === 'ended' && latest(work).outcome === 'cancelled');
  const failedPieces = unfinished.filter((work) => latest(work)?.state === 'ended' && latest(work).outcome === 'failed');
  const left = unfinished.filter((work) => !pieceCovered(goal, work, views));
  const closed = goal.sheet.pieces.map((p) => p.work).filter((work) => !isMerged(views, work) && !unfinished.includes(work));
  const { works, ...waits } = waitsOf(goal, views, cards);

  const report = {
    id: goal.id,
    title: oneLine(goal.sheet.title),
    verdict: {
      ending: ending.ending, time: clockOf(ending.at, timeZone), done: finished, switchOn: finished && unfinished.length > 0,
      left: finished ? [] : unfinished.map((work) => nameOf(views, work)), closed: closed.map((work) => nameOf(views, work)), stopped: stopped.map((work) => nameOf(views, work)),
      failed, unrun, said: typeof last?.said === 'string' ? last.said : null, checkedAgain, within: withinOf(goal, ending, spent),
    },
    added: { pieces, flag: flags.length === 1 && slices.length === pieces.length ? flags[0] : null, checks: finished || checkedAgain === true, walked },
    waits,
    toSettle: new Set([...works, ...(finished ? [] : unfinished)]).size,
    wrong: [
      ...sleepLines(views, start, end, timeZone), ...limitLines(views, start, end), ...retryLines(goal, views, end), ...lostLines(views, start, end),
      ...(typeof ending.words === 'string' ? [ending.words] : []),
      ...stopped.map((work) => goalStoppedAtEndWords(nameOf(views, work))),
      ...failedPieces.map((work) => goalPieceFailedWords(nameOf(views, work), latest(work).failure)),
      ...left.map((work) => goalPieceLeftWords(nameOf(views, work))),
      ...allowedLines(goal, views),
    ],
    spent,
  };
  if (decisions.length > 0) report.decided = decisions;
  else if (Array.isArray(goal.sheet.ticks) && goal.sheet.ticks.length > 0) report.decided = 'Nothing';
  return report;
}

// The report in Calm's voice: the parts in the design's order, an empty part left out. Markdown, for a front end to show as written.
export function goalReportText(report) {
  const { verdict, added, decided, waits, wrong, spent, title } = report;
  const opening = [
    `**${goalHeadlineWords(title, verdict)}** ${goalLineWords(verdict.ending, verdict.time, verdict.within)}`,
    ...(verdict.left.length > 0 ? [leftUndoneWords(verdict.left)] : []),
    ...(verdict.closed.length > 0 ? [closedPiecesWords(verdict.closed)] : []),
    ...(verdict.failed.length > 0 ? [checksFailedWords(verdict.failed)] : []),
    ...(verdict.unrun.length > 0 ? [checksUnrunWords(verdict.unrun)] : []),
    ...(verdict.said !== null ? [verdict.said] : []),
    ...(verdict.checkedAgain !== null ? [checkedAgainWords(verdict.checkedAgain)] : []),
  ].join(' ');
  const count = waits.top.length + waits.rest.length;
  const parts = [opening];
  if (added.pieces.length > 0) {
    parts.push([`**Added (${added.pieces.length}):** ${added.pieces.join(' · ')}.`, addedTailWords(added.flag, added.checks), ...(added.walked ? [WALKED_WORDS] : [])].filter(Boolean).join(' '));
  }
  if (decided !== undefined) parts.push(`**Decided for you:** ${decided === 'Nothing' ? decided : decided.join(' · ')}`);
  if (count > 0) {
    parts.push([`**Waits for you (${count}):**`, ...waits.top.map((card) => `- ${card.title}`), ...(waits.rest.length > 0 ? [moreWaitingWords(waits.rest)] : [])].join('\n'));
  }
  if (wrong.length > 0) parts.push(`**What went wrong:** ${wrong.join(' ')}`);
  parts.push(`**Spent:** ${goalSpentWords(spent)}`);
  return parts.join('\n\n');
}

// Whether each item in the report is settled: nothing waits, and nothing is left undone.
export const goalSettled = (report) => report.waits.top.length + report.waits.rest.length === 0 && report.verdict.left.length === 0;

// The report on the goal `id`, or on the latest to end when no goal is in force, or null.
export function endedReport(views, { id, cards = [], timeZone } = {}) {
  const entry = typeof id === 'string' ? (isPlain(views?.goals) && Object.hasOwn(views.goals, id) ? { id, ...views.goals[id] } : null) : goalInForce(views) === null ? lastEnded(views) : null;
  return entry === null || entry.ended === null ? null : goalReport({ goal: entry, views, cards, timeZone });
}

// What the briefing opens with: the whole report the first time after a goal ended, then a line pointing to it until each item is
// settled, then nothing. `since` is when the last briefing was.
export function goalOpening(views, { since = null, cards = [], timeZone } = {}) {
  const report = endedReport(views, { cards, timeZone });
  if (report === null) return '';
  const fresh = typeof since !== 'string' || Date.parse(lastEnded(views).ended.at) > Date.parse(since);
  if (fresh) return goalReportText(report);
  return goalSettled(report) ? '' : goalReportLinkWords(report.title, report.toSettle);
}

// What the Logbook shows: the report, until each item in it is settled.
export function goalLogbook(views, { cards = [], timeZone } = {}) {
  const report = endedReport(views, { cards, timeZone });
  return report === null || goalSettled(report) ? '' : goalReportText(report);
}

// How much of `goal` is added: { added, of }. A feature counts its slices once one is known, and otherwise as one piece.
export function goalProgress(goal, views) {
  let added = 0;
  let of = 0;
  for (const { work } of goal.sheet.pieces) {
    const slices = slicesOf(goal, views, work);
    const whole = slices.at(-1)?.of ?? 1;
    of += whole;
    added += isMerged(views, work) ? whole : slices.length;
  }
  return { added, of };
}

// How much of the goal's spend is gone, in a word, by whichever limit it can read is nearest.
export function spendShareWords(meter, allowed) {
  const shares = ['tokens', 'points', 'requests'].filter((key) => typeof meter?.[key] === 'number' && typeof allowed?.[key] === 'number' && allowed[key] > 0).map((key) => meter[key] / allowed[key]);
  return shareWords(shares.length === 0 ? 0 : Math.max(...shares));
}

// The pane's one line for a goal in force. `live` is what the helper keeps of it ({ state, meter }), or null.
export function goalPaneLine({ goal, views, live = null, now }) {
  const meter = isPlain(live?.meter) ? live.meter : null;
  const { spend: allowed } = goal.sheet;
  const unread = ['points', 'requests'].some((key) => allowed[key] !== undefined && typeof meter?.[key] !== 'number');
  const spend = meter === null ? 'its spend not read yet' : meter.unknown === true ? 'its spend unknown' : `${spendShareWords(meter, allowed)} of its ${unread ? 'tokens' : 'spend'} used`;
  return goalPaneWords({ ...goalProgress(goal, views), state: live?.state, msLeft: Date.parse(goal.sheet.until) - now.getTime(), spend });
}

// The latest goal's ending, for the courier, or null while a goal is in force: { id, stoppedEarly }. Anything but a goal that did
// all it could by itself stopped early, and lets through Away (unattended goals design, section 11).
export function goalEndOf(views) {
  if (goalInForce(views) !== null) return null;
  const last = lastEnded(views);
  return last === null ? null : { id: last.id, stoppedEarly: !FINISHED.includes(last.ended.ending) };
}
