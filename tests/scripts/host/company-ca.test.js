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
  CERTIFICATE_NOT_TRUSTED, failureKind, unreachableRefusal, outputKind, companyGitEnv, makeAwayLog, stageCaFile, certificateRefusal, awayLine,
  revocationFallback,
} from '../../../scripts/host/company-ca.js';
import { safeGit, directorSignIn } from '../../../scripts/lib/safe-git.js';
import { setupGit, setupGitEnv, FENCE } from '../../../scripts/setup/git.js';
import { makeAdapter } from '../../../scripts/host/adapter.js';
import { gitlabApi } from '../../../scripts/host/gitlab-key.js';
import { applyCompanyCa } from '../../../scripts/setup/tools.js';
import { boardModel } from '../../../scripts/board/model.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { makeEvent, writeEvent, syncState } from '../../../scripts/state/events.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, tempFolder } from '../../helpers/homes.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
// Where code that could switch a check off would be: the scripts, and the adapters and the editor extension where they exist.
const CODE_FOLDERS = ['scripts', 'adapters', 'vscode', 'hooks'].map((name) => path.join(ROOT, name)).filter((dir) => fs.existsSync(dir));
const BASE = 'https://git.example.org:8443';
const GLAB_HOST = 'git.example.org:8443';
const TOKEN = 'glpat-STANDINTOKEN0123456789';

// Public test certificates (tests/fixtures/certs/, made for tests, their keys not kept): three
// authorities in date, a server's own certificate, and an authority that expired in 2020.
const certificate = (name) => /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----\n?/.exec(
  fs.readFileSync(fileURLToPath(new URL(`../../fixtures/certs/${name}.pem`, import.meta.url)), 'utf8'),
)[0].replace(/\n?$/, '\n');
const ROOT_A = certificate('ca-valid');
const ROOT_B = certificate('ca-two');
const COMPANY = certificate('ca-company');
const LEAF = certificate('leaf');
const EXPIRED = certificate('ca-expired');
const NOW = () => new Date('2026-10-22T00:00:00.000Z');

function jsFilesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFilesIn(full);
    return /\.(?:js|mjs|cjs|ts)$/.test(entry.name) ? [full] : [];
  });
}

