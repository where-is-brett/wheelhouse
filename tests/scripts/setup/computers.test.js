// tests/scripts/setup/computers.test.js
// Keys between computers (rulings R79 to R81, Review Focus 5): each computer's setup publishes its
// key in the profile as enrolments/<computer>.json, by a commit made from objects alone and pushed
// by its exact SHA with the director's own sign-in; and another computer's key counts here only
// after the director's Trust it on a card naming that computer, the day its key was added and the
// key's fingerprint. Git runs for real only against bare remotes in temporary folders; every home
// is a scratch folder.
import { test, after } from 'node:test';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publishEnrolment, withdrawEnrolment, enrolmentChange, NOT_PUBLISHED, NOT_WITHDRAWN, KEY_CHANGED } from '../../../scripts/setup/computers.js';
import { directorGitEnv } from '../../../scripts/setup/host.js';
import { decide as promptRecord } from '../../../scripts/hooks/prompt-record.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { cardProblems } from '../../../scripts/hooks/card-check.js';
import {
  trustOffers, trustCardInput, trustedBy, keepSeen, readSeen, seenDue, fingerprint, enrolmentOf, differentKeyLine, trustDir,
  ENROLMENTS_EVERY_MS, keepShownTrust, readShownTrust, keyHash, shownTrustFile,
} from '../../../scripts/lib/trust-clicks.js';
import { trustLine, setLineOf, TRUST_LABEL } from '../../../scripts/state/card-lines.js';
import { makeSigningKey, enrol, ownKey, readEnrolled, verify } from '../../../scripts/state/signing.js';
import { makeEvent, writeEvent, confirmationFor, TRUST_KEPT_HERE } from '../../../scripts/state/events.js';
import { buildViews } from '../../../scripts/state/views.js';
import { canonicalJson } from '../../../scripts/lib/canonical.js';
import { computerId, profileDir, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { ensureProfileClone, profileRemote, PROFILE_BRANCH } from '../../../scripts/profile/store.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { makeBareRemote, g, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { withHome, as, shortHome, testAddress } from '../../helpers/homes.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const NOW = new Date('2026-10-20T03:00:00.000Z');
const ADDED = '2026-10-19T22:30:00.000Z';
const P = 'owner__name';
const PROFILE_REPO = 'a-director/wheelhouse-profile';

// Another of the director's computers: its id, its public key and its own way of signing.
function otherComputer(computer = '0a1b2c3d') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    computer,
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    sign(event) {
      const { sig, ...body } = event; // eslint-disable-line no-unused-vars
      return { ...body, sig: { computer, value: crypto.sign(null, Buffer.from(canonicalJson(body)), privateKey).toString('base64') } };
    },
  };
}

// This computer: its own key, enrolled in its own list, as the session start makes it.
const ownComputer = () => {
  const own = makeSigningKey();
  enrol({ ...own, enrolledAt: '2026-10-18T00:00:00.000Z' });
  return own;
};

const enrolmentFor = (c, at = ADDED) => ({ computer: c.computer, publicKey: c.publicKey, at });
// The card the session start hands over for an enrolment, with the key's full hash it keeps for it.
const cardFor = (enrolment) => {
  keepShownTrust([enrolment]);
  return composeCard(trustCardInput(enrolment)).question;
};

// The director's click on a card, as AskUserQuestion reports it.
const clickOn = (question, label) => ({
  cwd: '/x', hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
  tool_input: { questions: [question], answers: { [question.question]: label } },
  tool_response: { answers: { [question.question]: label } },
});

// A helper that takes nothing, counting what is asked of it.
function quiet() {
  const calls = [];
  const note = (name) => async (body) => { calls.push({ name, body }); return { ok: true }; };
  return { calls, client: { state: { write: note('write'), record: note('record') }, profile: { record: note('profile-record') } } };
}

const click = async (question, label, { project = P } = {}) => {
  const h = quiet();
  await promptRecord(clickOn(question, label), { client: h.client, now: () => NOW, projectOf: () => (project === null ? null : { project }) });
  return h.calls;
};

const trustFiles = () => {
  try {
    return fs.readdirSync(trustDir()).filter((n) => n.includes('_trust_'));
  } catch {
    return [];
  }
};

// A ruling written on the other computer, and that computer's confirmation of it, signed there.
function confirmedOn(other) {
  const ruling = { v: 1, id: crypto.randomUUID(), at: '2026-10-19T23:00:00.000Z', computer: other.computer, kind: 'ruling', data: { words: 'Money is shown in dollars' } };
  const confirmation = other.sign({ v: 1, id: crypto.randomUUID(), at: '2026-10-19T23:01:00.000Z', computer: other.computer, ...confirmationFor(ruling) });
  return { ruling, confirmation };
}
const unconfirmedIds = (events) => buildViews(events, readEnrolled(), { now: () => NOW }).unconfirmed.map((u) => u.id);

