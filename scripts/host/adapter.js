// scripts/host/adapter.js
// The only place `gh` and `glab` are called (design section 11). makeAdapter
// returns the same methods for GitHub and GitLab; each builds one command line,
// runs it through the injected `run` with the adapter's `env` (which is where a
// key travels, never in an argument), and parses the answer. Arguments are
// checked here, before anything runs; github.js and gitlab.js hold the command
// lines and the mappings.
import { githubCommands } from './github.js';
import { gitlabCommands } from './gitlab.js';
import { toolPath } from '../lib/host-tools.js';
import { publicHttps } from '../screens/pages.js';
import { parseRemote, listed, isDefaultHost, hostWords, DEFAULT_GITLAB } from './gitlab-base.js';
import { hostFailure, outputKind, lineFor, timedOut } from './company-ca.js';

const HOSTS = { github: githubCommands, gitlab: gitlabCommands };

// Text in a CLI's error output that could be a key: known key prefixes, an
// Authorization header's value, and anything set as `token=...`. The value after `Bearer`,
// or after `password=`, `token=`, `access_token=`, `private_token=` (and any name ending in
// token, secret or password), is hidden whatever its letters. After the looser forms
// (`Basic x`, `token x`, `password: x`) a value goes only when it is long enough and holds
// a digit or punctuation, as keys do, so "token expired" or "Basic authentication" stays
// readable.
const KEY_LIKE = [
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g,
  /\bgl[a-z]{1,6}-[A-Za-z0-9_\-.]{8,}/g,
  /\b(Bearer)\s+[A-Za-z0-9_\-.=+/]+/gi,
  /\b([A-Za-z_]*(?:token|secret|password)[A-Za-z_]*\s*=\s*)\S+/gi,
  /\b(Basic|token)\s+(?=[A-Za-z0-9_\-.=+/]*[0-9_\-.=+/])[A-Za-z0-9_\-.=+/]{8,}/gi,
  /\b([A-Za-z_]*(?:token|secret|password)[A-Za-z_]*\s*:\s*)(?=\S*[0-9_\-.=+/])\S{6,}/gi,
];
// Environment values that are settings, not keys: an address or a count. A short value is
// not hidden either, so a variable such as `1` or `main` does not blank ordinary words.
const NOT_SECRET = /^(?:GITLAB_HOST|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_\d+)$/;
const SHORTEST_SECRET = 8;
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
  for (const [name, value] of Object.entries(env ?? {})) {
    if (typeof value === 'string' && value.length >= SHORTEST_SECRET && !NOT_SECRET.test(name)) out = out.split(value).join('[hidden]');
  }
  out = out
    .replace(KEY_LIKE[0], '[hidden]')
    .replace(KEY_LIKE[1], '[hidden]')
    .replace(KEY_LIKE[2], '$1 [hidden]')
    .replace(KEY_LIKE[3], '$1[hidden]')
    .replace(KEY_LIKE[4], '$1 [hidden]')
    .replace(KEY_LIKE[5], '$1[hidden]')
    .replace(/\s+/g, ' ')
    .trim();
  return out.length > MOST_SHOWN ? `${out.slice(0, MOST_SHOWN)}...` : out;
}

// What a refused merge says, in the adapter's own words: the host's text is read
// to tell the kinds apart and is never repeated.
function refusalOf(output, fallback) {
  // glab wraps its error over lines, so a phrase can break between words ("SHA does not\n  match HEAD").
  const text = String(output ?? '').replace(/\s+/g, ' ');
  if (/head branch was modified|sha does not match|match-head-commit|head commit/i.test(text)) return 'the head of the pull request has moved since it was checked';
  if (/conflict/i.test(text)) return 'the pull request has a merge conflict';
  if (/status check|required check|checks? .*(?:fail|pending|expected|not pass)|pipeline|ci must|must succeed/i.test(text)) return 'the host\'s required checks have not passed';
  if (/approving review|review.*required|not approved|needs? (?:an? )?approval/i.test(text)) return 'the host needs an approving review on the pull request';
  if (/\b403\b|forbidden|not accessible|permission|you are not allowed|not authori[sz]ed|protected branch/i.test(text)) return 'this sign-in is not allowed to merge it';
  return fallback;
}

// A preview's address as the host gave it, or null unless it is an https address on a public host
// (scripts/screens/pages.js): the helper's browser opens only the host's preview deployment, never
// a page on this computer or its local network.
const httpsOnly = publicHttps;

// What the history calls say on a host whose history they do not read yet.
export const HISTORY_GITLAB_ONLY = 'The audit report reads the history of a GitLab host; for GitHub it is not available in this version';

