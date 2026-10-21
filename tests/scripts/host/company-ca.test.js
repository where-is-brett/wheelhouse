// tests/scripts/host/company-ca.test.js
// A company's own certificate authority, and a company GitLab that cannot be reached (check 71,
// Part 6 Task 2). Nothing real is touched: the keychain, certutil, glab and git are stand-ins
// run through an injected `run`; every test has a home of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  caFile, exportSystemRoots, writeCaFile, caEnv, glabCaArgs, gitCaConfig, withGitConfig, HOST_UNREACHABLE,
  CERTIFICATE_NOT_TRUSTED, failureKind, unreachableRefusal,
} from '../../../scripts/host/company-ca.js';
import { makeAdapter } from '../../../scripts/host/adapter.js';
import { gitlabApi } from '../../../scripts/host/gitlab-key.js';
import { applyCompanyCa } from '../../../scripts/setup/tools.js';
import { boardModel } from '../../../scripts/board/model.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { makeEvent, writeEvent, syncState } from '../../../scripts/state/events.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { makeBareRemote } from '../../helpers/git-fixture.js';
import { as, shortHome, tempFolder } from '../../helpers/homes.js';

const SCRIPTS = fileURLToPath(new URL('../../../scripts/', import.meta.url));
const BASE = 'https://git.example.org:8443';
const GLAB_HOST = 'git.example.org:8443';
const TOKEN = 'glpat-STANDINTOKEN0123456789';

