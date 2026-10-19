// tests/scripts/setup/computer.test.js
// Step 6, the changes to this computer, on one card (design section 15), and step 8, Locked.
// Step 6 writes by key into the user's Claude settings: telemetry on this computer only (check 36,
// ruling R63), transcripts kept RETENTION_DAYS days, Claude Code's stable channel at the manifest's
// floor (check 28), phone notifications (check 4); it names this computer's signing key, and each
// of the director's own settings that weakens Standard, and changes none of them. Step 8 installs
// Locked, on a Mac, when the director chose it, after the narrow connection and the project's
// settings. Nothing touches the real ~/.claude, launch environment or managed folder: a scratch
// user home and Claude folder, a scratch managed folder and a fake `run`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { computerStep, computerChanges, lockedStep, weakening, SETTLED_LEAD } from '../../../scripts/setup/computer.js';
import { STEPS, planHash } from '../../../scripts/setup/steps.js';
import { runApply, setupRoutes, AFTER_WAIT_MS, CHANGED } from '../../../scripts/setup/engine.js';
import { findRun, markStep, reverseChange, startRun } from '../../../scripts/setup/journal.js';
import { noteAsked, answersFor } from '../../../scripts/setup/clicks.js';
import { keepAnswer } from '../../../scripts/lib/setup-clicks.js';
import { RETENTION_DAYS } from '../../../scripts/lib/setup-numbers.js';
import { telemetryEnv } from '../../../scripts/telemetry/env.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { setupLine } from '../../../scripts/state/card-lines.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { ownKey } from '../../../scripts/state/signing.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { NEEDS_NARROW, HAS_MDM, NOT_OURS } from '../../../scripts/protection/locked.js';
import { LEVELS, REAL_USERS } from '../../../scripts/setup/host.js';
import { withProject, SLUG, REPO, T0 } from '../../helpers/setup-answers.js';
import { tempFolder } from '../../helpers/homes.js';
import { fileURLToPath } from 'node:url';

const PORT = 14318;
const QUIET_STEPS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'helpers', 'setup-quiet-steps.js');
const MANIFEST = { claudeCode: { floor: '2.1.100' } };
const NO_PLIST = '/nowhere/com.anthropic.claudecode.plist';

// Every file under a folder, with its text, so a test can see that nothing else changed.
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

// A fake `run` that records every call and runs nothing.
function fakeRun(onCall) {
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args]);
    return { code: 0, stdout: '', stderr: '', ...(onCall ? onCall(file, args) : {}) };
  };
  return { run, calls };
}

// The card as the engine composes it, with its set line.
const composed = (planned, n) => composeCard({ ...planned.card, kind: 'setup', target: { step: n, hash: planHash(planned.changes) } }).question.question;