// Every spelling that switches a certificate check off, in an environment, a git setting or a flag.
const CHECKS_OFF = /GIT_SSL_NO_VERIFY|NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized['"]?\s*[:=]\s*(?:false|0)\b|sslVerify['"]?\s*[,:=]?\s*['"]?(?:false|0|no|off)\b|skip_tls_verify|--insecure\b|--no-check-certificate|['"]-k['"]/i;

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
  for (const file of CODE_FOLDERS.flatMap(jsFilesIn)) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      // The tool guard's table of `timeout`'s own options (its `-k` is a kill delay in a shell command it reads), not a git or curl flag.
      const toTest = file.endsWith(path.join('scripts', 'hooks', 'tool-guard.js')) ? line.replace(/\btimeout: \['-s', '-k'\]/, '') : line;
      if (CHECKS_OFF.test(toTest)) found.push(`${path.relative(ROOT, file)}:${i + 1}`);
    });
  }
  assert.ok(CODE_FOLDERS.some((dir) => dir.endsWith('scripts')));
  // The scan sees each spelling.
  for (const line of ['GIT_SSL_NO_VERIFY=1', 'process.env.NODE_TLS_REJECT_UNAUTHORIZED = \'0\'', '{ rejectUnauthorized: false }', 'http.sslVerify=false', 'args.push(\'-k\')', '--insecure']) assert.match(line, CHECKS_OFF);
  assert.doesNotMatch('[\'http.sslVerify\', \'true\']', CHECKS_OFF);
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
  // Only the certificate settings for one address are taken: git's fence keeps every pair a caller
  // adds, so anything else (an include, a helper, a header, a command to run) is refused here.
  for (const key of ['include.path', 'credential.helper', `http.${BASE}/.extraHeader`, 'core.sshCommand', 'core.fsmonitor', 'http.sslCAInfo', 'core.sslCAInfo', `http.${BASE}/.proxy`, '']) {
    assert.throws(() => withGitConfig({}, [{ key, value: 'x' }]), /certificate settings/, key);
  }
  assert.deepEqual(withGitConfig({}, [{ key: `http.${BASE}/.sslBackend`, value: 'schannel' }]).GIT_CONFIG_COUNT, '1');
  // And refuse an environment whose count of git settings is not a whole number.
  for (const bad of ['two', '-1', '1.5', '']) assert.throws(() => withGitConfig({ GIT_CONFIG_COUNT: bad }, gitCaConfig(BASE, caFile(home), 'darwin')), /whole number/);
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
      const dir = await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
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
  const text = await exportSystemRoots({ platform: 'darwin', run: mac, now: NOW });
  assert.deepEqual(mac.calls.map((c) => [c.file, ...c.args]), [
    ['security', 'find-certificate', '-a', '-p', '/System/Library/Keychains/SystemRootCertificates.keychain'],
    ['security', 'find-certificate', '-a', '-p', '/Library/Keychains/System.keychain'],
  ]);
  // Each certificate once, in the order found, as well-formed PEM.
  assert.equal(text, `${ROOT_A}${ROOT_B}${COMPANY}`);

  // One keychain unreadable: the other still gives its certificates.
  const half = glabRun((args) => (args.at(-1) === '/Library/Keychains/System.keychain' ? { code: 44, stdout: '', stderr: 'could not be found' } : { code: 0, stdout: ROOT_A, stderr: '' }));
  assert.equal(await exportSystemRoots({ platform: 'darwin', run: half, now: NOW }), ROOT_A);

  // Windows: the machine's Root store, read through PowerShell and written out as PEM.
  const win = glabRun(() => ({ code: 0, stdout: `${ROOT_B.replace(/\n/g, '\r\n')}${COMPANY.replace(/\n/g, '\r\n')}`, stderr: '' }));
  const winText = await exportSystemRoots({ platform: 'win32', run: win, now: NOW });
  assert.equal(winText, `${ROOT_B}${COMPANY}`);
  assert.ok(win.calls.length >= 1);
  assert.ok(win.calls.every((c) => /^powershell(\.exe)?$/i.test(path.win32.basename(String(c.file)))));

  // Nothing readable is an error in plain words, and another system is not guessed at.
  await assert.rejects(exportSystemRoots({ platform: 'darwin', run: glabRun(() => ({ code: 1, stdout: '', stderr: '' })), now: NOW }), /certificates/);
  await assert.rejects(exportSystemRoots({ platform: 'linux', run: mac, now: NOW }), /macOS and Windows/);
  // A run that throws is the same as one that found nothing.
  await assert.rejects(exportSystemRoots({ platform: 'darwin', run: async () => { throw new Error('spawn security ENOENT'); }, now: NOW }), /certificates/);
});

