// tests/scripts/host/push-rules.test.js
import { test, after } from 'node:test';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { checkPush, startHelper, PUSH_REFUSALS } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { helperAddress } from '../../../scripts/lib/paths.js';
import { run } from '../../../scripts/lib/run.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { stateDir, computerId } from '../../../scripts/lib/paths.js';
import { eventPath } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, sign } from '../../../scripts/state/signing.js';
import { ciPushLine } from '../../../scripts/state/card-lines.js';
import { CERTIFICATE_NOT_TRUSTED, caFile, gitCaConfig, writeCaFile } from '../../../scripts/host/company-ca.js';
import { as, shortHome, testAddress, tempFolder } from '../../helpers/homes.js';
import { makeBareRemote, push as plainPush, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { matchingProvenance, writeSessionProvenance } from '../../helpers/provenance.js';
import { parseProvenance, removeProvenance } from '../../../scripts/lineage/provenance.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const SESSION = 'sess-1';

// A run that must not be called: the spelling alone decides these.
const noRun = async () => {
  throw new Error('git should not run for this refspec');
};

async function g(dir, ...args) {
  const r = await run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@invalid', ...args], { cwd: dir, env: { GIT_TERMINAL_PROMPT: '0' } });
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function write(dir, rel, text) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}

// A working clone on `branch`, with origin pointing at a fresh bare remote.
async function workOn(branch, { repo } = {}) {
  const remote = await makeBareRemote({ repo });
  const dir = tempFolder('wh-pr-');
  await g(dir, 'init', '-q');
  await g(dir, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`);
  await g(dir, 'remote', 'add', 'origin', remote.url);
  return {
    dir,
    remote,
    commit: async (message) => {
      await g(dir, 'add', '-A');
      await g(dir, 'commit', '-q', '--allow-empty', '-m', message);
    },
    pushPlain: () => g(dir, 'push', '-q', 'origin', branch),
    cleanup: () => {
      remote.cleanup();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

const check = (refspec, extra = {}) => checkPush({ refspec, dir: os.tmpdir(), defaultBranch: 'main', gitRun: noRun, ...extra });

const SPELLINGS = {
  main: PUSH_REFUSALS.defaultBranch,
  'HEAD:main': PUSH_REFUSALS.plain,
  'refs/heads/main': PUSH_REFUSALS.plain,
  '+feature': PUSH_REFUSALS.force,
  '+feature:feature': PUSH_REFUSALS.force,
  ':main': PUSH_REFUSALS.remove,
  ':feature': PUSH_REFUSALS.remove,
  'feature:main': PUSH_REFUSALS.same,
  'feature:refs/heads/main': PUSH_REFUSALS.same,
  'feature:other': PUSH_REFUSALS.same,
};
for (const [refspec, rule] of Object.entries(SPELLINGS)) {
  test(`checkPush refuses ${refspec}`, async () => {
    assert.deepEqual(await check(refspec), { allowed: false, refused: rule });
  });
}

test('checkPush refuses names that are not plain branch names', async () => {
  for (const refspec of ['', '-f', '--force', 'HEAD', 'feat ure', 'a..b', 'feature/', '/feature', 'x.lock', 'a:b:c', 'feature\n']) {
    assert.equal((await check(refspec)).allowed, false, refspec);
  }
  assert.equal((await check(42)).allowed, false);
});

test('checkPush allows feature and feature:feature', async () => {
  const work = await workOn('feature');
  try {
    write(work.dir, 'a.txt', 'a\n');
    await work.commit('First');
    for (const refspec of ['feature', 'feature:feature']) {
      const r = await checkPush({ refspec, dir: work.dir, defaultBranch: 'main', gitRun: run });
      assert.equal(r.allowed, true, refspec);
      assert.equal(r.branch, 'feature');
      assert.match(r.sha, /^[0-9a-f]{40}$/);
    }
    const nested = await checkPush({ refspec: 'wh/task-14.b', dir: work.dir, defaultBranch: 'main', gitRun: run });
    assert.equal(nested.allowed, false, 'a branch that does not exist here is refused');
  } finally { work.cleanup(); }
});

test('a lock push that changes anything but lock.json is refused', async () => {
  const work = await workOn('wheelhouse-lock');
  try {
    write(work.dir, 'lock.json', '{"counter":1}\n');
    await work.commit('Take the lock');
    assert.equal((await checkPush({ refspec: 'wheelhouse-lock', dir: work.dir, defaultBranch: 'main', gitRun: run })).allowed, true);
    await work.pushPlain();

    write(work.dir, 'lock.json', '{"counter":2}\n');
    write(work.dir, 'other.txt', 'x\n');
    await work.commit('Take the lock again');
    const r = await checkPush({ refspec: 'wheelhouse-lock', dir: work.dir, defaultBranch: 'main', gitRun: run });
    assert.equal(r.allowed, false);
    assert.match(r.refused, /lock\.json/);

    await g(work.dir, 'reset', '-q', '--hard', 'origin/wheelhouse-lock');
    write(work.dir, 'lock.json', '{"counter":2}\n');
    await work.commit('Take the lock again');
    assert.equal((await checkPush({ refspec: 'wheelhouse-lock', dir: work.dir, defaultBranch: 'main', gitRun: run })).allowed, true);

    await g(work.dir, 'reset', '-q', '--hard', 'origin/wheelhouse-lock');
    fs.rmSync(path.join(work.dir, 'lock.json'));
    await work.commit('Drop the lock');
    assert.equal((await checkPush({ refspec: 'wheelhouse-lock', dir: work.dir, defaultBranch: 'main', gitRun: run })).allowed, false);
  } finally { work.cleanup(); }
});

test('a lock push may carry lock.json only as a plain file: no symlink or executable', async () => {
  const work = await workOn('wheelhouse-lock');
  const lockPush = () => checkPush({ refspec: 'wheelhouse-lock', dir: work.dir, defaultBranch: 'main', gitRun: run });
  try {
    write(work.dir, 'lock.json', '{"counter":1}\n');
    await work.commit('Take the lock');
    await work.pushPlain();
    // A symlink, made in the index so it works on every system.
    write(work.dir, 'target.txt', '../../../secret.txt');
    const blob = (await g(work.dir, 'hash-object', '-w', 'target.txt')).trim();
    fs.rmSync(path.join(work.dir, 'target.txt'));
    await g(work.dir, 'update-index', '--cacheinfo', `120000,${blob},lock.json`);
    await g(work.dir, 'commit', '-q', '-m', 'Make the lock a link');
    assert.deepEqual(await lockPush(), { allowed: false, refused: PUSH_REFUSALS.lock });

    await g(work.dir, 'reset', '-q', '--hard', 'origin/wheelhouse-lock');
    write(work.dir, 'lock.json', '{"counter":2}\n');
    await g(work.dir, 'add', '-A');
    await g(work.dir, 'update-index', '--chmod=+x', 'lock.json');
    await g(work.dir, 'commit', '-q', '-m', 'Make the lock executable');
    assert.deepEqual(await lockPush(), { allowed: false, refused: PUSH_REFUSALS.lock });
  } finally { work.cleanup(); }
});

test('the default branch is read from the host, not assumed to be main', async () => {
  assert.equal((await check('trunk', { defaultBranch: 'trunk' })).allowed, false);
  assert.equal((await check('main', { defaultBranch: undefined })).allowed, false, 'an unknown default branch refuses');

  // Through the helper: the adapter says the default branch is trunk, asked once per project.
  const home = tempFolder('wh-');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  const work = await workOn('main', { repo: 'o/p' });
  let asked = 0;
  const adapter = { defaultBranch: async () => { asked += 1; return 'trunk'; } };
  let helper;
  try {
    writeProject('o__p', {
      folder: work.dir, remoteUrl: work.remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
    await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: work.remote.url });
    assert.equal((await takeLock({ env: LOCAL_PATHS, project: 'o__p', push: plainPush })).taken, true);
    write(work.dir, 'a.txt', 'a\n');
    await work.commit('First');
    await g(work.dir, 'branch', 'trunk');
    const address = process.platform === 'win32'
      ? helperAddress({ platform: 'win32', user: `test-${crypto.randomBytes(4).toString('hex')}` })
      : path.join(home, 'helper.sock');
    helper = await startHelper({ run: hostGuard, address, adapterFor: async () => adapter, envFor: async () => ({}) });
    const client = helperClient({ address: helper.address });
    const refused = await client.push({ project: 'o__p', dir: work.dir, refspec: 'trunk' });
    assert.deepEqual(refused, { ok: false, refused: PUSH_REFUSALS.defaultBranch });
    assert.deepEqual(await client.push({ project: 'o__p', dir: work.dir, refspec: 'main' }), { ok: true });
    assert.equal(asked, 1);
    const listed = await run('git', ['ls-remote', '--heads', work.remote.url], {});
    assert.match(listed.stdout, /refs\/heads\/main/);
    assert.doesNotMatch(listed.stdout, /refs\/heads\/trunk/);
  } finally {
    await helper?.close();
    work.cleanup();
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// --- CI files, the project's folder, partial clones ---

const NOW = new Date('2026-10-18T02:00:00.000Z');
const minutesAgo = (m) => () => new Date(NOW.getTime() - m * 60000);
const FAKE_KEY = 'ghs_FAKEKEY0123456789abcdefSECRET';
const adapterFor = () => ({
  defaultBranch: async () => 'main',
  openPr: async (args) => ({ number: 7, args }),
});

// A project whose folder holds a clone on `feature`: `base` files on main, `change` files on feature.
async function scenario({ base = { 'README.md': 'x\n' }, change, files = {}, project = {} }) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = fs.realpathSync.native(shortHome());
  const work = path.join(home, 'work');
  fs.mkdirSync(work);
  const out = { remote, home, work };
  await as(home, async () => {
    writeProject('o__p', {
      folder: work, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'narrow', project: 'o/p' }, ...project,
    });
    writeSessionProvenance('o__p', SESSION);
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
    assert.equal((await takeLock({ env: LOCAL_PATHS, project: 'o__p', push: plainPush, now: () => NOW })).taken, true);
    await g(work, 'init', '-q', '-b', 'main');
    for (const [name, text] of Object.entries(base)) write(work, name, text);
    await g(work, 'add', '-A');
    await g(work, 'commit', '-q', '-m', 'Base');
    await g(work, 'remote', 'add', 'origin', remote.url);
    await g(work, 'push', '-q', 'origin', 'main');
    await g(work, 'checkout', '-q', '-b', 'feature');
    for (const [name, text] of Object.entries(change ?? files)) write(work, name, text);
    await g(work, 'add', '-A');
    await g(work, 'commit', '-q', '-m', 'Change');
    out.sha = (await g(work, 'rev-parse', 'HEAD')).trim();
  });
  out.cleanup = () => { remote.cleanup(); fs.rmSync(home, { recursive: true, force: true }); };
  return out;
}

function click(overrides = {}, ago = 1) {
  // Signed directly, so a malformed action can be built on purpose: makeEvent refuses those.
  const event = sign({
    v: 1,
    id: crypto.randomUUID(),
    at: minutesAgo(ago)().toISOString(),
    computer: computerId(),
    kind: 'action',
    data: { action: 'ci-push', branch: 'feature', sha: overrides.sha, question: 'Push it?', label: 'Push', ...overrides },
  });
  const file = path.join(stateDir('o__p'), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
}

async function viaHelper(s, fn, { env = {}, runWith = hostGuard } = {}) {
  await as(s.home, async () => {
    const helper = await startHelper({ address: testAddress(s.home), adapterFor, envFor: async () => env, now: () => NOW, run: runWith });
    try { await fn(helperClient({ address: helper.address }), helper); } finally { await helper.close(); }
  });
}
const heads = async (s) => (await run('git', ['for-each-ref', '--format=%(refname)', 'refs/heads'], { cwd: s.remote.url })).stdout;

test('a branch that changes .github/workflows is refused, naming the rule', async () => {
  const s = await scenario({ change: { '.github/workflows/ci.yml': 'on: push\n', 'src/a.js': 'a\n' } });
  try {
    await viaHelper(s, async (client) => {
      assert.deepEqual(await client.push({ project: 'o__p', dir: s.work, refspec: 'feature' }), { ok: false, refused: PUSH_REFUSALS.ciFile });
    });
    assert.doesNotMatch(await heads(s), /feature/);
  } finally { s.cleanup(); }
});

test('a branch that changes .gitlab-ci.yml or a file the configuration lists in ciFiles is refused', async () => {
  const gl = await scenario({ change: { '.gitlab-ci.yml': 'a: b\n' } });
  try {
    await viaHelper(gl, async (client) => {
      assert.equal((await client.push({ project: 'o__p', dir: gl.work, refspec: 'feature' })).refused, PUSH_REFUSALS.ciFile);
    });
  } finally { gl.cleanup(); }
  const config = `${JSON.stringify({ v: 1, criticalAreas: [], ciFiles: ['build/**'], mcpServers: [], webDomains: [] })}\n`;
  const own = await scenario({ base: { '.claude/wheelhouse.json': config }, change: { 'build/Run.sh': 'x\n' } });
  const upper = await scenario({ change: { '.GitHub/Workflows/ci.yml': 'x\n' } });
  try {
    await viaHelper(own, async (client) => {
      assert.equal((await client.push({ project: 'o__p', dir: own.work, refspec: 'feature' })).refused, PUSH_REFUSALS.ciFile);
    });
    await viaHelper(upper, async (client) => {
      assert.equal((await client.push({ project: 'o__p', dir: upper.work, refspec: 'feature' })).refused, PUSH_REFUSALS.ciFile, 'case is ignored');
    });
  } finally { own.cleanup(); upper.cleanup(); }
});

test('a branch whose CI file matches the default branch\'s is allowed', async () => {
  const s = await scenario({ base: { '.github/workflows/ci.yml': 'on: push\n' }, change: { 'src/a.js': 'a\n' } });
  try {
    await viaHelper(s, async (client) => {
      assert.deepEqual(await client.push({ project: 'o__p', dir: s.work, refspec: 'feature' }), { ok: true });
    });
    assert.match(await heads(s), /refs\/heads\/feature/);
  } finally { s.cleanup(); }
});

test('a CI change with the director\'s fresh click for this commit is pushed with the director\'s sign-in, not the key', async () => {
  const s = await scenario({ change: { '.github/workflows/ci.yml': 'on: push\n' } });
  const env = { GH_TOKEN: FAKE_KEY, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x:${FAKE_KEY}`).toString('base64')}` };
  const calls = [];
  const recording = async (file, args, options) => { calls.push({ file, args, env: options?.env }); return hostGuard(file, args, options); };
  try {
    await as(s.home, async () => click({ sha: s.sha }, 9));
    await viaHelper(s, async (client) => {
      assert.deepEqual(await client.push({ project: 'o__p', dir: s.work, refspec: 'feature' }), { ok: true });
    }, { env, runWith: recording });
    assert.match(await heads(s), /refs\/heads\/feature/);
    const pushes = calls.filter((c) => c.args.includes('push'));
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].env.GH_TOKEN, undefined);
    assert.equal(pushes[0].env.GIT_CONFIG_NOSYSTEM, '1', 'the system and global git configuration stay shut out');
    assert.equal(pushes[0].env.GIT_CONFIG_GLOBAL, '/dev/null');
    const values = Object.entries(pushes[0].env).filter(([k]) => /^GIT_CONFIG_VALUE_/.test(k)).map(([, v]) => v);
    assert.ok(values.some((v) => / auth git-credential$/.test(v)), 'signed in through the host tool');
    assert.ok(!values.some((v) => v.includes(Buffer.from(`x:${FAKE_KEY}`).toString('base64'))), 'not the key');
  } finally { s.cleanup(); }
});

test('on a company GitLab the director\'s CI push carries the company\'s certificate for that address once setup has made the file, and git\'s own SSL text is never shown', async () => {
  const company = 'https://git.example.org:8443';
  const gitlab = { host: 'gitlab', connection: { host: 'gitlab', mode: 'narrow', project: 'o/p', baseUrl: company } };
  const pem = fs.readFileSync(new URL('../../fixtures/certs/ca-valid.pem', import.meta.url), 'utf8');
  const settings = (env) => Object.keys(env ?? {}).filter((k) => /^GIT_CONFIG_KEY_\d+$/.test(k)).map((k) => [env[k], env[k.replace('KEY', 'VALUE')]]);
  const withKey = { GITLAB_TOKEN: 'glpat-FAKEKEY0123456789abcd', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `http.${company}/.extraheader`, GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from('oauth2:glpat-FAKEKEY0123456789abcd').toString('base64')}` };

  // Before the file: the click's push has no certificate setting. After: exactly that address's, and no key.
  for (const made of [false, true]) {
    const s = await scenario({ change: { '.gitlab-ci.yml': 'a: b\n' }, project: gitlab });
    const calls = [];
    const recording = async (file, args, options) => { calls.push({ file, args, env: options?.env }); return hostGuard(file, args, options); };
    try {
      await as(s.home, async () => {
        click({ sha: s.sha }, 9);
        if (made) writeCaFile({ home: s.home, pem });
      });
      await viaHelper(s, async (client) => {
        assert.deepEqual(await client.push({ project: 'o__p', dir: s.work, refspec: 'feature' }), { ok: true });
      }, { env: withKey, runWith: recording });
      assert.match(await heads(s), /refs\/heads\/feature/);
      const pushes = calls.filter((c) => c.args.includes('push'));
      assert.equal(pushes.length, 1);
      assert.equal(pushes[0].env.GITLAB_TOKEN, undefined);
      const ssl = settings(pushes[0].env).filter(([k]) => /sslcainfo|sslbackend/i.test(k));
      // The certificate's setting as this system has it: on Windows git's own store (schannel), elsewhere the file.
      assert.deepEqual(ssl, made ? gitCaConfig(company, caFile(s.home)).map(({ key, value }) => [key, value]) : []);
      assert.ok(!settings(pushes[0].env).some(([k]) => /extraheader/i.test(k)), 'the director\'s push holds no key');
      // Every call carries the fence's pairs, so the count is that of all the pairs, with the certificate's among them or not.
      assert.equal(pushes[0].env.GIT_CONFIG_COUNT, String(settings(pushes[0].env).length));
    } finally { s.cleanup(); }
  }

  // A push that git refuses over the certificate says the certificate card's line, not git's text.
  const s = await scenario({ change: { '.gitlab-ci.yml': 'a: b\n' }, project: gitlab });
  const sslText = `fatal: unable to access '${company}/o/p.git/': SSL certificate problem: unable to get local issuer certificate`;
  const refusing = async (file, args, options) => (args.includes('push') ? { code: 128, stdout: '', stderr: sslText, timedOut: false } : hostGuard(file, args, options));
  try {
    await as(s.home, async () => click({ sha: s.sha }, 9));
    await viaHelper(s, async (client) => {
      const answer = await client.push({ project: 'o__p', dir: s.work, refspec: 'feature' });
      assert.deepEqual(answer, { ok: false, refused: CERTIFICATE_NOT_TRUSTED(company) });
      assert.doesNotMatch(JSON.stringify(answer), /SSL certificate problem|unable to access|local issuer/);
    }, { env: withKey, runWith: refusing });
  } finally { s.cleanup(); }
});

