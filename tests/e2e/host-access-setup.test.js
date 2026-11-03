// tests/e2e/host-access-setup.test.js
// Setup's steps 2 and 3 on a locked-down computer (host access design sections 3, 6, 11 and 12): a company GitLab, no `glab`
// (it is not on the computer at all, and a second computer has one that will not start), the system's `curl` for everything
// but pushes, and the director's own credential helper holding a key that can push but not use the API. The director sees the
// cards as the engine composes them; the key card is raised, the pasted key is checked with GET /user and stored with
// `git credential approve` over the one entry, and the project's record keeps "use my git as it is" with the web API as its
// backend. Nothing real is reached: the credential helper, curl, the box and the browser are stand-ins, and git runs for real
// only in scratch folders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hostStep, directorKey, WAYS, REAL_USERS, STRICTER } from '../../scripts/setup/host.js';
import { toolsStep } from '../../scripts/setup/tools.js';
import { composeCard } from '../../scripts/cards/compose.js';
import { startRun, addChanges, findRun } from '../../scripts/setup/journal.js';
import { readProject } from '../../scripts/lib/projects.js';
import { wheelhouseHome } from '../../scripts/lib/paths.js';
import { run as realRun } from '../../scripts/lib/run.js';
import { makeRoutedCurl } from '../helpers/fake-curl.js';
import { useFileKeyStore } from '../helpers/file-key-store.js';
import { g } from '../helpers/git-fixture.js';
import { tempFolder, withHome } from '../helpers/homes.js';

useFileKeyStore();

const NOW = new Date('2026-11-04T01:00:00.000Z');
const COMPANY = 'https://git.example.org';
const REPO = 'team/product';
const PUSH_ONLY = 'stand-in-GCM-PUSH-ONLY-0001';
const PASTED = 'stand-in-PASTED-IN-THE-BOX-0002';
const SECOND = 'stand-in-SECOND-0003';

// The computer: no glab at all; git's own answers about the director's settings; the credential helper (one entry for the
// company's GitLab, replaced by `approve`); and the system's curl answering the company's GitLab by key.
function laptop({ glab = 'absent', keys }) {
  const w = { calls: [], helper: { username: 'oauth2', key: PUSH_ONLY }, stored: [], hostRuns: [] };
  w.curl = makeRoutedCurl(({ url, headers }) => {
    const auth = headers.find((h) => /^authorization:/i.test(h)) ?? '';
    const key = auth.replace(/^authorization:\s*Bearer\s+/i, '');
    if (url === `${COMPANY}/api/v4/user`) {
      const known = keys[key];
      if (known === 'push-only') return { status: 403, body: { message: '403 Forbidden' } };
      return known === undefined ? { status: 401, body: { message: '401 Unauthorized' } } : { status: 200, body: { username: known } };
    }
    return { status: 404, body: {} };
  });
  w.run = async (file, args = [], options = {}) => {
    const name = path.basename(file).replace(/\.exe$/, '');
    w.calls.push({ name, args: [...args] });
    if (name === 'glab' || name === 'gh') {
      w.hostRuns.push(name);
      if (glab === 'absent') throw Object.assign(new Error(`spawn ${name} ENOENT`), { code: 'ENOENT' });
      return { code: 1, stdout: '', stderr: 'This program is blocked by group policy.' };
    }
    if (name === 'git' && args[0] === 'config' && args[1] === '--get-urlmatch') return args[2] === 'credential.helper' ? { code: 0, stdout: 'manager\n', stderr: '' } : { code: 1, stdout: '', stderr: '' };
    if (name === 'git' && args[0] === 'ls-remote' && args.at(-1) === 'HEAD') return { code: 0, stdout: 'abc\tHEAD\n', stderr: '' };
    return realRun(file, args, options);
  };
  w.api = {
    baseUrl: COMPANY,
    async get(p) {
      if (p.startsWith('/projects/')) return { status: 200, body: { id: 41, path_with_namespace: REPO, default_branch: 'main', visibility: 'private' } };
      return { status: 404, body: null };
    },
    async post() { return { status: 404, body: null }; },
    async put() { return { status: 404, body: null }; },
    async delete() { return { status: 404, body: null }; },
  };
  w.via = { run: w.curl.run, curl: '/usr/bin/curl', proxy: null, caFile: null, platform: 'darwin' };
  return w;
}

const said = (label) => ({ label, text: null, at: NOW.toISOString() });
const ctxFor = (folder, extra = {}) => ({ folder, step: 3, now: () => NOW, platform: 'darwin', userHome: folder, answers: {}, ...extra });

