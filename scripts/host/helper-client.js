// scripts/host/helper-client.js
// How agents and Wheelhouse's own scripts ask the host helper for something.
// Each call resolves with the helper's answer, `{ ok: true, ... }` or
// `{ ok: false, refused }`, and never rejects: a helper that cannot be reached
// is an answer too.
import http from 'node:http';
import { helperAddress } from '../lib/paths.js';

function ask(address, method, path, body) {
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
    req.end(payload);
  });
}

export function helperClient({ address = helperAddress() } = {}) {
  const post = (path) => (args = {}) => ask(address, 'POST', path, args);
  return {
    health: () => ask(address, 'GET', '/health'),
    push: post('/push'), //          { project, dir, refspec }
    openPr: post('/pr/open'), //     { project, head, base, title, body }
    updatePr: post('/pr/update'), // { project, number, title?, body? }
    prState: post('/pr/state'), //   { project, number }
    ci: post('/ci'), //              { project, sha }
    merge: post('/merge'), //        { project, number, stop, bypass, reviewRequired?, approvalRequired?, touchesGuardrails? }
    issue: {
      create: post('/issue/create'), // { project, title, body, labels? }
      update: post('/issue/update'), // { project, number, body }
      list: post('/issue/list'), //     { project, label }
    },
  };
}

// The `push(dir, branch)` that events.js and lock.js take, sent through the helper.
export function pushFor(client, project) {
  return (dir, branch) => client.push({ project, dir, refspec: branch });
}
