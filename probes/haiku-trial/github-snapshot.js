// probes/haiku-trial/github-snapshot.js
// The GitHub side of a trial snapshot (spec 2026-11-13, section 3). What GitHub cannot be asked to copy (merged pull requests,
// their commits, statuses and checks) is read once and kept as a capture, so a resumed run can answer the kit's reads from it.
// Every real call arrives through `gh` (the same shape as `io.gh`) or `github` (the members `io.github` has), so tests fake both.
import fs from 'node:fs';
import path from 'node:path';

const REPO = 'repos/{owner}/{repo}';

// Every path the kit reads through `io.gh` (runner.js, signals.js, host.js), with `{n}` and `{sha}` standing for a pull request's
// number and a commit. The capture and `snapshotGh` share this list, so a read the kit adds is added in one place.
export const CAPTURED = [
  `${REPO}/pulls?state=all&per_page=100`,
  `${REPO}/pulls/{n}`,
  `${REPO}/pulls/{n}/files?per_page=100`,
  `${REPO}/pulls/{n}/commits?per_page=100`,
  `${REPO}/commits/{sha}`,
  `${REPO}/commits/{sha}/status`,
  `${REPO}/commits/{sha}/statuses`,
  `${REPO}/commits/{sha}/pulls`,
  `${REPO}/actions/runs?per_page=100`,
  `${REPO}/branches?per_page=100`,
];
const at = (template, values = {}) => template.replace('{n}', values.n).replace('{sha}', values.sha);
const PULLS = CAPTURED[0];
const RUNS = CAPTURED.find((p) => p.includes('/actions/runs'));
const BRANCHES = CAPTURED.find((p) => p.includes('/branches'));
const pathFor = (needle, values) => at(CAPTURED.find((p) => p.endsWith(needle)), values);

const PAGE = 100;
const SETTINGS = ['allow_squash_merge', 'allow_merge_commit', 'allow_rebase_merge', 'allow_auto_merge', 'delete_branch_on_merge', 'default_branch'];

// A list as the kit asks for it (`per_page=100`, no page), followed with `&page=N` until a short page, so the whole list is kept.
// `pick` finds the items in a response; gh answers null for a path it could not read, which ends the list.
async function paged(gh, base, pick = (x) => x) {
  const all = [];
  for (let page = 1; ; page += 1) {
    const got = await gh(['api', page === 1 ? base : `${base}&page=${page}`]);
    const items = got === null || got === undefined ? [] : pick(got);
    if (!Array.isArray(items)) break;
    all.push(...items);
    if (items.length < PAGE) break;
  }
  return all;
}

// The list shows a ruleset only in summary, so each is read in full: that is what is made again on a fresh repository.
async function rulesetsOf(gh) {
  const list = (await gh(['api', `${REPO}/rulesets`])) ?? [];
  const full = [];
  for (const r of list) full.push((await gh(['api', `${REPO}/rulesets/${r.id}`])) ?? r);
  return full;
}

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

