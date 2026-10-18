// scripts/state/git.js
import { run, withoutGitVars } from '../lib/run.js';

// Every git call for the state and lock clones goes through here: no shell, a
// fixed author so the director's own name and address never reach the branch,
// no prompting, replace refs ignored, and no GIT_* variable inherited from
// whatever started this process. `env`, when given (the helper passes the
// connection's), is added on top; these clones are Wheelhouse's own, under
// ~/.wheelhouse/, so a key may travel there.
export function git(dir, args, env = {}) {
  return run('git', ['-c', 'user.name=Wheelhouse', '-c', 'user.email=wheelhouse@invalid', ...args], {
    cwd: dir,
    baseEnv: withoutGitVars(),
    timeoutMs: 5 * 60 * 1000, // a hung remote reads as a failure, not a wait without end
    env: { GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1', ...env },
  });
}
