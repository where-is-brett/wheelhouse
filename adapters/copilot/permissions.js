// adapters/copilot/permissions.js
// Each level's permission rules for a background Copilot session, in Copilot's own rule syntax, and which level may
// run (design sections 6.4 and 8.4; checks 61 and 63; rulings P7-9, P7-10, P7-11 and P7-27). The rules are passed on
// the session's command line (`--allow-tool=` and `--deny-tool=`, adapters/copilot/sessions.js), never written into
// settings, and no level is ever widened by an allow-everything flag (ruling P7-3).
//
// What the rules hold, and what they can't say:
// - Copilot's rule kinds are `shell(..)`, `write(..)`, `url(..)` and a tool's or MCP server's name (check 61). A deny
//   beats every allow, so every level passes the same denies, Unattended too.
// - Shell rules match the whole command: no chained form check 61 tried (`&&`, `$( )`, `sh -c`) got past
//   `shell(<runner>:*)`, so Guarded and Ask use prefix rules with the runner and the guard behind them. The evidence
//   is one model with `echo` as the runner, so the guard stays in place.
// - A rule list is not a read barrier: a read-only command (`ls`) ran with no rule (check 61). Copilot has no read
//   kind, so credentialRules()' read denials have no form here: reads stay with the tool guard and, from Part 9, the
//   sandbox (spec 6.6 point 4). The denies below are writes only.
// - The file tools are held to the worktree by the session's working folder and `--disallow-temp-dir` (sessions.js):
//   only the read side was shown to hold, through a link too (check 61). Writes through a link are untried, so the
//   path rules are not relied on to hold writes; the guard checks the real path.
// - Whether Copilot accepts `write(<glob>)`, `url(..)`, `~/` and the loop's tool names, and whether a `write(..)` deny
//   fires, is the first real run's (preflight section 5, T2): an unsupported form might make Copilot refuse to start,
//   which that run finds before any project relies on it.
import path from 'node:path';
import { hostApprovalReady } from '../../scripts/host/approval-ready.js';
import { AGENT_CONTROL, homeControlPaths } from '../../scripts/lib/agent-control.js';
import { LEVELS } from '../../scripts/lib/copilot-numbers.js';
import { credentialPaths } from '../../scripts/lib/credentials.js';
import { isBuildCommand } from '../../scripts/gate/guardrails.js';
import { cleanDomain } from '../../scripts/protection/settings.js';

// The loop's tools, allowed by name at every level, because a tool no rule allows is refused at once headless
// (check 61) and the kits' loops call them (check 63). Copilot's `apply_patch` is held by the `write` kind, which is
// allowed beside them (check 61's path runs).
export const LOOP_TOOLS = Object.freeze(['task', 'skill', 'sql', 'read_agent']);

// Commands no level runs: the hosts' tools and git's ways to the person's sign-ins and the host, the keychain's tool,
// and a copilot of the session's own, which could be started with every permission (P7-27).
const SHELL_DENIES = Object.freeze(['shell(gh:*)', 'shell(glab:*)', 'shell(git credential:*)', 'shell(git push:*)', 'shell(security:*)', 'shell(copilot:*)']);
// Tools no level uses: Copilot still registers a checkout's language servers from `.github/lsp.json` when the folder
// isn't trusted (check 66).
const TOOL_DENIES = Object.freeze(['lsp']);

const unique = (list) => [...new Set(list)];
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
// A rule must be one plain argument (sessions.js refuses anything else).
const fitsRule = (text) => typeof text === 'string' && text !== '' && text.length <= 480 && !/[\u0000-\u001f\u007f]/.test(text);

// The commands the grants give, each one a build command a rule can hold; a grant is `run` (one start) or `feature`
// (the feature's life), as buildGrants gives them (scripts/protection/windows-builds.js). Which grants are still in
// force is buildGrants' and the waker's record of run grants used: a run grant given to one start is not passed to
// the next (ruling P7-10).
function grantedCommands(grants) {
  if (!Array.isArray(grants)) return [];
  return grants
    .filter((g) => isPlain(g) && (g.scope === 'run' || g.scope === 'feature') && Array.isArray(g.commands))
    .flatMap((g) => g.commands)
    .filter(isBuildCommand);
}

