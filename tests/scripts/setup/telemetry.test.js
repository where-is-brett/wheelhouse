// tests/scripts/setup/telemetry.test.js
// Telemetry on this computer (check 36, ruling R63): by the user settings' `env`, written by key,
// or by the account's launch environment (macOS launchctl and a login item that sets them again,
// Windows the user's environment variables). Each change is recorded with its value before, for
// uninstall; nothing sends prompt or tool content. Nothing here touches the real ~/.claude, launch
// environment or login items: a scratch folder and a fake `run`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { telemetryChanges, telemetryOn, loginItemFile, contentFree, TELEMETRY_ROUTES } from '../../../scripts/setup/telemetry.js';
import { TELEMETRY_ROUTE } from '../../../scripts/lib/setup-numbers.js';
import { telemetryEnv } from '../../../scripts/telemetry/env.js';
import { applyJsonKey, reverseChange } from '../../../scripts/setup/journal.js';
import { tempFolder } from '../../helpers/homes.js';

const PORT = 14318;
const OURS = telemetryEnv(PORT);

// A fake `run` holding a launch environment of its own: launchctl getenv/setenv on macOS, and
// PowerShell's user variables on Windows. It records every call and runs nothing.
function fakeLaunch(start = {}) {
  const vars = new Map(Object.entries(start));
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args]);
    if (file === 'launchctl' && args[0] === 'getenv') return vars.has(args[1]) ? { code: 0, stdout: `${vars.get(args[1])}\n`, stderr: '' } : { code: 0, stdout: '', stderr: '' };
    if (file === 'launchctl' && args[0] === 'setenv') {
      vars.set(args[1], args[2]);
      return { code: 0, stdout: '', stderr: '' };
    }
    if (file === 'powershell') {
      const script = args.at(-1);
      const get = /GetEnvironmentVariable\('([^']+)','User'\)/.exec(script);
      if (get) return { code: 0, stdout: vars.has(get[1]) ? `${vars.get(get[1])}\r\n` : '', stderr: '' };
      const set = /SetEnvironmentVariable\('([^']+)','([^']*)','User'\)/.exec(script);
      if (set) {
        vars.set(set[1], set[2]);
        return { code: 0, stdout: '', stderr: '' };
      }
    }
    return { code: 1, stdout: '', stderr: 'not faked' };
  };
  return { run, calls, vars };
}

// What a step's ctx gives: the journal's key edit, recording first, and `record` for the rest.
function recorder() {
  const made = [];
  return {
    made,
    record: (c) => made.push(c),
    applyJsonKey: (args) => applyJsonKey({ ...args, step: 6, record: (c) => made.push(c) }),
  };
}

