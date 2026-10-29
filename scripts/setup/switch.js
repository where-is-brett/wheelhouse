// scripts/setup/switch.js
// The switch to the new engine for a project set up before v0.2.0 (Archon design, section 17, step 2). A project set
// up from v0.2.0 on the Mac starts on the new engine (step 4's writes). One set up before is offered the switch once,
// at the director's next visit: the `engine` setting's own confirm card, level 3, its one option recommended, so the
// click is signed and counted as every setting's is. Confirm moves new quick work to the new engine; a piece the old
// engine started finishes there (scripts/engine/lanes.js).
//
// It is offered only where the switch can work: on the Mac, with the engine installed on this computer, on GitHub,
// and with the merge queue's policy file already in the project (a new setup's commit puts it there). A project set
// up before gets that file by a pull request of its own, which isn't built yet; until then it isn't offered.
import fs from 'node:fs';
import path from 'node:path';
import { effectiveSettings } from '../settings/effective.js';
import { SETTINGS } from '../settings/catalogue.js';
import { POLICY_FILE, engineInstalled, engineWanted } from './engine-parts.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The setting the card confirms, with learning's one-line reason, which the card gives.
export const SWITCH_SETTING = Object.freeze({
  key: 'engine',
  value: 'archon',
  because: 'new quick changes are then built by the new engine, Archon, and work already under way finishes as it is',
});

// switchDue({ settings, unconfirmed, cards, record, folder, platform, installed }) -> boolean
//   settings     the project's settings view; unconfirmed its proposals not yet confirmed
//   cards        the project's card events' data, to see an earlier switch card by its confirm line
//   record       the project's registered record ({ host, ... })
// Whether the switch card is offered now: the project has never had an engine chosen (none in force, none proposed,
// no switch card before), and the switch can work here.
export function switchDue({ settings = {}, unconfirmed = [], cards = [], record = null, folder, platform = process.platform, installed = () => engineInstalled() } = {}) {
  if (isPlain(settings) && Object.hasOwn(settings, 'engine')) return false;
  if (effectiveSettings({ project: isPlain(settings) ? settings : {}, now: new Date() }).engine?.value === 'archon') return false;
  if ((Array.isArray(unconfirmed) ? unconfirmed : []).some((u) => u?.kind === 'setting' && u?.data?.key === 'engine')) return false;
  if ((Array.isArray(cards) ? cards : []).some((c) => typeof c?.line === 'string' && c.line.includes(`"${SETTINGS.engine.label}:`))) return false;
  if (!engineWanted({ platform }) || record?.host !== 'github' || typeof folder !== 'string') return false;
  if (!fs.existsSync(path.join(folder, ...POLICY_FILE.split('/')))) return false;
  return installed() === true;
}
