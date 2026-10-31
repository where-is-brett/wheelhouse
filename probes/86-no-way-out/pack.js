// probes/86-no-way-out/pack.js
// Check 86 (D2), the pack reading: every AI node in the built pack and the tools it can reach. A node is an AI node
// when it has a prompt or a prompt file (a loop group's own steps are walked; the group itself is not a node);
// its tools are what it does not deny. Nothing runs at import.
//
//   node probes/86-no-way-out/pack.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PACK = path.join(HERE, '..', '..', 'engine', 'archon', 'pack');

// Every node, however deeply a loop or a group nests it, with the workflow it sits in.
export function* walk(nodes, workflow, parents = []) {
  for (const node of nodes ?? []) {
    yield { workflow, node, parents };
    for (const key of ['nodes', 'loop_group']) {
      const inner = Array.isArray(node[key]) ? node[key] : Array.isArray(node[key]?.nodes) ? node[key].nodes : null;
      if (inner) yield* walk(inner, workflow, [...parents, node.id]);
    }
  }
}

export const isAi = (node) => Boolean(node.prompt || node.prompt_file);

export function readPack(dir = PACK) {
  const rows = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort()) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8').replace(/^#.*\n/, ''));
    for (const { workflow, node, parents } of walk(doc.nodes, doc.name)) {
      if (!isAi(node)) continue;
      rows.push({
        workflow, id: [...parents, node.id].join('/'), model: node.model ?? null,
        allowed: node.allowed_tools ?? null, denied: node.denied_tools ?? [],
        mcp: node.mcp ?? null, promptFile: node.prompt_file ?? null,
        askTool: !(node.allowed_tools && !node.allowed_tools.includes('AskUserQuestion')) && !(node.denied_tools ?? []).includes('AskUserQuestion'),
      });
    }
  }
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rows = readPack();
  console.log(JSON.stringify(rows, null, 1));
  console.log(`${rows.length} AI nodes; ${rows.filter((r) => r.askTool).length} not shut off from AskUserQuestion by the pack`);
}
