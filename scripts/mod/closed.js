// scripts/mod/closed.js
// Whether the questions open in the chat have been answered somewhere else, for the mod's one hook that closes a
// chat question (hooks/mod/close.ts). It counts a question as answered only on proof an agent can't write:
//   - a card in the state, decided by a verified signed record (a click's approval or action, or a confirmation), as
//     the helper verifies them. A plain `card-answer`, which anything reaching the helper's /state/write can write,
//     proves nothing here, so it closes nothing;
//   - the Lift All stop question, which is no card in the state: STOP being off.
// A question is a Wheelhouse card when it carries exactly one set line. It answers with how many of the questions are
// cards and how many of those are closed; the mod closes the chat's question only when every question is a card and
// every card is closed. It reads and writes nothing else.
import { listEvents } from '../state/events.js';
import { signedCardOutcomes } from '../state/views.js';
import { readEnrolled } from '../state/signing.js';
import { stateDir } from '../lib/paths.js';
import { stopState } from '../lib/stop.js';
import { setLineOf, chatCopy, isLiftStopLine } from '../state/card-lines.js';

// closedQuestions({ project, questions, outcomes?, stop? }) -> { cards, closed }. `questions` are the question texts as
// the chat holds them. `outcomes` (signedCardOutcomes) and `stop` (stopState) stand in for the state and STOP in a test.
export function closedQuestions({ project, questions, outcomes, stop = stopState }) {
  let all = null;
  const outcomesNow = () => {
    all ??= outcomes ?? signedCardOutcomes(listEvents(stateDir(project), { report: () => {} }), readEnrolled());
    return all;
  };
  let cards = 0;
  let closed = 0;
  for (const text of questions) {
    const line = typeof text === 'string' ? setLineOf(text) : null;
    if (line === null) continue;
    if (isLiftStopLine(line)) {
      cards += 1;
      if (!stop().on) closed += 1;
      continue;
    }
    const mine = outcomesNow().filter((o) => typeof o.card?.data?.question === 'string'
      && (o.card.data.question === text || chatCopy(o.card.data.question) === text));
    if (mine.length === 0) continue;
    cards += 1;
    // A card still waiting keeps its question open; the latest decided by a signed record closes it.
    if (mine.every((o) => o.decided !== null) && mine.at(-1).signed !== null) closed += 1;
  }
  return { cards, closed };
}