// ---- Trusting another computer ----

test('an enrolment found in the profile is not trusted until the director clicks Trust it (Review Focus 5)', async () => {
  await withHome(async (home) => {
    ownComputer();
    const other = otherComputer();
    // The profile holds the other computer's enrolment: written by its setup, or by anyone at all.
    keepSeen({ at: NOW.toISOString(), enrolments: [enrolmentFor(other)] });
    const { offers, clashes } = trustOffers({ enrolments: readSeen().enrolments, enrolled: readEnrolled(), own: ownKey() });
    assert.deepEqual(offers, [enrolmentFor(other)]);
    assert.deepEqual(clashes, []);
    // Found is not trusted: its records don't count here.
    const { ruling, confirmation } = confirmedOn(other);
    assert.equal(verify(confirmation, readEnrolled()), false);
    assert.deepEqual(unconfirmedIds([ruling, confirmation]), [ruling.id]);

    // The card names the computer, the day its key was added and the key's fingerprint, and passes the card check.
    const question = cardFor(enrolmentFor(other));
    const line = trustLine(other.computer, ADDED, fingerprint(other.publicKey));
    assert.equal(line, `Trust your computer 0a1b2c3d, added 19 October 2026, key ${fingerprint(other.publicKey)}`);
    assert.equal(setLineOf(question.question), line);
    assert.deepEqual(cardProblems(question.question), []);
    assert.doesNotMatch(question.question, /Reply code/, 'only the click on the card itself counts');
    assert.deepEqual(question.options.map((o) => o.label), [TRUST_LABEL, 'Not now', 'Explain more']);
    assert.equal(question.header, 'Trust');

    // Not now and Explain more trust nothing, and nothing of the card goes to the project.
    for (const label of ['Not now', 'Explain more']) {
      assert.deepEqual(await click(question, label), [], label);
      assert.equal(readEnrolled().some((e) => e.computer === other.computer), false, label);
    }
    assert.deepEqual(trustFiles(), []);

    // Trust it: the click is signed and kept on this computer, never sent, and the key is enrolled.
    assert.deepEqual(await click(question, TRUST_LABEL), [], 'nothing sent, not even a plain card-answer (as R53)');
    const entry = readEnrolled().find((e) => e.computer === other.computer);
    assert.deepEqual(entry, { computer: other.computer, publicKey: other.publicKey, enrolledAt: NOW.toISOString() });
    const kept = trustFiles();
    assert.equal(kept.length, 1);
    const event = JSON.parse(fs.readFileSync(path.join(home, 'trust', kept[0]), 'utf8'));
    assert.equal(event.kind, 'action');
    assert.deepEqual(event.data, {
      action: 'trust', computer: other.computer, at: ADDED, fingerprint: fingerprint(other.publicKey), keyHash: keyHash(other.publicKey), question: line, label: TRUST_LABEL,
    });
    assert.equal(event.data.keyHash, crypto.createHash('sha256').update(Buffer.from(other.publicKey, 'base64')).digest('hex'), 'the full SHA-256 of the key enrolled');
    assert.equal(event.computer, computerId());
    assert.equal(verify(event, readEnrolled()), true, 'signed by this computer\'s hook');
    // Its records count from now on.
    assert.equal(verify(confirmation, readEnrolled()), true);
    assert.deepEqual(unconfirmedIds([ruling, confirmation]), []);
    // Trusted, it is offered no more.
    assert.deepEqual(trustOffers({ enrolments: readSeen().enrolments, enrolled: readEnrolled(), own: ownKey() }), { offers: [], clashes: [] });
    // The state never takes a trust click.
    await assert.rejects(writeEvent({ env: LOCAL_PATHS, project: P, event, push: async () => ({ ok: true }) }), { message: TRUST_KEPT_HERE });
  });
});

test('a click in a folder that is no project trusts as well: trust belongs to the computer', async () => {
  await withHome(async () => {
    ownComputer();
    const other = otherComputer('1b2c3d4e');
    keepSeen({ at: NOW.toISOString(), enrolments: [enrolmentFor(other)] });
    assert.deepEqual(await click(cardFor(enrolmentFor(other)), TRUST_LABEL, { project: null }), []);
    assert.equal(readEnrolled().some((e) => e.computer === other.computer && e.publicKey === other.publicKey), true);
  });
});

