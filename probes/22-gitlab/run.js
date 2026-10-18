// probes/22-gitlab/run.js
// Checks 22 and 23: the live trial on a GitLab test project the director
// chooses. Usage: node run.js <group/project> [--host https://gitlab.example.com] [--scratch] [--maintainer] [--yes]
//
// Without --yes it only prints what it would make and remove. With --yes it:
//   1. reads glab's existing sign-in (held in memory only);
//   2. makes a one-day project key (Developer, or Maintainer with --maintainer;
//      api + write_repository);
//   3. with that key, pushes a branch, opens and closes a merge request;
//   4. reads the default branch's protection (with the director's sign-in);
//   5. only with --scratch (a project that is only for testing): switches the
//      protection on, tries a direct push to the default branch (only once push
//      access reads exactly "No one"; a commit that lands is reverted), tries to
//      unprotect with the project key, and puts the protection back;
//   6. revokes the key and checks it no longer works.
// Keys are never printed, logged or passed as a process argument: git gets
// the key through its environment. Output passes through scrub().
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { appendJsonl, probeLogDir } from '../lib/log.js';
import { gitlabApi, makeProjectKey, projectPath } from '../../scripts/host/gitlab-key.js';
import { readGitlabProtection, protectGitlabBranch } from '../../scripts/host/protection.js';

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const hostAt = args.indexOf('--host');
const baseUrl = hostAt >= 0 ? args[hostAt + 1] : 'https://gitlab.com';
const project = args.find((one, at) => !one.startsWith('--') && (hostAt < 0 || at !== hostAt + 1));
if (!project || !project.includes('/')) {
  console.error('Usage: node run.js <group/project> [--host https://gitlab.example.com] [--scratch] [--maintainer] [--yes]');
  process.exit(2);
}
// The key is a Developer's unless --maintainer is given (to compare the two).
const keyLevel = flag('--maintainer') ? 40 : 30;
const tag = crypto.randomBytes(3).toString('hex');
const branch = `wheelhouse-check-22-${tag}`;
const logFile = path.join(probeLogDir('22-gitlab', os.homedir()), 'trials.jsonl');
const secrets = new Set();
const hold = (key) => { if (key) secrets.add(key); return key; };

function scrub(text) {
  let clean = String(text);
  for (const secret of secrets) clean = clean.replaceAll(secret, '[key]');
  return clean;
}

async function trial(what, expected, run) {
  let result;
  try {
    result = scrub(await run());
  } catch (error) {
    result = scrub(`error: ${error.message}`);
  }
  console.log(`${what} | expected: ${expected} | result: ${result}`);
  await appendJsonl(logFile, { what, expected, result });
  return result;
}

if (!flag('--yes')) {
  console.log(`Would use ${baseUrl}, project ${project}. It would make: a one-day project key (${keyLevel === 40 ? 'Maintainer' : 'Developer'}), a branch ${branch}, a merge request.`);
  console.log(`It would remove all three${flag('--scratch') ? ', and leave the default branch protected (scratch project)' : ''}. Run again with --yes after the director agrees.`);
  process.exit(0);
}

// 1. glab's existing sign-in. The token is on the "Token found:" line of its
// status output (stderr), which reads "Token found in operating system
// keyring:" when glab keeps it in the keyring, or is a glpat- value. A run of
// asterisks is glab hiding the token, not the token.
const host = new URL(baseUrl).host;
let status = '';
try {
  const out = await execFileAsync('glab', ['auth', 'status', '--hostname', host, '--show-token']);
  status = `${out.stdout}\n${out.stderr}`;
} catch (error) {
  status = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
}
const shown = /^[ \t]*\S*[ \t]*Token found\b[^:\n]*:[ \t]*(\S+)/im.exec(status)?.[1];
const signIn = hold((shown && !/^\*+$/.test(shown) ? shown : undefined) ?? /\bglpat-[\w-]+/.exec(status)?.[0]);
if (!signIn) {
  console.error('glab is not signed in to that host (or not installed). Sign in with glab first.');
  process.exit(1);
}
const mine = gitlabApi({ baseUrl, token: signIn, bearer: true });

const found = await mine.get(projectPath(project));
if (found.status !== 200) {
  console.error(`Could not read the project (HTTP ${found.status}).`);
  process.exit(1);
}
const projectId = found.body.id;
const defaultBranch = found.body.default_branch ?? 'main';
console.log(`Project ${found.body.path_with_namespace}, default branch ${defaultBranch}`);

// 2. The project key.
let key;
await trial('make a one-day project key', 'created (Premium or Ultimate on GitLab.com; any licence on self-managed)', async () => {
  key = await makeProjectKey({ api: mine, projectId, name: `wheelhouse-check-22-${tag}`, days: 1 });
  hold(key.token);
  return `created, id ${key.id}, expires ${key.expiresAt}`;
});
if (!key) process.exit(1);
const withKey = gitlabApi({ baseUrl, token: key.token });

