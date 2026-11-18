// tests/scripts/setup/git-said.test.js
// What git said, for a failure line (scrubGitText, gitSaid, gitFailure), and setupGit's reachEnv: the calls that
// reach a remote take the as-is route's environment, and every other call stays isolated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupGit, scrubGitText, gitSaid, gitFailure, NULL_FILE } from '../../../scripts/setup/git.js';
import { tempFolder } from '../../helpers/homes.js';

test('scrubGitText hides the user or token in an address, an Authorization or extra-header value, and anything shaped like a token', () => {
  assert.equal(scrubGitText('fatal: unable to access \'https://oauth2:abc123@gitlab.com/a/b.git/\''), 'fatal: unable to access \'https://<hidden>@gitlab.com/a/b.git/\'');
  assert.equal(scrubGitText('remote: https://sometoken@host.example/x.git'), 'remote: https://<hidden>@host.example/x.git');
  assert.equal(scrubGitText('ssh://git:pw@host/x and https://u@h/y'), 'ssh://<hidden>@host/x and https://<hidden>@h/y');
  assert.equal(scrubGitText('Authorization: Basic b2F1dGgyOnNlY3JldA=='), 'Authorization: <hidden>');
  assert.equal(scrubGitText('> authorization: Bearer abcdef\nnext line'), '> authorization: <hidden>\nnext line');
  assert.equal(scrubGitText('http.https://gitlab.com/.extraheader=AUTHORIZATION: basic eHh4'), 'http.https://gitlab.com/.extraheader=<hidden>');
  for (const token of ['glpat-abcdEFGH1234_-xyz', 'ghp_abcdefghijklmnop1234', 'gho_abcdefghijklmnop1234', 'github_pat_11ABCDEFG0abcdefgh_ijkl']) {
    assert.equal(scrubGitText(`bad credentials ${token} given`), 'bad credentials <hidden> given');
  }
});

test('scrubGitText leaves plain text and an address with no user alone, and is safe to apply twice', () => {
  const plain = 'fatal: could not read Username for \'https://gitlab.com\': terminal prompts disabled';
  assert.equal(scrubGitText(plain), plain);
  assert.equal(scrubGitText('https://host/path@thing'), 'https://host/path@thing');
  const once = scrubGitText('https://u:p@h/x Authorization: Basic zzz glpat-abcdefghijkl1234');
  assert.equal(scrubGitText(once), once);
  assert.equal(scrubGitText(undefined), '');
});

test('gitSaid keeps the last two lines, scrubbed, within about 300 characters, and gitFailure adds them to the line', () => {
  assert.equal(gitSaid(''), '');
  assert.equal(gitSaid('one\ntwo\n\nthree\n'), 'two three');
  const long = gitSaid('x'.repeat(500));
  assert.ok(long.length <= 300 && long.startsWith('...'));
  assert.equal(gitFailure('git could not fetch the new repository', ''), 'git could not fetch the new repository');
  assert.equal(
    gitFailure('git could not fetch the new repository', 'fatal: could not read Username for \'https://host\': terminal prompts disabled\n'),
    'git could not fetch the new repository (git said: fatal: could not read Username for \'https://host\': terminal prompts disabled)',
  );
  // A token cut by the cap is never shown: the text is scrubbed before it is trimmed.
  assert.ok(!gitSaid(`${'y'.repeat(290)} glpat-abcdefghijklmnop1234`).includes('glpat'));
});

test('setupGit with a reachEnv gives it to the calls that reach a remote, and every other call stays isolated', async () => {
  const seen = [];
  const fake = async (file, args, options) => {
    seen.push([args[0], options.env]);
    return { code: 0, stdout: '', stderr: '' };
  };
  const folder = tempFolder('wh-reach-');
  const git = setupGit({ run: fake, cwd: folder, workTree: folder, reachEnv: { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '0' } });
  for (const sub of ['fetch', 'push', 'ls-remote', 'rev-parse', 'remote']) await git([sub]);
  const byCall = Object.fromEntries(seen.filter(([sub]) => sub !== 'config').map(([sub, env]) => [sub, env]));
  for (const sub of ['fetch', 'push', 'ls-remote']) {
    assert.equal(byCall[sub].GIT_CONFIG_GLOBAL, undefined, sub);
    assert.equal(byCall[sub].GIT_WORK_TREE, folder, sub);
  }
  for (const sub of ['rev-parse', 'remote']) assert.equal(byCall[sub].GIT_CONFIG_GLOBAL, NULL_FILE, sub);
  seen.length = 0;
  await setupGit({ run: fake, cwd: folder })(['fetch']);
  assert.equal(seen.at(-1)[1].GIT_CONFIG_GLOBAL, NULL_FILE, 'no reachEnv, no change');
});