test('telemetry by user settings, and by the launch environment, are each put back by uninstall', async () => {
  assert.equal(TELEMETRY_ROUTE, 'user-settings', 'the route setup uses until check 36\'s sitting');
  assert.deepEqual(TELEMETRY_ROUTES, ['user-settings', 'launch-env']);

  // The user settings: the four keys under `env`, by key; every other key, and the director's own
  // `env` entries, left as they were; uninstall puts the file back as it was.
  const dir = tempFolder('wh-telemetry zoë ');
  const file = path.join(dir, 'settings.json');
  const text = '{\n    "theme": "dark",\n    "env": {\n        "FOO": "bar"\n    }\n}\n';
  fs.writeFileSync(file, text);
  const userSettings = JSON.parse(text);
  const fake = fakeLaunch();
  const planned = await telemetryChanges({ port: PORT, route: 'user-settings', platform: 'darwin', run: fake.run, userSettings, file, userHome: dir, environment: {} });
  assert.deepEqual(planned.kept, []);
  assert.deepEqual(planned.changes, Object.entries(OURS).map(([k, v]) => ({ kind: 'json-key', target: file, key: ['env', k], after: v, what: 'telemetry' })));
  const ctx = recorder();
  await telemetryOn({ changes: planned.changes, platform: 'darwin', run: fake.run, applyJsonKey: ctx.applyJsonKey, record: ctx.record });
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(written, { theme: 'dark', env: { FOO: 'bar', ...OURS } });
  assert.equal(ctx.made.length, 4);
  for (const c of ctx.made) assert.deepEqual([c.kind, c.before, c.absent], ['json-key', null, true]);
  // The user settings route only reads the launch environment, for a value of the director's own.
  assert.ok(fake.calls.every((c) => c[0] === 'launchctl' && c[1] === 'getenv'), JSON.stringify(fake.calls));
  // Planned again, nothing is left to change.
  assert.deepEqual((await telemetryChanges({ port: PORT, route: 'user-settings', platform: 'darwin', run: fake.run, userSettings: written, file, userHome: dir, environment: {} })).changes, []);
  for (const c of [...ctx.made].reverse()) assert.deepEqual(reverseChange(c), { put: true });
  assert.equal(fs.readFileSync(file, 'utf8'), text);

  // The launch environment on macOS: launchctl setenv for each, after reading its value before,
  // and a login item that sets them again at each log-in.
  const home = tempFolder('wh-telemetry-home ');
  const mac = fakeLaunch({ PATH: '/usr/bin' });
  const onMac = await telemetryChanges({ port: PORT, route: 'launch-env', platform: 'darwin', run: mac.run, userSettings: {}, file, userHome: home, environment: {} });
  const item = loginItemFile(home);
  assert.equal(path.dirname(item), path.join(home, 'Library', 'LaunchAgents'));
  assert.deepEqual(onMac.changes.filter((c) => c.kind === 'env'), Object.entries(OURS).map(([k, v]) => ({ kind: 'env', target: k, after: v, what: 'telemetry' })));
  const itemChange = onMac.changes.find((c) => c.kind === 'file');
  assert.equal(itemChange.target, item);
  for (const [k, v] of Object.entries(OURS)) assert.ok(itemChange.after.includes(`launchctl setenv ${k} '${v}'`), itemChange.after);
  assert.match(itemChange.after, /<key>RunAtLoad<\/key>\s*<true\/>/);
  const macCtx = recorder();
  await telemetryOn({ changes: onMac.changes, platform: 'darwin', run: mac.run, applyJsonKey: macCtx.applyJsonKey, record: macCtx.record });
  for (const [k, v] of Object.entries(OURS)) assert.equal(mac.vars.get(k), v);
  assert.deepEqual(mac.calls.filter((c) => c[1] === 'setenv').map((c) => c[2]), Object.keys(OURS));
  assert.equal(fs.readFileSync(item, 'utf8'), itemChange.after);
  const envMade = macCtx.made.filter((c) => c.kind === 'env');
  assert.deepEqual(envMade.map((c) => [c.target, c.before, c.after, c.where]), Object.entries(OURS).map(([k, v]) => [k, null, v, 'launchctl']));
  // Uninstall: the login item is a file setup made, removed while it is as written; the variables
  // are put back by their own step's reversal (Task 15, ruling R13), which the record carries enough for.
  const fileMade = macCtx.made.find((c) => c.kind === 'file');
  assert.equal(fileMade.before, null);
  for (const c of envMade) assert.deepEqual(reverseChange(c), { put: false, why: 'put back by its own step' });
  assert.deepEqual(reverseChange(fileMade), { put: true });
  assert.equal(fs.existsSync(item), false);
  assert.ok(macCtx.made.every((c) => typeof c.id === 'string' && 'before' in c));

  // On Windows: the user's environment variables, by PowerShell, each read first; no login item.
  const win = fakeLaunch();
  const onWin = await telemetryChanges({ port: PORT, route: 'launch-env', platform: 'win32', run: win.run, userSettings: {}, file, userHome: home, environment: {} });
  assert.equal(onWin.changes.length, 4);
  assert.ok(onWin.changes.every((c) => c.kind === 'env'));
  const winCtx = recorder();
  await telemetryOn({ changes: onWin.changes, platform: 'win32', run: win.run, applyJsonKey: winCtx.applyJsonKey, record: winCtx.record });
  for (const [k, v] of Object.entries(OURS)) assert.equal(win.vars.get(k), v);
  assert.deepEqual(winCtx.made.map((c) => [c.target, c.before, c.where]), Object.keys(OURS).map((k) => [k, null, 'user']));
  assert.ok(win.calls.every((c) => c[0] === 'powershell'));
  assert.equal(fs.existsSync(item), false);
});

