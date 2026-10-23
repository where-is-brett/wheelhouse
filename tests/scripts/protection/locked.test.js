// tests/scripts/protection/locked.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { managedSettings, installLocked, updateLocked, leaveLocked } from '../../../scripts/protection/locked.js';
import { credentialPaths } from '../../../scripts/lib/credentials.js';
import { writeProject } from '../../../scripts/lib/projects.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOOKS = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
const temp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const NODE = '/Applications/Node Folder/bin/node';
const ADDRESS = '/Users/someone/.wheelhouse/helper.sock';

async function withHome(fn) {
  const home = temp('wh-locked-home-');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try { return await fn(home); } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// A registered project whose main folder holds its configuration.
function makeProject(name, { mode = 'narrow', domains = [] } = {}) {
  const folder = temp(`wh-locked-${name}-`);
  fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({
    v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: domains,
  }));
  writeProject(`owner__${name}`, {
    folder, remoteUrl: `https://example.com/owner/${name}.git`, host: 'github', repo: `owner/${name}`, connection: { host: 'github', mode, project: `owner/${name}` },
  });
  return { project: `owner__${name}`, folder };
}

// A fake run that records the administrator command, reads what was staged, and never runs anything.
function fakeRun(onCall) {
  const calls = [];
  const run = async (file, args) => {
    const command = args[args.length - 1];
    const stage = /'([^']*locked-stage-[^'/]*)[/']/.exec(command)?.[1];
    const staged = stage && fs.existsSync(stage) ? {
      settings: fs.existsSync(path.join(stage, 'managed-settings.json')) ? JSON.parse(fs.readFileSync(path.join(stage, 'managed-settings.json'), 'utf8')) : null,
      list: fs.existsSync(path.join(stage, 'wheelhouse', 'locked-projects.json')) ? JSON.parse(fs.readFileSync(path.join(stage, 'wheelhouse', 'locked-projects.json'), 'utf8')) : null,
      installed: fs.existsSync(path.join(stage, 'wheelhouse', 'installed.json')) ? JSON.parse(fs.readFileSync(path.join(stage, 'wheelhouse', 'installed.json'), 'utf8')) : null,
      hasScripts: fs.existsSync(path.join(stage, 'wheelhouse', 'scripts', 'hooks', 'kit.js')),
      hasLineage: ['manifest.json', 'register.json'].every((name) => fs.existsSync(path.join(stage, 'wheelhouse', 'lineage', name))),
    } : null;
    calls.push({ file, args, command, staged, stage });
    return { code: 0, stdout: '', stderr: '', ...(onCall ? onCall(calls.at(-1)) : {}) };
  };
  return { run, calls };
}

const NOW = () => new Date('2026-10-18T01:02:03.000Z');
const hookEntries = (settings) => Object.values(settings.hooks).flatMap((g) => g).flatMap((g) => g.hooks);

test('managedSettings runs each hook by exec form, so paths with spaces need no quoting', () => {
  const dir = '/Library/Application Support/ClaudeCode';
  const node = `${dir}/wheelhouse/bin/node`;
  const s = managedSettings({ dir, nodePath: node, address: ADDRESS, domains: [], hooksJson: HOOKS });
  assert.deepEqual(Object.keys(s.hooks), Object.keys(HOOKS.hooks));
  for (const [event, groups] of Object.entries(HOOKS.hooks)) {
    assert.equal(s.hooks[event].length, groups.length);
    groups.forEach((group, i) => {
      assert.equal(s.hooks[event][i].matcher, group.matcher);
      group.hooks.forEach((hook, j) => {
        const mine = s.hooks[event][i].hooks[j];
        const name = /scripts\/hooks\/([\w-]+)\.js/.exec(hook.command)[1];
        assert.equal(mine.command, node);
        assert.deepEqual(mine.args, [`${dir}/wheelhouse/scripts/hooks/${name}.js`]);
        assert.equal(mine.timeout, hook.timeout);
        assert.equal(mine.onFailure, hook.onFailure);
        assert.equal(mine.type, 'command');
      });
    });
  }
  assert.ok(!JSON.stringify(s.hooks).includes('CLAUDE_PLUGIN_ROOT'));
  // Reading the plugin's own list when none is given gives the same.
  assert.deepEqual(managedSettings({ dir, nodePath: node, address: ADDRESS, domains: [] }).hooks, s.hooks);
  // The lineage hold is in the managed list, as a guard on every tool.
  const own = managedSettings({ dir, nodePath: node, address: ADDRESS, domains: [] });
  const hold = own.hooks.PreToolUse.filter((g) => g.matcher === '*').flatMap((g) => g.hooks)
    .find((h) => h.args[0] === `${dir}/wheelhouse/scripts/hooks/lineage-hold.js`);
  assert.equal(hold?.onFailure, 'block');
});

