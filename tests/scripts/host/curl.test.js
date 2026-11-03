// tests/scripts/host/curl.test.js
// The curl transport (host-access part 1): found by full path, run with a fixed command line and
// everything else on standard input, and its failures read as the kinds the cards already know.
// A stand-in `curl` stands in for the real one; nothing leaves this computer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { curlPath, request, quoteConfig, MERGE_SECONDS } from '../../../scripts/host/curl.js';
import { makeFakeCurl } from '../../helpers/fake-curl.js';

const URL_ = 'https://gitlab.example.org/api/v4/projects/7/merge_requests/3';
const KEY = 'glpat-SECRETSECRET1234';
const CURL = '/usr/bin/curl';
const base = (fake, more = {}) => ({ run: fake.run, curl: CURL, url: URL_, baseEnv: {}, ...more });

// ---- Where curl is ----

test('curlPath: the Mac and Linux have /usr/bin/curl, never the search path', () => {
  const exists = (file) => file === '/usr/bin/curl';
  assert.equal(curlPath({ platform: 'darwin', exists }), '/usr/bin/curl');
  assert.equal(curlPath({ platform: 'linux', exists }), '/usr/bin/curl');
  assert.equal(curlPath({ platform: 'darwin', exists: () => false }), null);
});

test('curlPath: Windows has System32\\curl.exe, then the curl.exe beside git, else null', () => {
  const system = 'C:\\Windows\\System32\\curl.exe';
  const beside = 'C:\\Program Files\\Git\\cmd\\curl.exe';
  const gitPath = 'C:\\Program Files\\Git\\cmd\\git.exe';
  assert.equal(curlPath({ platform: 'win32', systemRoot: 'C:\\Windows', gitPath, exists: () => true }), system);
  assert.equal(curlPath({ platform: 'win32', systemRoot: 'C:\\Windows', gitPath, exists: (file) => file === beside }), beside);
  assert.equal(curlPath({ platform: 'win32', systemRoot: 'C:\\Windows', gitPath, exists: () => false }), null);
  assert.equal(curlPath({ platform: 'win32', systemRoot: 'C:\\Windows', exists: () => false }), null);
});

// ---- The command line and the config ----

test('the command line is exactly -q --config - --silent --show-error --write-out <marker>, and -q is first', async () => {
  const fake = makeFakeCurl([{ body: '{}' }]);
  await request(base(fake, { headers: { 'PRIVATE-TOKEN': KEY } }));
  const { args, file } = fake.calls[0];
  assert.equal(file, CURL);
  assert.deepEqual(args.slice(0, 6), ['-q', '--config', '-', '--silent', '--show-error', '--write-out']);
  assert.equal(args.length, 7);
  assert.match(args[6], /%\{http_code\}/);
  assert.match(args[6], /%\{http_connect\}/);
});

test('the key, the address and the body are never in the arguments or the environment, only on standard input', async () => {
  const fake = makeFakeCurl([{}]);
  await request(base(fake, { method: 'PUT', headers: { 'PRIVATE-TOKEN': KEY }, body: '{"sha":"abc"}', baseEnv: { PATH: '/usr/bin' } }));
  const call = fake.calls[0];
  for (const secret of [KEY, 'projects/7', 'gitlab.example.org', '"sha"']) {
    assert.ok(!call.args.join(' ').includes(secret), `${secret} in argv`);
    assert.ok(!JSON.stringify(call.env ?? {}).includes(secret), `${secret} in env`);
    assert.ok(!JSON.stringify(call.baseEnv ?? {}).includes(secret), `${secret} in baseEnv`);
  }
  assert.ok(call.config.includes(KEY));
  assert.deepEqual(call.pairs.find(([key]) => key === 'url'), ['url', URL_]);
  assert.deepEqual(call.pairs.find(([key]) => key === 'request'), ['request', 'PUT']);
  assert.deepEqual(call.pairs.find(([key]) => key === 'header'), ['header', `PRIVATE-TOKEN: ${KEY}`]);
  assert.deepEqual(call.pairs.find(([key]) => key === 'data-binary'), ['data-binary', '{"sha":"abc"}']);
});

