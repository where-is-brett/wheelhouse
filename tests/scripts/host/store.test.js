// tests/scripts/host/store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { borrowKey, storeDirectorKey, storeKey, readKey, deleteKey } from '../../../scripts/host/store.js';

const KEY = 'glpat-SECRETVALUE123';

// A stand-in for git, security and PowerShell: records every call and answers by script.
function fake(answer = () => ({ code: 0, stdout: '' })) {
  const calls = [];
  const run = async (call) => {
    calls.push(call);
    const said = answer(call);
    if (said instanceof Error) throw said;
    return said;
  };
  return { run, calls };
}

const fill = (call) => {
  if (call.args[0] === 'config') return { code: 1, stdout: '' };
  return { code: 0, stdout: `protocol=https\nhost=gitlab.example.org\nusername=dir\npassword=${KEY}\n` };
};

function assertNoKeyOutsideInput(calls) {
  for (const call of calls) {
    assert.ok(!call.args.some((arg) => arg.includes(KEY)), `argv ${call.args.join(' ')}`);
    assert.ok(!Object.values(call.env ?? {}).some((v) => typeof v === 'string' && v.includes(KEY)), 'environment');
  }
}

test('borrowKey asks git credential fill quietly and returns the user name and key', async () => {
  const { run, calls } = fake(fill);
  const got = await borrowKey({ host: 'gitlab.example.org', repoPath: 'team/app', run });
  assert.deepEqual(got, { username: 'dir', key: KEY });
  const call = calls.find((c) => c.args[1] === 'fill');
  assert.equal(call.file, 'git');
  assert.equal(call.input, 'protocol=https\nhost=gitlab.example.org\n\n');
  assert.equal(call.env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(call.env.GCM_INTERACTIVE, 'never');
  assertNoKeyOutsideInput(calls);
});

test('borrowKey sends the path only where credential.useHttpPath is set', async () => {
  const { run, calls } = fake((call) => (call.args[0] === 'config' ? { code: 0, stdout: 'true\n' } : fill(call)));
  await borrowKey({ host: 'gitlab.example.org', repoPath: 'team/app', run });
  assert.equal(calls.find((c) => c.args[1] === 'fill').input, 'protocol=https\nhost=gitlab.example.org\npath=team/app.git\n\n');
  const config = calls.find((c) => c.args[0] === 'config');
  assert.deepEqual(config.args, ['config', '--get-urlmatch', 'credential.useHttpPath', 'https://gitlab.example.org']);
});

test('borrowKey gives null when git has no key, fails, or is missing', async () => {
  assert.equal(await borrowKey({ host: 'h.example.org', run: fake(() => ({ code: 128, stdout: '' })).run }), null);
  assert.equal(await borrowKey({ host: 'h.example.org', run: fake(() => ({ code: 0, stdout: 'username=a\n' })).run }), null);
  assert.equal(await borrowKey({ host: 'h.example.org', run: fake(() => Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })).run }), null);
});

test('borrowKey never runs reject', async () => {
  const { run, calls } = fake(fill);
  await borrowKey({ host: 'gitlab.example.org', run });
  const refused = fake(() => ({ code: 128, stdout: '' }));
  await borrowKey({ host: 'gitlab.example.org', run: refused.run });
  assert.ok(!calls.concat(refused.calls).some((c) => c.args.includes('reject')));
});

test('storeDirectorKey runs approve with everything on standard input', async () => {
  const { run, calls } = fake();
  await storeDirectorKey({ host: 'gitlab.example.org', username: 'dir', key: KEY, run });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['credential', 'approve']);
  assert.equal(calls[0].input, `protocol=https\nhost=gitlab.example.org\nusername=dir\npassword=${KEY}\n\n`);
  assertNoKeyOutsideInput(calls);
});

test('storeDirectorKey refuses values that span lines, and says plainly when git fails', async () => {
  const { run } = fake();
  await assert.rejects(storeDirectorKey({ host: 'h', username: 'a\nhost=evil', key: KEY, run }), /spans lines/);
  await assert.rejects(storeDirectorKey({ host: 'h', username: 'a', key: `${KEY}\nx`, run }), (e) => !e.message.includes(KEY));
  await assert.rejects(storeDirectorKey({ host: 'h', username: 'a', key: KEY, run: fake(() => ({ code: 1, stdout: '' })).run }), (e) => !e.message.includes(KEY));
});

test('storeKey puts the key in the macOS keychain through security -i on standard input', async () => {
  const { run, calls } = fake();
  await storeKey('gitlab-project-42', { token: KEY }, { platform: 'darwin', run });
  assert.deepEqual([calls[0].file, calls[0].args], ['security', ['-i']]);
  assert.match(calls[0].input, /^add-generic-password -U -s wheelhouse -a gitlab-project-42 -w /);
  assert.ok(calls[0].input.includes(KEY));
  assertNoKeyOutsideInput(calls);
});

test('storeKey reaches Credential Manager through PowerShell on standard input', async () => {
  const { run, calls } = fake();
  await storeKey('github-app', { accessToken: KEY }, { platform: 'win32', run });
  assert.equal(calls[0].file, 'powershell');
  assert.ok(calls[0].input.includes(KEY));
  assertNoKeyOutsideInput(calls);
});

test('on Linux the keys go through the helper under Wheelhouse\'s own protocol', async () => {
  const { run, calls } = fake((call) => (call.args[1] === 'fill'
    ? { code: 0, stdout: `protocol=wheelhouse\nhost=wheelhouse\nusername=github-app\npassword=${JSON.stringify({ accessToken: KEY })}\n` }
    : { code: 0, stdout: '' }));
  await storeKey('github-app', { accessToken: KEY }, { platform: 'linux', run });
  assert.deepEqual(calls[0].args, ['credential', 'approve']);
  assert.equal(calls[0].input, `protocol=wheelhouse\nhost=wheelhouse\nusername=github-app\npassword={"accessToken":"${KEY}"}\n\n`);
  assert.deepEqual(await readKey('github-app', { platform: 'linux', run }), { accessToken: KEY });
  await deleteKey('github-app', { platform: 'linux', run });
  const rejects = calls.filter((c) => c.args[1] === 'reject');
  assert.equal(rejects.length, 1);
  assert.match(rejects[0].input, /^protocol=wheelhouse\n/, 'only Wheelhouse\'s own entry is ever rejected');
  assertNoKeyOutsideInput(calls);
});

test('a missing helper on Linux gives null', async () => {
  const missing = fake(() => Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }));
  assert.equal(await readKey('github-app', { platform: 'linux', run: missing.run }), null);
  const none = fake(() => ({ code: 128, stdout: '' }));
  assert.equal(await readKey('gitlab-project-7', { platform: 'linux', run: none.run }), null);
});

test('readKey reads the keychain back', async () => {
  const mac = fake(() => ({ code: 0, stdout: `${JSON.stringify({ token: KEY })}\n` }));
  assert.deepEqual(await readKey('gitlab-project-42', { platform: 'darwin', run: mac.run }), { token: KEY });
  assert.deepEqual(mac.calls[0].args.slice(0, 5), ['find-generic-password', '-s', 'wheelhouse', '-a', 'gitlab-project-42']);
  assert.equal(await readKey('gitlab-project-42', { platform: 'darwin', run: fake(() => ({ code: 44, stdout: '' })).run }), null);
});

test('only github-app and gitlab-project-<digits> are kept', async () => {
  await assert.rejects(storeKey('signing', 'x'), /key name/);
  await assert.rejects(readKey('../x'), /key name/);
  await assert.rejects(deleteKey('gitlab-project-'), /key name/);
});