test('Trust it on a card naming another computer, another date or another key trusts nothing', async () => {
  await withHome(async () => {
    ownComputer();
    const other = otherComputer();
    const stranger = otherComputer('99999999');
    keepSeen({ at: NOW.toISOString(), enrolments: [enrolmentFor(other)] });
    const before = readEnrolled();
    const wrong = {
      'another computer': cardFor({ ...enrolmentFor(other), computer: '0a1b2c3e' }),
      'another date': cardFor(enrolmentFor(other, '2026-10-18T22:30:00.000Z')),
      'another key': cardFor({ ...enrolmentFor(other), publicKey: stranger.publicKey }),
      'a computer the profile doesn\'t hold': cardFor(enrolmentFor(stranger)),
    };
    for (const [why, question] of Object.entries(wrong)) {
      assert.deepEqual(await click(question, TRUST_LABEL), [], why);
      assert.deepEqual(readEnrolled(), before, why);
    }
    // The right line on a card carrying a second set line, or typed rather than clicked, trusts nothing.
    const right = cardFor(enrolmentFor(other));
    const doubled = { ...right, question: `${right.question}\n${trustLine(stranger.computer, ADDED, fingerprint(stranger.publicKey))}` };
    assert.deepEqual(await click(doubled, TRUST_LABEL), []);
    const typed = { ...right, options: right.options.filter((o) => o.label !== TRUST_LABEL) };
    assert.deepEqual(await click(typed, TRUST_LABEL), []);
    assert.deepEqual(readEnrolled(), before);
    assert.deepEqual(trustFiles(), []);
    // With no fetch of the profile kept, nothing can be trusted either.
    fs.rmSync(path.join(wheelhouseHome(), 'jobs'), { recursive: true, force: true });
    assert.deepEqual(await click(right, TRUST_LABEL), []);
    assert.deepEqual(readEnrolled(), before);
  });
});

test('Trust it enrols only the exact key its card was handed over for, by its full hash (ruling R107)', async () => {
  await withHome(async () => {
    ownComputer();
    const other = otherComputer();
    keepSeen({ at: NOW.toISOString(), enrolments: [enrolmentFor(other)] });
    const question = composeCard(trustCardInput(enrolmentFor(other))).question;
    const line = setLineOf(question.question);
    // No card was handed over for it: nothing is trusted.
    assert.deepEqual(await click(question, TRUST_LABEL), []);
    assert.equal(readEnrolled().some((e) => e.computer === other.computer), false);
    // A card handed over for another key with the same twelve characters (its full hash differs): nothing.
    fs.mkdirSync(trustDir(), { recursive: true });
    fs.writeFileSync(shownTrustFile(), JSON.stringify({ [line]: `${fingerprint(other.publicKey)}${'0'.repeat(52)}` }));
    assert.deepEqual(await click(question, TRUST_LABEL), []);
    assert.equal(readEnrolled().some((e) => e.computer === other.computer), false);
    assert.deepEqual(trustFiles(), []);
    // Handed over for this very key: trusted.
    keepShownTrust([enrolmentFor(other)]);
    assert.deepEqual(readShownTrust(), { [line]: keyHash(other.publicKey) });
    await click(question, TRUST_LABEL);
    assert.equal(readEnrolled().find((e) => e.computer === other.computer)?.publicKey, other.publicKey);
    // The state's own check: a trust action whose hash isn't the fingerprint's is refused.
    assert.throws(() => makeEvent({ kind: 'action', data: { action: 'trust', computer: other.computer, at: ADDED, fingerprint: fingerprint(other.publicKey), keyHash: 'f'.repeat(64), question: line, label: TRUST_LABEL } }), /full hash/);
  });
});

