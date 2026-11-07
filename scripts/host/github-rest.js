// scripts/host/github-rest.js
// The GitHub backend that needs no `gh`: every adapter operation through GitHub's web API, run by `curl.js`.
// It answers in the same shape as `github.js`, with the mappings that file shares, and the contract tests
// (tests/scripts/host/contract-github.test.js) run both over the same cases.
//
// The key is not held here. `key()` gives it for one request (a narrow connection's access key, or the director's
// own, lent by their git) and it travels in the Authorization header on `curl`'s standard input, never in an
// argument. Every error that leaves here has the key scrubbed out of it, and a fault in reaching GitHub is said
// in GitHub's name.
import { run as realRun } from '../lib/run.js';
import { publicHttps } from '../pictures/pages.js';
import { MERGE_SECONDS, READ_SECONDS, request } from './curl.js';
import { adapterFrom, refusalOf, scrub, settle } from './adapter.js';
import { STATUS_CONTEXT } from '../checks/where.js';
import {
  MERGEABLE, STATE, CI_QUERY, CONTEXTS_QUERY, MOST_DEPLOYMENTS, MOST_REVIEW_PAGES, NO_RULES_PLAN, APPROVE_HEAD_MOVED,
  reviewOf, rollupOf, contextsOf, requiredChecksOf, approvalsLeftOf, approvalRefusal,
} from './github.js';

export const GITHUB_API = 'https://api.github.com';
const PAGE = 100;
const MOST_DIFF_PAGES = 50;
const MOST_COMMITS = 50;
const HOST_KINDS = { HOST_UNREACHABLE: 'unreachable', CERTIFICATE_NOT_TRUSTED: 'certificate', PROXY_REFUSED: 'proxy' };

const PR_FAILED = 'GitHub did not merge the pull request';
const MERGE_KEY_REFUSED = 'GitHub did not accept the key, so nothing was merged';
const DISABLE_AUTO_MERGE = 'mutation($id:ID!){disablePullRequestAutoMerge(input:{pullRequestId:$id}){clientMutationId}}';

// GitHub's faults in reaching it, in its own name (the lines in company-ca.js are about GitLab). The codes are kept.
const FAULT_LINES = {
  HOST_UNREACHABLE: 'GitHub (api.github.com) can\'t be reached from here. Work carries on here and is sent when it can be.',
  CERTIFICATE_NOT_TRUSTED: 'The certificate GitHub (api.github.com) shows isn\'t one this computer trusts, which a network filter or security software can cause. Wheelhouse never switches certificate checks off: ask whoever looks after this computer or its network.',
  PROXY_REFUSED: 'Your company\'s proxy didn\'t accept this computer\'s sign-in, so GitHub couldn\'t be reached. Work carries on here and is sent when it can be.',
  NO_CURL: 'This computer has no curl Wheelhouse can use, so it can only reach GitHub through GitHub\'s own tool (gh). Ask IT for either.',
};

// The host's own `message` and its listed errors, flattened to one line, or ''. Read to tell kinds of refusal apart, never repeated.
function messageOf(text) {
  try {
    const m = JSON.parse(text);
    const errors = Array.isArray(m?.errors) ? m.errors.map((e) => (typeof e === 'string' ? e : e?.message ?? '')).join(' ') : '';
    return `${typeof m?.message === 'string' ? m.message : ''} ${errors}`.trim();
  } catch {
    return String(text ?? '');
  }
}

