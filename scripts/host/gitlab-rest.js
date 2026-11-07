// scripts/host/gitlab-rest.js
// The GitLab backend that needs no `glab`: every adapter operation through GitLab's web API (v4), run by
// `curl.js`. It answers in the same shape as `gitlab.js`, with the mappings of `gitlab-shared.js`, and
// the contract tests (tests/scripts/host/contract-gitlab.test.js) run both over the same cases.
//
// The key is not held here. `key()` gives it for one request (borrowed from the computer's store by a later
// part) and it travels in the PRIVATE-TOKEN header on `curl`'s standard input, never in an argument. Every
// error that leaves here has the key scrubbed out of it.
import { run as realRun } from '../lib/run.js';
import { publicHttps } from '../pictures/pages.js';
import { DEFAULT_GITLAB } from './gitlab-base.js';
import { MERGE_SECONDS, READ_SECONDS, request } from './curl.js';
import { adapterFrom, refusalOf, scrub, settle } from './adapter.js';
import { gitlabHistory } from './gitlab-history.js';
import {
  mergedResults as mergedResultsOf, stateOf, prStateOf, requestOf, issueOf, fileOf, subjectsOf, previewOf,
  approvalRefusal, approvalsLeft, MERGE_KEY_REFUSED,
} from './gitlab-shared.js';

const API = '/api/v4/';
const PAGE = 100;
const MOST_DIFF_PAGES = 50;
const HOST_KINDS = { HOST_UNREACHABLE: 'unreachable', CERTIFICATE_NOT_TRUSTED: 'certificate', PROXY_REFUSED: 'proxy' };

const MR_FAILED = 'GitLab did not merge the merge request';

// The host's own `message`, flattened to one line, or ''. Read to tell kinds of refusal apart, never repeated.
function messageOf(text) {
  try {
    const m = JSON.parse(text);
    const said = m?.message ?? m?.error ?? '';
    return typeof said === 'string' ? said : JSON.stringify(said);
  } catch {
    return String(text ?? '');
  }
}

