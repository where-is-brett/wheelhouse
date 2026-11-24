// tests/scripts/setup/usual.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHOOSE_EACH, KEEP_ID, KEEP_THEM, DONT_KEEP, USE_USUAL, USUAL_ID, differs, hasUsual, planWithUsual, saveUsual, usualAnswerFor, usualFromChanges, usualOf, usualWords,
} from '../../../scripts/setup/usual.js';
import { effectiveSettings, settingsText } from '../../../scripts/settings/effective.js';
import { usualKey } from '../../../scripts/settings/catalogue.js';
import { openChoices } from '../../../scripts/setup/choices.js';

const COMPUTER = '0a1b2c3d';
const BASE = 'https://gitlab.com';
const COMPANY = 'My company\'s GitLab';
const labels = { keepHere: 'Keep it here', github: 'GitHub', gitlab: 'GitLab', gitlabCom: 'gitlab.com', gitlabComBase: BASE, company: COMPANY, own: 'My own app', wheelhouse: 'The Wheelhouse app', asIs: 'Use my git as it is' };
const AT = '2026-11-24T10:00:00.000Z';
const viewsWith = (values, extra = {}) => ({ settings: { ...Object.fromEntries(Object.entries(values).map(([k, v]) => [usualKey(k, COMPUTER), { key: usualKey(k, COMPUTER), value: v }])), ...extra }, unconfirmed: [] });
const card = (labelsList, recommend = null) => ({ level: 2, what: 'q', why: 'w', options: labelsList.map((label) => ({ label, says: 's' })), recommend, because: 'b', meanwhile: 'm' });

// A step 3 stand-in, asking as host.js does: host, then which GitLab (a company's asks its address next, as gitlab-address-1,
// which waits for the director's own answer), then the connection, then a list. `remote`: the folder already sends its work
// to that GitLab, which the which-GitLab card recommends.
function stepThree({ asked = [], remote = null } = {}) {
  return async (ctx) => {
    const answer = (id) => ctx.answers[`3.${id}`] ?? null;
    asked.push({ answers: Object.keys(ctx.answers) });
    if (answer('host') === null) return { ask: { id: 'host', card: card([labels.keepHere, labels.github, labels.gitlab], labels.keepHere) } };
    const host = answer('host').label === labels.gitlab ? 'gitlab' : answer('host').label === labels.github ? 'github' : 'local';
    let base;
    if (host === 'gitlab') {
      const where = answer('gitlab-where');
      if (where === null) return { ask: { id: 'gitlab-where', typed: true, ...(remote ? { fromFolder: true } : {}), card: card([...(remote ? [remote] : []), labels.gitlabCom, COMPANY], remote) } };
      if (where.label === COMPANY) {
        const typed = answer('gitlab-address-1');
        if (typed === null) return { ask: { id: 'gitlab-address-1', typed: true, waits: true, card: card([labels.gitlabCom, 'Go back']) } };
        base = typed.text;
      } else base = where.label === labels.gitlabCom ? BASE : where.label === remote ? `https://${remote}` : where.text;
    }
    if (host === 'local') return { changes: [{ kind: 'host', target: 'local', action: 'connection', mode: 'none' }] };
    const way = answer('connection-abc');
    if (way === null) return { ask: { id: 'connection-abc', card: card([labels.asIs, labels.own, labels.wheelhouse], labels.wheelhouse) } };
    const mode = way.label === labels.asIs ? 'as-is' : 'narrow';
    return { changes: [{ kind: 'host', target: host, action: 'connection', mode, ...(base !== undefined && base !== BASE ? { base } : {}), ...(mode === 'narrow' && host === 'github' ? { app: { own: way.label === labels.own } } : {}) }] };
  };
}
const run = (ctx, usual, plan = stepThree()) => planWithUsual({ plan, ctx: { answers: {}, ...ctx }, views: () => viewsWith(usual), computer: COMPUTER, labels, defaultBase: BASE });

