// scripts/host/adapter.js
// The only place `gh` and `glab` are called (design section 11). makeAdapter
// returns the same methods for GitHub and GitLab; each builds one command line,
// runs it through the injected `run` with the adapter's `env` (which is where a
// key travels, never in an argument), and parses the answer. Arguments are
// checked here, before anything runs; github.js and gitlab.js hold the command
// lines and the mappings.
import { githubCommands } from './github.js';
import { gitlabCommands } from './gitlab.js';

const HOSTS = { github: githubCommands, gitlab: gitlabCommands };

// Text in a CLI's error output that could be a key: known key prefixes, an
// Authorization header's value, and anything set as `token=...`.
const KEY_LIKE = [
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g,
  /\bgl[a-z]{1,6}-[A-Za-z0-9_\-.]{8,}/g,
  /\b(Bearer|Basic|token)\s+[A-Za-z0-9_\-.=+/]+/gi,
  /\b([A-Za-z_]*(?:token|secret|password)[A-Za-z_]*\s*[=:]\s*)\S+/gi,
];
const MOST_SHOWN = 500;

// The address, and the number at its end, of the pull request, merge request or
// issue a CLI printed after making or changing it.
function fromAddress(stdout, pattern) {
  const match = pattern.exec(String(stdout));
  if (!match) throw new Error('The host answered, but without the web address of what it made or changed');
  return { number: Number(match[2]), url: match[1] };
}

// Removes anything key-like, and every value of the adapter's environment, from
// a CLI's output before it goes into an error or a refusal.
export function scrub(text, env = {}) {
  let out = String(text ?? '');
  for (const value of Object.values(env ?? {})) {
    if (typeof value === 'string' && value.length >= 8) out = out.split(value).join('[hidden]');
  }
  out = out
    .replace(KEY_LIKE[0], '[hidden]')
    .replace(KEY_LIKE[1], '[hidden]')
    .replace(KEY_LIKE[2], '$1 [hidden]')
    .replace(KEY_LIKE[3], '$1[hidden]')
    .replace(/\s+/g, ' ')
    .trim();
  return out.length > MOST_SHOWN ? `${out.slice(0, MOST_SHOWN)}...` : out;
}

function hostOf(remoteUrl) {
  const text = String(remoteUrl ?? '').trim();
  const scp = /^[^@/\s]+@([^:/\s]+):/.exec(text); // git@host:owner/name.git
  if (scp) return scp[1].toLowerCase();
  try {
    const url = new URL(text);
    if (url.hostname) return url.hostname.toLowerCase();
  } catch { /* not a URL */ }
  throw new Error('That is not a repository address this can read');
}

// 'github' for github.com; 'gitlab' for gitlab.com, or for another address when
// the project setting `gitlabHosts` names it.
export function detectHost(remoteUrl, { gitlabHosts = [] } = {}) {
  const host = hostOf(remoteUrl);
  if (host === 'github.com') return 'github';
  if (host === 'gitlab.com') return 'gitlab';
  if (gitlabHosts.map((h) => String(h).toLowerCase()).includes(host)) return 'gitlab';
  throw new Error(`The repository is at ${host}, which is not GitHub or GitLab. If it is a GitLab address, name it in the project settings`);
}

const REPO = /^[A-Za-z0-9_.][A-Za-z0-9_.-]*(\/[A-Za-z0-9_.][A-Za-z0-9_.-]*)+$/;
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function wholeNumber(n) {
  if (!Number.isInteger(n) || n < 1) throw new Error('The number must be a whole number from 1');
  return n;
}
function commit(sha) {
  if (typeof sha !== 'string' || !SHA.test(sha)) throw new Error('The commit must be a full commit ID');
  return sha;
}
function text(value, what, { optional = false, empty = false } = {}) {
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'string' || (!empty && value.trim() === '')) throw new Error(`The ${what} must be text`);
  return value;
}

export function makeAdapter({ host, repo, run, env }) {
  const commands = HOSTS[host];
  if (!commands) throw new Error('The host must be github or gitlab');
  if (typeof repo !== 'string' || !REPO.test(repo)) throw new Error('The repository must be written owner/name');
  if (typeof run !== 'function') throw new Error('The adapter needs a run function');
  const file = host === 'github' ? 'gh' : 'glab';

  // Runs one command. Resolves with the exit code and output.
  async function attempt(args, input) {
    return run(file, args, { env, input });
  }
  // Runs one command and returns its standard output, or throws a plain error
  // naming the command (never its environment) with the output scrubbed.
  async function call(args, input) {
    const { code, stdout, stderr } = await attempt(args, input);
    if (code !== 0) {
      const said = scrub(stderr || stdout, env);
      throw new Error(`${file} ${args.slice(0, 2).join(' ')} failed${said ? `: ${said}` : ''}`);
    }
    return stdout;
  }
  function json(args, stdout) {
    try {
      return JSON.parse(stdout);
    } catch {
      throw new Error(`${file} ${args.slice(0, 2).join(' ')} did not answer in JSON`);
    }
  }
  const tools = { call, attempt, json, repo, fromAddress, reason: (output) => scrub(output, env) };
  const c = commands(tools);

  return {
    defaultBranch: () => c.defaultBranch(),
    openPr: async ({ head, base, title, body } = {}) => c.openPr({
      head: text(head, 'head branch'), base: text(base, 'base branch'), title: text(title, 'title'), body: text(body, 'body', { empty: true }),
    }),
    updatePr: async ({ number, title, body } = {}) => c.updatePr({
      number: wholeNumber(number), title: text(title, 'title', { optional: true }), body: text(body, 'body', { optional: true, empty: true }),
    }),
    prState: async (number) => c.prState(wholeNumber(number)),
    ciState: async (sha) => c.ciState(commit(sha)),
    merge: async ({ number, sha } = {}) => c.merge({ number: wholeNumber(number), sha: commit(sha) }),
    issue: {
      create: async ({ title, body, labels = [] } = {}) => c.issue.create({
        title: text(title, 'title'), body: text(body, 'body', { empty: true }), labels: labels.map((l) => text(l, 'label')),
      }),
      update: async ({ number, body } = {}) => c.issue.update({ number: wholeNumber(number), body: text(body, 'body', { empty: true }) }),
      list: async ({ label } = {}) => c.issue.list({ label: text(label, 'label') }),
    },
  };
}
