// scripts/agents/copilot/script-wakes.js
// The foreman's script-only wakes (Copilot return design, section 5.3). A wake whose outcome the scripts can settle
// uses no Copilot session: a merge, a close, an amendment or a question the foreman only forwards, a record that needs
// nothing. Only a wake that needs judgement starts one, and each is a request against the month.
//
// `events` are the wake's events, as scripts/foreman/wake.js reads them (`type`, `work`, `id`, `pr`, `detail`). This
// returns { script, acts, needs }: `script` is true when every event is settled by a command below (or needs nothing),
// `acts` those commands as `act` arguments in order, and `needs` the event types that want the foreman's judgement.
// A type this list doesn't know needs judgement, so a new kind of event is never settled unseen.
import { questionIdOf } from '../../lib/build-loop.js';

const HASH = /^[0-9a-f]{64}$/;
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const word = (v) => typeof v === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(v);

// Events that name no step: the wake's line says "nothing to do" or "the queue lists it".
const NOTHING = Object.freeze(['lift-incident', 'incident-fix', 'approval', 'ci-push', 'stop']);

// The act command an event settles with, or null when it needs judgement. `halted` is the wake's reading of STOP or an
// incident: a merge held for it is not settled by script, and not asked of the foreman either.
function actOf(event, { halted }) {
  const detail = isRecord(event.detail) ? event.detail : {};
  switch (event.type) {
    case 'amended': return word(event.work) && HASH.test(detail.hash) ? ['amend', event.work, detail.hash] : null;
    case 'question': return word(event.work) && word(event.id) ? ['question', event.work, event.id] : null;
    case 'extra-plan': return word(event.work) && word(event.id) ? ['extra-plan', event.work, event.id] : null;
    case 'merge-ready': return halted ? [] : word(event.work) ? ['merge', event.work] : null;
    case 'report': return word(event.work) ? ['close', event.work] : null;
    case 'stuck-note': return word(event.work) && typeof detail.at === 'string' ? ['stuck-note', event.work, detail.at] : null;
    case 'answer':
      // An answer to the foreman's own question needs the foreman to read what the option says to do.
      return questionIdOf(detail.questionId)?.foreman === true ? null : [];
    default: return NOTHING.includes(event.type) ? [] : null;
  }
}

export function scriptWake(events, { halted = false } = {}) {
  const acts = [];
  const needs = [];
  for (const event of Array.isArray(events) ? events : []) {
    const type = isRecord(event) && typeof event.type === 'string' ? event.type : 'unknown';
    const act = isRecord(event) ? actOf(event, { halted }) : null;
    if (act === null) needs.push(type);
    else if (act.length > 0) acts.push(act);
  }
  return { script: needs.length === 0, acts, needs };
}
