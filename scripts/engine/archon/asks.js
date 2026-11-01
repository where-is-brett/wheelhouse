// scripts/engine/archon/asks.js
// Archon's attention items, turned into the engine interface's asks (spec 8.1 to 8.3). An item from Wheelhouse's pack
// carries `wh.*` labels and is read from them; Archon's own asks are matched against ARCHON_ASKS; anything else
// becomes a level-3 ask recommending that the work stop, with the reason in plain words. Nothing is dropped.
import { ASK_KINDS } from '../contract.js';
import { RED_MAIN, suspectOf } from '../fix-main.js';
import { mergeQuestionWords } from '../words.js';

const PACK = 'wh.';
const PACK_LABELS = ['kind', 'level', 'topic', 'work', 'recommend', 'preview', 'pr', 'head', 'holds'];

const optionIds = (item) => (Array.isArray(item.options) ? item.options.map((o) => o?.id) : []);
const when = (value) => {
  const time = Date.parse(value);
  return Number.isNaN(time) ? String(value) : new Date(time).toUTCString().replace(/:\d\d GMT$/, ' UTC');
};

// The pull request the merge queue's question is about, from the heading its record step writes, or null.
const askedPr = (message) => {
  const found = /^\W*Merge queue, PR (\d+): merge decision/.exec(String(message ?? ''));
  return found ? Number(found[1]) : null;
};

// The choice that leaves the merge queue's pull request alone, where its question offers one, or null. An attention item
// names only ids and labels, so the id comes from what the run's record says it asked (`mergeAsked`, check 90).
export function parkChoice(ask) {
  const id = ask?.mergeQuestion?.park;
  return typeof id === 'string' && id !== '' && (ask.options ?? []).some((o) => o?.id === id) ? id : null;
}

// Archon's own asks, in the order they are tried (spec 8.3). Each row: `test(item)`, then the ask's kind and level,
// what it recommends, `answer` when the card router answers it itself, `card` (false: a Logbook line only), `holdsAll`
// when every piece of work waits on it, `merge` for the merge queue's question about a pull request, `opens` when answering it opens an incident of that kind (with the pull
// request the queue's words suspect), and `say(item)`, the plain words for the card or the line.
export const ARCHON_ASKS = Object.freeze([
  Object.freeze({
    name: 'main-line-red',
    test: (item) => item.kind === 'attention' && item.labels?.merge === 'base' && optionIds(item).includes('hold'),
    kind: 'question', level: 1, recommend: 'hold', answer: 'hold', card: false, opens: RED_MAIN,
    say: () => 'The main line is red, so the merge queue holds merges until it is green again.',
  }),
  Object.freeze({
    name: 'merge-question',
    test: (item) => item.kind === 'attention' && item.labels?.merge === 'pr',
    // The merge queue waits on it, so every ready pull request does.
    kind: 'question', level: 3, recommend: null, card: true, holdsAll: true, merge: true,
    say: (item) => mergeQuestionWords(askedPr(item.message)),
  }),
  Object.freeze({
    name: 'rounds-ended',
    test: (item) => item.kind === 'attention' && optionIds(item).some((id) => id === 'rerun' || id === 'finish'),
    kind: 'question', level: 3, recommend: null, card: true,
    say: (item) => `The ${item.labels?.stage ?? 'review'} rounds ended without the work being ready.`,
  }),
  Object.freeze({
    name: 'usage-limit',
    test: (item) => item.kind === 'usage_limit',
    kind: 'usage-limit', level: 1, recommend: null, card: false,
    say: (item) => `A model provider's usage limit was reached; the run carries on by itself at ${when(item.resetAt)}.`,
  }),
]);

// The plain reason an item nobody recognises comes to the director.
function unknownReason(item) {
  if (item.kind === 'unreadable') return 'The engine paused a run and can\'t say why, so nothing can answer it. Stopping the work is the safe choice.';
  if (item.kind === 'awaiting_response') {
    return `The engine paused a run at an old-style approval Wheelhouse doesn't answer: "${item.message}". Stopping the work is the safe choice.`;
  }
  if (item.kind === 'attention') {
    return `The engine asked something Wheelhouse doesn't recognise: "${item.message}". Stopping the work is the safe choice.`;
  }
  return 'The engine is waiting on something new to Wheelhouse, which it can\'t read. Stopping the work is the safe choice.';
}

