// probes/mac-sitting/courier-log.mjs
// Reads courier.json and says what changed between two readings: a wake's mark (an id put in
// `sent`, with its stamp and the session it woke), a mark taken out again (the mod's `unsent`,
// fix D), and lastWakeAt moving. courier.json keeps no record of an undo, so the only way to
// time one is to read the file often and see the mark go: `seconds` is the time from the mark's
// own stamp to the reading that found it gone, to within the polling step. Read only; needs no
// preparation. Used by check.mjs (courier-watch, unsent) and lock-watch.mjs.
import fs from 'node:fs';

// courier.json as it stands, or null when it isn't there or can't be read.
export function readCourier(file) {
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      sent: Array.isArray(kept?.sent) ? kept.sent.filter((s) => typeof s?.id === 'string') : [],
      lastWakeAt: typeof kept?.lastWakeAt === 'string' ? kept.lastWakeAt : null,
      sessions: Array.isArray(kept?.sessions) ? kept.sessions : [],
    };
  } catch {
    return null;
  }
}

// The changes from one reading to the next, each a plain object with `event`:
//   marked     { id, at, by, before }      a mark that wasn't there, or the same id with a new stamp
//   undone     { id, at, by, seenAt, seconds }  a wake's mark that has gone (an opening's marks,
//                                          which carry no `by`, are cut only by SENT_KEPT: `byWake`
//                                          says which)
//   lastWakeAt { from, to }
// A mark replaced by a new stamp between two readings shows as undone and then marked.
export function changes(before, after, seenAt = new Date().toISOString()) {
  const out = [];
  const was = new Map((before?.sent ?? []).map((s) => [s.id, s]));
  const now = new Map((after?.sent ?? []).map((s) => [s.id, s]));
  for (const [id, old] of was) {
    const fresh = now.get(id);
    if (fresh !== undefined && fresh.at === old.at) continue;
    out.push({
      event: 'undone', id, at: old.at ?? null, by: old.by ?? null, byWake: typeof old.by === 'string', seenAt,
      seconds: typeof old.at === 'string' ? Math.round((Date.parse(seenAt) - Date.parse(old.at)) / 100) / 10 : null,
    });
  }
  for (const [id, mark] of now) {
    const old = was.get(id);
    if (old !== undefined && old.at === mark.at) continue;
    out.push({ event: 'marked', id, at: mark.at ?? null, by: mark.by ?? null, before: mark.before ?? null });
  }
  const from = before?.lastWakeAt ?? null;
  const to = after?.lastWakeAt ?? null;
  if (before !== null && from !== to) out.push({ event: 'lastWakeAt', from, to });
  return out;
}

// Reads `file` every `everyMs` until `until()` is true, appending each change to `logFile` as a
// JSON line ({ seen, ...change }) and handing it to `onChange`. The first reading is logged as
// `start`, with the marks already there.
export async function watchCourier({ file, logFile, everyMs = 500, until = () => false, onChange = () => {} }) {
  const write = (record) => fs.appendFileSync(logFile, `${JSON.stringify(record)}\n`);
  let last = readCourier(file);
  write({ seen: new Date().toISOString(), event: 'start', sent: last?.sent ?? null, lastWakeAt: last?.lastWakeAt ?? null });
  while (!until()) {
    await new Promise((r) => setTimeout(r, everyMs));
    const next = readCourier(file);
    if (next === null) continue;
    const seen = new Date().toISOString();
    for (const change of changes(last, next, seen)) {
      const record = { seen, ...change };
      write(record);
      onChange(record);
    }
    last = next;
  }
  return last;
}

// The undone marks in one or more such logs, oldest first.
export function undoneIn(logFiles) {
  const found = [];
  for (const logFile of logFiles) {
    if (!fs.existsSync(logFile)) continue;
    for (const line of fs.readFileSync(logFile, 'utf8').split('\n')) {
      try {
        const record = JSON.parse(line);
        if (record?.event === 'undone') found.push(record);
      } catch {
        // a line that isn't JSON (lock-watch's own text lines) is skipped
      }
    }
  }
  return found.sort((a, b) => String(a.seenAt).localeCompare(String(b.seenAt)));
}
