// scripts/desk/watch.js
// The desk's watch (spec 5.2): the changes since a cursor, delivered at least once. The cursor holds
// the whole snapshot it was made from (each card's hash, the glance's, each work item's state, STOP's
// time and the notices' ids), so the helper keeps no state per watcher, and a client that loses its
// place passes its last cursor again and gets the same changes again. A cursor that can't be read,
// or is from another version, counts as none: the whole state comes back as events, never an error.
import crypto from 'node:crypto';
import { DESK_VERSION } from './vocabulary.js';
import { cardTextOf } from '../mod/status.js';
import { dataHash } from '../state/events.js';
import { isOpen, readView } from './views.js';
import { goalInForce } from '../engine/goal.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const hashText = (text) => crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16);

// snapshotOf({ glance, waiting, work, stop, notices }) -> the state watch compares: `glance` the glance's
// text, `waiting` the waiting cards, `work` each open item's state by id, `stop` STOP's time or null,
// `notices` [{ id, lines }], whose ids are the courier's (incident:<id>, health:<hash>, finished:<work>), and `goal`, the
// goal in force or null, kept as its id and the hash of the whole entry so a narrowing or an End goal changes it.
export function snapshotOf({ glance = '', waiting = [], work = {}, stop = null, notices = [], goal = null } = {}) {
  const cards = {};
  for (const card of Array.isArray(waiting) ? waiting : []) {
    if (typeof card?.id !== 'string' || !isPlain(card.data)) continue;
    cards[card.id] = { hash: dataHash(card.data), lines: cardTextOf(card.data).split('\n') };
  }
  const seen = {};
  for (const notice of Array.isArray(notices) ? notices : []) {
    if (typeof notice?.id === 'string' && notice.id !== '') seen[notice.id] = Array.isArray(notice.lines) ? notice.lines : [];
  }
  return { glance: String(glance), cards, work: isPlain(work) ? { ...work } : {}, stop: typeof stop === 'string' ? stop : null, notices: seen,
    goal: isPlain(goal) && typeof goal.id === 'string' ? { id: goal.id, hash: dataHash(goal) } : null };
}

// What a cursor keeps of a snapshot: hashes and states, never words.
function compact(snapshot) {
  return {
    v: DESK_VERSION,
    glance: hashText(snapshot.glance),
    cards: Object.fromEntries(Object.entries(snapshot.cards).map(([id, c]) => [id, c.hash])),
    work: snapshot.work,
    stop: snapshot.stop,
    notices: Object.keys(snapshot.notices).sort(),
    goal: snapshot.goal ?? null,
  };
}

export function encodeCursor(snapshot) {
  return Buffer.from(JSON.stringify(compact(snapshot))).toString('base64url');
}

// The cursor's kept state, or null for anything it can't read or from another version.
export function decodeCursor(text) {
  try {
    const kept = JSON.parse(Buffer.from(String(text), 'base64url').toString('utf8'));
    if (!isPlain(kept) || kept.v !== DESK_VERSION || !isPlain(kept.cards) || !isPlain(kept.work) || !Array.isArray(kept.notices) || typeof kept.glance !== 'string') return null;
    if (kept.stop !== null && typeof kept.stop !== 'string') return null;
    // A cursor made before goals has none: it reads as no goal.
    kept.goal = isPlain(kept.goal) && typeof kept.goal.id === 'string' ? kept.goal : null;
    return kept;
  } catch {
    return null;
  }
}

// changes(cursor, snapshot) -> { events, cursor }: what changed between the cursor's state and the snapshot.
export function changes(cursor, snapshot) {
  const before = decodeCursor(cursor) ?? { glance: null, cards: {}, work: {}, stop: null, notices: [], goal: null };
  const after = compact(snapshot);
  const events = [];
  for (const [id, hash] of Object.entries(before.cards)) {
    if (after.cards[id] !== hash) events.push({ type: 'card-closed', card: id });
  }
  for (const [id, hash] of Object.entries(after.cards)) {
    if (before.cards[id] !== hash) events.push({ type: 'card-added', card: id, lines: snapshot.cards[id].lines });
  }
  if (before.glance !== after.glance) events.push({ type: 'glance-changed', glance: snapshot.glance });
  for (const id of new Set([...Object.keys(before.work), ...Object.keys(after.work)])) {
    if (before.work[id] !== after.work[id]) events.push({ type: 'work-changed', work: id, state: after.work[id] ?? null });
  }
  if (before.stop !== after.stop) events.push({ type: 'all-stop', on: after.stop !== null, at: after.stop });
  for (const id of after.notices) {
    if (!before.notices.includes(id)) events.push({ type: 'notice', id, lines: snapshot.notices[id] });
  }
  if ((before.goal?.id ?? null) !== (after.goal?.id ?? null) || (before.goal?.hash ?? null) !== (after.goal?.hash ?? null)) {
    events.push({ type: 'goal-changed', goal: after.goal?.id ?? null });
  }
  const next = encodeCursor(snapshot);
  return { events, cursor: events.length === 0 && typeof cursor === 'string' && decodeCursor(cursor) !== null ? cursor : next };
}

// The watcher deskCore takes: the snapshot from the source as it stands (the glance, the waiting
// cards, each open work item's step, STOP and the source's notices), and the changes since `cursor`.
export async function watchSource(cursor, source, { now = () => new Date() } = {}) {
  const got = await source.views({});
  if (got?.ok !== true || !isPlain(got.views)) return { ok: false, refused: got?.refused ?? 'This project has no record to show yet' };
  const { views } = got;
  const glance = await readView('glance', {}, source, { now });
  const features = isPlain(views.features) ? views.features : {};
  const work = Object.fromEntries(Object.keys(isPlain(views.work) ? views.work : {}).filter((id) => isOpen(views, id))
    .map((id) => [id, typeof features[id]?.data?.step === 'string' ? features[id].data.step : 'queued']));
  const stop = await source.stop();
  const notices = typeof source.notices === 'function' ? await source.notices() : [];
  // The goal's whole entry from the view, so a wish to end it (`endAsked`) changes what is hashed as a narrowing does.
  const running = goalInForce(views);
  const snapshot = snapshotOf({
    glance: glance.ok ? glance.lines[0] : '', waiting: views.waiting, work, stop: stop?.on === true ? (stop.at ?? 'on') : null, notices,
    goal: running === null ? null : { id: running.id, ...views.goals[running.id] },
  });
  return { ok: true, ...changes(cursor, snapshot) };
}
