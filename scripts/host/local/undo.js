// scripts/host/local/undo.js
// The card asking to undo a merge, and the signed click in the chat that decides it (ruling P5-50). Undo is a runbook step: it
// adds a commit that reverses the merge, confirmed by the director's click on its card, and it works while STOP is on.
import { computerId, stateDir } from '../../lib/paths.js';
import { listEvents } from '../../state/events.js';
import { readEnrolled, verify } from '../../state/signing.js';

// The line the card carries, naming the merge in full: an undo is signed only for a card that holds exactly one.
// A signed click carries no proof when a hook that signs made it, and `hook-click` when the helper signed what a hook saw.
export const CLICK_PROOFS = Object.freeze([undefined, 'hook-click']);
export const undoLine = (merge) => `Undo the merge ${merge} on the main version`;
export const UNDO_LINE = /Undo the merge ([0-9a-f]{40}) on the main version/g;

export const UNDO_NEEDS_CLICK = 'Undo waits for the director\'s click on its card in the chat: ask the card, then run undo again';

// `earlier` gives the card in its words before the ship's-crew names (27 October 2026), which a card raised before an
// update still holds (undoCards).
const UNDO_WORKS = 'Undo adds a new commit that reverses it: nothing is deleted, and later work stays. It waits for your click here, and it works while All stop is on.';
const UNDO_WORKS_EARLIER = 'Undo adds a new commit that reverses it: nothing is deleted, and later work stays. It waits for your click here, and it works while STOP is on.';
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

// The latest signed click of `action` whose data `matches`, made on this computer by an enrolled key: the hook's own signed
// record (Claude Code), or the helper's, signed on a click a hook that only reads saw (proof `hook-click`). Or null.
// Each click is used once: one an undo's own signed record names (`click`) counts no more, so a later undo needs a
// new click. Only signed undo records count as using one, so a plain note can't use up the director's click.
export function chatClick(project, action, matches) {
  const me = computerId();
  const enrolled = readEnrolled();
  const events = listEvents(stateDir(project), { report: () => {} });
  const ownSigned = (e) => e.computer === me && e.sig?.computer === me && verify(e, enrolled);
  const used = new Set(events.filter((e) => e.kind === 'note' && e.data?.lean === 'undo' && typeof e.data?.click === 'string' && ownSigned(e)).map((e) => e.data.click));
  return events.filter((e) => e.kind === 'action' && e.data?.action === action && CLICK_PROOFS.includes(e.data?.proof)
    && !used.has(e.id) && matches(e.data) && ownSigned(e)).at(-1) ?? null;
}
