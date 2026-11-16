// scripts/lib/free-seat.js
// Taking the First Mate's seat when it is free, for a front-desk session that doesn't hold it: shared by the prompt hook and
// the write guard, so a session that began before the project existed (the one that ran setup) holds the seat within its own
// turn, before its first card. A seat another live session holds is never taken; moving it is the take-over card's click.
import { readProject } from './projects.js';
import { computerId } from './paths.js';
import { sessionRole } from './role.js';
import { STALE_AFTER_MS, readSeat, takeSeat, refreshSeat, seatFree, seatInUse } from './first-mate-seat.js';
import { startedByScript } from '../decisions/answer.js';

// Whether this computer holds the lock or could take it, judged by reading it and taking nothing (for a hook that doesn't
// keep the lock): free when no helper can be asked, the project is in git alone, nothing holds it, this computer holds it, or
// its holder has been idle STALE_AFTER_MS; not free while another computer's lock is live. keepLock's own rule, by a read.
// With `failClosed`, a read that fails or is refused (a timeout, a refusal, a throw) is not free, for the guard that runs before
// every tool, where taking a seat on a doubt would be taking it from a lock that is held.
export async function lockFreeNow({ client, project, left = (p) => p, now = () => new Date(), failClosed = false }) {
  try {
    if (readProject(project)?.host === 'local' || typeof client?.lock?.read !== 'function') return true;
    const got = await left(client.lock.read({ project }));
    if (got?.ok !== true) return !failClosed;
    const lock = got.result;
    if (!lock || lock.computer === computerId()) return true;
    const idle = now().getTime() - Date.parse(lock.lastWriteAt);
    return Number.isFinite(idle) && idle > STALE_AFTER_MS;
  } catch {
    return !failClosed;
  }
}

// A front-desk session that doesn't hold the First Mate's seat takes it here when it is free (a session that began before
// the seat existed, or whose holder has since ended). It informs, so a failure leaves the seat as it was.
export async function takeFreeSeat({ project, input, env, now, client, left, failClosed = false }) {
  try {
    const session = input.session_id;
    if (typeof session !== 'string' || session === '' || startedByScript(env)) return;
    if (sessionRole({ sessionId: session, env, prompt: input.prompt, cwd: input.cwd, seat: null }) !== 'front-desk') return;
    if (!(await lockFreeNow({ client, project, left, now, failClosed }))) return; // another computer's lock: no seat (design 6.8, case 8)
    if (readSeat(project)?.session === session) refreshSeat(project, session, { now });
    else await takeSeat(project, { session, folder: input.cwd }, { now });
  } catch { /* the seat is taken at a later hook */ }
}

// The same, for a hook that runs before every tool: it asks nothing of the helper unless the seat is absent or free, so a
// session that holds it, or an aside beside a holder seen lately, pays one file read.
export async function takeSeatIfFree({ project, input, env, now, client, left, free = seatFree }) {
  try {
    const session = input.session_id;
    if (typeof session !== 'string' || session === '') return;
    const seat = readSeat(project);
    if (seat?.session === session) return;
    // A holder seen in the last half hour is live: no process is looked up for it on every tool call.
    if (seat !== null && seat !== undefined && (seatInUse(seat, { now }) || !(await free(seat)))) return;
    await takeFreeSeat({ project, input, env, now, client, left, failClosed: true });
  } catch { /* the seat is taken at a later hook */ }
}
