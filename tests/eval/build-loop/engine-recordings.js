// tests/eval/build-loop/engine-recordings.js
// Recordings for the engine scenarios (42 to 50), in the fake engine's events: each a run of the quick lane that
// stops where the scenario needs it. Not a scenario file: it has no number.
const at = (minute) => new Date(Date.UTC(2026, 9, 29, 9, minute)).toISOString();
const started = (work) => ({ type: 'run-started', at: at(0), work, lane: 'quick', branch: `wh/${work}` });
const step = (minute, id, spend, extra = {}) => ({ type: 'step-finished', at: at(minute), step: id, role: id === 'implement' ? 'implementer' : 'reviewer', provider: 'claude', model: 'mid', minutes: 2, spend, ...extra });
const ended = (minute, outcome = 'completed', pr = null) => ({ type: 'run-ended', at: at(minute), outcome, pr });

// A run that asks one question of `level`, then finishes once it is answered.
export function asking(work, { level = 3, id = `${work}:ask:1`, topic = null, card = true, answer, line, what = 'How much of the page should change?' } = {}) {
  return [
    started(work),
    step(2, 'implement', { tokens: 40000, dollars: 0.1, source: 'reported' }),
    {
      type: 'ask', at: at(3), id, kind: 'question', level, topic, recommend: 'b', card,
      options: [{ id: 'a', label: 'Keep it small' }, { id: 'b', label: 'Do the whole page' }],
      context: { question: what }, ...(answer ? { answer } : {}), ...(line ? { line } : {}),
    },
    { type: 'ask-resolved', at: at(4), id },
    ended(6),
  ];
}

// A run that spends `tokens` in its first step, then holds before its next ask.
export function spending(work, tokens) {
  return [
    started(work),
    step(2, 'implement', { tokens, dollars: 3, source: 'reported' }),
    { type: 'ask', at: at(3), id: `${work}:ask:1`, kind: 'question', level: 3, recommend: 'b', card: true, options: [{ id: 'a', label: 'Keep it small' }, { id: 'b', label: 'Do the whole page' }], context: { question: 'How much of the page should change?' } },
    { type: 'ask-resolved', at: at(4), id: `${work}:ask:1` },
    ended(6),
  ];
}

// The merge queue's hold on a red main line: one ask, answered at level 1 with no card.
export function redMain(work) {
  return [
    started(work),
    { type: 'ask', at: at(3), id: `${work}:red:1`, kind: 'question', level: 1, recommend: 'hold', answer: 'hold', card: false, line: 'The main line is red, so the merge queue holds merges until it is green again.', options: [{ id: 'hold', label: 'Hold' }] },
    { type: 'ask-resolved', at: at(4), id: `${work}:red:1` },
    ended(6),
  ];
}

// A run still under way: it has finished its first step, spending `tokens`, and is working on the next.
export function running(work, tokens = 40000) {
  return [started(work), step(2, 'implement', { tokens, dollars: 0.1, source: 'reported' })];
}

// A run of visible work that opened pull request `pr` at `head` and waits for the director's approval, with the
// pictures its preview step took.
export function approving(work, { pr, head }) {
  return [
    started(work),
    step(2, 'implement', { tokens: 40000, dollars: 0.1, source: 'reported' }),
    step(4, 'preview', { tokens: 2000, dollars: 0.01, source: 'reported' }),
    {
      type: 'ask', at: at(5), id: `${work}:approval:1`, kind: 'approval', level: 3, recommend: 'approve', card: true, setLine: { pr, head }, preview: 'preview',
      options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Not this' }],
    },
    { type: 'ask-resolved', at: at(6), id: `${work}:approval:1` },
    ended(7, 'completed', pr),
  ];
}
