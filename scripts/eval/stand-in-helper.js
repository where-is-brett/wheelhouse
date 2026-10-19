// scripts/eval/stand-in-helper.js
// A stand-in for the host helper, for evaluation runs only: there is no real
// host in an evaluation. It answers the few requests a feature session's
// commands make (scripts/feature/cli.js: push, open-pr, answer and the
// provenance asked for by report) and the front desk's command makes
// (scripts/frontdesk/cli.js: writing a plain event, a card and the cards asked,
// under the caller's id when it gives one, reading the views and the card events,
// the director's profile, and a pull request's head), on the same kind of socket
// the real helper uses, records each one, and answers as a helper with a host
// behind it would. Its state is a list of events in memory, not a state branch.
// For the front desk's scenarios it also answers the scratch plugin's hooks
// (`onHook`, route /eval/hook), which a real helper never does, and signs, with a
// key of its own, the confirmation a director's click on a confirm card would
// record (`confirm`), since no click is made in an evaluation.
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
import { PLAIN_KINDS, PROTECTED_KINDS, confirmationFor, makeEvent, carriesBaseline } from '../state/events.js';
import { buildViews } from '../state/views.js';
import { makeSigningKey } from '../state/signing.js';
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

// An id a caller may give with a record, as the real helper takes one: a random UUID in lower case.
const RANDOM_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// What `fn` gives with WHEELHOUSE_HOME naming `home` for that moment, so whatever it names or
// signs (this computer, its key) is the stand-in's own and nothing is written to the real home.
function inHome(home, fn) {
  const was = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    return fn();
  } finally {
    if (was === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = was;
  }
}

// Why a plain event's data is refused, as the real helper's makeEvent refuses it, or null. makeEvent
// checks the shape, then names this computer, in the stand-in's own home.
function shapeProblem(kind, data, home) {
  try {
    inHome(home, () => makeEvent({ kind, data }));
    return null;
  } catch (error) {
    return error.message;
  }
}

