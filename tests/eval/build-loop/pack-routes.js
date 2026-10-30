// tests/eval/build-loop/pack-routes.js
// What the rewrites of 20 to 35 (120 to 134) play the pack's own steps against: the helper's real engine routes over a
// run whose record (Archon's events) the scenario gives, and the pack's workflows as Archon reads them. Not a scenario
// file: it has no number.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { engineRoutes } from '../../../scripts/engine/routes.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { readOutputs } from '../../../scripts/engine/archon/record.js';
import { PACK_DIR, nodesOf, readWorkflow } from '../../../scripts/engine/pack-check.js';
import { ticketedRoutes } from '../../helpers/engine-tickets.js';

const DIGEST = 'd'.repeat(64);

// A step as Archon's record has it: its name (a loop body's is `<group>.<step>`) and its output.
export const done = (step, output) => ({ event_type: 'node_completed', step_name: step, data: { node_output: typeof output === 'string' ? output : JSON.stringify(output) } });
export const review = (verdict, findings = []) => ({ verdict, findings, summary: 'Read it.', blocked: false, assumptions: [] });
export const lensesAt = (head) => ({ security: false, design: false, head, clean: true });
export const opened = (pr, head, branch = 'wh/work') => done('open-pr', { branch, pr, head });

// packRoutes({ work, lane, events, host }) -> { routes, posted, written, handed, client, start(), close() }. `events()`
// gives the run's record as it stands when a route reads it; `host` stands in for the code host the helper pushes to.
// `handed` keeps each pull request the helper handed to the merge queue.
export function packRoutes({ work = 'work', lane = 'small', events = () => [], host } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-pack-routes-'));
  const runId = `run-${work}`;
  const posted = [];
  const written = [];
  const handed = [];
  const engine = {
    name: 'archon',
    artefactsOf: (id) => path.join(dir, 'art', id),
    start: async () => ({ ok: true, runId, branch: `wh/${work}` }),
    inspect: async () => ({ status: 'running', source: path.join(dir, 'capture') }),
    outputs: async () => readOutputs({ events: events() }),
    handOver: async ({ pr }) => { handed.push(pr); return { ok: true }; },
  };
  const made = engineRoutes({
    projects: () => [{ project: 'p', folder: path.join(dir, 'project') }],
    engineFor: () => engine,
    ordersDir: () => path.join(dir, 'orders'),
    filesDir: () => path.join(dir, 'engine'),
    write: async (project, kind, data) => { written.push({ kind, data }); },
    digests: { installed: () => DIGEST, captured: (root) => (root === path.join(dir, 'capture') ? DIGEST : null) },
    comment: async (project, c) => { posted.push(c); return { id: posted.length }; },
    host,
    provenance: async () => {},
  });
  const { routes } = ticketedRoutes(made, engine, undefined);
  // The helper's client as the pack's scripts call it.
  const client = { engine: Object.fromEntries([['review', '/engine/review'], ['openPr', '/engine/open-pr'], ['ready', '/engine/ready']].map(([name, route]) => [name, (body) => routes[route](body)])) };
  return {
    runId,
    routes,
    posted,
    written,
    handed,
    client,
    start: () => routes['/engine/start']({ project: 'p', order: workOrder({ work: { id: work, lane, goal: 'A goal', done: [{ test: 'x' }] } }) }),
    close: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

// Every workflow of the pack: { name, nodes: [{ node, group }] }, loop bodies included.
export function packWorkflows(dir = PACK_DIR) {
  return fs.readdirSync(dir).filter((n) => n.endsWith('.yaml')).sort().map((file) => {
    const workflow = readWorkflow(fs.readFileSync(path.join(dir, file), 'utf8'));
    return { name: workflow.name, workflow, nodes: nodesOf(workflow.nodes) };
  });
}

// Whether a node is a step an agent runs.
export const isAgentStep = (node) => ['prompt', 'prompt_file', 'command', 'loop'].some((key) => node[key] !== undefined);

// What a script prints as its last line, read as JSON, and its exit code.
export async function said(main, argv, options = {}) {
  const lines = [];
  const code = await main(argv, { ...options, out: (line) => lines.push(line) });
  let got = null;
  try { got = JSON.parse(lines.at(-1)); } catch { got = null; }
  return { code, got, lines };
}