test('with no usual answers, step 3 asks as today', async () => {
  const got = await run({}, {});
  assert.equal(got.ask.id, 'host');
  assert.equal(got.ask.card.recommend, labels.keepHere);
});

test('with usual answers, step 3\'s first card is "Use your usual setup?" and lists them in words', async () => {
  const got = await run({}, { host: 'gitlab', gitlabBase: 'https://gitlab.example.org', gitRoute: 'own' });
  assert.equal(got.ask.id, USUAL_ID);
  assert.match(got.ask.card.what, /^Use your usual setup\? Your usual on this computer: GitLab at the address you used before · your own git/);
  assert.deepEqual(got.ask.card.options.map((o) => o.label), [USE_USUAL, CHOOSE_EACH]);
  assert.equal(got.ask.card.recommend, USE_USUAL);
});

test('"Use my usual" records each answer as chosen, marked from usual, and skips those questions', async () => {
  const seen = [];
  const usual = { host: 'gitlab', gitlabBase: 'https://gitlab.example.org', gitRoute: 'own' };
  const got = await run({ answers: { [`3.${USUAL_ID}`]: { label: USE_USUAL, text: null, at: AT } } }, usual, stepThree({ asked: seen }));
  assert.equal(got.ask, undefined);
  assert.deepEqual(got.changes, [{ kind: 'host', target: 'gitlab', action: 'connection', mode: 'as-is', base: 'https://gitlab.example.org' }]);
  const last = seen.at(-1).answers;
  assert.deepEqual(last.sort(), ['3.connection-abc', '3.gitlab-address-1', '3.gitlab-where', '3.host', `3.${USUAL_ID}`].sort());
});

test('a company\'s GitLab is taken as host.js asks it: My company\'s GitLab, then its address typed', async () => {
  const usual = { host: 'gitlab', gitlabBase: 'https://gitlab.example.org', gitRoute: 'own' };
  const seen = [];
  await run({ answers: { [`3.${USUAL_ID}`]: { label: USE_USUAL, text: null, at: AT } } }, usual, async (ctx) => { seen.push(ctx.answers); return stepThree()(ctx); });
  const last = seen.at(-1);
  assert.equal(last['3.gitlab-where'].label, COMPANY);
  assert.deepEqual([last['3.gitlab-address-1'].label, last['3.gitlab-address-1'].text, last['3.gitlab-address-1'].from], [null, 'https://gitlab.example.org', 'usual']);
});

test('the folder\'s own GitLab wins over the usual one: the which-GitLab card is asked', async () => {
  const usual = { host: 'gitlab', gitlabBase: BASE };
  const got = await run({ answers: { [`3.${USUAL_ID}`]: { label: USE_USUAL, text: null, at: AT }, '3.host': { label: 'GitLab', text: null, at: AT } } }, usual, stepThree({ remote: 'git.example.org' }));
  assert.equal(got.ask.id, 'gitlab-where');
  assert.equal(got.ask.card.recommend, 'git.example.org');
});

test('the one card lists the usual answers as its choices: host, address and connection each have a line to stand for', async () => {
  const usual = { host: 'gitlab', gitlabBase: 'https://gitlab.example.org', gitRoute: 'own' };
  const step = { n: 3 };
  const planOf = (s, answers) => planWithUsual({ plan: stepThree(), ctx: { answers, choicesOnly: true }, views: () => viewsWith(usual), computer: COMPUTER, labels, defaultBase: BASE });
  const list = await openChoices({ steps: [step], run: null, answers: {}, planOf });
  assert.deepEqual(list.map((c) => [c.id, c.label, c.text ?? null]), [
    [USUAL_ID, USE_USUAL, null],
    ['host', 'GitLab', null],
    ['gitlab-where', COMPANY, null],
    ['gitlab-address-1', null, 'https://gitlab.example.org'],
    ['connection-abc', labels.asIs, null],
  ]);
  // Customise's own answer wins over the usual one.
  const mine = await openChoices({ steps: [step], run: null, answers: { [`3.${USUAL_ID}`]: { label: USE_USUAL, text: null, at: AT }, '3.host': { label: 'GitHub', text: null, at: AT } }, planOf });
  assert.deepEqual(mine.map((c) => [c.id, c.label]), [[USUAL_ID, USE_USUAL], ['host', 'GitHub'], ['connection-abc', labels.asIs]]);
});