test('quoteConfig escapes the characters curl\'s config treats as special', () => {
  assert.equal(quoteConfig('a"b\\c\nd\re\tf'), '"a\\"b\\\\c\\nd\\re\\tf"');
});

test('a value cannot add a line to the config', async () => {
  const fake = makeFakeCurl([{}]);
  await request(base(fake, { headers: { 'X-One': 'ok' }, body: 'x"\nproxy = "http://evil.example.org"' }));
  const keys = fake.calls[0].pairs.map(([key]) => key);
  assert.equal(keys.filter((key) => key === 'proxy').length, 0);
  await assert.rejects(request(base(makeFakeCurl([{}]), { headers: { 'X-Bad': 'a\nproxy = "x"' } })), /header/i);
  await assert.rejects(request(base(makeFakeCurl([{}]), { url: 'https://gitlab.example.org/\nproxy = "x"' })), /address/i);
});

test('limits: connect 20 seconds, 120 in all or 300 for a merge, answer at most 10 MB, https only', async () => {
  const fake = makeFakeCurl([{}, {}]);
  await request(base(fake));
  await request(base(fake, { maxSeconds: MERGE_SECONDS }));
  const first = Object.fromEntries(fake.calls[0].pairs);
  const second = Object.fromEntries(fake.calls[1].pairs);
  assert.equal(first['connect-timeout'], '20');
  assert.equal(first['max-time'], '120');
  assert.equal(second['max-time'], '300');
  assert.equal(MERGE_SECONDS, 300);
  assert.equal(first['max-filesize'], String(10 * 1024 * 1024));
  assert.equal(first.proto, '=https');
  assert.equal(first['proto-redir'], '=https');
});

test('a body over 1 MB is refused before curl runs', async () => {
  const fake = makeFakeCurl([{}]);
  await assert.rejects(request(base(fake, { body: 'x'.repeat(1024 * 1024 + 1) })), /too large/i);
  assert.equal(fake.calls.length, 0);
});

test('a local development address may be http, and then keeps the protocol open', async () => {
  const fake = makeFakeCurl([{}]);
  await request(base(fake, { url: 'http://127.0.0.1:8080/api/v4/version' }));
  assert.equal(Object.fromEntries(fake.calls[0].pairs).proto, undefined);
  await assert.rejects(request(base(makeFakeCurl([{}]), { url: 'http://gitlab.example.org/api/v4/version' })), /https/i);
});

// ---- The environment ----

test('curl\'s own proxy and certificate variables are taken out of its environment', async () => {
  const fake = makeFakeCurl([{}]);
  const baseEnv = {
    PATH: '/usr/bin', HOME: '/h', HTTPS_PROXY: 'x', https_proxy: 'x', ALL_PROXY: 'x', all_proxy: 'x', HTTP_PROXY: 'x', NO_PROXY: 'x', no_proxy: 'x',
    CURL_CA_BUNDLE: 'x', SSL_CERT_FILE: 'x', CURL_SSL_BACKEND: 'x',
  };
  await request(base(fake, { baseEnv }));
  assert.deepEqual(Object.keys(fake.calls[0].baseEnv).sort(), ['HOME', 'PATH']);
});

// ---- Answers ----

test('a read gives { status, body, connect }, whatever the body holds', async () => {
  const body = '{"a":1}\n@@ 200 0';
  const fake = makeFakeCurl([{ status: 404, body, connect: 200 }]);
  assert.deepEqual(await request(base(fake)), { status: 404, body, connect: 200 });
});

test('an empty body is an empty string', async () => {
  assert.deepEqual(await request(base(makeFakeCurl([{ status: 204 }]))), { status: 204, body: '', connect: 0 });
});

// ---- Failures ----