test('where the director is not signed in, the CI push says so', async () => {
  const s = await scenario({ change: { '.github/workflows/ci.yml': 'on: push\n' } });
  const env = { GH_TOKEN: FAKE_KEY };
  const failsWithoutKey = async (file, args, options) => (args.includes('push') && !options?.env?.GH_TOKEN
    ? { code: 1, stdout: '', stderr: 'fatal: could not read Username', timedOut: false }
    : hostGuard(file, args, options));
  try {
    await as(s.home, async () => click({ sha: s.sha }));
    await viaHelper(s, async (client) => {
      assert.deepEqual(await client.push({ project: 'o__p', dir: s.work, refspec: 'feature' }),
        { ok: false, refused: 'sign in to GitHub (or GitLab) on this computer to push the CI change' });
    }, { env, runWith: failsWithoutKey });
  } finally { s.cleanup(); }
});

test('a click for another commit, another branch, or older than ten minutes does not count', async () => {
  const s = await scenario({ change: { '.github/workflows/ci.yml': 'on: push\n' } });
  try {
    await as(s.home, async () => {
      click({ sha: 'a'.repeat(40) });
      click({ sha: s.sha, branch: 'other' });
      click({ sha: s.sha }, 11);
      click({ sha: s.sha.slice(0, 7) });
      click({ sha: s.sha, action: 'runbook' });
    });
    await viaHelper(s, async (client) => {
      assert.equal((await client.push({ project: 'o__p', dir: s.work, refspec: 'feature' })).refused, PUSH_REFUSALS.ciFile);
    });
    assert.doesNotMatch(await heads(s), /feature/);
  } finally { s.cleanup(); }
});