test('the card lists each change in plain words, and nothing else changes', async () => {
  await withProject(async ({ folder, user, config, home }) => {
    const file = path.join(config, 'settings.json');
    const own = { theme: 'dark', cleanupPeriodDays: 7, env: { FOO: 'bar' } };
    fs.writeFileSync(file, `${JSON.stringify(own, null, 2)}\n`);
    const fake = fakeRun();
    const step = computerStep({ run: fake.run, env: { CLAUDE_CONFIG_DIR: config }, manifest: MANIFEST, port: PORT });
    assert.equal(step.n, 6);
    const ctx = { folder, step: 6, now: () => T0, userHome: user, platform: 'darwin', answers: {} };
    const planned = await step.plan(ctx);

    // Every change is a key in the user's Claude settings, by key.
    const ours = telemetryEnv(PORT);
    assert.deepEqual(planned.changes, [
      ...Object.entries(ours).map(([k, v]) => ({ kind: 'json-key', target: file, key: ['env', k], after: v, what: 'telemetry' })),
      { kind: 'json-key', target: file, key: ['cleanupPeriodDays'], after: RETENTION_DAYS, what: 'retention' },
      { kind: 'json-key', target: file, key: ['autoUpdatesChannel'], after: 'stable', what: 'updates' },
      { kind: 'json-key', target: file, key: ['minimumVersion'], after: '2.1.100', what: 'updates' },
      { kind: 'json-key', target: file, key: ['agentPushNotifEnabled'], after: true, what: 'push' },
    ]);
    assert.deepEqual(computerChanges({ userSettings: own, manifest: MANIFEST, file, telemetry: planned.changes.slice(0, 4) }), planned.changes);
    // The same list for the same world.
    assert.deepEqual(await step.plan(ctx), planned);

    // The card names step 6 and each change in plain words, and the signing key, which is no change.
    const text = composed(planned, 6);
    assert.ok(text.includes(setupLine(6, planHash(planned.changes))));
    assert.match(text, /step 6/);
    assert.match(text, /usage counts/i);
    assert.match(text, /this computer only/);
    assert.match(text, /never your prompts or tool content/);
    assert.match(text, new RegExp(`transcripts kept ${RETENTION_DAYS} days \\(now 7\\)`));
    // Ruling R64: the card says what a shorter retention costs.
    assert.match(text, new RegExp(`transcripts kept ${RETENTION_DAYS} days \\(now 7\\); older ones are removed, and uninstall can't bring them back`));
    assert.match(text, /uninstall puts each setting back, but not removed transcripts/);
    assert.match(text, /These are Claude Code's own settings on this computer/);
    assert.match(text, /stable channel at version 2\.1\.100 or later/);
    assert.match(text, /Wheelhouse never updates itself/);
    assert.match(text, /phone notifications on/);
    assert.ok(ownKey());
    assert.match(text, /key for signing your clicks is already made/);
    assert.doesNotMatch(text, /weaken/, 'none of the director\'s settings weakens Standard here');
    assert.equal(planned.director, 'One click');

    // Applied: those keys only, each recorded with its value before; every other key is as it was,
    // and nothing else in the user's home or Claude folder changes.
    const before = snapshot(user);
    const run = startRun({ folder, now: () => T0 });
    const done = await runApply({ step, runId: run.id, changes: planned.changes, ctx: { ...ctx, runId: run.id } });
    assert.deepEqual(done, { ok: true });
    const after = snapshot(user);
    const changedFiles = Object.keys(after).filter((f) => after[f] !== before[f]);
    assert.deepEqual(changedFiles, [path.relative(user, file)]);
    const written = JSON.parse(after[path.relative(user, file)]);
    assert.deepEqual(written, {
      theme: 'dark', cleanupPeriodDays: RETENTION_DAYS, env: { FOO: 'bar', ...ours },
      autoUpdatesChannel: 'stable', minimumVersion: '2.1.100', agentPushNotifEnabled: true,
    });
    const made = findRun(folder).changes.filter((c) => c.step === 6);
    assert.equal(made.length, planned.changes.length);
    assert.equal(made.find((c) => c.key.join('.') === 'cleanupPeriodDays').before, 7);
    assert.ok(made.every((c) => c.kind === 'json-key' && c.target === file));
    assert.ok(fake.calls.every((c) => c[0] === 'launchctl' && c[1] === 'getenv'), 'it only reads the launch environment');
    assert.ok(!fs.existsSync(path.join(home, 'setup', 'clicks')) || fs.readdirSync(path.join(home, 'setup', 'clicks')).length === 0);
    // Planned again, nothing is left to change, so the step settles with no Go ahead (ruling R75).
    assert.deepEqual(await step.plan(ctx), { settled: { record: { nothing: true } } });
    // Uninstall puts every key back.
    for (const c of [...made].reverse()) assert.deepEqual(reverseChange(c), { put: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), own);
  });
});

test('by the launch environment, the card asks for a Desktop restart', async () => {
  await withProject(async ({ folder, user, config }) => {
    const fake = fakeRun();
    const step = computerStep({ run: fake.run, env: { CLAUDE_CONFIG_DIR: config }, manifest: MANIFEST, port: PORT, route: 'launch-env' });
    const planned = await step.plan({ folder, step: 6, now: () => T0, userHome: user, platform: 'darwin', answers: {} });
    assert.equal(planned.changes.filter((c) => c.kind === 'env').length, 4);
    assert.equal(planned.changes.filter((c) => c.kind === 'file').length, 1);
    const text = composed(planned, 6);
    assert.match(text, /quit and reopen Claude Desktop/);
    assert.match(text, /login item/);
    assert.match(planned.director, /quit and reopen Claude Desktop/);
    assert.match(text, /variables for your account and a login item/, 'the why line names what this route changes');
    assert.ok(fake.calls.every((c) => c[0] === 'launchctl' && c[1] === 'getenv'), 'the plan only reads');
  });
});

// The user's Claude settings as step 6 would leave them, with `own` beside them: every key it lists
// written, so a plan has nothing left to change.
async function asWheelhouseNeeds(file, user, folder, own = {}) {
  fs.writeFileSync(file, `${JSON.stringify(own)}\n`);
  const step = computerStep({ run: fakeRun().run, env: { CLAUDE_CONFIG_DIR: path.dirname(file) }, manifest: MANIFEST, port: PORT });
  const planned = await step.plan({ folder, step: 6, now: () => T0, userHome: user, platform: 'darwin', answers: {} });
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const c of planned.changes ?? []) {
    let at = data;
    for (const k of c.key.slice(0, -1)) at = (at[k] ??= {});
    at[c.key.at(-1)] = c.after;
  }
  fs.writeFileSync(file, `${JSON.stringify(data)}\n`);
}