// The commands behind the adapter, over `send(method, path, body, seconds)`, which gives { status, body } with
// `body` as text, and throws the plain host faults (unreachable, certificate, proxy) with their codes.
export function gitlabRestCommands({ send, repo }) {
  const project = `projects/${encodeURIComponent(repo)}`;
  const json = (text, what) => {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`GitLab did not answer in JSON for ${what}`);
    }
  };
  const ok = (status) => status >= 200 && status < 300;
  const said = (status, what) => (status === 401
    ? `GitLab did not accept the key (${what})`
    : `GitLab answered HTTP ${status} for ${what}`);

  // A read that must succeed: the parsed answer, or a thrown plain error carrying the status.
  async function get(path) {
    const { status, body } = await send('GET', path);
    if (!ok(status)) throw Object.assign(new Error(said(status, `reading ${path.split('?')[0].replace(/^projects\/[^/]+/, 'the project')}`)), { status });
    return json(body, 'a read');
  }
  // The glab-shaped reads the history uses: ['api', path].
  const ask = async (args) => get(args[1]);
  // A read whose refusal is an answer: { status, body }, with `body` null unless the status is a success.
  async function read(args) {
    const { status, body } = await send('GET', args[1]);
    return { status, body: ok(status) ? json(body, 'a read') : null };
  }
  async function write(method, path, payload, what) {
    const { status, body } = await send(method, path, payload);
    if (!ok(status)) {
      const reason = status === 409 && /already exists|already open/i.test(messageOf(body)) ? ' (one is already open for that branch)' : '';
      throw Object.assign(new Error(`${said(status, what)}${reason}`), { status });
    }
    return json(body, what);
  }
  const mr = (number) => `${project}/merge_requests/${number}`;

  const mergedResults = (sha, { strict = false } = {}) => mergedResultsOf({ get, project, sha, strict });

  // A request the host answered to, as a refusal in the adapter's words: a fault in reaching the host is a flag of its own.
  const faultOf = (error) => {
    const kind = HOST_KINDS[error?.code];
    return kind === undefined ? null : { kind, line: error.message, timedOut: error.timedOut === true };
  };

  return {
    ...gitlabHistory({ ask, read, project }),

    async defaultBranch() {
      const answer = await get(project);
      if (typeof answer?.default_branch !== 'string') throw new Error('GitLab did not say which branch is the default');
      return answer.default_branch;
    },

    async openPr({ head, base, title, body }) {
      const made = await write('POST', `${project}/merge_requests`, { source_branch: head, target_branch: base, title, description: body }, 'opening the merge request');
      if (!Number.isInteger(made?.iid) || typeof made.web_url !== 'string') throw new Error('The host answered, but without the web address of what it made or changed');
      return { number: made.iid, url: made.web_url };
    },

    async updatePr({ number, title, body }) {
      await write('PUT', mr(number), { ...(title !== undefined ? { title } : {}), ...(body !== undefined ? { description: body } : {}) }, 'updating the merge request');
      return { number };
    },

    async closePr(number) {
      await write('PUT', mr(number), { state_event: 'close' }, 'closing the merge request');
      return { number };
    },

    async prState(number) {
      return prStateOf(await get(mr(number)));
    },

    async setStatus() {
      return { refused: 'GitLab projects run their checks on the host' };
    },
    async checkContexts() {
      throw new Error('GitLab projects run their checks on the host');
    },
    async requiredChecks() {
      return [];
    },

    async hasCi(sha, branch) {
      const pipelines = await get(`${project}/pipelines?sha=${sha}&per_page=1&order_by=id&sort=desc`);
      if (!Array.isArray(pipelines)) throw new Error('GitLab did not list the commit\'s pipelines');
      if (pipelines.length > 0 || await mergedResults(sha, { strict: true }) !== 'none') return true;
      const { status } = await send('GET', `${project}/repository/files/.gitlab-ci.yml?ref=${encodeURIComponent(branch)}`);
      if (ok(status)) return true;
      if (status === 404) return false;
      throw new Error('GitLab could not say whether the project has a CI configuration');
    },

    async branchHead(branch) {
      return (await get(`${project}/repository/branches/${encodeURIComponent(branch)}`))?.commit?.id;
    },

    async ciState(sha) {
      const pipelines = await get(`${project}/pipelines?sha=${sha}&per_page=1&order_by=id&sort=desc`);
      const newest = Array.isArray(pipelines) ? pipelines[0] : undefined;
      if (newest) return { sha, state: stateOf(newest) };
      return { sha, state: await mergedResults(sha) };
    },

    async previewUrl(sha) {
      return previewOf(await get(`${project}/deployments?status=success&order_by=id&sort=desc&per_page=100`), sha, publicHttps);
    },

    // Merges at the sha the card names, sending no `auto_merge` or `merge_when_pipeline_succeeds` (both default to
    // false), so GitLab never queues it. A refusal is an answer, not an error; GitLab's status is read first, then its words.
    async merge({ number, sha }) {
      let result;
      try {
        result = await send('PUT', `${mr(number)}/merge`, { sha }, MERGE_SECONDS);
      } catch (error) {
        const fault = faultOf(error);
        if (fault === null) throw error;
        return { merged: false, [fault.kind]: true, reason: `${fault.timedOut ? 'The merge could not be confirmed.' : 'Not merged.'} ${fault.line}` };
      }
      const { status, body } = result;
      if (!ok(status)) {
        const words = messageOf(body);
        if (status === 401) return { merged: false, keyRefused: true, reason: MERGE_KEY_REFUSED };
        if (status === 403) return { merged: false, reason: 'this sign-in is not allowed to merge it' };
        if (status === 409) return { merged: false, reason: refusalOf('SHA does not match HEAD', MR_FAILED) };
        if (status === 406 || status === 422) return { merged: false, reason: refusalOf('conflict', MR_FAILED) };
        return { merged: false, reason: refusalOf(words, MR_FAILED) };
      }
      return settle({
        state: async () => (await get(mr(number))).state,
        merged: 'merged',
        open: 'opened',
        takeBack: () => write('POST', `${mr(number)}/cancel_merge_when_pipeline_succeeds`, {}, 'taking the merge back'),
      });
    },

    // Approves at the sha the card names. A refusal is an answer, not an error.
    async approve({ number, sha }) {
      let result;
      try {
        result = await send('POST', `${mr(number)}/approve`, { sha }, MERGE_SECONDS);
      } catch (error) {
        const fault = faultOf(error);
        if (fault === null) throw error;
        return { approved: false, [fault.kind]: true, reason: `${fault.timedOut ? 'The approval could not be confirmed.' : 'Not approved.'} ${fault.line}` };
      }
      if (ok(result.status)) return { approved: true };
      return approvalRefusal(result.status, messageOf(result.body));
    },

    async approvalsNeeded(number) {
      return approvalsLeft(await get(`${mr(number)}/approvals`));
    },

    async openRequests() {
      const requests = await get(`${project}/merge_requests?state=opened&per_page=${PAGE}`);
      if (!Array.isArray(requests)) throw new Error('GitLab did not list the open merge requests');
      return requests.map(requestOf);
    },

    // The changed files, paged until a short page (the old /changes is deprecated), and the commits' subjects.
    async requestDetails(number) {
      const files = [];
      for (let page = 1; page <= MOST_DIFF_PAGES; page += 1) {
        const got = await get(`${mr(number)}/diffs?per_page=${PAGE}&page=${page}`);
        if (!Array.isArray(got)) throw new Error('GitLab did not list the changed files');
        files.push(...got);
        if (got.length < PAGE) break;
      }
      const commits = await get(`${mr(number)}/commits?per_page=50`);
      return { files: files.map(fileOf), commits: subjectsOf(commits) };
    },

    pullRef: (number) => `refs/merge-requests/${number}/head`,

    async verdictComment() {
      throw new Error('The merge queue\'s verdict comment is for GitHub only');
    },
    async login() {
      throw new Error('The merge queue\'s policy is for GitHub only');
    },

    issue: {
      async create({ title, body, labels }) {
        const made = await write('POST', `${project}/issues`, { title, description: body, labels: labels.join(',') }, 'opening the issue');
        if (!Number.isInteger(made?.iid) || typeof made.web_url !== 'string') throw new Error('The host answered, but without the web address of what it made or changed');
        return { number: made.iid, url: made.web_url };
      },
      async update({ number, body }) {
        await write('PUT', `${project}/issues/${number}`, { description: body }, 'updating the issue');
        return { number };
      },
      async list({ label }) {
        const issues = await get(`${project}/issues?labels=${encodeURIComponent(label)}&state=opened&per_page=${PAGE}`);
        if (!Array.isArray(issues)) throw new Error('GitLab did not list the issues');
        return issues.map(issueOf);
      },
    },
  };
}

