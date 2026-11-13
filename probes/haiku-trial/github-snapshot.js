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
    rulesets: (await gh(['api', `${REPO}/rulesets`])) ?? [],
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