test('a telemetry setting the director already set to their own value is left as it is, and named', async () => {
  const dir = tempFolder('wh-telemetry-own-');
  const file = path.join(dir, 'settings.json');
  const own = { env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.example:4318' } };
  const fake = fakeLaunch();
  const got = await telemetryChanges({ port: PORT, route: 'user-settings', platform: 'darwin', run: fake.run, userSettings: own, file, userHome: dir, environment: {} });
  assert.deepEqual(got.changes, [], 'none of the four is written over the director\'s own collector');
  assert.deepEqual(got.kept, [{ name: 'OTEL_EXPORTER_OTLP_ENDPOINT', value: 'http://collector.example:4318' }]);
  // In the launch environment the same.
  const mac = fakeLaunch({ CLAUDE_CODE_ENABLE_TELEMETRY: '0' });
  const onMac = await telemetryChanges({ port: PORT, route: 'launch-env', platform: 'darwin', run: mac.run, userSettings: {}, file, userHome: dir, environment: {} });
  assert.deepEqual(onMac.changes, []);
  assert.deepEqual(onMac.kept, [{ name: 'CLAUDE_CODE_ENABLE_TELEMETRY', value: '0' }]);
  // On the user settings route, a value of the director's own in the launch environment, or in the
  // environment setup runs in, is not overridden by a settings key either (check 36: settings `env`
  // would win over it): none of the four is set, and theirs is named.
  for (const platform of ['darwin', 'win32']) {
    const launch = fakeLaunch({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.example:4318' });
    const byLaunch = await telemetryChanges({ port: PORT, route: 'user-settings', platform, run: launch.run, userSettings: {}, file, userHome: dir, environment: {} });
    assert.deepEqual(byLaunch, { changes: [], kept: [{ name: 'OTEL_EXPORTER_OTLP_ENDPOINT', value: 'http://collector.example:4318' }] }, platform);
  }
  const byShell = await telemetryChanges({ port: PORT, route: 'user-settings', platform: 'darwin', run: fake.run, userSettings: {}, file, userHome: dir, environment: { OTEL_METRICS_EXPORTER: 'prometheus' } });
  assert.deepEqual(byShell, { changes: [], kept: [{ name: 'OTEL_METRICS_EXPORTER', value: 'prometheus' }] });
  const byShellToo = await telemetryChanges({ port: PORT, route: 'launch-env', platform: 'darwin', run: fake.run, userSettings: {}, file, userHome: dir, environment: { OTEL_METRICS_EXPORTER: 'prometheus' } });
  assert.deepEqual(byShellToo.changes, []);
  // Wheelhouse's own value there counts as set, not as the director's.
  const ours = await telemetryChanges({ port: PORT, route: 'user-settings', platform: 'darwin', run: fakeLaunch(OURS).run, userSettings: {}, file, userHome: dir, environment: OURS });
  assert.deepEqual(ours.kept, []);
  assert.equal(ours.changes.length, 4);

  // An `env` that isn't an object stops the plan, naming the file, and changes nothing.
  await assert.rejects(telemetryChanges({ port: PORT, route: 'user-settings', platform: 'darwin', run: fake.run, userSettings: { env: 'x' }, file, userHome: dir, environment: {} }), /settings\.json/);
  await assert.rejects(telemetryChanges({ port: PORT, route: 'elsewhere', platform: 'darwin', run: fake.run, userSettings: {}, file, userHome: dir, environment: {} }), /route/);
});

test('a launch variable the director set after the plan is not written over, and a retry still goes ahead', async () => {
  const home = tempFolder('wh-telemetry-race-');
  const file = path.join(home, 'settings.json');
  const mac = fakeLaunch();
  const { changes } = await telemetryChanges({ port: PORT, route: 'launch-env', platform: 'darwin', run: mac.run, userSettings: {}, file, userHome: home, environment: {} });
  // Between the plan and the setting, the director sets their own endpoint.
  mac.vars.set('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://collector.example:4318');
  const ctx = recorder();
  await assert.rejects(telemetryOn({ changes, platform: 'darwin', run: mac.run, applyJsonKey: ctx.applyJsonKey, record: ctx.record }), /OTEL_EXPORTER_OTLP_ENDPOINT/);
  assert.equal(mac.vars.get('OTEL_EXPORTER_OTLP_ENDPOINT'), 'http://collector.example:4318');
  assert.ok(!ctx.made.some((c) => c.target === 'OTEL_EXPORTER_OTLP_ENDPOINT'), 'nothing recorded for a variable left alone');
  // A retry after a run that set some of them: setup's own value as the value before goes ahead.
  const again = fakeLaunch(OURS);
  const retry = recorder();
  await telemetryOn({ changes, platform: 'darwin', run: again.run, applyJsonKey: retry.applyJsonKey, record: retry.record });
  assert.deepEqual(retry.made.filter((c) => c.kind === 'env').map((c) => c.before), Object.values(OURS));
});

test('no telemetry change sets prompt or tool logging', async () => {
  const content = /OTEL_LOG|OTEL_LOGS|PROMPT|TOOL_DETAIL|TOOL_CONTENT|RAW_API/i;
  for (const k of Object.keys(OURS)) assert.doesNotMatch(k, content);
  const dir = tempFolder('wh-telemetry-content-');
  const file = path.join(dir, 'settings.json');
  for (const [route, platform] of [['user-settings', 'darwin'], ['user-settings', 'win32'], ['launch-env', 'darwin'], ['launch-env', 'win32']]) {
    const fake = fakeLaunch();
    const { changes } = await telemetryChanges({ port: PORT, route, platform, run: fake.run, userSettings: {}, file, userHome: dir, environment: {} });
    assert.ok(changes.length >= 4, `${route} ${platform}`);
    for (const c of changes) {
      assert.doesNotMatch(JSON.stringify(c.key ?? c.target), content);
      if (c.kind === 'file') {
        for (const name of c.after.match(/setenv (\S+)/g)) assert.doesNotMatch(name, content);
        assert.ok(!/OTEL_LOG/.test(c.after));
      }
    }
    const ctx = recorder();
    await telemetryOn({ changes, platform, run: fake.run, applyJsonKey: ctx.applyJsonKey, record: ctx.record });
    for (const name of fake.vars.keys()) assert.doesNotMatch(name, content);
  }
  // The guard itself: a set of variables naming prompt or tool content is refused.
  for (const bad of ['OTEL_LOG_USER_PROMPTS', 'OTEL_LOG_TOOL_DETAILS', 'OTEL_LOGS_EXPORTER', 'OTEL_LOG_TOOL_CONTENT', 'OTEL_LOG_RAW_API_BODIES']) {
    assert.throws(() => contentFree({ ...OURS, [bad]: '1' }), new RegExp(bad));
  }
  assert.deepEqual(contentFree(OURS), OURS);
});
