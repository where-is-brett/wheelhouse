// scripts/update/merge.js
// The update merges its own reviewed change (update design, section 21). The helper does it, straight after the director's
// approval, with a check made right before: this file holds that check, which reads what it is given and touches nothing.
// The change must be exactly the one the update made: one file, the project's settings, and in it only the Wheelhouse
// marketplace's `ref`, moved to the release's tag. The branch names the tag's commit in full, that commit is the one the
// checks step recorded and the one Wheelhouse's own repository has at the tag, and the director's click on the Update card
// (and, for a release that is not pins-only, on the release's card) is signed. Anything else is a mismatch, which stops the
// update with nothing merged; an approval or a folder not ready yet is a hold, which waits.
import { SETTINGS_FILE, pinsOnlyChange, releaseBranch, releaseChange, settingsText, undoBranch } from '../lineage/release.js';

const FULL_SHA = /^[0-9a-f]{40}$/;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export const MISMATCH_LINE = 'The change on the project is not the one the update made, so nothing was merged and nothing was installed.';

// Whether `sides` ({ base, head, headMode }, as the host's change reads them) differ by exactly the update's own edit: the
// head file is the base file with the marketplace's ref moved to `release`, written as the update writes it.
export function exactChange({ paths, sides, release, commit }) {
  if (!Array.isArray(paths) || paths.length !== 1 || paths[0] !== SETTINGS_FILE) return { ok: false, why: `it changes more than ${SETTINGS_FILE}` };
  if (!isObject(sides) || typeof sides.base !== 'string' || typeof sides.head !== 'string' || sides.headMode !== '100644') return { ok: false, why: `${SETTINGS_FILE} could not be read as a plain file` };
  if (pinsOnlyChange(paths, sides)?.ref !== release) return { ok: false, why: 'it changes more than the Wheelhouse marketplace\'s ref, to the release' };
  let expected;
  try {
    expected = settingsText(releaseChange(JSON.parse(sides.base), { ref: release, sha: commit }));
  } catch {
    return { ok: false, why: `${SETTINGS_FILE} could not be read` };
  }
  return expected === sides.head ? { ok: true } : { ok: false, why: `${SETTINGS_FILE} differs from the update's own edit` };
}

// Decides whether the helper may merge the change. Returns { ok: true } or { ok: false, kind, why }; `kind` is 'mismatch' (stop,
// merge nothing) or 'held' (wait, merge nothing now). Every input is the helper's own reading, never the caller's:
//   stored    the plan the Update card showed ({ plan: { to, sha, put } }), read from the journal's folder
//   clicked   whether the director's signed click on the Update card for that plan is in the state
//   journal   the journal as read: its checks step's { tag, sha } and its change step's pr
//   number    the change's number; put 'release' | 'undo'; release the tag; commit its commit in full
//   pr        the host's reading of the change: { state, headRef, baseRef }; defaultBranch the project's
//   changes   { paths, files } of the change
//   update    isUpdateChange's finding ({ matched, ok, release, commit, approved }), which has Wheelhouse's own repository
//             confirm the tag is at that commit; pinsOnly whether the release is pins-only
export function decideMerge({ stored, clicked, journal, number, put, release, commit, pr, defaultBranch, changes, update, pinsOnly }) {
  const mismatch = (why) => ({ ok: false, kind: 'mismatch', why });
  const held = (why) => ({ ok: false, kind: 'held', why });
  if (!FULL_SHA.test(commit ?? '') || typeof release !== 'string') return mismatch('the release is not named in full');
  const plan = stored?.plan;
  if (!isObject(plan) || plan.to !== release || plan.sha !== commit || (plan.put === 'undo' ? 'undo' : 'release') !== put) return mismatch('it is not the release the Update card showed');
  const checks = journal?.steps?.checks;
  if (checks?.state !== 'done' || checks.data?.tag !== release || checks.data?.sha !== commit) return mismatch('it is not the release the update checked');
  if (journal?.steps?.change?.data?.pr !== number) return mismatch('it is not the change the update opened');
  if (pr?.state !== 'open') return mismatch(`the change is ${pr?.state ?? 'not found'}, not open`);
  if (pr.headRef !== (put === 'undo' ? undoBranch(commit) : releaseBranch(commit))) return mismatch('its branch does not name the release\'s commit');
  if (pr.baseRef !== defaultBranch) return mismatch('it is not aimed at the project\'s main version');
  if (update?.matched !== true || update.ok !== true || update.release !== release || update.commit !== commit) return mismatch(update?.why ?? 'the state does not record it as the update\'s own change');
  const exact = exactChange({ paths: changes?.paths, sides: changes?.files?.[SETTINGS_FILE], release, commit });
  if (!exact.ok) return mismatch(exact.why);
  if (clicked !== true) return held('the director has not clicked Update on the card for this plan');
  if (pinsOnly !== true && update.approved !== true) return held('it waits for the director\'s approval');
  return { ok: true };
}
