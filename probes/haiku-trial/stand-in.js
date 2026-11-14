// probes/haiku-trial/stand-in.js
// The stand-in director's answer to each open card: the option the card recommends, given the way the front desk
// shows it. A card shown as a picker gets the cursor moved to that option and Enter; a decision shown in the chat
// gets its typed reply ("1 A"). A card not on screen yet waits for a later look.

// The card kinds the stand-in answers like a click on a plan, approval or confirm card.
export const PICKED = ['approve-work', 'approval', 'confirm', 'ci-push', 'setup', 'confirm-all', 'baseline', 'trust'];
// A decision a build raised.
export const DECISION = 'answer';

// The cards only the director decides, read from the card's record: the kinds whose click is a confirmed step (lift STOP, a runbook
// step, a CI push, a confirmation, keeping control files, an incident, a take-over, a release or update) and a build question that offers an allowance (Allow this time, Allow for this feature). The stand-in never answers them.
export const DIRECTOR_ONLY_KINDS = Object.freeze(['lift-stop', 'runbook', 'ci-push', 'confirm', 'keep-control-files', 'lift-incident', 'incident-fix',
  'take-over', 'pair', 'release', 'update', 'update-helper', 'uninstall']);
const ALLOWANCE = /^\s*Allow (this time|for this feature)/i;
export function directorOnlyCard(data) {
  if (DIRECTOR_ONLY_KINDS.includes(data?.kind)) return true;
  return (data?.options ?? []).some((o) => ALLOWANCE.test(String(typeof o === 'string' ? o : o?.label ?? '')));
}
// The words of those cards on screen, for a picker no card in the record is found for. Only the cards' own questions and options: a bare
// step name such as "unattended" is not here, since a setup question can use it.
export const DIRECTOR_ONLY_WORDS = Object.freeze([/lift\s+(all\s+)?stop/i, /turn stop on\?/i, /contain live harm\?/i, /cut the agents' access/i,
  /put the product back to an earlier release\?/i, /put the project's records back/i, /push this change to the checks/i, /confirm this\?/i,
  /keep these files as they are/i, /end the incident/i, /allow this time/i, /allow for this feature/i, /emergency/i]);
export const directorOnlyWords = (text) => DIRECTOR_ONLY_WORDS.some((re) => re.test(String(text)));

const PICKER = /Enter to select/;
const OPTION = /^\s*(?:❯\s*)?(\d+)\.\s+(.*)$/;
export const HIGHLIGHTED = /^\s*❯\s*\d+\.\s/;
const QUESTION_LINE = /^Answer question q-(.+)-(\d+)$/;
const BAR = /^\s*│/;
const RECOMMENDED_LABEL = /\(Recommended\)/;
const SUBMIT_PAGE = /Ready to submit your answers\?/;
const SUBMIT = /^\s*❯\s*1\.\s*Submit answers/m;
// The pane's window is 60 rows; a picker open now is within them.
const SCREEN_LINES = 60;

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
const questionId = (data) => { const m = QUESTION_LINE.exec(String(data?.line ?? '')); return m ? `q-${m[1]}-${m[2]}` : undefined; };

// The picker open at the foot of the pane, or null: its question lines (drawn with a bar) and its option lines. Only
// the last picker counts; the pane's history holds every earlier one, and the chat above can hold numbered lists.
export function openPicker(pane) {
  const lines = String(pane).split('\n');
  let foot = -1;
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - SCREEN_LINES; i -= 1) {
    if (PICKER.test(lines[i])) { foot = i; break; }
  }
  // A picker whose hint line is not drawn still shows its cursor ("❯ 2. ...") on an option at the foot of the pane.
  if (foot === -1) {
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - SCREEN_LINES; i -= 1) {
      if (!HIGHLIGHTED.test(lines[i])) continue;
      foot = i + 1;
      while (foot < lines.length && (OPTION.test(lines[foot]) || /^\s+\S/.test(lines[foot]))) foot += 1;
      if (lines.slice(foot).some((l) => l.trim() !== '')) foot = -1;
      break;
    }
  }
  if (foot === -1) return null;
  let barEnd = foot - 1;
  while (barEnd >= 0 && !BAR.test(lines[barEnd])) barEnd -= 1;
  if (barEnd < 0) return null;
  let barStart = barEnd;
  while (barStart > 0 && BAR.test(lines[barStart - 1])) barStart -= 1;
  // The recommended option says so in its label ("Go ahead (Recommended)") or in the description under it.
  const body = lines.slice(barEnd + 1, foot);
  let recommended = -1;
  let index = -1;
  for (const line of body) {
    if (OPTION.test(line)) index += 1;
    if (recommended === -1 && index >= 0 && (RECOMMENDED_LABEL.test(line) || (!OPTION.test(line) && /^\s*Recommended\b/.test(line)))) recommended = index;
  }
  return {
    question: lines.slice(barStart, barEnd + 1).join('\n'),
    options: body.filter((l) => OPTION.test(l)),
    recommended,
  };
}