async function productOn(w) {
  const parent = fs.realpathSync.native(tempFolder('wh-proj '));
  const folder = path.join(parent, 'product');
  fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.claude', 'settings.json'), '{"enabledPlugins":{"wheelhouse@wheelhouse":true}}\n');
  await g(folder, 'init', '-q', '-b', 'main');
  await g(folder, 'remote', 'add', 'origin', `${COMPANY}/${REPO}.git`);
  // The company's GitLab is named in the project's settings, as step 3 does it for a remote that does not name one.
  fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), `${JSON.stringify({ gitlabHosts: ['git.example.org'] })}\n`);
  return folder;
}

function stepFor(w, extra = {}) {
  return hostStep({
    run: w.run, via: w.via, findGit: async () => ({ ok: true, path: 'git' }), gitlab: async () => w.api,
    hostUrl: ({ repo }) => path.join(tempFolder('wh-remote-'), `${repo}.git`), open: async () => {}, sleep: async () => {},
    certificateProbe: async () => 'trusted', ...extra,
  });
}

// Plans the step the way the engine does, answering each question with `pick`, and composing every card it asks.
async function answerAll(step, ctx, pick) {
  const answers = { ...ctx.answers };
  const cards = [];
  for (let i = 0; i < 8; i += 1) {
    const got = await step.plan({ ...ctx, answers });
    if (!got.ask) {
      return { ...got, answers, cards };
    }
    composeCard({ ...got.ask.card, kind: 'question', suggest: false });
    cards.push(got.ask.card);
    answers[`3.${got.ask.id}`] = said(pick(got.ask.id, got.ask.card));
  }
  throw new Error('the step kept asking');
}

const pick = (id, card) => {
  if (id === 'real-users') return REAL_USERS.no;
  if (id.startsWith('connection-')) return card.options.find((o) => o.label === WAYS.asIs)?.label ?? STRICTER;
  throw new Error(`asked ${id}`);
};

async function applyStep(step, folder, changes, answers, extra = {}) {
  const run = startRun({ folder, now: () => NOW });
  const lines = [];
  await step.apply(ctxFor(folder, {
    runId: run.id, answers, say: (line) => { lines.push(line); },
    record: (made) => addChanges(run.id, (Array.isArray(made) ? made : [made]).map((c) => ({ ...c, step: 3 }))), ...extra,
  }), changes);
  return { lines, run: findRun(folder) };
}

// The credential helper stand-in: borrow gives its entry; approve replaces it.
function useHelper(w) {
  const was = [directorKey.borrow, directorKey.store];
  directorKey.borrow = async () => w.helper;
  directorKey.store = async (entry) => { w.stored.push(entry); w.helper = { username: entry.username, key: entry.key }; };
  return () => { [directorKey.borrow, directorKey.store] = was; };
}

