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
    stop: post('/stop/set'), //      { by?, wait? } -> { ok, engine? }: turns STOP on, then the engine's runs are cancelled; nothing here lifts it. `by: 'prompt'` records that the director's word set it, `by: 'runbook'` the runbook; `wait: true` waits for the engine and gives what it cancelled
    session: {
      mark: post('/session/mark'), // { project | cwd, mark, data } -> { ok, id }: a session's mark, as a plain note: 'unknown-tool' ({ name }), 'compaction' ({ trigger }) or 'deadline' ({ event })
    },
    cards: {
      chatClick: post('/cards/chat-click'), // { project | cwd, card, hash, label, proof, commit?, text? } -> { ok, id }: a click in the chat, as an unsigned card-answer naming its proof; never signed. `text`, the director's words, only with Suggest a change…
    },
    // A Lean project's git store (scripts/lean/store.js). A refusal may add `card` (the id of a card the helper raised:
    // the main version moved outside the helper, or an approval the window must confirm), `needs` and `reasons`.
    // A merge runs the project's tests and may wait for another window's merge: give the client a long timeout.
    lean: {
      status: post('/lean/status'), // { project | cwd } -> { ok, adopted, main?, moved?, recorded?, card?, stop, copy, test, realUsers }; answered under STOP
      merge: post('/lean/merge'), //   { project | cwd, branch, commit } -> { ok, merge, tests: 'passed' | 'none', copy }: only an approved commit, after its tests pass
      undo: post('/lean/undo'), //     { project | cwd, merge } or { project | cwd, moved: true } -> { ok, undo, copy }: on the director's click on Undo (or Undo it)
      copy: post('/lean/copy'), //     { project | cwd } -> { ok, pushed, commit, refused? }: the main version and the state's branch to the copy folder
    },
    // { project | cwd, card, hash } -> { ok, recorded, choice, id?, kind?, step? }: the card, by its id in the state and the
    // sha256 of its data, shown in the helper's own window; a deciding click there is signed by the helper with proof
    // `window`. One window at a time on this computer, so this may wait for a click: give the client a long timeout.
    confirm: post('/confirm'),
    push: post('/push'), //          { project | cwd, dir, refspec }: a feature session's `cli.js push` and `open-pr` give their worktree as `cwd`, and the helper places the project
    pull: post('/pull'), //          { project | cwd, dir, branch } -> { ok, already } or { ok, already: false, merged, from, sha, bundle }, or { ok: false, refused, conflicts? }: `cli.js pull` brings the host's copy of the worktree's own feature branch in; `bundle` (base64) holds the commits the worktree lacks, under refs/wheelhouse/pulled
    fetchBase: post('/base/fetch'), // { project } -> { ok, branch, sha } or { ok: false, refused }: the foreman's start has the host's default branch fetched into the project's mirror (refs/wheelhouse/base), which its child then copies into the main checkout with no key
    foreman: {
      run: post('/foreman/run'), // { folder, script: 'act' | 'wake', argv } -> { ok, code, stdout, stderr }: the foreman's command, run by the helper outside the sandbox; `folder` must be the project's main checkout; answered under STOP
    },
    ciPushLine: post('/ci-push/line'), // { project, branch, sha } -> { ok, line }
    // /push, /pull, /pr/open, /state/answer and /config take `cwd`, a full
    // path, in place of or beside `project`, and the helper places the project from it (scripts/feature/cli.js
    // runs where ~/.wheelhouse cannot be read); given both, the folder must be in the project named.
    openPr: post('/pr/open'), //     { project | cwd, head, base?, title, body, session }: no base means the default branch; the helper records what built it, from the session's provenance on this computer, in the signed state (never in the body, from which any block is taken out), and refuses a session with none
    updatePr: post('/pr/update'), // { project, number, title?, body?, session }: a new body has any block taken out; a session with no provenance on this computer is refused
    updateBranch: post('/pr/update-branch'), // { project, number } -> { ok, updated, head }, or { ok: false, refused, conflicts?, ciPush?: { branch, sha } }: merges the default branch in; refused under STOP; ciPush names the merge commit the director's CI card must approve
    carried: post('/pr/carried'), // { project, number } -> { ok, review: 'clean' | 'none', upToDate, earlier }: the gate's carry-over rule, counting only a review of a kind the gate counts for this computer's agent, read-only, answered under STOP; with no CLEAN review to weigh, 'none' and upToDate false, unread; earlier: a CLEAN review of an earlier commit is on record
    prState: post('/pr/state'), //   { project, number } (or `cwd` for `project`, as the runbook's)
    preview: post('/pr/preview'), // { project | cwd, number } -> { ok, url: address | null }: the preview of the open pull request's head, for the front desk's Show me; null when it isn't open or has none; read-only, answered under STOP
    ci: post('/ci'), //              { project, sha }
    testMerge: post('/test-merge'), // { project, a, b } -> { ok, clean, conflicts }: read-only, answered under STOP
    config: post('/config'), //      { project | cwd } -> { ok, config }: the default branch's, read-only, answered under STOP
    host: {
      facts: post('/host/facts'), // { project } -> { ok, protection: 'on' | 'none' | 'unknown', ci: 'present' | 'none' | 'unknown', plan?, gaps? } (the last two on GitLab)
    },
    merge: post('/merge'), //        { project, number, stop, bypass, reviewRequired?, approvalRequired?, touchesGuardrails? } -> a refusal's needs?: { approval: { pr, commit } } names the director's approval it lacks, and releaseApproval? says why a release pull request needs it (not one of the reasons)
    review: post('/review/run'), //   { project, number } -> { ok, started } or { ok, running }: the helper's own reviewer, in a clean session, of the open pull request's head; refused under STOP, where the agent's clean session isn't switched on, and for a head with a signed review or three failed runs (one review per commit); the signed review, or a note saying why there is none, follows in the background
    // The build engine's runs (scripts/engine/routes.js). A step names its run, never its project.
    engine: {
      start: post('/engine/start'), // { project, order, branch?, carryOn? } -> { ok, runId }: starts a run of the work order, keeps the order under the run's id and records the start
      order: post('/engine/order'), // { runId } -> { ok, order }: the run's work order as the helper keeps it; refused for a run it didn't start
      review: post('/engine/review'), // { runId, step } -> { ok, ran, verdict?, posted? }: signs the review step from the engine's record and posts the merge queue's verdict once every lens that ran is CLEAN
    },
    // The desk (scripts/desk/, spec 5): every front end's one way in. Each body names `v: 'desk/1'` and `project` or `cwd`.
    desk: {
      read: post('/desk/read'), //   { v, project | cwd, view, args } -> { ok, v, view, data, lines }: a view, finished
      act: post('/desk/act'), //     { v, project | cwd, command, args, evidence } -> { ok, v, changed } or { ok: false, v, refused }
      watch: post('/desk/watch'), // { v, project | cwd, cursor } -> { ok, v, events, cursor }: the changes since the cursor
    },
    state: {
      clone: post('/state/clone'), //   { project }: opens the project's private record, making it the first time
      write: post('/state/write'), //   { project, kind, data, id? }: a plain kind; the helper makes the event, with the caller's id when one is given (a random UUID the state does not hold); `cwd` may stand for `project`
      record: post('/state/record'), // { project, event, target? }: a signed event made by this computer's hook; a confirmation may carry the plain ruling or setting it confirms
      sync: post('/state/sync'), //     { project } -> { ok, pulled: 0, unpushed: 0 }: the record has no remote, so nothing to do
      import: post('/state/import'), // { project } -> { ok, done, at?, imported, held, unsigned, unreadable }: v0.1.x's state clone imported once (design section 24.5); refused under STOP
      views: post('/state/views'), //   { project, cards?, review?, answers? } -> { ok, views, cards?, review?, answers? }: with cards: true, the card events too; with review: true, the delegation review, { due, since, proposals }; with answers: true, the card-answer events; `cwd` may stand for `project`
      answer: post('/state/answer'), // { project | cwd, questionId } -> { ok, answer: label | null }: a verified answer only, read-only, answered under STOP
      columnReady: post('/state/column-ready'), // { project, column, pins, records } -> { ok, id, pushed }: a Thoroughness level ready (lean or lightest) or the premium model's pass (premium), recorded only when the helper's own read of the evaluation's records finds the whole bar passed on the project's pins now; refused under STOP
    },
    // The premium model's opt-in (design section 14.6, scripts/routing/premium.js); `cwd` may stand for `project`.
    premium: {
      card: post('/premium/card'), //   { project | cwd } -> { ok, offered, line? | why? }: the premium model's card, composed and its offer recorded signed by the helper, at Thorough only and never where the account is known not to have it; refused under STOP
      check: post('/premium/check'), // { project | cwd } -> { ok, checked, found?, model? | why? }: after the director's Yes, the helper asks Claude Code what its premium alias stands for and records what it found as the premium pin; never within the plan alone, which might be paid from credits; refused under STOP
      state: post('/premium/state'), // { project | cwd } -> { ok, value, pin, failed, yes, pins }: the premium setting in force, the pin the helper's check found for it, whether its evaluation failed under this Yes, the Yes's id, and the configuration's two pins
      failed: post('/premium/failed'), // { project | cwd } -> { ok, recorded, failed? | why? }: the helper reads the premium evaluation's records itself and, on a handled failure, records it once per Yes, which brings the director one card; refused under STOP
    },
    // The director's settings on this computer (design section 24.2): a record with no remote.
    profile: {
      clone: post('/profile/clone'), //   {} -> { ok }: opens the settings record, making it the first time
      write: post('/profile/write'), //   { kind: 'setting', data }: a setting whose home is the profile
      record: post('/profile/record'), // { event }: a signed confirmation of a settings event
      sync: post('/profile/sync'), //     {} -> { ok, pulled: 0, unpushed: 0 }: nothing to do
      views: post('/profile/views'), //   {} -> { ok, views }
      import: post('/profile/import'), // {} -> { ok, done, at?, imported, held, unsigned, unreadable }: v0.1.x's profile clone imported once; refused under STOP
    },
    lock: {
      take: post('/lock/take'), //   { project } -> { ok, result: { taken, ... } }
      touch: post('/lock/touch'), // { project } -> { ok, result: { touched } }
      takeOver: post('/lock/take-over'), // { project } -> { ok, result: { taken, ... } }: on this computer's signed Take over here
      read: post('/lock/read'), //   { project } -> { ok, result: the lock, or null }
    },
    // Each runbook request names its project, or gives `cwd`, a full path, and the helper
    // places the project from it (runbook.js runs where ~/.wheelhouse cannot be read); given
    // both, the folder must be in the project named.
    runbook: {
      cutAccess: post('/runbook/cut-access'), //     { project } -> { ok, message, url? }: step 2
      restoreMain: post('/runbook/restore-main'), // { project, sha } -> { ok, number, url, branch }: step 3, opens the pull request
      restoreMerge: post('/runbook/restore-merge'), // { project, number }: step 3, merges the restore pull request
      restoreState: post('/runbook/restore-state'), // { project } -> { ok: false, refused }: step 4, retired (no backup is kept)
      contain: post('/runbook/contain'), //          { project } -> { ok, message, output? }: step 5
      candidates: post('/runbook/candidates'), //    { project } -> { ok, candidates: [{ sha, sha12, at, title }] }
    },
    // Setup's routes (scripts/setup/engine.js). Each names the folder being set up, a full path.
    setup: {
      plan: post('/setup/plan'), //     { folder, step } -> { ok, changes, hash, card, director }: read-only, answered under STOP
      apply: post('/setup/apply'), //   { folder, step, hash } -> { ok, started }: only after the director's click on the card naming that hash; refused under STOP
      status: post('/setup/status'), // { folder } -> { ok, lines, next, ask }: the folder's run as plain lines, answered under STOP
      health: post('/setup/health'), // { folder, lines } -> { ok, green, lines, board, trials, started?, briefing?, requests? }: step 10's board, answered under STOP
      choices: post('/setup/choices'), // { folder } -> { ok, choices }: every choice of the run (design section 15.1), answered under STOP
      change: post('/setup/change'), //   { folder, key } -> { ok, asks }: the card that changes one choice, answered under STOP
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
    // The survey of what the project already holds (scripts/survey/take.js, design section 15).
    survey: {
      again: post('/survey/again'), // { project } -> { ok, taken, id?, hostReached? }: when the latest survey missed the host and was not itself taken again, one more is taken and recorded (plan ruling P3); reads the project only; refused under STOP, since it writes to the state
      // A change made ready to start work from (scripts/survey/ready.js): the ref refs/wheelhouse/from/<work> in the project's folder and its ready record, nothing else; refused under STOP; `cwd` may stand for `project`.
      carryOn: post('/survey/carry-on'), // { project | cwd, number } -> { ok, work, from: { sha, ref, request }, branch, fork, title, body, bodyWithheld, files, commits }: open request `number`, fetched by the host's ref for it and checked against its head; or { project | cwd, line } -> { ok, work, from: { sha, ref }, branch, where, moved, commits, files }: the piece of unfinished work the latest survey lists by that name, fetched when pushed, pointed at when on this computer
      archive: post('/survey/archive'), // { project | cwd } -> { ok, work, from: { sha, ref }, moved }: the survey's instruction files that are plain files on the default branch now, moved into .wheelhouse-archive/
      restore: post('/survey/restore'), // { project | cwd } -> { ok, work, from: { sha, ref }, moved }: the archive put back, as uninstall reads it
    },
    issue: {
      create: post('/issue/create'), // { project, title, body, labels? }
      update: post('/issue/update'), // { project, number, body }
      list: post('/issue/list'), //     { project, label }
    },
  };
}
