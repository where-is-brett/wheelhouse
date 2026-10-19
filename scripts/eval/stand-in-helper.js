// scripts/eval/stand-in-helper.js
// A stand-in for the host helper, for evaluation runs only: there is no real
// host in an evaluation. It answers the few requests a feature session's
// commands make (scripts/feature/cli.js: push, open-pr, answer and the
// provenance asked for by report) and the front desk's stand-in command makes
// (scripts/eval/front-desk-command.js: writing a plain event and reading the views),
// on the same kind of socket the real helper uses, records each one, and
// answers as a helper with a host behind it would. Its state is a list of
// events in memory, not a state branch.
// Like the real helper, it refuses a write carrying the baseline card, its click or the private
// note's figures (scripts/state/events.js, carriesBaseline), and answers /measures/baseline with
// the real route (scripts/measures/baseline.js). The baseline's files live in the session's
// scratch WHEELHOUSE_HOME (`home`), or in a scratch folder of the stand-in's own: never in the
// home of the process running the evaluation, whose WHEELHOUSE_HOME is the director's.
// It reaches no host and signs nothing. A scenario starts it in its setup,
// points the session at it through WHEELHOUSE_HOME, and reads its records in
// its pass. Never used by the product, and not run by `npm test` except in its
// own unit test.
//
// On Windows the helper's address is a named pipe named after the user, not a
// file in WHEELHOUSE_HOME, so the stand-in takes that pipe: a real helper must
// not be running on the same computer while an evaluation runs there.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PLAIN_KINDS, carriesBaseline } from '../state/events.js';
import { buildViews } from '../state/views.js';
import { baselineRoutes } from '../measures/baseline.js';
import { CARRIES_BASELINE } from '../lib/measures-clicks.js';

