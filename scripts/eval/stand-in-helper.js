// scripts/eval/stand-in-helper.js
// A stand-in for the host helper, for evaluation runs only: there is no real
// host in an evaluation. It answers the few requests a feature session's
// commands make (scripts/feature/cli.js: push, open-pr, answer and the
// provenance asked for by report) on the same kind of socket the real helper
// uses, records each one, and answers as a helper with a host behind it would.
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
import { execFileSync } from 'node:child_process';

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

// Starts the stand-in on `address` (a socket path, or a pipe on Windows).
// `answers` maps a question id to the label the director chose; any other
// question has no answer yet. Resolves with { address, records(), close() }:
// records() gives every request in the order it came, as
// { at, route, ...what it asked, ...what was answered }.
export async function startStandInHelper({ address, answers = {} } = {}) {
  if (typeof address !== 'string' || address === '') throw new Error('The stand-in helper needs an address');
  const records = [];
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
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
  };
}