test('each exit code maps to its kind', async () => {
  const cases = [
    [5, 'HOST_UNREACHABLE'], [6, 'HOST_UNREACHABLE'], [7, 'HOST_UNREACHABLE'], [28, 'HOST_UNREACHABLE'], [52, 'HOST_UNREACHABLE'], [56, 'HOST_UNREACHABLE'],
    [60, 'CERTIFICATE_NOT_TRUSTED'], [77, 'CERTIFICATE_NOT_TRUSTED'],
  ];
  for (const [exit, code] of cases) {
    await assert.rejects(request(base(makeFakeCurl([{ exit, stderr: 'curl: boom' }]))), (error) => {
      assert.equal(error.code, code, `exit ${exit}`);
      return true;
    });
  }
});

test('exit 35 is a certificate when curl says so, else not a host that is away', async () => {
  await assert.rejects(request(base(makeFakeCurl([{ exit: 35, stderr: 'schannel: SEC_E_UNTRUSTED_ROOT (0x80090325)' }]))), { code: 'CERTIFICATE_NOT_TRUSTED' });
  await assert.rejects(request(base(makeFakeCurl([{ exit: 35, stderr: 'schannel: failed to receive handshake' }]))), (error) => error.code === 'HOST_REQUEST_FAILED');
});

test('exit 28 is marked as a timeout, so a merge that hits it is not confirmed', async () => {
  await assert.rejects(request(base(makeFakeCurl([{ exit: 28 }]))), (error) => error.code === 'HOST_UNREACHABLE' && error.timedOut === true);
  await assert.rejects(request(base(makeFakeCurl([{ exit: 7 }]))), (error) => error.code === 'HOST_UNREACHABLE' && error.timedOut === false);
});

