// probes/86-no-way-out/run.js
// Check 86 (D2): can a step reach the question tool or plain chat? The pack reading is pack.js. This file runs one real
// cheap step on a scratch engine of its own (not the one check 85 uses), whose prompt tells it to use the question tool
// and then to end on a plain-chat question, and keeps the run's record and the step's session transcript.
//
//   node probes/86-no-way-out/run.js install
//   node probes/86-no-way-out/run.js step <workflow-file> [project-name]
//   node probes/86-no-way-out/run.js report <project-name>
//
// `makeProject`, `runWorkflow` and `engine` are used by check 87's probe as well. Nothing runs at import.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { archonEnv, archonRun, installScratch } from '../lib/archon.js';
import { run as runCommand } from '../../scripts/lib/run.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(os.tmpdir(), 'wheelhouse-archon-checks-86');
export const EVIDENCE = path.join(ROOT, 'evidence');

export function engine() {
  const claudeBin = path.join(os.homedir(), '.local', 'bin', 'claude');
  const env = archonEnv({ home: path.join(ROOT, 'home'), bunDir: path.join(ROOT, 'bun'), claudeBin, extra: { LANG: 'en_AU.UTF-8' } });
  return { env, bin: path.join(ROOT, 'bin', 'archon') };
}

async function sh(cmd, args, cwd) {
  const r = await runCommand(cmd, args, { cwd });
  if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

// A scratch project with the given workflow files and any other seed files, committed, with a bare remote beside it.
export async function makeProject(name, { workflows = [], files = {} } = {}) {
  const dir = path.join(ROOT, 'projects', name);
  fs.mkdirSync(path.join(dir, '.archon', 'workflows'), { recursive: true });
  for (const file of workflows) fs.copyFileSync(file, path.join(dir, '.archon', 'workflows', path.basename(file)));
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
    fs.writeFileSync(path.join(dir, relative), content);
  }
  if (!fs.existsSync(path.join(dir, 'README.md'))) fs.writeFileSync(path.join(dir, 'README.md'), 'A scratch project.\n');
  const git = (...a) => sh('/usr/bin/git', ['-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', ...a], dir);
  await git('init', '-q');
  await git('add', '-A');
  await git('commit', '-q', '-m', 'Seed');
  await git('branch', '-M', 'main');
  await sh('/usr/bin/git', ['init', '-q', '--bare', `${dir}-remote.git`], ROOT);
  await git('remote', 'add', 'origin', `${dir}-remote.git`);
  await git('push', '-q', 'origin', 'main');
  return dir;
}

// Runs a workflow to its end and keeps the record, the engine's log and every Claude session transcript written since.
export async function runWorkflow(workflow, project, message = 'check') {
  const { env, bin } = engine();
  const cwd = path.join(ROOT, 'projects', project);
  const started = Date.now();
  const launched = await archonRun(['workflow', 'run', workflow, message, '--detach'], { env, bin, cwd, timeoutMs: 120000 });
  const id = /Run id:\s*(\S+)/.exec(launched.stdout)?.[1] ?? launched.json?.runId;
  if (!id) throw new Error(`no run id: ${launched.stdout}\n${launched.stderr}`);
  await archonRun(['workflow', 'wait', id], { env, bin, cwd, timeoutMs: 900000 });
  const got = await archonRun(['workflow', 'get', id, '--json', '--verbose'], { env, bin, cwd, timeoutMs: 120000 });
  const out = path.join(EVIDENCE, project);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'record.json'), got.stdout);
  const base = path.join(os.homedir(), '.claude', 'projects');
  const sessions = [];
  for (const dir of fs.readdirSync(base)) {
    if (!dir.includes('wheelhouse-archon-checks-86')) continue;
    for (const file of fs.readdirSync(path.join(base, dir))) {
      const full = path.join(base, dir, file);
      if (file.endsWith('.jsonl') && fs.statSync(full).mtimeMs >= started) sessions.push(full);
    }
  }
  sessions.forEach((s, i) => fs.copyFileSync(s, path.join(out, `session-${i + 1}.jsonl`)));
  const record = got.json ?? {};
  const summary = { id, status: record.status, seconds: Math.round((Date.now() - started) / 1000), cost: record.metadata?.total_cost_usd, sessions: sessions.length };
  fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify(summary, null, 2));
  return { summary, out, record };
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'install') {
    const got = await installScratch({ root: ROOT });
    console.log(JSON.stringify(got));
  } else if (command === 'step') {
    const file = path.resolve(rest[0]);
    const name = rest[1] ?? path.basename(file, '.yaml');
    if (!fs.existsSync(path.join(ROOT, 'projects', name))) await makeProject(name, { workflows: [file] });
    const { summary } = await runWorkflow(path.basename(file, '.yaml'), name, `check 86 ${name}`);
    console.log(JSON.stringify(summary));
  } else if (command === 'report') {
    const dir = path.join(EVIDENCE, rest[0]);
    console.log(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  } else {
    console.log('usage: run.js install | step <workflow-file> [project] | report <project>');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
