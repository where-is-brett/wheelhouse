// scripts/cards/build-loop.js
// The cards the build loop's plain records call for, worked out from the views, so `cli.js cards`,
// which makes and asks them, and the board-context hook, which counts them, agree: the click the
// merge gate waits for (a `gate-asks` record, rulings R117 and F72), a lineage hold (rulings
// R146 and F71) and a feature whose wakes the files that steer agents hold (a `control-file`
// record, ruling P7-13), and the premium model's failed evaluation (design section 14.6). Also the composer's input
// for each.
import { CLICK_MS } from '../lib/core-numbers.js';
import { namedPaths } from '../lineage/check.js';
import { prFinished } from '../state/views.js';

const isRecord = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const msOf = (now) => (now instanceof Date ? now.getTime() : typeof now === 'function' ? msOf(now()) : Date.parse(now));

// Whether the click a gate-asks entry asks for is on record: an approval of that commit however
// old, since the gate keeps it; a CI push only within CLICK_MS, the window the helper checks a CI
// push against when it pushes.
function clicked(entry, nowMs) {
  if (typeof entry.clickedAt !== 'string') return false;
  return entry.data.ask === 'approval' || nowMs - Date.parse(entry.clickedAt) <= CLICK_MS;
}

// Whether a CI push card is asked again (ruling R121, as rulings F77 and F78 read it): the director
// clicked it, the click has lapsed (clicked has said it isn't fresh), and the card hasn't been asked
// since that click, so it comes back once for each lapsed click. Only for a gate-asks that names the
// head the update was made from (`from`), so the host can say whether the push happened
// (stillWaits). An approval click never lapses, and a card with no click keeps to the usual rules:
// asked once, and put off by Not now.
function lapsedPush(entry) {
  const { ask, from } = entry.data;
  if (ask !== 'ci-push' || typeof from !== 'string' || typeof entry.clickedAt !== 'string') return false;
  return typeof entry.askedAt !== 'string' || Date.parse(entry.askedAt) <= Date.parse(entry.clickedAt);
}

// What each click the merge gate waits for needs on this visit, from the views' `gateAsks`:
// { entry, make: true } when no card carries its line yet, or { entry, again: <card id> } when its
// card is asked again (lapsedPush). None for a pull request that has finished (prFinished, as the
// waiting view reads it) or a click on record. The pull request itself isn't read here: whether it
// still waits is the host's to say (`cli.js cards` asks it).
export function gateAsksDue(views, now) {
  const nowMs = msOf(now);
  const reports = isRecord(views?.reports) ? views.reports : {};
  const entries = Object.values(isRecord(views?.gateAsks) ? views.gateAsks : {})
    .filter((e) => isRecord(e) && isRecord(e.data) && typeof e.line === 'string' && typeof e.at === 'string');
  return entries.flatMap((entry) => {
    if (prFinished(reports, { work: entry.data.work, pr: entry.data.pr, at: entry.at }) || clicked(entry, nowMs)) return [];
    if (typeof entry.card !== 'string') return [{ entry, make: true }];
    return lapsedPush(entry) ? [{ entry, again: entry.card }] : [];
  });
}

// The lineage holds no card has been made for yet, from the views' `lineageHolds`.
export function holdsDue(views) {
  return (Array.isArray(views?.lineageHolds) ? views.lineageHolds : [])
    .filter((h) => isRecord(h) && typeof h.id === 'string' && h.card === null && Array.isArray(h.data?.mismatches) && h.data.mismatches.length > 0);
}

// The control-file records no card has been made for yet, from the views' `controlFiles`.
export function controlFilesDue(views) {
  return (Array.isArray(views?.controlFiles) ? views.controlFiles : [])
    .filter((r) => isRecord(r) && typeof r.id === 'string' && r.card === null && typeof r.data?.work === 'string' && Array.isArray(r.data?.paths));
}

// The premium model's failed evaluations no card has been made for yet, from the views' `premiumFailures` (design
// section 14.6): each brings the director one card.
export function premiumFailuresDue(views) {
  return (Array.isArray(views?.premiumFailures) ? views.premiumFailures : [])
    .filter((r) => isRecord(r) && typeof r.id === 'string' && r.card === null && isRecord(r.data));
}

