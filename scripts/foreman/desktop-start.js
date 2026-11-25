// scripts/foreman/desktop-start.js
// A builder's title and prompt on the Desktop route (builders and settings design, sections 7.3 and 7.4), built from the
// record and never from a wake file. The foreman passes them to `start_session` with `initiation: offer`, fresh context,
// worktree on, Auto, `wake_when_done`, and the nesting option when the probe found one (scripts/foreman/desktop-findings.js).
import { BUILDER_PROMPT_LEAD } from './prompt-lead.js';
import { desktopFindings } from './desktop-findings.js';

// The one marker line after the lead: the builder's own hook reads the project and piece from it.
export const MARKER_LEAD = 'Wheelhouse piece:';
const PROJECT = /^[A-Za-z0-9._-]{1,100}$/;
const WORK = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_TITLE = 59;
const ELLIPSIS = '…';

export const markerLine = (project, work) => `${MARKER_LEAD} ${project} ${work}`;

// `{ project, work }` from the second line of a prompt that begins with the builder lead, or null. Nothing else counts.
export function markerOf(prompt) {
  if (typeof prompt !== 'string' || !prompt.startsWith(BUILDER_PROMPT_LEAD)) return null;
  const line = prompt.split('\n')[1];
  const m = typeof line === 'string' ? new RegExp(`^${MARKER_LEAD} (\\S+) (\\S+)$`).exec(line.replace(/\r$/, '')) : null;
  return m !== null && PROJECT.test(m[1]) && WORK.test(m[2]) ? { project: m[1], work: m[2] } : null;
}

// "Wheelhouse · <piece title>" where Desktop nests builders under the foreman, else "Wheelhouse · <project> · <piece title>".
// Under 60 characters: the piece's title is shortened first, and the project only if it alone is too long.
export function builderTitle({ project, title, nested }) {
  const prefix = nested ? 'Wheelhouse · ' : `Wheelhouse · ${project.length > 30 ? `${project.slice(0, 29)}${ELLIPSIS}` : project} · `;
  const room = MAX_TITLE - prefix.length;
  const piece = String(title ?? '').replace(/\s+/g, ' ').trim();
  const shown = piece.length <= room ? piece : `${piece.slice(0, Math.max(0, room - 1)).trimEnd()}${ELLIPSIS}`;
  return `${prefix}${shown}`.trimEnd();
}

// What the foreman gives `start_session` for a piece. `brief` is the feature brief's text from the record; `worktree` is
// Wheelhouse's own, passed as `cwd` only where the probe showed an offer accepts one.
export function builderStart({ project, work, title, brief, findings = desktopFindings(), foremanSessionId, worktree, resume = false }) {
  if (typeof project !== 'string' || !PROJECT.test(project)) throw new Error('The project is letters, digits, dots, hyphens and underscores');
  if (typeof work !== 'string' || !WORK.test(work)) throw new Error('The work id is lower-case letters, digits and hyphens');
  const how = findings.nesting.how;
  const nested = how !== null;
  // A resume is a fresh session in the piece's own worktree after Desktop closed on the one before (design section 7.5): it reads
  // the record and carries on, and Desktop makes no worktree for it.
  const said = resume
    ? `you are resuming the session for ${work}: Desktop closed and your first session ended. Read your brief and the record, then carry on from where it left off. Your brief follows.`
    : `you are the session for ${work}, and your brief follows.`;
  const prompt = `${BUILDER_PROMPT_LEAD} ${said}\n${markerLine(project, work)}\n\n${brief}`;
  return {
    title: builderTitle({ project, title, nested }),
    prompt,
    initiation: 'offer',
    freshContext: true,
    worktree: !resume,
    permissionMode: 'auto',
    wakeWhenDone: true,
    ...(nested && typeof foremanSessionId === 'string' ? { nest: { [how]: foremanSessionId } } : {}),
    ...((resume || findings.cwdOnOffer) && typeof worktree === 'string' ? { cwd: worktree } : {}),
  };
}