// Made-up certificates: the bodies are base64 text, which is all the export reads.
const pem = (body) => `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;
const ROOT_A = pem('QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB');
const ROOT_B = pem('QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJC');
const COMPANY = pem('Q09NUEFOWUNPTVBBTllDT01QQU5ZQ09NUEFOWUNPTVBBTllDT01Q');

function jsFilesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFilesIn(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

// Every spelling that switches a certificate check off, in an environment, a git setting or a flag.
const CHECKS_OFF = /GIT_SSL_NO_VERIFY|NODE_TLS_REJECT_UNAUTHORIZED|sslVerify['"]?\s*[,:=]?\s*['"]?(?:false|0|no|off)\b|skip_tls_verify|--insecure\b|--no-check-certificate|['"]-k['"]/i;

const GLAB_UNREACHABLE = [
  'ERROR Get "https://git.example.org:8443/api/v4/projects/o%2Fp": dial tcp [::1]:8443: connect: connection refused.',
  'ERROR Get "https://git.example.org:8443/api/v4/user": dial tcp: lookup git.example.org: no such host',
  'ERROR Get "https://git.example.org:8443/api/v4/user": dial tcp 10.0.0.5:8443: i/o timeout',
  'ERROR Get "https://git.example.org:8443/api/v4/user": context deadline exceeded',
  'ERROR Failed to get merge request 1: Get "https://git.example.org:8443/api/v4/projects/o%2Fp/merge_requests/1" : dial tcp [::1]:8443:\n  connect: connection refused.',
];
const GLAB_CERTIFICATE = 'ERROR Get "https://git.example.org:8443/api/v4/user": tls: failed to verify certificate: x509: “git.example.org” certificate is not trusted.';
const WRAPPED_SHA = 'ERROR  \n          \n  All attempts fail:\n  #1: PUT https://git.example.org:8443/api/v4/projects/o%2Fp/merge_requests/3/merge: 409 {message: SHA does not\n  match HEAD of source branch: abc}.';
const SHA = 'a'.repeat(40);

// A stand-in `run` for glab: answers each call by its arguments, and notes what it was given.
function glabRun(answer) {
  const calls = [];
  const run = async (file, args, options = {}) => {
    calls.push({ file, args, env: options.env });
    return answer(args);
  };
  return Object.assign(run, { calls });
}

const gitlabAdapter = (answer) => {
  const run = glabRun(answer);
  return { run, adapter: makeAdapter({ host: 'gitlab', repo: 'o/p', run, env: { GITLAB_TOKEN: TOKEN, GITLAB_HOST: GLAB_HOST }, base: BASE }) };
};

test('no route ever sets GIT_SSL_NO_VERIFY, NODE_TLS_REJECT_UNAUTHORIZED=0, sslVerify false or -k', async () => {
  // The code: no script writes any of the spellings.
  const found = [];
  for (const file of jsFilesIn(SCRIPTS)) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (CHECKS_OFF.test(line)) found.push(`${path.relative(SCRIPTS, file)}:${i + 1}`);
    });
  }
  assert.deepEqual(found, []);

  // The routes: what they produce, on both systems, switches nothing off.
  const home = shortHome();
  writeCaFile({ home, pem: COMPANY });
  const everything = [
    caEnv(home),
    glabCaArgs(GLAB_HOST, caFile(home)),
    gitCaConfig(BASE, caFile(home), 'darwin'),
    gitCaConfig(BASE, caFile(home), 'win32'),
    withGitConfig({}, gitCaConfig(BASE, caFile(home), 'darwin')),
    withGitConfig({}, gitCaConfig(BASE, caFile(home), 'win32')),
  ];
  assert.doesNotMatch(JSON.stringify(everything), CHECKS_OFF);
  assert.doesNotMatch(JSON.stringify(everything), /sslverify/i);

  // And the routes refuse to be asked for it.
  assert.throws(() => withGitConfig({}, [{ key: 'http.sslVerify', value: 'false' }]), /certificate/i);
  assert.throws(() => withGitConfig({}, [{ key: `http.${BASE}/.sslVerify`, value: '0' }]), /certificate/i);
});

test('an unreachable host gives HOST_UNREACHABLE and keeps the push for later', async () => {
  // glab: every kind of unreachable text, on a read, gives the one line and the code, never glab's own words.
  for (const text of GLAB_UNREACHABLE) {
    const { adapter } = gitlabAdapter(() => ({ code: 1, stdout: '', stderr: text }));
    await assert.rejects(adapter.defaultBranch(), (error) => {
      assert.equal(error.message, HOST_UNREACHABLE(BASE));
      assert.equal(error.code, 'HOST_UNREACHABLE');
      assert.doesNotMatch(error.message, /dial tcp|api\/v4|refused|timeout|deadline|no such host/i);
      return true;
    });
  }
  assert.equal(HOST_UNREACHABLE(BASE), `Your company's GitLab, ${BASE}, can't be reached from here, perhaps off the company network. Work carries on here and is sent when it can be.`);

  // git: a push to a host that is away says the same line, and only for GitLab.
  const gitAway = 'fatal: unable to access \'https://git.example.org:8443/o/p.git/\': Failed to connect to git.example.org port 8443 after 3 ms: Couldn\'t connect to server';
  assert.equal(unreachableRefusal({ host: 'gitlab', connection: { baseUrl: BASE } }, gitAway), HOST_UNREACHABLE(BASE));
  assert.equal(unreachableRefusal({ host: 'gitlab', connection: { baseUrl: BASE } }, 'fatal: unable to access \'https://x/\': Could not resolve host: git.example.org'), HOST_UNREACHABLE(BASE));
  assert.equal(unreachableRefusal({ host: 'github', connection: {} }, gitAway), null);
  assert.equal(unreachableRefusal({ host: 'gitlab', connection: { baseUrl: BASE } }, 'remote: GitLab: You are not allowed to push code to this project'), null);

  // The push is kept: the event stays committed here, is not sent, and the next sync still counts it.
  const remote = await makeBareRemote();
  try {
    await as(shortHome(), async () => {
      const dir = await cloneState({ project: 'o__p', remoteUrl: remote.url });
      assert.equal(dir, stateDir('o__p'));
      const event = makeEvent({ kind: 'note', data: { text: 'while away' } });
      const away = async () => ({ ok: false, refused: HOST_UNREACHABLE(BASE) });
      const written = await writeEvent({ project: 'o__p', event, push: away });
      assert.equal(written.pushed, false);
      assert.equal(written.refused, HOST_UNREACHABLE(BASE));
      assert.ok(fs.existsSync(written.path));
      const log = await realRun('git', ['log', '--format=%s', '-1'], { cwd: dir });
      assert.equal(log.stdout.trim(), `note ${event.id}`);
      const synced = await syncState({ project: 'o__p', push: away });
      assert.equal(synced.unpushed, 1);
    });
  } finally { remote.cleanup(); }
});

test('the board says so in one line when the host cannot be reached', () => {
  const quiet = boardModel({ project: 'demo', now: () => new Date('2026-10-22T00:00:00.000Z') });
  assert.ok(!quiet.director.health.some((l) => l.text.includes("can't be reached")));
  const away = boardModel({ project: 'demo', hostUnreachable: BASE, now: () => new Date('2026-10-22T00:00:00.000Z') });
  const lines = away.director.health.filter((l) => l.text.includes("can't be reached"));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, HOST_UNREACHABLE(BASE));
  assert.equal(lines[0].level, 'watch');
  assert.ok(lines[0].text.length <= 200);
});

test('the certificate is given to Node.js, glab and git for that address only', async () => {
  const home = shortHome();
  const file = caFile(home);
  assert.equal(file, path.join(home, 'ca', 'company.pem'));

  // Node.js: the exported file, once it exists; nothing before.
  assert.deepEqual(caEnv(home), {});
  writeCaFile({ home, pem: COMPANY });
  assert.deepEqual(caEnv(home), { NODE_EXTRA_CA_CERTS: file });
  assert.equal(fs.readFileSync(file, 'utf8'), COMPANY);

  // glab: its own setting, for that host.
  assert.deepEqual(glabCaArgs(GLAB_HOST, file), ['config', 'set', 'ca_cert', file, '--host', GLAB_HOST]);
  assert.throws(() => glabCaArgs('', file), /host/);
  assert.throws(() => glabCaArgs('--host', file), /host/);

  // git: a setting keyed to the address, passed through the call's environment, never git's own config files.
  assert.deepEqual(gitCaConfig(BASE, file, 'darwin'), [{ key: `http.${BASE}/.sslCAInfo`, value: file }]);
  assert.deepEqual(gitCaConfig(`${BASE}/`, file, 'linux'), [{ key: `http.${BASE}/.sslCAInfo`, value: file }]);
  const env = withGitConfig({ PATH: '/bin' }, gitCaConfig(BASE, file, 'darwin'));
  assert.deepEqual(env, { PATH: '/bin', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `http.${BASE}/.sslCAInfo`, GIT_CONFIG_VALUE_0: file });
  assert.ok(!Object.keys(env).some((k) => /GLOBAL|SYSTEM/.test(k)));
  // After settings already in the environment, with the count carried on.
  const after = withGitConfig({ GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'a.b', GIT_CONFIG_VALUE_0: '1', GIT_CONFIG_KEY_1: 'c.d', GIT_CONFIG_VALUE_1: '2' }, gitCaConfig(BASE, file, 'darwin'));
  assert.equal(after.GIT_CONFIG_COUNT, '3');
  assert.equal(after.GIT_CONFIG_KEY_0, 'a.b');
  assert.equal(after.GIT_CONFIG_KEY_2, `http.${BASE}/.sslCAInfo`);
  assert.equal(after.GIT_CONFIG_VALUE_2, file);
  // Nothing that names every address.
  assert.ok(!gitCaConfig(BASE, file, 'darwin').some(({ key }) => /^http\.ssl/i.test(key)));
  assert.throws(() => gitCaConfig('not an address', file, 'darwin'), /address/);

  // Setup applies it: glab is run with that host and file, git's entries come back for the caller's
  // environment, and git is not run at all (so no config file of the person's is written).
  const run = glabRun(() => ({ code: 0, stdout: '', stderr: '' }));
  const applied = await applyCompanyCa({ base: BASE, home, platform: 'darwin', run });
  assert.deepEqual(run.calls.map((c) => c.args), [glabCaArgs(GLAB_HOST, file)]);
  assert.deepEqual(applied.nodeEnv, { NODE_EXTRA_CA_CERTS: file });
  assert.deepEqual(applied.gitConfig, gitCaConfig(BASE, file, 'darwin'));
  assert.equal(applied.file, file);
  assert.ok(!run.calls.some((c) => /^git(\.exe)?$/.test(path.basename(String(c.file)))));
  assert.ok(!JSON.stringify(run.calls).includes('--global'));
});

test('exportSystemRoots reads the system roots and the System keychain on macOS, and the Root store on Windows', async () => {
  const mac = glabRun((args) => {
    const keychain = args.at(-1);
    if (keychain.endsWith('SystemRootCertificates.keychain')) return { code: 0, stdout: `${ROOT_A}${ROOT_B}`, stderr: '' };
    return { code: 0, stdout: `${COMPANY}${ROOT_A}`, stderr: '' };
  });
  const text = await exportSystemRoots({ platform: 'darwin', run: mac });
  assert.deepEqual(mac.calls.map((c) => [c.file, ...c.args]), [
    ['security', 'find-certificate', '-a', '-p', '/System/Library/Keychains/SystemRootCertificates.keychain'],
    ['security', 'find-certificate', '-a', '-p', '/Library/Keychains/System.keychain'],
  ]);
  // Each certificate once, in the order found, as well-formed PEM.
  assert.equal(text, `${ROOT_A}${ROOT_B}${COMPANY}`);

  // One keychain unreadable: the other still gives its certificates.
  const half = glabRun((args) => (args.at(-1) === '/Library/Keychains/System.keychain' ? { code: 44, stdout: '', stderr: 'could not be found' } : { code: 0, stdout: ROOT_A, stderr: '' }));
  assert.equal(await exportSystemRoots({ platform: 'darwin', run: half }), ROOT_A);

  // Windows: the machine's Root store, read through PowerShell and written out as PEM.
  const win = glabRun(() => ({ code: 0, stdout: `${ROOT_B.replace(/\n/g, '\r\n')}${COMPANY.replace(/\n/g, '\r\n')}`, stderr: '' }));
  const winText = await exportSystemRoots({ platform: 'win32', run: win });
  assert.equal(winText, `${ROOT_B}${COMPANY}`);
  assert.ok(win.calls.length >= 1);
  assert.ok(win.calls.every((c) => /^powershell(\.exe)?$/i.test(path.win32.basename(String(c.file)))));

  // Nothing readable is an error in plain words, and another system is not guessed at.
  await assert.rejects(exportSystemRoots({ platform: 'darwin', run: glabRun(() => ({ code: 1, stdout: '', stderr: '' })) }), /certificates/);
  await assert.rejects(exportSystemRoots({ platform: 'linux', run: mac }), /macOS and Windows/);
  // A run that throws is the same as one that found nothing.
  await assert.rejects(exportSystemRoots({ platform: 'darwin', run: async () => { throw new Error('spawn security ENOENT'); } }), /certificates/);
});

test('the Windows form uses the system store for that address', () => {
  const file = path.win32.join('C:\\Users\\Pat\\.wheelhouse', 'ca', 'company.pem');
  assert.deepEqual(gitCaConfig(BASE, file, 'win32'), [{ key: `http.${BASE}/.sslBackend`, value: 'schannel' }]);
  // No file is named: Windows' own store holds the authority.
  assert.ok(!JSON.stringify(gitCaConfig(BASE, file, 'win32')).includes('company.pem'));
  const env = withGitConfig({ SystemRoot: 'C:\\Windows' }, gitCaConfig(BASE, file, 'win32'));
  assert.equal(env.GIT_CONFIG_COUNT, '1');
  assert.equal(env.GIT_CONFIG_KEY_0, `http.${BASE}/.sslBackend`);
  assert.equal(env.GIT_CONFIG_VALUE_0, 'schannel');
});

test('a certificate failure and an unreachable server are different cards', async () => {
  const failing = (code, text) => async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(text), { code }) });
  };
  const asked = async (fetch) => {
    const api = gitlabApi({ baseUrl: BASE, token: TOKEN, fetch });
    try { await api.get('/user'); } catch (error) { return error; }
    return assert.fail('GitLab was reached');
  };

  const cert = [];
  for (const code of ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT']) {
    const error = await asked(failing(code, `unable to verify, ${TOKEN}, https://git.example.org:8443/api/v4/user`));
    assert.equal(error.code, code);
    assert.equal(failureKind(error), 'certificate');
    cert.push(error.message);
  }
  const away = [];
  for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT']) {
    const error = await asked(failing(code, `connect ${code} 10.0.0.5:8443, ${TOKEN}`));
    assert.equal(error.code, code);
    assert.equal(failureKind(error), 'unreachable');
    away.push(error.message);
  }
  // Different words, and neither repeats the request, the cause's text or a key.
  assert.ok(cert.every((m) => m === cert[0]));
  assert.ok(away.every((m) => m === away[0]));
  assert.notEqual(cert[0], away[0]);
  assert.equal(away[0], 'Could not reach GitLab');
  assert.equal(cert[0], CERTIFICATE_NOT_TRUSTED(BASE));
  for (const message of [...cert, ...away]) assert.doesNotMatch(message, /glpat|api\/v4|unable to verify|10\.0\.0\.5/);
  // An error with no code stays as it was.
  const plain = await asked(async () => { throw new Error('something else'); });
  assert.equal(plain.message, 'Could not reach GitLab');
  assert.equal(plain.code, undefined);
  assert.equal(failureKind(plain), 'other');

  // glab says the same two things in its own words, and the adapter tells them apart too.
  const { adapter: certAdapter } = gitlabAdapter(() => ({ code: 1, stdout: '', stderr: GLAB_CERTIFICATE }));
  await assert.rejects(certAdapter.defaultBranch(), (error) => {
    assert.equal(error.message, CERTIFICATE_NOT_TRUSTED(BASE));
    assert.equal(error.code, 'CERTIFICATE_NOT_TRUSTED');
    assert.doesNotMatch(error.message, /x509|tls:/);
    return true;
  });
  assert.notEqual(CERTIFICATE_NOT_TRUSTED(BASE), HOST_UNREACHABLE(BASE));
  assert.match(CERTIFICATE_NOT_TRUSTED(BASE), /never switches/i);
});

