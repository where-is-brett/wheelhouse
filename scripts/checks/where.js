// scripts/checks/where.js
// Where a project's checks run (spec 4.1), worked out and shown, never asked, and when the host's own checks have stopped
// reporting. Wheelhouse's own status isn't CI: once it is posted, a project with no CI must still read as having none.
export const STATUS_CONTEXT = 'wheelhouse/checks';
const STUCK_MS = 30 * 60 * 1000;

const others = (contexts) => (Array.isArray(contexts) ? contexts : []).filter((c) => c?.name !== STATUS_CONTEXT);

// 'here' or 'host'. `setting` is `checks.where` from the default branch, and wins; `contexts` what reports on the default
// branch's head, never a change's head, since a change could add a workflow of its own.
export function whereChecks({ setting = null, host, contexts = [], hasWorkflows = false }) {
  if (setting === 'here' || setting === 'host') return setting;
  if (host === 'local') return 'here';
  return others(contexts).length > 0 || hasWorkflows ? 'host' : 'here';
}

// Whether a context never got a job going: failed with none having run, or waiting since the head was first seen for 30
// minutes. A check from another app that never reports waits the same way.
export function neverRan(context, waitedMs = 0) {
  if (typeof context?.startedAt === 'string') return false;
  if (context?.state === 'failure') return true;
  return ['queued', 'pending'].includes(context?.state) && waitedMs >= STUCK_MS;
}

const headStuck = ({ contexts, firstSeen, readAt }) => {
  const waited = Date.parse(readAt) - Date.parse(firstSeen);
  return others(contexts).some((c) => neverRan(c, Number.isNaN(waited) ? 0 : waited));
};

// Whether the host's checks aren't running: the last two heads read, in order, were both stuck. `readings` are
// `{ head, contexts, firstSeen, readAt }`.
export function stuckHostChecks(readings) {
  const last = (Array.isArray(readings) ? readings : []).slice(-2);
  return last.length === 2 && last[0].head !== last[1].head && last.every(headStuck);
}
