// scripts/engine/pack-build.js
// Builds the workflow pack into the folder Archon reads with --workflow-source (Archon design, section 7.1): each
// workflow goes to .archon/workflows/wheelhouse/<name>/<name>.yaml, with each step's prompt file read in place of its
// prompt_file and the shared rules put where the prompt says {{rules}}. Claude's form of skill names is the pack's own
// (wheelhouse:<skill>), so the build writes the workflows as they are; another provider's form is its adapter's, given
// to the build as `forms`: each form turns a built workflow into its twin, written into the same tree under the twin's
// own name, so the one digest covers every form.
// A pack that fails its check is never built.
//   node scripts/engine/pack-build.js --out <folder>
import fs from 'node:fs';
import path from 'node:path';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';
import { PACK_DIR, RULES_MARK, checkPack, packDigest, readWorkflow } from './pack-check.js';

export const PACK_NAME = 'wheelhouse';

// A prompt file's text for a step: its path comment taken off, and the shared rules put in.
export function promptText(dir, file) {
  const strip = (text) => text.replace(/^<!--[^\n]*-->\r?\n/, '').trim();
  const rules = strip(fs.readFileSync(path.join(dir, 'prompts', 'rules.md'), 'utf8'));
  return strip(fs.readFileSync(path.join(dir, ...file.split('/')), 'utf8')).replace(RULES_MARK, rules);
}

// One workflow as Archon reads it: each prompt_file replaced by its prompt, in loop groups' bodies too.
export function builtWorkflow(dir, workflow) {
  const built = (nodes) => nodes.map((node) => {
    const copy = structuredClone(node);
    if (copy.prompt_file) {
      copy.prompt = promptText(dir, copy.prompt_file);
      delete copy.prompt_file;
    }
    if (Array.isArray(copy.loop_group?.nodes)) copy.loop_group.nodes = built(copy.loop_group.nodes);
    return copy;
  });
  return { ...workflow, nodes: built(workflow.nodes) };
}

// The digest of Wheelhouse's workflows in a folder laid out as --workflow-source reads it (a build's `out`, or the
// `project` folder of the source Archon froze for a run), or null when there are none there.
export function packTreeDigest(dir) {
  const tree = path.join(dir, '.archon', 'workflows', PACK_NAME);
  return fs.existsSync(tree) ? packDigest(tree) : null;
}

// Builds the pack in `dir` into `out`, with each of `forms`' twins, replacing what a build left there before. Returns
// { digest, workflows } or throws with the check's problems.
export function buildPack({ dir = PACK_DIR, out, skillCopies, forms = [] } = {}) {
  if (!out || !path.isAbsolute(out)) throw new Error('The pack is built into an absolute folder');
  const problems = checkPack(dir, skillCopies ? { skillCopies } : {});
  if (problems.length > 0) throw new Error(`The pack fails its check:\n${problems.join('\n')}`);
  const root = path.join(out, '.archon', 'workflows', PACK_NAME);
  fs.rmSync(path.join(out, '.archon'), { recursive: true, force: true });
  const workflows = [];
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.yaml')).sort()) {
    const own = builtWorkflow(dir, readWorkflow(fs.readFileSync(path.join(dir, name), 'utf8')));
    for (const workflow of [own, ...forms.map((form) => form(own))]) {
      const folder = path.join(root, workflow.name);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, `${workflow.name}.yaml`), `${JSON.stringify(workflow, null, 2)}\n`);
      workflows.push(workflow.name);
    }
  }
  return { digest: packTreeDigest(out), workflows };
}

export function main(argv = process.argv.slice(2), { out = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const folder = runArg(argv, '--out');
  if (!folder) {
    out('usage: node scripts/engine/pack-build.js --out <folder>');
    return 2;
  }
  try {
    const built = buildPack({ out: path.resolve(folder) });
    out(`Built ${built.workflows.join(', ')} (digest ${built.digest}).`);
    return 0;
  } catch (error) {
    out(error.message);
    return 1;
  }
}

if (startedAsScript(import.meta.url)) process.exitCode = main();
