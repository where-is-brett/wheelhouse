// scripts/foreman/desktop-findings.js
// What part 0's Desktop probe found, in one place (builders and settings design, sections 7.3 and 7.4). The probe note,
// docs/specs/notes/2026-11-24-desktop-probe.md, is not written yet, so these hold the cautious reading of each point: no `cwd`
// on an offer (the builder's own session start records the worktree Desktop made) and no nesting (a builder's title carries
// the project). When the note lands, only the two values in DESKTOP_FINDINGS change: `cwdOnOffer` to true if an offer accepted
// `cwd`, and `nesting.how` to the name of the `start_session` option that nested a session under the foreman.
export const DESKTOP_FINDINGS = Object.freeze({
  cwdOnOffer: false,
  nesting: Object.freeze({ how: null }),
});

const OPTION_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

// The findings in force. `over` is for tests; an option name that isn't a plain name reads as no nesting.
export function desktopFindings(over = {}) {
  const cwdOnOffer = typeof over.cwdOnOffer === 'boolean' ? over.cwdOnOffer : DESKTOP_FINDINGS.cwdOnOffer;
  const given = over.nesting !== undefined ? over.nesting?.how : DESKTOP_FINDINGS.nesting.how;
  return { cwdOnOffer, nesting: { how: typeof given === 'string' && OPTION_NAME.test(given) ? given : null } };
}
