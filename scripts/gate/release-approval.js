// scripts/gate/release-approval.js
// The gate's rules for the reviewed change that moves a project to a Wheelhouse release by the update (update design,
// section 6.2). The helper records that such a change was opened by Wheelhouse's update, as a provenance of kind `update`
// ({ release, commit }), in the signed state. The gate accepts that kind only on the release's or the undo's branch, and
// a release that is not pins-only merges only with the director's own signed answer to the card for that release at
// that commit. No other approval stands in for it, and a record in the state that is not signed by an enrolled
// computer counts for nothing. Pure: it reads what it is given.
import { verify } from '../state/signing.js';
import { RELEASE_LABEL, releaseLine } from '../state/card-lines.js';
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
  if (typeof commit !== 'string' || !FULL_SHA.test(commit) || typeof release !== 'string' || releaseLine(release, commit).length > 300) return refuse('the update\'s record does not name a release and its commit');
  const named = RELEASE_BRANCH.exec(typeof headRef === 'string' ? headRef : '');
  if (!named) return refuse('an update opens only a release\'s or an undo\'s branch');
  if (named[1] !== commit) return refuse('the branch names another commit than the update\'s record');
  return { matched: true, ok: true, release, commit };
}

// Whether the director has answered the card for `release` at `commit` with Approve: a verified, signed action of this
// computer's own key, naming that tag and that commit in full. An answer for another commit or another tag doesn't count;
// nor does one not signed (a click in an agent's chat is only the agent's own account of it).
export function releaseApproved({ events, release, commit, enrolled }) {
  if (!FULL_SHA.test(commit ?? '') || !Array.isArray(events)) return false;
  return events.some((e) => e?.kind === 'action'
    && e.data?.action === 'approve-release'
    && e.data.release === release
    && e.data.commit === commit
    && e.data.label === RELEASE_LABEL
    && verify(e, enrolled));
}
