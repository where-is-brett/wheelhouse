// scripts/lib/helper-grace.js
// Extra time for the waits on the host helper that the hooks and the mod's bridge keep, from
// WHEELHOUSE_HELPER_GRACE_MS. Only Wheelhouse's own tests set it: they run the real helper, whose
// pushes to a remote on the same computer can take longer than a hook's whole budget when the
// computer is heavily loaded, and a record not sent in time is kept rather than lost, which is
// not what those tests check. Unset, or anything but a whole number of milliseconds above 0, it
// is 0, so in use every wait is the design's own number. It is read at each wait, not once.
const MOST_MS = 10 * 60 * 1000;

export function helperGrace(env = process.env) {
  const ms = Number(env.WHEELHOUSE_HELPER_GRACE_MS);
  return Number.isSafeInteger(ms) && ms > 0 ? Math.min(ms, MOST_MS) : 0;
}