test('only authorities still in date are kept: a server\'s own certificate and an expired authority are left out', async () => {
  const garbage = '-----BEGIN CERTIFICATE-----\nQUFBQUFB\n-----END CERTIFICATE-----\n';
  const mixed = `${LEAF}${ROOT_A}${EXPIRED}${garbage}${COMPANY}`;
  const mac = glabRun((args) => ({ code: 0, stdout: args.at(-1).endsWith('System.keychain') && !args.at(-1).includes('Root') ? mixed : '', stderr: '' }));
  assert.equal(await exportSystemRoots({ platform: 'darwin', run: mac, now: NOW }), `${ROOT_A}${COMPANY}`);
  const win = glabRun(() => ({ code: 0, stdout: mixed.replace(/\n/g, '\r\n'), stderr: '' }));
  assert.equal(await exportSystemRoots({ platform: 'win32', run: win, now: NOW }), `${ROOT_A}${COMPANY}`);
  // The same authority is out of date after its end: the filter follows the clock it is given.
  await assert.rejects(exportSystemRoots({ platform: 'darwin', run: glabRun(() => ({ code: 0, stdout: `${LEAF}${EXPIRED}`, stderr: '' })), now: NOW }), /certificates/);
  await assert.rejects(exportSystemRoots({ platform: 'darwin', run: glabRun(() => ({ code: 0, stdout: ROOT_A, stderr: '' })), now: () => new Date('2060-01-01T00:00:00.000Z') }), /certificates/);
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
  // schannel's own wording (git on Windows) and the others read as the same failure.
  for (const text of [
    'schannel: SEC_E_UNTRUSTED_ROOT (0x80090325) - The certificate chain was issued by an authority that is not trusted.',
    'schannel: next InitializeSecurityContext failed: CRYPT_E_NO_REVOCATION_CHECK (0x80092012) - The revocation function was unable to check revocation for the certificate',
    'fatal: unable to access \'https://git.example.org/\': schannel: The certificate chain was issued by an authority that is not trusted.',
    'SSL certificate problem: unable to get local issuer certificate',
  ]) assert.equal(outputKind(text), 'certificate', text);
  assert.equal(outputKind('Failed to connect to git.example.org port 443'), 'unreachable');
  assert.equal(outputKind('remote: HTTP Basic: Access denied'), null);
  assert.notEqual(CERTIFICATE_NOT_TRUSTED(BASE), HOST_UNREACHABLE(BASE));
  assert.match(CERTIFICATE_NOT_TRUSTED(BASE), /never switches/i);
});

test('the lines for gitlab.com carry no company wording, and a company address keeps its own', async () => {
  const PUBLIC = 'https://gitlab.com';
  const record = (baseUrl) => ({ host: 'gitlab', connection: baseUrl === undefined ? {} : { baseUrl } });
  const gitAway = 'fatal: unable to access \'https://gitlab.com/o/p.git/\': Failed to connect to gitlab.com port 443 after 3 ms: Couldn\'t connect to server';
  const gitCertificate = 'fatal: unable to access \'https://gitlab.com/o/p.git/\': SSL certificate problem: unable to get local issuer certificate';
  const NO_COMPANY = /company|certificate for that address|add your/i;

  // The unreachable line: said plainly for the public service, never "perhaps off the company network".
  assert.equal(HOST_UNREACHABLE(PUBLIC), "GitLab (gitlab.com) can't be reached from here. Work carries on here and is sent when it can be.");
  assert.equal(HOST_UNREACHABLE(`${PUBLIC}/`), HOST_UNREACHABLE(PUBLIC));
  assert.doesNotMatch(HOST_UNREACHABLE(PUBLIC), NO_COMPANY);
  for (const r of [record(), record(PUBLIC)]) {
    assert.equal(awayLine(r), HOST_UNREACHABLE(PUBLIC));
    assert.equal(unreachableRefusal(r, gitAway), HOST_UNREACHABLE(PUBLIC));
    assert.doesNotMatch(unreachableRefusal(r, gitAway), NO_COMPANY);
    assert.equal(certificateRefusal(r, gitCertificate), CERTIFICATE_NOT_TRUSTED(PUBLIC));
  }

  // The certificate line: no promise of a certificate step setup never offers for the default address.
  assert.doesNotMatch(CERTIFICATE_NOT_TRUSTED(PUBLIC), NO_COMPANY);
  assert.match(CERTIFICATE_NOT_TRUSTED(PUBLIC), /GitLab \(gitlab\.com\).*isn't one this computer trusts.*never switches certificate checks off.*ask whoever looks after/i);
  assert.match(CERTIFICATE_NOT_TRUSTED(BASE), /can add your company's own certificate for that address/);
  assert.match(HOST_UNREACHABLE(BASE), /^Your company's GitLab, https:\/\/git\.example\.org:8443, can't be reached from here, perhaps off the company network\./);

  // Where the lines are said: the adapter and the API for gitlab.com, and the board's away line.
  const publicAdapter = makeAdapter({ host: 'gitlab', repo: 'o/p', run: glabRun(() => ({ code: 1, stdout: '', stderr: GLAB_UNREACHABLE[0] })), env: {}, base: PUBLIC });
  await assert.rejects(publicAdapter.defaultBranch(), (error) => error.message === HOST_UNREACHABLE(PUBLIC) && error.code === 'HOST_UNREACHABLE');
  const publicCertificate = makeAdapter({ host: 'gitlab', repo: 'o/p', run: glabRun(() => ({ code: 1, stdout: '', stderr: GLAB_CERTIFICATE })), env: {}, base: PUBLIC });
  await assert.rejects(publicCertificate.defaultBranch(), (error) => error.message === CERTIFICATE_NOT_TRUSTED(PUBLIC) && !NO_COMPANY.test(error.message));
  const api = gitlabApi({ baseUrl: PUBLIC, token: TOKEN, fetch: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('x'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }) }); } });
  await assert.rejects(api.get('/user'), (error) => error.message === CERTIFICATE_NOT_TRUSTED(PUBLIC));
  const board = boardModel({ project: 'demo', hostUnreachable: PUBLIC, now: () => new Date('2026-10-22T00:00:00.000Z') });
  assert.ok(JSON.stringify(board).includes("GitLab (gitlab.com) can't be reached from here"));
  assert.doesNotMatch(JSON.stringify(board), /company network/);
});

