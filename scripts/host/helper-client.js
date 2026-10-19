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
    stop: post('/stop/set'), //      {} -> { ok }: turns STOP on; nothing here lifts it
    push: post('/push'), //          { project, dir, refspec }
    ciPushLine: post('/ci-push/line'), // { project, branch, sha } -> { ok, line }
    openPr: post('/pr/open'), //     { project, head, base?, title, body, session? }: no base means the default branch
    updatePr: post('/pr/update'), // { project, number, title?, body? }
    updateBranch: post('/pr/update-branch'), // { project, number }: brings the branch up to date with the default branch (the route comes with the gate's update, Task 21)
    prState: post('/pr/state'), //   { project, number } (or `cwd` for `project`, as the runbook's)
    ci: post('/ci'), //              { project, sha }
    testMerge: post('/test-merge'), // { project, a, b } -> { ok, clean, conflicts }: read-only, answered under STOP
    config: post('/config'), //      { project } -> { ok, config }: the default branch's, read-only, answered under STOP
    host: {
      facts: post('/host/facts'), // { project } -> { ok, protection: 'on' | 'none' | 'unknown', ci: 'present' | 'none' | 'unknown' }
    },
    merge: post('/merge'), //        { project, number, stop, bypass, reviewRequired?, approvalRequired?, touchesGuardrails? }
    state: {
      clone: post('/state/clone'), //   { project }
      write: post('/state/write'), //   { project, kind, data, id? }: a plain kind; the helper makes the event, with the caller's id when one is given (a random UUID the state does not hold); `cwd` may stand for `project`
      record: post('/state/record'), // { project, event }: a signed event made by this computer's hook
      sync: post('/state/sync'), //     { project } -> { ok, pulled, unpushed }
      views: post('/state/views'), //   { project, cards? } -> { ok, views, cards? }: with cards: true, the card events too; `cwd` may stand for `project`
      backup: post('/state/backup'), // { project } -> { ok, file, made }: this week's bundle, into the profile
      answer: post('/state/answer'), // { project, questionId } -> { ok, answer: label | null }: a verified answer only, read-only, answered under STOP
    },
    // The director's profile. Each answers { ok: false, why } while the profile isn't set up.
    profile: {
      clone: post('/profile/clone'), //   {} -> { ok, made }
      write: post('/profile/write'), //   { kind: 'setting', data }: a setting whose home is the profile
      record: post('/profile/record'), // { event }: a signed confirmation of a profile event
      sync: post('/profile/sync'), //     {} -> { ok, pulled, unpushed, refused? }: commits new bundles, pulls and pushes
      views: post('/profile/views'), //   {} -> { ok, views }
    },
    lock: {
      take: post('/lock/take'), //   { project } -> { ok, result: { taken, ... } }
      touch: post('/lock/touch'), // { project } -> { ok, result: { touched } }
      read: post('/lock/read'), //   { project } -> { ok, result: the lock, or null }
    },
    // Each runbook request names its project, or gives `cwd`, a full path, and the helper
    // places the project from it (runbook.js runs where ~/.wheelhouse cannot be read).
    runbook: {
      cutAccess: post('/runbook/cut-access'), //     { project } -> { ok, message, url? }: step 2
      restoreMain: post('/runbook/restore-main'), // { project, sha } -> { ok, number, url, branch }: step 3, opens the pull request
      restoreMerge: post('/runbook/restore-merge'), // { project, number }: step 3, merges the restore pull request
      restoreState: post('/runbook/restore-state'), // { project } -> { ok, added, skipped }: step 4
      contain: post('/runbook/contain'), //          { project } -> { ok, message, output? }: step 5
      candidates: post('/runbook/candidates'), //    { project } -> { ok, candidates: [{ sha, sha12, at, title }] }
    },
    issue: {
      create: post('/issue/create'), // { project, title, body, labels? }
      update: post('/issue/update'), // { project, number, body }
      list: post('/issue/list'), //     { project, label }
    },
  };
}
