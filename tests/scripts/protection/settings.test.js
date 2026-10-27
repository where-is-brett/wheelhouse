// tests/scripts/protection/settings.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FRONT_DESK_INPUT, WORK_REPORTS_RULE } from '../../../scripts/lib/front-desk.js';
import { projectSettings, localSettings, directorStatusLine, isOwnStatusLine, withoutOwnStatusLine, mergeSettings, writeSettings, sandboxFlag, featureAllowRules, featureFileRules, frontDeskCommand, setupCommand, pluginScriptCommand, claudeCodeSettings, ATTRIBUTION_OFF, SWITCHED_OFF_PLUGINS, KEYCHAINS, HOST_TOKENS, withoutKeychainDenial } from '../../../scripts/protection/settings.js';
import { tempFolder } from '../../helpers/homes.js';
import { credentialPaths } from '../../../scripts/lib/credentials.js';
import { helperAddress } from '../../../scripts/lib/paths.js';
import { WINDOWS_LINE } from '../../../scripts/lib/platform-lines.js';
import { CLAUDE_CODE_FLOOR } from '../../../scripts/lib/build-loop.js';

const config = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: ['example.com', 'docs.example.org'] };
const allCredentials = [...new Set(['darwin', 'linux', 'win32'].flatMap((p) => credentialPaths(p)))];
const tools = ['vercel', 'netlify', 'flyctl', 'fly', 'wrangler', 'heroku', 'railway', 'aws', 'gcloud', 'az', 'doctl', 'supabase', 'neonctl', 'stripe'];

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

test('the project settings deny .env, the keys folder, credentials, the host tools and pushing', () => {
  const deny = projectSettings(config).permissions.deny;
  for (const rule of ['Read(**/.env)', 'Read(**/.env.*)', 'Read(~/.wheelhouse/**)', 'Edit(~/.wheelhouse/**)', 'Edit(~/.claude/**)',
    'Bash(gh:*)', 'Bash(glab:*)', 'Bash(git push:*)', ...tools.map((t) => `Bash(${t}:*)`)]) {
    assert.ok(deny.includes(rule), rule);
  }
  for (const c of allCredentials) {
    assert.ok(deny.includes(`Read(~/${c})`), c);
    assert.ok(deny.includes(`Read(~/${c}/**)`), `${c}/**`);
  }
  for (const rule of ['Read(~/.git-credentials)', 'Read(~/.git-credentials/**)', 'Read(~/.ssh)', 'Read(~/.ssh/**)', 'Read(~/AppData/Roaming/GitHub CLI/**)',
    'Read(~/.vercel/**)', 'Read(~/.config/stripe)', 'Read(~/.fly/**)']) assert.ok(deny.includes(rule), rule);
  assert.equal(new Set(deny).size, deny.length);
});

test('the project settings keep agents out of their own settings and hooks', () => {
  const s = projectSettings(config);
  for (const rule of ['Edit(/.claude/settings.json)', 'Edit(/.claude/settings.local.json)', 'Edit(/.claude/hooks/**)']) {
    assert.ok(s.permissions.deny.includes(rule), rule);
  }
  for (const p of ['./.claude/settings.json', './.claude/settings.local.json', './.claude/hooks']) {
    assert.ok(s.sandbox.filesystem.denyWrite.includes(p), p);
  }
});

test('the project settings switch off commit and pull request attribution', () => {
  const s = projectSettings(config);
  assert.deepEqual(s.attribution, { commit: '', pr: '', sessionUrl: false });
  assert.equal(s.includeCoAuthoredBy, false);
  assert.deepEqual({ attribution: s.attribution, includeCoAuthoredBy: s.includeCoAuthoredBy }, ATTRIBUTION_OFF);
});

test('the project settings name no user\'s folder', () => {
  const all = strings(projectSettings(config));
  const bad = [os.homedir(), '/Users/', 'C:\\Users', helperAddress()];
  for (const s of all) for (const b of bad) assert.ok(!s.includes(b), `${s} contains ${b}`);
});

