// scripts/eval/stand-in-helper.js
// A stand-in for the host helper, for evaluation runs only: there is no real
// host in an evaluation. It answers the few requests a feature session's
// commands make (scripts/feature/cli.js: push, open-pr, answer and the
// provenance asked for by report) and the front desk's command makes
// (scripts/frontdesk/cli.js: writing a plain event, a card and the cards asked,
// reading the views and the card events, the director's profile, and a pull
// request's head), on the same kind of socket the real helper uses, records
// each one, and answers as a helper with a host behind it would. Its state is
// a list of events in memory, not a state branch.
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
import { PLAIN_KINDS, PROTECTED_KINDS, makeEvent } from '../state/events.js';
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

// A plain event as the helper makes one: its id, time and computer are made here.
export function plainEvent(kind, data, at = new Date()) {
  return { v: 1, id: crypto.randomUUID(), at: at.toISOString(), computer: STAND_IN_COMPUTER, kind, data };
}

const RANDOM_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Why a plain event's data is refused, as the real helper's makeEvent refuses it, or null. makeEvent
// checks the shape, then names this computer from WHEELHOUSE_HOME, so the stand-in's own home is
// named for that moment, and nothing is written to the real one.
function shapeProblem(kind, data, home) {
  const was = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    makeEvent({ kind, data });
    return null;
  } catch (error) {
    return error.message;
  } finally {
    if (was === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = was;
  }
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
  // A home of its own, where checking an event's shape may name a stand-in computer.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-stand-in-'));
  const opened = new Map();
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
      opened.set(number, sha);
      return { ok: true, result: { number, url: `https://host.invalid/pull/${number}` } };
    },
    // The front desk's card for an approval names the pull request's head: { cwd, number }. Only a
    // pull request opened through the stand-in is known, open at the commit it was opened at.
    'POST /pr/state': (body) => {
      const sha = opened.get(body.number) ?? null;
      record({ route: 'pr/state', number: body.number ?? null, sha });
      return sha === null
        ? { ok: false, refused: `there is no pull request #${body.number}` }
        : { ok: true, result: { headSha: sha, state: 'open', mergeable: 'clean' } };
    },
    // cli.js answer: { cwd, questionId }.
    'POST /state/answer': (body) => {
      const answer = Object.hasOwn(answers, body.questionId) ? answers[body.questionId] : null;
      record({ route: 'state/answer', questionId: body.questionId ?? null, answer });
      return { ok: true, answer };
    },
    // The front desk's record, card and cards asked: { project | cwd, kind, data, id? }. A plain
    // kind only, in its shape, under the caller's id when one is given, as the real helper takes it.
    'POST /state/write': (body) => {
      const { kind, data, id } = body;
      let refused = null;
      if (PROTECTED_KINDS.includes(kind)) refused = 'a signed kind is recorded through /state/record, never written here';
      else if (!PLAIN_KINDS.includes(kind)) refused = 'that kind of event is not known';
      else if (data === null || typeof data !== 'object' || Array.isArray(data)) refused = 'the event\'s data must be an object';
      else if (id !== undefined && (typeof id !== 'string' || !RANDOM_UUID.test(id))) refused = 'an id given with a record must be a random UUID in lower case';
      else if (id !== undefined && events.some((e) => e.id === id)) refused = 'the state already holds an event with that id';
      else refused = shapeProblem(kind, data, home);
      if (refused !== null) {
        record({ route: 'state/write', kind: kind ?? null, data: data ?? null, refused });
        return { ok: false, refused };
      }
      const event = { ...plainEvent(kind, data), ...(id === undefined ? {} : { id }) };
      events.push(event);
      record({ route: 'state/write', kind, data, id: event.id });
      return { ok: true, id: event.id, pushed: true };
    },
    // The front desk's reading: { project | cwd, cards? } -> the views, and with `cards` the card
    // events. STOP is never on here.
    'POST /state/views': (body) => {
      record({ route: 'state/views', ...(body.cards === true ? { cards: true } : {}) });
      return {
        ok: true,
        views: standInViews(events, approved),
        ...(body.cards === true ? { cards: events.filter((e) => e.kind === 'card') } : {}),
      };
    },
    // The director's profile: no settings of their own.
    'POST /profile/views': () => {
      record({ route: 'profile/views' });
      return { ok: true, views: {} };
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
      server.close(() => {
        fs.rmSync(home, { recursive: true, force: true });
        resolve();
      });
      server.closeAllConnections?.();
    }),
  };
}
