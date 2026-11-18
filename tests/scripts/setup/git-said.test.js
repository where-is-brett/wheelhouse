// tests/scripts/setup/git-said.test.js
// What git said, for a failure line (scrubGitText, gitSaid, gitFailure), and setupGit's reachEnv: the calls that
// reach a remote take the as-is route's environment, and every other call stays isolated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupGit, scrubGitText, gitSaid, gitFailure, endOf, DetailedError, NULL_FILE } from '../../../scripts/setup/git.js';
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
  assert.equal(scrubGitText('https://host/path and mail me@there'), 'https://host/path and mail me@there');
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

test('scrubGitText takes a long hostile line in linear time', () => {
  for (const hostile of ['a://b:/'.repeat(14286), `https://u:${'/'.repeat(100000)}`, `${'a://'.repeat(25000)}x`, `https://${'a@'.repeat(50000)}`]) {
    const started = Date.now();
    scrubGitText(hostile);
    gitSaid(hostile);
    assert.ok(Date.now() - started < 500, `${hostile.slice(0, 12)}: ${Date.now() - started} ms`);
  }
  // Nothing is cut before it is scrubbed: a token in an address at the end of a very long line is hidden.
  assert.equal(gitSaid(`${'z'.repeat(5000)} https://oauth2:abc123@gitlab.com/x`), '\u2026https://[hidden]@gitlab.com/x');
  // Only the last lines are scrubbed, and the earlier ones are never said.
  assert.equal(gitSaid(`${'noise\n'.repeat(40)}one\ntwo\n`), 'one two');
});

test('scrubGitText hides a GitLab personal access token with no digit, and a Basic value of base64 without a digit', () => {
  assert.equal(scrubGitText('bad glpat-abcdefghIJKLMN token'), 'bad [hidden] token');
  assert.equal(scrubGitText('sent Basic AbCdEfGhIjKl to host'), 'sent Basic [hidden] to host');
  assert.equal(scrubGitText('Basic AbCdEfGhIjKl'), 'Basic [hidden]');
  assert.equal(scrubGitText('Basic authentication failed for the user'), 'Basic authentication failed for the user');
  assert.equal(scrubGitText('remote: HTTP Basic: Access denied'), 'remote: HTTP Basic: Access denied');
});

test('gitSaid drops only git\'s own capital-T To line, and still says a lower-case one', () => {
  assert.equal(gitSaid('remote: no\nTo https://h/x.git\n'), 'remote: no');
  assert.equal(gitSaid('fatal: no\nto reach https://h/x.git use the other way\n'), 'fatal: no to reach https://h/x.git use the other way');
});

test('DetailedError keeps the line and, scrubbed, the detail', () => {
  const error = new DetailedError('The line', 'key = https://u:pw@h/x');
  assert.equal(error.message, 'The line');
  assert.equal(error.detail, 'key = https://[hidden]@h/x');
  assert.equal(new DetailedError('x').detail, undefined);
});

test('scrubGitText hides up to the last @ in an address, a Basic value followed by punctuation, and keeps a GitLab-shaped word with no digit', () => {
  assert.equal(scrubGitText('fatal: https://user:p@ss@host/x failed'), 'fatal: https://[hidden]@host/x failed');
  assert.equal(scrubGitText('https://a@b/x https://c@d/y'), 'https://[hidden]@b/x https://[hidden]@d/y');
  assert.equal(scrubGitText('sent Basic dXNlcjpwYXNzd29yZA==, to host'), 'sent Basic [hidden], to host');
  assert.equal(scrubGitText('Basic dXNlcjpwYXNzd29yZA==.'), 'Basic [hidden].');
  assert.equal(scrubGitText('Basic authentication failed'), 'Basic authentication failed');
  assert.equal(scrubGitText('bad gldt-abcd1234efgh and glab-credential-helper'), 'bad [hidden] and glab-credential-helper');
  assert.equal(scrubGitText('http.https://h/.extraheader = AUTHORIZATION: basic eHh4'), 'http.https://h/.extraheader = [hidden]');
  assert.equal(scrubGitText(`extraheader${'z'.repeat(300)}: secret`), `extraheader${'z'.repeat(300)}: secret`, 'a name past the bound is no header name');
  assert.equal(scrubGitText('x_access_token=abc123 and PRIVATE_TOKEN=zzz'), 'x_access_token=[hidden] and PRIVATE_TOKEN=[hidden]');
});

