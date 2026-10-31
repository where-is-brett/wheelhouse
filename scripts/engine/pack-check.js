// scripts/engine/pack-check.js
// The workflow pack's own check and its digest (Archon design, sections 7.1, 7.2 and 12.1). Archon only warns on a
// skill name it can't find, prefixed names included (check 77), and doesn't fail a node missing a named plugin, so this
// check is the one guard on both. The pack's workflows are written in YAML's JSON form, after their path comment, so
// they are read here without a YAML library; prompts live in prompts/ and each includes the shared rules by {{rules}}.
//   node scripts/engine/pack-check.js [<pack folder>]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startedAsScript } from '../lib/started-as-script.js';
import { skillCopyNames } from '../lineage/copies.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PACK_DIR = path.join(ROOT, 'engine', 'archon', 'pack');

// The one place the plugin's name is written (ruling 2): every Claude step names it, and its skills carry its prefix.
export const WHEELHOUSE_PLUGIN = 'wheelhouse@wheelhouse';
export const SKILL_PREFIX = 'wheelhouse:';

// The marker a prompt includes the shared rules by, and the two lines the rules must hold (section 7.1).
export const RULES_MARK = '{{rules}}';
export const NO_PERSON_LINE = 'There is no person to ask';
export const LOOP_LINE = "Earlier rounds' committed code stands";