// The denies every level passes: the files that steer an agent, in the project (as the gate writes them, from the
// session's working folder, its worktree) and in the home folder, every system's credential paths in the file and the
// folder form, and the commands and tools above. The same list at every level.
function denies() {
  return unique([
    ...AGENT_CONTROL.map((p) => `write(${p})`),
    ...homeControlPaths().flatMap((f) => [`write(~/${f})`, `write(~/${f}/**)`]),
    ...unique(['darwin', 'linux', 'win32'].flatMap((p) => credentialPaths(p))).flatMap((c) => [`write(~/${c})`, `write(~/${c}/**)`]),
    ...SHELL_DENIES,
    ...TOOL_DENIES,
  ]);
}

// The rules are made for a session whose working folder is its worktree: the project's patterns are read from there,
// and Copilot holds the file tools to it (check 61). Without a whole path to one, no rules are made.
function checkWorktree(worktree, platform) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (!fitsRule(worktree) || !paths.isAbsolute(worktree)) throw new Error("A builder's rules are made for its worktree, and no whole path to one was given");
}

// The rules for a session at `level`, as `{ allow, deny }`. At `sandbox` the shell is allowed (the sandbox holds it);
// at `guarded` only the runner (`guardedCommand`, scripts/windows/low.js, on Windows, Guarded's one system) and the
// granted commands, since a command the runner refuses still asks; at `ask` only the granted commands; at
// `unattended` the shell. A level Wheelhouse doesn't know is `ask`. Every level allows `write` and the loop's tools,
// and the web only to the project's domains (`url(<d>)` for each cleanDomain).
export function levelRules({ level, grants = [], runner = null, worktree, domains = [], platform = process.platform } = {}) {
  checkWorktree(worktree, platform);
  const at = LEVELS.includes(level) ? level : 'ask';
  const granted = grantedCommands(grants).map((c) => `shell(${c}:*)`);
  let shell;
  if (at === 'sandbox' || at === 'unattended') shell = ['shell'];
  else if (at === 'guarded') shell = [...(platform === 'win32' && fitsRule(runner) ? [`shell(${runner}:*)`] : []), ...granted];
  else shell = granted;
  const web = (Array.isArray(domains) ? domains : []).map(cleanDomain).filter((d) => d !== null).map((d) => `url(${d})`);
  return { allow: unique(['write', ...LOOP_TOOLS, ...shell, ...web]), deny: denies() };
}

const ASKS = 'so builders ask you before each build command';

// Whether `level` may run, as `{ ok, level, why }`: `level` is the one that runs, `why` says in plain words why it
// isn't the one asked for (null when it is). Ask always runs. The sandbox has no test on this computer until Part 9
// Task 1, so it runs as Ask. Unattended never runs for a project with real users (`realUsers` must be false), and
// only after its own card (`unattendedConfirmed`). Until the host's approval is ready (`hostApproval`, from
// hostApprovalReady, Part 9 Task 5), Guarded runs only where its self-test showed builds can't read the keys
// (`keysUnreadable`, the self-test's `keysReadHeld`). Anything not plainly so is taken as not so: the answer is Ask.
export function levelAllowed({ level, realUsers = true, keysUnreadable = false, hostApproval = hostApprovalReady(), unattendedConfirmed = false } = {}) {
  const ask = (why) => ({ ok: false, level: 'ask', why });
  if (!LEVELS.includes(level)) return ask(`That isn't a level Wheelhouse knows, ${ASKS}`);
  if (level === 'sandbox') return ask(`Copilot's sandbox hasn't been tested on this computer, ${ASKS}`);
  if (level === 'unattended') {
    if (realUsers !== false) return ask(`Unattended is never used for a project with real users, ${ASKS}`);
    if (unattendedConfirmed !== true) return ask(`Unattended needs your click on its own card, ${ASKS}`);
  }
  if (level === 'guarded' && hostApproval !== true && keysUnreadable !== true) {
    return ask(`Guarded's self-test didn't show that builds on this computer can't read the helper's keys, ${ASKS}`);
  }
  return { ok: true, level, why: null };
}
