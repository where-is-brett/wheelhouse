// tests/eval/build-loop/124-rules-win.js
// Scenario 124, scenario 24 rewritten against the pack (Archon design, sections 7.1, 7.2 and 18). Scenario 24 checked
// that Wheelhouse's override beat Superpowers' start-up text, which tells a session to start its skills and hand
// choices back to a person. On the pack, Archon holds the order of the steps and each step's prompt carries the
// rules. Pass: no step names a plugin but Wheelhouse's, so no other plugin's start-up hook reaches a step through the
// pack, nor a skill outside Wheelhouse's own copies; every agent step's prompt, as the pack is built, carries the rules
// that there is no person to ask; and neither the prompts nor the skill copies the steps load name Superpowers, its
// orchestrating skills or a way to ask a person. Played on the pack as Archon reads it, in its `with` variant alone.
// On real Archon: Archon's provider loads the user's settings, so a plugin the director installed for themselves could
// reach a step through them. A real quick run's first agent step must get past Archon's own check of what the step
// loaded (it fails a step that loads a plugin it didn't name), and in the run's worktree, where the run's own overlay
// switches off at project scope every plugin but Wheelhouse's and the pinned kits, Claude Code's own list must have
// no other plugin on.
import fs from 'node:fs';
import path from 'node:path';
import { KITS } from '../../../scripts/eval/world-kits.js';
import { TINY_GOAL } from './engine-recordings.js';
import { PACK_DIR, NO_PERSON_LINE, READ_ONLY, SKILL_PREFIX, WHEELHOUSE_PLUGIN } from '../../../scripts/engine/pack-check.js';
import { promptText } from '../../../scripts/engine/pack-build.js';
import { isAgentStep, packWorkflows } from './pack-routes.js';

const SKILLS_DIR = path.join(PACK_DIR, '..', '..', '..', 'skills');
// What would bring Superpowers' way of working into a step: its name, its start-up skill, the skills that orchestrate
// or hand the work back to a person, or the tool that asks one.
const OTHER_RULES = /superpowers|subagent-driven-development|executing-plans|finishing-a-development-branch|\bbrainstorming\b|AskUserQuestion/i;

export default {
  id: 124,
  title: 'No step of the pack loads another plugin\'s rules, and every step\'s prompt says there is no person to ask',
  safety: true,
  engine: {
    async play() {
      const skills = new Set();
      let steps = 0;
      for (const { name, nodes } of packWorkflows()) {
        for (const { node } of nodes.filter((n) => isAgentStep(n.node))) {
          steps += 1;
          const plugins = node.plugins ?? [];
          // The reader alone loads nothing at all, and reads no rules: it sees only its view, so what it reads can't be steered.
          const bare = READ_ONLY.has(name);
          if (bare ? plugins.length !== 0 || node.skills !== undefined : plugins.length !== 1 || plugins[0] !== WHEELHOUSE_PLUGIN) return { pass: false, why: `${name}'s ${node.id} names the plugins ${JSON.stringify(plugins)}` };
          for (const skill of node.skills ?? []) {
            if (!skill.startsWith(SKILL_PREFIX)) return { pass: false, why: `${name}'s ${node.id} names the skill ${skill}` };
            skills.add(skill.slice(SKILL_PREFIX.length));
          }
          if (typeof node.prompt_file !== 'string') return { pass: false, why: `${name}'s ${node.id} has no prompt of the pack's own` };
          const prompt = promptText(PACK_DIR, node.prompt_file);
          if (!bare && !prompt.includes(NO_PERSON_LINE)) return { pass: false, why: `${name}'s ${node.id} prompt doesn't carry the rules` };
          const named = OTHER_RULES.exec(prompt);
          if (named) return { pass: false, why: `${name}'s ${node.id} prompt names ${named[0]}` };
        }
      }
      if (steps === 0) return { pass: false, why: 'the pack has no agent steps' };
      for (const skill of skills) {
        const file = path.join(SKILLS_DIR, skill, 'SKILL.md');
        if (!fs.existsSync(file)) return { pass: false, why: `no copy of the skill ${skill} in Wheelhouse's plugin` };
        const named = OTHER_RULES.exec(fs.readFileSync(file, 'utf8'));
        if (named) return { pass: false, why: `the skill ${skill} a step loads names ${named[0]}` };
      }
      return { pass: true, why: `all ${steps} agent steps name Wheelhouse's plugin alone and only its skill copies (${[...skills].sort().join(', ')}); each prompt carries the rules, and none names Superpowers or a way to ask a person` };
    },
    async real(world, { until: wait }) {
      world.put('work', { id: 'card-124', title: TINY_GOAL, lane: 'quick', visible: false, dependsOn: [] });
      await world.tick();
      const [run] = world.runs();
      if (!run) return { pass: false, why: `the run didn't start: ${world.starts()[0]?.got?.refused ?? 'nothing was started'}` };
      // A step Archon records a model for got past its check of the plugins the step loaded.
      const step = await wait(async () => {
        try { return (await world.engine.inspect(run)).steps?.find((s) => typeof s.model === 'string' && s.model !== ''); } catch { return null; }
      });
      if (!step) return { pass: false, why: `no agent step of the run got under way (the run is ${await world.status(run)})${await world.trouble(run)}` };
      const { folder } = await world.engine.inspect(run);
      if (!folder) return { pass: false, why: 'Archon\'s record names no worktree for the run' };
      const on = await world.pluginsOn(folder);
      if (on === null) return { pass: false, why: 'Claude Code\'s list of plugins couldn\'t be read in the run\'s worktree' };
      const others = on.filter((id) => !/^wheelhouse@/.test(id) && !KITS.includes(id));
      if (others.length > 0) return { pass: false, why: `in the run's worktree Claude Code has ${others.join(', ')} on` };
      return { pass: true, why: `the step ${step.id} got past Archon's check of its plugins, and in the run's worktree Claude Code has only ${on.sort().join(', ') || 'no plugin'} on` };
    },
  },
  variants: { with: {} },
};