// The commands behind the adapter, over `send(method, path, body, seconds)`, which gives { status, body } with
// `body` as text, and throws the plain host faults (unreachable, certificate, proxy) with their codes.
export function githubRestCommands({ send, repo }) {
  const [owner, name] = repo.split('/');
  const project = `repos/${repo}`;
  const json = (text, what) => {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`GitHub did not answer in JSON for ${what}`);
    }
  };
  const ok = (status) => status >= 200 && status < 300;
  const said = (status, what) => (status === 401
    ? `GitHub did not accept the key (${what})`
    : `GitHub answered HTTP ${status} for ${what}`);

  // A read that must succeed: the parsed answer, or a thrown plain error carrying the status.
  async function get(path) {
    const { status, body } = await send('GET', path);
    if (!ok(status)) throw Object.assign(new Error(said(status, `reading ${path.split('?')[0].replace(/^repos\/[^/]+\/[^/]+/, 'the repository')}`)), { status });
    return json(body, 'a read');
  }
  async function write(method, path, payload, what) {
    const { status, body } = await send(method, path, payload);
    if (!ok(status)) {
      const reason = status === 422 && /already exists/i.test(messageOf(body)) ? ' (one is already open for that branch)' : '';
      throw Object.assign(new Error(`${said(status, what)}${reason}`), { status });
    }
    return json(body, what);
  }
  const graphql = (query, variables) => write('POST', 'graphql', { query, variables }, 'a query');
  const pr = (number) => `${project}/pulls/${number}`;
  const addressed = (made) => {
    if (!Number.isInteger(made?.number) || typeof made.html_url !== 'string') throw new Error('The host answered, but without the web address of what it made or changed');
    return { number: made.number, url: made.html_url };
  };

  // A request the host answered to, as a refusal in the adapter's words: a fault in reaching the host is a flag of its own.
  const faultOf = (error) => {
    const kind = HOST_KINDS[error?.code];
    return kind === undefined ? null : { kind, line: error.message, timedOut: error.timedOut === true };
  };

  async function rulesOf(branch) {
    const { status, body } = await send('GET', `${project}/rules/branches/${encodeURIComponent(branch)}?per_page=100`);
    if (!ok(status)) return NO_RULES_PLAN.test(messageOf(body)) ? [] : null;
    try {
      const rules = JSON.parse(body);
      return Array.isArray(rules) ? rules : null;
    } catch {
      return null;
    }
  }

  async function reviews(number) {
    const all = [];
    for (let page = 1; page <= MOST_REVIEW_PAGES; page += 1) {
      const got = await get(`${pr(number)}/reviews?per_page=${PAGE}&page=${page}`);
      if (!Array.isArray(got)) throw new Error('GitHub did not list the pull request\'s reviews');
      all.push(...got);
      if (got.length < PAGE) break;
    }
    return all.map(reviewOf);
  }

  async function ciRead(sha) {
    return rollupOf(await graphql(CI_QUERY, { owner, name, sha }), sha);
  }

  return {
    async defaultBranch() {
      const answer = await get(project);
      if (typeof answer?.default_branch !== 'string') throw new Error('GitHub did not say which branch is the default');
      return answer.default_branch;
    },

    async openPr({ head, base, title, body }) {
      return addressed(await write('POST', `${project}/pulls`, { head, base, title, body }, 'opening the pull request'));
    },

    async updatePr({ number, title, body }) {
      await write('PATCH', pr(number), { ...(title !== undefined ? { title } : {}), ...(body !== undefined ? { body } : {}) }, 'updating the pull request');
      return { number };
    },

    // Closes the pull request, unmerged; its branch is left.
    async closePr(number) {
      await write('PATCH', pr(number), { state: 'closed' }, 'closing the pull request');
      return { number };
    },

    async prState(number) {
      const p = await get(pr(number));
      const state = p.merged === true ? 'merged' : (STATE[String(p.state).toUpperCase()] ?? 'unknown');
      // GitHub's mergeable is true, false or null (still being worked out); it means nothing once the request is not open.
      const mergeable = state === 'open' ? ({ true: 'yes', false: 'no' }[String(p.mergeable)] ?? 'unknown') : 'unknown';
      return {
        headSha: p.head?.sha, ...(typeof p.title === 'string' ? { title: p.title } : {}),
        ...(typeof p.head?.ref === 'string' ? { headRef: p.head.ref } : {}), ...(typeof p.base?.ref === 'string' ? { baseRef: p.base.ref } : {}),
        mergeable, state, ...(typeof p.body === 'string' ? { body: p.body } : {}),
      };
    },

    async branchHead(branch) {
      return (await get(`${project}/branches/${encodeURIComponent(branch)}`))?.commit?.sha;
    },

    async ciState(sha) {
      return ciRead(sha);
    },

    async checkContexts(sha) {
      return contextsOf(await graphql(CONTEXTS_QUERY, { owner, name, sha }));
    },

    async requiredChecks(branch) {
      return requiredChecksOf(await rulesOf(branch));
    },

    // Reports a check on the commit. A refusal is an answer: a connection set up before Wheelhouse asked for this
    // permission reads 'permission'.
    async setStatus({ sha, state, description, context = STATUS_CONTEXT }) {
      const { status, body } = await send('POST', `${project}/statuses/${sha}`, { state, context, description });
      if (ok(status)) return { ok: true };
      if (/rate limit/i.test(messageOf(body))) return { refused: 'GitHub is limiting how fast it takes reports' };
      return { refused: status === 403 || /not accessible/i.test(messageOf(body)) ? 'permission' : 'GitHub did not take the report' };
    },

    async previewUrl(sha) {
      const deployments = await get(`${project}/deployments?sha=${sha}`);
      if (!Array.isArray(deployments)) throw new Error('GitHub did not list the commit\'s deployments');
      const newest = deployments.filter((d) => Number.isSafeInteger(d?.id) && d.id > 0).sort((a, b) => b.id - a.id);
      for (const deployment of newest.slice(0, MOST_DEPLOYMENTS)) {
        const statuses = await get(`${project}/deployments/${deployment.id}/statuses`);
        if (!Array.isArray(statuses)) throw new Error('GitHub did not list the deployment\'s statuses');
        const newestStatus = statuses.filter((s) => Number.isSafeInteger(s?.id)).sort((a, b) => b.id - a.id)[0];
        if (newestStatus?.state === 'success') return publicHttps(newestStatus.environment_url);
      }
      return null;
    },

    async hasCi(sha, branch) {
      if ((await ciRead(sha)).state !== 'none') return true;
      const { status, body } = await send('GET', `${project}/contents/.github/workflows?ref=${encodeURIComponent(branch)}`);
      if (ok(status)) {
        const files = json(body, 'the workflows folder');
        return Array.isArray(files) && files.length > 0;
      }
      if (status === 404) return false;
      throw new Error('GitHub could not say whether the project has CI workflows');
    },

    // Merges at the sha the card names (GitHub refuses with 409 if the head has moved). A refusal is an answer, not
    // an error; GitHub's status is read first, then its words.
    async merge({ number, sha }) {
      let result;
      try {
        result = await send('PUT', `${pr(number)}/merge`, { sha, merge_method: 'merge' }, MERGE_SECONDS);
      } catch (error) {
        const fault = faultOf(error);
        if (fault === null) throw error;
        return { merged: false, [fault.kind]: true, reason: `${fault.timedOut ? 'The merge could not be confirmed.' : 'Not merged.'} ${fault.line}` };
      }
      const { status, body } = result;
      if (!ok(status)) {
        if (status === 401) return { merged: false, keyRefused: true, reason: MERGE_KEY_REFUSED };
        if (status === 403) return { merged: false, reason: 'this sign-in is not allowed to merge it' };
        if (status === 409) return { merged: false, reason: refusalOf('head branch was modified', PR_FAILED) };
        return { merged: false, reason: refusalOf(messageOf(body), PR_FAILED) };
      }
      // The answer is not read: the pull request is, and it says merged, queued or unknown.
      let id = null;
      return settle({
        state: async () => {
          const p = await get(pr(number));
          id = p.node_id ?? null;
          return p.merged === true ? 'merged' : p.state;
        },
        merged: 'merged',
        open: 'open',
        takeBack: async () => {
          if (typeof id !== 'string') throw new Error('GitHub did not give the pull request\'s id');
          await graphql(DISABLE_AUTO_MERGE, { id });
        },
      });
    },

    // Approves at the head the card names. GitHub accepts a review of any commit in the pull request, so the head is
    // read first and a moved one is refused here; the review then names that commit. A refusal is an answer, not an error.
    async approve({ number, sha }) {
      let result;
      try {
        const head = (await get(pr(number)))?.head?.sha;
        if (head !== sha) return { approved: false, reason: APPROVE_HEAD_MOVED };
        result = await send('POST', `${pr(number)}/reviews`, { event: 'APPROVE', commit_id: sha }, MERGE_SECONDS);
      } catch (error) {
        const fault = faultOf(error);
        if (fault === null) throw error;
        return { approved: false, [fault.kind]: true, reason: `${fault.timedOut ? 'The approval could not be confirmed.' : 'Not approved.'} ${fault.line}` };
      }
      if (ok(result.status)) return { approved: true };
      return approvalRefusal(result.status, messageOf(result.body));
    },

    async approvalsNeeded(number) {
      const p = await get(pr(number));
      const rules = await rulesOf(p.base?.ref);
      if (rules === null) throw new Error('GitHub did not say how many approvals the pull request still needs');
      return approvalsLeftOf({ rules, reviews: await reviews(number), head: p.head?.sha });
    },

    async openRequests() {
      const requests = await get(`${project}/pulls?state=open&per_page=${PAGE}`);
      if (!Array.isArray(requests)) throw new Error('GitHub did not list the open pull requests');
      return requests.map((r) => ({
        number: r.number, title: r.title, body: r.body ?? '', branch: r.head?.ref, head: r.head?.sha,
        draft: r.draft === true, fork: r.head?.repo?.full_name !== r.base?.repo?.full_name,
      }));
    },

    // The changed files, paged until a short page, and the commits' subjects, oldest first.
    async requestDetails(number) {
      const files = [];
      for (let page = 1; page <= MOST_DIFF_PAGES; page += 1) {
        const got = await get(`${pr(number)}/files?per_page=${PAGE}&page=${page}`);
        if (!Array.isArray(got)) throw new Error('GitHub did not list the changed files');
        files.push(...got);
        if (got.length < PAGE) break;
      }
      const commits = await get(`${pr(number)}/commits?per_page=${MOST_COMMITS}`);
      return {
        files: files.map((f) => ({ path: f.filename, additions: f.additions ?? 0, deletions: f.deletions ?? 0 })),
        commits: (Array.isArray(commits) ? commits : []).map((c) => String(c?.commit?.message ?? '').split('\n')[0]),
      };
    },

    pullRef: (number) => `refs/pull/${number}/head`,

    // The merge queue's verdict comment: posted once, its id kept, and edited in place for a new head. A kept comment
    // that is gone is posted again.
    async verdictComment({ number, id, body }) {
      if (Number.isInteger(id) && id > 0) {
        const { status } = await send('PATCH', `${project}/issues/comments/${id}`, { body });
        if (ok(status)) return { id };
        if (status !== 404) throw new Error('GitHub did not edit the verdict comment');
      }
      const posted = await write('POST', `${project}/issues/${number}/comments`, { body }, 'posting the verdict comment');
      if (!Number.isInteger(posted?.id)) throw new Error('GitHub did not say which comment it posted');
      return { id: posted.id };
    },

    reviews,

    async login() {
      const login = (await get('user'))?.login;
      if (typeof login !== 'string' || login === '') throw new Error('GitHub did not say which account this is');
      return login;
    },

    issue: {
      async create({ title, body, labels }) {
        return addressed(await write('POST', `${project}/issues`, { title, body, labels }, 'opening the issue'));
      },
      async update({ number, body }) {
        await write('PATCH', `${project}/issues/${number}`, { body }, 'updating the issue');
        return { number };
      },
      // Open issues carrying the label, up to 100 (the list holds pull requests too; they are left out).
      async list({ label }) {
        const issues = await get(`${project}/issues?labels=${encodeURIComponent(label)}&state=open&per_page=${PAGE}`);
        if (!Array.isArray(issues)) throw new Error('GitHub did not list the issues');
        return issues.filter((i) => i.pull_request === undefined).map((i) => ({
          number: i.number, title: i.title, body: i.body ?? '', url: i.html_url,
          labels: (i.labels ?? []).map((l) => l.name), state: i.state === 'open' ? 'open' : 'closed',
        }));
      },
    },
  };
}