test('the sandbox is on, with no unsandboxed retry, and the network list from the configuration', () => {
  const s = projectSettings(config);
  assert.equal(s.sandbox.enabled, true);
  assert.equal(s.sandbox.allowUnsandboxedCommands, false);
  assert.deepEqual(s.sandbox.network.allowedDomains, ['registry.npmjs.org', 'example.com', 'docs.example.org']);
  assert.ok(s.sandbox.filesystem.denyRead.includes('~/.wheelhouse'));
  for (const c of allCredentials) assert.ok(s.sandbox.filesystem.denyRead.includes(`~/${c}`), c);
  assert.deepEqual(s.sandbox.filesystem.denyWrite.slice(0, 2), ['~/.wheelhouse', '~/.claude']);
  assert.equal(s.autoCompactWindow, 300000);
  assert.equal(s.sandbox.network.allowUnixSockets, undefined);
});

test('the keychain files are shut to sandboxed commands and the Read tool, so a build can\'t read the director\'s sign-ins (check 73)', () => {
  assert.equal(KEYCHAINS, '~/Library/Keychains');
  const s = projectSettings(config);
  assert.deepEqual(s.sandbox.credentials.files, [{ path: '~/Library/Keychains', mode: 'deny' }]);
  assert.ok(s.permissions.deny.includes('Read(~/Library/Keychains)'));
  assert.ok(s.permissions.deny.includes('Read(~/Library/Keychains/**)'));
});

test('the host tools\' token variables are taken out of sandboxed commands\' environment, whatever the project signs', () => {
  assert.deepEqual([...HOST_TOKENS], ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN']);
  for (const c of [config, { ...config, signsApps: true }]) {
    assert.deepEqual(projectSettings(c).sandbox.credentials.envVars, HOST_TOKENS.map((name) => ({ name, mode: 'deny' })));
  }
});

test('a project whose configuration says it signs apps leaves the keychain open, and nothing else changes', () => {
  const shut = projectSettings(config);
  const open = projectSettings({ ...config, signsApps: true });
  assert.ok(!strings(open).some((x) => x.includes('Library/Keychains')));
  assert.deepEqual(open.sandbox.credentials.files, []);
  assert.deepEqual(withoutKeychainDenial(shut), open);
});

test('only signsApps: true opens the keychain; any other value keeps it shut', () => {
  for (const signsApps of [false, 'true', 'yes', 1, null, {}, []]) {
    assert.deepEqual(projectSettings({ ...config, signsApps }).sandbox.credentials.files, [{ path: KEYCHAINS, mode: 'deny' }], JSON.stringify(signsApps));
  }
});

test('withoutKeychainDenial takes out only the keychain entries, from settings merged with the director\'s own, and changes nothing given', () => {
  const merged = mergeSettings({ permissions: { deny: ['Bash(rm:*)'] }, sandbox: { credentials: { files: [{ path: '~/.mine', mode: 'deny' }] } } }, projectSettings(config));
  const before = JSON.stringify(merged);
  const lifted = withoutKeychainDenial(merged);
  assert.equal(JSON.stringify(merged), before);
  assert.deepEqual(lifted.sandbox.credentials.files, [{ path: '~/.mine', mode: 'deny' }]);
  assert.ok(lifted.permissions.deny.includes('Bash(rm:*)'));
  assert.ok(!strings(lifted).some((x) => x.includes('Library/Keychains')));
  assert.deepEqual(lifted.sandbox.credentials.envVars, merged.sandbox.credentials.envVars);
  assert.deepEqual(withoutKeychainDenial({}), {});
});

test('the local settings allow only the helper\'s socket', () => {
  assert.deepEqual(localSettings({ address: '/h/.wheelhouse/helper.sock' }), { sandbox: { network: { allowUnixSockets: ['/h/.wheelhouse/helper.sock'] } } });
});

test('mergeSettings keeps the director\'s own keys and adds ours once', () => {
  const existing = { model: 'x', permissions: { deny: ['Bash(rm:*)', 'Read(**/.env)'], allow: ['Bash(ls:*)'] }, sandbox: { enabled: false, network: { allowedDomains: ['mine.com'] } }, autoCompactWindow: 200000 };
  const ours = projectSettings(config);
  const before = JSON.stringify(existing);
  const ourBefore = JSON.stringify(ours);
  const merged = mergeSettings(existing, ours);
  assert.equal(JSON.stringify(existing), before);
  assert.equal(JSON.stringify(ours), ourBefore);
  assert.equal(merged.model, 'x');
  assert.deepEqual(merged.permissions.allow, ['Bash(ls:*)']);
  assert.deepEqual(merged.permissions.deny.slice(0, 2), ['Bash(rm:*)', 'Read(**/.env)']);
  assert.equal(merged.permissions.deny.filter((r) => r === 'Read(**/.env)').length, 1);
  assert.equal(new Set(merged.permissions.deny).size, merged.permissions.deny.length);
  assert.equal(merged.sandbox.enabled, true);
  assert.equal(merged.autoCompactWindow, 300000);
  assert.deepEqual(merged.sandbox.network.allowedDomains.slice(0, 2), ['mine.com', 'registry.npmjs.org']);
  assert.deepEqual(mergeSettings(merged, ours), merged);
});

test('writeSettings writes atomically with two-space JSON and a final newline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-settings-'));
  try {
    const file = path.join(dir, '.claude', 'settings.json');
    writeSettings(file, { a: [1] });
    assert.equal(fs.readFileSync(file, 'utf8'), '{\n  "a": [\n    1\n  ]\n}\n');
    writeSettings(file, { b: 2 });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { b: 2 });
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('sandboxFlag says there is no sandbox on Windows only', () => {
  assert.equal(sandboxFlag('win32'), WINDOWS_LINE);
  assert.match(sandboxFlag('darwin'), /sandbox is on/i);
});