// The adapter over GitLab's web API. `key` is a function giving the token for one request (a string or a
// promise of one); `curl` is curl.js's curlPath answer; `proxy` (readProxy's answer, or a function giving it, read
// at the first request), `caFile` and `platform` go to curl.js; `run` is a stand-in in tests. Backend selection is the caller's: this only builds the adapter.
export function makeGitlabRestAdapter({
  repo, base = DEFAULT_GITLAB, key, run = realRun, curl, proxy = null, caFile = null,
  platform = process.platform, baseEnv = process.env,
} = {}) {
  if (typeof key !== 'function') throw new Error('The adapter needs a function that gives the key');
  if (typeof repo !== 'string' || !/^[A-Za-z0-9_.][A-Za-z0-9_.-]*(\/[A-Za-z0-9_.][A-Za-z0-9_.-]*)+$/.test(repo)) throw new Error('The repository must be written owner/name');
  const origin = String(base).replace(/\/+$/, '');

  async function send(method, path, payload, maxSeconds = READ_SECONDS) {
    let token = '';
    try {
      token = String(await key() ?? '').trim();
      if (token === '') throw new Error('There is no key for GitLab on this computer');
      const headers = { 'PRIVATE-TOKEN': token, Accept: 'application/json' };
      if (payload !== undefined) headers['Content-Type'] = 'application/json';
      return await request({
        run, curl, url: `${origin}${API}${path}`, method, headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
        proxy: typeof proxy === 'function' ? await proxy() : proxy, caFile, maxSeconds, platform, baseEnv, base: origin,
      });
    } catch (error) {
      // Whatever went wrong, the key is not in what leaves.
      const clean = new Error(scrub(error?.message, {}, [token]));
      for (const field of ['code', 'timedOut', 'status']) if (error?.[field] !== undefined) clean[field] = error[field];
      throw clean;
    }
  }

  return { ...adapterFrom(gitlabRestCommands({ send, repo })), backend: 'rest' };
}