const MOST_REQUESTS = 100;
const MOST_COMMITS = 50;

const QUEUE_LINE = 'This project\'s host queues merges; Wheelhouse merges only directly for now';

// 'github' for github.com; 'gitlab' for the public GitLab service, or for another address when
// the project setting `gitlabHosts` names it (a host name, with its port when it has one).
export function detectHost(remoteUrl, { gitlabHosts = [] } = {}) {
  const parts = parseRemote(remoteUrl);
  if (parts.hostname === 'github.com') return 'github';
  if (isDefaultHost(parts) || listed(parts, gitlabHosts)) return 'gitlab';
  throw new Error(`The repository is at ${hostWords(parts)}, which is not GitHub or GitLab. If it is a GitLab address, name it in the project settings`);
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
// A request's head as the host gave it: a full 40-character commit ID.
function requestHead(sha) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) throw new Error('The head of a request must be a full commit ID');
  return sha;
}
// An ISO 8601 time, as a UTC ISO string.
function when(value, what) {
  const ms = typeof value === 'string' || value instanceof Date ? Date.parse(value instanceof Date ? value.toISOString() : value) : NaN;
  if (Number.isNaN(ms)) throw new Error(`The ${what} must be a time`);
  return new Date(ms).toISOString();
}
// The protection reading the last report kept: an object, or null when there is none.
function earlier(value) {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('The earlier protection reading must be an object or null');
  return value;
}
function text(value, what, { optional = false, empty = false } = {}) {
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'string' || (!empty && value.trim() === '')) throw new Error(`The ${what} must be text`);
  return value;
}

