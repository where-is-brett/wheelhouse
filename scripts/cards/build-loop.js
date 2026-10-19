// scripts/cards/build-loop.js
// The cards the build loop's plain records call for, worked out from the views, so `cli.js cards`,
// which makes and asks them, and the board-context hook, which counts them, agree: the click the
// merge gate waits for (a `gate-asks` record, rulings R117 and F72) and a lineage hold (rulings
// R146 and F71). Also the composer's input for each.
import { CLICK_MS } from '../lib/core-numbers.js';
import { namedPaths } from '../lineage/check.js';

const isRecord = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const msOf = (now) => (now instanceof Date ? now.getTime() : typeof now === 'function' ? msOf(now()) : Date.parse(now));
// Work whose feature has ended: its pull request waits for nothing more.
const FINISHED = ['merged', 'closed'];

// Whether the click a gate-asks entry asks for is on record: an approval of that commit however
// old, since the gate keeps it; a CI push only within CLICK_MS, the window the helper checks a CI
// push against when it pushes.
function clicked(entry, nowMs) {
  if (typeof entry.clickedAt !== 'string') return false;
  return entry.data.ask === 'approval' || nowMs - Date.parse(entry.clickedAt) <= CLICK_MS;
}

// What each click the merge gate waits for needs on this visit, from the views' `gateAsks`:
// { entry, make: true } when no card carries its line yet, or { entry, again: <card id> } when its
// card is asked again. None for work that has finished or a click on record. Ruling R121, on this
// side: a card is asked again when no fresh click on it exists and the gate-asks is older than the
// click window, as its last asking is, so the card comes back at most once a window, as the gate
// would record its gate-asks again at most once a window. The pull request itself isn't read here:
// whether it is still at that commit is the host's to say (`cli.js cards` asks it).
export function gateAsksDue(views, now) {
  const nowMs = msOf(now);
  const reports = isRecord(views?.reports) ? views.reports : {};
  const entries = Object.values(isRecord(views?.gateAsks) ? views.gateAsks : {})
    .filter((e) => isRecord(e) && isRecord(e.data) && typeof e.line === 'string' && typeof e.at === 'string');
  return entries.flatMap((entry) => {
    if (FINISHED.includes(reports[entry.data.work]?.data?.outcome) || clicked(entry, nowMs)) return [];
    if (typeof entry.card !== 'string') return [{ entry, make: true }];
    const last = Math.max(...[entry.at, entry.askedAt, entry.clickedAt].filter((t) => typeof t === 'string').map(Date.parse));
    return nowMs - last > CLICK_MS ? [{ entry, again: entry.card }] : [];
  });
}

// The lineage holds no card has been made for yet, from the views' `lineageHolds`.
export function holdsDue(views) {
  return (Array.isArray(views?.lineageHolds) ? views.lineageHolds : [])
    .filter((h) => isRecord(h) && typeof h.id === 'string' && h.card === null && Array.isArray(h.data?.mismatches) && h.data.mismatches.length > 0);
}

// Whether the pull request, as the host gives it ({ headSha, state }), still waits for the click: it
// is open, and for an approval its head is the commit asked about; for a CI push its head is not
// yet the update the push is for (once pushed, it is). An answer that says nothing either way is
// taken as waiting: asking is the safe side.
export function stillWaits(entry, pr) {
  if (!isRecord(pr)) return true;
  if (pr.state === 'merged' || pr.state === 'closed') return false;
  if (typeof pr.headSha !== 'string' || !/^[0-9a-f]{40}$/.test(pr.headSha)) return true;
  return entry.data.ask === 'approval' ? pr.headSha === entry.data.sha : pr.headSha !== entry.data.sha;
}

// The composer's input for the card a gate-asks entry asks for, naming the work by `name`.
export function gateInput(entry, name) {
  const { ask, pr, sha, branch } = entry.data;
  if (ask === 'approval') {
    return {
      kind: 'approval',
      level: 3,
      what: `Pull request #${pr} for ${name} has everything else it needs to merge, and waits for your approval of its latest commit.`,
      why: 'It merges only once you approve it, so it comes to you.',
      options: [{ label: 'Approve', says: 'It merges, and the build carries on.' }],
      recommend: 'Approve',
      because: 'everything else the merge checks for has passed, and your approval is all it waits for',
      meanwhile: 'It waits; other work carries on.',
      target: { pr, sha },
    };
  }
  return {
    kind: 'ci-push',
    level: 3,
    what: `Pull request #${pr} for ${name} needs the latest main line merged into its branch ${branch}, and that update changes a file that runs the automatic checks.`,
    why: 'A change to the automatic checks is pushed only with your own sign-in, so it comes to you.',
    options: [{ label: 'Push it', says: 'The update is pushed with your sign-in, and the merge carries on once the checks pass.' }],
    recommend: 'Push it',
    because: 'it brings the branch up to date with work already merged, and the merge waits for it',
    meanwhile: 'The merge waits; other work carries on.',
    target: { branch, sha },
  };
}

// Which kits differ, in plain words: each upstream with the first of its paths, or with only how
// many files differ (`short`), when the paths make the card too long.
function kitsOf(mismatches, short) {
  const byUpstream = new Map();
  for (const m of mismatches) byUpstream.set(m.upstream, [...(byUpstream.get(m.upstream) ?? []), m.path]);
  return [...byUpstream].map(([upstream, paths]) => {
    if (!short) return `${upstream} (${namedPaths(paths)})`;
    return `${upstream} (${paths.length} ${paths.length === 1 ? 'file' : 'files'})`;
  }).join('; ');
}

// The composer's input for a lineage hold's card: a question with no set line, since no click lifts
// the hold. It says which kits differ, that edits and commands are held, and what lifts the hold.
// An upstream of null is the manifest itself, which couldn't be read. `short` names the kits
// without their paths.
export function holdInput(hold, { short = false } = {}) {
  const { mismatches } = hold.data;
  const unread = mismatches.some((m) => m.upstream === null);
  return {
    kind: 'question',
    level: 3,
    what: unread
      ? 'Wheelhouse\'s own list of the kits it expects can\'t be read, so the installed kits can\'t be checked. Edits and commands are held in this project until they can be.'
      : `The installed kits differ from the ones Wheelhouse is pinned to: ${kitsOf(mismatches, short)}. Edits and commands are held in this project until they match.`,
    why: 'Putting the pinned kits back is yours to do on this computer, so it comes to you. No click here lifts the hold: once they are back, the next session start finds them matching and lifts it.',
    options: [
      { label: 'Show me how', says: 'I go through putting the pinned kits back, step by step.' },
      { label: 'Leave it for now', says: 'The hold stays, and nothing is edited or built until the kits match.' },
    ],
    recommend: 'Show me how',
    because: 'nothing in this project moves on until the kits match',
    meanwhile: 'Agents read and report; nothing is edited or built.',
    event: hold.id,
  };
}

// The views with these cards put back among those no visit has asked, so `cardsForVisit` takes
// them in their turn: a waiting card as it waits, and a card already decided from its card event in
// `events` (a CI push whose click has lapsed).
export function withPutBack(views, ids, events = []) {
  if (ids.size === 0) return views;
  const waiting = (Array.isArray(views?.waiting) ? views.waiting : []).map((c) => (ids.has(c?.id) ? { ...c, asked: null } : c));
  for (const id of ids) {
    if (waiting.some((c) => c?.id === id)) continue;
    const card = events.find((e) => e?.kind === 'card' && e.id === id);
    if (card !== undefined) waiting.push({ id: card.id, at: card.at, data: card.data, asked: null });
  }
  return { ...views, waiting };
}