test('scrubGitText hides a JSON key with a dot or in single quotes, authorization and auth keys, password:, secret=, api_key, sig= and an address with no scheme', () => {
  assert.equal(scrubGitText('{"credential.token": "abc"}'), '{"credential.token": "[hidden]"}');
  assert.equal(scrubGitText('{\'password\': \'hunter two\'}'), '{\'password\': \'[hidden]\'}');
  assert.equal(scrubGitText('{"Authorization": "Bearer x", "auth": "y", "author": "bob"}'), '{"Authorization": "[hidden]", "auth": "[hidden]", "author": "bob"}');
  assert.equal(scrubGitText('Password: hunter2 for you'), 'Password: [hidden]');
  assert.equal(scrubGitText('x secret=abc&y=1'), 'x secret=[hidden]&y=1');
  assert.equal(scrubGitText('api-key: k1 and API_KEY=k2'), 'api-key: [hidden] and API_KEY=[hidden]');
  assert.equal(scrubGitText('https://h/x?sig=abc123&b=1'), 'https://h/x?sig=[hidden]&b=1');
  assert.equal(scrubGitText('fatal: unable to access oauth2:glpat-x@gitlab.example.com/o/p.git'), 'fatal: unable to access [hidden]@gitlab.example.com/o/p.git');
  assert.equal(scrubGitText('see "user:pa@ss@host/x" now'), 'see "[hidden]@host/x" now');
  assert.equal(scrubGitText('at 12:30 mail me, a:b'), 'at 12:30 mail me, a:b');
  assert.equal(scrubGitText('https://[hidden]@h/x'), 'https://[hidden]@h/x');
  assert.equal(scrubGitText(scrubGitText('a user:pw@h/x')), 'a [hidden]@h/x');
});

test('scrubGitText and gitSaid take 1 MB of hostile text in well under a second', () => {
  const MB = 1 << 20;
  for (const hostile of [
    'glab-'.repeat(MB / 5), 'glab-glab-glab-'.repeat(MB / 15), 'extraheader'.repeat(MB / 11), 'a_'.repeat(MB / 2), 'token'.repeat(MB / 5),
    `${'Basic '.repeat(MB / 6)}`, `Basic ${'a'.repeat(MB)}`, `${'token '.repeat(MB / 6)}x`, `${'token'.repeat(MB / 10)}${' '.repeat(MB / 2)}`, `"token":${' \t'.repeat(MB / 4)}"`,
    `${'token="'.repeat(MB / 7)}`, `${'"password": "'.repeat(MB / 13)}`, `${'client_secret '.repeat(MB / 14)}`, '_glpat-'.repeat(MB / 7), `https://${'@'.repeat(MB)}`, 'password'.repeat(MB / 8), 'authorization '.repeat(MB / 14), `${'x'.repeat(MB)}\nfatal: no\n`,
    `${'"accessToken": "'.repeat(MB / 16)}`, `"${'a'.repeat(MB)}`, '"a'.repeat(MB / 2), 'bearer '.repeat(MB / 7), 'cookie: '.repeat(MB / 8), 'xghp_'.repeat(MB / 5), `token= ${'A,'.repeat(MB / 2)}`, 'passwd'.repeat(MB / 6), `"${'token'.repeat(MB / 5)}`,
    '"a.b'.repeat(MB / 4), "'password': '".repeat(MB / 13), 'a:'.repeat(MB / 2), '(a:b'.repeat(MB / 4), `${'a:'.repeat(MB / 4)}@`, 'sig='.repeat(MB / 4), 'secret='.repeat(MB / 7), 'api_key'.repeat(MB / 7),
    'password:'.repeat(MB / 9), `${'x:y '.repeat(MB / 4)}@`, 'a:@'.repeat(MB / 3), `user:${'p'.repeat(MB)}@x`, "'a".repeat(MB / 2), '"auth":'.repeat(MB / 7),
  ]) {
    const started = Date.now();
    scrubGitText(hostile);
    gitSaid(hostile);
    assert.ok(Date.now() - started < 1000, `${hostile.slice(0, 12)}: ${Date.now() - started} ms`);
  }
});

