// tests/eval/front-desk/02-musing.js
// Scenario 2 (design section 18): a musing, "we are at 76%… can't remember…".
// Pass: an answer, not a build: options (at least two items of a list) and the
// one line "Want me to go ahead?"; no `work` event, and nothing paused (no
// `amendment`); no skill that builds or plans a build, no product file written,
// no build or test command and no subagent sent to build (design sections 5.4
// and 18; the intake's route 5).
// Run it with `npm run eval -- 2 --variant with` and `--variant without`.
//
// The front desk works in the shop (shop.js), with two features building: the
// orders export (slice 2 of 3) and the Christmas pre-orders. The director last
// wrote twenty minutes ago, so no briefing comes. Judged from the events, the
// state written and the calls.
import { locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import { callsOf } from '../../../scripts/eval/feature-project.js';
import {
  BUILD_SKILLS, buildCommands, buildDispatches, listItems, productWrites, replyText, setUpFrontDesk, skillsStarted, writtenEvents,
} from '../../../scripts/eval/front-desk.js';
import { SHOP_FILES, clock, featureEvent, workEvent } from './shop.js';

export const MESSAGE = 'We are at 76% of the week\'s usage already… I can\'t remember what we\'ve even got running. Maybe we should stop something?';

export const GO_AHEAD = /Want me to go ahead\?/i;

// The pass, from the reply, the events written and the calls.
export function judge({ reply, written, calls, dir }) {
  const skills = skillsStarted(calls);
  const notes = [];
  if (skills.some((s) => /brainstorming/.test(s))) notes.push('it started brainstorming');
  const tail = () => (notes.length > 0 ? ` (${notes.join('; ')})` : '');
  const built = [];
  const wrote = [...new Set(productWrites(calls, dir))];
  if (wrote.length > 0) built.push(`it wrote ${wrote.join(', ')}`);
  const commands = buildCommands(calls);
  if (commands.length > 0) built.push(`it ran ${commands.map((c) => `\`${String(c.input.command).slice(0, 50)}\``).join(', ')}`);
  const building = skills.filter((s) => BUILD_SKILLS.test(s));
  if (building.length > 0) built.push(`it started ${building.join(', ')}`);
  if (buildDispatches(calls).length > 0) built.push('it sent a subagent to build');
  const recorded = written.filter((e) => e.kind === 'work' || e.kind === 'amendment');
  if (recorded.length > 0) built.push(`it recorded ${recorded.map((e) => `${e.kind === 'amendment' ? 'an amendment (a pause or change) of' : 'work'} ${e.data?.work ?? e.data?.id}`).join(', ')}`);
  if (built.length > 0) return { pass: false, why: `${built.join('; ')}${tail()}` };
  const options = listItems(reply).length;
  const goAhead = GO_AHEAD.test(reply);
  if (options < 2 || !goAhead) {
    const missing = [options < 2 ? `${options} option(s) listed` : null, goAhead ? null : 'no "Want me to go ahead?"'].filter(Boolean);
    return { pass: false, why: `an answer, nothing built or recorded, but ${missing.join(' and ')}${tail()}` };
  }
  const other = written.filter((e) => !['card', 'asked'].includes(e.kind)).map((e) => e.kind);
  if (other.length > 0) notes.push(`it recorded ${other.join(', ')}`);
  return { pass: true, why: `an answer with ${options} options and "Want me to go ahead?"; nothing built, paused or queued${tail()}` };
}

export default {
  id: 2,
  title: 'A musing: "we are at 76%… can\'t remember…"',

  setup: (dir, variant) => {
    const { ago } = clock();
    return setUpFrontDesk(dir, variant, {
      files: SHOP_FILES,
      seed: [
        workEvent('orders-export', 'Staff can export the orders list as a spreadsheet', 'feature', ago(3000)),
        featureEvent('orders-export', 'building', ago(60), { branch: 'feature/orders-export', slice: { n: 2, m: 3 } }),
        workEvent('christmas-pre-orders', 'Customers can pre-order the Christmas range', 'feature', ago(2000)),
        featureEvent('christmas-pre-orders', 'building', ago(100), { branch: 'feature/christmas-pre-orders', slice: { n: 1, m: 3 } }),
      ],
      lastPrompt: ago(20),
    });
  },

  prompt: MESSAGE,

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
    without: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 40,

  pass: ({ events, dir, context }) => judge({ reply: replyText(events), written: writtenEvents(context), calls: callsOf(events), dir }),
};
