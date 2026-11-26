// scripts/foreman/desktop-findings.js
// What part 0's Desktop probe found, in one place (builders and settings design, sections 7.3 and 7.4), as its note,
// docs/specs/notes/2026-11-24-desktop-probe.md, records it. An offer takes no `cwd` (the builder opens in the foreman's own
// folder, and the builder's own session start records the worktree Desktop made). Desktop nested every session the probe
// started under the session that started it by itself: `start_session` has no option for it, so there is no option name for
// `nesting.how` to hold and it stays null. Quitting and reopening Desktop was not tried, so `quitAndReopen` keeps its default:
// a builder is woken by `send_message` first and started afresh in its own worktree if that fails.
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
