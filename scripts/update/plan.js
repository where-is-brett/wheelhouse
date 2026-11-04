// scripts/update/plan.js
// What the Update card is made from (update design, sections 4, 5, 6.1 and 9.3): which release, whether it is an update, a
// put-back or a carry-on, whether it can be installed here, and whether the director's approval will be needed for the
// project's reviewed change. Every look at the outside world is a seam, so a test never reaches the network. Nothing here
// writes anything.
import { compareVersions } from '../lib/versions.js';
import { latestRelease } from './release.js';

// The earliest release that can finish an update: a put-back to anything before it is refused (design 9.3).
export const FIRST_UPDATE = 'v0.2.7';
export const NO_RELEASES = "Wheelhouse's releases couldn't be read just now. Nothing has changed.";
export const latestLine = (version) => `You have the latest Wheelhouse, ${version}.`;
export const checksOutLine = (tag) => `Release ${tag} doesn't check out, so it won't be installed.`;
export const noPutBackLine = (tag) => `Wheelhouse ${tag} can't be put back by this command: that release can't finish an update.`;
export const installedLine = (version) => `Wheelhouse ${version} is already installed.`;

// The journal's part-way update for this project, if any, as { tag, sha, from, put, installing }: a journal that is not done,
// has begun, and has not failed before anything on this computer moved (such a journal starts again, since nothing was
// installed). `installing` is true once the computer may have moved, which only a carry-on may then finish.
export function partWay(journal) {
  if (journal?.newer || journal?.steps === undefined) return null;
  const steps = journal.steps;
  if (steps.done?.state === 'done') return null;
  const begun = Object.values(steps).some((s) => s?.state !== 'todo');
  const data = steps.checks?.data;
  if (!begun || typeof data?.tag !== 'string' || typeof data?.sha !== 'string') return null;
  const installing = ['backup', 'catalogue', 'installs', 'verify', 'finish'].some((name) => steps[name]?.state && steps[name].state !== 'todo');
  const failedEarly = !installing && Object.values(steps).some((s) => s?.state === 'failed');
  if (failedEarly) return null;
  return { tag: data.tag, sha: data.sha, from: data.from ?? null, put: data.put === 'undo' ? 'undo' : 'release', installing };
}

// Works out the plan. Resolves { lines } when there is nothing to ask, or { lines: [], plan } with the plan's facts
// (project-free: the route adds the project; `account` is { from, to } when the account's settings name the catalogue at an old release, or null) and the Update card. Never throws for a thing that can be said in a line.
export async function makePlan({
  tag = null, from, journal = null, held = false, list, fetch, check, kind, requirements = () => null, account = () => null, locked = () => ({ locked: false, others: [] }),
}) {
  const said = (...lines) => ({ lines });
  if (typeof from !== 'string') return said('Wheelhouse can not tell which release this computer runs, so it can not offer an update.');

  const part = partWay(journal);
  if (held) return said('An update is already under way on this computer.');
  if (part !== null && (tag === null || tag === part.tag || part.installing)) {
    if (tag !== null && tag !== part.tag) return said(`The update to ${part.tag} is part-way. Finish it with /wheelhouse:update before naming another release.`);
    const plan = { from: part.from ?? from, to: part.tag, sha: part.sha, put: part.put, approval: 'review', says: null, locked: false, others: [], carryOn: true };
    return { lines: [], plan };
  }

  let releases;
  try {
    releases = await list();
  } catch {
    return said(NO_RELEASES);
  }
  let target;
  if (tag === null) {
    target = latestRelease(releases);
    if (target === null || compareVersions(target.tag, from) !== 1) return said(latestLine(from));
  } else {
    target = (Array.isArray(releases) ? releases : []).find((r) => r?.tag === tag) ?? null;
    if (target === null) return said(`Wheelhouse has no release called ${tag}.`);
  }
  const order = compareVersions(target.tag, from);
  if (order === null) return said(`Wheelhouse can not compare ${target.tag} with ${from}.`);
  if (order === 0) return said(installedLine(from));
  const put = order < 0 ? 'undo' : 'release';
  if (put === 'undo' && compareVersions(target.tag, FIRST_UPDATE) === -1) return said(noPutBackLine(target.tag));

  const fetched = await fetch(target.tag);
  if (fetched?.ok !== true || fetched.sha !== target.sha) return said(checksOutLine(target.tag));
  const looked = await check({ tag: target.tag, sha: target.sha });
  if (looked?.ok !== true) return said(checksOutLine(target.tag));
  const wanting = requirements({ nodeFloor: looked.nodeFloor, claudeFloor: looked.claudeFloor });
  if (wanting) return said(wanting);

  const named = account({ to: target.tag });
  if (named?.refused) return said(named.refused);

  const approval = (await kind(target.tag)) === 'pins-only' ? 'review' : 'card';
  const here = await locked({ to: target.tag });
  const plan = {
    from, to: target.tag, sha: target.sha, put, approval, says: looked.says ?? null, locked: here.locked === true, others: here.others ?? [], carryOn: false,
    account: typeof named?.ref === 'string' && named.ref !== target.tag ? { from: named.ref, to: target.tag } : null,
  };
  return { lines: [], plan };
}
