// scripts/lineage/release.js
// Installing a Wheelhouse release in a project, and the undo (design section 14.4). A project
// pins the release it runs in its committed .claude/settings.json: the `ref` of the Wheelhouse
// marketplace's source, a tag of Wheelhouse's repository. A release moves that `ref` by a pull
// request, only between features. The release's commit travels in the pull request's branch
// name, `wheelhouse-release-<commit>` (`wheelhouse-undo-<commit>` for an undo), which the gate
// reads back: a pull request whose only change is that `ref`, to a tag whose release file says
// it only moves the pins and passed the lineage job, needs the review but not the director's
// approval (checkRelease). The undo moves the `ref` back the same way, then reinstalls the
// earlier release by check 30's route, which works even after Claude Code's clean-up has
// removed that release's folder.
//   node scripts/lineage/release.js reinstall <project-folder> <tag> <commit>
import fs from 'node:fs';
import path from 'node:path';
import { FEATURE_STEPS } from '../lib/build-loop.js';
import { canonicalJson } from '../lib/canonical.js';
import { invocation, resolveClaude, withoutHostVariables } from '../lib/claude.js';
import { run as defaultRun, withoutGitVars } from '../lib/run.js';
import { safeGit } from '../lib/safe-git.js';
import { readProject } from '../lib/projects.js';
import { MARKETPLACE, MARKETPLACE_PATH, WHEELHOUSE_REPO, WHEELHOUSE_URL, claudeHome as defaultClaudeHome, locateInstalled } from './manifest.js';
import { startedAsScript } from '../lib/started-as-script.js';

// The file a release changes in a project, and the one a Wheelhouse release carries to say what it is.
export const SETTINGS_FILE = '.claude/settings.json';
export const RELEASE_FILE = 'lineage/release.json';
// The branch of a release's pull request, naming the release's commit in full, and of an undo's,
// naming the earlier release's (ruling R149): the gate weighs both as a release.
export const RELEASE_BRANCH = /^wheelhouse-(?:release|undo)-([0-9a-f]{40})$/;
const branchFor = (kind) => (sha) => {
  if (!FULL_SHA.test(sha ?? '')) throw new Error('The release\'s commit must be written in full');
  return `wheelhouse-${kind}-${sha}`;
};
export const releaseBranch = branchFor('release');
export const undoBranch = branchFor('undo');

const FULL_SHA = /^[0-9a-f]{40}$/;
// A tag name the gate can fetch: plain, never an option, a path or a ref expression.
const TAG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const isTag = (ref) => typeof ref === 'string' && TAG.test(ref) && !ref.includes('..') && !ref.endsWith('.lock');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const set = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
const short = (sha) => String(sha).slice(0, 12);

// --- Between features ---

// The feature steps a release waits behind: every step after `started` but the end.
const BUSY = FEATURE_STEPS.filter((step) => step !== 'started' && step !== 'closed');

// Whether a release may be installed now: only when no feature is past `started` (design
// section 14.4: plugins are shared across the computer, so pins move only between features).
// `features` is the features view. A step this does not know holds the release too.
export function canInstall({ features } = {}) {
  if (!isObject(features)) return { ok: false, why: 'the features could not be read, so the release waits' };
  for (const [work, feature] of Object.entries(features)) {
    const step = feature?.data?.step;
    if (step === 'started' || step === 'closed') continue;
    const said = BUSY.includes(step) ? `is ${step}` : 'is in a step this does not know';
    return { ok: false, why: `the feature ${work} ${said}, so the release waits until no feature is running` };
  }
  return { ok: true };
}

// --- The settings change ---

// How a project declares Wheelhouse's marketplace: its name in `extraKnownMarketplaces`, and the
// fields of its source other than `ref`. A probe names a scratch marketplace in its place.
export const WHEELHOUSE_DECLARED = Object.freeze({ marketplace: MARKETPLACE, source: Object.freeze({ source: 'github', repo: WHEELHOUSE_REPO }) });

