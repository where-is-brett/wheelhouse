// scripts/foreman/ask-help.js
// What `act ask` takes, said exactly, and the question a stuck work puts to the director. The wake lines, the help
// text and the errors of `act ask` all use these words, so a session that cannot work the command out is shown one
// that runs.

import { FOREMAN_QUESTIONS, questionIdOf } from '../lib/build-loop.js';
import { questionProblem } from '../cards/compose.js';
import { latestFor } from '../state/views.js';

// A command that runs as it stands, for `work`.
export function askExample(work = '<work>') {
  return `act ask ${work} --what 'Should ${work} go on?' --why 'It has not moved for 20 minutes.' `
    + "--option 'Go on=Leave it running' --option 'Drop it=Close the work' --recommend 'Go on' --level 2";
}

export const ASK_HELP = [
  'act ask <work> --what <the question> --why <why it comes to the director> --option "<label>=<what it means>" (two or more) --recommend <one of the labels> --level <1 to 4>',
  'Every flag takes a value; give --option once for each choice. Type it all on one line. For example:',
  `  ${askExample()}`,
  'It puts one card to the director. Nothing else is needed: do not close the wake as idle until it has run.',
].join('\n');

// The question for work that has sat still, as `act ask` would put it: `{ what, why, options, recommendation, level }`.
export const FIX_FINDINGS = 'Have the builder fix the findings';
export const RESTART_BUILDER = 'Restart the builder on where it left off';

// The signed review that holds pull request `pr`: its latest verified review, when that one has findings. Null when
// there is none or it is clean. `{ commit }` names the head it was taken on.
export function holdingReview(views, pr) {
  if (!Number.isSafeInteger(pr)) return null;
  const e = latestFor(views?.reviews, pr);
  return e?.data?.verdict === 'FINDINGS' && typeof e.data.commit === 'string' ? { commit: e.data.commit } : null;
}

export function stuckQuestion(work, { phase = null, still = 0, findings = false } = {}) {
  const move = findings ? FIX_FINDINGS : RESTART_BUILDER;
  const minutes = Math.round((Number(still) || 0) / 60000);
  return {
    what: `${work} has not moved for ${minutes} minutes${phase ? `, at the step called ${phase}` : ''}. What should happen?`,
    why: 'Nothing has moved it on, and no one has asked you about it. It holds its place while it waits.',
    options: [
      { label: move, says: `act restart ${work}` },
      { label: 'Wait', says: 'Nothing to do now; the watcher raises it again if it stays still' },
      { label: 'Drop it', says: 'Close the work with act close; it will not be built' },
    ],
    recommendation: move,
    level: 2,
  };
}

// The card for stuck `work` as the helper writes it, from the state's views: `{ data }`, or `{ skip }` saying why none.
// None when the work's feature has closed or is done, when the Bosun has an open question of its own for the work
// already, or when the card can't be composed.
export const PHASE_WORD = /^[a-z-]{1,32}$/;

export function stuckCardFor(views, { work, phase = null, still = 0, pr = null }) {
  if (views?.features?.[work] === undefined) return { skip: 'there is no such work' };
  // Only a plain phase word is worded into the card: anything else is left out.
  if (typeof phase !== 'string' || !PHASE_WORD.test(phase)) phase = null;
  const step = views?.features?.[work]?.data?.step;
  if (step === 'closed' || phase === 'done') return { skip: 'the work has ended' };
  const own = Object.values(views?.questions ?? {}).filter((q) => questionIdOf(q?.question?.data?.id)?.work === work && questionIdOf(q.question.data.id).foreman);
  if (own.some((q) => q.answer === null)) return { skip: 'the Bosun has asked already' };
  const n = Math.max(FOREMAN_QUESTIONS, ...own.map((q) => questionIdOf(q.question.data.id).n)) + 1;
  const data = { id: `q-${work}-${n}`, work, ...stuckQuestion(work, { phase, still, findings: holdingReview(views, pr) !== null }) };
  const problem = questionProblem(data);
  return problem === null ? { data } : { skip: `the card can't be composed: ${problem}` };
}