test('the project settings keep PowerShell deny rules out, so the tool is not switched on', () => {
  assert.ok(!projectSettings(config).permissions.deny.some((r) => r.startsWith('PowerShell')));
});

test('package-runner forms of the host tools are denied, with version suffixes', () => {
  const deny = projectSettings(config).permissions.deny;
  for (const runner of ['npx', 'npm exec', 'pnpm dlx', 'bunx', 'yarn dlx']) {
    for (const name of ['wrangler', 'netlify', 'netlify-cli', 'railway', '@railway/cli', 'vercel', 'supabase', 'neonctl', 'flyctl', 'stripe', 'heroku']) {
      assert.ok(deny.includes(`Bash(${runner} ${name}:*)`), `${runner} ${name}`);
      assert.ok(deny.includes(`Bash(${runner} ${name}@*)`), `${runner} ${name}@`);
    }
  }
});

test('the project settings keep hooks on and refuse unreviewed project MCP servers', () => {
  const s = projectSettings(config);
  assert.equal(s.disableAllHooks, false);
  assert.equal(s.enableAllProjectMcpServers, false);
});

test('the network list is tidied: lowercased, trimmed, deduplicated, with bad entries dropped', () => {
  const messy = { ...config, webDomains: [' Example.COM ', 'example.com', '', '   ', 'https://x.com', 'x.com/path', 'a b.com', 'host:8080', '*', '*.example.com', 'registry.npmjs.org', 'bad.*.com'] };
  assert.deepEqual(projectSettings(messy).sandbox.network.allowedDomains, ['registry.npmjs.org', 'example.com', '*.example.com']);
});

test('mergeSettings looks at own keys only and keeps constructor and __proto__ as data', () => {
  const merged = mergeSettings({ constructor: 'x' }, { model: 'm' });
  assert.equal(Object.getOwnPropertyDescriptor(merged, 'constructor').value, 'x');
  const withProto = JSON.parse('{"__proto__": {"polluted": 1}, "a": 1}');
  const out = mergeSettings(withProto, JSON.parse('{"__proto__": {"more": 2}}'));
  assert.deepEqual(Object.keys(out), ['__proto__', 'a']);
  assert.deepEqual(JSON.parse(JSON.stringify(out)).__proto__, { polluted: 1, more: 2 });
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.equal({}.polluted, undefined);
  const ours = mergeSettings({}, { constructor: { name: 'y' } });
  assert.equal(Object.getOwnPropertyDescriptor(ours, 'constructor').value.name, 'y');
  assert.deepEqual(mergeSettings({ toString: ['a'] }, { toString: ['b'] }).toString, ['a', 'b']);
});

test('the local settings name the status line only when the director has none of their own', () => {
  const address = '/h/.wheelhouse/helper.sock';
  const base = { address, node: '/usr/local/bin/node', pluginRoot: '/plugins/wheelhouse' };
  // The script's path is joined as this system joins it.
  const command = `"/usr/local/bin/node" "${path.join('/plugins/wheelhouse', 'scripts', 'statusline.js')}"`;
  assert.deepEqual(localSettings({ ...base, ownStatusLine: null }).statusLine, { type: 'command', command });
  assert.deepEqual(localSettings(base).statusLine, { type: 'command', command });
  assert.equal(localSettings({ ...base, ownStatusLine: { type: 'command', command: 'my-line.sh' } }).statusLine, undefined);
  // Without a node and a plugin root there is nothing to name.
  assert.equal(localSettings({ address }).statusLine, undefined);
  // The socket stays as it was.
  assert.deepEqual(localSettings(base).sandbox, { network: { allowUnixSockets: [address] } });
});

