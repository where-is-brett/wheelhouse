// tests/probes/gitlab-ee-lib.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { standInTools } from '../helpers/host-stand-ins.js';
import { tempFolder } from '../helpers/homes.js';
import { GITLAB_EE_TAG, makeTestPeople, names, startGitlab, stopGitlab } from '../../probes/lib/gitlab-ee.js';
import { makeTestCa } from '../../probes/lib/test-ca.js';

const unix = process.platform !== 'win32';
const t = unix ? test : test.skip;
const ROOT_TOKEN = 'glpat-root-secret-value-1234';

const stands = standInTools();
after(() => stands.restore());

// A stand-in `docker` first on the PATH: it notes each call's arguments (and standard input) and
// answers `exec` with a root token line.
function dockerStandIn() {
  const dir = tempFolder('wh-docker-');
  const log = path.join(dir, 'docker.log');
  fs.writeFileSync(log, '');
  fs.writeFileSync(path.join(dir, 'docker'), [
    '#!/bin/sh',
    `printf '%s' "$*" | tr '\\n' ';' >> '${log}'; echo >> '${log}'`,
    'if [ "$1" = exec ]; then cat > /dev/null; echo "booting noise"; echo "WHEELHOUSE_TOKEN=' + ROOT_TOKEN + '"; fi',
    'exit 0', '',
  ].join('\n'), { mode: 0o755 });
  const before = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${before}`;
  return { calls: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean), restore: () => { process.env.PATH = before; } };
}

const NO_WAIT = async () => {};

t('startGitlab never writes /etc/hosts and never passes the root token as an argument', async () => {
  const docker = dockerStandIn();
  try {
    const dir = tempFolder('wh-gitlab-');
    const started = await startGitlab({ dir, port: 18929, wait: NO_WAIT });
    const calls = docker.calls();
    assert.ok(calls.some((line) => line.startsWith('run ') && line.includes(`gitlab/gitlab-ee:${GITLAB_EE_TAG}`)));
    assert.ok(calls.some((line) => line.includes('--publish 127.0.0.1:18929:18929')), 'only on 127.0.0.1');
    assert.ok(calls.some((line) => line.includes("external_url 'https://localhost:18929'")));
    assert.ok(calls.some((line) => line.startsWith('exec -i ') && line.includes('gitlab-rails runner -')), 'the script goes in on standard input');
    for (const line of calls) {
      assert.ok(!line.includes(ROOT_TOKEN), 'the token is not an argument');
      assert.ok(!line.includes('/etc/hosts'));
      assert.ok(!/--add-host/.test(line));
    }
    assert.equal(started.baseUrl, 'https://localhost:18929');
    assert.ok(!JSON.stringify(started).includes(ROOT_TOKEN), 'the result names a file, not the token');
    assert.deepEqual(stands.calls(), []);
  } finally { docker.restore(); }
});

t("the root token file is mode 600 and inside the probe's state folder", async () => {
  const docker = dockerStandIn();
  try {
    const dir = tempFolder('wh-gitlab-');
    const { rootToken } = await startGitlab({ dir, port: 18930, wait: NO_WAIT });
    assert.equal(path.dirname(rootToken), path.join(dir, 'state'));
    assert.equal(fs.statSync(rootToken).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(rootToken, 'utf8').trim(), ROOT_TOKEN);
    for (const file of fs.readdirSync(path.join(dir, 'state', 'tls'))) {
      assert.equal(fs.statSync(path.join(dir, 'state', 'tls', file)).mode & 0o777, 0o600);
    }
  } finally { docker.restore(); }
});

t('stopGitlab removes the containers and their volumes', async () => {
  const docker = dockerStandIn();
  try {
    const dir = tempFolder('wh-gitlab-');
    await startGitlab({ dir, port: 18931, wait: NO_WAIT });
    await stopGitlab({ dir, port: 18931 });
    const calls = docker.calls();
    const name = names(18931);
    assert.ok(calls.includes(`rm --force ${name.gitlab}`));
    assert.ok(calls.includes(`rm --force ${name.runner}`));
    for (const volume of name.volumes) assert.ok(calls.includes(`volume rm --force ${volume}`), volume);
    assert.ok(!fs.existsSync(path.join(dir, 'state')), 'the secrets go too');
  } finally { docker.restore(); }
});

t('stopGitlab with remove false only stops the containers', async () => {
  const docker = dockerStandIn();
  try {
    const dir = tempFolder('wh-gitlab-');
    await stopGitlab({ dir, port: 18932, remove: false });
    assert.ok(docker.calls().every((line) => line.startsWith('stop ')));
  } finally { docker.restore(); }
});

test('makeTestPeople makes two users and a token each, kept in files of mode 600', async () => {
  const dir = tempFolder('wh-gitlab-');
  const posted = [];
  const api = {
    post: async (route, body) => {
      posted.push({ route, body });
      if (route === '/users') return { status: 201, body: { id: posted.length } };
      return { status: 201, body: { token: `glpat-person-${route}` } };
    },
  };
  const people = await makeTestPeople(api, { dir });
  assert.deepEqual(Object.keys(people).sort(), ['maintainer', 'second']);
  for (const person of Object.values(people)) {
    for (const file of [person.passwordFile, person.tokenFile]) {
      assert.equal(fs.statSync(file).mode & 0o777, unix ? 0o600 : fs.statSync(file).mode & 0o777);
      assert.ok(file.startsWith(path.join(dir, 'state')));
    }
    assert.ok(!JSON.stringify(person).includes('glpat-'));
    assert.ok(fs.readFileSync(person.passwordFile, 'utf8').trim().length >= 24);
  }
  assert.notEqual(people.maintainer.username, people.second.username);
});

test('makeTestCa makes a certificate for localhost signed by its own authority, which Node.js rejects without it', async () => {
  const dir = tempFolder('wh-ca-');
  const { caPem, certPem, keyPem } = makeTestCa(dir);
  const server = https.createServer({ cert: fs.readFileSync(certPem), key: fs.readFileSync(keyPem) }, (req, res) => res.end('ok'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const get = (options) => new Promise((resolve, reject) => {
    https.get({ host: 'localhost', port, path: '/', ...options }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
  });
  try {
    await assert.rejects(get({}), /certificate|issuer/i);
    assert.equal(await get({ ca: fs.readFileSync(caPem) }), 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
