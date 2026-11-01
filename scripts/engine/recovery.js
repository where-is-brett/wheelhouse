// scripts/engine/recovery.js
// The rules of recovery (unattended goals design, section 9): pure, used by the helper and the runner, and the same
// with or without a goal, with `resumeRun`, the one way a failed run resumes, beside them. Nothing here reads a goal.

// The helper's tick fires each minute, so a gap longer than this means the computer slept.
export const SLEEP_GAP_MINUTES = 3;

// The span the computer slept between two beats of the helper's tick (milliseconds since the epoch), as times, or null
// when it didn't. A helper that was dead has no beat to measure from, so it leaves no span, which is right: its runs
// went on. A clock put back is no sleep.
export function sleepGap(lastMs, nowMs) {
  if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs)) return null;
  if (nowMs - lastMs <= SLEEP_GAP_MINUTES * 60 * 1000) return null;
  return { from: new Date(lastMs).toISOString(), to: new Date(nowMs).toISOString() };
}

// sleepWatch({ now, write }) -> { beat() }: the helper's tick and the runner each beat. A beat after a gap gives
// `write(gap)` the span. beat() answers once any span due is on the record: true, or false when the write failed,
// and a false must hold back whatever reads a run's minutes. The next beat then writes the whole span again from its
// start, so nothing of it is lost; a span written twice counts once.
export function sleepWatch({ now, write }) {
  let last = null;
  let settled = Promise.resolve(true);
  return {
    beat() {
      const at = now().getTime();
      const gap = sleepGap(last, at);
      const before = last;
      last = at;
      if (gap === null) return settled;
      settled = settled.then(() => write(gap)).then(() => true, () => {
        last = Math.min(last, before);
        return false;
      });
      return settled;
    },
  };
}

// What a failed run's failure was, in the record's words (check 93). `resume-refused` is written only by `resumeRun`.
export const FAILURE_KINDS = Object.freeze(['connection', 'provider', 'host', 'limit', 'other']);
export const RESUME_REFUSED = 'resume-refused';
const BY_CLASS = Object.freeze({ transient: 'connection', timeout: 'connection', overloaded: 'provider', rate_limited: 'provider' });
const HOST_STOPS = Object.freeze(['process_terminated', 'not_finalized', 'unhandled_error']);

// The kind of a failure from the engine's typed classes, never its words: { errorClass, providerClass, stopReason }. A
// `fatal` needs the failed step's provider class, which the stream's line hasn't got, since a used-up limit and a sign-in
// failure read alike there; a failure with no cause needs why the run stopped. Anything else is `other`, the safe path.
export function failureKind(event) {
  const { errorClass = null, providerClass = null, stopReason = null } = event ?? {};
  if (errorClass === 'fatal') return providerClass === 'quota_exhausted' ? 'limit' : 'other';
  if (errorClass === null) return HOST_STOPS.includes(stopReason) ? 'host' : 'other';
  return Object.hasOwn(BY_CLASS, errorClass) ? BY_CLASS[errorClass] : 'other';
}

const stateOf = (record) => record?.data?.state;
const resumeOf = (record) => (Number.isInteger(record?.data?.resume) ? record.data.resume : null);

// How many times a run has resumed: the highest `resume` on its `run` records.
export const resumesOf = (records) => (records ?? []).reduce((most, r) => Math.max(most, resumeOf(r) ?? 0), 0);

// Whether a run is live, by its `run` records in time order: an `ended` stands until a `started` with `resume` follows
// it. A plain `started` after an `ended` is an answer arriving late, and brings nothing back.
export function runLive(records) {
  let ended = false;
  for (const record of records ?? []) {
    if (stateOf(record) === 'ended') ended = true;
    else if (stateOf(record) === 'started' && resumeOf(record) !== null) ended = false;
  }
  return (records ?? []).length > 0 && !ended;
}

// Whether a run whose latest record is a resume's `started` was only just resumed: a resume is detached, so the engine
// can read as over for a moment after it took one.
export const RESUME_SETTLE_MINUTES = 2;

// A failed run's next try. Nothing retries yet.
export function retryPlan() {
  return { retry: false };
}

// Whether a run that ended isn't yet settled, so that its spend and its reviews wait: it failed, and a try is still
// allowed it or a cap card on it (`capped`) waits. Nothing else keeps a run from settling.
export function unsettled({ records, capped }) {
  const latest = records?.at(-1)?.data;
  if (latest?.state !== 'ended' || latest.outcome !== 'failed') return false;
  return capped === true || retryPlan({ failure: latest.failure, tries: resumesOf(records) }).retry === true;
}

// The one way a failed run resumes. `records` are the run's `run` records. It writes `{ state: 'started', resume: n }`, then
// acts, so the record is never behind the engine; a crash between the two is put right by the runner's look at the run.
// A refusal writes the ending itself, since a refused resume brings no `terminal` line. An engine that gave no reply may
// have taken it, so that writes nothing, and the same look decides: `unreachable` means don't start anything else yet.
// Called again after a crash it takes up the same number, and leaves alone a run that is already going, or that it
// resumed too lately to tell: one failure, one resume.
export async function resumeRun({ engine, runId, write, records, now = () => new Date() }) {
  const latest = records?.at(-1);
  if (!latest) return { ok: false, refused: 'the record has no such run' };
  const { work, lane, engine: name, branch } = latest.data;
  const place = { work, lane, engine: name, runId, ...(typeof branch === 'string' ? { branch } : {}) };
  const carriedOver = stateOf(latest) === 'started' && resumeOf(latest) !== null;
  const resume = carriedOver ? resumeOf(latest) : resumesOf(records) + 1;
  if (carriedOver) {
    const status = await Promise.resolve().then(() => engine.inspect(runId)).then((seen) => seen?.status, () => null);
    if (status === 'running' || status === 'paused') return { ok: true };
    if (now().getTime() - Date.parse(latest.at) < RESUME_SETTLE_MINUTES * 60 * 1000) return { ok: false, unreachable: true, refused: 'it may have resumed already' };
  } else await write('run', { ...place, state: 'started', resume });
  let got;
  try {
    got = (await engine.act(runId, { resume: {} })) ?? { ok: false, unreachable: true };
  } catch (error) {
    got = { ok: false, unreachable: true, refused: error instanceof Error ? error.message : 'unknown' };
  }
  if (got.ok === true) return { ok: true };
  if (got.unreachable === true) return { ok: false, unreachable: true, refused: got.refused ?? 'the engine gave no reply' };
  // The latest record is the one read for a pull request, so this one keeps the run's.
  const pr = records.findLast((r) => Number.isInteger(r.data?.pr))?.data.pr;
  await write('run', { ...place, state: 'ended', resume, outcome: 'failed', failure: RESUME_REFUSED, ...(pr === undefined ? {} : { pr }) });
  return { ok: false, refused: got.refused };
}