test('the local settings allow the command by its full path', () => {
  const address = '/h/.wheelhouse/helper.sock';
  const root = '/plugins/Zoë wheel house';
  // The file's own rule form: `Bash(x:*)` is `Bash(x *)`.
  const rule = `Bash(node "${root}/scripts/frontdesk/cli.js":*)`;
  const setupRule = `Bash(node "${root}/scripts/setup/cli.js":*)`;
  const flagged = `Bash(node --no-use-system-ca "${root}/scripts/frontdesk/cli.js":*)`;
  const setupFlagged = `Bash(node --no-use-system-ca "${root}/scripts/setup/cli.js":*)`;
  assert.equal(frontDeskCommand(root, { platform: 'darwin', noSystemCa: true }), `node --no-use-system-ca "${root}/scripts/frontdesk/cli.js"`);
  assert.equal(frontDeskCommand(root, { platform: 'darwin' }), `node "${root}/scripts/frontdesk/cli.js"`);
  assert.equal(setupCommand(root, { platform: 'darwin' }), `node "${root}/scripts/setup/cli.js"`);
  assert.equal(pluginScriptCommand(root, 'scripts/frontdesk/cli.js', { platform: 'darwin' }), frontDeskCommand(root, { platform: 'darwin' }));
  assert.throws(() => pluginScriptCommand(root, '../x.js', { platform: 'darwin' }), /inside the plugin/);
  assert.throws(() => pluginScriptCommand(root, 'scripts/x y.js', { platform: 'darwin' }), /inside the plugin/);
  // Beside the front desk's, the one file it writes its input to when it has no scratchpad (ruling
  // F85), by the project-relative form: `/path` is from the settings file's project.
  const input = `Edit(/${FRONT_DESK_INPUT})`;
  assert.equal(input, 'Edit(/.wheelhouse/front-desk.json)');
  // And the work's reports it writes for `record work`: Markdown files directly in .wheelhouse/work/, nothing below or beside.
  const reports = WORK_REPORTS_RULE;
  assert.equal(reports, 'Edit(/.wheelhouse/work/*.md)');
  assert.deepEqual(localSettings({ address, pluginRoot: root, platform: 'darwin' }).permissions, { allow: [rule, flagged, input, reports, setupRule, setupFlagged] });
  // With the status line or without it, and beside the socket.
  const full = localSettings({ address, node: '/usr/local/bin/node', pluginRoot: root, ownStatusLine: { type: 'command', command: 'x' }, platform: 'linux' });
  assert.deepEqual(full.permissions, { allow: [rule, flagged, input, reports, setupRule, setupFlagged] });
  assert.deepEqual(full.sandbox, { network: { allowUnixSockets: [address] } });
  // On Windows the path is written with forward slashes after its drive letter, as node and Git Bash take it.
  assert.deepEqual(localSettings({ address, pluginRoot: 'C:\\Users\\Zoë\\wheelhouse', platform: 'win32' }).permissions,
    { allow: ['Bash(node "C:/Users/Zoë/wheelhouse/scripts/frontdesk/cli.js":*)', 'Bash(node --no-use-system-ca "C:/Users/Zoë/wheelhouse/scripts/frontdesk/cli.js":*)', 'Edit(/.wheelhouse/front-desk.json)', 'Edit(/.wheelhouse/work/*.md)', 'Bash(node "C:/Users/Zoë/wheelhouse/scripts/setup/cli.js":*)', 'Bash(node --no-use-system-ca "C:/Users/Zoë/wheelhouse/scripts/setup/cli.js":*)'] });
  // A folder a rule can't hold as it is gets no rule: the command is then asked about each time.
  for (const bad of ['/x"y', '/x*y', '/x(y', '/x)y', '/x\ny', 'relative/root', '/x`y', '/x$y']) {
    assert.equal(localSettings({ address, pluginRoot: bad, platform: 'linux' }).permissions, undefined, bad);
    assert.equal(frontDeskCommand(bad, { platform: 'linux' }), null, bad);
    assert.equal(setupCommand(bad, { platform: 'linux' }), null, bad);
  }
  // Merged into settings the director already has, their own rules stay first.
  const merged = mergeSettings({ permissions: { allow: ['Bash(ls:*)'] } }, localSettings({ address, pluginRoot: root, platform: 'darwin' }));
  assert.deepEqual(merged.permissions.allow, ['Bash(ls:*)', rule, flagged, input, reports, setupRule, setupFlagged]);
  // The shared project settings never name it: the path is this computer's.
  assert.ok(!strings(projectSettings(config)).some((x) => x.includes('frontdesk') || x.includes('setup/cli.js')));
});