test('a merge that could not reach the host says so, and a stale head says the head has moved', async () => {
  const merging = (stderr) => gitlabAdapter((args) => (args[0] === 'mr' && args[1] === 'merge' ? { code: 1, stdout: '', stderr } : { code: 0, stdout: '{}', stderr: '' }));

  // Not merged, and not a refusal's line.
  const seen = new Set();
  for (const text of GLAB_UNREACHABLE) {
    const { adapter } = merging(text);
    const merged = await adapter.merge({ number: 3, sha: SHA });
    assert.equal(merged.merged, false);
    assert.equal(merged.unreachable, true);
    assert.equal(merged.reason, `Not merged. ${HOST_UNREACHABLE(BASE)}`);
    assert.doesNotMatch(merged.reason, /dial tcp|api\/v4/);
    seen.add(merged.reason);
  }
  assert.equal(seen.size, 1);

  // glab's wrapped "SHA does not\n  match HEAD", from the recording of check 71.
  const stale = await merging(WRAPPED_SHA).adapter.merge({ number: 3, sha: SHA });
  assert.deepEqual(stale, { merged: false, reason: 'the head of the pull request has moved since it was checked' });
  const flat = await merging('409 {message: SHA does not match HEAD of source branch}').adapter.merge({ number: 3, sha: SHA });
  assert.equal(flat.reason, 'the head of the pull request has moved since it was checked');

  // A real refusal keeps its own line, and a merge conflict is still a conflict.
  const refused = await merging('403 Forbidden').adapter.merge({ number: 3, sha: SHA });
  assert.equal(refused.reason, 'this sign-in is not allowed to merge it');
  assert.equal(refused.unreachable, undefined);
  assert.notEqual(refused.reason, stale.reason);
});

test('applying the certificate runs only through run, and the file is the only thing written', async () => {
  const home = shortHome();
  const before = fs.readdirSync(home);
  const run = glabRun((args) => (args[0] === 'find-certificate'
    ? { code: 0, stdout: ROOT_A, stderr: '' }
    : { code: 0, stdout: '', stderr: '' }));
  const applied = await applyCompanyCa({ base: BASE, home, platform: 'darwin', run });
  assert.deepEqual(run.calls.map((c) => c.file), ['security', 'security', 'glab']);
  assert.equal(fs.readFileSync(caFile(home), 'utf8'), ROOT_A);
  assert.deepEqual(fs.readdirSync(home).filter((n) => !before.includes(n)), ['ca']);
  assert.deepEqual(applied.nodeEnv, { NODE_EXTRA_CA_CERTS: caFile(home) });
  // On Windows git is told to use the system store; Node.js and glab use the file.
  const win = await applyCompanyCa({ base: BASE, home: tempFolder('wh-ca-'), platform: 'win32', run: glabRun(() => ({ code: 0, stdout: COMPANY, stderr: '' })) });
  assert.deepEqual(win.gitConfig, [{ key: `http.${BASE}/.sslBackend`, value: 'schannel' }]);
});