test('a merge that could not reach the host says so, and a stale head says the head has moved', async () => {
  const merging = (stderr) => gitlabAdapter((args) => (args[0] === 'mr' && args[1] === 'merge' ? { code: 1, stdout: '', stderr } : { code: 0, stdout: '{}', stderr: '' }));

  // Not merged, and not a refusal's line.
  const seen = new Set();
  for (const text of GLAB_UNREACHABLE.filter((t) => !/timeout|deadline/.test(t))) {
    const { adapter } = merging(text);
    const merged = await adapter.merge({ number: 3, sha: SHA });
    assert.equal(merged.merged, false);
    assert.equal(merged.unreachable, true);
    assert.equal(merged.reason, `Not merged. ${HOST_UNREACHABLE(BASE)}`);
    assert.doesNotMatch(merged.reason, /dial tcp|api\/v4/);
    seen.add(merged.reason);
  }
  assert.equal(seen.size, 1);

  // A command that waited and gave up may have reached the host first: said as not confirmed.
  for (const text of GLAB_UNREACHABLE.filter((t) => /timeout|deadline/.test(t))) {
    const merged = await merging(text).adapter.merge({ number: 3, sha: SHA });
    assert.equal(merged.merged, false);
    assert.equal(merged.unreachable, true);
    assert.equal(merged.reason, `The merge could not be confirmed. ${HOST_UNREACHABLE(BASE)}`);
  }

  // A certificate not trusted is not a refusal either.
  const untrusted = await merging(GLAB_CERTIFICATE).adapter.merge({ number: 3, sha: SHA });
  assert.deepEqual(untrusted, { merged: false, certificate: true, reason: `Not merged. ${CERTIFICATE_NOT_TRUSTED(BASE)}` });

  // glab's standard error is its own words: the host's answer on standard output, which can quote
  // a connection or a certificate, is not read as one.
  const quoted = gitlabAdapter((args) => (args[1] === 'merge'
    ? { code: 1, stdout: '{"message":"dial tcp: connection refused x509 certificate is not trusted"}', stderr: '403 Forbidden' }
    : { code: 0, stdout: '{}', stderr: '' }));
  const refusedByHost = await quoted.adapter.merge({ number: 3, sha: SHA });
  assert.equal(refusedByHost.unreachable, undefined);
  assert.equal(refusedByHost.certificate, undefined);
  assert.equal(refusedByHost.reason, 'this sign-in is not allowed to merge it');
  const quotedRead = gitlabAdapter(() => ({ code: 1, stdout: '{"message":"dial tcp: connection refused"}', stderr: 'ERROR 404 Not Found' }));
  await assert.rejects(quotedRead.adapter.defaultBranch(), (error) => {
    assert.equal(error.code, undefined);
    assert.match(error.message, /^glab api projects\/o%2Fp failed: ERROR 404/);
    return true;
  });

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

test('an address that is not https is refused before anything is written or run', async () => {
  for (const bad of ['http://git.example.org', 'ftp://git.example.org', 'git.example.org', '--host', '']) {
    const home = shortHome();
    const run = glabRun(() => ({ code: 0, stdout: ROOT_A, stderr: '' }));
    await assert.rejects(applyCompanyCa({ base: bad, home, platform: 'darwin', run }), /https/, bad);
    assert.deepEqual(run.calls, [], bad);
    assert.ok(!fs.existsSync(caFile(home)), bad);
  }
  // A plain http address on this computer is allowed, as everywhere else.
  const home = shortHome();
  const run = glabRun((args) => (args[0] === 'find-certificate' ? { code: 0, stdout: ROOT_A, stderr: '' } : { code: 0, stdout: '', stderr: '' }));
  const applied = await applyCompanyCa({ base: 'http://127.0.0.1:8929', home, platform: 'darwin', run });
  assert.equal(applied.glabHost, '127.0.0.1:8929');
});

test('the git setting is added for a company GitLab only, once the file exists', () => {
  const home = shortHome();
  const record = { host: 'gitlab', base: BASE };
  assert.deepEqual(companyGitEnv({ A: '1' }, record, { home, platform: 'darwin' }), { A: '1' });
  writeCaFile({ home, pem: COMPANY });
  const given = companyGitEnv({ A: '1' }, record, { home, platform: 'darwin' });
  assert.deepEqual(given, { A: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `http.${BASE}/.sslCAInfo`, GIT_CONFIG_VALUE_0: caFile(home) });
  for (const other of [{ host: 'github', base: BASE }, { host: 'gitlab', base: 'https://gitlab.com' }, { host: 'gitlab' }, { host: 'gitlab', base: 'nonsense' }]) {
    assert.deepEqual(companyGitEnv({ A: '1' }, other, { home, platform: 'darwin' }), { A: '1' }, JSON.stringify(other));
  }
});

test('the helper\'s record of where GitLab is out of reach keeps a project for a while, and forgets it when reached', () => {
  let clock = Date.parse('2026-10-22T00:00:00.000Z');
  const log = makeAwayLog({ now: () => new Date(clock) });
  assert.deepEqual(log.fresh(), {});
  log.set('o__p', BASE);
  log.set('o__q', BASE);
  assert.deepEqual(log.fresh(), { o__p: BASE, o__q: BASE });
  log.clear('o__q');
  assert.deepEqual(log.fresh(), { o__p: BASE });
  clock += 16 * 60 * 1000;
  assert.deepEqual(log.fresh(), {});
});

test('certificates are staged beside the file and put in place only on commit, so a failure leaves the file as it was', () => {
  const home = shortHome();
  const staged = stageCaFile({ home, pem: ROOT_A });
  assert.ok(!fs.existsSync(caFile(home)), 'nothing is in place yet');
  staged.discard();
  assert.deepEqual(fs.readdirSync(path.dirname(caFile(home))), []);
  writeCaFile({ home, pem: ROOT_A });
  const again = stageCaFile({ home, pem: `${ROOT_A}${COMPANY}` });
  assert.equal(fs.readFileSync(caFile(home), 'utf8'), ROOT_A, 'the old file stands while staged');
  again.discard();
  assert.equal(fs.readFileSync(caFile(home), 'utf8'), ROOT_A);
  const last = stageCaFile({ home, pem: `${ROOT_A}${COMPANY}` });
  last.commit();
  assert.equal(fs.readFileSync(caFile(home), 'utf8'), `${ROOT_A}${COMPANY}`);
  assert.deepEqual(fs.readdirSync(path.dirname(caFile(home))), ['company.pem']);
});

test('git\'s own SSL text is read as the certificate line for a GitLab record, and for nothing else', () => {
  const record = { host: 'gitlab', connection: { baseUrl: BASE } };
  const text = 'fatal: unable to access \'https://git.example.org:8443/o/p.git/\': SSL certificate problem: unable to get local issuer certificate';
  assert.equal(certificateRefusal(record, text), CERTIFICATE_NOT_TRUSTED(BASE));
  assert.equal(certificateRefusal({ host: 'github' }, text), null);
  assert.equal(certificateRefusal(record, 'remote: HTTP Basic: Access denied'), null);
});

// The seam: the certificate's pairs are added to the call's environment before safeGit (or setup's route)
// builds the call's settings, and both keep every pair that is not a fence key, so they arrive after the
// sign-in's pairs, with the count right and the fence whole.
test('the certificate reaches a git call made through safeGit and through setup\'s route, after the sign-in and with the fence whole', async () => {
  const home = shortHome();
  writeCaFile({ home, pem: COMPANY });
  const key = `http.${BASE}/.sslCAInfo`;
  const settingsOf = (env) => Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]);
  const seen = [];
  const spy = async (file, args, options) => { seen.push(options.env); return { code: 0, stdout: '', stderr: '' }; };
  const withCertificate = (env) => companyGitEnv(env, { host: 'gitlab', base: BASE }, { home, platform: 'darwin' });
  const checkFence = (env) => {
    const pairs = settingsOf(env);
    assert.deepEqual(pairs[0], ['credential.helper', ''], 'the clearing of credential helpers is first');
    for (const [k, v] of FENCE) assert.ok(pairs.some(([pk, pv]) => pk === k && pv === v), `${k} stays set`);
    assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
    assert.equal(pairs.filter(([k]) => k === key).length, 1, 'the certificate pair once');
    assert.equal(env.GIT_CONFIG_COUNT, String(pairs.length));
    return pairs;
  };

  // The director's own sign-in (a credential helper pair) with the certificate after it.
  const signIn = directorSignIn('gitlab');
  const before = settingsOf(signIn).length;
  const signed = withCertificate(signIn);
  assert.equal(signed.GIT_CONFIG_COUNT, String(before + 1));
  assert.deepEqual(settingsOf(signIn).length, before, 'the sign-in environment is not changed');
  await safeGit({ run: spy, cwd: home, look: 'never', env: signed })(['push']);
  const pairs = checkFence(seen.pop());
  const helper = pairs.findIndex(([k, v]) => k === 'credential.helper' && v.endsWith('auth git-credential'));
  assert.ok(helper > 0, 'the sign-in helper is kept');
  assert.ok(pairs.findIndex(([k]) => k === key) > helper, 'the certificate comes after the sign-in');
  assert.deepEqual(pairs[pairs.findIndex(([k]) => k === key)], [key, caFile(home)]);

  // A key's own pair (as a narrow connection carries) keeps its place, and the certificate comes after it.
  const narrow = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: 'PRIVATE-TOKEN: x' };
  await safeGit({ run: spy, cwd: home, look: 'never', env: withCertificate(narrow) })(['fetch']);
  const narrowPairs = checkFence(seen.pop());
  assert.ok(narrowPairs.findIndex(([k]) => k === key) > narrowPairs.findIndex(([k]) => k === 'http.extraHeader') && narrowPairs.some(([k]) => k === 'http.extraHeader'));

  // Windows: git is told to use the system's own store for that address.
  const windows = companyGitEnv({}, { host: 'gitlab', base: BASE }, { home, platform: 'win32' });
  await safeGit({ run: spy, cwd: home, look: 'never', env: windows })(['fetch']);
  assert.ok(settingsOf(seen.pop()).some(([k, v]) => k === `http.${BASE}/.sslBackend` && v === 'schannel'));

  // Setup's own route (directorGitEnv is setupGitEnv plus the certificate).
  const setupEnv = withCertificate(setupGitEnv({ host: 'gitlab', platform: 'darwin' }));
  await setupGit({ run: spy, cwd: home, env: setupEnv })(['ls-remote', BASE]);
  const calls = seen.splice(0).filter((env) => env.GIT_CONFIG_COUNT !== undefined && !env.GIT_CONFIG_COUNT.startsWith('0'));
  const last = settingsOf(calls.pop());
  assert.ok(last.some(([k, v]) => k === key && v === caFile(home)));
  assert.ok(last.findIndex(([k]) => k === key) > last.findIndex(([k, v]) => k === 'credential.helper' && v.endsWith('auth git-credential')));

  // Another address, a public service, and a computer with no file get no pair.
  const none = [
    companyGitEnv(signIn, { host: 'gitlab', base: 'https://gitlab.com' }, { home, platform: 'darwin' }),
    companyGitEnv(signIn, { host: 'github', base: BASE }, { home, platform: 'darwin' }),
    companyGitEnv(signIn, { host: 'gitlab', base: BASE }, { home: shortHome(), platform: 'darwin' }),
  ];
  for (const env of none) assert.equal(env.GIT_CONFIG_COUNT, signIn.GIT_CONFIG_COUNT);
});