test('with nothing to change, step 6 settles, naming the director\'s settings that weaken Standard in a line, not the signing key', async () => {
  await withProject(async ({ folder, user, config }) => {
    const file = path.join(config, 'settings.json');
    const step = computerStep({ run: fakeRun().run, env: { CLAUDE_CONFIG_DIR: config }, manifest: MANIFEST, port: PORT });
    const ctx = { folder, step: 6, now: () => T0, userHome: user, platform: 'darwin', answers: {} };
    const plan = async () => {
      const said = [];
      return { got: await step.plan({ ...ctx, say: (line) => said.push(line) }), said };
    };
    await asWheelhouseNeeds(file, user, folder);
    const quiet = await plan();
    assert.deepEqual(quiet, { got: { settled: { record: { nothing: true } } }, said: [] }, 'nothing to name');
    await asWheelhouseNeeds(file, user, folder, { sandbox: { excludedCommands: ['docker'] }, enabledPlugins: { 'theirs@market': true } });
    const named = await plan();
    assert.deepEqual(named.got, { settled: { record: { nothing: true } } });
    assert.equal(named.said.length, 1);
    assert.ok(named.said[0].startsWith(`${SETTLED_LEAD} Your own settings that weaken Standard, left as they are for you to decide:`), named.said[0]);
    assert.match(named.said[0], /docker runs outside the sandbox/);
    assert.match(named.said[0], /the plugin theirs@market is on/);
    assert.doesNotMatch(named.said[0], /signing/);
  });
});

test('through the helper, step 6 with nothing to change settles: its { nothing } answer, its done mark, and its line in status', async () => {
  await withProject(async ({ folder, user, config, home }) => {
    fs.writeFileSync(path.join(home, 'quiet-world.json'), JSON.stringify({ config, floor: MANIFEST.claudeCode.floor, port: PORT, pluginRoot: '/p' }));
    await asWheelhouseNeeds(path.join(config, 'settings.json'), user, folder, { sandbox: { excludedCommands: ['docker'] } });
    const routes = setupRoutes({ now: () => T0, userHome: user, platform: 'darwin', stepsModule: QUIET_STEPS });
    const got = await routes['/setup/plan']({ folder, step: 6 });
    assert.equal(got.ok, true, got.refused);
    assert.equal(got.done, true);
    assert.match(got.said, /docker runs outside the sandbox/);
    const run = findRun(folder);
    assert.equal(run.steps[6].doneAt, T0.toISOString());
    assert.equal(run.steps[6].shownAt, undefined, 'no Go-ahead card');
    const answer = run.changes.filter((c) => c.step === 6);
    assert.deepEqual(answer.map((c) => [c.kind, c.target, c.before, c.after]), [['answer', 'step 6', null, { nothing: true }]]);
    const { lines } = await routes['/setup/status']({ folder });
    const at = lines.findIndex((l) => l.startsWith('Step 6,'));
    assert.match(lines[at], /done at/);
    assert.equal(lines[at + 1], `  ${answer[0].said}`);
    assert.match(lines[at + 1], /docker runs outside the sandbox/);
  });
});