test('the director\'s own status line is found in their user, project or local settings, and Wheelhouse\'s own is not theirs', () => {
  const root = tempFolder('wh-statusline-settings-');
  const claudeHome = path.join(root, 'home', '.claude');
  const project = path.join(root, 'project');
  const put = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const find = () => directorStatusLine({ claudeHome, projectDir: project });
  assert.equal(find(), null); // nothing there at all
  put(path.join(claudeHome, 'settings.json'), '{not json');
  assert.equal(find(), null); // damaged file
  put(path.join(claudeHome, 'settings.json'), { model: 'x' });
  assert.equal(find(), null);
  put(path.join(project, '.claude', 'settings.local.json'), { statusLine: { type: 'command', command: '"/usr/bin/node" "/p/scripts/statusline.js"' } });
  assert.equal(find(), null); // Wheelhouse's own, from an earlier setup
  put(path.join(project, '.claude', 'settings.local.json'), { statusLine: { type: 'command', command: '"C:\\Program Files\\node.exe" "C:\\p\\scripts\\statusline.js"' } });
  assert.equal(find(), null); // the same on Windows
  put(path.join(project, '.claude', 'settings.local.json'), { statusLine: { type: 'command', command: 'theirs.sh' } });
  assert.deepEqual(find(), { type: 'command', command: 'theirs.sh' });
  fs.rmSync(path.join(project, '.claude', 'settings.local.json'));
  put(path.join(project, '.claude', 'settings.json'), { statusLine: { type: 'command', command: 'project.sh' } });
  assert.deepEqual(find(), { type: 'command', command: 'project.sh' });
  fs.rmSync(path.join(project, '.claude', 'settings.json'));
  put(path.join(claudeHome, 'settings.json'), { statusLine: { type: 'command', command: 'user.sh' } });
  assert.deepEqual(find(), { type: 'command', command: 'user.sh' });
});

test('Wheelhouse\'s status line is recognised as its own', () => {
  assert.equal(isOwnStatusLine({ type: 'command', command: '"/n" "/p/scripts/statusline.js"' }), true);
  assert.equal(isOwnStatusLine({ type: 'command', command: '"C:\\n.exe" "C:\\p\\scripts\\statusline.js"' }), true);
  assert.equal(isOwnStatusLine({ type: 'command', command: 'theirs.sh' }), false);
  assert.equal(isOwnStatusLine(null), false);
  assert.equal(isOwnStatusLine('scripts/statusline.js'), false);
});

test('our status line is taken out of the local settings once the director has their own, and never theirs', () => {
  const ours = { type: 'command', command: '"/n" "/p/scripts/statusline.js"' };
  const theirs = { type: 'command', command: 'theirs.sh' };
  const local = { sandbox: { network: { allowUnixSockets: ['/s'] } }, statusLine: ours };
  const before = JSON.stringify(local);
  // ours present, the director adds theirs: ours goes, the rest stays
  assert.deepEqual(withoutOwnStatusLine(local, { director: theirs }), { sandbox: { network: { allowUnixSockets: ['/s'] } } });
  assert.equal(JSON.stringify(local), before); // the input is not changed
  // ours present, no line of theirs: ours stays
  assert.deepEqual(withoutOwnStatusLine(local, { director: null }), local);
  assert.deepEqual(withoutOwnStatusLine(local), local);
  // theirs in the local file: never removed
  const mine = { statusLine: theirs, model: 'x' };
  assert.deepEqual(withoutOwnStatusLine(mine, { director: theirs }), mine);
  assert.deepEqual(withoutOwnStatusLine(mine, { director: null }), mine);
  // no existing file
  assert.deepEqual(withoutOwnStatusLine(null, { director: theirs }), {});
});