// Whether the pull request, as the host gives it ({ headSha, state }), still waits for the click: it
// is open, and for an approval its head is the commit asked about; for a CI push its head is not
// yet the update the push is for (once pushed, it is). A CI push card asked `again` waits only while
// the head is still the one the update was made from: past it, the push happened, or the branch has
// moved on and a new update will be asked for. An answer that says nothing either way is taken as
// waiting: asking is the safe side.
export function stillWaits(entry, pr, { again = false } = {}) {
  if (!isRecord(pr)) return true;
  if (pr.state === 'merged' || pr.state === 'closed') return false;
  if (typeof pr.headSha !== 'string' || !/^[0-9a-f]{40}$/.test(pr.headSha)) return true;
  if (entry.data.ask === 'approval') return pr.headSha === entry.data.sha;
  return again ? pr.headSha === entry.data.from : pr.headSha !== entry.data.sha;
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
  const { mismatches, why } = hold.data;
  const unread = mismatches.some((m) => m.upstream === null);
  return {
    kind: 'question',
    level: 3,
    // A hold that says why (an agent's own, ruling P8-23) says that in place of the kits.
    what: typeof why === 'string' && why !== ''
      ? `${why.replace(/\.+$/, '')}. Edits and commands are held in this project until it passes.`
      : unread
      ? 'Wheelhouse\'s own list of the kits it expects can\'t be read, so the installed kits can\'t be checked. Edits and commands are held in this project until they can be.'
      : `The installed kits differ from the ones Wheelhouse is pinned to: ${kitsOf(mismatches, short)}. Edits and commands are held in this project until they match.`,
    // An agent's own hold says what lifts it (ruling P8-32); the session start's is lifted by a matching start.
    why: typeof hold.data.lifts === 'string' && hold.data.lifts !== ''
      ? hold.data.lifts
      : 'Putting the pinned kits back is yours to do on this computer, so it comes to you. No click here lifts the hold: once they are back, the next session start finds them matching and lifts it.',
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

// The paths a control-file card names: the first three, each in backticks, then how many more.
const SHOWN_PATHS = 3;
function pathsOf(paths) {
  const named = paths.slice(0, SHOWN_PATHS).map((p) => `\`${p}\``);
  if (paths.length > SHOWN_PATHS) named.push(`${paths.length - SHOWN_PATHS} more`);
  return named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`;
}

// The sentence a Keep card opens with, saying what the watcher found (`data` a control-file
// record's): the new or changed files, the first three by name or (`short`) only how many, or that
// there is no record of them. The watcher keeps the files only on a Confirm whose card said this of
// its own last finding (ruling P7-33).
export function controlFilesNamed(data, { short = false } = {}) {
  const { why, paths } = data;
  if (why === 'no-record') return 'There is no record yet of this feature\'s agent files, so they can\'t be checked: look at them before the feature carries on.';
  const one = paths.length === 1;
  const named = short ? `${paths.length} ${one ? 'file' : 'files'}` : pathsOf(paths);
  return `A feature's folder has ${one ? 'a new or changed file that steers' : 'new or changed files that steer'} agents, ${named}: look at ${one ? 'it' : 'them'} before the feature carries on.`;
}

// The composer's input for a control-file record's card (rulings P7-13, P7-31). For new or changed
// files it says which, in the plan's words, and for a folder with no record kept that there is
// none: the card's Confirm, a signed step, keeps the files as they are now, through its set line
// naming the work and what was found (keep-control-files), and taking them out lifts the hold too.
// For a folder with too many files to check it is a question with no set line, since nothing
// could be kept. The feature is named by `name` (its title) and its id. `short` says only how many files.
export function controlFileInput(record, name, { short = false } = {}) {
  const { work, why, paths, hash } = record.data;
  const feature = name === work ? work : `${name} (${work})`;
  const meanwhile = 'The feature waits; other work carries on.';
  if (why === 'too-many') {
    return {
      kind: 'question',
      level: 3,
      what: `A feature's folder has too many files to check for ones that steer agents, so the feature waits. The feature is ${feature}.`,
      why: 'A file that steers agents could change what a session may do, so a feature\'s session is woken only once its files have been checked. No click here lifts the hold: once the folder has fewer files, the next wake goes ahead.',
      options: [
        { label: 'Go through them', says: 'We look at what fills the folder, and what can go.' },
        { label: 'Leave it for now', says: 'The feature waits, and its session isn\'t woken.' },
      ],
      recommend: 'Go through them',
      because: 'the feature carries on only once its files can be checked',
      meanwhile,
      event: record.id,
    };
  }
  return {
    kind: 'keep-control-files',
    level: 3,
    what: `${controlFilesNamed(record.data, { short })} The feature is ${feature}.`,
    why: why === 'no-record'
      ? 'A file that steers agents could change what a session may do, so a feature\'s session is woken only while those files are as they were last kept, and this folder was made before that record was kept.'
      : 'A file that steers agents could change what a session may do, so the feature\'s session isn\'t woken until you have looked. Taking the files out lifts the hold too.',
    options: [{ label: 'Confirm', says: 'The files are kept as they are now, and the feature\'s session is woken again.' }],
    recommend: 'Show me',
    because: 'the files are best looked at before they are kept',
    meanwhile,
    target: { work, hash },
    event: record.id,
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
