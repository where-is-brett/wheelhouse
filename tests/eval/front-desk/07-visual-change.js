// tests/eval/front-desk/07-visual-change.js
// Scenario 7 (design section 18): a one-line visual change, "make the button
// blue". Pass: the small-feature lane said (and any work recorded is in the
// small lane), and a preview offered before any build: Matt's prototype skill
// started, a sentence of the reply offering the director a look first
// (previewOffered in scripts/eval/front-desk.js), or an approve-work card
// recorded that shows it to them before it merges; and nothing built: no
// product file written (a page or a style included), no build or test command,
// no skill that builds and no subagent sent to build (design sections 7.2, 7.3).
// A file written once the prototype skill has started is its throwaway preview,
// which the intake asks for beside the route (build-loop design, section 3), and
// is named, not counted as a build.
// Nothing writes `pages` yet, so no screenshot is compared (ruling for Task 13b).
// Run it with `npm run eval -- 7 --variant with` and `--variant without`.
//
// The front desk works in the shop (shop.js), whose order page has one button,
// green. One session over three of the director's turns: the request, then two
// answers to brainstorming's questions, so its sizing is done before the pass
// is judged (ruling F92: brainstorming shapes and sizes, and the lane follows).
// The second answer leaves the blue to choose (ruling F95), so a choice is still
// to make and the small lane stays the right call.
// Judged from every turn's replies, the state written and the calls.
import { locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import { callsOf } from '../../../scripts/eval/feature-project.js';
import {
  BUILD_SKILLS, buildCommands, buildDispatches, cardsRecorded, howAsked, laneSaid, previewOffered, productWrites, replyText, setUpFrontDesk,
  skillsStarted, writtenEvents,
} from '../../../scripts/eval/front-desk.js';
import { SHOP_FILES, clock } from './shop.js';

export const MESSAGE = 'Make the order button blue.';
export const PROMPTS = [
  MESSAGE,
  'Pick the blue you think fits our new logo. Nothing else on the page changes.',
  'That\'s everything I can tell you. Please size it and take it from here.',
];

// The end of an approve-work card's line when the director is to see the change before it merges.
const SHOWN_FIRST = /, and show it to me before it merges$/;

// What the session built, each in words: product files written, build commands, building skills, builders sent.
export function builtBy(calls, dir) {
  const built = [];
  const wrote = [...new Set(productWrites(calls, dir))];
  if (wrote.length > 0) built.push(`it wrote ${wrote.join(', ')}`);
  const commands = buildCommands(calls);
  if (commands.length > 0) built.push(`it ran ${commands.map((c) => `\`${String(c.input.command).slice(0, 50)}\``).join(', ')}`);
  const building = skillsStarted(calls).filter((s) => BUILD_SKILLS.test(s));
  if (building.length > 0) built.push(`it started ${building.join(', ')}`);
  if (buildDispatches(calls).length > 0) built.push('it sent a subagent to build');
  return built;
}

// How a preview was offered, or null.
export function howShownFirst({ reply, events, written, calls }) {
  if (skillsStarted(calls).some((s) => /prototype/.test(s))) return 'it started the prototype skill';
  if (previewOffered(reply)) return 'its reply offered a look first';
  const card = cardsRecorded(written).find((c) => c.kind === 'approve-work' && SHOWN_FIRST.test(String(c.line ?? '')));
  if (card !== undefined && howAsked(events, card) !== null) return 'an approve-work card shows it before it merges';
  return null;
}

// The pass, from the reply, the events, the events written and the calls.
export function judge({ reply, events = [], written, calls, dir }) {
  const from = calls.findIndex((call) => call.name === 'Skill' && /prototype/.test(String(call.input.skill ?? '')));
  const before = from === -1 ? calls : calls.slice(0, from);
  const built = builtBy(before, dir);
  if (built.length > 0) return { pass: false, why: built.join('; ') };
  const preview = from === -1 ? [] : [...new Set(productWrites(calls.slice(from), dir))];
  const works = written.filter((e) => e.kind === 'work');
  const lanes = [...new Set(works.map((e) => e.data?.lane))];
  const said = laneSaid(reply, 'small');
  const shown = howShownFirst({ reply, events, written, calls });
  const recorded = `${works.length > 0 ? `; work recorded in the ${lanes.join(', ')} lane` : '; no work recorded'}${preview.length > 0 ? `; the prototype wrote ${preview.join(', ')}` : ''}`;
  if (lanes.some((lane) => lane !== 'small')) return { pass: false, why: `nothing built, but the work went in the ${lanes.join(', ')} lane${shown ? `; ${shown}` : ''}` };
  if (!said) return { pass: false, why: `nothing built, but no small-feature lane said${shown ? `; ${shown}` : ''}${recorded}` };
  if (shown === null) return { pass: false, why: `the small-feature lane said and nothing built, but no preview offered${recorded}` };
  return { pass: true, why: `the small-feature lane said, ${shown}, and nothing built${recorded}` };
}

export default {
  id: 7,
  title: 'A one-line visual change',

  setup: (dir, variant) => {
    const { ago } = clock();
    return setUpFrontDesk(dir, variant, { files: SHOP_FILES, lastPrompt: ago(20) });
  },

  prompts: PROMPTS,

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
    without: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 40,

  pass: ({ events, turns, dir, context }) => (turns && turns.length < PROMPTS.length
    ? { pass: false, why: `did not count: ${turns.length} of ${PROMPTS.length} turns ran` }
    : judge({ reply: replyText(events), events, written: writtenEvents(context), calls: callsOf(events), dir })),
};