test('each weakening setting is named with what it does, and left as it is', async () => {
  const theirs = {
    sandbox: { excludedCommands: ['docker', 'rm'] },
    enabledPlugins: {
      'wheelhouse@wheelhouse': true, 'superpowers@wheelhouse': true, 'mattpocock-skills@wheelhouse': true,
      'helper@their-market': true, 'off@their-market': false, 'superpowers@claude-plugins-official': false,
    },
    extraKnownMarketplaces: { wheelhouse: { source: { source: 'github', repo: 'x/y' } }, 'their-market': { source: { source: 'github', repo: 'a/b' } } },
  };
  const named = weakening(theirs);
  assert.deepEqual(named.map((w) => [w.key, w.value]), [
    ['sandbox.excludedCommands', 'docker'],
    ['sandbox.excludedCommands', 'rm'],
    ['enabledPlugins', 'helper@their-market'],
    ['extraKnownMarketplaces', 'their-market'],
  ]);
  assert.match(named[0].says, /docker runs outside the sandbox/);
  assert.match(named[2].says, /helper@their-market is on, and runs its own code/);
  assert.match(named[3].says, /their-market is added, so its plugins can be installed/);
  assert.deepEqual(weakening({}), []);
  assert.deepEqual(weakening({ sandbox: { excludedCommands: 'x' }, enabledPlugins: [], extraKnownMarketplaces: null }), []);

  await withProject(async ({ folder, user, config }) => {
    const file = path.join(config, 'settings.json');
    fs.writeFileSync(file, `${JSON.stringify(theirs, null, 2)}\n`);
    const step = computerStep({ run: fakeRun().run, env: { CLAUDE_CONFIG_DIR: config }, manifest: MANIFEST, port: PORT });
    const ctx = { folder, step: 6, now: () => T0, userHome: user, platform: 'darwin', answers: {} };
    const planned = await step.plan(ctx);
    const text = composed(planned, 6);
    for (const w of named) assert.ok(text.includes(w.says), `${w.says}\n${text}`);
    assert.match(text, /weaken Standard/);
    assert.match(text, /left as they are for you to decide/);
    // No change touches them.
    for (const c of planned.changes) assert.ok(!['sandbox', 'enabledPlugins', 'extraKnownMarketplaces'].includes(c.key[0]), c.key.join('.'));
    const run = startRun({ folder, now: () => T0 });
    assert.deepEqual(await runApply({ step, runId: run.id, changes: planned.changes, ctx: { ...ctx, runId: run.id } }), { ok: true });
    const written = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const key of ['sandbox', 'enabledPlugins', 'extraKnownMarketplaces']) assert.deepEqual(written[key], theirs[key]);

    // Many of them still fit the card: each is named, at least by its name.
    const many = { sandbox: { excludedCommands: Array.from({ length: 40 }, (_, i) => `command-number-${i}`) } };
    fs.writeFileSync(file, `${JSON.stringify(many)}\n`);
    const crowded = await step.plan(ctx);
    const crowdedText = composed(crowded, 6);
    assert.match(crowdedText, /command-number-0/);
    assert.match(crowdedText, /more/);
  });
});

test('a minimum version of the director\'s own at or above the floor is kept, and a lower one is named as it is raised', async () => {
  await withProject(async ({ folder, user, config }) => {
    const file = path.join(config, 'settings.json');
    const step = computerStep({ run: fakeRun().run, env: { CLAUDE_CONFIG_DIR: config }, manifest: MANIFEST, port: PORT });
    const ctx = { folder, step: 6, now: () => T0, userHome: user, platform: 'darwin', answers: {} };
    const keysOf = (p) => p.changes.filter((c) => c.what === 'updates').map((c) => c.key[0]);
    for (const higher of ['2.3.0', '2.1.100', '2.1.101', '3.0.0']) {
      fs.writeFileSync(file, `${JSON.stringify({ minimumVersion: higher })}\n`);
      const planned = await step.plan(ctx);
      assert.deepEqual(keysOf(planned), ['autoUpdatesChannel'], higher);
      assert.match(composed(planned, 6), new RegExp(`stable channel at version ${higher.replace(/\./g, '\\.')} or later \\(your own minimum, kept\\)`), higher);
    }
    for (const [lower, shown] of [['2.0.5', '2.0.5'], ['2.1.99', '2.1.99'], ['latest', '"latest"']]) {
      fs.writeFileSync(file, `${JSON.stringify({ minimumVersion: lower })}\n`);
      const planned = await step.plan(ctx);
      assert.deepEqual(keysOf(planned), ['autoUpdatesChannel', 'minimumVersion'], lower);
      assert.ok(composed(planned, 6).includes(`at version 2.1.100 or later (now ${shown})`), lower);
    }
  });
});