// The marketplace's source in `settings` as `declared` names it, or null when it is not that one.
function wheelhouseSource(settings, declared = WHEELHOUSE_DECLARED) {
  const entry = isObject(settings) && isObject(settings.extraKnownMarketplaces) && Object.hasOwn(settings.extraKnownMarketplaces, declared.marketplace)
    ? settings.extraKnownMarketplaces[declared.marketplace] : null;
  const source = isObject(entry) ? entry.source : null;
  return isObject(source) && Object.entries(declared.source).every(([key, value]) => source[key] === value) ? source : null;
}

// The project's settings with only the Wheelhouse marketplace's `ref` changed, to `ref`. A
// marketplace source takes no commit (ruling R135), so `sha` is not written here: it goes in
// the pull request's branch name (releaseBranch), and the gate checks the tag's commit is it.
// The input is not changed. Throws when the settings name no Wheelhouse marketplace.
export function releaseChange(settings, { ref, sha } = {}, { declared = WHEELHOUSE_DECLARED } = {}) {
  if (!isTag(ref)) throw new Error('The release must be named by a plain tag');
  if (!FULL_SHA.test(sha ?? '')) throw new Error('The release\'s commit must be written in full');
  if (wheelhouseSource(settings, declared) === null) throw new Error('The project\'s settings name no Wheelhouse marketplace to move');
  const copy = JSON.parse(JSON.stringify(settings));
  set(wheelhouseSource(copy, declared), 'ref', ref);
  return copy;
}

// The settings file's text as the pull request carries it.
export const settingsText = (settings) => `${JSON.stringify(settings, null, 2)}\n`;

// Whether a pull request's change is a release's and nothing else: `paths` is exactly the
// settings file, its head copy is a plain file, and the two sides parse to settings that differ
// only in the Wheelhouse marketplace's `ref` (everything else deep-equal). `sides` is
// { base, head, headMode } as text (null when absent). Resolves to { ref } or null.
export function pinsOnlyChange(paths, sides) {
  if (!Array.isArray(paths) || paths.length !== 1 || paths[0] !== SETTINGS_FILE) return null;
  if (!isObject(sides) || typeof sides.base !== 'string' || typeof sides.head !== 'string' || sides.headMode !== '100644') return null;
  try {
    const head = JSON.parse(sides.head);
    const base = JSON.parse(sides.base);
    const ref = wheelhouseSource(head)?.ref;
    const before = wheelhouseSource(base);
    if (!isTag(ref) || before === null) return null;
    set(before, 'ref', ref);
    return canonicalJson(base) === canonicalJson(head) ? { ref } : null;
  } catch {
    return null;
  }
}

// --- Is the release pins-only (ruling R132) ---

// Why a release is not taken as pins-only, always one of these set phrases.
export const RELEASE_WHY = Object.freeze({
  shape: 'the release could not be named',
  fetch: 'Wheelhouse\'s repository could not be read at that tag',
  commit: 'the tag is not at the commit the pull request names',
  branch: 'the tag\'s commit is not on Wheelhouse\'s default branch',
  file: `the release's ${RELEASE_FILE} does not say it only moves the pins and passed the lineage checks`,
});

const TAG_REF = 'refs/wheelhouse/release/tag';
const DEFAULT_REF = 'refs/wheelhouse/release/default';
const NO_HOOKS = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'];