test('a proxy that answers 407 to the tunnel is PROXY_REFUSED, whatever the exit code', async () => {
  for (const exit of [0, 56, 97]) {
    await assert.rejects(request(base(makeFakeCurl([{ exit, connect: 407, status: 0 }]))), (error) => {
      assert.equal(error.code, 'PROXY_REFUSED');
      assert.match(error.message, /company's proxy didn't accept this computer's sign-in/);
      return true;
    });
  }
});

test('an error line names the host and never quotes curl\'s own text or the key', async () => {
  await assert.rejects(request(base(makeFakeCurl([{ exit: 6, stderr: `curl: (6) Could not resolve host ${KEY}` }]))), (error) => {
    assert.doesNotMatch(error.message, /resolve|glpat/);
    assert.match(error.message, /gitlab\.example\.org/);
    return true;
  });
});

test('no curl at all is said plainly, and nothing runs', async () => {
  const fake = makeFakeCurl([{}]);
  await assert.rejects(request({ ...base(fake), curl: null }), (error) => error.code === 'NO_CURL' && /no curl Wheelhouse can use/.test(error.message));
  assert.equal(fake.calls.length, 0);
});

// ---- Retries ----

test('Windows: a blocked revocation check is retried once with --ssl-revoke-best-effort', async () => {
  const fake = makeFakeCurl([{ exit: 35, stderr: 'schannel: next InitializeSecurityContext failed: CRYPT_E_NO_REVOCATION_CHECK (0x80092012)' }, { status: 200, body: 'ok' }]);
  const got = await request(base(fake, { platform: 'win32' }));
  assert.equal(got.body, 'ok');
  assert.equal(fake.calls.length, 2);
  assert.ok(!fake.calls[0].pairs.some(([key]) => key === 'ssl-revoke-best-effort'));
  assert.ok(fake.calls[1].pairs.some(([key]) => key === 'ssl-revoke-best-effort'));
  assert.deepEqual(fake.calls[1].args, fake.calls[0].args);
});

test('Windows: the retry happens once, and a revocation block that remains is a certificate failure', async () => {
  const blocked = { exit: 35, stderr: 'CRYPT_E_NO_REVOCATION_CHECK' };
  const fake = makeFakeCurl([blocked, blocked]);
  await assert.rejects(request(base(fake, { platform: 'win32' })), { code: 'CERTIFICATE_NOT_TRUSTED' });
  assert.equal(fake.calls.length, 2);
});

test('the revocation retry is for Windows only', async () => {
  const fake = makeFakeCurl([{ exit: 35, stderr: 'CRYPT_E_NO_REVOCATION_CHECK' }, {}]);
  await assert.rejects(request(base(fake, { platform: 'darwin' })));
  assert.equal(fake.calls.length, 1);
});

test('the Mac: exit 60 is retried once with --cacert where setup made the file', async () => {
  const fake = makeFakeCurl([{ exit: 60 }, { body: 'ok' }]);
  const got = await request(base(fake, { platform: 'darwin', caFile: '/h/ca/company.pem' }));
  assert.equal(got.body, 'ok');
  assert.deepEqual(fake.calls[1].pairs.find(([key]) => key === 'cacert'), ['cacert', '/h/ca/company.pem']);
  assert.ok(!fake.calls[0].pairs.some(([key]) => key === 'cacert'));
});

test('the Mac: with no file, or when the retry fails too, it is a certificate failure', async () => {
  const none = makeFakeCurl([{ exit: 60 }]);
  await assert.rejects(request(base(none, { platform: 'darwin', caFile: null })), { code: 'CERTIFICATE_NOT_TRUSTED' });
  assert.equal(none.calls.length, 1);
  const both = makeFakeCurl([{ exit: 60 }, { exit: 60 }]);
  await assert.rejects(request(base(both, { platform: 'darwin', caFile: '/h/ca/company.pem' })), { code: 'CERTIFICATE_NOT_TRUSTED' });
  assert.equal(both.calls.length, 2);
});

test('the file is not given to curl on Windows, where Schannel reads the system store', async () => {
  const fake = makeFakeCurl([{ exit: 60 }]);
  await assert.rejects(request(base(fake, { platform: 'win32', caFile: 'C:\\h\\ca\\company.pem' })));
  assert.equal(fake.calls.length, 1);
});

// ---- The proxy ----

test('a proxy is given as curl\'s own options, signing in as the computer\'s user', async () => {
  const cases = { ntlm: 'proxy-ntlm', negotiate: 'proxy-negotiate', anyauth: 'proxy-anyauth' };
  for (const [auth, option] of Object.entries(cases)) {
    const fake = makeFakeCurl([{}]);
    await request(base(fake, { proxy: { proxy: 'http://p.example.org:8080', auth, user: ':', noProxy: 'a.example.org' } }));
    const pairs = fake.calls[0].pairs;
    assert.deepEqual(pairs.find(([key]) => key === 'proxy'), ['proxy', 'http://p.example.org:8080']);
    assert.ok(pairs.some(([key]) => key === option), option);
    assert.equal(pairs.filter(([key]) => /^proxy-(ntlm|negotiate|anyauth)$/.test(key)).length, 1);
    assert.deepEqual(pairs.find(([key]) => key === 'proxy-user'), ['proxy-user', ':']);
    assert.deepEqual(pairs.find(([key]) => key === 'noproxy'), ['noproxy', 'a.example.org']);
  }
});

test('no proxy means no proxy lines, and a named user adds no proxy-user', async () => {
  const none = makeFakeCurl([{}, {}]);
  await request(base(none));
  assert.ok(!none.calls[0].pairs.some(([key]) => /^(proxy|noproxy)/.test(key)));
  await request(base(none, { proxy: { proxy: 'http://u@p.example.org:8080', auth: 'ntlm', user: null, noProxy: null } }));
  assert.ok(!none.calls[1].pairs.some(([key]) => key === 'proxy-user'));
});

// ---- Never off ----

test('nothing in the transport switches a certificate check off', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  for (const file of ['scripts/host/curl.js', 'scripts/host/proxy.js', 'tests/helpers/fake-curl.js']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8').replace(/^\/\/.*$/gm, '');
    assert.doesNotMatch(text, /(^|[\s'"`])(-k|--insecure)\b/, file);
    assert.doesNotMatch(text, /\binsecure\b|rejectUnauthorized/i, file);
  }
});

test('curl is run nowhere else in the host code', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const stack = [path.join(root, 'scripts', 'host')];
  const offenders = [];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.js') && full !== path.join(root, 'scripts/host/curl.js') && /['"]curl(\.exe)?['"]/.test(fs.readFileSync(full, 'utf8').replace(/^\s*\/\/.*$/gm, ''))) offenders.push(path.relative(root, full));
    }
  }
  assert.deepEqual(offenders, []);
});