// 3 and 4. Git over HTTPS with the key, through git's environment.
const basic = Buffer.from(`wheelhouse:${key.token}`).toString('base64');
hold(basic);
const gitEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'http.extraHeader',
  GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
};
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-check-22-'));
const git = async (...gitArgs) => {
  try {
    const out = await execFileAsync('git', gitArgs, { cwd: scratch, env: gitEnv });
    return `ok ${out.stdout}${out.stderr}`.trim();
  } catch (error) {
    return `refused ${error.stderr ?? error.message}`.trim();
  }
};
let mergeRequest;
let directSha;
let landed = false;
try {
  const url = `${baseUrl.replace(/\/+$/, '')}/${project}.git`;
  const cloned = await git('clone', '--depth', '1', url, 'repo');
  await trial('clone with the project key', 'ok', async () => cloned.split('\n')[0]);
  const repo = path.join(scratch, 'repo');
  const inRepo = (...gitArgs) => git('-C', repo, ...gitArgs);
  await inRepo('config', 'user.email', 'check-22@example.invalid');
  await inRepo('config', 'user.name', 'Wheelhouse check 22');
  await inRepo('checkout', '-b', branch);
  fs.writeFileSync(path.join(repo, `check-22-${tag}.txt`), 'check 22\n');
  await inRepo('add', '.');
  await inRepo('commit', '-m', `Check 22 ${tag}`);
  await trial('push a branch with the project key', 'ok', async () => (await inRepo('push', 'origin', branch)).split('\n')[0]);
  await trial('open a merge request', 'created', async () => {
    const made = await withKey.post(`${projectPath(projectId)}/merge_requests`, { source_branch: branch, target_branch: defaultBranch, title: `Check 22 ${tag}` });
    mergeRequest = made.body?.iid;
    return made.status === 201 ? `opened !${mergeRequest}` : `HTTP ${made.status}`;
  });
  await trial('close the merge request', 'closed', async () => {
    if (!mergeRequest) return 'skipped';
    const closed = await withKey.put(`${projectPath(projectId)}/merge_requests/${mergeRequest}`, { state_event: 'close' });
    return closed.status === 200 ? 'closed' : `HTTP ${closed.status}`;
  });
  await inRepo('checkout', defaultBranch);
  fs.writeFileSync(path.join(repo, `check-22-${tag}-direct.txt`), 'direct\n');
  await inRepo('add', '.');
  await inRepo('commit', '-m', `Check 22 ${tag} direct`);

  // 5. Protection. Setup uses the director's own sign-in for this, so `mine`
  // reads and switches it on; the project key only tries what an agent would.
  const reading = () => readGitlabProtection({ api: mine, projectId, branch: defaultBranch });
  await trial('read the default branch protection', 'a reading', async () => JSON.stringify(await reading()));
  if (flag('--scratch')) {
    await trial('switch the protection on with the director\'s sign-in', 'done', async () => {
      await protectGitlabBranch({ api: mine, projectId, branch: defaultBranch });
      return JSON.stringify(await reading());
    });
  }
  // A direct push is tried only on a scratch project, and only once the read
  // shows push access is exactly "No one": otherwise it could land a commit.
  const now = await reading().catch(() => null);
  const closed = flag('--scratch') && now?.pushAccess?.length === 1 && now.pushAccess[0] === 'No one';
  await trial('push directly to the default branch with the project key', 'refused', async () => {
    if (!closed) return 'skipped, not protected to no one';
    directSha = (await inRepo('rev-parse', 'HEAD')).replace(/^ok /, '').trim();
    const pushed = await inRepo('push', 'origin', `HEAD:${defaultBranch}`);
    if (pushed.startsWith('ok')) {
      landed = true;
      return 'UNEXPECTED: the push was accepted; it is reverted in the clean-up';
    }
    return pushed.split('\n')[0];
  });
  if (flag('--scratch')) {
    await trial('unprotect the default branch with the project key', keyLevel === 40 ? 'allowed (a Maintainer may unprotect)' : 'refused (a Developer may not)', async () => {
      const removed = await withKey.delete(`${projectPath(projectId)}/protected_branches/${encodeURIComponent(defaultBranch)}`);
      return `HTTP ${removed.status}`;
    });
    await trial('put the protection back with the director\'s sign-in', 'done', async () => {
      await protectGitlabBranch({ api: mine, projectId, branch: defaultBranch });
      return JSON.stringify(await reading());
    });
  }
} finally {
  // 6. Clean up: a direct commit that unexpectedly landed, the test branch, the
  // key, and the scratch folder.
  if (landed) {
    await trial('revert the commit that landed on the default branch', 'reverted', async () => {
      const unprotected = await mine.delete(`${projectPath(projectId)}/protected_branches/${encodeURIComponent(defaultBranch)}`);
      const reverted = await mine.post(`${projectPath(projectId)}/repository/commits/${directSha}/revert`, { branch: defaultBranch });
      await protectGitlabBranch({ api: mine, projectId, branch: defaultBranch });
      return `unprotect HTTP ${unprotected.status}, revert HTTP ${reverted.status}, protection put back`;
    });
  }
  // On a scratch project the protection is left on. If the put-back or the
  // revert failed or threw, try once more here and say what happened.
  if (flag('--scratch')) {
    await trial('check the protection is left on, and switch it on again if not', 'push access: No one', async () => {
      let reading = await readGitlabProtection({ api: mine, projectId, branch: defaultBranch }).catch(() => null);
      if (reading?.pushAccess?.length === 1 && reading.pushAccess[0] === 'No one') return `already on: ${JSON.stringify(reading)}`;
      await protectGitlabBranch({ api: mine, projectId, branch: defaultBranch });
      reading = await readGitlabProtection({ api: mine, projectId, branch: defaultBranch });
      return `switched on again: ${JSON.stringify(reading)}`;
    });
  }
  await mine.delete(`${projectPath(projectId)}/repository/branches/${encodeURIComponent(branch)}`).catch(() => {});
  await trial('revoke the project key', 'HTTP 204', async () => `HTTP ${(await mine.delete(`${projectPath(projectId)}/access_tokens/${key.id}`)).status}`);
  await trial('the revoked key no longer works', 'HTTP 401', async () => `HTTP ${(await withKey.get(projectPath(projectId))).status}`);
  fs.rmSync(scratch, { recursive: true, force: true });
}
