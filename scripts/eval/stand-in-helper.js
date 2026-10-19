// scripts/eval/stand-in-helper.js
// A stand-in for the host helper, for evaluation runs only: there is no real
// host in an evaluation. It answers the few requests a feature session's
// commands make (scripts/feature/cli.js: push, open-pr, answer and the
// provenance asked for by report) and the front desk's commands make (the stand-in
// scripts/eval/front-desk-command.js, and scripts/frontdesk/cli.js itself in the mod's
// scenarios: writing a plain event, under the caller's id when it gives one, and reading the
// views with the card events),
// on the same kind of socket the real helper uses, records each one, and
// answers as a helper with a host behind it would. Its state is a list of
// events in memory, not a state branch.
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
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PLAIN_KINDS } from '../state/events.js';
import { buildViews } from '../state/views.js';

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
// An id a caller may give with a record, as the real helper takes one: a random UUID in lower case.
const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
export async function startStandInHelper({ address, answers = {}, state = {} } = {}) {
  if (typeof address !== 'string' || address === '') throw new Error('The stand-in helper needs an address');
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
    // The front desk's record: { project | cwd, kind, data, id? }. A plain kind only, as the real
    // helper takes; the command checked the event's shape before sending it. The caller's id is
    // kept when it gives one the state doesn't hold, as the real helper keeps it.
    'POST /state/write': (body) => {
      const { kind, data } = body;
      if (!PLAIN_KINDS.includes(kind) || data === null || typeof data !== 'object' || Array.isArray(data)) {
        record({ route: 'state/write', kind: kind ?? null, data: data ?? null, refused: true });
        return { ok: false, refused: PLAIN_KINDS.includes(kind) ? 'the event\'s data must be an object' : 'that kind of event is not known here' };
      }
      const given = body.id;
      if (given !== undefined && (typeof given !== 'string' || !EVENT_ID.test(given) || events.some((e) => e.id === given))) {
        record({ route: 'state/write', kind, data, refused: true });
        return { ok: false, refused: 'the id is not one the state can take' };
      }
      const event = { ...plainEvent(kind, data), ...(given === undefined ? {} : { id: given }) };
      events.push(event);
      record({ route: 'state/write', kind, data, id: event.id });
      return { ok: true, id: event.id, pushed: true };
    },
    // The front desk's reading: { project | cwd, cards? } -> the views, and with `cards: true` the
    // card events too, as the real helper gives them for the board's numbers. STOP is off.
    'POST /state/views': (body) => {
      record({ route: 'state/views', ...(body.cards === true ? { cards: true } : {}) });
      return {
        ok: true,
        views: standInViews(events, approved),
        ...(body.cards === true ? { cards: events.filter((e) => e.kind === 'card').map((e) => structuredClone(e)) } : {}),
      };
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

  return {
    address,
    records: () => records.map((entry) => ({ ...entry })),
    events: () => events.map((event) => structuredClone(event)),
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
  };
}
