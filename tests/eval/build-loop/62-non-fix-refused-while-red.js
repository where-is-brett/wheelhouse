// tests/eval/build-loop/62-non-fix-refused-while-red.js
// Scenario 62 (Archon design, sections 7.7, 12.4 and 18): a red-main incident is open, and two pull requests are
// ready: an ordinary one, and the fix a fix-main run opened. Pass: the ordinary one is refused by the helper's gate and
// by the broker's permit, naming the incident; the fix is the incident's fix only from the helper's own record of the
// run at its head, so a head pushed since, or a caller's say-so, is no fix. Played on the gate's and the broker's
// rules, in its `with` variant alone. On real Archon (`real`), the red main line held: with the incident open in the
// project's record, the broker's own launcher, run as Archon's steps run gh, asks to merge an ordinary pull request and
// the real helper refuses it, naming the incident. The fix's own leg needs a real fix-main run, so it is the recording's.
import fs from 'node:fs';
import path from 'node:path';
import { incidentFor, fixOfRun } from '../../../scripts/host/helper.js';
import { incidentReason } from '../../../scripts/gate/conditions.js';
import { classifyCall, brokerDecision } from '../../../scripts/engine/broker/rules.js';

const RED = { id: 'red-main-6262626262', what: 'red', at: '2026-10-30T09:00:00.000Z', fixes: [], kind: 'red-main', suspect: 41, work: 'fix-main-red-main-6262626262' };
const FIX = '6262626a2b3c4d5e6f708192a3b4c5d6e7f80912';
const OTHER = '7272727a2b3c4d5e6f708192a3b4c5d6e7f80912';

export default {
  id: 62,
  title: 'While the main line is red only its fix may be added',
  safety: true,
  engine: {
    async play() {
      const views = { incidents: { open: [RED] } };
      const opened = { runId: 'run-62', head: FIX, showFirst: false, work: RED.work, level: 1, lane: 'fix-main', incident: RED.id };
      const call = { runId: 'run-62', pr: 62, head: FIX, incident: RED.id };

      const ordinary = incidentReason(incidentFor(views, 63));
      if (!ordinary || !ordinary.includes(RED.id)) return { pass: false, why: `the gate didn't refuse an ordinary pull request naming the incident: ${ordinary}` };
      const permit = brokerDecision(classifyCall(['pr', 'merge', '63', '--squash', '--match-head-commit', OTHER]), { stop: false, lockHeld: true, defaultBranch: 'main', incident: incidentFor(views, 63) });
      if (permit.allow !== false || !permit.reason.includes(RED.id)) return { pass: false, why: 'the broker let an ordinary merge through while the main line was red' };

      const fix = fixOfRun({ views, opened, call, headSha: FIX });
      if (incidentReason(incidentFor(views, 62, { fix })) !== null) return { pass: false, why: 'the run\'s own fix wasn\'t taken as the incident\'s fix' };
      const moved = fixOfRun({ views, opened, call, headSha: OTHER });
      if (incidentReason(incidentFor(views, 62, { fix: moved })) === null) return { pass: false, why: 'a head pushed since the run opened it was taken as the fix' };
      if (incidentReason(incidentFor(views, 62)) === null) return { pass: false, why: 'the fix\'s number alone, with no record of the run, let it through' };
      return { pass: true, why: 'the ordinary pull request refused by the gate and the broker; the fix only from the helper\'s own record at its head' };
    },
    async real(world) {
      const cwd = path.join(world.folder, '.wheelhouse', 'worktrees', 'wh-card-63');
      fs.mkdirSync(cwd, { recursive: true });
      const { id, what, kind, suspect, work } = RED;
      world.put('incident', { id, what, kind, suspect, work });
      world.put('review', { pr: 63, commit: OTHER, verdict: 'CLEAN', findings: 0 });
      world.put('approval', { pr: 63, commit: OTHER });
      const refused = await world.broker(['pr', 'merge', '63', '--squash', '--match-head-commit', OTHER], { cwd });
      if (refused.code === 0 || world.forwarded.some((call) => call.startsWith('pr merge'))) return { pass: false, why: 'the real broker let an ordinary merge through while the main line was red' };
      if (!refused.stderr.includes(RED.id)) return { pass: false, why: `the refusal doesn't name the incident: ${refused.stderr.trim()}` };
      return { pass: true, why: 'with a red-main incident open, the real broker, run as Archon runs gh, refused an ordinary merge naming it (the fix\'s own leg is the recording\'s)' };
    },
  },
  variants: { with: {} },
};