// Whether `ref` is a pins-only Wheelhouse release at `sha`: Wheelhouse's repository at `url`,
// fetched into `mirror` (a bare repository of the caller's own, made if missing) over that
// address's protocol only, has the tag at `sha`, `sha` on its default branch, and at `sha` a
// release file { kind: 'pins-only', lineage: 'passed' }. Read-only toward the repository.
// `git(args, options)` runs git in the mirror. Never throws: anything that can't be read is a
// refusal with one of RELEASE_WHY.
export async function checkRelease({ ref, sha, mirror, git, url = WHEELHOUSE_URL }) {
  if (!isTag(ref) || !FULL_SHA.test(sha ?? '') || typeof mirror !== 'string' || typeof url !== 'string') return { ok: false, why: RELEASE_WHY.shape };
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//.exec(url)?.[1];
  if (!scheme) return { ok: false, why: RELEASE_WHY.shape };
  const inMirror = (args) => git([...NO_HOOKS, ...args], { cwd: mirror, input: '' });
  try {
    if (!fs.existsSync(path.join(mirror, 'HEAD'))) {
      fs.rmSync(mirror, { recursive: true, force: true });
      fs.mkdirSync(mirror, { recursive: true });
      if ((await inMirror(['init', '-q', '--bare'])).code !== 0) return { ok: false, why: RELEASE_WHY.fetch };
    }
    const fetched = await inMirror([
      '-c', 'protocol.allow=never', '-c', `protocol.${scheme}.allow=always`,
      'fetch', '-q', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', '--end-of-options', url,
      `+refs/tags/${ref}:${TAG_REF}`, `+HEAD:${DEFAULT_REF}`,
    ]);
    if (fetched.code !== 0) return { ok: false, why: RELEASE_WHY.fetch };
    const tagged = await inMirror(['rev-parse', '--verify', '-q', `${TAG_REF}^{commit}`]);
    if (tagged.code !== 0) return { ok: false, why: RELEASE_WHY.fetch };
    if (tagged.stdout.trim() !== sha) return { ok: false, why: RELEASE_WHY.commit };
    const onDefault = await inMirror(['merge-base', '--is-ancestor', sha, DEFAULT_REF]);
    if (onDefault.code !== 0) return { ok: false, why: RELEASE_WHY.branch };
    const listed = await inMirror(['ls-tree', sha, '--', RELEASE_FILE]);
    if (listed.code !== 0 || !/^100644 blob [0-9a-f]+\t/.test(listed.stdout)) return { ok: false, why: RELEASE_WHY.file };
    const read = await inMirror(['cat-file', 'blob', `${sha}:${RELEASE_FILE}`]);
    if (read.code !== 0) return { ok: false, why: RELEASE_WHY.file };
    let release = null;
    try { release = JSON.parse(read.stdout); } catch { /* not JSON */ }
    if (!isObject(release) || release.kind !== 'pins-only' || release.lineage !== 'passed') return { ok: false, why: RELEASE_WHY.file };
    return { ok: true };
  } catch {
    return { ok: false, why: RELEASE_WHY.fetch };
  } finally {
    for (const name of [TAG_REF, DEFAULT_REF]) {
      try { await inMirror(['update-ref', '-d', name]); } catch { /* tidying is best effort */ }
    }
  }
}

// The line the briefing shows when a pins-only release merges: the foreman records it from the
// merge's answer (ruling F73).
export { briefingLine } from '../lib/release-line.js';

// --- The reinstall (check 30's route) ---

// `claude <args>` through `run`, in the project's folder, without the host session's variables.
async function claudeIn({ run, resolved, projectDir }, args) {
  const call = invocation(resolved, [], args);
  return run(call.file, call.args, {
    cwd: projectDir, input: call.input, baseEnv: withoutHostVariables(withoutGitVars(process.env)), timeoutMs: 10 * 60 * 1000,
    ...(call.verbatim ? { windowsVerbatimArguments: true } : {}),
  });
}

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};
const readText = (file) => {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
};

// The commit each plugin of the marketplace at `installLocation` pins: a `url` or `github`
// source's `sha`, and for a plugin inside the marketplace (a relative path), the release's own.
function pinsOf(installLocation, sha) {
  const listed = readJson(path.join(installLocation, ...MARKETPLACE_PATH.split('/')));
  if (!isObject(listed) || !Array.isArray(listed.plugins)) return null;
  const pins = [];
  for (const plugin of listed.plugins) {
    if (!isObject(plugin) || typeof plugin.name !== 'string' || plugin.name === '') return null;
    const source = plugin.source;
    if (typeof source === 'string') pins.push({ plugin: plugin.name, want: sha });
    else if (isObject(source) && FULL_SHA.test(source.sha ?? '')) pins.push({ plugin: plugin.name, want: source.sha });
    else return null;
  }
  return pins;
}

