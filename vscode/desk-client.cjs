// vscode/desk-client.cjs
// The add-on's one way to Wheelhouse: desk/1 over the helper's socket or pipe. `deskClient({ address, sign, project })`
// gives `read`, `act` and `watch`. Each call posts `{ v: 'desk/1', project, ... }`; `act` and `watch` carry the
// add-on's signature over the command, its arguments, the time and the project as `evidence`. Plain Node.js with no import from `scripts/`.
//
// An answer is `{ ok: true, ... }` or `{ ok: false, refused }`, and never a rejection. Two marks are added:
// `down: true` when the helper couldn't be reached, and `update: true` when the helper speaks another version
// or doesn't know the command (it answers "Wheelhouse can't ..."), so the panel says "Update Wheelhouse".
'use strict';

const http = require('node:http');

const DESK_VERSION = 'desk/1';
const CANT = /^Wheelhouse can't/;
const TIMEOUT_MS = 8000;

function post(address, route, body, timeout) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      socketPath: address,
      agent: false,
      method: 'POST',
      path: route,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const got = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const plain = got !== null && typeof got === 'object' && !Array.isArray(got);
          resolve(plain ? { ...got, ...(res.statusCode === 404 ? { notFound: true } : {}) } : { ok: false, unreadable: true });
        } catch {
          resolve({ ok: false, ...(res.statusCode === 404 ? { notFound: true } : { unreadable: true }) });
        }
      });
      res.on('error', () => resolve({ ok: false, down: true }));
    });
    req.on('error', () => resolve({ ok: false, down: true }));
    req.setTimeout(timeout, () => { resolve({ ok: false, down: true }); req.destroy(); });
    req.end(payload);
  });
}

// What an answer means to the panel: another version, or a command the helper doesn't know, is an update to make.
function meant(got) {
  if (got.down === true) return { ok: false, down: true, refused: 'Wheelhouse\'s helper isn\'t running' };
  // A route an older helper doesn't have (404), or one it calls an unknown request, is a helper to update.
  if (got.ok !== true && (got.notFound === true || (typeof got.refused === 'string' && /unknown request/i.test(got.refused)))) return { ok: false, update: true, refused: got.refused ?? 'This Wheelhouse helper doesn\'t know that request' };
  if (got.unreadable === true) return { ok: false, update: true, refused: 'Wheelhouse gave an answer this can\'t read' };
  if (typeof got.v === 'string' && got.v !== DESK_VERSION) return { ok: false, update: true, refused: `Wheelhouse speaks ${got.v}, not ${DESK_VERSION}` };
  if (got.ok !== true && typeof got.refused === 'string' && CANT.test(got.refused)) return { ok: false, update: true, refused: got.refused };
  return got;
}

function deskClient({ address, sign, project, timeout = TIMEOUT_MS } = {}) {
  const ask = async (route, body) => meant(await post(address, route, { v: DESK_VERSION, project, ...body }, timeout));
  return {
    read: (view, args = {}) => ask('/desk/read', { view, args }),
    act: (command, args = {}) => ask('/desk/act', { command, args, evidence: sign(command, args, project) }),
    watch: (cursor = null) => ask('/desk/watch', { cursor, evidence: sign('watch', { cursor }, project) }),
    // An answer names the hash of the card as it was shown, as a click in the chat does; the helper refuses one without it.
    answer: (card, option, hash, extra = {}) => {
      if (typeof hash !== 'string' || hash === '') return Promise.resolve({ ok: false, refused: 'An answer names the hash of the card it was shown' });
      const args = { card, option, hash, ...extra };
      return ask('/desk/act', { command: 'answer', args, evidence: sign('answer', args, project) });
    },
  };
}

module.exports = { deskClient, DESK_VERSION };
