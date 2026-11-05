// scripts/update/change.js
// The update's reviewed change and its waits (update design, sections 6.2 and 6.3). The project's committed
// .claude/settings.json names the release in the Wheelhouse marketplace's `ref`. The update never writes that file in the
// director's main checkout: it opens the change on `wheelhouse-release-<commit>` (or `wheelhouse-undo-<commit>`), which goes
// through the usual gate. A pins-only release needs Wheelhouse's review and nothing more; any other release needs the
// director's answer to the card named `release-<commit>`, which is a different click from the one that started the update.
// Nothing here approves or writes the settings file. The merge is the helper's (scripts/update/merge.js, the helper's
// /pr/merge-release): once the approval is in, the `merged` step asks it to merge the change in the same run, and it checks
// everything itself, so an agent that asks it for a merge gets nothing the director has not approved. Where the helper holds the merge
// back or the host refuses it, the change waits for the usual way in (the gate, scripts/gate/release-approval.js).
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from '../lib/paths.js';
import { run as defaultRun } from '../lib/run.js';
import { safeGit } from '../lib/safe-git.js';
import { RELEASE_FILE, SETTINGS_FILE, canInstall, releaseBranch, releaseChange, settingsText, tagRefFor, undoBranch } from '../lineage/release.js';
import { MARKETPLACE } from '../lineage/manifest.js';
import { RELEASE_LABEL, releaseLine } from '../state/card-lines.js';
import { releaseCardName } from '../gate/release-approval.js';
import { MISMATCH_LINE } from './merge.js';
import { mainTip } from './open.js';

// The mirror the update fetched the release's tag into, under the Wheelhouse home, which nothing in a session's sandbox
// can write to.
export const updateMirror = () => path.join(wheelhouseHome(), 'update', 'mirror');

const NOT_NOW = 'Not now';
const FULL_SHA = /^[0-9a-f]{40}$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function readSettings(projectDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(projectDir, ...SETTINGS_FILE.split('/')), 'utf8'));
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// The project's settings as its main version holds them (the committed file, never the working copy or the folder's own
// commit, which may be unpushed): [that file], or none where it can't be read (not a git folder, no main version, no file).
// An update that did not land its change can leave the pins in the working copy alone, so "already merged" and "merged" are
// judged on this.
export async function committedSettings({ projectDir, run = defaultRun }) {
  try {
    const git = safeGit({ run, cwd: projectDir, list: 'project', look: 'never', caller: 'helper', what: 'the project', timeoutMs: 120000 });
    const tip = await mainTip(git);
    if (tip === null) return [];
    const got = await git(['show', `${tip}:${SETTINGS_FILE}`], { input: '' });
    if (got.code !== 0) return [];
    const parsed = JSON.parse(got.stdout);
    return isObject(parsed) ? [parsed] : [];
  } catch {
    return [];
  }
}

// The release the project's settings name, or null when they name no Wheelhouse marketplace (or can't be read).
export function namedRef(settings) {
  const entry = isObject(settings?.extraKnownMarketplaces) && Object.hasOwn(settings.extraKnownMarketplaces, MARKETPLACE) ? settings.extraKnownMarketplaces[MARKETPLACE] : null;
  const ref = isObject(entry?.source) ? entry.source.ref : undefined;
  return typeof ref === 'string' ? ref : null;
}

// Whether the release only moves the pins, by its own file in the fetched tag. This only decides whether the card is raised;
// the gate reads the same file itself and is the one that decides what merges. Anything that can't be read is "changes".
export async function releaseKind({ tag, run = defaultRun, mirror = updateMirror() }) {
  try {
    const git = safeGit({ run, cwd: mirror, look: 'never', timeoutMs: 120000 });
    const got = await git(['cat-file', 'blob', `${tagRefFor(tag)}:${RELEASE_FILE}`], { input: '' });
    if (got.code !== 0) return 'changes';
    const file = JSON.parse(got.stdout);
    return isObject(file) && file.kind === 'pins-only' && file.lineage === 'passed' ? 'pins-only' : 'changes';
  } catch {
    return 'changes';
  }
}