test('a telemetry variable set between the card and the click makes the Go ahead refused as changed', async () => {
  await withProject(async ({ folder, user, config }) => {
    // The real steps' step 6 with a fake launch environment, through the helper's own routes.
    const dir = tempFolder('wh-steps-');
    const module = path.join(dir, 'steps.mjs');
    const computer = new URL('../../../scripts/setup/computer.js', import.meta.url).href;
    fs.writeFileSync(module, [
      `import { computerStep } from ${JSON.stringify(computer)};`,
      'const run = async () => ({ code: 0, stdout: \'\', stderr: \'\' });',
      `export const STEPS = [computerStep({ run, env: { CLAUDE_CONFIG_DIR: ${JSON.stringify(config)} }, manifest: ${JSON.stringify(MANIFEST)}, port: ${PORT} })];`,
      '',
    ].join('\n'));
    const routes = setupRoutes({ now: () => T0, userHome: user, platform: 'darwin', stepsModule: module });
    const shown = await routes['/setup/plan']({ folder, step: 6 });
    assert.equal(shown.ok, true, shown.refused);
    assert.equal(shown.changes.filter((c) => c.what === 'telemetry').length, 4);
    // The director points telemetry at their own collector meanwhile.
    const file = path.join(config, 'settings.json');
    fs.writeFileSync(file, `${JSON.stringify({ env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.example:4318' } })}\n`);
    await assert.rejects(routes['/setup/apply']({ folder, step: 6, hash: shown.hash }), (error) => error.message === CHANGED);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.example:4318' } });
  });
});

test('a user settings file that is not a JSON object stops the plan, naming it', async () => {
  await withProject(async ({ folder, user, config }) => {
    const file = path.join(config, 'settings.json');
    fs.writeFileSync(file, 'not json');
    const step = computerStep({ run: fakeRun().run, env: { CLAUDE_CONFIG_DIR: config }, manifest: MANIFEST, port: PORT });
    await assert.rejects(step.plan({ folder, step: 6, userHome: user, platform: 'darwin', answers: {} }), /settings\.json/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'not json');
  });
});

// Step 3's Locked answer, as the director gave it on step 3's card, kept for the folder's run.
function answerLocked(folder, label) {
  const run = findRun(folder) ?? startRun({ folder, now: () => T0 });
  const keep = (id, labels, chosen) => {
    const card = { question: `What this is: step 3 asks ${id}.`, header: 'Question', options: labels.map((l) => ({ label: l, description: l })) };
    noteAsked({ runId: run.id, folder, step: 3, id, card, now: () => T0 });
    keepAnswer(makeEvent({ kind: 'action', data: { action: 'setup-answer', runId: run.id, step: 3, questionId: id, question: card.question, label: chosen, text: null }, now: () => T0 }));
  };
  keep('real-users', [REAL_USERS.yes, REAL_USERS.no], REAL_USERS.yes);
  keep('locked', [LEVELS.locked, LEVELS.standard], label);
  return run;
}

// The project record as step 3 leaves it: the connection in `mode`, marked Locked when `locked`
// (step 3 connects Locked only narrow).
const narrow = (folder, mode = 'narrow', locked = mode === 'narrow') => writeProject(SLUG, {
  folder, remoteUrl: `https://github.com/${REPO}.git`, host: 'github', repo: REPO, connection: { host: 'github', mode, project: REPO, ...(locked ? { locked: true } : {}) },
});