// `base` is the GitLab address: for a company's own, glab is told its host (GITLAB_HOST, under any the
// given `env` already names), and it is the address in the line said when it cannot be reached
// (company-ca.js).
export function makeAdapter({ host, repo, run, env: given, base = DEFAULT_GITLAB }) {
  const commands = HOSTS[host];
  if (!commands) throw new Error('The host must be github or gitlab');
  if (typeof repo !== 'string' || !REPO.test(repo)) throw new Error('The repository must be written owner/name');
  if (typeof run !== 'function') throw new Error('The adapter needs a run function');
  const file = host === 'github' ? 'gh' : 'glab';
  const env = host === 'gitlab' && base !== DEFAULT_GITLAB && given?.GITLAB_HOST === undefined ? { GITLAB_HOST: new URL(base).host, ...given } : given;

  // Runs one command, with the copy setup fetched into Wheelhouse's tools folder when there is one
  // (scripts/lib/host-tools.js). Resolves with the exit code and output.
  async function attempt(args, input) {
    return run(toolPath(file), args, { env, input });
  }
  // Runs one command and returns its standard output, or throws a plain error
  // naming the command (never its environment) with the output scrubbed.
  async function call(args, input) {
    const { code, stdout, stderr } = await attempt(args, input);
    if (code !== 0) {
      // A server that is not there, or a certificate not trusted, is said in our own words, with a code.
      // Read from glab's standard error alone: its standard output is the host's answer, not its own words.
      const failure = host === 'gitlab' ? hostFailure(stderr, base) : null;
      if (failure !== null) throw failure;
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
  // After a merge command that exited 0: the state is read back. Merged is merged; open means
  // the host queued the merge instead of making it, so it is taken back out of the queue and
  // refused; anything else, or a state that cannot be read, is unknown and refused.
  async function settle({ state, merged, open, takeBack }) {
    let seen = null;
    try { seen = await state(); } catch { /* unknown */ }
    if (seen === merged) return { merged: true };
    if (seen !== open) return { merged: false, reason: 'the host did not confirm that the pull request was merged, so it is treated as not merged: could not confirm' };
    try {
      await takeBack();
    } catch {
      return { merged: false, queued: true, reason: `${QUEUE_LINE}, and it could not be taken back out of the queue: take it out on the host` };
    }
    return { merged: false, queued: true, reason: QUEUE_LINE };
  }
  // What a failed command says about reaching the host: null, or { kind, line } for a server that is
  // not there or a certificate not trusted, which a merge reports apart from a refusal (`timedOut`:
  // the command waited and gave up, so whether it took effect is not known).
  function hostFault(output) {
    const kind = host === 'gitlab' ? outputKind(output) : null;
    return kind === null ? null : { kind, line: lineFor(kind, base), timedOut: kind === 'unreachable' && timedOut(output) };
  }
  // A read whose refusal is an answer: { status, body }, with status 200 when it exited 0 and the
  // HTTP status glab named when it did not. A host that cannot be reached, or a certificate not
  // trusted, is thrown in our own words with its code, as `call` does; so is a failure that names no
  // status.
  async function read(args) {
    const { code, stdout, stderr } = await attempt(args);
    if (code === 0) return { status: 200, body: json(args, stdout) };
    const failure = host === 'gitlab' ? hostFailure(stderr, base) : null;
    if (failure !== null) throw failure;
    const named = /\(HTTP (\d{3})\)/.exec(stderr);
    if (named) return { status: Number(named[1]), body: null };
    const said = scrub(stderr || stdout, env);
    throw new Error(`${file} ${args.slice(0, 2).join(' ')} failed${said ? `: ${said}` : ''}`);
  }
  const tools = { call, settle, attempt, json, repo, fromAddress, refusal: refusalOf, httpsOnly, hostFault, read };
  const c = commands(tools);

  async function history(name, ...args) {
    if (typeof c[name] !== 'function') throw new Error(HISTORY_GITLAB_ONLY);
    return c[name](...args);
  }

  return {
    defaultBranch: () => c.defaultBranch(),
    openPr: async ({ head, base, title, body } = {}) => c.openPr({
      head: text(head, 'head branch'), base: text(base, 'base branch'), title: text(title, 'title'), body: text(body, 'body', { empty: true }),
    }),
    updatePr: async ({ number, title, body } = {}) => c.updatePr({
      number: wholeNumber(number), title: text(title, 'title', { optional: true }), body: text(body, 'body', { optional: true, empty: true }),
    }),
    // Closes a pull request without merging it: setup's step 10 closes its trial pull request.
    closePr: async (number) => c.closePr(wholeNumber(number)),
    prState: async (number) => c.prState(wholeNumber(number)),
    ciState: async (sha) => c.ciState(commit(sha)),
    // The commit a branch points at, in full: the health read asks the default branch's CI with it.
    // Whether the commit has any checks or pipeline, or the branch holds CI configuration. Unlike
    // ciState it never turns a failed read into 'none': an error is thrown, so a failure to look
    // is told from having looked and found nothing.
    hasCi: async (sha, branch) => c.hasCi(commit(sha), text(branch, 'branch')),
    branchHead: async (branch) => commit(await c.branchHead(text(branch, 'branch'))),
    // The address of the commit's preview deployment, from the host's newest successful deployment
    // of it, or null when there is none or its address is not https. A failed read is thrown.
    previewUrl: async (sha) => c.previewUrl(commit(sha)),
    merge: async ({ number, sha } = {}) => c.merge({ number: wholeNumber(number), sha: commit(sha) }),
    // The history calls of the audit report. They only read. The host's own history is the second
    // record the report checks the computer's against (scripts/audit/report.js).
    mergedRequests: async ({ since } = {}) => history('mergedRequests', { since: when(since, 'time to read from') }),
    // `number` names the request that merged the commit, whose own head pipeline is the one that counts.
    pipelinesFor: async (sha, { number } = {}) => history('pipelinesFor', commit(sha), number === undefined ? undefined : wholeNumber(number)),
    protectionEvents: async ({ since, last = null, now = new Date() } = {}) => history('protectionEvents', {
      since: when(since, 'time to read from'),
      last: earlier(last),
      now: new Date(when(now, 'time now')),
    }),
    // The open pull or merge requests, sorted by number, at most 100. Each head must be a full
    // commit ID, since the survey and the start of carried-on work name commits by it.
    openRequests: async () => {
      const requests = await c.openRequests();
      return requests.map((r) => ({ ...r, head: requestHead(r.head) })).sort((x, y) => x.number - y.number).slice(0, MOST_REQUESTS);
    },
    // A request's changed files and its commit subjects (oldest first, at most 50 each).
    requestDetails: async (number) => {
      const details = await c.requestDetails(wholeNumber(number));
      return { files: details.files.slice(0, MOST_REQUESTS * 50), commits: details.commits.slice(0, MOST_COMMITS) };
    },
    // Where the host keeps a request's head: a request from someone's own copy is fetched by it.
    pullRef: (number) => c.pullRef(wholeNumber(number)),
    issue: {
      create: async ({ title, body, labels = [] } = {}) => c.issue.create({
        title: text(title, 'title'), body: text(body, 'body', { empty: true }), labels: labels.map((l) => text(l, 'label')),
      }),
      update: async ({ number, body } = {}) => c.issue.update({ number: wholeNumber(number), body: text(body, 'body', { empty: true }) }),
      list: async ({ label } = {}) => c.issue.list({ label: text(label, 'label') }),
    },
  };
}
