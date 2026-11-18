// tests/scripts/setup/git-said.test.js
// What git said, for a failure line (scrubGitText, gitSaid, gitFailure), and setupGit's reachEnv: the calls that
// reach a remote take the as-is route's environment, and every other call stays isolated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupGit, scrubGitText, gitSaid, gitFailure, NULL_FILE } from '../../../scripts/setup/git.js';
import { tempFolder } from '../../helpers/homes.js';

test('scrubGitText hides the user or token in an address, an Authorization or extra-header value, and anything shaped like a token', () => {
  assert.equal(scrubGitText('fatal: unable to access \'https://oauth2:abc123@gitlab.com/a/b.git/\''), 'fatal: unable to access \'https://[hidden]@gitlab.com/a/b.git/\'');
  assert.equal(scrubGitText('remote: https://sometoken@host.example/x.git'), 'remote: https://[hidden]@host.example/x.git');
  assert.equal(scrubGitText('ssh://git:pw@host/x and https://u@h/y'), 'ssh://[hidden]@host/x and https://[hidden]@h/y');
  assert.equal(scrubGitText('Authorization: Basic b2F1dGgyOnNlY3JldA=='), 'Authorization: [hidden]');
  assert.equal(scrubGitText('> authorization: Bearer abcdef\nnext line'), '> authorization: [hidden]\nnext line');
  assert.equal(scrubGitText('http.https://gitlab.com/.extraheader=AUTHORIZATION: basic eHh4'), 'http.https://gitlab.com/.extraheader=[hidden]');
  for (const token of ['glpat-abcdEFGH1234_-xyz', 'ghp_abcdefghijklmnop1234', 'gho_abcdefghijklmnop1234', 'github_pat_11ABCDEFG0abcdefgh_ijkl']) {
    assert.equal(scrubGitText(`bad credentials ${token} given`), 'bad credentials [hidden] given');
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
  assert.ok(long.length <= 300 && long.startsWith('\u2026'));
  assert.equal(gitFailure('git could not fetch the new repository', ''), 'git could not fetch the new repository');
  assert.equal(
    gitFailure('git could not fetch the new repository', 'fatal: could not read Username for \'https://host\': terminal prompts disabled\n'),
    'git could not fetch the new repository (git said: fatal: could not read Username for \'https://host\': terminal prompts disabled)',
  );
  // A token cut by the cap is never shown: the text is scrubbed before it is trimmed.
  assert.ok(!gitSaid(`${'y'.repeat(290)} glpat-abcdefghijklmnop1234`).includes('glpat'));
});

test('scrubGitText hides a bare Bearer or Basic value, a token in a query string, a password line and every GitLab token prefix', () => {
  assert.equal(scrubGitText('sent Bearer abcdef123456 to host'), 'sent Bearer [hidden] to host');
  assert.equal(scrubGitText('sent Basic b2F1dGgyOnNlY3JldA== to host'), 'sent Basic [hidden] to host');
  assert.equal(scrubGitText('Basic authentication failed'), 'Basic authentication failed');
  assert.equal(scrubGitText('GET /api?private_token=abc123&x=1 and ?access_token=zzz999 and ?token=qqq111'), 'GET /api?private_token=[hidden]&x=1 and ?access_token=[hidden] and ?token=[hidden]');
  assert.equal(scrubGitText('username=oauth2\npassword=s3cret/pw\n'), 'username=oauth2\npassword=[hidden]\n');
  for (const prefix of ['glpat', 'gldt', 'glrt', 'glcbt', 'gloas', 'glft', 'glptt', 'glimt', 'glsoat']) {
    assert.equal(scrubGitText(`bad ${prefix}-abcd1234EFGH_-xy given`), 'bad [hidden] given', prefix);
  }
  assert.equal(scrubGitText('see global-settings and glab-credential-helper'), 'see global-settings and glab-credential-helper');
  assert.equal(scrubGitText('fatal: https://user:pa/ss@gitlab.com/a/b.git failed'), 'fatal: https://[hidden]@gitlab.com/a/b.git failed');
  const once = scrubGitText('Bearer abcdef123456 ?token=qq11 password=x glcbt-abcd1234efgh');
  assert.equal(scrubGitText(once), once);
});

test('gitSaid drops git\'s noise lines, splits on a lone carriage return, and cuts at a word with an ellipsis', () => {
  const push = [
    'remote: GitLab: You are not allowed to push code to protected branches on this project.',
    'To https://gitlab.com/a/b.git',
    ' ! [remote rejected] main -> main (pre-receive hook declined)',
    'error: failed to push some refs to \'https://gitlab.com/a/b.git\'',
    'hint: Updates were rejected',
  ].join('\n');
  assert.equal(gitSaid(push), 'remote: GitLab: You are not allowed to push code to protected branches on this project. ! [remote rejected] main -> main (pre-receive hook declined)');
  assert.equal(gitSaid('one\rtwo\r\nthree'), 'two three');
  const words = gitSaid(`${'word '.repeat(80)}end`);
  assert.ok(words.length <= 300 && words.startsWith('\u2026word') && words.endsWith('word end'), words);
});

test('gitFailure puts the next step after what git said when it is given one', () => {
  assert.equal(gitFailure('It failed', 'fatal: no\n', { then: 'try again' }), 'It failed (git said: fatal: no); try again');
  assert.equal(gitFailure('It failed', '', { then: 'try again' }), 'It failed; try again');
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
