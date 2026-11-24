// scripts/lib/route.js
// How this computer starts builder sessions (builders and settings design, section 6): the one reader of the `builders:` and
// `builderLaunch:` settings. The waker (every tick), the helper's foreman run, health and the First Mate's facts all ask here.
//
// A route is never guessed outside setup: no saved route is `route: null`, which starts nothing and states "Builders: not
// chosen". A saved value that can't be read or isn't a route is `from: 'fault'`, naming the file or the value, never skipped.
import { computerId } from './paths.js';
import { checkLaunch } from './launch-words.js';
import { faultLine } from './read-json-named.js';
import { GATE_LINE, gateFor } from './sign-in-line.js';
import { profileViewsFault, readProfileViews } from '../profile/store.js';

export const ROUTES = Object.freeze(['desktop', 'background']);

// `{ route: 'desktop' | 'background' | null, launch?, from: 'profile' | 'unset' | 'fault', fault?, signIn }`.
//   agent     the coding agent's name (the sign-in gate's facts are kept by agent and route)
//   computer  this computer's id
//   home      Wheelhouse's home, where the sign-in gate's fact file is
//   routes    the routes the agent's adapter supports (`sessions.routes`); a saved route it doesn't support runs on its first
// `signIn` is the gate's answer for the route that results; a launch command that fails its check counts as unable to sign in.
// `readViews`, `fault`, `check` and `platform` are for tests.
export function builderRoute({
  agent = 'claude-code', computer = computerId(), home, routes = ROUTES,
  readViews = readProfileViews, fault = profileViewsFault, check = checkLaunch, platform = process.platform,
} = {}) {
  const views = readViews();
  if (views === null) {
    const broken = fault();
    if (broken !== null && broken !== undefined) {
      const named = { file: broken.file, line: broken.line, column: broken.column, hint: broken.hint };
      return { route: null, from: 'fault', fault: named, signIn: { open: false, reason: `${GATE_LINE}: ${faultLine(named)}` } };
    }
    return { route: null, from: 'unset', signIn: { open: true } };
  }
  const key = `builders:${computer}`;
  const entry = views.settings?.[key];
  const saved = entry === undefined || entry === null ? null : entry.value;
  if (saved === null || saved === undefined) return { route: null, from: 'unset', signIn: { open: true } };
  if (!ROUTES.includes(saved)) {
    const hint = `the saved value for ${key} isn't "desktop" or "background"`;
    return { route: null, from: 'fault', fault: { file: key, line: null, column: null, hint }, signIn: { open: false, reason: `${GATE_LINE}: ${hint}` } };
  }
  const supported = ROUTES.filter((r) => routes.includes(r));
  const route = supported.includes(saved) ? saved : supported[0] ?? null;
  if (route === null) return { route: null, from: 'unset', signIn: { open: true } };
  if (route === 'desktop') return { route, from: 'profile', signIn: { open: true } };
  const words = views.settings?.[`builderLaunch:${computer}`]?.value ?? null;
  if (words !== null) {
    const checked = check(words, { platform });
    if (!checked.ok) {
      const hint = `The launch command saved for this computer can't be used: ${checked.why}`;
      return { route, from: 'fault', fault: { file: `builderLaunch:${computer}`, line: null, column: null, hint }, signIn: { open: false, reason: `${GATE_LINE}: ${hint}` } };
    }
  }
  return { route, ...(words === null ? {} : { launch: words }), from: 'profile', signIn: home === undefined ? { open: true } : gateFor(home, `${agent}:${route}`) };
}
