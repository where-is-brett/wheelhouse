// scripts/gate/release-approval.js
// The gate's rules for the reviewed change that moves a project to a Wheelhouse release by the update (update design,
// section 6.2). The helper records that such a change was opened by Wheelhouse's update, as a provenance of kind `update`
// ({ release, commit }), in the signed state. The gate accepts that kind only on the release's or the undo's branch, and
// a release that is not pins-only merges only with the director's own signed answer to the card for that release at
// that commit. No other approval stands in for it, and a record in the state that is not signed by an enrolled
// computer counts for nothing. Pure: it reads what it is given.
import { verify } from '../state/signing.js';
import { RELEASE_LABEL, RELEASE_TAG } from '../state/card-lines.js';
import { RELEASE_BRANCH } from '../lineage/release.js';

const FULL_SHA = /^[0-9a-f]{40}$/;

// The card's name. A step the window confirms is named for it (`release-<commit>`).
export const releaseCardName = (commit) => `release-${commit}`;

// What the recorded provenance of a branch says of an update. { matched: false } for any record that is not an update's;
// else { matched: true, ok, release, commit, why? }. An update's record counts only on a release or undo branch whose name
// carries the same commit, and carries nothing beside the release and the commit.
export function updateProvenance({ recorded, headRef }) {
  if (recorded === null || typeof recorded !== 'object' || Array.isArray(recorded) || !Object.hasOwn(recorded, 'update')) return { matched: false };
  const refuse = (why) => ({ matched: true, ok: false, why });
  const update = recorded.update;
  if (Object.keys(recorded).length !== 1) return refuse('the record of how it was opened carries more than the update');
  if (update === null || typeof update !== 'object' || Array.isArray(update) || Object.keys(update).sort().join() !== 'commit,release') return refuse('the update\'s record does not name a release and its commit');
  const { release, commit } = update;
  if (typeof commit !== 'string' || !FULL_SHA.test(commit) || typeof release !== 'string' || !RELEASE_TAG.test(release)) return refuse('the update\'s record does not name a release and its commit');
  const named = RELEASE_BRANCH.exec(typeof headRef === 'string' ? headRef : '');
  if (!named) return refuse('an update opens only a release\'s or an undo\'s branch');
  if (named[1] !== commit) return refuse('the branch names another commit than the update\'s record');
  return { matched: true, ok: true, release, commit };
}

// The release the project's settings named on the base side of a change, from the base file's text, or null.
export function baseRefOf(baseText) {
  try {
    const ref = JSON.parse(baseText)?.extraKnownMarketplaces?.wheelhouse?.source?.ref;
    return typeof ref === 'string' && RELEASE_TAG.test(ref) ? ref : null;
  } catch {
    return null;
  }
}

// Whether the director has answered the card for the move from `previous` to `release` at `commit` with Approve: a verified,
// signed action of this computer's own key, naming both tags and that commit in full, and made after the update's record
// for `branch` (the reviewed change this answer is for). So an answer for another commit, another tag, another starting
// point, or from before this change was opened (a move to an earlier release that was approved on its way up) doesn't count;
// nor does one not signed (a click in an agent's chat is only the agent's own account of it).
export function releaseApproved({ events, previous, release, commit, branch, enrolled }) {
  if (!FULL_SHA.test(commit ?? '') || !Array.isArray(events) || typeof previous !== 'string') return false;
  const opened = events
    .filter((e) => e?.kind === 'provenance' && e.data?.branch === branch && e.data.provenance?.update !== undefined && typeof e.at === 'string' && verify(e, enrolled))
    .map((e) => e.at).sort().at(-1);
  if (opened === undefined) return false;
  return events.some((e) => e?.kind === 'action'
    && e.data?.action === 'approve-release'
    && e.data.previous === previous
    && e.data.release === release
    && e.data.commit === commit
    && e.data.label === RELEASE_LABEL
    && typeof e.at === 'string' && e.at > opened
    && verify(e, enrolled));
}
