// probes/32-mod-sandbox/run.js
// Check 32: in a scratch project with the sandbox on, runs short headless
// sessions to see whether the probe mod's $.process.run child and its $.fs
// calls are held by the sandbox, and whether an agent's Bash run of the same
// child is; validates a copy of the Wheelhouse plugin with a mod module beside
// its command hooks; and runs a scratch plugin's command that a UserPromptSubmit
// hook answers with context. Saves every result to the probe's log folder and
// removes everything it made outside it. The sandbox runs on macOS, Linux and
// WSL2 only, so this probe is for the Mac.
// Run as: node probes/32-mod-sandbox/run.js [sandbox] [path] [validate] [command]
// (no argument runs every part).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probeLogDir, appendJsonl } from '../lib/log.js';
import { makeScratchProject, assertUnderTmp } from '../lib/scratch.js';

const CHECK = '32-mod-sandbox';
const probeDir = fileURLToPath(new URL('.', import.meta.url));
const repoDir = path.resolve(probeDir, '..', '..');
const logDir = probeLogDir(CHECK);
const resultsFile = path.join(logDir, 'results.jsonl');
const deniedRelative = `.wheelhouse-probes/${CHECK}/denied`;
const denied = path.join(os.homedir(), deniedRelative);
const KEY_TEXT = 'probe-key-32';
const CONTEXT_LINE = 'Wheelhouse added this line for check 32: the lantern is green.';
const MINIMAL_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

const asked = process.argv.slice(2);
const wants = (part) => asked.length === 0 || asked.includes(part);
const claudeBin = execFileSync('which', ['claude'], { encoding: 'utf8' }).trim();

// The nested session runs as one the director starts in a terminal would: none
// of this session's own variables, so it never attaches to this session.
function cleanEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^CLAUDE/.test(key)));
  return { ...env, ...extra };
}

