// scripts/engine/switch.js
// The switch to the new engine for a project set up before v0.2.0 (Archon design, section 17, step 2). A project set
// up from v0.2.0 on the Mac starts on the new engine (step 4's writes). One set up before is offered the switch once,
// at the director's next visit: the `engine` setting's own confirm card, level 3, its one option recommended, so the
// click is signed and counted as every setting's is.
//
// Confirming it doesn't move any work yet. The project needs the merge queue's policy file and Archon's settings on
// its default branch first (spec 14.3), so the helper opens a pull request that adds them (scripts/engine/switch-pr.js)
// and merges it through its own gate once the director approves it. The engine is on for the project only when it can
// read the project: its fetch-mirror rule is in the engine folder's list, which a new setup writes in step 7 and the
// switch writes once its pull request has merged (engineReady). Until then the old engine builds everything, and a
// piece the old engine started finishes there after (scripts/engine/lanes.js).
//
// It is offered only where the switch can work: on the Mac, with the engine installed on this computer, and on GitHub.
import fs from 'node:fs';
import { effectiveSettings } from '../settings/effective.js';
import { SETTINGS } from '../settings/catalogue.js';
import { engineDir } from '../lib/paths.js';
import { engineInstalled, engineWanted, mirrorRulesFile } from './parts.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The setting the card confirms, with learning's one-line reason, which the card gives.
export const SWITCH_SETTING = Object.freeze({
  key: 'engine',
  value: 'archon',
  because: 'new quick changes are then built by the new engine, Archon, once you approve the pull request that adds its files, and work already under way finishes as it is',
});

// The switch's pull request: its branch, named for the default branch's commit it is made on, so a switch made again
// after one was closed gets a branch of its own; and the work its approval card names.
export const SWITCH_BRANCH = /^wheelhouse-engine-switch-[0-9a-f]{12}$/;
export const switchBranch = (base) => `wheelhouse-engine-switch-${String(base).slice(0, 12)}`;
export const SWITCH_WORK = 'engine-switch';
export const SWITCH_NAME = 'the switch to the new build engine';

// Whether the new engine can build `project`: its fetch-mirror rule is in the engine folder's list.
export function engineReady(project, { engine = engineDir() } = {}) {
  let rules;
  try { rules = JSON.parse(fs.readFileSync(mirrorRulesFile(engine), 'utf8')); } catch { return false; }
  return isPlain(rules) && typeof project === 'string' && typeof rules[project] === 'string' && /^https:\/\/\S+$/.test(rules[project]);
}

// switchDue({ settings, unconfirmed, cards, record, platform, installed }) -> boolean
//   settings     the project's settings view; unconfirmed its proposals not yet confirmed
//   cards        the project's card events' data, to see an earlier switch card by its confirm line
//   record       the project's registered record ({ host, ... })
// Whether the switch card is offered now: the project has never had an engine chosen (none in force, none proposed,
// no switch card before), and the switch can work here.
export function switchDue({ settings = {}, unconfirmed = [], cards = [], record = null, platform = process.platform, installed = () => engineInstalled() } = {}) {
  if (isPlain(settings) && Object.hasOwn(settings, 'engine')) return false;
  if (effectiveSettings({ project: isPlain(settings) ? settings : {}, now: new Date() }).engine?.value === 'archon') return false;
  if ((Array.isArray(unconfirmed) ? unconfirmed : []).some((u) => u?.kind === 'setting' && u?.data?.key === 'engine')) return false;
  if ((Array.isArray(cards) ? cards : []).some((c) => typeof c?.line === 'string' && c.line.includes(`"${SETTINGS.engine.label}:`))) return false;
  if (!engineWanted({ platform }) || record?.host !== 'github') return false;
  return installed() === true;
}

// Whether the project's `engine` setting in force is Archon, for the settings view given.
export function engineChosen(settingsView, { now = new Date() } = {}) {
  return effectiveSettings({ project: isPlain(settingsView) ? settingsView : {}, now }).engine?.value === 'archon';
}
