// tests/scripts/agents/copilot/engine-home.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { writeEngineHome, engineHomeProblem, ENGINE_HOME_SKILLS } from '../../../../scripts/agents/copilot/engine-home.js';
import { copilotCliPaths } from '../../../../scripts/engine/archon/copilot-cli.js';
import { registration, file as hookFile } from '../../../../adapters/copilot/hooks.js';
import { SKILL_COPIES } from '../../../../scripts/lineage/copies.js';
import { registerLean, updateLean } from '../../../../scripts/lean/project.js';
import { run } from '../../../../scripts/lib/run.js';
import { WORKTREE_PATH } from '../../../../scripts/engine/parts.js';
import { shortHome, tempFolder } from '../../../helpers/homes.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');

function signedIn(root) {
  const from = path.join(root, 'signed-in');
  fs.mkdirSync(from, { recursive: true });
  fs.writeFileSync(path.join(from, 'config.json'), JSON.stringify({ loggedInUsers: [{ host: 'https://github.com', login: 'ann' }], lastLoggedInUser: { login: 'ann' }, theme: 'dark', trusted_folders: ['/'] }));
  return from;
}

test('the clean home holds the guards as the CLI\'s own hooks, the plain-named skill copies and the sign-in alone', () => {
  const root = tempFolder('wh-engine-home-');
  const engine = path.join(root, 'engine');
  const home = writeEngineHome({ engine, signedInFrom: signedIn(root), node: process.execPath, root: ROOT, platform: 'darwin' });
  assert.equal(home, copilotCliPaths(engine).home);
  assert.deepEqual(fs.readdirSync(home).sort(), ['config.json', 'hooks', 'skills']);
  // The guards: Wheelhouse's registration, exactly as setup writes it for a person's own home.
  assert.deepEqual(JSON.parse(fs.readFileSync(hookFile({ home }), 'utf8')), registration({ node: process.execPath, root: ROOT, platform: 'darwin' }));
  // The skills: every copy the plugin carries, by its plain name, whole.
  assert.deepEqual(ENGINE_HOME_SKILLS, SKILL_COPIES);
  assert.deepEqual(fs.readdirSync(path.join(home, 'skills')).sort(), [...SKILL_COPIES].sort());
  for (const name of SKILL_COPIES) {
    assert.equal(fs.readFileSync(path.join(home, 'skills', name, 'SKILL.md'), 'utf8'), fs.readFileSync(path.join(ROOT, 'skills', name, 'SKILL.md'), 'utf8'));
  }
  // The sign-in keys and nothing else of the person's settings.
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')), { loggedInUsers: [{ host: 'https://github.com', login: 'ann' }], lastLoggedInUser: { login: 'ann' } });
  assert.equal(fs.statSync(path.join(home, 'config.json')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(home).mode & 0o777, 0o700);
  assert.equal(engineHomeProblem({ engine, node: process.execPath, root: ROOT, platform: 'darwin' }), null);
});

test('anything else in the home is removed, Copilot\'s own state kept, and a link is never followed', () => {
  const root = tempFolder('wh-engine-home-');
  const engine = path.join(root, 'engine');
  const home = copilotCliPaths(engine).home;
  fs.mkdirSync(path.join(home, 'session-state'), { recursive: true });
  fs.mkdirSync(path.join(home, 'agents'));
  fs.writeFileSync(path.join(home, 'agents', 'planted.agent.md'), 'x');
  fs.writeFileSync(path.join(home, 'mcp-config.json'), '{}');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
  fs.symlinkSync(outside, path.join(home, 'logs'));
  writeEngineHome({ engine, signedInFrom: signedIn(root), node: process.execPath, root: ROOT, platform: 'darwin' });
  assert.deepEqual(fs.readdirSync(home).sort(), ['config.json', 'hooks', 'session-state', 'skills']);
  assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
});

test('no sign-in refuses before the home is touched, and a linked home is refused', () => {
  const root = tempFolder('wh-engine-home-');
  const engine = path.join(root, 'engine');
  const empty = path.join(root, 'none');
  fs.mkdirSync(empty);
  assert.throws(() => writeEngineHome({ engine, signedInFrom: empty, node: process.execPath, root: ROOT, platform: 'darwin' }), /signed in/);
  assert.equal(fs.existsSync(copilotCliPaths(engine).home), false);
  const elsewhere = path.join(root, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.mkdirSync(path.join(engine, 'copilot'), { recursive: true });
  fs.symlinkSync(elsewhere, copilotCliPaths(engine).home);
  assert.throws(() => writeEngineHome({ engine, signedInFrom: signedIn(root), node: process.execPath, root: ROOT, platform: 'darwin' }), /link/);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
});

test('engineHomeProblem names a home with no sign-in, no guards, or guards that differ', () => {
  const root = tempFolder('wh-engine-home-');
  const engine = path.join(root, 'engine');
  const opts = { engine, node: process.execPath, root: ROOT, platform: 'darwin' };
  assert.match(engineHomeProblem(opts), /clean home/);
  const home = writeEngineHome({ ...opts, signedInFrom: signedIn(root) });
  fs.writeFileSync(hookFile({ home }), '{"version":1,"hooks":{}}\n');
  assert.match(engineHomeProblem(opts), /guards/);
  writeEngineHome({ ...opts, signedInFrom: signedIn(root) });
  fs.rmSync(path.join(home, 'config.json'));
  assert.match(engineHomeProblem(opts), /signed in/);
});

test('the guard registered in the clean home refuses a step\'s .env read inside a run\'s worktree', async () => {
  const wh = shortHome();
  const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(shortHome(), 'shop-')));
  fs.mkdirSync(path.join(folder, '.git'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = wh;
  try {
    registerLean({ project: 'shop', folder });
    updateLean('shop', { agent: 'copilot' });
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
  const worktree = path.join(folder, ...WORKTREE_PATH.split('/'), 'run-1');
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(worktree, '.env'), 'SECRET=1\n');
  const root = tempFolder('wh-engine-home-');
  const engine = path.join(root, 'engine');
  const home = writeEngineHome({ engine, signedInFrom: signedIn(root), node: process.execPath, root: ROOT, platform: 'darwin' });
  const entry = JSON.parse(fs.readFileSync(hookFile({ home }), 'utf8')).hooks.preToolUse[0];
  const ask = (file) => run('/bin/sh', ['-c', entry.bash], {
    cwd: worktree,
    baseEnv: {},
    env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, WHEELHOUSE_HOME: wh, COPILOT_HOME: home, COPILOT_CLI_BINARY_VERSION: '1.0.101' },
    input: JSON.stringify({ sessionId: 's1', timestamp: 0, cwd: worktree, toolName: 'view', toolArgs: { path: path.join(worktree, file) } }),
    timeoutMs: 30000,
  });
  const env = await ask('.env');
  assert.equal(env.code, 2, env.stderr);
  assert.equal(JSON.parse(env.stdout).permissionDecision, 'deny');
  assert.match(JSON.parse(env.stdout).permissionDecisionReason, /\.env/);
  // Not a refusal of everything: reading the project's own README goes through.
  fs.writeFileSync(path.join(worktree, 'README.md'), 'shop\n');
  const readme = await ask('README.md');
  assert.equal(readme.code, 0, readme.stdout);
});
