// tests/eval/build-loop/27-front-desk-route.js
// Scenario 27's route leg (design sections 3, 5.3 and 15): the front desk gets
// a plain bug report. Pass: it says the route as a bug (route 4); it records a
// `work` event in the `bug` lane naming the report as written down (a document
// in the project, by its path and its hash as the file stands); and it neither
// reads the product's code hunting for the cause nor changes any, nor starts
// brainstorming. The bug session's leg is 27-bug-route.js; 27 passes only when
// both legs do. Run this leg alone with `npm run eval -- 27-route --variant with`
// and `--variant without` (its records are named 27-route-…).
//
// The project is the bug session's (27-bug-route.js): `formatDuration(seconds)`
// in duration.js, which shows a 65-second clip as "1:5", and its tests. The
// front desk works in its main checkout; its state holds one piece of open
// work, unrelated. Judged from the events the session wrote, its calls and its
// files.
import { locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import { callsOf } from '../../../scripts/eval/feature-project.js';
import {
  codeReads, codeWrites, hashOfFile, replyText, seedEvent, setUpFrontDesk, skillsStarted, writtenEvents,
} from '../../../scripts/eval/front-desk.js';
import { files } from './27-bug-route.js';

const README = `# Clips

Short videos, each shown on a card with its title and its length.

- \`duration.js\`: the length shown on a video's card.
`;

export const MESSAGE = 'A customer says the length on a video\'s card is wrong: a 65-second clip shows as 1:5.';

export const BUG = /\bbug\b|route\s*4/i;

// The pass, from the reply, the events written, the calls and the files.
export function judge({ reply, written, calls, dir, variant }) {
  const notes = [];
  const skills = skillsStarted(calls);
  if (variant === 'with') notes.push(skills.some((s) => /intake/.test(s)) ? 'it started the intake' : 'it did not start the intake');
  const tail = () => (notes.length > 0 ? ` (${notes.join('; ')})` : '');

  const wrote = [...new Set(codeWrites(calls, dir))];
  const read = [...new Set(codeReads(calls, dir))];
  const brainstorming = skills.some((s) => /brainstorming/.test(s));
  const hunted = [
    ...(wrote.length > 0 ? [`it changed code: ${wrote.join(', ')}`] : []),
    ...(read.length > 0 ? [`it read code: ${read.join(', ')}`] : []),
    ...(brainstorming ? ['it started brainstorming'] : []),
  ];
  const bugs = written.filter((e) => e.kind === 'work' && e.data?.lane === 'bug');
  const said = BUG.test(reply);
  if (hunted.length > 0) return { pass: false, why: `${hunted.join('; ')}${bugs.length > 0 ? '; it recorded a bug' : ''}${tail()}` };
  if (bugs.length === 0) {
    const others = written.filter((e) => e.kind === 'work').map((e) => `${e.data?.id} (${e.data?.lane})`);
    return { pass: false, why: `no work event in the bug lane${others.length > 0 ? `; work recorded: ${others.join(', ')}` : ''} (${said ? 'route 4 said' : 'no route 4 said'})${tail()}` };
  }
  if (!said) return { pass: false, why: `a bug recorded, but the route was not said as a bug${tail()}` };
  const bug = bugs.at(-1).data;
  const report = bug.doc?.path;
  if (typeof report !== 'string') return { pass: false, why: `the bug's work event names no report${tail()}` };
  const now = hashOfFile(dir, report);
  if (now === null) return { pass: false, why: `the bug's work event names ${report}, which is not in the project${tail()}` };
  if (now !== bug.doc.hash) return { pass: false, why: `the bug's work event names ${report} with hash ${String(bug.doc.hash).slice(0, 12)}, not the file's ${now.slice(0, 12)}${tail()}` };
  notes.push(`work ${bug.id} names ${report}; visible ${bug.visible}`);
  return { pass: true, why: `route 4 said, a work event in the bug lane names the written-down report, and no code read or changed${tail()}` };
}

export default {
  id: 27,
  leg: 'route',
  title: 'The front desk routes a plain bug report as a bug',

  setup: (dir, variant) => setUpFrontDesk(dir, variant, {
    files: {
      ...files,
      'README.md': README,
      'package.json': `${JSON.stringify({ name: 'clips', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`,
    },
    seed: [
      seedEvent('work', { id: 'captions', title: 'Videos can show captions', lane: 'small', visible: true, dependsOn: [] }, '2026-10-16T11:00:00.000Z'),
    ],
  }),

  prompt: MESSAGE,

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
    without: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 40,

  pass: ({ events, dir, variant, context }) => judge({
    reply: replyText(events), written: writtenEvents(context), calls: callsOf(events), dir, variant,
  }),
};