// Reinstalls the release `{ ref, sha }` for the project in `projectDir`, by check 30's route:
// `claude plugin marketplace update <marketplace>`, which fetches the marketplace again at the
// `ref` the project's settings name; then for each plugin it lists, `claude plugin update
// <plugin>@<marketplace> --scope project`, and where that leaves another commit installed (two
// releases with one plugin.json version are "already at the latest version"), uninstall then
// install. What is installed is read from gitCommitSha in installed_plugins.json, never the
// folder. Every child process goes through `run`. A project settings file the uninstall or
// install rewrote is put back as it was, since it is the merged release's. `marketplace` and
// `claudeHome` are for probes. Resolves with { ok, line, installed: [{ plugin, want, got, route }] }.
export async function reinstall({
  projectDir, release, run = defaultRun, marketplace = MARKETPLACE, claudeHome = defaultClaudeHome(), resolved = resolveClaude(),
}) {
  const { ref, sha } = release ?? {};
  if (!isTag(ref) || !FULL_SHA.test(sha ?? '')) throw new Error('The release must be a plain tag and its full commit');
  const ctx = { run, resolved, projectDir };
  const settingsFile = path.join(projectDir, ...SETTINGS_FILE.split('/'));
  const settingsBefore = readText(settingsFile);
  const updated = await claudeIn(ctx, ['plugin', 'marketplace', 'update', marketplace]);
  if (updated.code !== 0) return { ok: false, installed: [], line: `Claude Code could not fetch the ${marketplace} marketplace again, so nothing was reinstalled.` };
  // The computer's copy of the marketplace must now be the release's commit.
  const known = readJson(path.join(claudeHome, 'plugins', 'known_marketplaces.json'))?.[marketplace];
  const installLocation = typeof known?.installLocation === 'string' ? known.installLocation : null;
  // Claude's installed copy of the marketplace: looked at once, then read under the fence.
  const head = installLocation ? await safeGit({ run, cwd: installLocation, look: 'once' })(['rev-parse', 'HEAD'], { input: '' }) : null;
  const at = head?.code === 0 ? head.stdout.trim() : null;
  if (at !== sha) {
    return {
      ok: false,
      installed: [],
      // A shell command does not fetch a marketplace again from a source changed in settings
      // (Task 29's trial). The plugin loading reference says a session started in the project
      // does, and that adding a repository's declared marketplaces needs the workspace trust
      // dialog; a headless session in an untrusted folder did not (Task 29's trial). So this
      // route is not yet proven end to end.
      line: `This computer's copy of the ${marketplace} marketplace is at ${at ? short(at) : 'a commit that could not be read'}, not ${ref} (${short(sha)}), so nothing was reinstalled. A shell command does not fetch the marketplace again when the project's settings change its ref. Claude Code's documentation says a session started in the project's trusted folder fetches it again from them; that is not yet proven. Check the settings in this folder name ${ref}, start a Claude Code session there, then run the reinstall again.`,
    };
  }
  const pins = pinsOf(installLocation, sha);
  if (pins === null) return { ok: false, installed: [], line: `The ${marketplace} marketplace at ${ref} lists a plugin this can't read the commit of, so nothing was reinstalled.` };
  const gotFor = (plugin) => locateInstalled({ plugin }, { projectDir, claudeHome, marketplace })?.sha ?? null;
  const installed = [];
  for (const { plugin, want } of pins) {
    const id = `${plugin}@${marketplace}`;
    let route = 'update';
    let got = gotFor(plugin);
    if (got !== want) {
      await claudeIn(ctx, ['plugin', 'update', id, '--scope', 'project', '--json']);
      got = gotFor(plugin);
    } else {
      route = 'already installed';
    }
    if (got !== want) {
      route = 'uninstall, then install';
      await claudeIn(ctx, ['plugin', 'uninstall', id, '--scope', 'project', '--json']);
      await claudeIn(ctx, ['plugin', 'install', id, '--scope', 'project', '--json']);
      got = gotFor(plugin);
    }
    installed.push({ plugin, want, got, route });
  }
  let putBack = false;
  if (settingsBefore !== null && readText(settingsFile) !== settingsBefore) {
    fs.writeFileSync(settingsFile, settingsBefore);
    putBack = true;
  }
  const wrong = installed.filter((one) => one.got !== one.want);
  const said = installed.map((one) => `${one.plugin} ${one.got ? short(one.got) : 'not installed'}`).join(', ');
  const kept = putBack ? ' Claude Code rewrote the project\'s settings on the way, so they were put back as the release has them.' : '';
  return {
    ok: wrong.length === 0,
    installed,
    putBack,
    line: wrong.length === 0
      ? `Wheelhouse ${ref} is installed for this project: ${said}.${kept}`
      : `Wheelhouse ${ref} is not fully installed: ${wrong.map((one) => one.plugin).join(', ')} ${wrong.length === 1 ? 'is' : 'are'} not at the release's commit (installed now: ${said}).${kept}`,
  };
}