// The adapter over GitHub's web API. `key` is a function giving the token for one request (a string or a
// promise of one); `curl` is curl.js's curlPath answer; `proxy` (readProxy's answer, or a function giving it, read
// at the first request), `caFile` and `platform` go to curl.js; `run` is a stand-in in tests. Backend selection is the caller's: this only builds the adapter.
export function makeGithubRestAdapter({
  repo, base = GITHUB_API, key, run = realRun, curl, proxy = null, caFile = null,
  platform = process.platform, baseEnv = process.env,
} = {}) {
  if (typeof key !== 'function') throw new Error('The adapter needs a function that gives the key');
  if (typeof repo !== 'string' || !/^[A-Za-z0-9_.][A-Za-z0-9_.-]*\/[A-Za-z0-9_.][A-Za-z0-9_.-]*$/.test(repo)) throw new Error('The repository must be written owner/name');
  const origin = String(base).replace(/\/+$/, '');

  async function send(method, path, payload, maxSeconds = READ_SECONDS) {
    let token = '';
    try {
      token = String(await key() ?? '').trim();
      if (token === '') throw new Error('There is no key for GitHub on this computer');
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
      if (payload !== undefined) headers['Content-Type'] = 'application/json';
      return await request({
        run, curl, url: `${origin}/${path}`, method, headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
        proxy: typeof proxy === 'function' ? await proxy() : proxy, caFile, maxSeconds, platform, baseEnv, base: origin,
      });
    } catch (error) {
      // Whatever went wrong, the key is not in what leaves; a fault in reaching GitHub is said in GitHub's name.
      const clean = new Error(FAULT_LINES[error?.code] ?? scrub(error?.message, {}, [token]));
      for (const field of ['code', 'timedOut', 'status']) if (error?.[field] !== undefined) clean[field] = error[field];
      throw clean;
    }
  }

  return { ...adapterFrom(githubRestCommands({ send, repo })), backend: 'rest' };
}
