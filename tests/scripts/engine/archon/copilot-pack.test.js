// tests/scripts/engine/archon/copilot-pack.test.js
// The pack's Copilot form (Archon design, sections 7.1 and 13): each workflow's twin for a Copilot project, built into
// the same pack tree, so one digest covers both forms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { COPILOT_SUFFIX, SKILLS_STEP, copilotForm, copilotTools, PACK_FORMS } from '../../../../scripts/engine/archon/copilot-pack.js';
import { buildPack, packTreeDigest, PACK_NAME } from '../../../../scripts/engine/pack-build.js';
import { nodesOf } from '../../../../scripts/engine/pack-check.js';
import { tempFolder } from '../../../helpers/homes.js';

const AI = (n) => typeof n.prompt === 'string' || typeof n.command === 'string';

const sample = () => ({
  name: 'wheelhouse-small',
  description: 'The small lane.',
  nodes: [
    { id: 'order', bash: 'node order.js', timeout: 60000 },
    { id: 'plan', depends_on: ['order'], model: 'large', plugins: ['wheelhouse@wheelhouse'], skills: ['wheelhouse:codebase-design'], prompt: 'Plan.' },
    { id: 'tasks', depends_on: ['plan'], include: 'wheelhouse-small-task', fan_out: { items: '$plan.output', as: 'task' } },
    {
      id: 'loop', depends_on: ['tasks'], model: 'medium',
      loop_group: { max_iterations: 3, nodes: [{ id: 'build', plugins: ['wheelhouse@wheelhouse'], skills: ['wheelhouse:pr'], prompt: 'Build.' }] },
    },
    { id: 'review', depends_on: ['loop'], model: 'medium', denied_tools: ['Write', 'Edit', 'NotebookEdit'], prompt: 'Review.' },
    { id: 'side', bash: 'true' },
  ],
});

test('the twin is named for Copilot, names every skill plainly and loads no plugins', () => {
  const twin = copilotForm(sample());
  assert.equal(twin.name, `wheelhouse-small${COPILOT_SUFFIX}`);
  const all = nodesOf(twin.nodes).map((n) => n.node ?? n);
  for (const node of all) {
    assert.equal(node.plugins, undefined, `${node.id} loads no plugins`);
    for (const skill of node.skills ?? []) assert.doesNotMatch(skill, /:/);
  }
  const plan = twin.nodes.find((n) => n.id === 'plan');
  assert.deepEqual(plan.skills, ['codebase-design']);
  assert.deepEqual(twin.nodes.find((n) => n.id === 'loop').loop_group.nodes[0].skills, ['pr']);
});

test('every step that asks a model runs on Copilot; a script step is left as it was', () => {
  const twin = copilotForm(sample());
  for (const node of nodesOf(twin.nodes).map((n) => n.node ?? n)) {
    if (AI(node) || node.loop_group) assert.equal(node.provider, 'copilot', node.id);
    else assert.equal(node.provider, undefined, node.id);
  }
  // No model is named: the tier stays, and the routing table binds it.
  assert.equal(twin.nodes.find((n) => n.id === 'plan').model, 'large');
});

test('the included workflow is the Copilot twin too', () => {
  assert.equal(copilotForm(sample()).nodes.find((n) => n.id === 'tasks').include, `wheelhouse-small-task${COPILOT_SUFFIX}`);
});

test('the tool rules name Copilot\'s tools', () => {
  const review = copilotForm(sample()).nodes.find((n) => n.id === 'review');
  assert.deepEqual(review.denied_tools, ['apply_patch', 'edit', 'create']);
  assert.deepEqual(copilotTools(['Read', 'Bash']), ['view', 'bash', 'powershell']);
  assert.throws(() => copilotTools(['Teleport']), /Teleport/);
});

test('a first step writes the skills the workflow names into the worktree, and every other first step waits on it', () => {
  const twin = copilotForm(sample());
  const first = twin.nodes[0];
  assert.equal(first.id, SKILLS_STEP);
  assert.match(first.bash, /scripts\/engine\/archon\/copilot-skills\.js" --names codebase-design,pr$/);
  for (const node of twin.nodes.slice(1)) {
    if (!sample().nodes.find((n) => n.id === node.id).depends_on) assert.deepEqual(node.depends_on, [SKILLS_STEP], node.id);
  }
  assert.deepEqual(twin.nodes.find((n) => n.id === 'plan').depends_on, ['order']);
  // A workflow that names no skill gets no such step.
  const bare = copilotForm({ name: 'w', nodes: [{ id: 'a', prompt: 'x' }] });
  assert.deepEqual(bare.nodes.map((n) => n.id), ['a']);
});

test('the form leaves its input as it was', () => {
  const input = sample();
  const copy = structuredClone(input);
  copilotForm(input);
  assert.deepEqual(input, copy);
});

test('the pack builds each workflow and its Copilot twin into one tree, under one digest', () => {
  const out = tempFolder('wh-pack-');
  const plain = tempFolder('wh-pack-');
  const built = buildPack({ out, forms: PACK_FORMS });
  const only = buildPack({ out: plain });
  for (const name of only.workflows) {
    assert.ok(built.workflows.includes(name));
    assert.ok(built.workflows.includes(`${name}${COPILOT_SUFFIX}`), `${name} has its twin`);
    assert.ok(fs.existsSync(path.join(out, '.archon', 'workflows', PACK_NAME, `${name}${COPILOT_SUFFIX}`, `${name}${COPILOT_SUFFIX}.yaml`)));
  }
  assert.equal(built.digest, packTreeDigest(out));
  assert.notEqual(built.digest, only.digest);
  // Every twin's step either runs a script or runs on Copilot, and names no skill with the plugin's prefix.
  for (const name of built.workflows.filter((w) => w.endsWith(COPILOT_SUFFIX))) {
    const wf = JSON.parse(fs.readFileSync(path.join(out, '.archon', 'workflows', PACK_NAME, name, `${name}.yaml`), 'utf8').replace(/^#[^\n]*\n/, ''));
    for (const { node } of nodesOf(wf.nodes)) {
      assert.equal(node.plugins, undefined);
      if (AI(node)) assert.equal(node.provider, 'copilot', `${name}/${node.id}`);
      for (const skill of node.skills ?? []) assert.doesNotMatch(skill, /^wheelhouse:/);
    }
  }
});
