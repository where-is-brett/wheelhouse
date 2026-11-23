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
    question,
    what: str(parts.what),
    why: str(parts.why),
    meanwhile: str(parts.meanwhile),
    recommendation: str(parts.recommendation),
    merge: /^merge-/.test(id),
    confirmed: CONFIRMED_STEPS.some((step) => id === step || id.startsWith(`${step}-`)) || CONFIRMED_KINDS.includes(str(data.kind)),
    // A decision is an answer card (scripts/decisions/pending.js); the helper tells a build question from one.
    decision: str(data.kind) === 'answer',
    options,
  };
}

function workOf(data) {
  const views = isRecord(data?.views) ? data.views : {};
  const work = isRecord(views.work) ? views.work : {};
  const features = isRecord(views.features) ? views.features : {};
  return Object.entries(work).map(([id, item]) => ({
    title: str(item?.work?.data?.title) || id,
    state: str(features[id]?.data?.step),
  }));
}

// stateOf({ state, says, fingerprint, glance, waiting, work, allStop, notices, realUsers }) -> the drawing's state.
function stateOf(model) {
  const waiting = isRecord(model.waiting) && Array.isArray(model.waiting.cards) ? model.waiting.cards.filter(isRecord).map(cardOf) : [];
  return {
    state: model.state,
    notice: model.says ?? undefined,
    fingerprint: model.fingerprint,
    glance: str(model.glance?.glance),
    ...(model.realUsers === true ? { realUsers: true } : {}),
    cards: waiting,
    work: workOf(model.work),
  };
}

module.exports = { stateOf, cardOf, CONFIRMED_STEPS, SIGNED_LABELS };
