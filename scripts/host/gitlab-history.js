// scripts/host/gitlab-history.js
// The read-only calls the audit report makes of GitLab (scripts/audit/report.js): the merge
// requests merged since a time, the pipelines of a commit, and the changes to the project's
// protection. They read through `glab api` and keep only the fields the report needs: nothing
// GitLab said is passed on whole, and no call here writes.
//
// Protection changes come two ways. Where the licence has audit events (Premium and Ultimate), the
// project's audit events say who changed what and when. At Free there are none (check 71, step 5:
// HTTP 403 for a Maintainer), so the protection is read now and compared with the protection the
// last report kept (the caller keeps it: scripts/audit/protection-log.js).

const PER_PAGE = 100;
const MOST_PAGES = 20;
const MOST_PIPELINES = 20;
const MOST_REQUESTS_OF_A_COMMIT = 5;
const TITLE_CHARS = 160;
const WHAT_CHARS = 160;

const LEVEL_NAMES = new Map([[0, 'No one'], [30, 'Developers + Maintainers'], [40, 'Maintainers'], [60, 'Administrators']]);
const levelWords = (levels) => { const l = Array.isArray(levels) ? levels : []; return l.length === 0 ? 'no one' : l.map((x) => LEVEL_NAMES.get(x) ?? `level ${x}`).join(', '); };