// Workflows that are not lanes, so take no work: setup's health trial, and the reader.
const NOT_LANES = new Set(['wheelhouse-hello', 'wheelhouse-reader']);
// The workflows that can only read (choice 6 of the delegated decisions plan): a step of one can't ask, so it has no
// blocked exit, no wait and no shared rules, which tell a step to read an order and take that exit. What holds it to its
// own folder is its tool list and the project settings alone, so neither it nor a plugin may add to them (check 87).
export const READ_ONLY = new Set(['wheelhouse-reader']);
const READ_TOOLS = ['Read', 'Grep', 'Glob'];
const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);
// The tool that would put a question to a person. A step's only way to the director is its blocked exit (check 86).
export const QUESTION_TOOL = 'AskUserQuestion';
// The model a step may name: one of Archon's tiers, or an alias the routing table binds.
const TIERS = new Set(['small', 'medium', 'large']);
// Words that name a model or its family. The routing table is the one place that names a model (section 7.6).
const MODEL_WORDS = /\b(claude-[a-z0-9][\w.-]*|opus|sonnet|haiku|fable|gpt-?\d[\w.-]*|o[134](-mini)?|gemini[\w.-]*|llama[\w.-]*|mistral[\w.-]*|deepseek[\w.-]*|qwen[\w.-]*)\b/i;
// A gh named by its path, or a token handed to one: every gh call goes through the broker on PATH (section 12.4).
const OWN_GH = /(^|[\s;&|(`"'=])(\S*[/\\]gh(\.exe)?)(?=[\s;&|)`"']|$)|\bGH_TOKEN\b|\bGITHUB_TOKEN\b|\bGH_ENTERPRISE_TOKEN\b/;
// The merge queue's verdict: only the helper posts it, from a signed review (section 7.5).
const VERDICT = /archon-review-report|\bgh\s+pr\s+review\b/;

// A git command that moves the worktree's files, which skip-worktree on the run's overlay makes git refuse where it
// changes .claude/settings.json; a step takes the overlay out first (order-copy.js --release).
const MOVES_WORKTREE = /\bgit\s+(?:-[Cc]\s+\S+\s+|-(?![Cc]\s)\S+\s+)*(rebase|pull|checkout|merge|switch|reset|stash|cherry-pick|revert|am|restore|read-tree)(?![\w-])/;
const RELEASE = /order-copy\.js"?\s+--release\b/;
function movesBeforeRelease(text) {
  const move = MOVES_WORKTREE.exec(text);
  if (!move) return false;
  const release = RELEASE.exec(text);
  return !release || release.index > move.index;
}

// A workflow file's object: the text after its leading comment lines, as JSON.
export function readWorkflow(text) {
  const lines = String(text).split(/\r?\n/);
  let start = 0;
  while (start < lines.length && /^\s*(#.*)?$/.test(lines[start])) start += 1;
  return JSON.parse(lines.slice(start).join('\n'));
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isAI = (node) => ['prompt', 'prompt_file', 'command', 'loop'].some((key) => node[key] !== undefined);
// Each node with the loop group it sits in (null at the top), the groups' bodies included.
export function nodesOf(nodes, group = null) {
  const all = [];
  for (const node of Array.isArray(nodes) ? nodes.filter(isObject) : []) {
    all.push({ node, group });
    if (isObject(node.loop_group)) all.push(...nodesOf(node.loop_group.nodes, node));
  }
  return all;
}
const promptFileOf = (node) => node.prompt_file;
const filesOf = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.relative(dir, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
  .sort();

const deniesQuestion = (node) => (Array.isArray(node.denied_tools) && node.denied_tools.includes(QUESTION_TOOL) ? [] : [`${node.id} doesn't deny ${QUESTION_TOOL}, so nothing but the engine keeps it from a person`]);

// The problems with one AI node, as plain lines. `waitedAfter` is true for a step of a task block that a lane waits on
// after the block's fan-out: a block can't hold a wait, so its blocked exit is the lane's.
function aiProblems(node, group, nodes, copies, waitedAfter = false) {
  const found = [];
  const id = node.id;
  found.push(...deniesQuestion(node));
  const plugins = Array.isArray(node.plugins) ? node.plugins : [];
  if (!plugins.includes(WHEELHOUSE_PLUGIN)) found.push(`${id} doesn't name the Wheelhouse plugin (${WHEELHOUSE_PLUGIN}), so its guards wouldn't load`);
  if (plugins.some((plugin) => plugin !== WHEELHOUSE_PLUGIN)) found.push(`${id} names a plugin other than Wheelhouse`);
  for (const skill of Array.isArray(node.skills) ? node.skills : []) {
    if (typeof skill !== 'string' || !skill.startsWith(SKILL_PREFIX)) found.push(`${id} names the skill ${skill} without the ${SKILL_PREFIX} prefix`);
    else if (!copies.includes(skill.slice(SKILL_PREFIX.length))) found.push(`${id} names the skill ${skill}, which matches no copy in the plugin`);
  }
  if (node.loop !== undefined) found.push(`${id} is a loop step, which Archon runs without its plugins; a loop_group with this step in its body loads them`);
  if (node.model !== undefined && !(TIERS.has(node.model) || /^@[A-Za-z0-9][\w-]*$/.test(node.model))) found.push(`${id} names a model; a step names a tier or an alias`);
  if (node.output_format?.properties?.blocked?.type !== 'boolean') found.push(`${id} has no blocked field in its output`);
  // A step in a loop group's body is blocked through the group: its output is the group's.
  const owner = group?.id ?? id;
  const exit = `$${owner}.output.blocked == 'true'`;
  const waits = nodes.some(({ node: n }) => n.wait !== undefined && Array.isArray(n.depends_on) && n.depends_on.includes(owner) && String(n.when ?? '').includes(exit));
  if (!waits && !waitedAfter) found.push(`${id} has no wait for its blocked exit`);
  if (!promptFileOf(node)) found.push(`${id} has no prompt file in prompts/`);
  return found;
}

// The problems with one step of a read-only workflow.
function readerProblems(node) {
  const found = [];
  const id = node.id;
  found.push(...deniesQuestion(node));
  if (!sameList(node.allowed_tools, READ_TOOLS)) found.push(`${id} has to carry exactly the tools ${READ_TOOLS.join(', ')}`);
  if (!sameList(node.settingSources, ['project'])) found.push(`${id} has to read the project's settings alone, so no allow rule of the computer's widens what it reads`);
  if (node.plugins !== undefined || node.skills !== undefined) found.push(`${id} takes no plugin and no skill, which would add to what it reads`);
  if (node.model !== undefined && !(TIERS.has(node.model) || /^@[A-Za-z0-9][\w-]*$/.test(node.model))) found.push(`${id} names a model; a step names a tier or an alias`);
  if (Object.keys(node.output_format?.properties ?? {})[0] !== 'frame') found.push(`${id} has to answer the frame first`);
  if (node.output_format?.properties?.blocked !== undefined) found.push(`${id} has no blocked exit: it can't ask`);
  if (!promptFileOf(node)) found.push(`${id} has no prompt file in prompts/`);
  return found;
}

// Whether a lane waits, after its `include` node, on a blocked exit: a wait on `$x.output.blocked == 'true'` from a
// step `x` that comes after the include and reads the include's own output, the blocks' records the helper can see.
function waitsAfter(nodes, include) {
  return nodes.some(({ node: x }) => Array.isArray(x.depends_on) && x.depends_on.includes(include) && String(x.bash ?? '').includes(`$${include}.output`) && nodes.some(({ node: n }) => (
    n.wait !== undefined && Array.isArray(n.depends_on) && n.depends_on.includes(x.id) && String(n.when ?? '').includes(`$${x.id}.output.blocked == 'true'`))));
}

// The problems with the pack in `dir`, as plain lines; none means it may be built. `skillCopies` are the plain names
// of the skill copies the plugin carries. A workflow another one includes is a task block: it takes no work input
// (it runs inside the lane's run), and its steps' blocked exits are waited on by the lane after the block.
export function checkPack(dir = PACK_DIR, { skillCopies = skillCopyNames() } = {}) {
  const found = [];
  const prompts = path.join(dir, 'prompts');
  const names = fs.readdirSync(dir).filter((name) => name.endsWith('.yaml')).sort();
  if (names.length === 0) found.push('the pack holds no workflow');
  const used = new Set();
  const read = [];
  for (const name of names) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    try {
      read.push({ name, text, workflow: readWorkflow(text) });
    } catch (error) {
      found.push(`${name} can't be read as YAML's JSON form: ${error.message}`);
    }
  }
  const inPack = new Set(read.map(({ workflow }) => workflow.name));
  // Each block's name, and whether every lane that includes it waits on its blocked exit after it.
  const blocks = new Map();
  for (const { workflow } of read) {
    const nodes = nodesOf(workflow.nodes);
    for (const { node } of nodes.filter(({ node: n }) => typeof n.include === 'string')) {
      if (!inPack.has(node.include)) found.push(`${node.id} includes ${node.include}, which isn't in the pack`);
      if (node.fan_out !== undefined && node.fan_out?.max_parallel !== 1) found.push(`${node.id} runs its block's instances side by side; they share the checkout, so max_parallel is 1`);
      blocks.set(node.include, (blocks.get(node.include) ?? true) && waitsAfter(nodes, node.id));
    }
  }
  for (const { name, text, workflow } of read) {
    const title = workflow.name ?? name;
    const block = blocks.has(workflow.name);
    if (`${workflow.name}.yaml` !== name) found.push(`${name} names its workflow ${workflow.name}; the file and the workflow share one name`);
    if (MODEL_WORDS.test(text)) found.push(`${name} names a model`);
    if (!NOT_LANES.has(workflow.name) && !block && workflow.inputs?.work?.required !== true) found.push(`${title} doesn't take the work input`);
    const nodes = nodesOf(workflow.nodes);
    if (nodes.length === 0) found.push(`${title} has no steps`);
    for (const { node, group } of nodes) {
      if (isAI(node)) found.push(...(READ_ONLY.has(workflow.name) ? readerProblems(node) : aiProblems(node, group, nodes, skillCopies, block && blocks.get(workflow.name))));
      if (READ_ONLY.has(workflow.name) && node.wait !== undefined) found.push(`${node.id} waits, and a read-only workflow can't ask`);
      if (node.loop_group !== undefined && !(Number.isInteger(node.loop_group?.max_iterations) && node.loop_group.max_iterations >= 1)) found.push(`${node.id} is a loop with no max_iterations`);
      const file = promptFileOf(node);
      if (file) used.add(file);
      const body = [node.bash, node.prompt, node.loop?.until_bash, node.loop?.prompt, node.loop_group?.until_bash].filter((part) => typeof part === 'string').join('\n');
      if (OWN_GH.test(body)) found.push(`${node.id} calls a gh other than the broker, or hands one a token`);
      if (VERDICT.test(body)) found.push(`${node.id} posts a review verdict; only the helper does, from a signed review`);
      const script = [node.bash, node.loop?.until_bash, node.loop_group?.until_bash].filter((part) => typeof part === 'string').join('\n');
      if (movesBeforeRelease(script)) found.push(`${node.id} moves the worktree with git before it takes the run's overlay out (order-copy.js --release)`);
    }
  }
  for (const file of used) {
    if (!fs.existsSync(path.join(dir, file))) found.push(`${file} is named by a step but isn't in the pack`);
  }
  let rules = '';
  try { rules = fs.readFileSync(path.join(prompts, 'rules.md'), 'utf8'); } catch { found.push('prompts/rules.md, the shared rules, is missing'); }
  if (rules && !rules.includes(NO_PERSON_LINE)) found.push(`rules.md lacks the no-person line ("${NO_PERSON_LINE}")`);
  if (rules && !rules.includes(LOOP_LINE)) found.push(`rules.md lacks the loop line ("${LOOP_LINE}")`);
  const readOnlyPrompts = new Set(read.filter(({ workflow }) => READ_ONLY.has(workflow.name)).flatMap(({ workflow }) => nodesOf(workflow.nodes).map(({ node }) => promptFileOf(node))));
  const promptFiles = fs.existsSync(prompts) ? fs.readdirSync(prompts).filter((name) => name.endsWith('.md') && name !== 'rules.md').sort() : [];
  for (const name of promptFiles) {
    const text = fs.readFileSync(path.join(prompts, name), 'utf8');
    if (!text.includes(RULES_MARK) && !readOnlyPrompts.has(`prompts/${name}`)) found.push(`prompts/${name} doesn't include the shared rules (${RULES_MARK})`);
    if (MODEL_WORDS.test(text)) found.push(`prompts/${name} names a model`);
    if (VERDICT.test(text)) found.push(`prompts/${name} posts a review verdict; only the helper does, from a signed review`);
  }
  if (MODEL_WORDS.test(rules)) found.push('prompts/rules.md names a model');
  return found;
}

// The sha256 of the pack in `dir`: every file's path and text, in path order, so a change to any one changes it.
export function packDigest(dir = PACK_DIR) {
  const hash = crypto.createHash('sha256');
  for (const file of filesOf(dir)) {
    hash.update(file).update('\0').update(fs.readFileSync(path.join(dir, ...file.split('/')))).update('\0');
  }
  return hash.digest('hex');
}

export function main(argv = process.argv.slice(2), { out = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const dir = argv[0] ? path.resolve(argv[0]) : PACK_DIR;
  const found = checkPack(dir);
  for (const problem of found) out(problem);
  out(found.length === 0 ? `The pack passes its check (digest ${packDigest(dir)}).` : `${found.length} problems in the pack.`);
  return found.length === 0 ? 0 : 1;
}

if (startedAsScript(import.meta.url)) process.exitCode = main();