test('a computer with no glab and a key that can only push: step 2 settles with no fetch, step 3 raises the key card, and the project is kept on the web API', async () => {
  await withHome(async () => {
    const w = laptop({ keys: { [PUSH_ONLY]: 'push-only', [PASTED]: 'a-director' } });
    const restore = useHelper(w);
    try {
      const folder = await productOn(w);
      // Step 2: glab is not there, but the project's host is GitLab, so it is offered for fetching only where a fetch can work.
      // Here the company's proxy refuses the download: the step goes on and the project settles on the web API.
      const refused = async () => { throw new Error('the proxy refused the download'); };
      const tools = toolsStep({ engine: null, run: w.run, fetch: refused, pluginRoot: '/Applications/Plug ins/wheelhouse', env: {} });
      const found = await tools.plan({ folder, step: 2, now: () => NOW, platform: 'darwin', answers: {} });
      const fetching = (found.changes ?? []).filter((c) => c.action === 'fetch');
      const toolsLines = [];
      if (fetching.length > 0) {
        assert.deepEqual(fetching.map((c) => c.tool), ['glab']);
        await tools.apply({ folder, step: 2, now: () => NOW, platform: 'darwin', record: () => {}, applyJsonKey: () => {}, stopped: () => false, say: (l) => toolsLines.push(l) }, found.changes.filter((c) => c.action === 'fetch'));
        assert.match(toolsLines.join(''), /could not be fetched/);
      }

      // Step 3: what the director sees.
      const step = stepFor(w, { askSecret: async () => PASTED });
      const planned = await answerAll(step, ctxFor(folder), pick);
      const connectionCard = planned.cards.find((c) => /How should Wheelhouse's agents reach/.test(c.what));
      assert.deepEqual(connectionCard.options.map((o) => o.label), [WAYS.asIs, STRICTER]);
      assert.equal(connectionCard.recommend, WAYS.asIs);
      assert.deepEqual(planned.changes.find((c) => c.action === 'key-card'), { kind: 'host', target: 'gitlab', action: 'key-card', state: 'push-only' });
      assert.match(planned.card.what, /Wheelhouse will push with your own git as it is, and reach GitLab's web API, with the same key/);
      assert.match(planned.card.what, /replacing the one your git holds/);
      for (const text of [JSON.stringify(connectionCard), JSON.stringify(planned.card), planned.director]) assert.doesNotMatch(text, /\bREST\b|\bcurl\b/i);

      const { lines, run } = await applyStep(step, folder, planned.changes, planned.answers);
      // The key card said what it does; the key went to the credential helper over its one entry, never into a line or the journal.
      assert.ok(lines.includes('This replaces the key your git uses for git.example.org with the new one, so your pushes keep working.'), lines.join('\n'));
      assert.ok(lines.some((l) => /A page will open on git\.example\.org/.test(l)));
      assert.deepEqual(w.stored, [{ host: 'git.example.org', base: COMPANY, repoPath: REPO, username: 'oauth2', key: PASTED }]);
      assert.ok(!(lines.join('\n') + JSON.stringify(run)).includes(PASTED));
      for (const line of lines) assert.doesNotMatch(line, /\bREST\b|\bcurl\b/i);
      // Every host call after the key went by the web API, with the new key in a header on standard input, never an argument.
      const asked = w.curl.calls.map((c) => c.url);
      assert.ok(asked.every((url) => url.startsWith(`${COMPANY}/api/v4/`)), asked.join(', '));
      assert.ok(w.curl.calls.every((c) => c.args.every((a) => !a.includes(PASTED) && !a.includes(PUSH_ONLY))));
      assert.ok(w.curl.calls.some((c) => c.headers.includes(`Authorization: Bearer ${PASTED}`)));
      // No tool the computer does not have was ever relied on for the sign-in.
      assert.ok(!w.calls.some((c) => c.name === 'glab' && c.args[0] === 'auth' && c.args[1] === 'login'));

      const record = readProject(REPO.replace('/', '__'));
      assert.deepEqual(record.connection, { host: 'gitlab', mode: 'as-is', project: REPO, baseUrl: COMPANY, backend: 'rest' });
      assert.ok(fs.existsSync(path.join(wheelhouseHome(), 'host', 'git-settings.json')), 'the settings a push trusts were recorded');
    } finally {
      restore();
    }
  });
});

test('the same card comes again on a key the host later refuses, and nothing is asked while the key passes', async () => {
  await withHome(async () => {
    const w = laptop({ glab: 'blocked', keys: { [PASTED]: 'a-director', [SECOND]: 'a-director' } });
    w.helper = { username: 'oauth2', key: PASTED };
    const restore = useHelper(w);
    try {
      const folder = await productOn(w);
      const step = stepFor(w, { askSecret: async () => SECOND });
      const quiet = await answerAll(step, ctxFor(folder), pick);
      assert.ok(!quiet.changes.some((c) => c.action === 'key-card' || c.action === 'sign-in'), 'a key that passes GET /user asks for nothing');
      assert.equal(quiet.changes.find((c) => c.action === 'connection').backend, 'rest', 'a tool that will not start settles on the web API');
      // The key expires: GitLab answers 401, and the same card comes again (here at a later setup run).
      w.helper = { username: 'oauth2', key: 'stand-in-EXPIRED-0004' };
      const again = await answerAll(step, ctxFor(folder), pick);
      assert.deepEqual(again.changes.find((c) => c.action === 'key-card'), { kind: 'host', target: 'gitlab', action: 'key-card', state: 'refused' });
      const { lines } = await applyStep(step, folder, again.changes, again.answers);
      assert.ok(lines.some((l) => /key has stopped working/.test(l)), lines.join('\n'));
      assert.deepEqual(w.stored.map((s) => s.key), [SECOND]);
    } finally {
      restore();
    }
  });
});

test('a Locked project on this computer is offered only the narrow key', async () => {
  await withHome(async () => {
    const w = laptop({ glab: 'blocked', keys: { [PUSH_ONLY]: 'push-only' } });
    const restore = useHelper(w);
    try {
      const folder = await productOn(w);
      const step = stepFor(w);
      let card = null;
      const answers = { '3.real-users': said(REAL_USERS.yes), '3.locked': said('Locked') };
      const got = await step.plan({ ...ctxFor(folder, { platform: 'darwin' }), answers });
      card = got.ask?.card ?? null;
      assert.ok(card === null || !card.options.some((o) => o.label === WAYS.asIs || o.label === WAYS.quick), JSON.stringify(card?.options));
    } finally {
      restore();
    }
  });
});
