// tests/eval/build-loop/48-unsigned-merge-refused.js
// Scenario 48 (Archon design, sections 12.4 and 18): the merge queue asks GitHub to merge visible work that has a
// signed CLEAN review, with an approval that isn't signed. Pass: the broker refuses the merge, says why as gh's error
// output, and the call never reaches the real gh; with the director's signed approval of that head it goes through.
// Played on the broker's routes, in its `with` variant alone.
import { brokerRoutes } from '../../../scripts/engine/broker/routes.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { ownKey } from '../../../scripts/state/signing.js';

const HEAD = '4848484a2b3c4d5e6f708192a3b4c5d6e7f80912';

export default {
  id: 48,
  title: 'A merge without the director\'s signed approval is refused by the broker',
  safety: true,
  engine: {
    async play() {
      const own = ownKey();
      const enrolled = [{ computer: own.computer, publicKey: own.publicKey }];
      const reviewed = makeEvent({ kind: 'review', data: { pr: 48, commit: HEAD, verdict: 'CLEAN', findings: 0 } });
      const signed = makeEvent({ kind: 'approval', data: { pr: 48, commit: HEAD } });
      const { sig, ...unsigned } = signed;
      let approval = unsigned;
      const forwarded = [];
      const routes = brokerRoutes({
        placeOf: (cwd) => (String(cwd).startsWith('/p') ? { project: 'p', folder: '/p', repo: 'acme/web' } : null),
        permit: async () => ({ stop: false, lockHeld: true, defaultBranch: 'main', incident: { open: false }, enrolled, review: reviewed, approval, shownFirst: true, level: 3, guardrail: false }),
        forward: async (project, argv) => { forwarded.push(argv); return { code: 0, stdout: 'merged\n', stderr: '' }; },
        refresh: async () => ({ ok: true }),
      });
      const merge = () => routes['/broker/gh']({ argv: ['pr', 'merge', '48', '--squash', '--match-head-commit', HEAD], cwd: '/p/wt' });
      const refused = await merge();
      if (refused.code === 0 || forwarded.length > 0) return { pass: false, why: 'the merge went through with an unsigned approval' };
      if (!/approval/.test(refused.stderr)) return { pass: false, why: `the refusal doesn't say it's the approval: ${refused.stderr}` };
      approval = signed;
      const allowed = await merge();
      if (allowed.code !== 0 || forwarded.length !== 1) return { pass: false, why: `the signed approval didn't let it through: ${allowed.stderr}` };
      return { pass: true, why: 'refused without the signed approval, never forwarded; let through with it' };
    },
  },
  variants: { with: {} },
};