// Reads the repository as it is and writes `dest/github/` (capture.json, settings.json, open.json, mirror.git). Returns the highest
// issue or pull request number, so a fresh repository can be numbered the same way.
export async function captureGithub({ gh, github, slug, dest, seedSha }) {
  const out = path.join(dest, 'github');
  const capture = {};
  const keep = (key, value) => { if (value !== null && value !== undefined) capture[key] = value; };

  const pulls = await paged(gh, PULLS);
  keep(PULLS, pulls);
  const shas = new Set();
  for (const pull of pulls) {
    for (const needle of ['/pulls/{n}', '/files?per_page=100']) {
      const key = pathFor(needle, { n: pull.number });
      keep(key, await gh(['api', key]));
    }
    const commitsKey = pathFor('/commits?per_page=100', { n: pull.number });
    const commits = await paged(gh, commitsKey);
    keep(commitsKey, commits);
    for (const c of commits) if (c.sha) shas.add(c.sha);
    for (const sha of [pull.merge_commit_sha, pull.head?.sha]) if (sha) shas.add(sha);
  }
  // The commits on main since the seed: the score reads which pull request each came from.
  const mainShas = new Set();
  if (seedSha) {
    const compared = await gh(['api', `${REPO}/compare/${seedSha}...main`]);
    for (const c of compared?.commits ?? []) if (c.sha) { shas.add(c.sha); mainShas.add(c.sha); }
  }
  for (const sha of shas) {
    for (const needle of ['/commits/{sha}', '/commits/{sha}/status', '/commits/{sha}/statuses']) {
      const key = pathFor(needle, { sha });
      keep(key, await gh(['api', key]));
    }
  }
  for (const sha of mainShas) {
    const key = pathFor('/commits/{sha}/pulls', { sha });
    keep(key, await gh(['api', key]));
  }
  const runs = await paged(gh, RUNS, (x) => x.workflow_runs);
  keep(RUNS, { workflow_runs: runs });
  keep(BRANCHES, await paged(gh, BRANCHES));
  writeJson(path.join(out, 'capture.json'), capture);

  // The settings setup turns on (merge methods, protection of main, rulesets). A path that does not exist is stored as null.
  const repo = (await gh(['api', REPO])) ?? {};
  writeJson(path.join(out, 'settings.json'), {
    repo: Object.fromEntries(SETTINGS.filter((k) => k in repo).map((k) => [k, repo[k]])),
    protection: (await gh(['api', `${REPO}/branches/main/protection`])) ?? null,
    rulesets: await rulesetsOf(gh),
  });

  writeJson(path.join(out, 'open.json'), pulls.filter((p) => p.state === 'open').map((p) => ({
    number: p.number, head: p.head?.ref, base: p.base?.ref, title: p.title, body: p.body ?? '', draft: p.draft === true,
  })));

  await github.mirror({ slug, dir: path.join(out, 'mirror.git') });

  // Issues and pull requests share one numbering, so the newest of either is the highest.
  const issues = (await gh(['api', `${REPO}/issues?state=all&per_page=1&sort=created&direction=desc`])) ?? [];
  const maxNumber = Math.max(0, ...issues.map((i) => i.number ?? 0), ...pulls.map((p) => p.number ?? 0));
  return { maxNumber };
}

const PULL_NUMBER = /\/pulls\/(\d+)(?:[/?]|$)/;

// The own-tests count reads merged pull requests and the latest CI run through `gh pr list` and `gh run list`, not the API. A
// resumed run answers those two reads from the capture as well; a list that asks for anything else goes live as it is.
const flagOf = (args, name) => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const fieldsOf = (args) => String(flagOf(args, '--json') ?? '').split(',').filter(Boolean);
const only = (args, allowed) => { const fields = fieldsOf(args); return fields.length > 0 && fields.every((f) => allowed.includes(f)); };
const limitOf = (args) => Number(flagOf(args, '--limit') ?? 30);
const isList = (args, noun, state) => args[0] === noun && args[1] === 'list' && flagOf(args, state[0]) === state[1];

// `gh` as a resumed run sees it (spec section 3.5): what was captured at the snapshot answers for what the fresh repository cannot
// hold (merged pull requests, their commits and statuses), joined with whatever is live and new. Lists give the captured items
// plus live ones numbered above `maxNumber`, or in `reopened` (pull requests opened again at their old numbers, read live), and
// runs made after `since`. A captured item answers its own path. Everything else, and every call that writes, goes live.
export function snapshotGh(gh, { capture = {}, maxNumber = 0, reopened = [], since } = {}) {
  const again = new Set(reopened);
  const fresh = (p) => p.number > maxNumber || again.has(p.number);
  // `gh pr list --state merged --json number,mergeCommit,files`: the merges captured, then those made since (or opened again).
  const mergedList = async (args) => {
    const live = await gh(args);
    if (!Array.isArray(live)) return live;
    const base = flagOf(args, '--base');
    const old = (capture[PULLS] ?? []).filter((p) => p.merged_at && !again.has(p.number) && (base === undefined || p.base?.ref === base)).map((p) => ({
      number: p.number,
      mergeCommit: p.merge_commit_sha ? { oid: p.merge_commit_sha } : null,
      files: (capture[`${REPO}/pulls/${p.number}/files?per_page=100`] ?? []).map((f) => ({ path: f.filename })),
    }));
    const wanted = new Set(fieldsOf(args));
    return [...live.filter(fresh), ...old].sort((a, b) => b.number - a.number).slice(0, limitOf(args))
      .map((p) => Object.fromEntries(Object.entries(p).filter(([k]) => wanted.has(k))));
  };
  // `gh run list --status completed --json conclusion`: runs made since come first, and the capture fills what is left.
  const completedRuns = async (args) => {
    const live = await gh(args);
    if (!Array.isArray(live) || live.length >= limitOf(args)) return live;
    const branch = flagOf(args, '--branch');
    const old = (capture[RUNS]?.workflow_runs ?? []).filter((r) => r.status === 'completed' && (branch === undefined || r.head_branch === branch))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map((r) => ({ conclusion: r.conclusion }));
    return [...live, ...old].slice(0, limitOf(args));
  };
  return async (args) => {
    if (isList(args, 'pr', ['--state', 'merged']) && only(args, ['number', 'mergeCommit', 'files'])) return mergedList(args);
    if (isList(args, 'run', ['--status', 'completed']) && only(args, ['conclusion'])) return completedRuns(args);
    // A read is exactly `api <path>`; a header, a method, a field or any other command is passed on as it is.
    if (args[0] !== 'api' || args.length !== 2 || typeof args[1] !== 'string') return gh(args);
    const key = args[1];
    if (key === PULLS) {
      const live = (await gh(args)) ?? [];
      const old = (capture[PULLS] ?? []).filter((p) => !again.has(p.number));
      return [...live.filter(fresh), ...old].sort((a, b) => b.number - a.number);
    }
    if (key === RUNS) {
      const live = (await gh(args))?.workflow_runs ?? [];
      const old = capture[RUNS]?.workflow_runs ?? [];
      const after = since === undefined ? () => true : (r) => Date.parse(r.created_at) > Date.parse(since);
      return { workflow_runs: [...live.filter(after), ...old] };
    }
    const n = PULL_NUMBER.exec(key)?.[1];
    if (key in capture && !(n !== undefined && again.has(Number(n)))) return capture[key];
    return gh(args);
  };
}