test('managedSettings denies only what is safe in every project, and switches bypass mode off', () => {
  const s = managedSettings({ dir: '/m', nodePath: NODE, address: ADDRESS, domains: [], hooksJson: HOOKS });
  const deny = s.permissions.deny;
  for (const rule of ['Read(**/.env)', 'Read(**/.env.*)', 'Read(~/.wheelhouse/**)', 'Edit(~/.wheelhouse/**)']) assert.ok(deny.includes(rule), rule);
  for (const c of new Set(['darwin', 'linux', 'win32'].flatMap((p) => credentialPaths(p)))) {
    assert.ok(deny.includes(`Read(~/${c})`) && deny.includes(`Read(~/${c}/**)`), c);
  }
  assert.ok(!deny.some((r) => r.startsWith('Bash(')), 'no Bash rules, which would bind every project');
  assert.equal(s.permissions.disableBypassPermissionsMode, 'disable');
  assert.equal(s.allowManagedHooksOnly, undefined);
});

test('managedSettings makes the sandbox admin-required without switching it on everywhere', () => {
  const s = managedSettings({ dir: '/m', nodePath: NODE, address: ADDRESS, domains: ['Example.com', 'https://bad.example/x', '*', 'docs.example.org'], hooksJson: HOOKS });
  assert.equal(s.sandbox.enabled, undefined);
  assert.equal(s.sandbox.allowUnsandboxedCommands, false);
  assert.equal(s.sandbox.network.allowManagedDomainsOnly, true);
  assert.deepEqual(s.sandbox.network.allowedDomains, ['registry.npmjs.org', 'example.com', 'docs.example.org']);
  assert.deepEqual(s.sandbox.network.allowUnixSockets, [ADDRESS]);
});

const NO_PLIST = '/nowhere/com.anthropic.claudecode.plist';

test('installLocked refuses on Windows, with the quick connection, and with an MDM policy', async () => {
  await withHome(async () => {
    const a = makeProject('a');
    const q = makeProject('q', { mode: 'quick' });
    const dir = temp('wh-locked-dir-');
    const plist = path.join(dir, 'policy.plist');
    try {
      const win = fakeRun();
      assert.deepEqual(await installLocked({ project: a.project, platform: 'win32', run: win.run, now: NOW, dir, mdmPlist: NO_PLIST }),
        { installed: false, line: 'Locked is offered on macOS only for now' });
      const quick = fakeRun();
      assert.deepEqual(await installLocked({ project: q.project, platform: 'darwin', run: quick.run, now: NOW, dir, mdmPlist: NO_PLIST }),
        { installed: false, line: 'Locked needs the narrow connection' });
      fs.writeFileSync(plist, 'x');
      const mdm = fakeRun();
      const wanted = { installed: false, line: 'Locked can\'t be installed while this computer has another managed policy for Claude Code' };
      assert.deepEqual(await installLocked({ project: a.project, platform: 'darwin', run: mdm.run, now: NOW, dir, mdmPlist: plist }), wanted);
      assert.deepEqual(await updateLocked({ project: a.project, platform: 'darwin', run: mdm.run, now: NOW, dir, mdmPlist: plist }), wanted);
      assert.equal(win.calls.length + quick.calls.length + mdm.calls.length, 0);
    } finally {
      for (const p of [a.folder, q.folder, dir]) fs.rmSync(p, { recursive: true, force: true });
    }
  });
});

