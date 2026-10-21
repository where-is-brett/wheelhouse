// tests/scripts/host/gitlab-base.test.js
// The company's own GitLab address (check 71): one place writes the public service's address, every
// other module takes the address from gitlabBase or from the base its caller passes. Nothing real is
// reached: the tools are fakes and so is the API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_GITLAB, gitlabBase, commitEmail } from '../../../scripts/host/gitlab-base.js';
import { tokenUrl } from '../../../scripts/host/token-url.js';
import { gitlabKeyPage, cutAccess, revokeGitlabKey } from '../../../scripts/host/cut-access.js';
import { gitlabApi, makeProjectKey } from '../../../scripts/host/gitlab-key.js';
import { detectHost } from '../../../scripts/host/adapter.js';
import { signIn, signInStatus, signUpUrl, SIGN_UP, httpsRemote } from '../../../scripts/setup/host.js';
import { commitAuthor } from '../../../scripts/setup/project-files.js';

const SCRIPTS = fileURLToPath(new URL('../../../scripts/', import.meta.url));
const COMPANY = 'https://git.example.org';
const CONFIG = { gitlabHosts: ['git.example.org', 'localhost:8929'] };

function jsFilesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFilesIn(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

test('no module but gitlab-base names gitlab.com', () => {
  const found = [];
  for (const file of jsFilesIn(SCRIPTS)) {
    const rel = path.relative(SCRIPTS, file).split(path.sep).join('/');
    if (rel === 'host/gitlab-base.js') continue;
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (!/gitlab\.com/i.test(line)) return;
      if (/docs\.gitlab\.com/.test(line)) return; // a comment citing GitLab's documentation
      // Where glab itself comes from: the tool's official download, not where a project lives.
      if (rel === 'setup/tools.js' && /OFFICIAL|releases\/permalink/.test(line)) return;
      found.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(found, []);
});

test('a company remote gives the company\'s address', () => {
  assert.equal(DEFAULT_GITLAB, 'https://gitlab.com');
  assert.equal(gitlabBase({ config: CONFIG, remoteUrl: 'https://git.example.org/team/product.git' }), COMPANY);
  assert.equal(gitlabBase({ config: CONFIG, remoteUrl: 'git@git.example.org:team/product.git' }), COMPANY);
  assert.equal(gitlabBase({ config: CONFIG, remoteUrl: 'ssh://git@git.example.org:2222/team/product.git' }), COMPANY, 'an ssh port is not the web address\'s');
  assert.equal(gitlabBase({ config: CONFIG, remoteUrl: 'https://GIT.example.org/team/product.git' }), COMPANY);
  // The public service, an unlisted host, and no remote at all give the default.
  assert.equal(gitlabBase({ config: CONFIG, remoteUrl: 'https://gitlab.com/team/product.git' }), DEFAULT_GITLAB);
  assert.equal(gitlabBase({ config: CONFIG, remoteUrl: 'https://other.example.org/team/product.git' }), DEFAULT_GITLAB);
  assert.equal(gitlabBase({ config: CONFIG, remoteUrl: 'https://github.com/team/product.git' }), DEFAULT_GITLAB);
  assert.equal(gitlabBase({ config: {}, remoteUrl: 'https://git.example.org/team/product.git' }), DEFAULT_GITLAB);
  assert.equal(gitlabBase({}), DEFAULT_GITLAB);
  assert.equal(gitlabBase({ config: CONFIG, remoteUrl: 'not an address' }), DEFAULT_GITLAB);
  assert.equal(gitlabBase(), DEFAULT_GITLAB);
});

test('the token page, sign-up link and key page use the company\'s address', async () => {
  // The token page.
  const request = { host: 'gitlab', owner: 'team', repos: ['product'], name: 'Wheelhouse agents', days: 365 };
  const page = new URL(tokenUrl({ ...request, base: COMPANY }));
  assert.equal(page.origin, COMPANY);
  assert.equal(page.pathname, '/-/user_settings/personal_access_tokens');
  assert.equal(page.searchParams.get('scopes'), 'api');
  assert.equal(new URL(tokenUrl({ ...request, base: 'https://localhost:8929' })).origin, 'https://localhost:8929');
  assert.equal(new URL(tokenUrl(request)).origin, DEFAULT_GITLAB, 'no base gives the default');
  // The sign-up link and the repository address.
  assert.equal(signUpUrl('gitlab', COMPANY), `${COMPANY}/users/sign_up`);
  assert.equal(signUpUrl('gitlab'), SIGN_UP.gitlab);
  assert.equal(signUpUrl('github', COMPANY), SIGN_UP.github);
  assert.equal(httpsRemote({ host: 'gitlab', repo: 'team/product', base: COMPANY }), `${COMPANY}/team/product.git`);
  assert.equal(httpsRemote({ host: 'gitlab', repo: 'team/product' }), `${DEFAULT_GITLAB}/team/product.git`);
  assert.equal(httpsRemote({ host: 'github', repo: 'team/product', base: COMPANY }), 'https://github.com/team/product.git');
  // The key page, and the director's page for revoking a sign-in.
  assert.equal(gitlabKeyPage({ base: COMPANY, repo: 'team/product', pasted: false }), `${COMPANY}/team/product/-/settings/access_tokens`);
  assert.equal(gitlabKeyPage({ base: COMPANY, repo: 'team/product', pasted: true }), `${COMPANY}/-/user_settings/personal_access_tokens`);
  const answer = await cutAccess({ record: { host: 'gitlab', repo: 'team/product', connection: { mode: 'quick', baseUrl: COMPANY } }, fetch: async () => { throw new Error('no network'); } });
  assert.ok(answer.url.startsWith(COMPANY), answer.url);
  assert.match(answer.message, /git\.example\.org/);
  assert.doesNotMatch(answer.message, /gitlab\.com/);
  // A connection with no address of its own is the default's, from the one place.
  const none = await cutAccess({ record: { host: 'gitlab', repo: 'team/product', connection: { mode: 'quick' } }, fetch: async () => { throw new Error('no network'); } });
  assert.ok(none.url.startsWith(DEFAULT_GITLAB), none.url);
  // The API's default is the same.
  const sent = [];
  await gitlabApi({ token: 't', fetch: async (url) => { sent.push(url); return { status: 200, text: async () => '{}' }; } }).get('/user');
  assert.deepEqual(sent, [`${DEFAULT_GITLAB}/api/v4/user`]);
  await revokeGitlabKey({ name: 'gitlab-project-1', projectId: 1, base: COMPANY, repo: 'team/product', fetch: async () => { throw new Error('no network'); } });
});

test('glab is told the company\'s host, with its port, through GITLAB_HOST', async () => {
  const base = 'https://localhost:8929';
  const calls = [];
  let signedIn = false;
  const run = async (file, args, options = {}) => {
    calls.push({ file: path.basename(file), args: [...args], env: options.env });
    if (args[0] === 'auth' && args[1] === 'status') return signedIn ? { code: 0, stdout: 'Logged in', stderr: '' } : { code: 1, stdout: '', stderr: 'not logged in' };
    if (args[0] === 'auth' && args[1] === 'login') { signedIn = true; return { code: 0, stdout: '', stderr: '' }; }
    if (args[0] === 'api') return { code: 0, stdout: JSON.stringify({ username: 'a-director' }), stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  assert.deepEqual(await signInStatus({ host: 'gitlab', run, base }), { signedIn: false, user: null });
  assert.deepEqual(await signIn({ host: 'gitlab', run, base }), { signedIn: true, user: 'a-director' });
  const glab = calls.filter((c) => c.file === 'glab');
  assert.ok(glab.length >= 4);
  for (const c of glab) assert.equal(c.env?.GITLAB_HOST, 'localhost:8929', `${c.args.join(' ')} gets GITLAB_HOST`);
  const login = glab.find((c) => c.args[1] === 'login');
  assert.deepEqual(login.args.slice(0, 5), ['auth', 'login', '--hostname', 'localhost:8929', '--git-protocol']);
  assert.equal(login.args[5], 'https');
  // `glab api` is never given --hostname: it refuses a port.
  for (const c of glab.filter((x) => x.args[0] === 'api')) assert.ok(!c.args.includes('--hostname'));
  // git_protocol is https for the host.
  assert.ok(glab.some((c) => c.args.join(' ') === 'config set git_protocol https --host localhost:8929'), glab.map((c) => c.args.join(' ')).join(' | '));
  // The default host gets no GITLAB_HOST.
  const plain = [];
  await signInStatus({ host: 'gitlab', run: async (file, args, options = {}) => { plain.push(options.env); return { code: 1, stdout: '', stderr: '' }; } });
  assert.ok(plain.every((env) => env === undefined || env.GITLAB_HOST === undefined));
});

test('the commit email comes from the person\'s profile', async () => {
  const api = (body, status = 200, baseUrl = COMPANY) => ({ baseUrl, get: async (p) => { assert.equal(p, '/user'); return { status, body }; } });
  const profile = { id: 7, username: 'sam', name: 'Sam', commit_email: 'sam@work.example', public_email: 'pub@work.example' };
  assert.equal(await commitEmail({ api: api(profile) }), 'sam@work.example');
  assert.equal(await commitEmail({ api: api({ ...profile, commit_email: '' }) }), 'pub@work.example');
  assert.equal(await commitEmail({ api: api({ ...profile, commit_email: null, public_email: null }) }), '7-sam@users.noreply.git.example.org');
  assert.equal(await commitEmail({ api: api({ id: 7, username: 'sam' }, 200, 'https://localhost:8929') }), '7-sam@users.noreply.localhost', 'the port is not part of the mailbox');
  assert.equal(await commitEmail({ api: api({ id: 7, username: 'sam' }, 200, DEFAULT_GITLAB) }), '7-sam@users.noreply.gitlab.com');
  await assert.rejects(commitEmail({ api: api({}, 401) }), /who is signed in/);
  await assert.rejects(commitEmail({ api: api({ name: 'No id' }) }), /who is signed in/);
  // Setup's commit author takes the instance from the project's address.
  const run = async () => ({ code: 0, stdout: JSON.stringify({ id: 7, username: 'sam', name: 'Sam' }), stderr: '' });
  assert.deepEqual(await commitAuthor({ host: 'gitlab', run, base: COMPANY }), { name: 'Sam', email: '7-sam@users.noreply.git.example.org' });
  assert.deepEqual(await commitAuthor({ host: 'gitlab', run }), { name: 'Sam', email: '7-sam@users.noreply.gitlab.com' });
  const own = async () => ({ code: 0, stdout: JSON.stringify({ id: 7, username: 'sam', commit_email: 'sam@work.example' }), stderr: '' });
  assert.deepEqual(await commitAuthor({ host: 'gitlab', run: own, base: COMPANY }), { name: 'sam', email: 'sam@work.example' });
});

test('a remote with a port keeps the port and a gitlabHosts entry may carry one', () => {
  const remote = 'https://localhost:8929/wh71-probe/trial.git';
  const config = { gitlabHosts: ['localhost:8929'] };
  assert.equal(gitlabBase({ config, remoteUrl: remote }), 'https://localhost:8929');
  assert.equal(detectHost(remote, config), 'gitlab', 'an entry written with its port is accepted');
  assert.equal(detectHost(remote, { gitlabHosts: ['localhost'] }), 'gitlab', 'an entry without a port still names the host');
  assert.equal(gitlabBase({ config: { gitlabHosts: ['localhost'] }, remoteUrl: remote }), 'https://localhost:8929');
  // Another port on the same host is another service.
  assert.throws(() => detectHost('https://localhost:9000/a/b.git', config), /localhost:9000.*not GitHub or GitLab/);
  assert.equal(gitlabBase({ config, remoteUrl: 'https://localhost:9000/a/b.git' }), DEFAULT_GITLAB);
  // Plain http is kept only on this computer.
  assert.equal(gitlabBase({ config, remoteUrl: 'http://localhost:8929/a/b.git' }), 'http://localhost:8929');
  assert.equal(gitlabBase({ config: { gitlabHosts: ['git.example.org'] }, remoteUrl: 'http://git.example.org/a/b.git' }), COMPANY);
  assert.equal(new URL(gitlabBase({ config, remoteUrl: remote })).host, 'localhost:8929');
});

test('a refused project key is explained as the group\'s setting', async () => {
  const refused = (status, body) => ({ post: async () => ({ status, body }) });
  const asked = (status, body) => makeProjectKey({ api: refused(status, body), projectId: 5, name: 'w', days: 30 });
  const body = { message: '400 Bad request - User does not have permission to create project access token' };
  await assert.rejects(asked(400, body), (error) => {
    assert.match(error.message, /switched project keys off/);
    assert.match(error.message, /Allow group and project access tokens/);
    assert.match(error.message, /top-level group/);
    assert.match(error.message, /admin/);
    assert.match(error.message, /pasted token/);
    assert.doesNotMatch(error.message, /does not have permission to create/, 'GitLab\'s own words are not repeated');
    assert.doesNotMatch(error.message, /HTTP 400/);
    return true;
  });
  // Any other 400 keeps the general line.
  await assert.rejects(asked(400, { message: '400 Bad request - something else' }), /refused the request for a project key \(HTTP 400\)/);
  await assert.rejects(asked(400, null), /refused the request for a project key \(HTTP 400\)/);
});
