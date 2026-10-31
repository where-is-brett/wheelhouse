// scripts/delegation/facts.js
// What a change shows about itself, read from its commits (delegated decisions design, section 9, guardrail 1): its
// paths, its size, and whether it touches tests, dependencies, a data model, a guardrail, a critical area or a secret.
// The guardrails and critical areas are the permit's own reading (scripts/gate/guardrails.js), judged by the default
// branch's configuration, so a change can't speak for itself. Anything that can't be read is UNREAD_FACTS, and never
// an error: a failure here costs a seal, never a card.
import { classifyChange, readConfig, PLUGIN_MANIFEST } from '../gate/guardrails.js';
import { scanText } from '../state/secret-scan.js';
import { isTestFile } from '../engine/test-guard.js';
import { isBranchName } from '../host/local/home.js';

export const UNREAD_FACTS = Object.freeze({ readable: false });

const CONFIG_FILE = '.claude/wheelhouse.json';
const DEPENDENCY_LIST = /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|pipfile(\.lock)?|gemfile(\.lock)?|go\.(mod|sum)|cargo\.(toml|lock)|composer\.(json|lock)|pom\.xml|build\.gradle(\.kts)?|package\.swift|package\.resolved)$/i;
const DATA_MODEL = /(^|\/)(migrations?|migrate|alembic)\/|(^|\/)schema\.[a-z]+$|\.(prisma|sql)$/i;

const NO_EXTRAS = ['--no-ext-diff', '--no-textconv', '--no-renames'];

// `run(args)` the output of a git call, or a throw.
const runner = (git) => async (args) => {
  const got = await git(args);
  if (got?.code !== 0) throw new Error('git could not read that');
  return String(got.stdout ?? '');
};

const linesIn = (numstat) => numstat.split('\0').filter(Boolean).reduce((sum, row) => {
  const [added, removed] = row.split('\t');
  return sum + (Number(added) || 0) + (Number(removed) || 0);
}, 0);

const addedText = (patch) => patch.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).map((line) => line.slice(1)).join('\n');

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
      secrets: scanText(addedText(await diff('--no-color', '-U0'))).length > 0,
      critical: criticalAreas.length > 0,
    };
  } catch {
    return UNREAD_FACTS;
  }
}

async function commitOf(read, ref) {
  return (await read(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`])).trim();
}

// The default branch's commit: the run's own copy of it from the project's remote, else a branch of that name.
async function baseOf(read, branch) {
  try {
    return await commitOf(read, `refs/remotes/origin/${branch}`);
  } catch {
    return commitOf(read, `refs/heads/${branch}`);
  }
}

async function configAt(read, base) {
  const present = await read(['ls-tree', '-z', '--name-only', base, '--', CONFIG_FILE]);
  const config = readConfig(present === '' ? null : await read(['show', `${base}:${CONFIG_FILE}`]));
  const manifest = await read(['ls-tree', '-z', '--name-only', base, '--', PLUGIN_MANIFEST]);
  return { ...config, plugin: manifest !== '' };
}

// The facts of a card's change: its branch, read in its folder, against the default branch. `git(folder)` gives the
// helper's git for a project's folder.
export async function cardFacts({ card, git, defaultBranch }) {
  if (!isBranchName(card?.branch) || !isBranchName(defaultBranch) || typeof card?.folder !== 'string' || card.folder === '') return UNREAD_FACTS;
  try {
    const { call } = git(card.folder);
    const read = runner(call);
    const head = await commitOf(read, `refs/heads/${card.branch}`);
    const base = await baseOf(read, defaultBranch);
    return await changeFacts({ git: call, base, head, config: await configAt(read, base) });
  } catch {
    return UNREAD_FACTS;
  }
}