// --- the fresh repository ---

export class NumberDrift extends Error {}

// What GitHub shows of a branch's protection, as the body that sets it: the read has extra fields and nested objects the write
// does not take. Nothing is set when there was no protection.
export function protectionBody(got) {
  if (!got) return null;
  const checks = got.required_status_checks;
  const reviews = got.required_pull_request_reviews;
  const who = (list) => (list ?? []).map((x) => x.login ?? x.slug);
  return {
    required_status_checks: checks ? { strict: checks.strict === true, contexts: checks.contexts ?? (checks.checks ?? []).map((c) => c.context) } : null,
    enforce_admins: got.enforce_admins?.enabled === true,
    required_pull_request_reviews: reviews ? {
      required_approving_review_count: reviews.required_approving_review_count ?? 0,
      dismiss_stale_reviews: reviews.dismiss_stale_reviews === true,
      require_code_owner_reviews: reviews.require_code_owner_reviews === true,
    } : null,
    restrictions: got.restrictions ? { users: who(got.restrictions.users), teams: who(got.restrictions.teams), apps: who(got.restrictions.apps) } : null,
  };
}

// Makes the repository again from a snapshot (spec section 3.4 step 6), in this order: create it, push every branch and tag from
// the mirror, line the numbers up, then apply the settings, last so the pushes are not refused. Numbers 1 to `maxNumber` are
// each an open pull request opened again from its pushed head, or an issue that stands for what was there and is closed at once,
// paced at one a second. A number that comes back different stops the rebuild: counts from then on would be wrong.
export async function rebuildGithub({ github, slug, src, maxNumber, open = [], attempt, snapshot, sleep = async () => {} }) {
  await github.create({ slug, public: true, description: 'A throwaway project for the Haiku trial' });
  await github.pushMirror({ dir: path.join(src, 'mirror.git'), remote: `https://github.com/${slug}.git` });
  const reopened = [];
  for (let n = 1; n <= maxNumber; n += 1) {
    const pull = open.find((p) => p.number === n);
    const made = pull
      ? await github.openPull({ slug, head: pull.head, base: pull.base, title: pull.title, body: pull.body, draft: pull.draft })
      : await github.placeholder({ slug, title: `Stands for #${n} in attempt ${attempt}, resumed from ${snapshot}` });
    if (made?.number !== n) throw new NumberDrift(`number ${n} came back as ${made?.number}: the fresh repository is out of step with the snapshot`);
    if (pull) reopened.push(n);
    await sleep(1000);
  }
  let settings = { repo: {}, protection: null, rulesets: [] };
  try { settings = JSON.parse(fs.readFileSync(path.join(src, 'settings.json'), 'utf8')); } catch { /* none was captured */ }
  await github.applySettings({ slug, settings });
  return { reopened };
}
