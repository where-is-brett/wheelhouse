// tests/scripts/protection/settings.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectSettings, localSettings, mergeSettings, writeSettings, sandboxFlag, featureAllowRules } from '../../../scripts/protection/settings.js';
import { credentialPaths } from '../../../scripts/lib/credentials.js';
import { helperAddress } from '../../../scripts/lib/paths.js';
import { WINDOWS_LINE } from '../../../scripts/lib/platform-lines.js';

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

test('a build command a rule cannot hold safely is refused, not allowed', () => {
  for (const bad of ['', ' npm test', 'npm test:*', 'a)', 'rm *', '-x', 'a\nb', 1]) {
    assert.throws(() => featureAllowRules({ ...config, buildCommands: [bad] }), /build command/, String(bad));
  }
});