test('"Use my usual" still asks what the usual does not answer', async () => {
  const got = await run({ answers: { [`3.${USUAL_ID}`]: { label: USE_USUAL, text: null, at: AT } } }, { host: 'github' });
  assert.equal(got.ask.id, 'connection-abc');
});

test('"Use my usual" never takes a way the card does not offer', async () => {
  const got = await run({ answers: { [`3.${USUAL_ID}`]: { label: USE_USUAL, text: null, at: AT } } }, { host: 'github', gitRoute: 'own', connection: 'own-app' }, async (ctx) => {
    if (!ctx.answers['3.host']) return { ask: { id: 'host', card: card([labels.github]) } };
    return { ask: { id: 'connection-abc', card: card([labels.wheelhouse]) } };
  });
  assert.equal(got.ask.id, 'connection-abc');
});

test('"Choose each" asks as today, with the usual answer recommended', async () => {
  const got = await run({ answers: { [`3.${USUAL_ID}`]: { label: CHOOSE_EACH, text: null, at: AT } } }, { host: 'github' });
  assert.equal(got.ask.id, 'host');
  assert.equal(got.ask.card.recommend, labels.github);
});

test('the keep card is offered when the answers differ or none are kept, and not when they match', async () => {
  const answers = { '3.host': { label: 'GitHub', text: null, at: AT }, '3.connection-abc': { label: labels.own, text: null, at: AT } };
  const first = await run({ answers }, {});
  assert.equal(first.ask.id, KEEP_ID);
  assert.deepEqual(first.ask.card.options.map((o) => o.label), [KEEP_THEM, DONT_KEEP]);
  assert.equal(first.ask.card.recommend, KEEP_THEM);
  const differing = await run({ answers }, { host: 'gitlab' });
  assert.equal(differing.ask.id, USUAL_ID);
  const same = await run({ answers: { ...answers, [`3.${USUAL_ID}`]: { label: CHOOSE_EACH, text: null, at: AT } } }, { host: 'github', gitRoute: 'wheelhouse', connection: 'own-app' });
  assert.equal(same.ask, undefined);
  assert.ok(same.changes);
  const answered = await run({ answers: { ...answers, [`3.${KEEP_ID}`]: { label: DONT_KEEP, text: null, at: AT } } }, {});
  assert.equal(answered.ask, undefined);
});

test('a look at the choices alone never asks the keep card', async () => {
  const got = await run({ choicesOnly: true, answers: { '3.host': { label: 'Keep it here', text: null, at: AT } } }, {});
  assert.equal(got.ask, undefined);
});

test('settings that cannot be read keep no usual', async () => {
  const got = await planWithUsual({ plan: stepThree(), ctx: { answers: {} }, views: () => { throw new Error('bad'); }, computer: COMPUTER, labels, defaultBase: BASE });
  assert.equal(got.ask.id, 'host');
});

