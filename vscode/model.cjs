// vscode/model.cjs
// What the panel is drawn from (vscode/pane/render.js): the desk/1 views, read into the state the drawing part
// takes. A pure function of the views, with no import from `scripts/`: the few rules it copies from core
// (which cards a panel may not decide) are the ones the helper enforces again, so a mistake here shows a button the
// helper refuses, never one that decides what it shouldn't.
'use strict';

const crypto = require('node:crypto');

const CARD_HASH_CHARS = 12;
// Steps the helper's window confirms (scripts/agents/chat-clicks.js CONFIRMED_STEPS, with pairing).
const CONFIRMED_STEPS = ['lift-stop', 'guardrail-change', 'unattended', 'runbook-step', 'ci-push', 'ask-allowance', 'pairing'];
const CONFIRMED_KINDS = ['pair', 'unpair'];
// The deciding labels (scripts/hooks/prompt-record.js SIGNED_LABELS).
const SIGNED_LABELS = ['Approve', 'Send it back', 'Confirm', 'Lift All stop', 'Lift STOP', 'Do it', 'Push it', 'Change it', 'End it', 'Merge the fix', 'Pair it', 'Unpair it'];

const isRecord = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const str = (x) => (typeof x === 'string' ? x : '');

// A plain merge approval, as the composer writes one and core's isMergeApproval reads it (scripts/desk/evidence.js): kind approval, at
// level 3, with the approval set line. A level-4 approval is a guardrail change, which the window confirms. Read from the live card,
// never from its id.
const APPROVAL_SET_LINE = /^Approve pull request #[1-9][0-9]* at commit [0-9a-f]{12}$/;
const isMergeApproval = (data) => isRecord(data) && data.kind === 'approval' && data.level === 3 && typeof data.line === 'string' && APPROVAL_SET_LINE.test(data.line);

// A card's text as the director reads it: the lines that are for the signing, not for them, are left out. They are the reply
// code, the set line just before it, and the last line of a card that has a set line without a reply code (setup's).
const REPLY_CODE_LINE = /^Reply code: \S+$/;
const LISTED_LINE = /^(?:Set up step [0-9]{1,2} as listed|Confirm all [1-9][0-9]* rules? as listed), [0-9a-f]{12}$/;
const SET_LINE = /^(?:Approve|Confirm|Push|Runbook|Answer|Change|End|Merge|Set|Unpair|Pair|Lift|Uninstall|Keep|Install|Update)\b.*$/;
function readable(question) {
  const lines = question.split(/\r\n|[\n\r\u2028\u2029]/);
  const drop = new Set();
  lines.forEach((line, i) => {
    if (REPLY_CODE_LINE.test(line)) {
      drop.add(i);
      if (i > 0 && SET_LINE.test(lines[i - 1])) drop.add(i - 1);
    }
  });
  if (lines.length > 1 && LISTED_LINE.test(lines.at(-1))) drop.add(lines.length - 1);
  return lines.filter((_, i) => !drop.has(i)).join('\n').trim();
}

function cardOf(entry) {
  const data = isRecord(entry.data) ? entry.data : {};
  const id = str(entry.id);
  const question = str(data.question) || str(data.title);
  const parts = isRecord(data.parts) ? data.parts : {};
  const recommend = str(data.recommend);
  const options = (Array.isArray(parts.options) && parts.options.length > 0 ? parts.options : Array.isArray(data.options) ? data.options : [])
    .map((o) => (typeof o === 'string' ? { label: o } : o))
    .filter((o) => isRecord(o) && str(o.label) !== '')
    .map((o) => ({ label: o.label, says: str(o.says), recommended: recommend !== '' && o.label === recommend, signs: SIGNED_LABELS.includes(o.label) }));
  return {
    id,
    hash: crypto.createHash('sha256').update(question).digest('hex').slice(0, CARD_HASH_CHARS),
    kind: str(data.kind),
    header: str(parts.header),
    question: readable(question),
    what: str(parts.what),
    why: str(parts.why),
    meanwhile: str(parts.meanwhile),
    recommendation: str(parts.recommendation),
    merge: isMergeApproval(data),
    confirmed: CONFIRMED_STEPS.some((step) => id === step || id.startsWith(`${step}-`)) || CONFIRMED_KINDS.includes(str(data.kind)),
    // A decision is an answer card (scripts/decisions/pending.js); the helper tells a build question from one.
    decision: str(data.kind) === 'answer',
    options,
  };
}

