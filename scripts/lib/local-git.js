// scripts/lib/local-git.js
// What a project's own commands run in on this computer, shared by a Lean project's merge and the check runner.
import path from 'node:path';
import { AGENT_VARIABLES } from '../agents/variables.js';

// Wheelhouse's own variables, the code hosts', the coding agents' and the SSH agent's are cleared from the tests'
// environment.
// The person's SSH agent and password prompt too, so the approved code's tests can't push with their keys.
const CLEARED = /^(?:WHEELHOUSE_|GIT_|GH_|GITHUB_|GITLAB_|GLAB_)|^(?:CI_JOB_TOKEN|SSH_AUTH_SOCK|SSH_ASKPASS)$/i;
export function testEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !CLEARED.test(name) && !AGENT_VARIABLES.test(name)));
}

// The command line the tests run by: the system's own shell.
export function shellFor(command, { platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') {
    const root = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows';
    return { file: path.win32.join(root, 'System32', 'cmd.exe'), args: ['/d', '/s', '/c', `"${command}"`], windowsVerbatimArguments: true };
  }
  return { file: '/bin/sh', args: ['-c', command], windowsVerbatimArguments: false };
}