// The commit `ref` names in the repository at `dir`, or null.
function commitOf(dir, ref) {
  if (typeof dir !== 'string' || typeof ref !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(ref)) return null;
  try {
    return execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

const DEFAULT_BRANCHES = ['main', 'master'];

// The computer a stand-in event names: eight hex characters, as a real one's.
const STAND_IN_COMPUTER = '0e7a1000';

// A plain event as the helper makes one: its id, time and computer are made here.
export function plainEvent(kind, data, at = new Date()) {
  return { v: 1, id: crypto.randomUUID(), at: at.toISOString(), computer: STAND_IN_COMPUTER, kind, data };
}

// The views of `events`, as /state/views answers them. No click is signed in an evaluation, so
// `approved` ({ work: hash }) says which work the director approved before the run, and in
// what document: that work shows as approved while its latest work event still names that hash.
export function standInViews(events, approved = {}) {
  const views = buildViews(events, []);
  for (const [work, hash] of Object.entries(approved)) {
    const entry = views.work?.[work];
    if (entry && entry.work?.data?.doc?.hash === hash) {
      Object.assign(entry, { approved: true, approval: { hash, shownFirst: false, lane: entry.work.data.lane } });
    }
  }
  return views;
}

// Starts the stand-in on `address` (a socket path, or a pipe on Windows).
// `answers` maps a question id to the label the director chose; any other
// question has no answer yet. `state` is what the project's state holds when the
// run starts: { events, approved } (see standInViews). Resolves with
// { address, records(), events(), close() }: records() gives every request in the
// order it came, as { at, route, ...what it asked, ...what was answered };
// events() gives the state's events, those the state started with and those written since.
// `home` is the session's scratch WHEELHOUSE_HOME, where the baseline's files are kept and the
// director's clicks are read; without it the stand-in keeps them in a scratch folder of its own,
// removed on close.
export async function startStandInHelper({ address, answers = {}, state = {}, home } = {}) {
  if (typeof address !== 'string' || address === '') throw new Error('The stand-in helper needs an address');
  const ownHome = typeof home === 'string' && home !== '' ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'wh-stand-in-'));
  const baselineHome = ownHome ?? home;
  // Runs fn, which must not wait on anything, with WHEELHOUSE_HOME at the baseline's home, putting
  // the old value back afterwards. The baseline's code reads the home from the environment.
  const inHome = (fn) => {
    const before = process.env.WHEELHOUSE_HOME;
    process.env.WHEELHOUSE_HOME = baselineHome;
    try {
      return fn();
    } finally {
      if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    }
  };
  // The real route. STOP is off in an evaluation, as /lineage/provenance answers.
  const measures = baselineRoutes({ stopped: () => false });
  const records = [];
  const events = [...(state.events ?? [])];
  const approved = { ...(state.approved ?? {}) };
  let nextPr = 1;
  const record = (entry) => {
    records.push({ at: new Date().toISOString(), ...entry });
  };

  const routes = {
    'GET /health': () => ({ ok: true, standIn: true }),
    // cli.js push and open-pr: { cwd, dir, refspec }. Like the real helper, it never pushes the default branch.
    'POST /push': (body) => {
      const branch = typeof body.refspec === 'string' ? body.refspec : null;
      const sha = commitOf(body.dir ?? body.cwd, branch);
      if (branch === null || DEFAULT_BRANCHES.includes(branch)) {
        record({ route: 'push', branch, sha, refused: true });
        return { ok: false, refused: 'the default branch is never pushed' };
      }
      if (sha === null) {
        record({ route: 'push', branch, sha, refused: true });
        return { ok: false, refused: `there is no branch ${branch} to push` };
      }
      record({ route: 'push', branch, sha });
      return { ok: true, pushed: branch };
    },
    // cli.js pull: { cwd, dir, branch }. The stand-in host holds only what was pushed to it, so
    // there is never anything new to bring in.
    'POST /pull': (body) => {
      const branch = typeof body.branch === 'string' ? body.branch : null;
      record({ route: 'pull', branch });
      return { ok: true, already: true };
    },
    // cli.js open-pr: { cwd, head, title, body, session? }.
    'POST /pr/open': (body) => {
      const sha = commitOf(body.cwd, body.head);
      if (typeof body.head !== 'string' || DEFAULT_BRANCHES.includes(body.head) || sha === null) {
        record({ route: 'pr/open', head: body.head ?? null, sha, refused: true });
        return { ok: false, refused: 'a pull request is opened only from a pushed feature branch' };
      }
      const number = nextPr;
      nextPr += 1;
      record({ route: 'pr/open', head: body.head, sha, title: body.title ?? null, body: body.body ?? null, number });
      return { ok: true, result: { number, url: `https://host.invalid/pull/${number}` } };
    },
    // cli.js answer: { cwd, questionId }.
    'POST /state/answer': (body) => {
      const answer = Object.hasOwn(answers, body.questionId) ? answers[body.questionId] : null;
      record({ route: 'state/answer', questionId: body.questionId ?? null, answer });
      return { ok: true, answer };
    },
    // The front desk's record: { project | cwd, kind, data }. A plain kind only, as the real
    // helper takes; the command checked the event's shape before sending it.
    'POST /state/write': (body) => {
      const { kind, data } = body;
      if (!PLAIN_KINDS.includes(kind) || data === null || typeof data !== 'object' || Array.isArray(data)) {
        record({ route: 'state/write', kind: kind ?? null, data: data ?? null, refused: true });
        return { ok: false, refused: PLAIN_KINDS.includes(kind) ? 'the event\'s data must be an object' : 'that kind of event is not known here' };
      }
      const event = plainEvent(kind, data);
      // As the real helper's writeEvent: the baseline never enters the state. Its data is not
      // recorded, since it may hold the figures.
      if (inHome(() => carriesBaseline(event))) {
        record({ route: 'state/write', kind, refused: true, carriesBaseline: true });
        return { ok: false, refused: CARRIES_BASELINE };
      }
      events.push(event);
      record({ route: 'state/write', kind, data, id: event.id });
      return { ok: true, id: event.id, pushed: true };
    },
    // The front desk's reading: { project | cwd } -> the views.
    'POST /state/views': () => {
      record({ route: 'state/views' });
      return { ok: true, views: standInViews(events, approved) };
    },
    // measures/cli.js baseline: the figures -> the card reading them back; or { confirm: hash } ->
    // recorded, only after the director's click on that card. The record names the form asked for
    // and the answer, never the figures or the card; a refusal comes back as the real helper sends it.
    'POST /measures/baseline': (body) => {
      const form = Object.hasOwn(body, 'confirm') ? 'confirm' : 'show';
      let answer;
      try {
        answer = inHome(() => measures['/measures/baseline'](body));
      } catch (error) {
        answer = { ok: false, refused: error instanceof Error && error.message ? error.message : 'the request failed' };
      }
      record({ route: 'measures/baseline', form, ok: answer.ok === true, ...(answer.refused ? { refused: answer.refused } : {}) });
      return answer;
    },
    // cli.js report: { cwd, session? }. No provenance on this computer, and STOP is off.
    'POST /lineage/provenance': (body) => {
      record({ route: 'lineage/provenance', session: body.session ?? null });
      return { ok: true, block: null, stop: false };
    },
  };

  const server = http.createServer(async (req, res) => {
    const body = req.method === 'POST' ? await readBody(req) : {};
    const route = routes[`${req.method} ${req.url}`];
    let answer;
    if (route) {
      answer = route(body);
    } else {
      record({ route: `${req.method} ${req.url}`, unanswered: true });
      answer = { ok: false, refused: `the stand-in helper does not answer ${req.url}` };
    }
    const text = JSON.stringify(answer);
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  });

  try {
    if (process.platform !== 'win32') {
      fs.mkdirSync(path.dirname(address), { recursive: true });
      fs.rmSync(address, { force: true });
    }
    await new Promise((resolve, reject) => {
      server.once('error', (error) => reject(error.code === 'EADDRINUSE'
        ? new Error(`Something already answers on ${address}: stop the real helper before an evaluation run`)
        : error));
      server.listen(address, resolve);
    });
  } catch (error) {
    // It could not start: its own scratch home goes with it.
    if (ownHome) fs.rmSync(ownHome, { recursive: true, force: true });
    throw error;
  }

  return {
    address,
    records: () => records.map((entry) => ({ ...entry })),
    events: () => events.map((event) => structuredClone(event)),
    close: () => new Promise((resolve) => {
      server.close(() => {
        if (ownHome) fs.rmSync(ownHome, { recursive: true, force: true });
        resolve();
      });
      server.closeAllConnections?.();
    }),
  };
}