// --- The undo ---

// Puts the project back to the earlier release `previous` ({ ref, sha }). While the project's
// settings in its folder still name another release, it opens the settings change as a pull
// request through `open({ branch, file, text, title, body })` (the foreman's way of opening one,
// which pushes the branch and stamps the body through the helper), and resolves with
// { ok: false, pending: true, pr, line }: the gate weighs it as any release, so it needs no
// approval only when `previous` is itself a pins-only release (ruling R140). Once the merged
// change is in the folder, the next call reinstalls the release (see reinstall) and says what is
// installed. `projectDir` is the project's folder from its record unless given; `declared` is
// for probes, which name a scratch marketplace (see WHEELHOUSE_DECLARED).
export async function undo({
  project, previous, run = defaultRun, open, projectDir = readProject(project)?.folder, claudeHome, declared = WHEELHOUSE_DECLARED, resolved,
}) {
  const { ref, sha } = previous ?? {};
  if (!isTag(ref) || !FULL_SHA.test(sha ?? '')) throw new Error('The earlier release must be a plain tag and its full commit');
  if (typeof projectDir !== 'string' || projectDir === '') throw new Error('The project\'s folder is not known');
  const settings = readJson(path.join(projectDir, ...SETTINGS_FILE.split('/')));
  const source = wheelhouseSource(settings, declared);
  if (source === null) return { ok: false, line: 'The project\'s settings name no Wheelhouse marketplace, so there is no release to put back.' };
  if (source.ref !== ref) {
    if (typeof open !== 'function') throw new Error('The undo needs a way to open its pull request');
    const opened = await open({
      branch: undoBranch(sha),
      file: SETTINGS_FILE,
      text: settingsText(releaseChange(settings, { ref, sha }, { declared })),
      title: `Put Wheelhouse back to ${ref}`,
      body: `Puts this project back to Wheelhouse ${ref} (${sha}), the release before ${source.ref ?? 'the current one'}. Only the Wheelhouse marketplace's ref in ${SETTINGS_FILE} changes. Once it merges, the undo reinstalls ${ref}.`,
    });
    if (opened?.ok !== true) return { ok: false, line: `The undo's pull request could not be opened: ${opened?.refused ?? 'no reason was given'}.` };
    return { ok: false, pending: true, pr: opened.number, line: `The undo's pull request${Number.isInteger(opened.number) ? ` #${opened.number}` : ''} is open. Once it merges and this folder has it, the undo reinstalls ${ref}.` };
  }
  const done = await reinstall({
    projectDir, release: { ref, sha }, run, marketplace: declared.marketplace, ...(claudeHome ? { claudeHome } : {}), ...(resolved ? { resolved } : {}),
  });
  return { ok: done.ok, line: done.line, installed: done.installed };
}

// --- The command line ---

if (startedAsScript(import.meta.url)) {
  const [command, folder, ref, sha, ...rest] = process.argv.slice(2);
  if (command !== 'reinstall' || !folder || !isTag(ref) || !FULL_SHA.test(sha ?? '') || rest.length > 0) {
    process.stderr.write('usage: node scripts/lineage/release.js reinstall <project-folder> <tag> <full commit>\n');
    process.exit(2);
  }
  try {
    const projectDir = path.resolve(folder);
    const named = wheelhouseSource(readJson(path.join(projectDir, ...SETTINGS_FILE.split('/'))))?.ref;
    if (named !== ref) {
      process.stderr.write(`The project's settings name ${named ?? 'no Wheelhouse release'}, not ${ref}: the undo's pull request must merge, and this folder have it, before ${ref} is reinstalled.\n`);
      process.exit(1);
    }
    const done = await reinstall({ projectDir, release: { ref, sha } });
    process.stdout.write(`${done.line}\n`);
    process.exitCode = done.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
