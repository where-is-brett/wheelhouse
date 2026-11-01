// tests/eval/build-loop/goal-world.js
// A signed goal in a scenario's world: its piece's work record, its sheet and the director's Start. Not a scenario file: it
// has no number.
import { dataHash } from '../../../scripts/state/events.js';
import { sheetHash } from '../../../scripts/engine/goal.js';
import { startGoalLine } from '../../../scripts/state/card-lines.js';

// The work record `world.lane` writes, so the sheet's hash is that record's.
const pieceOf = (work, title) => ({ id: work, title, lane: 'quick', visible: false, dependsOn: [] });

// Records the piece and signs a goal over it, in force from now: { id, hash, sheet }.
export function signGoal(world, { id, work, title, now, areas, checkFiles = [] }) {
  const data = pieceOf(work, title);
  world.put('work', data);
  const sheet = {
    title: 'The sale banner goes up', done: [{ command: 'npm test', expect: 0 }], checksSay: ['the tests pass'], checkFiles,
    pieces: [{ work, hash: dataHash(data) }], areas, spend: { tokens: 1000000 }, until: new Date(now().getTime() + 8 * 3600000).toISOString(),
  };
  world.put('goal', { id, sheet });
  const hash = sheetHash(sheet);
  world.put('action', { action: 'start-goal', goal: id, hash, question: `Goal.\n${startGoalLine(id, hash)}`, label: 'Start' });
  return { id, hash, sheet };
}