// Copies of scripts/foreman/queue.js (since, endedBy, NO_PLAN, STARTS_UNAPPROVED) and scripts/desk/views.js (isOpen),
// which a test compares with core's.
const ENDED = ['merged', 'closed'];
const NO_PLAN = ['quick', 'bug'];
const STARTS_UNAPPROVED = ['quick', 'bug'];
const since = (record, workEntry) => typeof record?.at === 'string' && !(typeof workEntry?.at === 'string' && workEntry.at > record.at);
const endedBy = (reports, id, workEntry) => ENDED.includes(reports?.[id]?.data?.outcome) && since(reports[id], workEntry);

function isOpen(views, id) {
  const entry = isRecord(views.work) ? views.work[id] : undefined;
  if (!isRecord(entry)) return false;
  const feature = isRecord(views.features) ? views.features[id] : undefined;
  const closed = feature?.data?.step === 'closed' && since(feature, entry.work);
  return !closed && !endedBy(views.reports, id, entry.work);
}

// Open work's step in the director's words, as scripts/desk/views.js workState gives them for a piece without a
// helm or an engine run.
function stepWords(entry, feature) {
  const { lane, visible } = entry.work?.data ?? {};
  const step = isRecord(feature?.data) && !(feature.data.step === 'closed' && !since(feature, entry.work)) ? feature.data.step : null;
  if (step === 'building' || (step === 'started' && NO_PLAN.includes(lane))) return 'building';
  if (step === 'started') return 'writing its plan';
  if (step === 'planned') return 'planned, waiting for the go-ahead to build';
  if (step === 'paused') return 'paused';
  const approval = (!STARTS_UNAPPROVED.includes(lane) || visible === true) && entry.approved !== true;
  return approval ? 'waiting for the director\'s approval' : 'queued, not started yet';
}

function workOf(data) {
  const views = isRecord(data?.views) ? data.views : {};
  const work = isRecord(views.work) ? views.work : {};
  const features = isRecord(views.features) ? views.features : {};
  return Object.keys(work).filter((id) => isOpen(views, id)).map((id) => ({
    title: str(work[id]?.work?.data?.title) || id,
    state: stepWords(work[id], features[id]),
  }));
}

// The cards that are waiting now: the record's `waiting` view. (The `cards` the waiting view also carries is every
// card event ever written, answered ones too.)
const waitingCards = (waiting) => (Array.isArray(waiting?.views?.waiting) ? waiting.views.waiting.filter((c) => isRecord(c) && str(c.id) !== '') : []);

// The notices the watch has given, as lines.
const noticeLines = (notices) => (Array.isArray(notices) ? notices : []).flatMap((n) => (Array.isArray(n?.lines) ? n.lines.filter((l) => typeof l === 'string') : []));

// stateOf({ state, says, fingerprint, glance, waiting, work, allStop, notices, realUsers }) -> the drawing's state.
function stateOf(model) {
  const moved = isRecord(model.moved) ? model.moved : {};
  const waiting = waitingCards(model.waiting).map(cardOf).map((c) => (moved[c.id] === c.hash ? { ...c, moved: true } : c));
  const notices = noticeLines(model.notices);
  // A name the desk gives, else the folder's name; the desk's slug ("host__name") is never shown whole.
  const slug = [model.waiting, model.work, model.glance].map((d) => (Array.isArray(d?.names) ? str(d.names[0]) : '')).find((n) => n !== '') ?? '';
  const project = slug !== '' && !slug.includes('__') ? slug : str(model.projectName) !== '' ? str(model.projectName) : slug.slice(slug.lastIndexOf('__') + 2);
  return {
    state: model.state,
    notice: model.says ?? (notices.length > 0 ? notices.join(' ') : undefined),
    notices,
    ...(str(model.said) !== '' ? { answered: model.said } : {}),
    ...(project !== '' ? { project } : {}),
    fingerprint: model.fingerprint,
    glance: str(model.glance?.glance),
    ...(model.realUsers === true ? { realUsers: true } : {}),
    cards: waiting,
    work: workOf(model.work),
  };
}

module.exports = { stateOf, cardOf, isMergeApproval, waitingCards, isOpen, stepWords, CONFIRMED_STEPS, SIGNED_LABELS };