// The views of `events`, as /state/views answers them. No click is signed in an evaluation, so
// `approved` ({ work: hash }) says which work the director approved before the run, and in
// what document: that work shows as approved while its latest work event still names that hash.
// `enrolled` are the computers whose signatures count: the stand-in's own, for the confirmations
// it signs (`confirm`).
export function standInViews(events, approved = {}, enrolled = []) {
  const views = buildViews(events, enrolled);
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
// run starts: { events, approved, pullRequests } (see standInViews; `pullRequests` maps the number
// of a pull request already open to its head commit). `onHook({ body, views, events })`, when
// given, answers /eval/hook with the text a hook adds (`{ text }`, or null for none): the scratch
// plugin's hooks ask it, with the event and what Claude Code gave them. `home` is the session's
// scratch WHEELHOUSE_HOME, where the baseline's files are kept and the director's clicks are read;
// without it the stand-in keeps them in its scratch folder, removed on close. Resolves with
// { address, records(), events(), views(), confirm(id), close() }: records() gives every request in
// the order it came, as { at, route, ...what it asked, ...what was answered }; events() gives the
// state's events, those the state started with and those written since; views() the views of
// them; confirm(id) records, signed by the stand-in's own key, the confirmation of the ruling,
// level or setting `id`, as the director's click on its confirm card would.
export async function startStandInHelper({ address, answers = {}, state = {}, onHook, home } = {}) {
  if (typeof address !== 'string' || address === '') throw new Error('The stand-in helper needs an address');
  // A scratch folder of its own, where checking an event's shape may name a stand-in computer, and
  // where its signing key is kept: the one computer enrolled. Removed on close.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-stand-in-'));
  // Where the baseline's files are kept: the session's home when given, else the scratch folder.
  const baselineHome = typeof home === 'string' && home !== '' ? home : scratch;
  // The real route. STOP is off in an evaluation, as /lineage/provenance answers.
  const measures = baselineRoutes({ stopped: () => false });
  const records = [];
  const events = [...(state.events ?? [])];
  const approved = { ...(state.approved ?? {}) };
  const own = inHome(scratch, () => makeSigningKey());
  const enrolled = [{ computer: own.computer, publicKey: own.publicKey, enrolledAt: new Date(0).toISOString() }];
  const views = () => standInViews(events, approved, enrolled);
  const opened = new Map(Object.entries(state.pullRequests ?? {}).map(([number, sha]) => [Number(number), sha]));
  let nextPr = Math.max(0, ...opened.keys()) + 1;
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
    // As the real helper's writeEvent, the baseline never enters the state, and the data of a write
    // carrying it is not recorded, since it may hold the figures.
    'POST /state/write': (body) => {
      const { kind, data, id } = body;
      const plain = PLAIN_KINDS.includes(kind) && data !== null && typeof data === 'object' && !Array.isArray(data);
      const made = plain ? plainEvent(kind, data) : null;
      const baseline = made !== null && inHome(baselineHome, () => carriesBaseline(made));
      let refused = null;
      if (PROTECTED_KINDS.includes(kind)) refused = 'a signed kind is recorded through /state/record, never written here';
      else if (!PLAIN_KINDS.includes(kind)) refused = 'that kind of event is not known';
      else if (!plain) refused = 'the event\'s data must be an object';
      else if (id !== undefined && (typeof id !== 'string' || !RANDOM_UUID.test(id))) refused = 'an id given with a record must be a random UUID in lower case';
      else if (id !== undefined && events.some((e) => e.id === id)) refused = 'the state already holds an event with that id';
      else if (baseline) {
        record({ route: 'state/write', kind, refused: true, carriesBaseline: true });
        return { ok: false, refused: CARRIES_BASELINE };
      } else refused = shapeProblem(kind, data, scratch);
      if (refused !== null) {
        record({ route: 'state/write', kind: kind ?? null, ...(baseline ? { carriesBaseline: true } : { data: data ?? null }), refused });
        return { ok: false, refused };
      }
      const event = id === undefined ? made : { ...made, id };
      events.push(event);
      record({ route: 'state/write', kind, data, id: event.id });
      return { ok: true, id: event.id, pushed: true };
    },
    // The front desk's reading: { project | cwd, cards? } -> the views, and with `cards: true` the
    // card events too, as the real helper gives them for the board's numbers. STOP is never on here.
    'POST /state/views': (body) => {
      record({ route: 'state/views', ...(body.cards === true ? { cards: true } : {}) });
      return {
        ok: true,
        views: views(),
        ...(body.cards === true ? { cards: events.filter((e) => e.kind === 'card').map((e) => structuredClone(e)) } : {}),
      };
    },
    // The director's profile: no settings of their own.
    'POST /profile/views': () => {
      record({ route: 'profile/views' });
      return { ok: true, views: {} };
    },
    // The scratch plugin's hooks: { event, ...what Claude Code gave them } -> { text }.
    'POST /eval/hook': (body) => {
      const text = typeof onHook === 'function' ? onHook({ body, views: views(), events: events.map((e) => structuredClone(e)) }) : null;
      record({ route: 'eval/hook', event: body.event ?? null, source: body.source ?? null, text: text ?? null });
      return { ok: true, text: text ?? null };
    },
    // measures/cli.js baseline: the figures -> the card reading them back; or { confirm: hash } ->
    // recorded, only after the director's click on that card. The record names the form asked for
    // and the answer, never the figures or the card; a refusal comes back as the real helper sends it.
    'POST /measures/baseline': (body) => {
      const form = Object.hasOwn(body, 'confirm') ? 'confirm' : 'show';
      let answer;
      try {
        answer = inHome(baselineHome, () => measures['/measures/baseline'](body));
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
    // It could not start: its scratch folder goes with it.
    fs.rmSync(scratch, { recursive: true, force: true });
    throw error;
  }

  return {
    address,
    records: () => records.map((entry) => ({ ...entry })),
    events: () => events.map((event) => structuredClone(event)),
    views,
    confirm: (id) => {
      const target = events.find((e) => e.id === id);
      if (target === undefined) throw new Error(`The state holds no event ${id} to confirm`);
      const event = inHome(scratch, () => makeEvent(confirmationFor(target)));
      events.push(event);
      record({ route: 'eval/click', confirms: id, id: event.id });
      return event;
    },
    close: () => new Promise((resolve) => {
      server.close(() => {
        fs.rmSync(scratch, { recursive: true, force: true });
        resolve();
      });
      server.closeAllConnections?.();
    }),
  };
}