// What git through Windows' store says when the network blocks the revocation check.
const BLOCKED = 'fatal: unable to access \'https://git.example.org/o/p.git/\': schannel: next InitializeSecurityContext failed: CRYPT_E_NO_REVOCATION_CHECK (0x80092012) - The revocation function was unable to check revocation for the certificate.';

test('a blocked revocation check through Windows\' store turns into the certificate file for that address, with git\'s own TLS (option C)', () => {
  const home = tempFolder('wh-ca-home-');
  const env = withGitConfig({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '' }, gitCaConfig('https://git.example.org', '', 'win32'));
  // No file yet: nothing to fall back to.
  assert.equal(revocationFallback(env, BLOCKED, { home }), null);
  writeCaFile({ home, pem: '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n' });
  const back = revocationFallback(env, BLOCKED, { home });
  const pairs = Array.from({ length: Number(back.GIT_CONFIG_COUNT) }, (_, i) => [back[`GIT_CONFIG_KEY_${i}`], back[`GIT_CONFIG_VALUE_${i}`]]);
  assert.deepEqual(pairs, [
    ['credential.helper', ''],
    ['http.https://git.example.org/.sslCAInfo', caFile(home)],
    ['http.https://git.example.org/.sslBackend', 'openssl'],
  ]);
  // Any other refusal, or a call with no Windows-store setting, is left as it was.
  assert.equal(revocationFallback(env, 'fatal: Authentication failed', { home }), null);
  assert.equal(revocationFallback(withGitConfig({}, gitCaConfig('https://git.example.org', caFile(home), 'darwin')), BLOCKED, { home }), null);
  assert.equal(revocationFallback({}, BLOCKED, { home }), null);
});