test('feature sessions may run the build\'s usual commands: one allow rule for each', () => {
  const mac = { platform: 'darwin' };
  assert.deepEqual(featureAllowRules(config, mac), ['Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(node:*)'], 'the default commands');
  assert.deepEqual(featureAllowRules({ ...config, buildCommands: ['make check', 'make check', 'pytest'] }, mac), ['Bash(make check:*)', 'Bash(pytest:*)']);
  assert.deepEqual(featureAllowRules({ ...config, buildCommands: [] }, mac), []);
});

test('the shared project settings never hold the build commands\' allow rules', () => {
  // The file is committed and read by every computer, so no allow rule goes in it on any system.
  for (const c of [config, { ...config, buildCommands: ['pytest'] }]) {
    const s = projectSettings(c);
    assert.equal(Object.hasOwn(s.permissions, 'allow'), false);
    assert.ok(!strings(s).some((x) => x.startsWith('Bash(') && !s.permissions.deny.includes(x)), 'no Bash rule outside the deny list');
  }
});

test('on Windows, where no sandbox runs, the build commands get no allow rules', () => {
  assert.deepEqual(featureAllowRules(config, { platform: 'win32' }), []);
  assert.deepEqual(featureAllowRules(config, { platform: 'darwin' }), ['Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(node:*)']);
  assert.deepEqual(featureAllowRules(config, { platform: 'linux' }), ['Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(node:*)']);
  assert.throws(() => featureAllowRules({ ...config, buildCommands: ['rm *'] }, { platform: 'win32' }), /build command/, 'still checked');
});

const WIN = { platform: 'win32' };
const GIT_RULES = ['Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git restore:*)', 'Bash(git rm:*)', 'Bash(git mv:*)'];
const grant = (commands, scope = 'run', questionId = 'q-login-page-1') => ({ questionId, commands, scope });

test('on Windows, ask with no grant gives no allow rules', () => {
  assert.deepEqual(featureAllowRules(config, { ...WIN, level: 'ask' }), []);
  assert.deepEqual(featureAllowRules(config, { ...WIN, level: 'ask', grants: [] }), []);
  // An unknown level is ask.
  assert.deepEqual(featureAllowRules(config, { ...WIN, level: 'always' }), []);
  assert.deepEqual(featureAllowRules(config, { ...WIN, level: 'always', grants: [grant(['npm test'])] }), ['Bash(npm test:*)']);
});

test('on Windows, ask gives one rule for each granted command that is still configured', () => {
  const grants = [grant(['npm test', 'git status']), grant(['npm run build', 'npm test'], 'feature', 'q-login-page-2')];
  assert.deepEqual(featureAllowRules(config, { ...WIN, grants }), ['Bash(npm test:*)', 'Bash(git status:*)', 'Bash(npm run build:*)']);
  // A command the question named but the configuration doesn't hold, or one no rule can hold, gives nothing.
  const odd = [grant(['curl example.com', 'npm testing', 'git push', 'git status && curl x', 'rm *', 'make check', 7]), { questionId: 'q-login-page-3' }, null];
  assert.deepEqual(featureAllowRules(config, { ...WIN, grants: odd }), []);
  assert.deepEqual(featureAllowRules({ ...config, buildCommands: ['make check'] }, { ...WIN, grants: [grant(['make check', 'npm test'])] }), ['Bash(make check:*)']);
});

test('unattended gives every configured command and local git on Windows', () => {
  assert.deepEqual(featureAllowRules(config, { ...WIN, level: 'unattended' }), ['Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(node:*)', ...GIT_RULES]);
  assert.deepEqual(featureAllowRules({ ...config, buildCommands: ['pytest'] }, { ...WIN, level: 'unattended', grants: [grant(['npm test'])] }), ['Bash(pytest:*)', ...GIT_RULES]);
});

test('guarded gives the runner\'s rule, and the director\'s grants as at ask', () => {
  const runner = 'node guarded.js';
  assert.deepEqual(featureAllowRules(config, { ...WIN, level: 'guarded', guardedCommand: runner }), ['Bash(node guarded.js:*)']);
  // A command the runner refuses (one that fetches new code) still asks, so a grant still counts.
  assert.deepEqual(featureAllowRules(config, { ...WIN, level: 'guarded', guardedCommand: runner, grants: [grant(['npm test', 'curl x'])] }), ['Bash(node guarded.js:*)', 'Bash(npm test:*)']);
  // With no runner to name, guarded gives the grants alone.
  for (const none of [null, '', 'a\nb', 7]) {
    assert.deepEqual(featureAllowRules(config, { ...WIN, level: 'guarded', guardedCommand: none }), [], String(none));
    assert.deepEqual(featureAllowRules(config, { ...WIN, level: 'guarded', guardedCommand: none, grants: [grant(['git status'])] }), ['Bash(git status:*)'], String(none));
  }
});

