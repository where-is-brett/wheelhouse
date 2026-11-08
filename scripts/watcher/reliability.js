// scripts/watcher/reliability.js
// The engine's reliability bar (director's way of working, design section 10). The engine records each piece that is lost,
// stalls or needs a crash resume, in one file for the whole computer, `reliability.jsonl` in the Wheelhouse home, so the count
// runs across the director's projects. More than BAR of them in a rolling 30 days raises one notice to the director, at most
// once in 30 days: "Engine trouble: look at Archon early?". The notice is a card in the shape of section 6.2. Nothing here
// answers it: only the director does.
//
//   Incident = { kind: 'lost' | 'stalled' | 'resumed', project, work, at, key }
//     lost     an approved piece whose start was never made, and was raised again (scripts/watcher/recover.js)
//     stalled  a piece the watcher called stuck that was not held on purpose (scripts/watcher/routine.js)
//     resumed  a feature session that died and was started again by its session id (scripts/watcher/resume.js)
//   `key` names the occurrence, so an incident seen twice (a loop run again after a stop) is recorded once.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from '../lib/paths.js';
import { SLUG } from '../lib/build-loop.js';

export const KINDS = Object.freeze(['lost', 'stalled', 'resumed']);
// More than this many incidents inside the window is over the bar.
export const BAR = 3;
export const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
// The file is read whole; only this much of it is kept in mind.
const MOST_BYTES = 4 * 1024 * 1024;

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isText = (x) => typeof x === 'string' && x.trim() !== '';

export const reliabilityFile = () => path.join(wheelhouseHome(), 'reliability.jsonl');
export const noticeFile = () => path.join(wheelhouseHome(), 'reliability-notice.json');
// Held (a folder, made in one step) while a watcher sends the notice, so two watchers never both send it.
export const claimFolder = () => path.join(wheelhouseHome(), 'reliability-notice.claim');
// Held while the incident file is pruned, so one watcher's rewrite never loses another's line.
export const recordClaimFolder = () => path.join(wheelhouseHome(), 'reliability-record.claim');
// A claim older than this was left by a watcher that stopped, and is taken over.
const CLAIM_STALE_MS = 5 * 60 * 1000;