test('endOf keeps the end of scrubbed text within the cap, drops a first partial word and marks the cut', () => {
  assert.equal(endOf('short', 10), 'short');
  const cut = endOf(`${'word '.repeat(2000)}end`, 4096);
  assert.ok(cut.length <= 4096 && cut.startsWith('…word') && cut.endsWith('word end'));
  assert.equal(endOf('abcdefghij klmnop', 10), '…klmnop');
});

test('a journalled failure detail is scrubbed in markStep too, whoever wrote it', async () => {
  const { as, shortHome, tempFolder: folderIn } = await import('../../helpers/homes.js');
  const { startRun, markStep, findRun } = await import('../../../scripts/setup/journal.js');
  await as(shortHome(), async () => {
    const folder = folderIn('wh-detail-');
    const run = startRun({ folder });
    markStep(run.id, 3, 'failed', { reason: 'it stopped', detail: 'git said https://oauth2:glpat-abcdefgh1234@gitlab.com/x and Authorization: Basic abc' });
    assert.equal(findRun(folder).steps[3].failedDetail, 'git said https://[hidden]@gitlab.com/x and Authorization: [hidden]');
  });
});

test('scrubGitText hides a base64url Basic value, token and client_secret values after = or :, quoted or not, a JSON password, and a token after an underscore', () => {
  const hidden = (text, expected) => assert.equal(scrubGitText(text), expected, text);
  // base64url (`-` and `_`), and prose still stays.
  hidden('Authorization: x\nBasic dXNlcjpwYXNz-d29yZF9hYmM', 'Authorization: [hidden]\nBasic [hidden]');
  hidden('fatal: Basic dXNlcjpwYXNz-d29yZF9hYmM failed', 'fatal: Basic [hidden] failed');
  hidden('Basic authentication failed', 'Basic authentication failed');
  hidden('token: abc123 and token = def456 and token=\'g h\' and token="i j" and token=k&x=1', 'token: [hidden] and token = [hidden] and token=[hidden] and token=[hidden] and token=[hidden]&x=1');
  hidden('client_secret=abc&x=1 client_secret: "q r"', 'client_secret=[hidden]&x=1 client_secret: [hidden]');
  hidden('{"password": "hunter2", "user": "ann", "client_secret":"s3", "token": "t\\"x"}', '{"password": "[hidden]", "user": "ann", "client_secret":"[hidden]", "token": "[hidden]"}');
  hidden('using _glpat-abcdefgh1234 and x_ghp_abcdefgh1234 and -glpat-abcdefgh1234', 'using _[hidden] and x_[hidden] and -[hidden]');
  // Safe to apply twice, and words that merely hold the word stay readable.
  const once = scrubGitText('token: abc client_secret=x {"password": "p"}');
  assert.equal(scrubGitText(once), once);
  hidden('the tokens are expired', 'the tokens are expired');
});

test('scrubGitText hides an unterminated quoted value, accessToken and id_token members, passwd=, bearer: x, a Cookie value, a token after a letter, and the whole run after token=', () => {
  const hidden = (text, expected) => assert.equal(scrubGitText(text), expected, text);
  hidden('{"token": "abc123', '{"token": "[hidden]"');
  hidden('{"accessToken":"a1","id_token": "b2","refreshToken":"c3","api_key":"k"}', '{"accessToken":"[hidden]","id_token": "[hidden]","refreshToken":"[hidden]","api_key":"[hidden]"}');
  hidden('{"user": "ann", "name": "x"}', '{"user": "ann", "name": "x"}');
  hidden('passwd=hunter2\nnext', 'passwd=[hidden]\nnext');
  hidden('Password = x y', 'Password = [hidden]');
  hidden('bearer: abc.def\nBearer ghi123', 'bearer: [hidden]\nBearer [hidden]');
  hidden('Cookie: _gitlab_session=abcd; other=1\nSet-Cookie: s=1', 'Cookie: [hidden]\nSet-Cookie: [hidden]');
  hidden('xghp_abcdefgh12345 and aglpat-abcdefgh1234 and Xgithub_pat_abcdefgh12', 'x[hidden] and a[hidden] and X[hidden]');
  hidden('token= A,B;C next', 'token= [hidden] next');
  hidden('the bearer of news', 'the bearer of news');
  for (const text of ['{"token": "abc123', 'passwd=x', 'bearer: x', 'Cookie: a=b', 'xghp_abcdefgh12345', 'token= A,B']) assert.equal(scrubGitText(scrubGitText(text)), scrubGitText(text), text);
});