// The card the job raises for the director's approval of a release that is not pins-only. Named for the commit, so an
// answer for another release or commit is not an answer to this one. The option that approves is Approve; Not now puts it off.
export function approvalCard({ previous, release, commit }) {
  const line = releaseLine(previous, release, commit);
  return {
    id: releaseCardName(commit),
    previous,
    release,
    commit,
    line,
    options: [RELEASE_LABEL, NOT_NOW],
    question: [
      `Wheelhouse ${release} changes more than its pins, so moving this project to it needs your say.`,
      'It changes the project\'s safety settings, which can bring new checks. The change is reviewed first, and it is only added once you approve it here.',
      'Meanwhile nothing is installed, and your work carries on as it is.',
      line,
    ].join('\n'),
  };
}

// Opens the project's reviewed change. `put` is 'release' (the update) or 'undo' (putting back `previous`). `projectDir` is the
// project's main checkout, read and never written. `open({ branch, file, text, title, body, release, commit })` is how the change
// is opened (it pushes the branch and calls the helper's /pr/open-release), resolving { ok, number } or { ok: false, refused }.
// `raise(card)` raises the approval card when the release needs one. `kind` says whether the release is pins-only (releaseKind).
// Resolves { ok, pr?, skipped?, approval?, line }. Never writes the settings file.
export async function openChange({ project, target, previous, put = 'release', projectDir, open, raise, kind, run = defaultRun, committed = () => committedSettings({ projectDir, run }) }) {
  const aim = put === 'undo' ? previous : { ref: target?.tag, sha: target?.sha };
  const ref = aim?.ref ?? aim?.tag;
  const sha = aim?.sha;
  if (typeof ref !== 'string' || !FULL_SHA.test(sha ?? '')) return { ok: false, line: 'The release to move this project to is not known in full.' };
  const working = readSettings(projectDir);
  // The change is made from the main version's file. Where that can't be read, the working copy stands in for it.
  const held = typeof committed === 'function' ? await committed() : [];
  const settings = held[0] ?? working;
  const named = namedRef(settings);
  // Before setup's step 7 the settings don't name the catalogue yet: there is nothing to change, and the update moves only this computer.
  if (named === null) return { ok: true, skipped: 'before-step-7', line: 'This project does not name Wheelhouse in its settings yet, so only this computer moves.' };
  // Another computer updated the project first: the change is already in the main version. Pins only in the working copy are not that.
  if (named === ref || (held.length > 0 ? namedRef(held[0]) === ref : namedRef(working) === ref)) return { ok: true, skipped: 'merged', line: `This project already names ${ref}.` };
  let text;
  try {
    text = settingsText(releaseChange(settings, { ref, sha }));
  } catch (error) {
    return { ok: false, line: `The change naming ${ref} could not be made: ${error.message}.` };
  }
  if (typeof open !== 'function') throw new Error('The update needs a way to open its reviewed change');
  const opened = await open({
    branch: put === 'undo' ? undoBranch(sha) : releaseBranch(sha),
    file: SETTINGS_FILE,
    text,
    title: put === 'undo' ? `Put Wheelhouse back to ${ref}` : `Move this project to Wheelhouse ${ref}`,
    body: `Moves this project's Wheelhouse release from ${named} to ${ref} (${sha}). Only the Wheelhouse marketplace's ref in ${SETTINGS_FILE} changes.`,
    release: ref,
    commit: sha,
  });
  if (opened?.ok !== true) return { ok: false, line: `The change naming ${ref} could not be opened: ${opened?.refused ?? 'no reason was given'}.` };
  const pr = Number.isInteger(opened.number) ? opened.number : undefined;
  const needsCard = kind !== 'pins-only';
  const card = approvalCard({ previous: named, release: ref, commit: sha });
  if (needsCard && typeof raise === 'function') await raise(card);
  return {
    ok: true,
    ...(needsCard ? { card: { previous: named, release: ref, commit: sha } } : {}),
    ...(pr === undefined ? {} : { pr }),
    approval: needsCard ? 'card' : 'review',
    line: `The change naming ${ref}${pr === undefined ? '' : ` (#${pr})`} is open${needsCard ? ', and waits for your approval' : ', and waits for its review'}.`,
  };
}

// Where the change stands. `target` is { tag }; `projectDir` the main checkout, whose settings must name the tag before anything
// installs (a merge on the host is not enough until the folder has it). `prState(number)` resolves the host's state of the
// change, { state: 'open' | 'merged' | 'closed' }, when `pr` is known. Resolves { merged } | { waiting: line } | { closed: line }.
export async function waitMerged({ target, projectDir, pr, prState, run = defaultRun, committed = () => committedSettings({ projectDir, run }) }) {
  const tag = target?.tag;
  if (namedRef(readSettings(projectDir)) === tag) {
    // Pins in the working copy alone are not the merge: what is committed has to name the release too, where it can be read.
    const held = typeof committed === 'function' ? await committed() : [];
    if (held.length === 0 || namedRef(held[0]) === tag) return { merged: true };
  }
  let state = null;
  if (Number.isInteger(pr) && typeof prState === 'function') {
    try { state = (await prState(pr))?.state ?? null; } catch { state = null; }
  }
  if (state === 'closed') return { closed: `The change naming ${tag} was closed without being merged, so nothing was installed.` };
  if (state === 'merged') return { waiting: `The change naming ${tag} is merged. Waiting for it to reach your project's folder.`, state };
  return { waiting: `Waiting for the change naming ${tag} to be merged.`, state };
}

// Whether the computer is free to install: All stop is off and no feature is past `started` (canInstall). Plugins are shared
// across the computer, so the install waits for work in progress, and while All stop is on it holds, installing nothing.
// `stopped()` says whether All stop is on; `features()` gives the features view. Resolves { idle } | { waiting: line }.
export async function waitIdle({ stopped, features }) {
  if (typeof stopped === 'function' ? await stopped() !== false : true) return { waiting: 'All stop is on, so nothing is installed. Lift All stop and the update carries on.' };
  const found = canInstall({ features: typeof features === 'function' ? await features() : features });
  return found.ok ? { idle: true } : { waiting: `Waiting to install: ${found.why}.` };
}

// The steps `change`, `merged` and `idle` of the update's job (scripts/update/job.js), over the seams above. A wait returns
// { ok: false, line }, and the next apply carries on from it. A change that was closed stops the job with nothing installed,
// and the line says so. A journal read as { newer: true } is never read here: the job refuses it before any step runs.
// `approved()` says whether the director's card for a release that is not pins-only is answered (signed), so the helper is not
// asked to merge before it is. `merge({ pr })` asks the helper to merge the change now, resolving { ok: true, merged: true } or
// { ok: false, kind: 'mismatch' | 'held', refused }.
export function changeSteps({ projectDir, target, previous, put = 'release', open, raise, prState, merge, approved, stopped, features, run = defaultRun, mirror = updateMirror() }) {
  return [
    {
      name: 'change',
      async run({ project }) {
        const kind = await releaseKind({ tag: target.tag, run, mirror });
        const got = await openChange({ project, target, previous, put, projectDir, open, raise, kind });
        if (!got.ok) return { ok: false, line: got.line };
        return { data: { pr: got.pr ?? null, skipped: got.skipped ?? null, approval: got.approval ?? null, ...(got.card ? { card: got.card } : {}) } };
      },
    },
    {
      name: 'merged',
      async run({ data }) {
        const made = data.change ?? {};
        if (made.skipped === 'before-step-7') return { data: { merged: false, skipped: 'before-step-7' } };
        let got = await waitMerged({ target, projectDir, pr: made.pr ?? undefined, prState });
        let hold = null;
        if (got.waiting !== undefined && got.state === 'open' && typeof merge === 'function' && Number.isInteger(made.pr)
          && (made.approval !== 'card' || typeof approved !== 'function' || await approved() === true)) {
          const tried = await merge({ pr: made.pr });
          if (tried?.ok === true && tried.merged === true) got = await waitMerged({ target, projectDir, pr: made.pr, prState });
          else if (tried?.kind === 'mismatch') return { ok: false, line: `${MISMATCH_LINE} (${String(tried.refused ?? 'it differs').replace(/\.$/, '')}.)` };
          else hold = `Wheelhouse could not merge the change naming ${target.tag} itself (${String(tried?.refused ?? 'no reason was given').replace(/\.$/, '')}), so it waits to be merged the usual way.`;
        }
        // Approved only when the director's card was the way in; a release that needed Wheelhouse's review alone was not.
        if (got.merged) return { data: { merged: true, ...(made.approval === 'card' ? { approved: true } : made.approval === 'review' ? { approved: false } : {}) } };
        if (got.closed) return { ok: false, line: got.closed };
        return { ok: false, waiting: true, line: hold ?? got.waiting };
      },
    },
    {
      name: 'idle',
      async run() {
        const got = await waitIdle({ stopped, features });
        return got.idle ? undefined : { ok: false, waiting: true, line: got.waiting };
      },
    },
  ];
}