// The ask's id: the run and the pause's occurrence, so it is the same however often, and after however many
// restarts, the item is seen. (A resolved line names the occurrence but not the step, so the step isn't in it.)
// An item with no occurrence (a usage limit, an unreadable run) is keyed by what it has.
export function askIdOf(item) {
  if (item.occurrence) return `${item.runId}:${item.occurrence}`;
  if (item.kind === 'usage_limit') return `${item.runId}:usage-limit:${item.node}:${item.resetAt}`;
  return `${item.runId}:${item.kind}:${item.reason ?? 'waiting'}`;
}

// The occurrence an answer to `id` must name, or null when the id isn't an answerable ask of `runId`.
export function askOccurrence(runId, id) {
  const prefix = `${runId}:`;
  if (typeof id !== 'string' || !id.startsWith(prefix)) return null;
  const rest = id.slice(prefix.length);
  if (!rest || rest.startsWith('usage-limit:') || rest.includes(':')) return null;
  return rest;
}

// The pack's labels, without their prefix, or null when the item has none of them.
function packLabels(item) {
  const labels = {};
  for (const [key, value] of Object.entries(item.labels ?? {})) {
    if (key.startsWith(PACK) && PACK_LABELS.includes(key.slice(PACK.length))) labels[key.slice(PACK.length)] = value;
  }
  return Object.keys(labels).length > 0 ? labels : null;
}

const levelOf = (value) => (/^[1-4]$/.test(String(value)) ? Number(value) : null);

// One attention item as an `ask` EngineEvent: { type, runId, at, id, kind, level, work, topic, recommend, preview,
// setLine, labels, options, context, card, answer?, line?, reason? }.
export function normaliseAsk(item, { now = () => new Date().toISOString() } = {}) {
  const base = {
    type: 'ask',
    runId: item.runId,
    at: item.pausedAt ?? now(),
    id: askIdOf(item),
    options: (Array.isArray(item.options) ? item.options : []).map((o) => ({ id: o.id, label: o.label ?? o.id })),
    context: {
      question: item.message ?? null,
      branch: item.context?.branch ?? null,
      folder: item.context?.workingPath ?? null,
      artefacts: item.context?.artifactsDir ?? null,
      parent: item.parentRunId ?? null,
    },
  };
  const labels = packLabels(item);
  if (labels && item.kind === 'attention') {
    const level = levelOf(labels.level);
    if (ASK_KINDS.includes(labels.kind) && level !== null) {
      return {
        ...base,
        kind: labels.kind,
        level,
        work: labels.work ?? null,
        topic: labels.topic ?? null,
        recommend: labels.recommend ?? null,
        preview: labels.preview ?? null,
        setLine: labels.pr || labels.head ? { pr: labels.pr ?? null, head: labels.head ?? null } : null,
        labels,
        card: true,
      };
    }
    return {
      ...base, kind: 'trouble', level: 3, work: labels.work ?? null, recommend: 'stop', labels, card: true,
      reason: `A step of Wheelhouse's own asked a question it labelled in a way Wheelhouse can't read: "${item.message}". Stopping the work is the safe choice.`,
    };
  }
  const row = ARCHON_ASKS.find((r) => r.test(item));
  if (row) {
    const words = row.say(item);
    const ask = { ...base, kind: row.kind, level: row.level, work: null, recommend: row.recommend, labels: {}, card: row.card };
    if (row.answer) ask.answer = row.answer;
    if (row.holdsAll) ask.holdsAll = true;
    if (row.merge) ask.mergeQuestion = { pr: askedPr(item.message) };
    if (row.opens) {
      ask.opens = row.opens;
      ask.suspect = suspectOf(item.message);
    }
    if (row.card) ask.reason = words;
    else ask.line = words;
    return ask;
  }
  return { ...base, kind: 'trouble', level: 3, work: null, recommend: 'stop', labels: {}, card: true, reason: unknownReason(item) };
}