test('Locked is installed only after the narrow connection, and never on Windows', async () => {
  await withProject(async ({ folder, user, home }) => {
    const dir = tempFolder('wh-managed Support\'s ');
    // The administrator step, faked: it puts the files in place as the real one would.
    const fake = fakeRun((file) => {
      if (file === 'osascript') {
        fs.mkdirSync(path.join(dir, 'wheelhouse'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'managed-settings.json'), '{}');
        fs.writeFileSync(path.join(dir, 'wheelhouse', 'installed.json'), '{}');
      }
      return {};
    });
    const step = lockedStep({ run: fake.run, dir, mdmPlist: NO_PLIST, nodePath: '/Applications/Node Folder/bin/node', address: path.join(home, 'helper.sock') });
    assert.equal(step.n, 8);
    assert.deepEqual(step.after, [3, 7], 'after the narrow connection (step 3) and the project\'s settings (step 7)');
    assert.equal(step.long, true, 'the password prompt may take a while');
    const locked = { '3.locked': { label: LEVELS.locked, text: null } };
    const ctxOf = (platform, answers) => ({ folder, step: 8, now: () => T0, userHome: user, platform, answers });

    // Not chosen, or on Windows: nothing to do, settled without a Go ahead.
    assert.deepEqual(await step.plan(ctxOf('darwin', {})), { settled: { record: { locked: false } } });
    assert.deepEqual(await step.plan(ctxOf('darwin', { '3.locked': { label: LEVELS.standard, text: null } })), { settled: { record: { locked: false } } });
    assert.deepEqual(await step.plan(ctxOf('win32', locked)), { settled: { record: { locked: false, why: 'Locked is offered on macOS only for now' } } });

    // Chosen on a Mac with the Quick connection: refused, nothing run.
    narrow(folder, 'quick');
    await assert.rejects(step.plan(ctxOf('darwin', locked)), new RegExp(`${NEEDS_NARROW}, and this project has the Quick connection`));
    // With no connection recorded at all, the line says so.
    writeProject(SLUG, { folder, remoteUrl: `https://github.com/${REPO}.git`, host: 'github', repo: REPO, connection: {} });
    await assert.rejects(step.plan(ctxOf('darwin', locked)), new RegExp(`${NEEDS_NARROW}, and this project has no connection yet`));
    assert.equal(fake.calls.length, 0);

    // A change Locked would refuse is never offered: another managed policy for Claude Code, or a
    // computer-wide settings file that is not Wheelhouse's.
    narrow(folder);
    const plist = path.join(tempFolder('wh-mdm-'), 'policy.plist');
    fs.writeFileSync(plist, 'x');
    await assert.rejects(lockedStep({ run: fake.run, dir, mdmPlist: plist }).plan(ctxOf('darwin', locked)), new RegExp(HAS_MDM.replace(/'/g, '.')));
    const foreign = tempFolder('wh-managed-foreign-');
    fs.writeFileSync(path.join(foreign, 'managed-settings.json'), '{}');
    await assert.rejects(lockedStep({ run: fake.run, dir: foreign, mdmPlist: NO_PLIST }).plan(ctxOf('darwin', locked)), new RegExp(NOT_OURS.replace(/'/g, '.')));
    assert.equal(fake.calls.length, 0);

    // With the narrow connection: one change, Locked for this project, and a card naming the password prompt.
    narrow(folder);
    const planned = await step.plan(ctxOf('darwin', locked));
    assert.deepEqual(planned.changes, [{ kind: 'locked', target: path.join(dir, 'managed-settings.json'), project: SLUG, folder }]);
    const text = composed(planned, 8);
    assert.match(text, /step 8/);
    assert.match(text, /password/);
    assert.match(planned.director, /password/);

    // Through the engine: on a Mac, no Go ahead is shown until steps 3 and 7 are done.
    const routes = setupRoutes({ now: () => T0, userHome: user, platform: 'darwin' });
    const run = answerLocked(folder, LEVELS.locked);
    assert.equal(answersFor(run.id)['3.locked'].label, LEVELS.locked);
    const first = await routes['/setup/plan']({ folder, step: 8 });
    assert.equal(first.wait, AFTER_WAIT_MS);
    assert.match(first.why, /step 3/);
    markStep(run.id, 3, 'doneAt', { now: () => T0 });
    const second = await routes['/setup/plan']({ folder, step: 8 });
    assert.equal(second.wait, AFTER_WAIT_MS);
    assert.match(second.why, /step 7/);
    markStep(run.id, 7, 'doneAt', { now: () => T0 });
    const shown = await routes['/setup/plan']({ folder, step: 8 });
    assert.equal(shown.ok, true, shown.refused);
    assert.equal(shown.changes[0].kind, 'locked');

    // Applied: the change is recorded before the administrator step, which is asked once.
    const done = await runApply({ step, runId: run.id, changes: planned.changes, ctx: { ...ctxOf('darwin', locked), runId: run.id } });
    assert.deepEqual(done, { ok: true });
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0][0], 'osascript');
    const made = findRun(folder).changes.filter((c) => c.step === 8);
    assert.equal(made.length, 1);
    assert.deepEqual([made[0].kind, made[0].target, made[0].before, made[0].after.project], ['locked', path.join(dir, 'managed-settings.json'), { exists: false, ours: false, projects: [] }, SLUG]);
    // Leaving Locked asks for the password, so uninstall's reversal of it is its own (Task 15).
    assert.deepEqual(reverseChange(made[0]), { put: false, why: 'put back by its own step' });

    // An administrator step that is cancelled fails the step, with the line Locked gives.
    const cancelled = lockedStep({ run: async () => ({ code: 1, stdout: '', stderr: 'User canceled. (-128)' }), dir: tempFolder('wh-managed-'), mdmPlist: NO_PLIST });
    const failed = await runApply({ step: cancelled, runId: run.id, changes: (await cancelled.plan(ctxOf('darwin', locked))).changes, ctx: { ...ctxOf('darwin', locked), runId: run.id } });
    assert.equal(failed.ok, false);
    assert.match(failed.reason, /cancelled/);
  });
});

test('step 8 goes by step 3\'s answer and the project record step 3 wrote, and refuses plainly when they disagree', async () => {
  await withProject(async ({ folder, user }) => {
    const step = lockedStep({ run: async () => { throw new Error('nothing is run'); }, dir: tempFolder('wh-managed-'), mdmPlist: NO_PLIST });
    const ctxOf = (label) => ({ folder, step: 8, now: () => T0, userHome: user, platform: 'darwin', answers: label === null ? {} : { '3.locked': { label, text: null } } });
    // Step 3 connected this project for Locked, but the latest answer says Standard: refused, not settled as not Locked.
    narrow(folder, 'narrow', true);
    await assert.rejects(step.plan(ctxOf(LEVELS.standard)), /^Error: Step 3 connected this project for Locked, but the latest answer to its Locked question is Standard, so step 8 has not gone on: the two must agree$/);
    await assert.rejects(step.plan(ctxOf(null)), /^Error: Step 3 connected this project for Locked, but its Locked question has no answer, so step 8 has not gone on: the two must agree$/);
    // The answer says Locked, but step 3 connected it without: refused.
    narrow(folder, 'narrow', false);
    await assert.rejects(step.plan(ctxOf(LEVELS.locked)), /^Error: Step 3 connected this project without Locked, but the latest answer to its Locked question is Locked, so step 8 has not gone on: the two must agree$/);
    // Agreeing: settled as not Locked, or Locked's list.
    assert.deepEqual(await step.plan(ctxOf(LEVELS.standard)), { settled: { record: { locked: false } } });
    narrow(folder, 'narrow', true);
    assert.equal((await step.plan(ctxOf(LEVELS.locked))).changes[0].kind, 'locked');
  });
  // Before step 3 has registered the project, there is no record to read: it waits.
  await withProject(async ({ folder, user }) => {
    const waiting = await lockedStep({ mdmPlist: NO_PLIST }).plan({ folder, step: 8, now: () => T0, userHome: user, platform: 'darwin', answers: {} });
    assert.ok(waiting.wait > 0);
    assert.match(waiting.why, /step 3/);
  }, { connected: false });
});

test('steps 6 and 8 are the filled ones in the steps list', () => {
  const six = STEPS.find((s) => s.n === 6);
  const eight = STEPS.find((s) => s.n === 8);
  assert.deepEqual(eight.after, [3, 7]);
  assert.equal(eight.long, true);
  assert.equal(six.long, undefined);
});