test('a known id with a different key gives the different-key line and no card, and a click on such a card trusts nothing', async () => {
  await withHome(async () => {
    const own = ownComputer();
    const first = otherComputer();
    const swapped = { ...otherComputer(), computer: first.computer };
    enrol({ computer: first.computer, publicKey: first.publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
    // The profile now says computer 0a1b2c3d has another key; and this computer's own id with another.
    const impostor = otherComputer(own.computer);
    keepSeen({ at: NOW.toISOString(), enrolments: [enrolmentFor(swapped), enrolmentFor(impostor)] });
    const found = trustOffers({ enrolments: readSeen().enrolments, enrolled: readEnrolled(), own: ownKey() });
    assert.deepEqual(found, { offers: [], clashes: [first.computer, own.computer] });
    assert.equal(differentKeyLine(first.computer), 'A different key claims your computer 0a1b2c3d; nothing was trusted.');
    // A card made for the swapped key anyway trusts nothing: the key enrolled stays the first.
    for (const e of [enrolmentFor(swapped), enrolmentFor(impostor)]) {
      assert.deepEqual(await click(cardFor(e), TRUST_LABEL), []);
    }
    assert.equal(readEnrolled().find((e) => e.computer === first.computer).publicKey, first.publicKey);
    assert.equal(readEnrolled().find((e) => e.computer === own.computer).publicKey, own.publicKey);
    assert.deepEqual(trustFiles(), []);
    assert.equal(trustedBy(trustLine(swapped.computer, ADDED, fingerprint(swapped.publicKey)), { enrolled: readEnrolled(), own: ownKey() }), null);
  });
});

test('a record signed by an untrusted computer doesn\'t count; after Trust it, it does', async () => {
  await withHome(async () => {
    ownComputer();
    const other = otherComputer();
    const agent = otherComputer('5e6f7a8b');
    const { ruling, confirmation } = confirmedOn(other);
    // An agent on that computer writing its own enrolment changes nothing either: found is not trusted.
    keepSeen({ at: NOW.toISOString(), enrolments: [enrolmentFor(other), enrolmentFor(agent)] });
    const forged = confirmedOn(agent);
    assert.equal(verify(confirmation, readEnrolled()), false);
    assert.equal(verify(forged.confirmation, readEnrolled()), false);
    assert.deepEqual(unconfirmedIds([ruling, confirmation, forged.ruling, forged.confirmation]).sort(), [ruling.id, forged.ruling.id].sort());
    await click(cardFor(enrolmentFor(other)), TRUST_LABEL);
    assert.equal(verify(confirmation, readEnrolled()), true);
    assert.equal(verify(forged.confirmation, readEnrolled()), false, 'only the computer clicked on is trusted');
    assert.deepEqual(unconfirmedIds([ruling, confirmation, forged.ruling, forged.confirmation]), [forged.ruling.id]);
  });
});

test('a trust card is composed only for a whole target, names its computer first, and offers nothing to show', () => {
  const other = otherComputer();
  const input = trustCardInput(enrolmentFor(other));
  assert.throws(() => composeCard({ ...input, target: { ...input.target, computer: 'NOTANID' } }), /computer's id/);
  assert.throws(() => composeCard({ ...input, target: { ...input.target, at: 'soon' } }), /when its key was added/);
  assert.throws(() => composeCard({ ...input, target: { ...input.target, fingerprint: 'abc' } }), /fingerprint/);
  assert.throws(() => composeCard({ ...input, what: 'Your other computer put its key in your profile.' }), /must name the computer 0a1b2c3d/);
  assert.throws(() => composeCard({ ...input, options: [...input.options, { label: 'Show me', says: 'x' }] }), /can't describe Show me/);
  // The card check judges a card by the same rule: its first part names the computer its line trusts.
  const { question } = composeCard(input);
  const elsewhere = question.question.replace(`Your computer ${other.computer}`, 'Your computer 99999999');
  assert.match(cardProblems(elsewhere).join(' '), /must name the computer 0a1b2c3d/);
  assert.match(cardProblems(`${question.question}\nReply code: ABCD`).join(' '), /a trust card has none/);
});

test('an enrolment is read only in its own form: an Ed25519 key, a computer id, a time, and the computer its file names', () => {
  const other = otherComputer();
  const good = enrolmentFor(other);
  assert.deepEqual(enrolmentOf(JSON.stringify(good)), good);
  assert.deepEqual(enrolmentOf(good, other.computer), good);
  assert.equal(enrolmentOf(good, '99999999'), null, 'a file named for another computer');
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  for (const bad of [
    { ...good, computer: 'ABCDEF12' }, { ...good, computer: '0a1b2c3' }, { ...good, at: 'yesterday' }, { ...good, publicKey: 'not base64!' },
    { ...good, publicKey: rsa }, { ...good, publicKey: Buffer.from('nonsense').toString('base64') }, null, [], 'not json', `{"computer":"${'x'.repeat(5000)}"}`,
  ]) assert.equal(enrolmentOf(bad), null, JSON.stringify(bad)?.slice(0, 60));
  assert.equal(fingerprint(other.publicKey), crypto.createHash('sha256').update(Buffer.from(other.publicKey, 'base64')).digest('hex').slice(0, 12));
});

test('the helper is due to be asked once an hour, and a clock that was wrong asks again', async () => {
  await withHome(async () => {
    assert.equal(seenDue(() => NOW), true, 'never asked');
    keepSeen({ at: NOW.toISOString(), enrolments: [{ junk: true }] });
    assert.deepEqual(readSeen(), { at: NOW.toISOString(), enrolments: [] }, 'what can\'t be read is left out');
    assert.equal(seenDue(() => new Date(NOW.getTime() + ENROLMENTS_EVERY_MS - 1)), false);
    assert.equal(seenDue(() => new Date(NOW.getTime() + ENROLMENTS_EVERY_MS)), true);
    assert.equal(seenDue(() => new Date(NOW.getTime() - 1000)), true);
    assert.equal(ENROLMENTS_EVERY_MS, 60 * 60 * 1000);
  });
});

// ---- Publishing this computer's key ----

// A profile on a bare remote, with this computer's clone of it, as step 3 leaves it.
async function profileHere() {
  const remote = await makeBareRemote({ repo: PROFILE_REPO });
  fs.mkdirSync(wheelhouseHome(), { recursive: true });
  fs.writeFileSync(path.join(wheelhouseHome(), 'profile.json'), JSON.stringify({
    remoteUrl: remote.url, host: 'github', repo: PROFILE_REPO, connection: { host: 'github', mode: 'quick', project: PROFILE_REPO },
  }));
  await ensureProfileClone({ remote: profileRemote(), env: LOCAL_PATHS });
  return remote;
}

// Every git call setup's publish makes starts with these: no hooks, no file-system monitor (R106).
const NO_HOOKS = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'];
// A call's own arguments, after those.
const callOf = (args) => (args.slice(0, 4).join(' ') === NO_HOOKS.join(' ') ? args.slice(4) : args);

// git as setup runs it, with every call kept: its arguments, its folder and its environment.
function watched({ before } = {}) {
  const calls = [];
  const run = async (file, args, options = {}) => {
    calls.push({ args: [...args], cwd: options.cwd, env: options.env });
    await before?.(callOf(args));
    return hostGuard(file, args, options);
  };
  return { calls, run };
}

const remoteText = (url, file) => g(url, 'show', `${PROFILE_BRANCH}:${file}`);
const clean = async () => ({
  refs: await g(profileDir(), 'for-each-ref', '--format=%(refname) %(objectname)'),
  status: await g(profileDir(), 'status', '--porcelain'),
  files: await g(profileDir(), 'ls-files'),
});

// Hooks an agent could plant in the profile's clone, each leaving a mark if it ever runs.
function plantHooks() {
  const mark = path.join(wheelhouseHome(), 'hook-ran');
  const hooks = path.join(profileDir(), '.git', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  for (const name of ['reference-transaction', 'pre-push', 'post-commit', 'post-checkout', 'fsmonitor-watchman']) {
    fs.writeFileSync(path.join(hooks, name), `#!/bin/sh\necho ${name} >> "${mark}"\n`, { mode: 0o755 });
  }
  return mark;
}

test('step 3\'s publish puts this computer\'s key in the profile by commit-tree, pushed by its exact SHA with the director\'s sign-in, leaving the helper\'s branch alone', async () => {
  await withHome(async () => {
    const remote = await profileHere();
    try {
      ownComputer();
      const own = ownKey();
      const listed = enrolmentChange({ host: 'github' });
      assert.deepEqual(listed, { kind: 'host', target: 'github', action: 'enrolment', computer: own.computer, fingerprint: fingerprint(own.publicKey) });
      const mark = plantHooks();
      const before = await clean();
      const tipBefore = await g(remote.url, 'rev-parse', PROFILE_BRANCH);
      const git = watched();
      const env = directorGitEnv({ host: 'github', gitPath: 'git', platform: 'darwin' });
      const recorded = [];
      const got = await publishEnrolment({ profile: profileRemote(), listed, env, run: git.run, record: (c) => recorded.push(c), now: () => NOW });

      const file = `enrolments/${own.computer}.json`;
      const text = `${JSON.stringify({ computer: own.computer, publicKey: own.publicKey, at: NOW.toISOString() }, null, 2)}\n`;
      assert.equal(await remoteText(remote.url, file), text.trim());
      const tip = await g(remote.url, 'rev-parse', PROFILE_BRANCH);
      assert.deepEqual(got, { published: true, at: NOW.toISOString(), commit: tip });
      // One commit on the tip it fetched, adding that one file and nothing else.
      assert.equal(await g(remote.url, 'rev-parse', `${tip}^`), tipBefore);
      assert.equal(await g(remote.url, 'diff-tree', '--no-commit-id', '--name-status', '-r', tip), `A\t${file}`);
      assert.ok(git.calls.some((c) => c.args.includes('commit-tree')), 'made by commit-tree');
      // Every call in a scratch repository of setup's own, with no hooks and no file-system monitor,
      // never in the helper's profile clone; the scratch is gone afterwards.
      const scratch = path.join(wheelhouseHome(), 'setup');
      // Each of its own calls comes after a look for a setting in the scratch's config that would run
      // a program or send elsewhere (rulings R109, R110).
      const CHECK = ['config', '--includes', '--name-only', '--list', '-z'];
      const calls = git.calls.filter((c) => c.args.join(' ') !== CHECK.join(' '));
      assert.equal(git.calls.length, calls.length * 2);
      git.calls.forEach((c, i) => { if (i % 2 === 0) assert.deepEqual(c.args, CHECK); });
      assert.ok(calls.every((c) => c.args.slice(0, 4).join(' ') === NO_HOOKS.join(' ')), 'no hooks on any call');
      // Every call with git's global and system config shut out, and hooks and the monitor off by environment.
      for (const c of git.calls) {
        assert.equal(c.env.GIT_CONFIG_NOSYSTEM, '1');
        assert.equal(c.env.GIT_CONFIG_GLOBAL, '/dev/null');
      }
      for (const c of calls) {
        const pairs = Array.from({ length: Number(c.env.GIT_CONFIG_COUNT) }, (_, i) => `${c.env[`GIT_CONFIG_KEY_${i}`]}=${c.env[`GIT_CONFIG_VALUE_${i}`]}`);
        assert.ok(pairs.includes('core.hooksPath=/dev/null') && pairs.includes('core.fsmonitor=false'), pairs.join(' '));
      }
      assert.ok(git.calls.every((c) => path.dirname(c.cwd) === scratch && path.basename(c.cwd).startsWith('publish-')));
      assert.equal(new Set(git.calls.map((c) => c.cwd)).size, 1);
      assert.equal(fs.existsSync(git.calls[0].cwd), false);
      assert.deepEqual(callOf(calls[0].args), ['init', '-q', '--bare']);
      // Pushed by its exact SHA, never forced, with the director's own sign-in in git's environment.
      const pushes = git.calls.filter((c) => callOf(c.args)[0] === 'push');
      assert.deepEqual(pushes.map((c) => callOf(c.args)), [['push', '--no-verify', '--porcelain', remote.url, `${tip}:refs/heads/${PROFILE_BRANCH}`]]);
      assert.match(pushes[0].env.GIT_CONFIG_VALUE_1, /auth git-credential$/);
      assert.equal(pushes[0].env.GIT_CONFIG_VALUE_0, '');
      // The helper's clone is as it was, every ref of it included, and no hook planted there ran.
      assert.deepEqual(await clean(), before);
      assert.equal(fs.existsSync(path.join(profileDir(), 'enrolments')), false);
      assert.equal(fs.existsSync(mark), false, 'a hook planted in the profile clone never runs');
      // Recorded as a host change, before null.
      assert.equal(recorded.length, 1);
      assert.deepEqual({ ...recorded[0], id: undefined }, { id: undefined, kind: 'host', target: `github:${PROFILE_REPO}:${file}`, before: null, after: text });
      assert.match(recorded[0].id, /^chg-/);

      // Again (a retry): the key is there already, so nothing is recorded or pushed, and its day stays.
      const again = watched();
      const later = await publishEnrolment({ profile: profileRemote(), listed, env, run: again.run, record: (c) => recorded.push(c), now: () => new Date('2026-10-21T00:00:00.000Z') });
      assert.deepEqual(later, { published: false, at: NOW.toISOString() });
      assert.equal(recorded.length, 1);
      assert.equal(again.calls.some((c) => callOf(c.args)[0] === 'push'), false);
      assert.equal(fs.existsSync(mark), false);

      // A key not the one the card named is not published.
      await assert.rejects(publishEnrolment({ profile: profileRemote(), listed: { ...listed, fingerprint: '000000000000' }, env, run: hostGuard, now: () => NOW }), { message: KEY_CHANGED });
      await assert.rejects(publishEnrolment({ profile: profileRemote(), listed: { ...listed, computer: '99999999' }, env, run: hostGuard, now: () => NOW }), { message: KEY_CHANGED });
    } finally {
      remote.cleanup();
    }
  });
});

test('another key under this computer\'s id in the profile is replaced, recorded with the file before; a branch that moved on is published on its new tip, never forced', async () => {
  await withHome(async () => {
    const remote = await profileHere();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-other-'));
    try {
      ownComputer();
      const own = ownKey();
      // Someone else's commit puts another key under this computer's id.
      await g(scratch, 'clone', '-q', '-b', PROFILE_BRANCH, remote.url, '.');
      const file = `enrolments/${own.computer}.json`;
      const planted = `${JSON.stringify(enrolmentFor({ ...otherComputer(), computer: own.computer }), null, 2)}\n`;
      fs.mkdirSync(path.join(scratch, 'enrolments'));
      fs.writeFileSync(path.join(scratch, file), planted);
      await g(scratch, 'add', '.');
      await g(scratch, 'commit', '-q', '-m', 'planted');
      await g(scratch, 'push', '-q', 'origin', PROFILE_BRANCH);
      // And while this computer publishes, another computer's event lands first.
      let raced = false;
      const git = watched({
        before: async (args) => {
          if (args[0] !== 'push' || raced) return;
          raced = true;
          fs.mkdirSync(path.join(scratch, 'events'), { recursive: true });
          fs.writeFileSync(path.join(scratch, 'events', 'x.json'), '{}\n');
          await g(scratch, 'add', '.');
          await g(scratch, 'commit', '-q', '-m', 'meanwhile');
          await g(scratch, 'push', '-q', 'origin', PROFILE_BRANCH);
        },
      });
      const recorded = [];
      const got = await publishEnrolment({ profile: profileRemote(), env: {}, run: git.run, record: (c) => recorded.push(c), now: () => NOW });
      assert.equal(got.published, true);
      assert.equal(git.calls.filter((c) => callOf(c.args)[0] === 'push').length, 2, 'refused once as the branch moved on, then pushed on its new tip');
      assert.ok(git.calls.every((c) => !c.args.includes('--force') && !c.args.some((a) => String(a).startsWith('+') && a.includes(':refs/heads/'))));
      assert.equal(JSON.parse(await remoteText(remote.url, file)).publicKey, own.publicKey);
      assert.equal(await remoteText(remote.url, 'events/x.json'), '{}', 'the other computer\'s event is kept');
      assert.equal(recorded.length, 1);
      assert.equal(recorded[0].before, planted);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
      remote.cleanup();
    }
  });
});

test('a large file under this computer\'s id is recorded by its hash and size, not its text (ruling R107)', async () => {
  await withHome(async () => {
    const remote = await profileHere();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-big-'));
    try {
      ownComputer();
      await g(scratch, 'clone', '-q', '-b', PROFILE_BRANCH, remote.url, '.');
      const big = 'x'.repeat(10000);
      fs.mkdirSync(path.join(scratch, 'enrolments'));
      fs.writeFileSync(path.join(scratch, 'enrolments', `${computerId()}.json`), big);
      await g(scratch, 'add', '.');
      await g(scratch, 'commit', '-q', '-m', 'big');
      await g(scratch, 'push', '-q', 'origin', PROFILE_BRANCH);
      const recorded = [];
      assert.equal((await publishEnrolment({ profile: profileRemote(), env: {}, record: (c) => recorded.push(c), now: () => NOW })).published, true);
      assert.deepEqual(recorded[0].before, { sha256: crypto.createHash('sha256').update(big).digest('hex'), bytes: 10000 });
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
      remote.cleanup();
    }
  });
});

test('a failed push of the key leaves the helper\'s profile branch as it was, and a later profile push goes through', async () => {
  const home = shortHome();
  const remote = await makeBareRemote({ repo: PROFILE_REPO });
  let helper;
  try {
    await as(home, async () => {
      ownComputer();
      fs.writeFileSync(path.join(home, 'profile.json'), JSON.stringify({
        remoteUrl: remote.url, host: 'github', repo: PROFILE_REPO, connection: { host: 'github', mode: 'quick', project: PROFILE_REPO },
      }));
      let tick = 0;
      helper = await startHelper({
        run: hostGuard,
        address: testAddress(home), adapterFor: async () => ({}), envFor: async () => ({ mode: 'quick', env: {} }),
        now: () => new Date(NOW.getTime() + 1000 * (tick += 1)),
      });
      const client = helperClient({ address: helper.address });
      assert.deepEqual(await client.profile.clone({}), { ok: true, made: true });
      const before = await clean();
      const failing = async (file, args, options) => (callOf(args)[0] === 'push' ? { code: 1, stdout: '', stderr: 'denied' } : hostGuard(file, args, options));
      await assert.rejects(publishEnrolment({ profile: profileRemote(), env: {}, run: failing, now: () => NOW }), { message: NOT_PUBLISHED });
      assert.deepEqual(await clean(), before, 'nothing on the helper\'s branch for its push rules to refuse');
      const wrote = await client.profile.write({ kind: 'setting', data: { key: 'briefing', value: 'short', words: 'Keep the briefing short' } });
      assert.equal(wrote.ok, true, JSON.stringify(wrote));
      assert.equal(wrote.pushed, true);
      // Published after all, the helper's next push still goes through, carrying the key along.
      assert.equal((await publishEnrolment({ profile: profileRemote(), env: {}, run: hostGuard, now: () => NOW })).published, true);
      const next = await client.profile.write({ kind: 'setting', data: { key: 'briefing', value: 'detailed', words: 'Keep the briefing detailed' } });
      assert.equal(next.pushed, true, JSON.stringify(next));
      const files = (await g(remote.url, 'ls-tree', '-r', '--name-only', PROFILE_BRANCH)).split('\n');
      assert.ok(files.includes(`enrolments/${computerId()}.json`));
      assert.equal(files.filter((f) => f.startsWith('events/')).length, 2);
    });
  } finally {
    if (helper) await as(home, () => helper.close());
    fs.rmSync(home, { recursive: true, force: true });
    remote.cleanup();
  }
});

test('the last uninstall takes this computer\'s key back out of the profile by its exact SHA, only while it holds the key setup published', async () => {
  await withHome(async () => {
    const remote = await profileHere();
    try {
      ownComputer();
      const own = ownKey();
      const env = directorGitEnv({ host: 'github', gitPath: 'git', platform: 'darwin' });
      const recorded = [];
      await publishEnrolment({ profile: profileRemote(), env, run: hostGuard, record: (c) => recorded.push(c), now: () => NOW });
      const { target, after } = recorded[0];
      const tipBefore = await g(remote.url, 'rev-parse', PROFILE_BRANCH);
      const git = watched();
      assert.deepEqual(await withdrawEnrolment({ profile: profileRemote(), target, after, env, run: git.run }), { put: true });
      const tip = await g(remote.url, 'rev-parse', PROFILE_BRANCH);
      assert.equal(await g(remote.url, 'rev-parse', `${tip}^`), tipBefore);
      assert.equal(await g(remote.url, 'diff-tree', '--no-commit-id', '--name-status', '-r', tip), `D\tenrolments/${own.computer}.json`);
      const pushes = git.calls.filter((c) => callOf(c.args)[0] === 'push');
      assert.deepEqual(pushes.map((c) => callOf(c.args)), [['push', '--no-verify', '--porcelain', remote.url, `${tip}:refs/heads/${PROFILE_BRANCH}`]]);
      assert.ok(git.calls.every((c) => path.basename(c.cwd).startsWith('withdraw-')) && !fs.existsSync(git.calls[0].cwd));
      // Gone already: nothing to do.
      assert.deepEqual(await withdrawEnrolment({ profile: profileRemote(), target, after, env, run: hostGuard }), { put: true });
      assert.equal(await g(remote.url, 'rev-parse', PROFILE_BRANCH), tip);
      // A key this computer's id holds since, not setup's, stays.
      const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-withdraw-'));
      try {
        await g(work, 'clone', '-q', '-b', PROFILE_BRANCH, remote.url, '.');
        fs.mkdirSync(path.join(work, 'enrolments'), { recursive: true });
        const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
        fs.writeFileSync(path.join(work, 'enrolments', `${own.computer}.json`), `${JSON.stringify({ computer: own.computer, publicKey: other, at: NOW.toISOString() }, null, 2)}\n`);
        await g(work, 'add', '-A');
        await g(work, 'commit', '-q', '-m', 'Another key');
        await g(work, 'push', '-q', 'origin', PROFILE_BRANCH);
      } finally {
        fs.rmSync(work, { recursive: true, force: true });
      }
      const moved = await g(remote.url, 'rev-parse', PROFILE_BRANCH);
      assert.deepEqual(await withdrawEnrolment({ profile: profileRemote(), target, after, env, run: hostGuard }), { put: false, why: 'it holds another key since setup, so it stays' });
      assert.equal(await g(remote.url, 'rev-parse', PROFILE_BRANCH), moved);
      // A host that can't be reached says so.
      await assert.rejects(withdrawEnrolment({ profile: { ...profileRemote(), remoteUrl: path.join(os.tmpdir(), 'wh-no-such-remote.git') }, target, after, env, run: hostGuard }), { message: NOT_WITHDRAWN });
      await assert.rejects(withdrawEnrolment({ profile: profileRemote(), target: 'github:o/p:keys/x.json', after, env, run: hostGuard }));
    } finally {
      remote.cleanup();
    }
  });
});
