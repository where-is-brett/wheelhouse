// scripts/desk/file-source.js
// The desk's source over the files under ~/.wheelhouse: the project's views and events, the
// director's own settings, the board's inputs, usage, STOP and an approval card's preview. Inside the
// helper (`fresh`) the views are built again from the events first, as its /state/views route builds
// them; the local fallback outside the sandbox reads them as the helper last left them.
import { localViews } from '../hooks/session-start.js';
import { listEvents } from '../state/events.js';
import { writeViews } from '../state/views.js';
import { readProfileViews, writeProfileViews } from '../profile/store.js';
import { loadBoardInputs } from '../board/inputs.js';
import { usageFigures, weeklyShare } from '../usage/figures.js';
import { delegationReview } from '../frontdesk/learning.js';
import { previewFor } from '../mod/previews.js';
import { readEnrolled } from '../state/signing.js';
import { namesOf } from '../lib/projects.js';
import { stateDir } from '../lib/paths.js';
import { stopState } from '../lib/stop.js';

const APPROVAL_LINE = /^Approve pull request #([1-9][0-9]*) at commit ([0-9a-f]{12})$/;

// fileSource(project, { cwd, client, now, fresh, waitMs }) -> source. `cwd` is a folder of the project, for
// the board's inputs; `client` the helper client the board and previews ask (the helper's own, inside it);
// `waitMs` how long the board's inputs wait on the helper (loadBoardInputs' own limit when not given).
export function fileSource(project, { cwd, client, now = () => new Date(), fresh = false, waitMs } = {}) {
  const events = () => listEvents(stateDir(project), { report: () => {} });
  return {
    project,
    cwd,
    // The helper client the board and previews ask, which the pane asks for an approval's preview.
    client,
    events,
    enrolled: () => readEnrolled(),
    async views({ cards = false, answers = false, review = false } = {}) {
      const views = fresh ? await writeViews(project, { now }) : localViews(project, null);
      if (views === null || typeof views !== 'object') return { ok: false, refused: 'This project has no record to show yet' };
      const all = cards || answers || review ? events() : [];
      return {
        ok: true,
        views,
        names: namesOf(project),
        ...(stopState().on ? { stop: true } : {}),
        ...(cards ? { cards: all.filter((e) => e.kind === 'card') } : {}),
        ...(answers ? { answers: all.filter((e) => e.kind === 'card-answer') } : {}),
        ...(review ? { review: delegationReview(all, { now, enrolled: readEnrolled(), views }) } : {}),
      };
    },
    async profile() {
      return fresh ? writeProfileViews({ now }) : readProfileViews();
    },
    // `now` is the clock the board is read at, when not the source's (the pane's, which is the caller's).
    async board({ offline = false, now: at } = {}) {
      return loadBoardInputs({ cwd, client, now: typeof at === 'function' ? at : now, offline, ...(waitMs === undefined ? {} : { waitMs }) });
    },
    async usage() {
      return { figures: usageFigures({ project, now }), week: weeklyShare({ now }) };
    },
    async stop() {
      return stopState();
    },
    // An approval card's preview address, or null.
    async preview(cardId) {
      const card = (localViews(project, ['waiting'])?.waiting ?? []).find((c) => c?.id === cardId);
      const found = APPROVAL_LINE.exec(String(card?.data?.line));
      if (found === null) return null;
      return previewFor({ project, pr: Number(found[1]), sha: found[2], client, now });
    },
  };
}