// Whether the open picker is this card: the card's first two question lines are its question (approval cards all
// start "Approve this work as written?", so one line is not enough).
export function showsCard(picker, data) {
  if (picker === null) return false;
  const lines = String(data?.question ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2);
  return lines.length > 0 && lines.every((l) => picker.question.includes(l.slice(0, 60)));
}

// The keys that move the picker's cursor to `label` and choose it, or null when the picker does not list it.
function pickerKeys(picker, label) {
  const at = picker.options.findIndex((l) => HIGHLIGHTED.test(l));
  const want = picker.options.findIndex((l) => clean(OPTION.exec(l)[2]) === clean(label));
  if (at === -1 || want === -1) return null;
  const moves = Array.from({ length: Math.abs(want - at) }, () => (want > at ? 'Down' : 'Up'));
  return [...moves, 'Enter'];
}

// Whether the foot of the pane is the last page of a picker of several questions, its cursor on "Submit answers".
export function readyToSubmit(pane) {
  const tail = String(pane).split('\n').slice(-SCREEN_LINES).join('\n');
  return SUBMIT_PAGE.test(tail) && SUBMIT.test(tail);
}

// Whether the desk is working on something: a spinner or its interrupt hint in the last lines of the pane. Text typed then
// lands in a reply being written, or is swallowed, so a typed reply waits for the desk to be still.
const BUSY = [/esc to interrupt/i, /\(\d+s\b.*(tokens|thinking)/i, /^\s*[✻✽✶✳✢·✦*]\s+\S.*…/];
const BUSY_LINES = 12;
export function deskBusy(pane) {
  const tail = String(pane).split('\n').filter((l) => l.trim() !== '').slice(-BUSY_LINES);
  return tail.some((l) => BUSY.some((re) => re.test(l)));
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
// `done` holds the cards acted on a moment ago, so a press is not repeated before the desk has taken it; `skipWork` the work whose decisions the run answers itself.
export function standInAnswers({ events, pane, done = new Set(), skipWork = new Set() }) {
  const answered = new Set(events.filter((e) => e.kind === 'card-answer').map((e) => e.data?.card));
  // A decision answered in the chat is recorded as an answer action naming its question.
  const decided = new Set(events.filter((e) => e.kind === 'action' && e.data?.action === 'answer').map((e) => e.data?.questionId));
  // Every question of the picker is answered: send them.
  if (readyToSubmit(pane)) return [{ card: null, label: 'Submit answers', keys: ['Enter'] }];
  const picker = openPicker(pane);
  const actions = [];
  for (const card of events.filter((e) => e.kind === 'card')) {
    const data = card.data ?? {};
    const isDecision = data.kind === DECISION;
    if (!PICKED.includes(data.kind) && !isDecision) continue;
    if (directorOnlyCard(data)) continue;
    if (answered.has(card.id) || done.has(card.id)) continue;
    if (isDecision && (skipWork.has(decisionWork(data)) || decided.has(questionId(data)))) continue;
    const index = recommendedIndex(data);
    const label = clean(labelOf(data.options?.[index]));
    if (label === '') continue;
    if (showsCard(picker, data)) {
      const keys = pickerKeys(picker, label);
      if (keys) actions.push({ card: card.id, label, keys });
      continue;
    }
    // A reply typed while another picker is open goes into that picker, and one typed over a working desk is lost.
    if (isDecision && picker === null && !deskBusy(pane)) {
      const n = decisionNumber(pane, data);
      if (n !== null) actions.push({ card: card.id, label, type: `${n} ${String.fromCharCode(65 + index)}` });
    }
  }
  return actions;
}