// Text from the host cut to a line: control characters gone, runs of space made one, cut short.
const oneLine = (text, most) => {
  const line = String(text ?? '').replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  return line.length > most ? `${line.slice(0, most)}...` : line;
};
const userName = (user) => (typeof user?.username === 'string' && user.username !== '' ? oneLine(user.username, 80) : null);
const time = (value) => {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

// The audit events that say the protection changed: a protected branch, an approval rule, a push
// rule, an external check, or one of the project's merge settings.
const PROTECTION_EVENT = /protected[_ ](?:branch|tag)|approval|push[_ ]rule|status[_ ]check|code[_ ]owner|only_allow_merge|allow_merge_on_skipped|force[_ ]push|merge[_ ]request[_ ](?:setting|approval)|branch[_ ]protection/i;

// The branches' protection and the project's merge settings, as the comparison keeps them.
const levelsOf = (list) => [...new Set((Array.isArray(list) ? list : []).map((l) => l?.access_level).filter(Number.isInteger))].sort((a, b) => a - b);

export function compareProtection(last, now) {
  if (last === null || typeof last !== 'object' || typeof now !== 'object' || now === null) return [];
  const changes = [];
  const before = last.branches ?? {};
  const after = now.branches ?? {};
  for (const name of Object.keys(after).sort()) {
    const b = after[name];
    if (!Object.hasOwn(before, name)) {
      changes.push(`${name} is now protected: pushes by ${levelWords(b.push)}, merges by ${levelWords(b.merge)}, force-push ${b.force ? 'allowed' : 'not allowed'}`);
      continue;
    }
    const a = before[name];
    if (levelWords(a.push) !== levelWords(b.push)) changes.push(`${name}: who may push changed from ${levelWords(a.push)} to ${levelWords(b.push)}`);
    if (levelWords(a.merge) !== levelWords(b.merge)) changes.push(`${name}: who may merge changed from ${levelWords(a.merge)} to ${levelWords(b.merge)}`);
    if (a.force !== b.force) changes.push(`${name}: force-push is now ${b.force ? 'allowed' : 'not allowed'}`);
  }
  for (const name of Object.keys(before).sort()) {
    if (!Object.hasOwn(after, name)) changes.push(`${name} is no longer protected`);
  }
  if (last.pipelinesMustSucceed !== now.pipelinesMustSucceed) {
    changes.push(`"pipelines must succeed" was switched ${now.pipelinesMustSucceed ? 'on' : 'off'}`);
  }
  if (last.skippedPipelineCounts !== now.skippedPipelineCounts) {
    changes.push(`a skipped pipeline now ${now.skippedPipelineCounts ? 'counts' : 'does not count'} as passed`);
  }
  return changes;
}

export function gitlabHistory({ ask, read, project }) {
  // Every page of a list, up to a limit past which the list is too long to read whole (said, never
  // cut short without saying).
  async function pages(path) {
    const joiner = path.includes('?') ? '&' : '?';
    const all = [];
    for (let page = 1; page <= MOST_PAGES; page += 1) {
      const got = await ask(['api', `${path}${joiner}per_page=${PER_PAGE}&page=${page}`]);
      if (!Array.isArray(got)) throw new Error('GitLab did not answer with a list');
      all.push(...got);
      if (got.length < PER_PAGE) return all;
    }
    throw new Error(`GitLab has more than ${MOST_PAGES * PER_PAGE} entries here, more than the report reads`);
  }

  const pipelineOf = (p) => (Number.isInteger(p?.id)
    ? { id: p.id, status: typeof p.status === 'string' ? p.status : 'unknown', source: typeof p.source === 'string' ? p.source : null, ref: typeof p.ref === 'string' ? oneLine(p.ref, 120) : null, sha: typeof p.sha === 'string' ? p.sha : null }
    : null);

  async function snapshot(now) {
    const branches = {};
    for (const b of await pages(`${project}/protected_branches`)) {
      if (typeof b?.name !== 'string') continue;
      branches[b.name] = { push: levelsOf(b.push_access_levels), merge: levelsOf(b.merge_access_levels), force: b.allow_force_push === true };
    }
    const settings = await ask(['api', project]);
    return {
      at: now.toISOString(),
      branches,
      pipelinesMustSucceed: settings?.only_allow_merge_if_pipeline_succeeds === true,
      skippedPipelineCounts: settings?.allow_merge_on_skipped_pipeline === true,
    };
  }

  return {
    // The merge requests merged at or after `since` (an ISO time), newest first.
    async mergedRequests({ since }) {
      const listed = await pages(`${project}/merge_requests?state=merged&updated_after=${encodeURIComponent(since)}&order_by=updated_at&sort=desc`);
      const from = Date.parse(since);
      return listed
        .filter((r) => Number.isInteger(r?.iid) && r.iid > 0 && !(Date.parse(r.merged_at) < from))
        .map((r) => ({
          number: r.iid,
          title: oneLine(r.title, TITLE_CHARS),
          url: typeof r.web_url === 'string' ? r.web_url : null,
          mergedAt: time(r.merged_at),
          mergedBy: userName(r.merged_by) ?? userName(r.merge_user),
          author: userName(r.author),
          target: typeof r.target_branch === 'string' ? r.target_branch : null,
          sha: typeof r.sha === 'string' ? r.sha : null,
          mergeCommit: typeof r.merge_commit_sha === 'string' ? r.merge_commit_sha : null,
        }));
    },

    // The pipelines of a commit, newest first: those GitLab lists for the commit, and the head
    // pipeline of each merge request the commit is in (a merged-results pipeline runs on a commit of
    // its own, so the commit's list does not hold it). A failed read is thrown, never read as none.
    async pipelinesFor(sha) {
      const found = new Map();
      const listed = await ask(['api', `${project}/pipelines?sha=${sha}&per_page=${MOST_PIPELINES}&order_by=id&sort=desc`]);
      if (!Array.isArray(listed)) throw new Error('GitLab did not list the commit\'s pipelines');
      for (const p of listed) { const one = pipelineOf(p); if (one) found.set(one.id, one); }
      const requests = await ask(['api', `${project}/repository/commits/${sha}/merge_requests`]);
      if (!Array.isArray(requests)) throw new Error('GitLab did not list the commit\'s merge requests');
      for (const r of requests.filter((q) => Number.isInteger(q?.iid)).slice(0, MOST_REQUESTS_OF_A_COMMIT)) {
        const full = await ask(['api', `${project}/merge_requests/${r.iid}`]);
        const one = pipelineOf(full?.head_pipeline);
        if (one) found.set(one.id, one);
      }
      return [...found.values()].sort((a, b) => b.id - a.id);
    },

    // Changes to the project's protection since `since`. With audit events (Premium and Ultimate):
    // `{ source: 'audit-events', events: [{ at, by, what }] }`. Without (Free, or a key too low to read
    // them): the protection read now, and compared with `last`, the protection the last report kept:
    // `{ source: 'compared', first, snapshot, events: [{ at: null, by: null, what, between }] }`. `first`
    // is true when there was no earlier reading to compare with.
    async protectionEvents({ since, last = null, now = new Date() }) {
      const auditPath = `${project}/audit_events?created_after=${encodeURIComponent(since)}`;
      const audit = await read(['api', `${auditPath}&per_page=${PER_PAGE}&page=1`]);
      if (audit.status === 200) {
        if (!Array.isArray(audit.body)) throw new Error('GitLab did not answer the audit events with a list');
        // The first page said yes; a full page may have more after it.
        const listed = audit.body.length < PER_PAGE ? audit.body : await pages(auditPath);
        const events = listed
          .map((e) => ({ e, name: `${e?.event_name ?? ''} ${e?.event_type ?? ''} ${e?.details?.event_name ?? ''} ${e?.details?.custom_message ?? ''}` }))
          .filter(({ name }) => PROTECTION_EVENT.test(name))
          .map(({ e }) => ({
            at: time(e.created_at),
            by: typeof e?.details?.author_name === 'string' ? oneLine(e.details.author_name, 80) : null,
            what: oneLine(e?.details?.custom_message ?? e?.details?.event_name ?? e?.event_name ?? e?.event_type ?? 'a protection setting changed', WHAT_CHARS),
          }));
        return { source: 'audit-events', events };
      }
      // Free is told by the refusal (check 71, step 5), and an edition with no audit events at all by
      // not finding them; any other refusal means the changes cannot be read.
      if (audit.status !== 403 && audit.status !== 404) throw new Error(`GitLab answered ${audit.status} to the list of audit events`);
      const snap = await snapshot(now);
      const between = last === null ? null : [last.at ?? null, snap.at];
      return {
        source: 'compared',
        first: last === null,
        snapshot: snap,
        events: compareProtection(last, snap).map((what) => ({ at: null, by: null, what, between })),
      };
    },
  };
}
