// probes/haiku-trial/stand-in.js
// The stand-in director's answer to each open card: the option the card recommends, given the way the front desk
// shows it. A card shown as a picker gets the cursor moved to that option and Enter; a decision shown in the chat
// gets its typed reply ("1 A"). A card not on screen yet waits for a later look.

// The card kinds the stand-in answers like a click on a plan, approval or confirm card.
export const PICKED = ['approve-work', 'approval', 'confirm', 'ci-push', 'setup', 'confirm-all', 'baseline', 'trust'];
// A decision a build raised.
export const DECISION = 'answer';

const PICKER = /Enter to select/;
const OPTION = /^\s*(?:❯\s*)?(\d+)\.\s+(.*)$/;
const HIGHLIGHTED = /^\s*❯\s*\d+\.\s/;
const QUESTION_LINE = /^Answer question q-(.+)-(\d+)$/;

const labelOf = (option) => (typeof option === 'string' ? option : option?.label);
const clean = (label) => String(label ?? '').replace(/\s*\(Recommended\)\s*$/, '').trim();

// The index of the option the card recommends: the one whose description or label says so, else the first.
export function recommendedIndex(data) {
  const options = Array.isArray(data?.options) ? data.options : [];
  const descriptions = Array.isArray(data?.descriptions) ? data.descriptions : options.map((o) => o?.description);
  const byDescription = descriptions.findIndex((d) => /^Recommended\b/.test(String(d ?? '')));
  if (byDescription !== -1) return byDescription;
  const byLabel = options.findIndex((o) => /\(Recommended\)/.test(String(labelOf(o) ?? '')));
  return byLabel === -1 ? 0 : byLabel;
}

// The work a decision belongs to, read from its card's line ("Answer question q-<work>-<n>").
export const decisionWork = (data) => QUESTION_LINE.exec(String(data?.line ?? ''))?.[1];

// Whether the pane shows this card as its open picker: the picker is there and the card's first two question lines
// are on screen (approval cards all start "Approve this work as written?", so one line is not enough).
function showsCard(pane, data) {
  if (!PICKER.test(pane)) return false;
  const lines = String(data?.question ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2);
  return lines.length > 0 && lines.every((l) => pane.includes(l.slice(0, 60)));
}

// The keys that move the picker's cursor to `label` and choose it, or null when the picker does not list it.
function pickerKeys(pane, label) {
  const options = pane.split('\n').filter((l) => OPTION.test(l));
  const at = options.findIndex((l) => HIGHLIGHTED.test(l));
  const want = options.findIndex((l) => clean(OPTION.exec(l)[2]) === clean(label));
  if (at === -1 || want === -1) return null;
  const moves = Array.from({ length: Math.abs(want - at) }, () => (want > at ? 'Down' : 'Up'));
  return [...moves, 'Enter'];
}

// The chat number the front desk gave a decision ("Decision needed (2): <its title>"), or null.
function decisionNumber(pane, data) {
  const title = String(data?.question ?? '').split('\n')[0].trim();
  if (title === '') return null;
  for (const line of pane.split('\n')) {
    const m = /Decision needed \((\d+)\):\s*(.*)$/.exec(line);
    if (m && m[2].startsWith(title.slice(0, 60))) return Number(m[1]);
  }
  return null;
}

// What the stand-in does now about each open card: [{ card, label, keys }] or [{ card, label, type }].
// `done` holds the cards already acted on; `skipWork` the work whose decisions the run answers itself.
export function standInAnswers({ events, pane, done = new Set(), skipWork = new Set() }) {
  const answered = new Set(events.filter((e) => e.kind === 'card-answer').map((e) => e.data?.card));
  const actions = [];
  for (const card of events.filter((e) => e.kind === 'card')) {
    const data = card.data ?? {};
    const isDecision = data.kind === DECISION;
    if (!PICKED.includes(data.kind) && !isDecision) continue;
    if (answered.has(card.id) || done.has(card.id)) continue;
    if (isDecision && skipWork.has(decisionWork(data))) continue;
    const index = recommendedIndex(data);
    const label = clean(labelOf(data.options?.[index]));
    if (label === '') continue;
    if (showsCard(pane, data)) {
      const keys = pickerKeys(pane, label);
      if (keys) actions.push({ card: card.id, label, keys });
      continue;
    }
    if (isDecision) {
      const n = decisionNumber(pane, data);
      if (n !== null) actions.push({ card: card.id, label, type: `${n} ${String.fromCharCode(65 + index)}` });
    }
  }
  return actions;
}
