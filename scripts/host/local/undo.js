// scripts/host/local/undo.js
// The card asking to undo a merge on a project kept in git alone, and the signed click in the helper's window that
// decides it (ruling P5-50). Undo is a runbook step: it adds a commit that reverses the merge, confirmed in the
// helper's own window, and it works while STOP is on.
import { computerId, stateDir } from '../../lib/paths.js';
import { listEvents } from '../../state/events.js';
import { readEnrolled, verify } from '../../state/signing.js';

// The line the card carries, naming the merge in full: the window signs an undo only for a card that holds exactly one.
export const undoLine = (merge) => `Undo the merge ${merge} on the main version`;
export const UNDO_LINE = /Undo the merge ([0-9a-f]{40}) on the main version/g;

export const UNDO_NEEDS_WINDOW = 'Undo is confirmed in Wheelhouse\'s own window, not by a click in the chat: show the director the card there';

// `earlier` gives the card in its words before the ship's-crew names (27 October 2026), which a card raised before an
// update still holds (undoCards).
const UNDO_WORKS = 'Undo adds a new commit that reverses it: nothing is deleted, and later work stays. It is confirmed in Wheelhouse\'s own window, and it works while All stop is on.';
const UNDO_WORKS_EARLIER = 'Undo adds a new commit that reverses it: nothing is deleted, and later work stays. It is confirmed in Wheelhouse\'s own window, and it works while STOP is on.';
export function undoCard(merge, { earlier = false } = {}) {
  const line = undoLine(merge);
  return {
    question: [
      'Take this merge back out of the main version?',
      earlier ? UNDO_WORKS_EARLIER : UNDO_WORKS,
      line,
    ].join('\n'),
    header: 'Undo',
    options: ['Undo', 'Not now'],
    kind: 'runbook',
    level: 3,
    line,
  };
}

// The undo card in each of its wordings, the current one first: a click on either decides it.
export function undoCards(merge) {
  return [undoCard(merge), undoCard(merge, { earlier: true })];
}

// The latest signed click of `action` in the helper's window whose data `matches`, made on this computer by an enrolled
// key, naming the window's proof. Or null.
// Each click is used once: one an undo's own signed record names (`click`) counts no more, so a later undo needs a
// new click. Only signed undo records count as using one, so a plain note can't use up the director's click.
export function windowClick(project, action, matches) {
  const me = computerId();
  const enrolled = readEnrolled();
  const events = listEvents(stateDir(project), { report: () => {} });
  const ownSigned = (e) => e.computer === me && e.sig?.computer === me && verify(e, enrolled);
  const used = new Set(events.filter((e) => e.kind === 'note' && e.data?.lean === 'undo' && typeof e.data?.click === 'string' && ownSigned(e)).map((e) => e.data.click));
  return events.filter((e) => e.kind === 'action' && e.data?.action === action && e.data?.proof === 'window'
    && !used.has(e.id) && matches(e.data) && ownSigned(e)).at(-1) ?? null;
}
