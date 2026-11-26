// scripts/foreman/desktop-findings.js
// What part 0's Desktop probe found, in one place (builders and settings design, sections 7.3 and 7.4). The probe note,
// docs/specs/notes/2026-11-24-desktop-probe.md, is not written yet, so these hold the cautious reading of each point: no `cwd`
// on an offer (the builder's own session start records the worktree Desktop made) and no nesting (a builder's title carries
// the project) and, when Desktop quits and reopens, a builder is woken by `send_message` first and started afresh in its own
// worktree if that fails. When the note lands, only the three values in DESKTOP_FINDINGS change: `cwdOnOffer` to true if an
// offer accepted `cwd`, `nesting.how` to the name of the `start_session` option that nested a session under the foreman, and
// `quitAndReopen` to what the probe saw of a builder's row after Desktop quit and reopened.
export const DESKTOP_FINDINGS = Object.freeze({
  cwdOnOffer: false,
  nesting: Object.freeze({ how: null }),
  quitAndReopen: 'message-then-fresh-start',
});

// What a builder's session does when Desktop quits and reopens: 'message-then-fresh-start' (wake it by `send_message`; if that
// fails, start it afresh in the same worktree with the resume brief), 'rows-return' (the row comes back, so a message is the
// whole of it) or 'rows-lost' (the row does not come back, so a fresh start is the whole of it).
export const QUIT_AND_REOPEN = Object.freeze(['message-then-fresh-start', 'rows-return', 'rows-lost']);

const OPTION_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

// The findings in force. `over` is for tests; an option name that isn't a plain name reads as no nesting.
export function desktopFindings(over = {}) {
  const cwdOnOffer = typeof over.cwdOnOffer === 'boolean' ? over.cwdOnOffer : DESKTOP_FINDINGS.cwdOnOffer;
  const given = over.nesting !== undefined ? over.nesting?.how : DESKTOP_FINDINGS.nesting.how;
  const quit = QUIT_AND_REOPEN.includes(over.quitAndReopen) ? over.quitAndReopen : DESKTOP_FINDINGS.quitAndReopen;
  return { cwdOnOffer, nesting: { how: typeof given === 'string' && OPTION_NAME.test(given) ? given : null }, quitAndReopen: quit };
}