test('safeGit tries a call once more with the certificate file when Windows\' store was refused for a blocked revocation check, and only then', async () => {
  const home = tempFolder('wh-ca-home-');
  writeCaFile({ home, pem: '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n' });
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const store = gitCaConfig('https://git.example.org', '', 'win32');
    const seen = [];
    const answers = [{ code: 128, stdout: '', stderr: BLOCKED }, { code: 0, stdout: 'done', stderr: '' }];
    const run = async (file, args, options) => { seen.push(options.env); return answers.shift(); };
    const git = safeGit({ cwd: tempFolder('wh-ca-work-'), look: 'never', run, env: withGitConfig({}, store) });
    assert.deepEqual(await git(['ls-remote', 'https://git.example.org/o/p.git']), { code: 0, stdout: 'done', stderr: '' });
    assert.equal(seen.length, 2);
    const keys = (env) => Object.entries(env).filter(([k]) => /^GIT_CONFIG_KEY_\d+$/.test(k)).map(([, v]) => v);
    assert.ok(keys(seen[0]).includes('http.https://git.example.org/.sslBackend'));
    assert.ok(keys(seen[1]).includes('http.https://git.example.org/.sslCAInfo'));
    // A refusal of another kind is answered as it is, with no second call.
    seen.length = 0;
    answers.push({ code: 128, stdout: '', stderr: 'fatal: Authentication failed' });
    assert.equal((await git(['ls-remote', 'https://git.example.org/o/p.git'])).code, 128);
    assert.equal(seen.length, 1);
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
  }
});
