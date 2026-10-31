// scripts/delegation/facts.js
// What a change shows about itself, read from its commits (delegated decisions design, section 9, guardrail 1): its
// paths, its size, and whether it touches tests, dependencies, a data model, a guardrail, a critical area or a secret.
// The guardrails and critical areas are the permit's own reading (scripts/gate/guardrails.js), judged by the default
// branch's configuration at a commit the helper read itself, so a change can't speak for itself. Anything that can't be
// read is UNREAD_FACTS, and never an error: a failure here costs a seal, never a card. So is a change with nothing
// committed, or with work not yet committed: its commits don't show what it is.
import { classifyChange, readConfig, PLUGIN_MANIFEST } from '../gate/guardrails.js';
import { scanText } from '../state/secret-scan.js';
import { isTestFile } from '../engine/test-guard.js';
import { isBranchName } from '../host/local/home.js';

export const UNREAD_FACTS = Object.freeze({ readable: false });

const CONFIG_FILE = '.claude/wheelhouse.json';
// Where a run keeps its own settings overlay (scripts/engine/order-copy.js): the run's, and never its work.
const OVERLAY_FILE = '.claude/settings.json';
const DEPENDENCY_LIST = /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|deno\.lock|requirements[^/]*\.txt|requirements\/[^/]*\.txt|setup\.py|pyproject\.toml|poetry\.lock|uv\.lock|pipfile(\.lock)?|podfile(\.lock)?|mix\.(exs|lock)|gemfile(\.lock)?|go\.(mod|sum)|cargo\.(toml|lock)|composer\.(json|lock)|pom\.xml|build\.gradle(\.kts)?|package\.swift|package\.resolved|[^/]*\.csproj)$/i;
const DATA_MODEL = /(^|\/)(migrations?|migrate|alembic)\/|(^|\/)schema\.[a-z]+$|\.(prisma|sql)$/i;

const NO_EXTRAS = ['--no-ext-diff', '--no-textconv', '--no-renames'];

// `run(args)` the output of a git call, or a throw.
const runner = (git) => async (args) => {
  const got = await git(args);
  if (got?.code !== 0) throw new Error('git could not read that');
  return String(got.stdout ?? '');
};

// A binary row gives `-`, whose size git can't say, so it is never small.
const linesIn = (numstat) => numstat.split('\0').filter(Boolean).reduce((sum, row) => {
  const [added, removed] = row.split('\t');
  return added === '-' ? Infinity : sum + Number(added) + Number(removed);
}, 0);

// The lines a patch adds. Only inside a hunk, where every line opens with its mark, can a `+` be read as one.
function addedText(patch) {
  const added = [];
  let inHunk = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) inHunk = true;
    else if (line.startsWith('diff --git ')) inHunk = false;
    else if (inHunk && line.startsWith('+')) added.push(line.slice(1));
  }
  return added.join('\n');
}

// changeFacts({ git, base, head, config }), `git` being a safeGit and `config` the default branch's, with `plugin` said.
export async function changeFacts({ git, base, head, config }) {
  if (!config) return UNREAD_FACTS;
  try {
    const read = runner(git);
    const range = `${base}...${head}`;
    const diff = (...args) => read(['diff', ...NO_EXTRAS, ...args, '--end-of-options', range, '--']);
    const paths = (await diff('--name-only', '-z')).split('\0').filter(Boolean);
    const { touchesGuardrails, criticalAreas } = classifyChange({ paths, config });
    return {
      readable: true,
      head,
      paths,
      lines: linesIn(await diff('--numstat', '-z')),
      testsChanged: paths.some(isTestFile),
      depsChanged: paths.some((file) => DEPENDENCY_LIST.test(file)),
      schemaChanged: paths.some((file) => DATA_MODEL.test(file)),
      guardrail: touchesGuardrails,
      secrets: scanText(addedText(await diff('--no-color', '--text', '-U0'))).length > 0,
      critical: criticalAreas.length > 0,
    };
  } catch {
    return UNREAD_FACTS;
  }
}

async function commitOf(read, ref) {
  return (await read(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`])).trim();
}

async function configAt(read, base) {
  const present = await read(['ls-tree', '-z', '--name-only', base, '--', CONFIG_FILE]);
  const config = readConfig(present === '' ? null : await read(['show', `${base}:${CONFIG_FILE}`]));
  const manifest = await read(['ls-tree', '-z', '--name-only', base, '--', PLUGIN_MANIFEST]);
  return { ...config, plugin: manifest !== '' };
}

// Whether the folder holds work its commits don't show, read without taking git's lock from the run.
async function uncommitted(call) {
  const got = await call(['status', '--porcelain', '-z', '--no-renames'], { env: { GIT_OPTIONAL_LOCKS: '0' } });
  if (got?.code !== 0) throw new Error('git could not read that');
  return String(got.stdout ?? '').split('\0').filter(Boolean).some((row) => row.slice(3) !== OVERLAY_FILE);
}

// The facts of a card's change: its branch, read in its folder, against `baseCommit`, the default branch's head as the
// helper read it from the project's host, never from a ref the run could move. A folder that doesn't hold that commit
// can't be read. `git(folder)` gives the helper's git for a project's folder.
export async function cardFacts({ card, git, baseCommit }) {
  if (!isBranchName(card?.branch) || typeof card?.folder !== 'string' || card.folder === '' || !/^[0-9a-f]{40,64}$/.test(baseCommit ?? '')) return UNREAD_FACTS;
  try {
    const { call } = git(card.folder);
    const read = runner(call);
    const head = await commitOf(read, `refs/heads/${card.branch}`);
    const base = await commitOf(read, baseCommit);
    const facts = await changeFacts({ git: call, base, head, config: await configAt(read, base) });
    if (facts.readable !== true) return facts;
    return facts.paths.length === 0 || await uncommitted(call) ? { readable: false, head } : facts;
  } catch {
    return UNREAD_FACTS;
  }
}