test('saving is a signed profile change, written once and only for what changed', async () => {
  const writes = [];
  const profile = { views: async () => viewsWith({ host: 'github' }), write: async (e) => { writes.push(e); return { ok: true }; } };
  const changes = [{ kind: 'host', target: 'gitlab', action: 'connection', mode: 'as-is', base: 'https://gitlab.example.org' }];
  assert.deepEqual(await saveUsual({ answers: {}, changes, profile, computer: COMPUTER, defaultBase: BASE }), []);
  assert.deepEqual(await saveUsual({ answers: { [`3.${KEEP_ID}`]: { label: DONT_KEEP } }, changes, profile, computer: COMPUTER, defaultBase: BASE }), []);
  const saved = await saveUsual({ answers: { [`3.${KEEP_ID}`]: { label: KEEP_THEM } }, changes, profile, computer: COMPUTER, defaultBase: BASE });
  assert.deepEqual(saved.map((s) => s.key), [usualKey('host', COMPUTER), usualKey('gitlabBase', COMPUTER), usualKey('gitRoute', COMPUTER)]);
  assert.equal(writes.length, 3);
  for (const w of writes) {
    assert.equal(w.kind, 'setting');
    assert.match(w.data.words, /^Usual /);
  }
  const refused = { views: profile.views, write: async () => ({ ok: false, why: 'no' }) };
  await assert.rejects(saveUsual({ answers: { [`3.${KEEP_ID}`]: { label: KEEP_THEM } }, changes, profile: refused, computer: COMPUTER, defaultBase: BASE }), /could not be saved.*no/);
});

test('an answer waiting for its Confirm counts as kept', async () => {
  const writes = [];
  const profile = {
    views: async () => ({ settings: {}, unconfirmed: [{ kind: 'setting', data: { key: usualKey('host', COMPUTER), value: 'github' } }] }),
    write: async (e) => { writes.push(e); return { ok: true }; },
  };
  await saveUsual({ answers: { [`3.${KEEP_ID}`]: { label: KEEP_THEM } }, changes: [{ kind: 'host', target: 'github', action: 'connection', mode: 'quick' }], profile, computer: COMPUTER, defaultBase: BASE });
  assert.deepEqual(writes.map((w) => w.data.key), [usualKey('gitRoute', COMPUTER)]);
});

test('usual answers are per computer: another computer\'s are not read', () => {
  const views = { settings: { [usualKey('host', 'ffffffff')]: { key: usualKey('host', 'ffffffff'), value: 'github' } } };
  assert.equal(hasUsual(usualOf(views, COMPUTER)), false);
  assert.deepEqual(usualOf(views, 'ffffffff'), { host: 'github' });
});

test('a value the catalogue refuses reads as none', () => {
  assert.deepEqual(usualOf(viewsWith({ host: 'bitbucket', gitlabBase: 'https://gitlab.example.org/group/project' }), COMPUTER), {});
});

test('a connection the usual cannot hold is left out', () => {
  assert.deepEqual(usualFromChanges([{ action: 'connection', target: 'github', mode: 'quick' }], BASE), { host: 'github', gitRoute: 'wheelhouse' });
  assert.deepEqual(usualFromChanges([], BASE), {});
  assert.deepEqual(differs({ host: 'github' }, { host: 'github' }), []);
});

test('the usual words tell the route and the phone notices where they are kept', () => {
  const views = viewsWith({ host: 'gitlab', gitlabBase: 'https://gitlab.example.org', gitRoute: 'own' }, { notifications: { value: { channels: ['ntfy'] } }, [`builders:${COMPUTER}`]: { value: 'desktop' } });
  assert.equal(usualWords(usualOf(views, COMPUTER), views, COMPUTER), 'GitLab at the address you used before · your own git as it is · phone notices · builders in Claude Desktop');
});

test('a project answer wins inside that project: the usual is a profile value, below the project\'s', () => {
  const key = usualKey('host', COMPUTER);
  const profile = { [key]: { key, value: 'github' } };
  const project = { [key]: { key, value: 'gitlab' } };
  assert.equal(effectiveSettings({ project, profile, now: AT })[key].value, 'gitlab');
  assert.equal(effectiveSettings({ project: {}, profile, now: AT })[key].from, 'profile');
  assert.match(settingsText(effectiveSettings({ project: {}, profile, now: AT })), /Usual host: GitHub \(yours\)/);
});

test('usualAnswerFor says nothing about a question the usual does not cover', () => {
  assert.equal(usualAnswerFor({ id: 'real-users', card: card(['Yes, real users', 'Not yet']) }, { host: 'github' }, labels), null);
  assert.equal(usualAnswerFor({ id: 'locked', card: card(['Locked', 'Standard']) }, { host: 'github' }, labels), null);
});