test('/ci-push/line gives the card line and records the pending push', async () => {
  const s = await scenario({ change: { 'a.txt': 'a\n' } });
  try {
    await viaHelper(s, async (client) => {
      const answer = await client.ciPushLine({ project: 'o__p', branch: 'feature', sha: s.sha });
      assert.deepEqual(answer, { ok: true, line: ciPushLine('feature', s.sha) });
      assert.equal(answer.line, `Push the CI change on feature at commit ${s.sha.slice(0, 12)} with your own sign-in`);
      await client.ciPushLine({ project: 'o__p', branch: 'other', sha: 'b'.repeat(40) });
      await client.ciPushLine({ project: 'o__p', branch: 'feature', sha: 'c'.repeat(40) });
      assert.equal((await client.ciPushLine({ project: 'o__p', branch: 'feature', sha: 'short' })).ok, false);
      assert.equal((await client.ciPushLine({ project: 'o__p', branch: '--force', sha: s.sha })).ok, false);
    });
    const pending = JSON.parse(fs.readFileSync(path.join(s.home, 'projects', 'o__p', 'ci-pending.json'), 'utf8'));
    assert.deepEqual(Object.keys(pending).sort(), ['feature', 'other']);
    assert.deepEqual(pending.feature, { branch: 'feature', sha: 'c'.repeat(40), at: NOW.toISOString() });
  } finally { s.cleanup(); }
});