function claude(args, { cwd, env }) {
  const r = spawnSync(claudeBin, args, { cwd, env, encoding: 'utf8', timeout: 240000, maxBuffer: 16 * 1024 * 1024 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = null; }
  return {
    status: r.status,
    signal: r.signal,
    error: r.error ? String(r.error) : undefined,
    result: parsed ? String(parsed.result ?? '').slice(0, 3000) : String(r.stdout ?? '').slice(0, 3000),
    isError: parsed?.is_error,
    turns: parsed?.num_turns,
    permissionDenials: parsed?.permission_denials,
    stderr: String(r.stderr ?? '').slice(0, 3000),
  };
}

async function record(part, value) {
  await appendJsonl(resultsFile, { at: new Date().toISOString(), part, ...value });
  console.log(`--- ${part}\n${JSON.stringify(value, null, 2)}`);
}

function deniedFiles() {
  return fs.existsSync(denied) ? fs.readdirSync(denied).sort() : [];
}

function resetDenied() {
  fs.rmSync(denied, { recursive: true, force: true });
  fs.mkdirSync(denied, { recursive: true });
  fs.writeFileSync(path.join(denied, 'key.txt'), KEY_TEXT + '\n');
}

function readModLog(dir) {
  const file = path.join(dir, 'probe-32-mod.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

// The settings Wheelhouse writes (scripts/protection/settings.js), narrowed to
// the probe's denied folder.
const sandboxSettings = {
  permissions: { deny: [`Read(~/${deniedRelative}/**)`, `Edit(~/${deniedRelative}/**)`] },
  sandbox: {
    enabled: true,
    allowUnsandboxedCommands: false,
    failIfUnavailable: true,
    filesystem: { denyRead: [`~/${deniedRelative}`], denyWrite: [`~/${deniedRelative}`] },
  },
};

const common = ['--output-format', 'json', '--setting-sources', 'project', '--no-session-persistence'];

if (wants('sandbox') || wants('path')) {
  const project = await makeScratchProject({ name: 'mod-sandbox', settings: sandboxSettings });
  try {
    if (wants('sandbox')) {
      resetDenied();
      const hello = claude(['-p', 'Say hello.', '--max-turns', '1', '--plugin-dir', probeDir, '--debug-file', path.join(logDir, 'debug-mod.txt'), ...common], {
        cwd: project.dir, env: cleanEnv({ PROBE32_DENIED: denied }),
      });
      await record('mod', { session: hello, modLog: readModLog(project.dir), deniedFiles: deniedFiles() });

      resetDenied();
      const child = path.join(probeDir, 'child.js');
      const prompt = `Run this command with the Bash tool and show its output exactly as printed: node "${child}" agent "${denied}"`;
      const agent = claude(['-p', prompt, '--max-turns', '3', '--debug-file', path.join(logDir, 'debug-agent.txt'), ...common], {
        cwd: project.dir, env: cleanEnv({ PROBE32_DENIED: denied }),
      });
      await record('agent', { session: agent, deniedFiles: deniedFiles() });
    }
    if (wants('path')) {
      // A Mac app started from the Dock gets the system's short PATH, not the
      // shell's: does the mod still find `node`?
      resetDenied();
      fs.rmSync(path.join(project.dir, 'probe-32-mod.jsonl'), { force: true });
      const short = claude(['-p', 'Say hello.', '--max-turns', '1', '--plugin-dir', probeDir, ...common], {
        cwd: project.dir, env: cleanEnv({ PROBE32_DENIED: denied, PATH: MINIMAL_PATH }),
      });
      await record('short-path', { session: short, modLog: readModLog(project.dir), deniedFiles: deniedFiles() });
    }
  } finally {
    await project.cleanup();
    fs.rmSync(denied, { recursive: true, force: true });
  }
}

if (wants('validate')) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-32-plugin-'));
  assertUnderTmp(copy);
  try {
    for (const part of ['.claude-plugin', 'hooks', 'commands', 'scripts']) {
      fs.cpSync(path.join(repoDir, part), path.join(copy, part), { recursive: true });
    }
    fs.copyFileSync(path.join(probeDir, 'hooks', 'register.ts'), path.join(copy, 'hooks', 'register.ts'));
    const hooksFile = path.join(copy, 'hooks', 'hooks.json');
    const hooks = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
    fs.writeFileSync(hooksFile, JSON.stringify({ ...hooks, modules: ['./register.ts'] }, null, 2) + '\n');
    const validate = (dir, json = false) => {
      const r = spawnSync(claudeBin, ['plugin', 'validate', ...(json ? ['--json'] : []), dir], { encoding: 'utf8', env: cleanEnv() });
      return { status: r.status, stdout: String(r.stdout).replaceAll(dir, '<plugin>'), stderr: String(r.stderr).replaceAll(dir, '<plugin>') };
    };
    await record('validate-both', validate(copy));
    await record('validate-both-json', validate(copy, true));
    await record('validate-probe', validate(probeDir.replace(/\/$/, '')));
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
}

if (wants('command')) {
  const plugin = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-32-command-'));
  assertUnderTmp(plugin);
  const hookLog = path.join(logDir, 'command-hook.jsonl');
  fs.rmSync(hookLog, { force: true });
  const files = {
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'probe32', version: '0.1.0', description: 'Throwaway probe for check 32.' }) + '\n',
    'commands/show.md': '---\ndescription: Show what Wheelhouse added to this turn.\n---\nShow what Wheelhouse added to this turn, as it is.\n',
    // The command hook and the probe mod in one hooks.json, so the run also
    // shows whether both load from one file.
    'hooks/hooks.json': JSON.stringify({
      modules: ['./register.ts'],
      hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `node "\${CLAUDE_PLUGIN_ROOT}/hook.js" "${hookLog}"`, timeout: 10 }] }] },
    }, null, 2) + '\n',
    'hook.js': [
      "import fs from 'node:fs';",
      "let raw = ''; for await (const chunk of process.stdin) raw += chunk;",
      'const input = JSON.parse(raw);',
      "fs.appendFileSync(process.argv[2], JSON.stringify({ at: new Date().toISOString(), prompt: input.prompt, keys: Object.keys(input) }) + '\\n');",
      `process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ${JSON.stringify(CONTEXT_LINE)} } }));`,
      '',
    ].join('\n'),
  };
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(plugin, relative)), { recursive: true });
    fs.writeFileSync(path.join(plugin, relative), content);
  }
  fs.copyFileSync(path.join(probeDir, 'hooks', 'register.ts'), path.join(plugin, 'hooks', 'register.ts'));
  const project = await makeScratchProject({ name: 'mod-command' });
  try {
    resetDenied();
    const run = claude(['-p', '/probe32:show', '--max-turns', '1', '--plugin-dir', plugin, '--debug-file', path.join(logDir, 'debug-command.txt'), ...common], {
      cwd: project.dir, env: cleanEnv({ PROBE32_DENIED: denied }),
    });
    const seen = fs.existsSync(hookLog) ? fs.readFileSync(hookLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    await record('command', {
      session: run, hookSaw: seen, replyHoldsLine: run.result.includes('lantern is green'),
      modRanBeside: readModLog(project.dir).map((r) => ({ event: r.event, exitCode: r.run?.exitCode, error: r.run?.error })),
    });
  } finally {
    await project.cleanup();
    fs.rmSync(plugin, { recursive: true, force: true });
    fs.rmSync(denied, { recursive: true, force: true });
  }
}

console.log(`Results: ${resultsFile}`);