test('off Windows the level and grants change nothing', () => {
  const today = ['Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(node:*)'];
  for (const platform of ['darwin', 'linux']) {
    for (const level of ['ask', 'guarded', 'unattended', 'always']) {
      for (const grants of [[], [grant(['git status', 'npm run build'])]]) {
        assert.deepEqual(featureAllowRules(config, { platform, level, grants, guardedCommand: 'node guarded.js' }), today, `${platform} ${level}`);
      }
    }
  }
});

test('a build command a rule cannot hold safely is refused, not allowed', () => {
  for (const bad of ['', ' npm test', 'npm test:*', 'a)', 'rm *', '-x', 'a\nb', 1]) {
    assert.throws(() => featureAllowRules({ ...config, buildCommands: [bad] }), /build command/, String(bad));
  }
});

test('the project settings switch on the pinned copies and off every other copy', () => {
  const { enabledPlugins } = projectSettings(config);
  assert.deepEqual(enabledPlugins, {
    'superpowers@claude-plugins-official': false,
    'superpowers@synced': false,
    'mattpocock-skills@synced': false,
    'superpowers@wheelhouse': true,
    'mattpocock-skills@wheelhouse': true,
  });
  assert.deepEqual(SWITCHED_OFF_PLUGINS, ['superpowers@claude-plugins-official', 'superpowers@synced', 'mattpocock-skills@synced']);
  // The same with a release, and with the one-argument call.
  assert.deepEqual(projectSettings(config, { release: { ref: 'v1.0.0' } }).enabledPlugins, enabledPlugins);
});

test('auto-update is off for the Wheelhouse marketplace', () => {
  const entry = projectSettings(config).extraKnownMarketplaces.wheelhouse;
  assert.equal(entry.autoUpdate, false);
  assert.deepEqual(Object.keys(projectSettings(config).extraKnownMarketplaces), ['wheelhouse']);
});

test('the marketplace entry follows the release given, with a ref and no sha, and none without a release', () => {
  // A github marketplace source takes repo, ref, path and sparsePaths: no sha.
  const bare = projectSettings(config).extraKnownMarketplaces.wheelhouse;
  assert.deepEqual(bare, { source: { source: 'github', repo: 'where-is-brett/wheelhouse' }, autoUpdate: false });
  const released = projectSettings(config, { release: { ref: 'v1.2.3', sha: 'a'.repeat(40) } }).extraKnownMarketplaces.wheelhouse;
  assert.deepEqual(released, { source: { source: 'github', repo: 'where-is-brett/wheelhouse', ref: 'v1.2.3' }, autoUpdate: false });
  assert.deepEqual(projectSettings(config, { release: null }).extraKnownMarketplaces.wheelhouse, bare);
  assert.deepEqual(projectSettings(config, { release: {} }).extraKnownMarketplaces.wheelhouse, bare);
  assert.throws(() => projectSettings(config, { release: { ref: '' } }), /release/);
  assert.throws(() => projectSettings(config, { release: { ref: 3 } }), /release/);
});

test('the plugin settings merge into the director\'s own and leave their plugins alone', () => {
  const existing = { enabledPlugins: { 'mine@theirs': true, 'superpowers@synced': true }, extraKnownMarketplaces: { theirs: { source: { source: 'github', repo: 'a/b' } } } };
  const merged = mergeSettings(existing, projectSettings(config));
  assert.equal(merged.enabledPlugins['mine@theirs'], true);
  assert.equal(merged.enabledPlugins['superpowers@synced'], false);
  assert.equal(merged.enabledPlugins['superpowers@wheelhouse'], true);
  assert.deepEqual(Object.keys(merged.extraKnownMarketplaces).sort(), ['theirs', 'wheelhouse']);
});

test('claudeCodeSettings sets the stable channel and the floor', () => {
  assert.deepEqual(claudeCodeSettings({ floor: '2.1.100' }), { autoUpdatesChannel: 'stable', minimumVersion: '2.1.100' });
  assert.deepEqual(claudeCodeSettings({ floor: CLAUDE_CODE_FLOOR }), { autoUpdatesChannel: 'stable', minimumVersion: CLAUDE_CODE_FLOOR });
  for (const bad of [undefined, '', 'latest', '2.1', 'v2.1.100', 2]) assert.throws(() => claudeCodeSettings({ floor: bad }), /floor/, String(bad));
  assert.throws(() => claudeCodeSettings(), /floor/);
});

