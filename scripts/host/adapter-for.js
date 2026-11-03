// scripts/host/adapter-for.js
// The adapter for a project's record: the host's, or the local one for a project in git alone (spec 6).
//
// A hosted project's record names its backend (`connection.backend`, design section 8.2): the host's tool
// ('cli', the default, also for a record kept before backends were chosen) or the host's web API through
// `curl` ('rest'), for GitHub and GitLab alike.
//
// A tool that will not start (not found, not allowed to run, or a policy message) moves a project to
// the web API by itself: the call that met the failure is answered there, `onSwitch` is told so the helper can
// record it, and the tool is not tried again for this adapter. A tool that started and said no (signed out, a
// refusal) is not a switch.
//
// The web API's key is not held here: it is lent for each request, from the project's own key for a narrow
// connection (GitLab's in the computer's store, GitHub's access key renewed when it is near its end), else
// borrowed from the director's own git (scripts/host/store.js).
import { makeAdapter } from './adapter.js';
import { makeLocalAdapter } from './local/adapter.js';
import { makeGitlabRestAdapter } from './gitlab-rest.js';
import { makeGithubRestAdapter, GITHUB_API } from './github-rest.js';
import { githubAccessKey } from './connection.js';
import { DEFAULT_GITLAB } from './gitlab-base.js';
import { findKey } from './keys.js';
import { borrowKey } from './store.js';
import { curlPath } from './curl.js';
import { directorProxy } from './director-git.js';
import { companyFile } from './gitlab-key.js';
import { startFailure } from '../lib/host-tools.js';

export const TOOL_WONT_START = 'TOOL_WONT_START';
const SYNC_METHODS = new Set(['pullRef', 'pushTarget']);

const GITHUB_ORIGIN = 'https://github.com';
const NAMES = { github: { name: 'GitHub', tool: 'gh' }, gitlab: { name: 'GitLab', tool: 'glab' } };

function wontStart(host) {
  const { name, tool } = NAMES[host];
  const error = new Error(`${name}'s tool (${tool}) is not installed or will not start on this computer`);
  error.code = TOOL_WONT_START;
  return error;
}

// `run`, with a tool that cannot start thrown as one error with a code, which only the switch reads.
function watched(run, host) {
  return async (file, args, options) => {
    let got;
    try {
      got = await run(file, args, options);
    } catch (error) {
      if (startFailure(error)) throw wontStart(host);
      throw error;
    }
    if (startFailure(got)) throw wontStart(host);
    return got;
  };
}

// The key for one web API request: the project's own for a narrow connection, else the director's, lent by their
// git. Nothing is kept; the next request asks again.
function keyLender({ record, base, borrow, keys }) {
  const connection = record.connection ?? {};
  return async () => {
    if (connection.mode === 'narrow') {
      const kept = await findKey(`gitlab-project-${connection.projectId}`, keys);
      return kept?.token ?? '';
    }
    const lent = await borrow({ host: new URL(base).host, base, repoPath: record.repo });
    return lent?.key ?? '';
  };
}

// The same for GitHub: the narrow connection's access key (renewed when it is near its end), else the director's own,
// lent by their git.
function githubKeyLender({ record, borrow, keys, via }) {
  const narrow = record.connection?.mode === 'narrow';
  return async () => {
    if (narrow) return githubAccessKey({ fetch: via.fetch ?? globalThis.fetch, now: via.now ?? (() => new Date()), keys });
    const lent = await borrow({ host: 'github.com', base: GITHUB_ORIGIN, repoPath: record.repo });
    return lent?.key ?? '';
  };
}

function githubRestAdapter(record, { run, via = {}, borrow = borrowKey, keys }) {
  const platform = via.platform ?? process.platform;
  return makeGithubRestAdapter({
    repo: record.repo,
    key: githubKeyLender({ record, borrow, keys, via }),
    run: via.run ?? run,
    curl: via.curl ?? curlPath({ platform }),
    proxy: via.proxy !== undefined ? via.proxy : () => directorProxy(GITHUB_API),
    caFile: via.caFile !== undefined ? via.caFile : companyFile(),
    platform,
    ...(via.baseEnv === undefined ? {} : { baseEnv: via.baseEnv }),
  });
}

function restAdapter(record, { run, via = {}, borrow = borrowKey, keys }) {
  if (record.host === 'github') return githubRestAdapter(record, { run, via, borrow, keys });
  const base = (record.connection?.baseUrl ?? DEFAULT_GITLAB).replace(/\/+$/, '');
  const platform = via.platform ?? process.platform;
  return makeGitlabRestAdapter({
    repo: record.repo,
    base,
    key: keyLender({ record, base, borrow, keys }),
    run: via.run ?? run,
    curl: via.curl ?? curlPath({ platform }),
    proxy: via.proxy !== undefined ? via.proxy : () => directorProxy(`${base}/api/v4`),
    caFile: via.caFile !== undefined ? via.caFile : companyFile(),
    platform,
    ...(via.baseEnv === undefined ? {} : { baseEnv: via.baseEnv }),
  });
}

// An adapter that starts on `first` and moves to `second()` when a call meets TOOL_WONT_START. Calls that need
// no tool (pullRef, pushTarget) are answered by whichever is in use.
function switching({ first, second, onSwitch }) {
  let moved = null;
  async function move() {
    if (moved === null) {
      moved = second();
      try {
        await onSwitch?.({ from: 'cli', to: 'rest' });
      } catch { /* the move stands even if it could not be recorded */ }
    }
    return moved;
  }
  const current = () => moved ?? first;
  const wrap = (pick) => async (...args) => {
    if (moved !== null) return pick(moved)(...args);
    try {
      return await pick(first)(...args);
    } catch (error) {
      if (error?.code !== TOOL_WONT_START) throw error;
      return pick(await move())(...args);
    }
  };
  const out = {};
  for (const [name, value] of Object.entries(first)) {
    if (name === 'backend') continue;
    if (SYNC_METHODS.has(name)) out[name] = (...args) => current()[name](...args);
    else if (typeof value === 'function') out[name] = wrap((a) => a[name].bind(a));
    else if (value !== null && typeof value === 'object') {
      out[name] = Object.fromEntries(Object.keys(value).map((inner) => [inner, wrap((a) => a[name][inner].bind(a[name]))]));
    }
  }
  Object.defineProperty(out, 'backend', { enumerable: true, get: () => current().backend });
  return out;
}

// `write` keeps a local change's signed event the caller's own way; a hosted project has none to keep.
// `via` ({ run, curl, proxy, caFile, platform, baseEnv }), `borrow` and `keys` are seams for tests of the web API;
// `onSwitch({ from, to })` is called once, when a project moves to the web API.
export function adapterOf(record, { run, env = {}, write, via, borrow, keys, onSwitch } = {}) {
  if (record.host === 'local') return makeLocalAdapter({ project: record.repo.slice('local/'.length), run, write, folder: record.folder });
  const base = record.connection?.baseUrl;
  if (record.connection?.backend === 'rest') return restAdapter(record, { run, via, borrow, keys });
  const tool = makeAdapter({ host: record.host, repo: record.repo, run: typeof run === 'function' ? watched(run, record.host) : run, env, base });
  return switching({ first: tool, second: () => restAdapter(record, { run, via, borrow, keys }), onSwitch });
}