test('a push from a folder outside the project is refused', async () => {
  const s = await scenario({ change: { 'a.txt': 'a\n' } });
  const outside = tempFolder('wh-out-');
  try {
    await g(outside, 'init', '-q', '-b', 'feature');
    await g(outside, 'commit', '-q', '--allow-empty', '-m', 'Elsewhere');
    await viaHelper(s, async (client) => {
      assert.deepEqual(await client.push({ project: 'o__p', dir: outside, refspec: 'feature' }), { ok: false, refused: PUSH_REFUSALS.outsideProject });
      // A link inside the project that leads outside is outside too.
      const link = path.join(s.work, 'link');
      fs.symlinkSync(outside, link, 'dir');
      assert.equal((await client.push({ project: 'o__p', dir: link, refspec: 'feature' })).refused, PUSH_REFUSALS.outsideProject);
      assert.deepEqual(await client.push({ project: 'o__p', dir: s.work, refspec: 'feature' }), { ok: true });
    });
  } finally { s.cleanup(); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('a push from a partial clone is refused, and git never ran in it', async () => {
  const s = await scenario({ change: { 'a.txt': 'a\n' } });
  const seen = [];
  const watching = async (file, args, options) => { seen.push(options?.cwd); return hostGuard(file, args, options); };
  try {
    for (const line of ['[extensions]\n\tpartialClone = origin\n', '[remote "origin"]\n\tPROMISOR = true\n']) {
      fs.appendFileSync(path.join(s.work, '.git', 'config'), line);
      await viaHelper(s, async (client) => {
        assert.deepEqual(await client.push({ project: 'o__p', dir: s.work, refspec: 'feature' }), { ok: false, refused: PUSH_REFUSALS.partialClone });
      }, { runWith: watching });
      fs.writeFileSync(path.join(s.work, '.git', 'config'), fs.readFileSync(path.join(s.work, '.git', 'config'), 'utf8').replace(line, ''));
    }
    assert.equal(seen.includes(s.work), false);
    // A linked worktree's .git file leads to the same check, through commondir.
    const linked = path.join(s.home, 'work', 'linked');
    await g(s.work, 'worktree', 'add', '-q', '-b', 'other', linked);
    fs.appendFileSync(path.join(s.work, '.git', 'config'), '[extensions]\n\tpartialclone = origin\n');
    await viaHelper(s, async (client) => {
      assert.equal((await client.push({ project: 'o__p', dir: linked, refspec: 'other' })).refused, PUSH_REFUSALS.partialClone);
    });
  } finally { s.cleanup(); }
});

test('/pr/open refuses a base other than the default branch, and a head the push rules refuse', async () => {
  const s = await scenario({ change: { 'a.txt': 'a\n' } });
  try {
    await viaHelper(s, async (client) => {
      const base = await client.openPr({ project: 'o__p', head: 'feature', base: 'release', title: 't', body: '' });
      assert.deepEqual(base, { ok: false, refused: PUSH_REFUSALS.prBase });
      assert.deepEqual(await client.openPr({ project: 'o__p', head: 'main', base: 'main', title: 't', body: '' }), { ok: false, refused: PUSH_REFUSALS.defaultBranch });
      assert.deepEqual(await client.openPr({ project: 'o__p', head: '+feature', base: 'main', title: 't', body: '' }), { ok: false, refused: PUSH_REFUSALS.force });
      assert.equal((await client.openPr({ project: 'o__p', head: 'feature', base: 'main', title: 't', body: '', session: SESSION })).ok, true);
    });
  } finally { s.cleanup(); }
});

test('a folder with no repository of its own, beside a partial clone named <folder>.git, is refused', async () => {
  const s = await scenario({ change: { 'a.txt': 'a\n' } });
  const seen = [];
  const watching = async (file, args, options) => { seen.push(options?.cwd); return hostGuard(file, args, options); };
  try {
    const bare = path.join(s.home, 'work', 'foo');
    fs.mkdirSync(bare);
    fs.cpSync(path.join(s.work, '.git'), `${bare}.git`, { recursive: true });
    fs.appendFileSync(path.join(`${bare}.git`, 'config'), '[remote "origin"]\n\tpromisor = true\n');
    await viaHelper(s, async (client) => {
      const answer = await client.push({ project: 'o__p', dir: bare, refspec: 'feature' });
      assert.equal(answer.ok, false);
      assert.ok([PUSH_REFUSALS.gitOutside, PUSH_REFUSALS.unchecked, PUSH_REFUSALS.missing].includes(answer.refused), answer.refused);
    }, { runWith: watching });
  } finally { s.cleanup(); }
});

test('a config that includes another file is refused, as the included file is not read', async () => {
  const s = await scenario({ change: { 'a.txt': 'a\n' } });
  try {
    fs.writeFileSync(path.join(s.home, 'more.cfg'), '[remote "origin"]\n\tpromisor = true\n');
    fs.appendFileSync(path.join(s.work, '.git', 'config'), `[Include]\n\tpath = ${path.join(s.home, 'more.cfg')}\n`);
    await viaHelper(s, async (client) => {
      assert.deepEqual(await client.push({ project: 'o__p', dir: s.work, refspec: 'feature' }), { ok: false, refused: PUSH_REFUSALS.partialClone });
    });
  } finally { s.cleanup(); }
});

test('a sibling folder whose name starts with the project folder\'s name is outside the project', async () => {
  const s = await scenario({ change: { 'a.txt': 'a\n' } });
  try {
    const sibling = `${s.work}-other`;
    fs.cpSync(s.work, sibling, { recursive: true });
    await viaHelper(s, async (client) => {
      assert.equal((await client.push({ project: 'o__p', dir: sibling, refspec: 'feature' })).refused, PUSH_REFUSALS.outsideProject);
    });
  } finally { s.cleanup(); }
});

test('a branch that deletes a CI file is refused', async () => {
  const s = await scenario({ base: { '.github/workflows/ci.yml': 'on: push\n' }, change: { 'b.txt': 'b\n' } });
  try {
    await as(s.home, async () => {
      await g(s.work, 'rm', '-q', '.github/workflows/ci.yml');
      await g(s.work, 'commit', '-q', '-m', 'Drop CI');
    });
    await viaHelper(s, async (client) => {
      assert.equal((await client.push({ project: 'o__p', dir: s.work, refspec: 'feature' })).refused, PUSH_REFUSALS.ciFile);
    });
  } finally { s.cleanup(); }
});

test('/pr/open with no base opens against the default branch, and any other base is still refused', async () => {
  const s = await scenario({ change: { 'a.txt': 'a\n' } });
  try {
    await viaHelper(s, async (client) => {
      const opened = await client.openPr({ project: 'o__p', head: 'feature', title: 't', body: 'b', session: SESSION });
      assert.equal(opened.ok, true, JSON.stringify(opened));
      assert.equal(opened.result.args.base, 'main');
      assert.equal(opened.result.args.head, 'feature');
      assert.equal(removeProvenance(opened.result.args.body), 'b');
      assert.deepEqual(parseProvenance(opened.result.args.body), matchingProvenance(), 'stamped from the session');
      assert.deepEqual(await client.openPr({ project: 'o__p', head: 'feature', base: null, title: 't', body: '' }), { ok: false, refused: PUSH_REFUSALS.prBase });
      assert.deepEqual(await client.openPr({ project: 'o__p', head: 'feature', base: 'release', title: 't', body: '' }), { ok: false, refused: PUSH_REFUSALS.prBase });
      assert.deepEqual(await client.openPr({ project: 'o__p', head: 'main', title: 't', body: '' }), { ok: false, refused: PUSH_REFUSALS.defaultBranch });
    });
  } finally { s.cleanup(); }
});

test('/pr/open sends the plain branch name, and refuses the state and lock branches', async () => {
  const s = await scenario({ change: { 'a.txt': 'a\n' } });
  try {
    await viaHelper(s, async (client) => {
      const opened = await client.openPr({ project: 'o__p', head: 'feature:feature', base: 'main', title: 't', body: '', session: SESSION });
      assert.equal(opened.result.args.head, 'feature');
      for (const head of ['wheelhouse-state', 'wheelhouse-lock']) {
        assert.deepEqual(await client.openPr({ project: 'o__p', head, base: 'main', title: 't', body: '' }), { ok: false, refused: PUSH_REFUSALS.ownRequests });
      }
    });
  } finally { s.cleanup(); }
});

test('a non-authentication failure of the director\'s CI push is reported as git\'s own', async () => {
  const s = await scenario({ change: { '.github/workflows/ci.yml': 'on: push\n' } });
  const env = { GH_TOKEN: FAKE_KEY };
  const broken = async (file, args, options) => (args.includes('push') && !options?.env?.GH_TOKEN
    ? { code: 1, stdout: '', stderr: 'fatal: remote hung up', timedOut: false }
    : hostGuard(file, args, options));
  try {
    await as(s.home, async () => click({ sha: s.sha }));
    await viaHelper(s, async (client) => {
      assert.match((await client.push({ project: 'o__p', dir: s.work, refspec: 'feature' })).refused, /^git could not push/);
    }, { env, runWith: broken });
  } finally { s.cleanup(); }
});
