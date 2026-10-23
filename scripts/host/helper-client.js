// scripts/host/helper-client.js
// How agents and Wheelhouse's own scripts ask the host helper for something.
// Each call resolves with the helper's answer, `{ ok: true, ... }` or
// `{ ok: false, refused }`, and never rejects: a helper that cannot be reached
// is an answer too.
import http from 'node:http';
import { helperAddress } from '../lib/paths.js';

function ask(address, method, path, body, timeout) {
  return new Promise((resolve) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({
      socketPath: address,
      agent: false, // a fresh connection each time: a kept one may outlive the helper
      method,
      path,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const answer = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(answer && typeof answer === 'object' ? answer : { ok: false, refused: 'the host helper gave an answer this could not read' });
        } catch {
          resolve({ ok: false, refused: 'the host helper gave an answer this could not read' });
        }
      });
      res.on('error', () => resolve({ ok: false, refused: 'the host helper\'s answer was cut off' }));
    });
    req.on('error', () => resolve({ ok: false, refused: 'the host helper could not be reached: is it running?' }));
    if (timeout !== undefined) {
      // A helper that does not answer in time is an answer too.
      req.setTimeout(timeout, () => {
        resolve({ ok: false, refused: 'the host helper did not answer in time' });
        req.destroy();
      });
    }
    req.end(payload);
  });
}