test('Claude Code\'s deny rules carry the new paths', () => {
  const s = projectSettings(config);
  const deny = s.permissions.deny;
  // Project files: from the project's root, as the settings and hooks rules are.
  for (const rule of ['Edit(/.github/hooks/**)', 'Edit(/.github/copilot/**)', 'Edit(/.github/agents/**)', 'Edit(/.github/skills/**)', 'Edit(/.github/instructions/**)',
    'Edit(/.github/prompts/**)', 'Edit(/.github/copilot-instructions.md)', 'Edit(/.github/mcp.json)', 'Edit(/.github/lsp.json)', 'Edit(/.github/plugin/**)',
    'Edit(**/AGENTS.md)', 'Edit(**/GEMINI.md)', 'Edit(/.agents/**)', 'Edit(/plugin.json)', 'Edit(/.plugin/**)', 'Edit(/com.github.copilot/**)',
    'Edit(/.vscode/**)', 'Edit(/.codex/**)', 'Edit(/.cursor/**)', 'Edit(/.gemini/**)', 'Edit(/.gitattributes)']) {
    assert.ok(deny.includes(rule), rule);
  }
  // The home folders, for every system's, in the form the credentials' rules use.
  for (const folder of ['.copilot', '.agents', '.vscode/extensions', 'Library/Application Support/Code/User', 'AppData/Roaming/Code/User', '.config/Code/User']) {
    assert.ok(deny.includes(`Edit(~/${folder}/**)`), folder);
  }
  // The sandbox holds what a shell writes: folders and files by name, with no wildcard.
  const write = s.sandbox.filesystem.denyWrite;
  for (const p of ['./.github/hooks', './.github/copilot', './.github/agents', './.github/skills', './.github/instructions', './.github/prompts', './.github/copilot-instructions.md',
    './.github/mcp.json', './.github/lsp.json', './.github/plugin', './.agents', './plugin.json', './.plugin', './com.github.copilot', './.vscode', './.codex', './.cursor', './.gemini',
    './.gitattributes', './AGENTS.md', './GEMINI.md', '~/.copilot', '~/.agents', '~/.vscode/extensions', '~/Library/Application Support/Code/User', '~/AppData/Roaming/Code/User', '~/.config/Code/User']) {
    assert.ok(write.includes(p), p);
  }
  assert.ok(write.every((p) => !p.includes('*')), 'no wildcard in the sandbox list');
  // What was there stays, in its place.
  assert.deepEqual(write.slice(0, 5), ['~/.wheelhouse', '~/.claude', './.claude/settings.json', './.claude/settings.local.json', './.claude/hooks']);
  assert.equal(new Set(deny).size, deny.length);
  assert.equal(new Set(write).size, write.length);
  // Reading stays allowed: no Read rule is made for them.
  assert.ok(!deny.some((r) => r.startsWith('Read(') && /AGENTS|\.vscode|\.copilot|\.github/.test(r)));
});

test('feature sessions may read what plugins installed, and use a temporary folder inside their worktree, without a prompt', () => {
  const rules = featureFileRules();
  assert.deepEqual(rules, ['Read(~/.claude/plugins/cache/**)', 'Edit(/.wheelhouse/tmp/**)']);
  // Read-only: nothing writes to the plugins, and nothing opens the system temporary folder or the home folder.
  assert.ok(!rules.some((r) => r.startsWith('Edit(~') || r.includes('/tmp/**') && !r.includes('.wheelhouse/tmp')), 'no home or system temporary folder');
  // Every guard stays: the Wheelhouse home is denied for reading and writing, and the shared settings carry no allow rule.
  const s = projectSettings(config);
  for (const denied of ['Read(~/.wheelhouse/**)', 'Edit(~/.wheelhouse/**)', 'Edit(~/.claude/**)']) assert.ok(s.permissions.deny.includes(denied), denied);
  assert.ok(s.sandbox.filesystem.denyRead.includes('~/.wheelhouse'));
  assert.ok(s.sandbox.filesystem.denyWrite.includes('~/.wheelhouse'));
  assert.equal(Object.hasOwn(s.permissions, 'allow'), false);
});
