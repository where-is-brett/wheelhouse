// scripts/host/data-route.js
// Which data a piece's before-and-after runs on (design section 7 of the director's way of working), decided by the helper and
// never by a prompt. The project's configuration names one read-only command and a route:
//   `test` (the default): the command runs at the base commit and at the head, in the checks' own sandbox, on test data.
//   `real`: it runs on a read-only sample of real data, and only once the director has approved that route, once, for that
//           very command (a signed `data-route-approved` record), and only with a read-only credential the helper holds.
// A real route that can't be used for either reason is refused in plain words, and the comparison falls back to test data,
// which the note says. Agents never write to real data: nothing here runs anything but the one approved read-only command.

export const REFUSED = Object.freeze({
  unapproved: 'the director has not approved a read-only route to the real data for this command',
  noAccess: 'no read-only access to the real data is set up on this computer',
});

// Whether the director approved `command` on the real route: a verified `data-route-approved` record that names exactly it.
// `approvals` are the project's verified records of that kind (signed by this computer; the helper's own check of that).
export const routeApproved = ({ approvals, command }) => (
  typeof command === 'string' && (approvals ?? []).some((e) => e?.kind === 'data-route-approved' && e.data?.command === command)
);

// The comparison for a change: `{ ran: false, why }` when there is nothing to run or it could not run, else
// `{ ran: true, route, before, after, realRefused? }` with `before` and `after` the project command's snapshots at `base` and `head`.
// - `config`: the default branch's configuration (its `dataCheck`);
// - `approvals`: the verified records of the director's approval;
// - `runTest(commit, command)` and `runReal(commit, command)`: run the command at a commit and give its snapshot, or throw;
//   `runReal` is absent where no read-only access exists.
export async function dataComparison({ config, approvals = [], runTest, runReal = null, base, head }) {
  const check = config?.dataCheck;
  if (check === undefined || typeof check.command !== 'string') return { ran: false, why: 'this project names no data command' };
  const wantsReal = check.route === 'real';
  let realRefused;
  let run = runTest;
  let route = 'test';
  if (wantsReal) {
    if (!routeApproved({ approvals, command: check.command })) realRefused = REFUSED.unapproved;
    else if (typeof runReal !== 'function') realRefused = REFUSED.noAccess;
    else {
      run = runReal;
      route = 'real';
    }
  }
  try {
    const before = await run(base, check.command);
    const after = await run(head, check.command);
    return { ran: true, route, before, after, ...(realRefused === undefined ? {} : { realRefused }) };
  } catch (error) {
    return { ran: false, why: `the data command could not be run: ${String(error?.message ?? error).slice(0, 200)}`, ...(realRefused === undefined ? {} : { realRefused }) };
  }
}