export function helperClient({ address = helperAddress(), timeout } = {}) {
  const post = (path) => (args = {}) => ask(address, 'POST', path, args, timeout);
  return {
    health: () => ask(address, 'GET', '/health', undefined, timeout),
    stop: post('/stop/set'), //      { by? } -> { ok }: turns STOP on; nothing here lifts it. `by: 'prompt'` records that the director's word set it
    session: {
      mark: post('/session/mark'), // { project | cwd, mark, data } -> { ok, id }: a session's mark, as a plain note: 'unknown-tool' ({ name }), 'compaction' ({ trigger }) or 'deadline' ({ event })
    },
    cards: {
      chatClick: post('/cards/chat-click'), // { project | cwd, card, hash, label, proof, commit? } -> { ok, id }: a click in the chat, as an unsigned card-answer naming its proof; never signed
    },
    // { project | cwd, card, hash } -> { ok, recorded, choice, id?, kind?, step? }: the card, by its id in the state and the
    // sha256 of its data, shown in the helper's own window; a deciding click there is signed by the helper with proof
    // `window`. One window at a time on this computer, so this may wait for a click: give the client a long timeout.
    confirm: post('/confirm'),
    push: post('/push'), //          { project | cwd, dir, refspec }: a feature session's `cli.js push` and `open-pr` give their worktree as `cwd`, and the helper places the project
    pull: post('/pull'), //          { project | cwd, dir, branch } -> { ok, already } or { ok, already: false, merged, from, sha, bundle }, or { ok: false, refused, conflicts? }: `cli.js pull` brings the host's copy of the worktree's own feature branch in; `bundle` (base64) holds the commits the worktree lacks, under refs/wheelhouse/pulled
    foreman: {
      run: post('/foreman/run'), // { folder, script: 'act' | 'wake', argv } -> { ok, code, stdout, stderr }: the foreman's command, run by the helper outside the sandbox; `folder` must be the project's main checkout; answered under STOP
    },
    ciPushLine: post('/ci-push/line'), // { project, branch, sha } -> { ok, line }
    // /push, /pull, /pr/open, /state/answer, /lineage/provenance and /config take `cwd`, a full
    // path, in place of or beside `project`, and the helper places the project from it (scripts/feature/cli.js
    // runs where ~/.wheelhouse cannot be read); given both, the folder must be in the project named.
    openPr: post('/pr/open'), //     { project | cwd, head, base?, title, body, session }: no base means the default branch; the helper stamps the body with what built it, from the session's provenance on this computer, and refuses a session with none
    updatePr: post('/pr/update'), // { project, number, title?, body?, session }: a new body is stamped as openPr's is; a session with no provenance on this computer is refused
    updateBranch: post('/pr/update-branch'), // { project, number } -> { ok, updated, head }, or { ok: false, refused, conflicts?, ciPush?: { branch, sha } }: merges the default branch in; refused under STOP; ciPush names the merge commit the director's CI card must approve
    carried: post('/pr/carried'), // { project, number } -> { ok, review: 'clean' | 'none', upToDate, earlier }: the gate's carry-over rule, read-only, answered under STOP; with no CLEAN review to weigh, 'none' and upToDate false, unread; earlier: a CLEAN review of an earlier commit is on record
    prState: post('/pr/state'), //   { project, number } (or `cwd` for `project`, as the runbook's)
    preview: post('/pr/preview'), // { project | cwd, number } -> { ok, url: address | null }: the preview of the open pull request's head, for the front desk's Show me; null when it isn't open or has none; read-only, answered under STOP
    ci: post('/ci'), //              { project, sha }
    testMerge: post('/test-merge'), // { project, a, b } -> { ok, clean, conflicts }: read-only, answered under STOP
    config: post('/config'), //      { project | cwd } -> { ok, config }: the default branch's, read-only, answered under STOP
    lineage: {
      provenance: post('/lineage/provenance'), // { project | cwd, session } -> { ok, block: text | null, stop }: the block a pull request from the session is stamped with, and whether STOP is on; read-only, answered under STOP
    },
    host: {
      facts: post('/host/facts'), // { project } -> { ok, protection: 'on' | 'none' | 'unknown', ci: 'present' | 'none' | 'unknown', plan?, gaps? } (the last two on GitLab)
    },
    merge: post('/merge'), //        { project, number, stop, bypass, reviewRequired?, approvalRequired?, touchesGuardrails? } -> a refusal's needs?: { approval: { pr, commit } } names the director's approval it lacks, and releaseApproval? says why a release pull request needs it (not one of the reasons)
    state: {
      clone: post('/state/clone'), //   { project }
      write: post('/state/write'), //   { project, kind, data, id? }: a plain kind; the helper makes the event, with the caller's id when one is given (a random UUID the state does not hold); `cwd` may stand for `project`
      record: post('/state/record'), // { project, event, target? }: a signed event made by this computer's hook; a confirmation may carry the plain ruling or setting it confirms
      sync: post('/state/sync'), //     { project } -> { ok, pulled, unpushed }
      views: post('/state/views'), //   { project, cards?, review?, answers? } -> { ok, views, cards?, review?, answers? }: with cards: true, the card events too; with review: true, the delegation review, { due, since, proposals }; with answers: true, the card-answer events; `cwd` may stand for `project`
      backup: post('/state/backup'), // { project } -> { ok, file, made }: this week's bundle, into the profile
      answer: post('/state/answer'), // { project | cwd, questionId } -> { ok, answer: label | null }: a verified answer only, read-only, answered under STOP
    },
    // The director's profile. Each answers { ok: false, why } while the profile isn't set up.
    profile: {
      clone: post('/profile/clone'), //   {} -> { ok, made }
      write: post('/profile/write'), //   { kind: 'setting', data }: a setting whose home is the profile
      record: post('/profile/record'), // { event }: a signed confirmation of a profile event
      sync: post('/profile/sync'), //     {} -> { ok, pulled, unpushed, refused? }: commits new bundles, pulls and pushes
      views: post('/profile/views'), //   {} -> { ok, views }
      enrolments: post('/profile/enrolments'), // {} -> { ok, fetched, enrolments: [{ computer, publicKey, at }] }: each computer's key as the fetched profile holds it, trusted only on the director's click
    },
    lock: {
      take: post('/lock/take'), //   { project } -> { ok, result: { taken, ... } }
      touch: post('/lock/touch'), // { project } -> { ok, result: { touched } }
      read: post('/lock/read'), //   { project } -> { ok, result: the lock, or null }
    },
    // Each runbook request names its project, or gives `cwd`, a full path, and the helper
    // places the project from it (runbook.js runs where ~/.wheelhouse cannot be read); given
    // both, the folder must be in the project named.
    runbook: {
      cutAccess: post('/runbook/cut-access'), //     { project } -> { ok, message, url? }: step 2
      restoreMain: post('/runbook/restore-main'), // { project, sha } -> { ok, number, url, branch }: step 3, opens the pull request
      restoreMerge: post('/runbook/restore-merge'), // { project, number }: step 3, merges the restore pull request
      restoreState: post('/runbook/restore-state'), // { project } -> { ok, added, skipped }: step 4
      contain: post('/runbook/contain'), //          { project } -> { ok, message, output? }: step 5
      candidates: post('/runbook/candidates'), //    { project } -> { ok, candidates: [{ sha, sha12, at, title }] }
    },
    // Setup's routes (scripts/setup/engine.js). Each names the folder being set up, a full path.
    setup: {
      plan: post('/setup/plan'), //     { folder, step } -> { ok, changes, hash, card, director }: read-only, answered under STOP
      apply: post('/setup/apply'), //   { folder, step, hash } -> { ok, started }: only after the director's click on the card naming that hash; refused under STOP
      status: post('/setup/status'), // { folder } -> { ok, lines, next, ask }: the folder's run as plain lines, answered under STOP
      health: post('/setup/health'), // { folder, lines } -> { ok, green, lines, board, trials, started?, briefing? }: step 10's board, answered under STOP
      // Uninstall (scripts/setup/uninstall.js), naming the folder, a full path.
      uninstall: {
        plan: post('/setup/uninstall/plan'), //     { folder } -> { ok, hash, card, asks, last } | { ok, lines }: the lines, with no card, once an uninstall cut short past the trusted-keys list's removal needs a new session first (ruling R146); answered under STOP
        apply: post('/setup/uninstall/apply'), //   { folder, hash } -> { ok, started }: only after the director's Remove it on the card naming that hash, the apply then running in its own process; refused under STOP
        status: post('/setup/uninstall/status'), // { folder } -> { ok, lines, uninstall?: { state, lines, pages, refused? }, helperStops? }: how a started uninstall stands, else the whole list; answered under STOP
      },
    },
    // The baseline from the private note (scripts/measures/baseline.js), per computer, no project.
    measures: {
      baseline: post('/measures/baseline'), // { usd, merges, from, to, counted } -> { ok, hash, card }: the card reading them back; or { confirm: hash } -> { ok, recorded }: only after the director's click on Record these on that card
    },
    issue: {
      create: post('/issue/create'), // { project, title, body, labels? }
      update: post('/issue/update'), // { project, number, body }
      list: post('/issue/list'), //     { project, label }
    },
  };
}