test('installLocked stages under the Wheelhouse home, and asks once with every path quoted, in a safe order', async () => {
  await withHome(async (home) => {
    const a = makeProject('a', { domains: ['a.example.com'] });
    const b = makeProject('b', { domains: ['b.example.com'] });
    const base = temp('wh-locked-dir-');
    const dir = path.join(base, "Support's Dir");
    fs.mkdirSync(path.join(dir, 'wheelhouse'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'wheelhouse', 'locked-projects.json'), JSON.stringify([b.folder, a.folder]));
    fs.writeFileSync(path.join(dir, 'wheelhouse', 'installed.json'), '{}');
    fs.writeFileSync(path.join(dir, 'managed-settings.json'), '{}');
    try {
      const fake = fakeRun();
      const r = await installLocked({ project: a.project, platform: 'darwin', run: fake.run, now: NOW, dir, nodePath: NODE, address: ADDRESS, mdmPlist: NO_PLIST });
      assert.equal(fake.calls.length, 1);
      const call = fake.calls[0];
      assert.equal(call.file, 'osascript');
      assert.ok(call.args.join(' ').includes('with administrator privileges'));
      assert.ok(call.stage.startsWith(home), 'staged under the Wheelhouse home, not the temporary folder');
      assert.equal(fs.existsSync(call.stage), false, 'the staging folder is removed');
      assert.deepEqual(call.staged.list, [b.folder, a.folder], 'added once, not twice');
      const version = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
      assert.deepEqual(call.staged.installed, { version, at: '2026-10-18T01:02:03.000Z', pluginRoot: fs.realpathSync(ROOT) });
      assert.ok(call.staged.hasScripts);
      assert.ok(call.staged.hasLineage, 'the manifest and the register go with the scripts');
      // Every project registered on the computer contributes its domains.
      assert.deepEqual(call.staged.settings.sandbox.network.allowedDomains, ['registry.npmjs.org', 'a.example.com', 'b.example.com']);
      const managedNode = `${dir}/wheelhouse/bin/node`;
      assert.ok(hookEntries(call.staged.settings).every((h) => h.command === managedNode && h.args[0].startsWith(`${dir}/wheelhouse/scripts/hooks/`)));
      assert.match(r.line, /A project registered later needs Locked updated\.$/);
      assert.equal(r.installed, true, 'the file is still in place afterwards');

      // The shape and order of the administrator command.
      const c = call.command;
      const at = (text) => {
        const i = c.indexOf(text);
        assert.ok(i >= 0, `missing: ${text}\n${c}`);
        return i;
      };
      const w = `'${dir}/wheelhouse`.replace(/'/g, "'\\''").replace(/^\\'/, "'");
      const quoted = (p) => `'${p.replaceAll("'", "'\\''")}'`;
      const bin = quoted(`${dir}/wheelhouse/bin.new/node`);
      const copyNode = at(`cp ${quoted(NODE)} ${bin}`);
      const verify = at(`${bin} --version`);
      const swapScripts = at(`mv ${quoted(`${dir}/wheelhouse/scripts.new`)} ${quoted(`${dir}/wheelhouse/scripts`)}`);
      const copyLineage = at(`cp -R ${quoted(path.join(call.stage, 'wheelhouse', 'lineage'))} ${quoted(`${dir}/wheelhouse/lineage.new`)}`);
      const swapLineage = at(`mv ${quoted(`${dir}/wheelhouse/lineage.new`)} ${quoted(`${dir}/wheelhouse/lineage`)}`);
      assert.ok(copyLineage < verify && swapScripts < swapLineage, 'the lineage folder is copied before the check and swapped in with the scripts');
      // The adapters' folder goes in first: the new scripts import from it, and the old scripts never do,
      // so a hook firing between two swaps never meets new scripts beside old or missing adapters.
      const swapAdapters = at(`mv ${quoted(`${dir}/wheelhouse/adapters.new`)} ${quoted(`${dir}/wheelhouse/adapters`)}`);
      const swapBin = at(`mv ${quoted(`${dir}/wheelhouse/bin.new`)} ${quoted(`${dir}/wheelhouse/bin`)}`);
      assert.ok(swapAdapters < swapScripts && swapScripts < swapLineage && swapLineage < swapBin, 'adapters are swapped in before the scripts, then lineage, then bin');
      const copySettings = at(quoted(`${dir}/managed-settings.json`));
      const chown = at('chown -R root:wheel');
      const chmod = at('chmod -R go-w');
      const cleanup = at('|| {');
      assert.ok(copyNode < verify && verify < swapScripts && swapScripts < copySettings && copySettings < chown && chown < chmod && chmod < cleanup, c);
      assert.ok(c.indexOf('cp -R', 0) < verify, 'scripts are copied before the check');
      const tail = c.slice(cleanup);
      for (const n of ['scripts', 'lineage', 'bin']) {
        const put = `[ -d ${quoted(`${dir}/wheelhouse/${n}.old`)} ] && [ ! -d ${quoted(`${dir}/wheelhouse/${n}`)} ] && mv ${quoted(`${dir}/wheelhouse/${n}.old`)} ${quoted(`${dir}/wheelhouse/${n}`)}`;
        assert.ok(tail.includes(put), `the old ${n} is put back on failure`);
        assert.ok(tail.indexOf(put) < tail.indexOf('rm -rf'), 'and before anything is removed');
      }
      assert.equal(spawnSync('sh', ['-n', '-c', c]).status, 0, 'the command parses');
      assert.ok(c.slice(cleanup).includes(quoted(`${dir}/wheelhouse/bin.new`)) && c.slice(cleanup).includes('exit 1'), 'a failed check removes what was copied');
      assert.ok(c.slice(chown, chmod + 20).includes(quoted(`${dir}/managed-settings.json`)));
      assert.ok(!c.includes('rm -rf ' + quoted(`${dir}/wheelhouse/scripts`) + ' '), 'the live scripts are never removed before the new ones are in');
      assert.ok(w.length > 0);
    } finally {
      for (const p of [a.folder, b.folder, base]) fs.rmSync(p, { recursive: true, force: true });
    }
  });
});

test('the domains come from every registered project, cleaned', async () => {
  await withHome(async () => {
    const a = makeProject('a', { domains: ['Mixed.Example.com', 'https://bad.example/x', '*'] });
    const c = makeProject('c', { domains: ['c.example.com'] });
    const dir = temp('wh-locked-dir-');
    try {
      const fake = fakeRun();
      await installLocked({ project: a.project, platform: 'darwin', run: fake.run, now: NOW, dir, mdmPlist: NO_PLIST });
      assert.deepEqual(fake.calls[0].staged.settings.sandbox.network.allowedDomains, ['registry.npmjs.org', 'mixed.example.com', 'c.example.com']);
    } finally {
      for (const p of [a.folder, c.folder, dir]) fs.rmSync(p, { recursive: true, force: true });
    }
  });
});

test('installed is true only when the files are in place, and a failure is reported as what it was', async () => {
  await withHome(async () => {
    const a = makeProject('a');
    const dir = temp('wh-locked-dir-');
    const put = () => {
      fs.mkdirSync(path.join(dir, 'wheelhouse'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'managed-settings.json'), '{}');
      fs.writeFileSync(path.join(dir, 'wheelhouse', 'installed.json'), '{}');
    };
    const go = (onCall) => installLocked({ project: a.project, platform: 'darwin', run: fakeRun(onCall).run, now: NOW, dir, mdmPlist: NO_PLIST });
    try {
      const cancelled = await go(() => ({ code: 1, stderr: '0:57: execution error: User canceled. (-128)' }));
      assert.equal(cancelled.installed, false);
      assert.match(cancelled.line, /cancel/i);
      const failed = await go(() => ({ code: 1, stderr: 'cp: Permission denied' }));
      assert.equal(failed.installed, false);
      assert.equal(failed.line, 'Locked may be partly changed (exit code 1): run the update again');
      assert.doesNotMatch(failed.line, /not changed/);
      assert.doesNotMatch(failed.line, /password/i);
      const missing = await go(() => ({ code: 0 }));
      assert.equal(missing.installed, false);
      assert.match(missing.line, /not in place/);
      const done = await go(() => { put(); return {}; });
      assert.equal(done.installed, true);
    } finally {
      fs.rmSync(a.folder, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('installLocked never overwrites a computer-wide file that is not Wheelhouse\'s', async () => {
  await withHome(async () => {
    const a = makeProject('a');
    const dir = temp('wh-locked-dir-');
    try {
      fs.writeFileSync(path.join(dir, 'managed-settings.json'), '{"theirs":true}');
      const fake = fakeRun();
      const args = { project: a.project, platform: 'darwin', run: fake.run, now: NOW, dir, mdmPlist: NO_PLIST };
      const r = await installLocked(args);
      assert.equal(r.installed, false);
      assert.match(r.line, /not Wheelhouse's/);
      assert.equal((await updateLocked(args)).installed, false);
      const l = await leaveLocked(args);
      assert.equal(l.installed, false, 'a refused leave says nothing was installed by Wheelhouse');
      assert.equal(fake.calls.length, 0);
      assert.equal(fs.readFileSync(path.join(dir, 'managed-settings.json'), 'utf8'), '{"theirs":true}');
    } finally {
      fs.rmSync(a.folder, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('updateLocked rebuilds and reinstalls with one prompt, refreshing the recorded plugin root', async () => {
  await withHome(async () => {
    const a = makeProject('a', { domains: ['a.example.com'] });
    const dir = temp('wh-locked-dir-');
    try {
      fs.mkdirSync(path.join(dir, 'wheelhouse'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'wheelhouse', 'locked-projects.json'), JSON.stringify([a.folder]));
      fs.writeFileSync(path.join(dir, 'wheelhouse', 'installed.json'), JSON.stringify({ pluginRoot: '/old/plugin' }));
      fs.writeFileSync(path.join(dir, 'managed-settings.json'), '{}');
      const fake = fakeRun();
      const r = await updateLocked({ project: a.project, platform: 'darwin', run: fake.run, now: NOW, dir, nodePath: NODE, address: ADDRESS, mdmPlist: NO_PLIST });
      assert.equal(fake.calls.length, 1);
      assert.deepEqual(fake.calls[0].staged.list, [a.folder]);
      assert.equal(fake.calls[0].staged.installed.pluginRoot, fs.realpathSync(ROOT));
      assert.ok(fake.calls[0].staged.hasScripts);
      assert.equal(r.installed, true);
    } finally {
      fs.rmSync(a.folder, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('leaving the last Locked project removes everything; leaving one of two keeps the other', async () => {
  await withHome(async () => {
    const a = makeProject('a', { domains: ['a.example.com'] });
    const b = makeProject('b', { domains: ['b.example.com'] });
    const dir = temp('wh-locked-dir-');
    try {
      fs.mkdirSync(path.join(dir, 'wheelhouse'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'wheelhouse', 'locked-projects.json'), JSON.stringify([a.folder, b.folder]));
      fs.writeFileSync(path.join(dir, 'wheelhouse', 'installed.json'), '{}');
      fs.writeFileSync(path.join(dir, 'managed-settings.json'), '{}');
      const common = { platform: 'darwin', now: NOW, dir, nodePath: NODE, address: ADDRESS, mdmPlist: NO_PLIST };

      const one = fakeRun();
      await leaveLocked({ project: a.project, run: one.run, ...common });
      assert.equal(one.calls.length, 1);
      assert.deepEqual(one.calls[0].staged.list, [b.folder]);
      assert.ok(!/rm -rf '[^']*wheelhouse'( |$)/.test(one.calls[0].command) && !one.calls[0].command.includes('rm -f'), 'nothing is removed while another project stays');

      fs.writeFileSync(path.join(dir, 'wheelhouse', 'locked-projects.json'), JSON.stringify([b.folder]));
      const last = fakeRun(() => {
        fs.rmSync(path.join(dir, 'managed-settings.json'));
        fs.rmSync(path.join(dir, 'wheelhouse'), { recursive: true });
      });
      const r = await leaveLocked({ project: b.project, run: last.run, ...common });
      assert.equal(last.calls.length, 1);
      assert.match(last.calls[0].command, /rm -f '[^']*managed-settings\.json'/);
      assert.match(last.calls[0].command, /rm -rf '[^']*wheelhouse'/);
      assert.equal(r.installed, false);
    } finally {
      for (const p of [a.folder, b.folder, dir]) fs.rmSync(p, { recursive: true, force: true });
    }
  });
});

test('leaveLocked does nothing, with no prompt, when the project is not in the list; it compares folders by real path and case', async () => {
  await withHome(async () => {
    const a = makeProject('a');
    const b = makeProject('b');
    const dir = temp('wh-locked-dir-');
    try {
      fs.mkdirSync(path.join(dir, 'wheelhouse'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'wheelhouse', 'locked-projects.json'), JSON.stringify([b.folder]));
      fs.writeFileSync(path.join(dir, 'wheelhouse', 'installed.json'), '{}');
      fs.writeFileSync(path.join(dir, 'managed-settings.json'), '{}');
      const common = { platform: 'darwin', now: NOW, dir, mdmPlist: NO_PLIST };
      const none = fakeRun();
      const r = await leaveLocked({ project: a.project, run: none.run, ...common });
      assert.equal(none.calls.length, 0);
      assert.equal(typeof r.line, 'string');
      // The same folder spelled with other case, and through a link, is still the project.
      const link = path.join(dir, 'link');
      fs.symlinkSync(b.folder, link);
      fs.writeFileSync(path.join(dir, 'wheelhouse', 'locked-projects.json'), JSON.stringify([link]));
      const via = fakeRun(() => ({}));
      await leaveLocked({ project: b.project, run: via.run, ...common });
      assert.equal(via.calls.length, 1);
      // Case is folded only where the system folds it.
      if (process.platform === 'darwin' || process.platform === 'win32') {
        fs.writeFileSync(path.join(dir, 'wheelhouse', 'locked-projects.json'), JSON.stringify([b.folder.toUpperCase()]));
        const cased = fakeRun(() => ({}));
        await leaveLocked({ project: b.project, run: cased.run, ...common });
        assert.equal(cased.calls.length, 1);
      }
    } finally {
      for (const p of [a.folder, b.folder, dir]) fs.rmSync(p, { recursive: true, force: true });
    }
  });
});
