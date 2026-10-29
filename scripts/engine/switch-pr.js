// scripts/engine/switch-pr.js
// The switch's pull request for a project set up before v0.2.0 (Archon design, sections 14.3 and 17, step 2; part 3f):
// one commit the helper makes in its own mirror, on top of the default branch, adding the merge queue's policy file,
// naming the login the helper posts its review verdicts as, and Archon's project settings, with the very texts a new
// setup commits. The helper's gate checks a pull request on the switch's branch against those texts: one that changes
// exactly those two files, to exactly those texts, was written by the helper itself, so it has no review and no
// provenance to check. It still needs CI, the lock and the director's approval (`.archon/**` is a guardrail).
import { ENGINE_FILES, POLICY_FILE, ARCHON_CONFIG_FILE, maintainersText, archonConfigText } from '../setup/engine-parts.js';
import { SWITCH_BRANCH } from './switch.js';

const LOGIN = /^[A-Za-z0-9-]{1,39}$/;

export const SWITCH_TITLE = 'Add the build engine\'s files';
export const switchBody = (login) => [
  'This adds the files the new build engine, Archon, needs to build this project:',
  '',
  `- \`${POLICY_FILE}\`, the merge queue's policy, naming ${login}, the GitHub account Wheelhouse signs its reviews as;`,
  `- \`${ARCHON_CONFIG_FILE}\`, Archon's settings for this project, which put its worktrees under \`.wheelhouse/\`.`,
  '',
  'The director chose the switch on its card. Wheelhouse wrote this change itself, and merges it once the director approves it. From then on, new quick changes are built by the new engine.',
].join('\n');

// The texts the switch's commit holds, for `login`, or null for a login that isn't a plain GitHub login.
export function switchTexts(login) {
  if (typeof login !== 'string' || !LOGIN.test(login)) return null;
  return { [POLICY_FILE]: maintainersText([login]), [ARCHON_CONFIG_FILE]: archonConfigText() };
}

// switchChange({ headRef, paths, files }) -> { matched: false } | { matched: true, ok, login?, why? }
// Whether a pull request is the switch's own: on the switch's branch, changing only the two engine files, each new
// (absent on the base) and a plain file, holding the texts switchTexts gives for the one login the policy names.
// `files` is the merge gate's read of each file, { base, head, headMode }.
export function switchChange({ headRef, paths, files }) {
  if (typeof headRef !== 'string' || !SWITCH_BRANCH.test(headRef)) return { matched: false };
  const no = (why) => ({ matched: true, ok: false, why });
  const changed = Array.isArray(paths) ? [...paths].sort() : [];
  if (changed.length !== ENGINE_FILES.length || ![...ENGINE_FILES].sort().every((f, i) => changed[i] === f)) {
    return no('it changes more than the build engine\'s two files');
  }
  let names;
  try { names = JSON.parse(files?.[POLICY_FILE]?.head ?? 'null'); } catch { names = null; }
  const login = Array.isArray(names) && names.length === 1 ? names[0] : null;
  const texts = switchTexts(login);
  if (texts === null) return no('its policy doesn\'t name one GitHub login');
  for (const file of ENGINE_FILES) {
    const read = files?.[file];
    if (read?.base !== null || read?.headMode !== '100644' || read?.head !== texts[file]) return no(`${file} isn't the text Wheelhouse writes`);
  }
  return { matched: true, ok: true, login };
}
