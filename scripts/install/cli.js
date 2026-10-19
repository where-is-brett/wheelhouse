// scripts/install/cli.js
// The install brief's two commands, for the agent writing the private brief:
//   node scripts/install/cli.js survey <folder> --scheduled <file.json>
//     Surveys the project read-only and prints the survey as JSON. Each pinned upstream with a
//     skill whose name one of the project's skills uses is cloned bare into its own new temporary
//     folder, removed after, so copies can be told from same-named skills; with no such name, none
//     is cloned and the survey needs no network but the project's own fetch. The survey's
//     `deniedAfterSwitchBack` lists { command, paths, rule }; the brief's takes only each first-version
//     entry's `command`, which the agent writes into it. `--scheduled` names a JSON list of Claude's scheduled tasks as { name, folder, path? },
//     since Claude Code keeps no folder in a scheduled task's own files: make it from the
//     scheduled-tasks tool's list (list_scheduled_tasks, with each task's runs or prompt for its
//     folder). Without it the survey's `scheduled` is null, meaning not read, and a note says so.
//   node scripts/install/cli.js brief <folder>
//     Checks the written brief with readBrief and prints what the install card will say: the
//     answers and the counts, never a part's name.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifest } from '../lineage/manifest.js';
import { run, withoutGitVars } from '../lib/run.js';
import { readBrief } from './brief.js';
import { surveyProject, upstreamsNeeded } from './survey.js';

const CLONE_WAIT_MS = 5 * 60 * 1000;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const yesNo = (value) => (value ? 'yes' : 'no');

// Bare clones of each upstream's repository, in new temporary folders: { clones, remove }.
export async function cloneUpstreams(manifest, { runner = run } = {}) {
  const made = [];
  const remove = () => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); };
  const clones = {};
  try {
    for (const upstream of manifest.upstreams) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wh-install-${upstream.name}-`));
      made.push(dir);
      const target = path.join(dir, 'repo.git');
      const result = await runner('git', ['clone', '--bare', '--quiet', upstream.repo, target], {
        cwd: dir, baseEnv: withoutGitVars(), env: { GIT_TERMINAL_PROMPT: '0' }, timeoutMs: CLONE_WAIT_MS,
      });
      if (result.code !== 0) throw new Error(`${upstream.name} could not be cloned: ${result.stderr.trim().split('\n').pop()}`);
      clones[upstream.name] = target;
    }
  } catch (error) {
    remove();
    throw error;
  }
  return { clones, remove };
}

// What the install card will say for `brief`: its answers and counts, never a part's name.
export function cardLines(brief) {
  const kinds = {};
  for (const part of brief.firstVersion) kinds[part.kind] = (kinds[part.kind] ?? 0) + 1;
  const made = Object.entries(kinds).map(([kind, n]) => plural(n, kind)).join(', ') || 'nothing';
  const flight = brief.inFlight;
  return [
    'The install card for this folder:',
    `- Protection: ${brief.protection === 'locked' ? 'Locked' : 'Standard'}, with the ${brief.connection} connection to ${brief.host === 'gitlab' ? 'GitLab' : 'GitHub'}.`,
    `- Computers: ${brief.computers.map((c) => c.label).join(', ') || 'none named'}.`,
    `- What the product is: ${brief.answers.product}`,
    `- Live data: ${yesNo(brief.answers.liveData)}. Real users: ${yesNo(brief.answers.realUsers)}.`,
    `- The first version: ${plural(brief.firstVersion.length, 'part')} (${made}), switched off on this computer, never deleted.`,
    `- Copies of pinned skills switched off: ${brief.copies.length}. Same name, own content, kept: ${brief.keep.length}.`,
    `- In flight: ${plural(flight.behind, 'commit')} behind, local changes ${yesNo(flight.dirty)}, ${plural(flight.prs.length, 'open request')}, ${plural(flight.worktrees.length, 'worktree')}.`,
    `- Commands Standard would still refuse after switching back: ${brief.deniedAfterSwitchBack.length}.`,
    `- Switched off for this project: ${plural(brief.plugins.off.length, 'plugin')}, ${plural(brief.plugins.skillsOff.length, 'personal skill')}.`,
    `- The project's documents to bring into line: ${plural(brief.docsToAlign.length, 'place')}.`,
  ];
}

function scheduledFrom(file) {
  let listed;
  try {
    listed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('The scheduled tasks file can\'t be read as JSON');
  }
  if (!Array.isArray(listed)) throw new Error('The scheduled tasks file is not a list');
  return listed;
}

export const USAGE = 'usage: node scripts/install/cli.js survey <folder> --scheduled <file.json> | brief <folder>\n'
  + '  --scheduled: a JSON list of { name, folder, path? }, made from the scheduled-tasks tool\'s list\n'
  + '  (list_scheduled_tasks). Without it the survey runs, but "scheduled" is null: not read.\n'
  + '  deniedAfterSwitchBack: the survey lists { command, paths, rule }; into the brief, write each\n'
  + '  first-version entry\'s `command` only, as a list of text.\n';
export const NOT_READ = 'No --scheduled list was given, so "scheduled" is null: the scheduled tasks were not read. '
  + 'Make the list from the scheduled-tasks tool (list_scheduled_tasks), as [{ name, folder, path }], and run the survey again with --scheduled <file.json>.\n';

// `manifest` and `clone` are for tests.
export async function main(argv, {
  write = (text) => process.stdout.write(text), warn = (text) => process.stderr.write(text), manifest = null, clone = cloneUpstreams,
} = {}) {
  const [command, folder, ...rest] = argv;
  if (command === 'survey' && folder && (rest.length === 0 || (rest.length === 2 && rest[0] === '--scheduled'))) {
    const scheduled = rest.length === 2 ? scheduledFrom(rest[1]) : null;
    const pins = manifest ?? readManifest();
    // Only the upstreams a skill name match needs, so a survey with none works offline.
    const needed = upstreamsNeeded({ folder, manifest: pins });
    const { clones, remove } = await clone({ ...pins, upstreams: pins.upstreams.filter((u) => needed.includes(u.name)) });
    try {
      const survey = await surveyProject({ folder, manifest: pins, run, upstreams: clones, scheduled });
      write(`${JSON.stringify(survey, null, 2)}\n`);
    } finally {
      remove();
    }
    if (scheduled === null) warn(NOT_READ);
    return 0;
  }
  if (command === 'brief' && folder && rest.length === 0) {
    const brief = readBrief(folder);
    if (brief === null) {
      write('No brief has been written for this folder.\n');
      return 1;
    }
    write(`${cardLines(brief).join('\n')}\n`);
    return 0;
  }
  warn(USAGE);
  return 2;
}

function startedAsScript() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (Boolean(process.argv[1]) && startedAsScript()) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
