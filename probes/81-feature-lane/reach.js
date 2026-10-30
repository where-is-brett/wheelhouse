// probes/81-feature-lane/reach.js
// Check 81, by hand: runs one sandboxed Claude step in the merge queue's folder, with the engine's environment as a
// run's steps get it, and reports which gh it reaches: the PATH, every gh on it, whether Homebrew's signed-in gh
// (called by its full path) is signed in from there, and how many of gh's token and config variables the step sees.
//
//   WH_ROOT=<wheelhouse checkout> WHEELHOUSE_HOME=<short home> CLAUDE_BIN=<claude> node probes/81-feature-lane/reach.js
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.WH_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = (rel) => import(path.join(ROOT, rel));
const { archonEnv } = await at('scripts/engine/archon/env.js');
const { run } = await at('scripts/lib/run.js');
const { engineDir, archonHome, projectSlug } = await at('scripts/lib/paths.js');
const { queueFolderOf } = await at('scripts/engine/queue-place.js');

const claude = process.env.CLAUDE_BIN ?? 'claude';
const folder = queueFolderOf(projectSlug('where-is-brett', 'wheelhouse-merge-trial'));
const env = { ...archonEnv({ engine: engineDir(), home: archonHome(), claudeBin: claude }), WHEELHOUSE_HOME: process.env.WHEELHOUSE_HOME };
const command = 'printenv PATH; which -a gh; /opt/homebrew/bin/gh auth status >/dev/null 2>&1 && echo HOMEBREW-GH-SIGNED-IN || echo HOMEBREW-GH-NOT-SIGNED-IN; printenv GH_TOKEN GITHUB_TOKEN GH_CONFIG_DIR | wc -l';
const prompt = `Run exactly this one Bash command and reply with its output verbatim, nothing else:\n${command}`;
const got = await run(claude, ['-p', prompt, '--permission-mode', 'acceptEdits', '--max-turns', '6', '--output-format', 'stream-json', '--verbose'], { cwd: folder, env, timeoutMs: 180000 });
console.log(got.code, got.stdout, String(got.stderr ?? '').slice(-800));