function readText(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MOST_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// Every incident on record, oldest first. A damaged line is left out.
export function readIncidents() {
  const out = [];
  for (const text of (readText(reliabilityFile()) ?? '').split('\n')) {
    if (text.trim() === '') continue;
    try {
      const l = JSON.parse(text);
      if (isPlain(l) && KINDS.includes(l.kind) && isText(l.project) && isText(l.work) && Number.isFinite(Date.parse(l.at))) out.push(l);
    } catch { /* a damaged line */ }
  }
  return out;
}

// A claim is a folder made in one step, with its owner's token inside. Returns a function that lets it go (only if it is still
// this owner's), or null when another watcher holds it. A claim older than CLAIM_STALE_MS was left by a watcher that stopped: it is
// taken over by renaming it aside first, which only one watcher can do.
export function takeClaim(folder) {
  const token = crypto.randomUUID();
  fs.mkdirSync(path.dirname(folder), { recursive: true });
  for (let tries = 0; tries < 2; tries += 1) {
    try {
      fs.mkdirSync(folder);
      fs.writeFileSync(path.join(folder, 'owner'), `${token}\n`);
      return () => {
        try {
          if (fs.readFileSync(path.join(folder, 'owner'), 'utf8').trim() === token) fs.rmSync(folder, { recursive: true, force: true });
        } catch { /* gone already, or no longer ours */ }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') return null;
      const aside = `${folder}.stale-${token}`;
      try {
        if (Date.now() - fs.statSync(folder).mtimeMs < CLAIM_STALE_MS) return null;
        fs.renameSync(folder, aside);
      } catch {
        return null; // another watcher took it over first
      }
      // What was moved may be a fresh claim made after the stale one was seen: put it back, and leave it be.
      try {
        if (Date.now() - fs.statSync(aside).mtimeMs < CLAIM_STALE_MS) {
          fs.renameSync(aside, folder);
          return null;
        }
      } catch { /* looked at below */ }
      fs.rmSync(aside, { recursive: true, force: true });
    }
  }
  return null;
}

// Appends one incident, unless the same occurrence is there already. `key` is optional; without it the kind, project, work and
// time name the occurrence. Anything that isn't one of the three kinds, or names no piece, is not recorded. Returns whether a
// line was added. Incidents more than a window older than the incoming one don't count and are dropped as it is added, under a
// claim, so the file stays small and no other watcher's line is lost to the rewrite. Without the claim, or where the rewrite is
// refused (a file held open on Windows), the line is appended and the pruning left for another time.
export function recordIncident({ kind, project, work, at, key } = {}) {
  if (!KINDS.includes(kind) || !isText(project) || !SLUG.test(String(work ?? '')) || !Number.isFinite(Date.parse(at))) return false;
  const named = isText(key) ? key : `${kind}:${project}:${work}:${at}`;
  const seen = (all) => all.some((l) => (l.key ?? `${l.kind}:${l.project}:${l.work}:${l.at}`) === named);
  if (seen(readIncidents())) return false;
  const added = { kind, project, work, at, key: named };
  fs.mkdirSync(wheelhouseHome(), { recursive: true });
  const append = () => fs.appendFileSync(reliabilityFile(), `${JSON.stringify(added)}\n`);
  const release = takeClaim(recordClaimFolder());
  if (release === null) {
    append();
    return true;
  }
  try {
    const all = readIncidents();
    if (seen(all)) return false;
    const incoming = Date.parse(at);
    const keep = all.filter((l) => incoming - Date.parse(l.at) < WINDOW_MS);
    if (keep.length === all.length) {
      append();
      return true;
    }
    const temp = `${reliabilityFile()}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp, [...keep, added].map((l) => `${JSON.stringify(l)}\n`).join(''));
      fs.renameSync(temp, reliabilityFile());
    } catch {
      fs.rmSync(temp, { force: true });
      append();
    }
    return true;
  } finally {
    release();
  }
}

// Whether more than BAR incidents fall in the 30 days up to `now`. An incident dated after `now` (a clock set back) is not counted.
export function overBar(lines, now = new Date()) {
  const t = now instanceof Date ? now.getTime() : Number(now);
  const inside = (Array.isArray(lines) ? lines : []).filter((l) => {
    const at = Date.parse(l?.at);
    return Number.isFinite(at) && at <= t && t - at < WINDOW_MS;
  });
  return inside.length > BAR;
}

// The card for the notice, a decision in the shape of section 6.2. It names no project and carries no link: only a count.
export function engineTroubleCard(count) {
  const ask = 'Engine trouble: look at Archon early?';
  const what = `${ask} In the last 30 days, ${count} pieces of work were lost, stalled or needed a crash resume. Wheelhouse's own engine is meant to manage three at most in a month.`;
  const holds = 'nothing; work carries on';
  const why = 'More than three engine problems in a month is the point set in advance for looking at Archon again, earlier than planned.';
  const meanwhile = 'Work carries on as it is. Pieces that stop are still started again by themselves.';
  const LOOK = 'Look at Archon now';
  const KEEP = 'Keep the own engine';
  const says = {
    [LOOK]: 'Wheelhouse puts the Archon comparison to you as its own decision, with what it found.',
    [KEEP]: 'Nothing changes. You are told again in 30 days if it is still over.',
  };
  const cost = {
    [LOOK]: 'A comparison of a day or two of one session, and your time to read it.',
    [KEEP]: 'No cost now. The trouble may go on costing time.',
  };
  const undo = {
    [LOOK]: 'Yes. A comparison changes nothing by itself.',
    [KEEP]: 'Yes. You can ask for the look at any time.',
  };
  const options = [LOOK, KEEP];
  const because = 'the count has passed the bar you agreed, and a comparison costs little and changes nothing';
  return {
    question: [ask, what, why, meanwhile].join('\n'),
    header: 'Engine trouble',
    kind: 'question',
    level: 2,
    options,
    descriptions: options.map((o) => (o === LOOK ? `Recommended: ${says[o]}` : says[o])),
    recommend: LOOK,
    line: null,
    code: null,
    parts: {
      kind: 'question',
      header: 'Engine trouble',
      ask,
      what,
      holds,
      small: why,
      recommendation: `${LOOK}, because ${because}.`,
      because,
      options: options.map((o) => ({ label: o, says: says[o], cost: cost[o], undo: undo[o], recommended: o === LOOK })),
      why,
      meanwhile,
      line: null,
      code: null,
    },
  };
}

function readNotice() {
  try {
    const n = JSON.parse(readText(noticeFile()) ?? 'null');
    return isPlain(n) && Number.isFinite(Date.parse(n.at)) ? Date.parse(n.at) : null;
  } catch {
    return null;
  }
}

// Writes the notice's time (write-and-rename, or in place where the rename is refused), or takes it away: `at` null.
function keepNotice(at, log) {
  try {
    if (at === null) {
      fs.rmSync(noticeFile(), { force: true });
      return;
    }
    const temp = `${noticeFile()}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ at })}\n`);
    try {
      fs.renameSync(temp, noticeFile());
    } catch {
      fs.rmSync(temp, { force: true });
      fs.writeFileSync(noticeFile(), `${JSON.stringify({ at })}\n`);
    }
  } catch (error) {
    log(`The engine-trouble notice's time couldn't be kept: ${error.message}`);
  }
}

// Raises the notice through the helper when the bar is crossed and none was raised in the last 30 days. Its time is put on record
// before the card is sent, so a stop between the two never sends it twice, and taken off again if the helper refuses, so a refusal
// is tried again at the next loop. Resolves `{ raised }`. `between` is for tests: it runs after the first look and before the claim.
export async function checkReliability({
  project, client, now = () => new Date(), log = () => {}, between = () => {},
}) {
  const t = now();
  const lines = readIncidents();
  if (!overBar(lines, t)) return { raised: false };
  const recent = () => {
    const last = readNotice();
    return last !== null && t.getTime() - last < WINDOW_MS && t.getTime() >= last;
  };
  if (recent()) return { raised: false };
  between();
  const count = lines.filter((l) => t.getTime() - Date.parse(l.at) < WINDOW_MS && Date.parse(l.at) <= t.getTime()).length;
  // Claim the sending first: only one watcher gets it.
  const release = takeClaim(claimFolder());
  if (release === null) return { raised: false };
  try {
    // Another watcher may have sent it between the look above and the claim.
    if (recent()) return { raised: false };
    const before = readNotice();
    keepNotice(t.toISOString(), log);
    try {
      const made = await client.state.write({ project, kind: 'card', data: engineTroubleCard(count) });
      if (made?.ok !== true) throw new Error(made?.refused ?? 'the card was refused');
    } catch (error) {
      log(`The engine-trouble notice couldn't be raised: ${error.message}`);
      keepNotice(before === null ? null : new Date(before).toISOString(), log);
      return { raised: false };
    }
    return { raised: true };
  } finally {
    release();
  }
}
